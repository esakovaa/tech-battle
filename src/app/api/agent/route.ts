import { NextRequest, NextResponse } from "next/server";
import { streamText, stepCountIs, convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { UIMessage, ModelMessage } from "ai";
import { getModel, isLlmConfigured } from "@/lib/llm";
import { agentTools } from "@/lib/agent-tools";
import type { UserPreferences } from "@/lib/types";
import { mockAgentReply } from "@/lib/agent-mock";

/**
 * Steps 5-7: the orchestration layer. A single ongoing agent conversation —
 * narrative + trade-off summary (5-6), then objection-handling (7) as the
 * user keeps replying in the same thread. No separate route per step; the
 * step boundary is just what the user says next and which tools the agent
 * reaches for, same conversation throughout.
 *
 * Deliberately NOT built: an image_search tool (skipped for tonight — see
 * README.md in this folder) and any frontend wiring (page.tsx untouched).
 *
 * POST body:
 *   {
 *     preferences: UserPreferences;  // from the step-1 intake form
 *     messages: UIMessage[];         // conversation so far; [] on the first call
 *   }
 *
 * Response: a UI message stream (ai SDK's toUIMessageStreamResponse), the
 * format @ai-sdk/react's useChat expects directly once the frontend is wired.
 */

const DEFAULT_KICKOFF =
  "Please give me your top 3 Kiez recommendations compared to my current one, " +
  "with a narrative summary of the trade-offs.";

function buildSystemPrompt(preferences: UserPreferences): string {
  return `You are the Kiez Concierge — you help a family compare Berlin neighborhoods (Planungsräume) for a possible move.

## The user's stated preferences (from their intake form)
\`\`\`json
${JSON.stringify(preferences, null, 2)}
\`\`\`

## Your job, in order
1. On your first turn, call getTopKiezRecommendations with exactly these preferences (fill currentPlrId or
   currentAddress from the JSON above — whichever is present) to get the current Kiez, top 3 alternatives, and a
   comparison table.
2. Turn that comparison table into a warm, concrete, honest narrative: what's genuinely better in each
   alternative, what's genuinely worse, and which one you'd lean toward given what THIS user said mattered to
   them — not a generic summary of all the data.
3. If the user later says something that changes what matters to them (e.g. "actually price matters a lot"),
   call getTopKiezRecommendations again with updated preferences rather than just reasoning in prose about it —
   the ranking should actually reflect the new priority, not just your description of it.
4. If the user raises an objection or asks something the database doesn't cover (e.g. "but I don't have a car,
   is X reachable without one?", "what's Y actually like to live in?"), use webSearch to find a real answer
   instead of guessing. If webSearch isn't configured, say plainly that you can't look it up right now — never
   fabricate a source.

## Handling preferences.additionalContext ("anything else important to you?")
If this field is non-empty, treat it as a signal to look beyond the 7 core questions — but ground everything, in
two steps:
1. Extract the topics it implies (e.g. "I work from home and want fast internet, also worried about crime at
   night" implies topics: internet speed, crime). For each topic, silently match it against
   getContextualCriteria's tool description (the list of available criteria keys) — do NOT ask the user to
   rephrase or pick from a menu.
2. For topics that match an available key, call getContextualCriteria (once per Kiez you're discussing — current
   plus each alternative) to get the real value and city-wide notability. For topics with no matching key (the
   tool description also lists common unavailable ones), say plainly in your narrative that it isn't something
   this data tracks — never substitute a plausible-sounding guess.
When deciding what to actually mention per Kiez: prefer criteria that are both (a) tied to something the user
actually said and (b) genuinely notable (getContextualCriteria returns notability: null for anything broadly
average — don't manufacture a reason to mention those). Cap it at 2-3 extra criteria per Kiez; this is meant to
surface the most meaningful additional facts, not append every available data point.

## Recommendation philosophy — explain this, don't just apply it silently
getTopKiezRecommendations deliberately only recommends Planungsräume FURTHER from Alexanderplatz (the city
center) than the user's current Kiez, and spreads the 3 picks across near/mid/far distance tiers where possible
(furthest-first in the result order) — this is an intentional product stance (helping decentralize Berlin,
not just "closest good match"), not a bug or an oversight. When you narrate results:
- Mention distance_from_center_km naturally as part of why each alternative was picked, framed as a genuine
  upside (quieter, more space, part of easing pressure on the inner city) — not apologetically.
- If distinctRadiusTiers is false, say plainly that the city's geography (or the user's other filters) didn't
  leave enough further-out options to spread across 3 distinct distance bands this time.
- If distanceConstraintRelaxed is true, say plainly that at least one recommendation could NOT be kept further
  from the center than the user's current Kiez (this only happens when the user already lives somewhere very
  remote) — never silently present it as satisfying the rule when it didn't.

## Data grounding rules — do not violate these
- Never invent a fact. Every number/claim about a Kiez must come from a tool result, not your general knowledge
  of Berlin.
- rent_per_m2_kalt_avg_synthetic / buy_price_per_m2_avg_synthetic are SYNTHETIC (a hedonic model), and run
  roughly 25-40% BELOW real market prices. Use them only for relative comparison ("X is cheaper than Y"), never
  state one as if it were a real asking price. buy_price_per_m2_avg_REAL is the trustworthy absolute number
  where present.
- ug_soziale_benachteiligung ("Status-Index"): HIGHER = MORE advantaged. This is counter-intuitive given the
  field's name — double check before describing an area as advantaged/disadvantaged.
- crime_total_avg_2017_2019 and abitur_mn_scls_bezirk_avg are inherited at Bezirk level — every Planungsraum in
  the same Bezirk shows an identical value, it is NOT neighborhood-precise. crime_rate_per_10k_2017_2019 is the
  population-normalized version and the one to actually compare on.
- primarySchool: there is NO data source for this at all. If asked about primary schools, say so plainly rather
  than substituting Abitur (high school) data.
- n_yoga_studios / n_kinderarzt / n_gym / n_bouldering (Planungsraum-exact counts) are zero-inflated — a 0 does
  not mean "none in the area," it can just mean none in this specific small polygon. Prefer the has_*_plz /
  n_*_plz fields (ZIP-code grain) when talking about whether something is realistically nearby.
- pct_population_coverage below 100 means the population figures for that Planungsraum are a partial estimate
  (never zero, but say "roughly" rather than stating them as exact if coverage is notably under 100).
- OSM-sourced POI counts (yoga/gym/etc.) reflect what's mapped in OpenStreetMap, not a licensed business
  directory — coverage varies by neighborhood. Don't imply completeness.

## Tone
Concrete and specific, not a corporate summary. Lead with what actually changes for this family, not a recap of
every column in the table.`;
}

/** AGENT_MOCK=1: stream pre-written, data-filled replies (lib/agent-mock.ts)
 *  in the same UI message stream format as a real model — for demos and
 *  UI testing without an API key. Takes precedence over a configured LLM. */
function mockResponse(preferences: UserPreferences, messages: UIMessage[]): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const text = await mockAgentReply(preferences, messages);
      const id = "mock-text";
      writer.write({ type: "text-start", id });
      // Word-sized chunks at a model-like pace, so the UI's streaming
      // behaviour (caret, progressive paragraphs) is exercised for real.
      for (const chunk of text.match(/\S+\s*|\s+/g) ?? []) {
        writer.write({ type: "text-delta", id, delta: chunk });
        await new Promise((r) => setTimeout(r, 28));
      }
      writer.write({ type: "text-end", id });
    },
  });
  return createUIMessageStreamResponse({ stream, headers: { "x-wurzelraum-agent": "mock" } });
}

export async function POST(req: NextRequest) {
  if (process.env.AGENT_MOCK === "1") {
    let mockBody: { preferences?: UserPreferences; messages?: UIMessage[] };
    try {
      mockBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!mockBody.preferences || (!mockBody.preferences.currentPlrId && !mockBody.preferences.currentAddress)) {
      return NextResponse.json({ error: "preferences with currentPlrId or currentAddress is required" }, { status: 400 });
    }
    return mockResponse(mockBody.preferences, mockBody.messages ?? []);
  }

  if (!isLlmConfigured()) {
    return NextResponse.json(
      {
        error:
          "The orchestration layer isn't configured yet — set LLM_PROVIDER plus the matching API key and " +
          "model id (see .env.example). This route is fully built and waiting for those values.",
      },
      { status: 501 }
    );
  }

  let body: { preferences?: UserPreferences; messages?: UIMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.preferences) {
    return NextResponse.json({ error: "preferences is required (see step-1 intake form's UserPreferences shape)" }, { status: 400 });
  }
  if (!body.preferences.currentPlrId && !body.preferences.currentAddress) {
    return NextResponse.json({ error: "preferences.currentPlrId or preferences.currentAddress is required" }, { status: 400 });
  }

  const uiMessages = body.messages ?? [];
  let modelMessages: ModelMessage[] = await convertToModelMessages(uiMessages);
  if (modelMessages.length === 0) {
    // First call in the conversation — seed it so the agent has something
    // to act on and immediately calls getTopKiezRecommendations, rather
    // than requiring the frontend to fabricate an opening message itself.
    modelMessages = [{ role: "user", content: DEFAULT_KICKOFF }];
  }

  let model;
  try {
    model = getModel();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 501 });
  }

  const result = streamText({
    model,
    system: buildSystemPrompt(body.preferences),
    messages: modelMessages,
    tools: agentTools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
