import { NextRequest, NextResponse } from "next/server";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText } from "ai";
import type { ModelMessage, UIMessage } from "ai";
import { getModel, isLlmConfigured } from "@/lib/llm";
import { landlordSetupTools } from "@/lib/landlord-setup-tools";

const SYSTEM = `You are a friendly assistant for describing a rental property. The landlord configures requirements such as required documents, smoking, income, and welcome context directly with clickable controls on the next screen. Do not ask about or decide any of those requirements, and do not ask questions about tenant types or personal-selection criteria.

Ask the landlord to describe the property in their own words. Help capture only objective property details when available: flat or house, address, neighborhood, size, room count, cold and warm rent, and availability date. Ask only brief follow-up questions needed to clarify those property facts. Do not invent missing values; omit facts the landlord did not provide.

Call validatePropertyDescription when you have a description to check. If there are issues, ask only about the relevant property fact. Summarize the property description and ask the landlord to confirm. After explicit confirmation, call the validator again and output a fenced listing-config-json block containing only the validated property facts. Explain that the next screen is where they can review and click through all listing requirements. Keep the tone warm and concise.`;

function mockResponse(): Response {
  const reply = "Tell me about the property in your own words—what kind of home it is, where it is, its size and rooms, rent, and when it will be available. You can set required documents and other application requirements on the next screen.";
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
  if (process.env.NODE_ENV !== "production" && process.env.AGENT_MOCK === "1") return mockResponse();
  if (!isLlmConfigured()) return NextResponse.json({ error: "Landlord setup assistant is not configured. Set LLM_PROVIDER and its matching key/model in the environment." }, { status: 501 });
  let model;
  try { model = getModel(); } catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 501 }); }
  let modelMessages: ModelMessage[];
  try { modelMessages = await convertToModelMessages(messages); } catch { return NextResponse.json({ error: "Invalid chat message format" }, { status: 400 }); }
  const result = streamText({ model, system: SYSTEM, messages: modelMessages, tools: landlordSetupTools, stopWhen: stepCountIs(12) });
  return result.toUIMessageStreamResponse();
}
