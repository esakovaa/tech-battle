import { tool } from "ai";
import { z } from "zod";
import { ALL_DOCUMENT_TYPES, type DocumentType, type EmploymentContextType, type Listing, type PropertyType, type SmokingPolicy } from "./landlord-types";
import { clampIncomeMultiple } from "./landlord-eval";
import { matchIllegalCriterion } from "./landlord-illegal-criteria";

export function validateListingConfig(input: Record<string, unknown>) {
  const valid: Record<string, unknown> = {};
  const issues: string[] = [];
  const adjustments: string[] = [];
  if (input.property_type === "flat" || input.property_type === "house") valid.property_type = input.property_type satisfies PropertyType;
  else issues.push("Is the property a flat or a house?");
  const textFields = ["address", "ortsteil"] as const;
  for (const field of textFields) {
    if (typeof input[field] === "string" && input[field].trim()) valid[field] = input[field].trim();
    else if (field === "address") issues.push("What is the flat's address?");
  }
  for (const field of ["rooms", "kaltmiete_eur_monthly", "warmmiete_eur_monthly", "area_m2"] as const) {
    const value = input[field];
    if (value === undefined && field === "area_m2") continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || (field === "rooms" && !Number.isInteger(value))) {
      issues.push(`${field} must be a positive ${field === "rooms" ? "whole number" : "number"}.`);
    } else valid[field] = value;
  }
  if (typeof input.kaltmiete_eur_monthly === "number" && typeof input.warmmiete_eur_monthly === "number" && input.warmmiete_eur_monthly < input.kaltmiete_eur_monthly) {
    issues.push("Warm rent is lower than cold rent. Please check both amounts.");
    delete valid.warmmiete_eur_monthly;
  }
  const date = input.move_in_date;
  const parsedDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    issues.push("What move-in date should applicants be able to meet? Please use a calendar date.");
  } else valid.move_in_date = date;
  const policy = input.smoking_policy;
  if (policy === "no_preference" || policy === "non_smoking_only") valid.smoking_policy = policy satisfies SmokingPolicy;
  else issues.push("Choose a supported smoking policy: no preference or non-smoking only.");
  if (!Array.isArray(input.required_documents)) issues.push("Which required documents should applicants provide?");
  else {
    const docs = input.required_documents.filter((d): d is DocumentType => typeof d === "string" && (ALL_DOCUMENT_TYPES as string[]).includes(d));
    if (docs.length !== input.required_documents.length) issues.push("One or more required document types are unsupported; choose from the listed document options.");
    else valid.required_documents = [...new Set(docs)];
  }
  if (typeof input.min_income_multiple !== "number" || !Number.isFinite(input.min_income_multiple)) {
    issues.push("What minimum income-to-cold-rent multiple should apply? The product allows 2x to 3x.");
  } else {
    const clamped = clampIncomeMultiple(input.min_income_multiple);
    valid.min_income_multiple = clamped;
    if (clamped !== input.min_income_multiple) adjustments.push(`Income multiple adjusted from ${input.min_income_multiple}x to ${clamped}x: this product supports 2x–3x only.`);
  }
  if (input.households_with_children_welcome !== undefined) {
    if (typeof input.households_with_children_welcome === "boolean") valid.households_with_children_welcome = input.households_with_children_welcome;
    else issues.push("Please confirm whether households with children are welcome (this never affects priority or eligibility).");
  } else issues.push("Would you like to note that households with children are welcome? This cannot create priority or affect eligibility.");
  if (input.employment_context_types !== undefined) {
    const supported: EmploymentContextType[] = ["unlimited_contract", "self_employed", "retired", "limited_contract", "burgergeld"];
    if (!Array.isArray(input.employment_context_types) || input.employment_context_types.some((type) => !supported.includes(type as EmploymentContextType))) {
      issues.push("Choose employment context labels from the supported list.");
    } else valid.employment_context_types = [...new Set(input.employment_context_types as EmploymentContextType[])];
  } else issues.push("Which employment situations should the listing welcome as context? Choose any or none; this never filters applicants.");
  return { valid: valid as Partial<Listing>, issues, adjustments };
}

/** Validate only objective facts about the property. Tenant requirements stay
 * on the clickable listing form and are never elicited by the chat. */
export function validatePropertyDescription(input: Record<string, unknown>) {
  const valid: Partial<Listing> = {};
  const issues: string[] = [];
  if (input.property_type !== undefined) {
    if (input.property_type === "flat" || input.property_type === "house") valid.property_type = input.property_type;
    else issues.push("Property type must be flat or house.");
  }
  for (const field of ["address", "ortsteil"] as const) {
    const value = input[field];
    if (value !== undefined) {
      if (typeof value === "string" && value.trim()) valid[field] = value.trim();
      else issues.push(`${field} must be a non-empty text value.`);
    }
  }
  for (const field of ["area_m2", "rooms", "kaltmiete_eur_monthly", "warmmiete_eur_monthly"] as const) {
    const value = input[field];
    if (value !== undefined) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0 && (field !== "rooms" || Number.isInteger(value))) valid[field] = value;
      else issues.push(`${field} must be a positive${field === "rooms" ? " whole" : ""} number.`);
    }
  }
  if (input.move_in_date !== undefined) {
    const date = input.move_in_date;
    const parsed = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
    if (parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) valid.move_in_date = date;
    else issues.push("move_in_date must be a valid calendar date in YYYY-MM-DD format.");
  }
  if (typeof input.kaltmiete_eur_monthly === "number" && typeof input.warmmiete_eur_monthly === "number" && input.warmmiete_eur_monthly < input.kaltmiete_eur_monthly) {
    issues.push("Warm rent is lower than cold rent. Please check both amounts.");
    delete valid.warmmiete_eur_monthly;
  }
  return { valid, issues };
}

export const checkCriterionLegality = tool({
  description: "Check a landlord's proposed tenant-selection criterion against the fixed reviewed policy registry. A no-match is not legal clearance.",
  inputSchema: z.object({ phrase: z.string().min(1).describe("Short criterion or wording proposed by the landlord.") }),
  execute: async ({ phrase }) => {
    const match = matchIllegalCriterion(phrase);
    return match ? { status: "matched", ...match } : { status: "not_a_known_concern", note: "No reviewed example matched. This is not legal clearance; do not infer a legal conclusion from the miss." };
  },
});

export const validateListingConfigTool = tool({
  description: "Deterministically validate collected listing setup facts. Ask the landlord about every item in issues; report adjustments transparently.",
  inputSchema: z.object({
    address: z.string().optional(), ortsteil: z.string().optional(), area_m2: z.number().optional(),
    rooms: z.number().optional(), kaltmiete_eur_monthly: z.number().optional(), warmmiete_eur_monthly: z.number().optional(),
    move_in_date: z.string().optional(), smoking_policy: z.string().optional(), required_documents: z.array(z.string()).optional(),
    min_income_multiple: z.number().optional(),
    property_type: z.enum(["flat", "house"]).optional(), households_with_children_welcome: z.boolean().optional(),
    employment_context_types: z.array(z.string()).optional(),
  }),
  execute: async (input) => validateListingConfig(input),
});

export const validatePropertyDescriptionTool = tool({
  description: "Validate objective property facts from the landlord's description only. Do not collect tenant requirements or personal-selection criteria in chat.",
  inputSchema: z.object({
    property_type: z.enum(["flat", "house"]).optional(), address: z.string().optional(), ortsteil: z.string().optional(),
    area_m2: z.number().optional(), rooms: z.number().optional(), kaltmiete_eur_monthly: z.number().optional(),
    warmmiete_eur_monthly: z.number().optional(), move_in_date: z.string().optional(),
  }),
  execute: async (input) => validatePropertyDescription(input),
});

export const landlordSetupTools = { validatePropertyDescription: validatePropertyDescriptionTool };
