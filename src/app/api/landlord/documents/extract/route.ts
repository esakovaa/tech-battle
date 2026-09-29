import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel, isLlmConfigured } from "@/lib/llm";
import type { DocumentType } from "@/lib/landlord-types";

/**
 * POST /api/landlord/documents/extract — "ways to upload and read
 * documents". multipart/form-data: `file` (the upload) + `documentType`
 * (one of DocumentType). Reads the actual file content via a vision-
 * capable model and extracts ONLY the narrow set of facts each document
 * type is allowed to contribute — see EXTRACTION_SCHEMAS below.
 *
 * Deliberate omission, not an oversight: the `identity` schema extracts
 * nothing but "does this look like a valid ID" — no name, no nationality,
 * no date of birth, no photo description. A naive "just OCR the ID" would
 * trivially hand the pipeline exactly the protected-characteristic data
 * the brief warns about; this endpoint's contract is narrower than what
 * the model COULD extract, on purpose, for every document type — the
 * output schema is the enforcement mechanism, not a prompt instruction
 * alone (which a model could ignore or a future prompt edit could weaken).
 */

const EXTRACTION_SCHEMAS = {
  payslips: z.object({
    looksLikeAPayslip: z.boolean(),
    netMonthlyIncomeEur: z
      .number()
      .nullable()
      .describe("Net monthly income figure stated on the payslip, in EUR. null if not legible or not found."),
  }),
  mietschuldenfreiheit: z.object({
    looksLikeAMietschuldenfreiheitsbescheinigung: z.boolean(),
    confirmsNoRentArrears: z.boolean(),
  }),
  schufa: z.object({
    looksLikeASchufaReport: z.boolean(),
    scoreOutOf100: z.number().nullable(),
  }),
  identity: z.object({
    looksLikeAValidIdentityDocument: z.boolean(),
    // Nothing else. See file-level comment.
  }),
  employment_contract: z.object({
    looksLikeAnEmploymentContract: z.boolean(),
    contractType: z.enum(["permanent", "fixed_term", "probation", "other"]).nullable(),
  }),
} satisfies Record<DocumentType, z.ZodTypeAny>;

const EXTRACTION_PROMPTS: Record<DocumentType, string> = {
  payslips: "This is a claimed payslip (Gehaltsabrechnung). Extract only the net monthly income figure.",
  mietschuldenfreiheit:
    "This is a claimed Mietschuldenfreiheitsbescheinigung (previous landlord's no-rent-arrears letter). " +
    "Confirm whether it states no rent arrears.",
  schufa: "This is a claimed SCHUFA credit report. Extract only the overall score if visible (out of 100 scale).",
  identity:
    "This is a claimed identity document. Confirm only whether it looks like a valid, legible identity " +
    "document — do not describe or extract any other information from it.",
  employment_contract:
    "This is a claimed employment contract. Extract only whether it looks genuine and the contract type " +
    "(permanent/fixed_term/probation/other).",
};

export async function POST(req: NextRequest) {
  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: "Document extraction isn't configured yet — set LLM_PROVIDER + the matching key/model (see .env.example)." },
      { status: 501 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  const documentType = formData.get("documentType");
  if (!(file instanceof File) || typeof documentType !== "string") {
    return NextResponse.json({ error: "file and documentType are required" }, { status: 400 });
  }
  if (file.size === 0 || file.size > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "File must be non-empty and no larger than 12 MB." }, { status: 400 });
  }
  if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
    return NextResponse.json({ error: "Only PDF, PNG and JPG documents are supported." }, { status: 415 });
  }
  if (!(documentType in EXTRACTION_SCHEMAS)) {
    return NextResponse.json({ error: `Unknown documentType: ${documentType}` }, { status: 400 });
  }
  const docType = documentType as DocumentType;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const model = getModel();

  try {
    const { object } = await generateObject({
      model,
      schema: EXTRACTION_SCHEMAS[docType],
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: bytes, mediaType: file.type || "application/pdf" },
            { type: "text", text: EXTRACTION_PROMPTS[docType] },
          ],
        },
      ],
    });
    return NextResponse.json({ documentType: docType, extracted: object });
  } catch (err) {
    return NextResponse.json(
      { error: `Extraction failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
