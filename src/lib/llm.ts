import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type LlmProvider = "anthropic" | "openai";

function getProviderName(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  if (raw !== "anthropic" && raw !== "openai") {
    throw new Error(`Unknown LLM_PROVIDER "${raw}" — expected "anthropic" or "openai". See .env.example.`);
  }
  return raw;
}

/** True once the active provider has both an API key and a model id set.
 *  Check this before calling getModel() to fail with a clean 501 response
 *  instead of an uncaught throw. */
export function isLlmConfigured(): boolean {
  const provider = getProviderName();
  if (provider === "anthropic") {
    return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL);
  }
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
}

/** Lazily constructs the model — deliberately never called at module load
 *  time (only inside a request handler), so a missing API key doesn't
 *  crash `next build` or route registration, only an actual request that
 *  needs it. Call isLlmConfigured() first if you want to fail cleanly. */
export function getModel(): LanguageModel {
  const provider = getProviderName();

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const modelId = process.env.ANTHROPIC_MODEL;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set — see .env.example");
    if (!modelId) throw new Error("ANTHROPIC_MODEL is not set — see .env.example");
    return createAnthropic({ apiKey })(modelId);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const modelId = process.env.OPENAI_MODEL;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set — see .env.example");
  if (!modelId) throw new Error("OPENAI_MODEL is not set — see .env.example");
  return createOpenAI({ apiKey })(modelId);
}
