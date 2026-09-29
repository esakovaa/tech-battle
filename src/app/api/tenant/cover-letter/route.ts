import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel, isLlmConfigured } from "@/lib/llm";

/**
 * POST /api/tenant/cover-letter — "use AI to craft cover letters" (tenant
 * side of the landlord twist). Takes the tenant's structured application
 * facts plus their answers to a few guided prompts, and drafts a warm,
 * concrete cover letter for the landlord to read — the free-text
 * `answers` fields land in ApplicantNarrative on the landlord side, never
 * in ApplicantFacts, so nothing this endpoint writes ever reaches
 * evaluateApplicant()/rankByReadiness (see lib/landlord-eval.ts).
 *
 * The model is instructed to use ONLY what the tenant actually said —
 * never invent circumstances, credentials, or family details not given —
 * since a fabricated-sounding cover letter is worse for a genuine applicant
 * than a plain one.
 *
 * POST body:
 *   {
 *     householdSummary: string;       // e.g. "2 adults, 1 child"
 *     employmentSummary: string;      // e.g. "Permanent, IT sector"
 *     moveInDate: string;
 *     answers: {
 *       aboutYourFamily?: string;
 *       whyThisNeighborhood?: string;
 *       anythingElse?: string;
 *     };
 *     tone?: "formal" | "warm";       // default "warm"
 *   }
 */
export async function POST(req: NextRequest) {
  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: "Cover-letter drafting isn't configured yet — set LLM_PROVIDER + the matching key/model (see .env.example)." },
      { status: 501 }
    );
  }

  let body: {
    householdSummary?: string;
    employmentSummary?: string;
    moveInDate?: string;
    answers?: { aboutYourFamily?: string; whyThisNeighborhood?: string; anythingElse?: string };
    tone?: "formal" | "warm";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.answers || (!body.answers.aboutYourFamily && !body.answers.whyThisNeighborhood && !body.answers.anythingElse)) {
    return NextResponse.json({ error: "At least one of answers.aboutYourFamily/whyThisNeighborhood/anythingElse is required" }, { status: 400 });
  }

  const tone = body.tone ?? "warm";
  const facts = [
    body.householdSummary ? `Household: ${body.householdSummary}` : null,
    body.employmentSummary ? `Employment: ${body.employmentSummary}` : null,
    body.moveInDate ? `Available to move in: ${body.moveInDate}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const answers = [
    body.answers.aboutYourFamily ? `About their household: ${body.answers.aboutYourFamily}` : null,
    body.answers.whyThisNeighborhood ? `Why this neighborhood: ${body.answers.whyThisNeighborhood}` : null,
    body.answers.anythingElse ? `Anything else: ${body.answers.anythingElse}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You draft a rental application cover letter for a Berlin landlord, in ${tone === "formal" ? "a formal, polite" : "a warm, genuine"} tone.

Rules:
- Use ONLY the facts and answers given below. Never invent a profession, credential, hobby, or family detail that wasn't stated.
- Keep it concrete and specific to what THIS applicant actually said — not a generic template.
- 120-200 words. No subject line, no placeholder brackets.
- Do not mention religion, nationality, ethnicity, or disability unless the applicant's own words already did — never add these as a flourish.`;

  const prompt = `Structured facts:\n${facts || "(none provided)"}\n\nApplicant's own words:\n${answers}\n\nDraft the cover letter now.`;

  try {
    const { text } = await generateText({ model: getModel(), system, prompt });
    return NextResponse.json({ draft: text });
  } catch (err) {
    return NextResponse.json(
      { error: `Draft generation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
