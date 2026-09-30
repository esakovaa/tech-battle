import { NextRequest, NextResponse } from "next/server";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText } from "ai";
import type { ModelMessage, UIMessage } from "ai";
import { getModel, isLlmConfigured } from "@/lib/llm";
import { landlordSetupTools } from "@/lib/landlord-setup-tools";
import { matchIllegalCriterion } from "@/lib/landlord-illegal-criteria";

const SYSTEM = `You are a careful, friendly landlord setup assistant. Help configure one listing from the landlord's words.
Collect: property type (flat or house), address, cold rent and warm rent (ask which is which if ambiguous), optional neighborhood/area, rooms, move-in date, smoking policy, required documents, and minimum income multiple. Ask whether households with children are welcome (never offer priority), and which employment situations the landlord wants to highlight as welcome context (never use these as a filter). The platform keeps the four financial routes equal: qualifying income, guarantor, deposit insurance, or savings of at least three months' warm rent.

FAIRNESS RULES:
- Before including ANY preference that might concern who a tenant is rather than a neutral property fact or financial ability, call checkCriterionLegality with the landlord's exact short phrase. Never skip the tool call.
- If it matches action refuse_outright, plainly say you cannot include it, explain the registry basis, omit it, and do not rephrase it as a proxy. If redirect_to_alternative, explain and substitute only the stated alternative.
- A registry miss is not legal clearance. Do not claim the remaining criterion is lawful. Ask for neutral, objective listing facts only; recommend independent legal advice where the landlord asks for legal determination.
- Record genuine property facts neutrally (e.g. fifth floor, no lift); do not treat them as a tenant exclusion.
- Do not add unsupported criteria. Smoking policy options are no preference or non-smoking only. Required docs must be selected from identity, payslips, schufa, mietschuldenfreiheit, employment_contract.
- Financial security supports 2x–3x cold rent. If requested outside that range, validation will clamp it and you must explain.

When you have the fields, call validateListingConfig. If issues exist, ask the specific missing/corrective questions. If valid, summarize the proposed setup and adjustments, then ask the landlord to confirm. Do not imply setup is final before explicit human confirmation. On confirmation validate again and output a fenced listing-config-json block containing the validated config fields, suitable for the existing form. Keep the tone warm and concise.`;

function mockResponse(messages: UIMessage[]): Response {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = last?.parts.filter((p) => p.type === "text").map((p) => p.text).join(" ") ?? "";
  const criterion = matchIllegalCriterion(text);
  const reply = criterion
    ? criterion.action === "refuse_outright"
      ? `I can’t include “${text}” as a tenant-selection rule. ${criterion.basis} I’ll leave it out and can help set neutral flat details instead.`
      : `I wouldn’t use “${text}” as a blanket exclusion. ${criterion.alternative} What is the accurate room count?`
    : "I can help set this up. Is this a flat or a house? Then tell me the address, cold rent, warm rent, room count, and preferred move-in date. I’ll also ask about smoking, documents, and the income threshold. Every eligible household gets the same chance; employment and family details won’t affect scoring.";
  const stream = createUIMessageStream({ execute: async ({ writer }) => {
    writer.write({ type: "text-start", id: "mock" });
    writer.write({ type: "text-delta", id: "mock", delta: reply });
    writer.write({ type: "text-end", id: "mock" });
  } });
  return createUIMessageStreamResponse({ stream, headers: { "x-wurzelraum-agent": "mock" } });
}

export async function POST(req: NextRequest) {
  let body: { messages?: UIMessage[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (body.messages !== undefined && !Array.isArray(body.messages)) return NextResponse.json({ error: "messages must be an array" }, { status: 400 });
  const messages = body.messages ?? [];
  if (process.env.NODE_ENV !== "production" && process.env.AGENT_MOCK === "1") return mockResponse(messages);
  if (!isLlmConfigured()) return NextResponse.json({ error: "Landlord setup assistant is not configured. Set LLM_PROVIDER and its matching key/model in the environment." }, { status: 501 });
  let model;
  try { model = getModel(); } catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 501 }); }
  let modelMessages: ModelMessage[];
  try { modelMessages = await convertToModelMessages(messages); } catch { return NextResponse.json({ error: "Invalid chat message format" }, { status: 400 }); }
  const result = streamText({ model, system: SYSTEM, messages: modelMessages, tools: landlordSetupTools, stopWhen: stepCountIs(12) });
  return result.toUIMessageStreamResponse();
}
