import { tool } from "ai";
import { z } from "zod";
import { findTopAlternatives, getPlanungsraumById, PRIMARY_SCHOOL_DATA_AVAILABLE } from "./rank";
import { resolveAddressToPlanungsraum } from "./geocode";
import { buildComparisonTable } from "./compare";
import type { UserPreferences } from "./types";

// ---------------------------------------------------------------
// getTopKiezRecommendations — the agent's first tool, per the intended
// design: an in-process call into the SAME lib/rank.ts + lib/compare.ts
// code /api/rank uses (steps 2-4), not a second HTTP request. This is the
// deterministic layer; the agent wraps it, it doesn't reimplement it.
//
// The agent recomputes the ranking itself (rather than trusting a
// precomputed JSON blob handed to it) — chosen deliberately: it's the only
// way the agent can re-rank mid-conversation if an objection reveals a
// preference actually matters more/less than the intake form captured
// (e.g. "actually price matters a lot to me"), and it means the agent
// can't be fed a fabricated comparison result.
// ---------------------------------------------------------------

const preferencesInputSchema = z.object({
  currentPlrId: z
    .string()
    .optional()
    .describe("The user's current Planungsraum id (plr_id), if already known/resolved."),
  currentAddress: z
    .string()
    .optional()
    .describe(
      "A free-text Berlin address to geocode, if currentPlrId isn't known yet. Exactly one of currentPlrId/currentAddress must be given."
    ),
  kids: z
    .object({
      kita: z.boolean().default(false).describe("User needs Kita (daycare) access."),
      primarySchool: z
        .boolean()
        .default(false)
        .describe("User cares about primary school — NOTE: no data source exists for this yet, never used to filter/score, kept only so the UI can show an honest 'no data yet' note."),
      highSchool: z.boolean().default(false).describe("User cares about high school / Abitur quality."),
      kidDoctor: z.boolean().default(false).describe("User needs a Kinderarzt (paediatrician) nearby."),
    })
    .default({ kita: false, primarySchool: false, highSchool: false, kidDoctor: false }),
  rentBudget: z
    .enum(["minimal", "flexible", "not_a_concern"])
    .default("flexible")
    .describe("How tightly rent price should be weighted."),
  noiseAirSensitive: z.boolean().default(false),
  parksImportant: z.boolean().default(false),
  hobbies: z
    .object({
      yoga: z.boolean().default(false),
      gym: z.boolean().default(false),
      bouldering: z.boolean().default(false),
    })
    .default({ yoga: false, gym: false, bouldering: false }),
  commuteAddresses: z
    .array(z.string())
    .optional()
    .describe(
      "Free-text addresses (e.g. workplaces) to compute real transit commute time against — up to 2 (both " +
        "partners' commutes average together). Omit for no commute filtering/scoring."
    ),
});

export const getTopKiezRecommendations = tool({
  description:
    "Resolve the user's current Berlin Kiez (Planungsraum) and find the top 3 alternative Kieze — each in a " +
    "different ZIP code — ranked against the user's stated preferences, with a full comparison table (current " +
    "vs. each alternative) and a pros/cons summary per alternative. This is the deterministic ranking layer — " +
    "call it whenever you need fresh recommendations, including again mid-conversation if the user reveals a " +
    "preference that should change the ranking (e.g. 'actually price matters more to me than I said').",
  inputSchema: preferencesInputSchema,
  execute: async (input) => {
    if (!input.currentPlrId && !input.currentAddress) {
      return { error: "Either currentPlrId or currentAddress is required." };
    }

    let currentPlrId = input.currentPlrId;
    if (!currentPlrId && input.currentAddress) {
      const resolved = await resolveAddressToPlanungsraum(input.currentAddress);
      if (!resolved) {
        return { error: `Could not resolve "${input.currentAddress}" to a Berlin Planungsraum.` };
      }
      currentPlrId = resolved.plr_id;
    }

    const current = getPlanungsraumById(currentPlrId!);
    if (!current) {
      return { error: `Unknown plr_id: ${currentPlrId}` };
    }

    const prefs: UserPreferences = {
      currentPlrId,
      kids: input.kids,
      rentBudget: input.rentBudget,
      noiseAirSensitive: input.noiseAirSensitive,
      parksImportant: input.parksImportant,
      hobbies: input.hobbies,
      commuteAddresses: input.commuteAddresses,
    };

    const { results, secondBest, droppedFilters, distinctRadiusTiers, distanceConstraintRelaxed, commuteConstraintRelaxed } =
      await findTopAlternatives(currentPlrId!, prefs, 3);
    const comparisonTable = buildComparisonTable(current, results, prefs);

    return {
      current,
      alternatives: results,
      comparisonTable,
      secondBest,
      droppedFilters,
      distinctRadiusTiers,
      distanceConstraintRelaxed,
      commuteConstraintRelaxed,
      primarySchoolDataAvailable: PRIMARY_SCHOOL_DATA_AVAILABLE,
      primarySchoolNote: prefs.kids.primarySchool
        ? "Primary school quality/presence data isn't available yet — this criterion wasn't used to filter or rank results."
        : undefined,
    };
  },
});

// ---------------------------------------------------------------
// webSearch — for step 7 objection-handling ("but I don't have a car",
// "is there a Kita nearby without needing a car"). Backed by Tavily
// (api.tavily.com) since the provider choice was left generic tonight —
// this doesn't depend on which LLM provider (Anthropic/OpenAI) ends up
// configured in lib/llm.ts. Requires TAVILY_API_KEY; without it, the tool
// still registers (so the agent knows it exists and can explain why it
// can't use it) but returns a clear "not configured" result instead of
// throwing.
// ---------------------------------------------------------------

export const webSearch = tool({
  description:
    "Search the web for a fact not present in the Kiez database — e.g. car-free accessibility of a specific " +
    "amenity, recent local news, or anything else needed to answer a user's objection. Not for general Berlin " +
    "real-estate facts already covered by getTopKiezRecommendations' data (price, crime, schools, etc.) — prefer " +
    "that tool's data first, since it's grounded in this project's audited sources.",
  inputSchema: z.object({
    query: z.string().describe("The search query."),
  }),
  execute: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        error:
          "Web search isn't configured yet (TAVILY_API_KEY unset) — tell the user you can't look this up right now.",
      };
    }

    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
      });
      if (!res.ok) {
        return { error: `Search request failed (${res.status}).` };
      }
      const data: { results?: { title: string; url: string; content: string }[] } = await res.json();
      return {
        results: (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })),
      };
    } catch (err) {
      return { error: `Search request failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

export const agentTools = { getTopKiezRecommendations, webSearch };
