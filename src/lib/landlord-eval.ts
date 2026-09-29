import type {
  ApplicantFacts,
  ApplicantIdentity,
  EvaluationResult,
  Listing,
  RequirementCheck,
} from "./landlord-types";
import { DOCUMENT_LABELS, EMPLOYMENT_LABELS, ALL_DOCUMENT_TYPES } from "./landlord-types";

/** The REQUIRED gate + SHOWN-NOT-SCORED context + TO-CHECK follow-ups, for
 *  one applicant against one listing. Signature only accepts
 *  ApplicantFacts — see the comment on that type for why that's the actual
 *  fairness guarantee, not just a convention. */
export function evaluateApplicant(facts: ApplicantFacts, listing: Listing): EvaluationResult {
  const checks: RequirementCheck[] = [];

  const requiredIncome = listing.min_income_multiple * listing.kaltmiete_eur_monthly;
  const incomeMultiple = facts.netIncomeMonthlyDeclared / listing.kaltmiete_eur_monthly;
  checks.push({
    key: "affordability",
    label: `Affordability: income at least ${listing.min_income_multiple}x cold rent`,
    passed: facts.netIncomeMonthlyDeclared >= requiredIncome,
    detail: `Declared income is ${incomeMultiple.toFixed(1)}x the cold rent (needs ${listing.min_income_multiple}x, i.e. €${requiredIncome.toFixed(0)}).`,
  });

  const missingDocs = listing.required_documents.filter((d) => !facts.documentsProvided.includes(d));
  checks.push({
    key: "documents",
    label: "Required documents provided",
    passed: missingDocs.length === 0,
    detail:
      missingDocs.length === 0
        ? "All required documents provided."
        : `Missing: ${missingDocs.map((d) => DOCUMENT_LABELS[d]).join(", ")}.`,
  });

  const canMoveInByTarget = new Date(facts.earliestMoveInDate) <= new Date(listing.move_in_date);
  checks.push({
    key: "move_in_date",
    label: `Can move in by ${listing.move_in_date}`,
    passed: canMoveInByTarget,
    detail: canMoveInByTarget
      ? `Available from ${facts.earliestMoveInDate}.`
      : `Earliest availability (${facts.earliestMoveInDate}) is after the target move-in date.`,
  });

  if (listing.smoking_policy === "non_smoking_only") {
    checks.push({
      key: "smoking",
      label: "Non-smoking (landlord requirement)",
      passed: !facts.smoker,
      detail: facts.smoker ? "Applicant is a smoker; this listing is non-smoking only." : "Non-smoker.",
    });
  }

  const meetsAllRequirements = checks.every((c) => c.passed);

  const shownNotScored = [
    { label: "Household", value: describeHousehold(facts) },
    { label: "Employment", value: EMPLOYMENT_LABELS[facts.employmentType] },
    { label: "Smoker", value: facts.smoker ? "Yes" : "No" },
  ];

  const toCheck: string[] = [];
  const optionalMissingDocs = ALL_DOCUMENT_TYPES.filter(
    (d) => !listing.required_documents.includes(d) && !facts.documentsProvided.includes(d)
  );
  if (optionalMissingDocs.length > 0) {
    toCheck.push(`Optional document not provided: ${optionalMissingDocs.map((d) => DOCUMENT_LABELS[d]).join(", ")}.`);
  }
  if (
    facts.payslipExtractedIncome != null &&
    Math.abs(facts.payslipExtractedIncome - facts.netIncomeMonthlyDeclared) > 100
  ) {
    toCheck.push(
      `Declared income (€${facts.netIncomeMonthlyDeclared}) doesn't match the payslip-extracted figure ` +
        `(€${facts.payslipExtractedIncome}) — worth confirming.`
    );
  }
  if (facts.employmentType === "selfemployed" || facts.employmentType === "permanent_plus_selfemployed") {
    toCheck.push("Self-employed income — consider asking for the latest tax assessment.");
  }
  const marginAboveThreshold = incomeMultiple - listing.min_income_multiple;
  if (meetsAllRequirements && marginAboveThreshold < 0.3) {
    toCheck.push(
      `Closest to the affordability threshold (${incomeMultiple.toFixed(1)}x vs. ${listing.min_income_multiple}x required).`
    );
  }
  if (meetsAllRequirements && toCheck.length === 0) {
    toCheck.push("Nothing outstanding.");
  }

  return {
    applicantId: facts.id,
    meetsAllRequirements,
    checks,
    shownNotScored,
    toCheck: meetsAllRequirements ? toCheck : [],
    documentsCompleteCount: facts.documentsProvided.length,
    documentsRequiredCount: ALL_DOCUMENT_TYPES.length,
  };
}

function describeHousehold(facts: ApplicantFacts): string {
  const adults = `${facts.householdAdults} adult${facts.householdAdults === 1 ? "" : "s"}`;
  if (facts.householdChildren === 0) return adults;
  return `${adults}, ${facts.householdChildren} child${facts.householdChildren === 1 ? "" : "ren"}`;
}

/** Readiness ranking among applicants who already meet every requirement —
 *  fewest open "to check" items first (excluding the "Nothing outstanding"
 *  placeholder, which isn't a real open item), i.e. least remaining
 *  verification work for the landlord. This is deliberately NOT a
 *  desirability ranking: it never reads income beyond the pass/fail
 *  threshold, employment prestige, or household composition as a
 *  preference signal — once the landlord's own stated bar is cleared,
 *  re-ranking by a secondary preference model is exactly where bias would
 *  creep back in, so this only optimizes for "least follow-up work." */
export function rankByReadiness(results: EvaluationResult[]): EvaluationResult[] {
  const openItemCount = (r: EvaluationResult) =>
    r.toCheck.length === 1 && r.toCheck[0] === "Nothing outstanding." ? 0 : r.toCheck.length;
  return results
    .filter((r) => r.meetsAllRequirements)
    .slice()
    .sort((a, b) => {
      const diff = openItemCount(a) - openItemCount(b);
      if (diff !== 0) return diff;
      return b.documentsCompleteCount - a.documentsCompleteCount;
    });
}

export interface DuplicateGroup {
  key: string;
  applicantIds: string[];
}

function normalizeForDedup(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Deterministic exact-match dedup on name+DOB (a real system would also
 *  fuzzy-match on near-identical names/emails — this is the MVP version:
 *  the brief's "same person often applies more than once" doesn't require
 *  catching every spelling variant to be a genuine, useful signal). Reads
 *  ApplicantIdentity only — never facts or narrative. */
export function findDuplicates(identities: ApplicantIdentity[]): DuplicateGroup[] {
  const byKey = new Map<string, string[]>();
  for (const identity of identities) {
    const key = `${normalizeForDedup(identity.fullName)}|${identity.dateOfBirth}`;
    const list = byKey.get(key) ?? [];
    list.push(identity.id);
    byKey.set(key, list);
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, applicantIds]) => ({ key, applicantIds }));
}

/** A, B, C, ... Z, AA, AB, ... — landlord-facing display label. Applicants
 *  are never shown by name during screening (see ApplicantIdentity) —
 *  this is the "blind hiring" pattern applied to renting: identity is
 *  revealed only after the landlord decides to invite someone to view,
 *  not during evaluation. */
export function anonymizedLabel(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Applicant ${label}`;
}
