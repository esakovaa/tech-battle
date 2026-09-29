# Orchestration layer (steps 5-7)

`POST /api/agent` — the LLM agent that sits on top of the deterministic ranking layer (`/api/rank`, steps 2-4).
One continuous conversation covers narrative + trade-offs (steps 5-6) and objection-handling (step 7); there's no
separate route per step, just what the user says next in the same thread.

## Status: wired; live research needs provider credentials

The results page streams the agent’s first response into the personalized-research section and reuses the same
agent for follow-up questions. Live model output requires `LLM_PROVIDER` and its provider key. Live web research
also requires `TAVILY_API_KEY`. Without that setting, the AI agent can still explain the project’s local data, but
the UI labels the response as local-data-only. `AGENT_MOCK=1` is honored only outside production so a leftover
demo flag cannot silently replace the live agent on Vercel.

## How it fits together

- `src/lib/llm.ts` — provider selection. Reads `LLM_PROVIDER` (`anthropic` | `openai`) and constructs the model
  lazily, only inside a request handler — never at module load, so a missing key can't crash `next build` or
  route registration. Call `isLlmConfigured()` before `getModel()` to fail cleanly instead of throwing.
- `src/lib/agent-tools.ts` — the three tools:
  - `getTopKiezRecommendations` — wraps `findTopAlternatives` + `buildComparisonTable` from `lib/rank.ts` /
    `lib/compare.ts` (the exact same code `/api/rank` uses), in-process. This is the agent's first tool call on
    every conversation, and it can call it again mid-conversation if an objection changes what should be
    weighted. Chosen over trusting a client-supplied JSON blob so there's one source of truth and the agent can
    re-rank live — see the chat log this was built from for the reasoning.
  - `webSearch` — backed by [Tavily](https://tavily.com) (`TAVILY_API_KEY`). Required for the user's free-text
    additional preferences on the first response, and for follow-up questions needing current local details.
    Uses Tavily's bearer-token API authentication and returns a clear “not configured” result instead of throwing
    if the key isn’t set.
- `src/app/api/agent/route.ts` — builds a system prompt that (a) injects the user's structured `preferences` as
  JSON so the model doesn't have to re-derive them from prose, and (b) restates the key data-trust caveats from
  `Kiez Profile Master Table/README.md` (synthetic vs. real prices, the Status-Index direction gotcha, Bezirk- vs
  Planungsraum-level grain, zero-inflated POI counts, no primary-school data) so the agent doesn't overclaim
  precision the data doesn't have. Then runs `streamText` with all three tools, `stopWhen: stepCountIs(12)`, and
  returns `toUIMessageStreamResponse()` — parsed by the results page to stream the research narrative and follow-up answers.

## Request contract

```jsonc
POST /api/agent
{
  "preferences": { /* UserPreferences shape, from lib/types.ts — same as /api/rank's body */ },
  "messages": []   // [] on the first call; the route seeds a kickoff message for you.
                    // On later calls, pass the full running UIMessage[] history back
                    // (standard stateless useChat pattern — no server-side session state).
}
```

## Testing once a key is added

```bash
# 1. Fill in .env.example values, copy to .env.local
# 2. npm run dev
# 3. First turn (empty messages — the route seeds a kickoff message):
curl -N -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{
    "preferences": {
      "currentPlrId": "03601347",
      "kids": { "kita": true, "primarySchool": false, "highSchool": false, "kidDoctor": true },
      "rentBudget": "flexible",
      "noiseAirSensitive": true,
      "parksImportant": true,
      "hobbies": { "yoga": true, "gym": false, "bouldering": false }
    },
    "messages": []
  }'
# Should stream back tool calls (getTopKiezRecommendations) followed by narrative text.
```

## Explicitly not done tonight (by request, not by accident)

- **Image tool** — skipped. No API key existed to test it against, and a wired-but-untested tool is worse than
  a documented gap. Slot for it: a third entry in `agentTools` (`src/lib/agent-tools.ts`), e.g. Google Custom
  Search Images (`GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID`) or Wikimedia Commons (no key needed, but thinner
  coverage for small Planungsräume) — either fits the same `tool({...})` pattern the other two use.
- **web_search gated to "step 7 only"** — the original spec described it as appearing starting at step 7. I
  made it available to the model from turn 1 instead (simpler, and the model has no reason to reach for it
  before it needs a fact the database doesn't have) — flag if you actually want it withheld earlier by turn
  count.
- **Provider actually chosen** — `LLM_PROVIDER` defaults to `anthropic` in `.env.example` but nothing forces it;
  swap to `openai` by changing that one line, no code changes needed either way.
