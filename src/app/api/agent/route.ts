import { NextRequest, NextResponse } from "next/server";
import { streamText, stepCountIs, convertToModelMessages } from "ai";
import type { UIMessage, ModelMessage } from "ai";
import { getModel, isLlmConfigured } from "@/lib/llm";
import { agentTools } from "@/lib/agent-tools";
import type { UserPreferences } from "@/lib/types";

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

export async function POST(req: NextRequest) {
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
