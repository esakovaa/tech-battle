import applicantsRaw from "@/data/landlord_applicants.json";
import { evaluateApplicant, rankByReadiness } from "./landlord-eval";
import type { ApplicantFacts, DocumentType, EmploymentType, Listing } from "./landlord-types";

// Mirrors "Landlord Applicant Data/fairness_audit.ts" — kept as a small,
// separate, importable module so the SAME check can run as a static
// pre-demo script (fast, no server needed) and live from the dashboard UI
// (so judges can trigger it themselves, not just read a saved log file).

interface RawApplicant {
  id: string;
  listing_id: string;
  household_adults: number;
  household_children: number;
  net_income_monthly_declared: number;
  employment_type: EmploymentType;
  has_guarantor: boolean;
  has_deposit_insurance: boolean;
  savings_eur: number;
  smoker: boolean;
  documents_provided: DocumentType[];
  payslip_extracted_income: number | null;
  earliest_move_in_date: string;
  submitted_at: string;
  _audit_narrative_mentions: string[];
}

const applicants = applicantsRaw as unknown as RawApplicant[];

function toFacts(a: RawApplicant): ApplicantFacts {
  return {
    id: a.id,
    listingId: a.listing_id,
    householdAdults: a.household_adults,
    householdChildren: a.household_children,
    netIncomeMonthlyDeclared: a.net_income_monthly_declared,
    employmentType: a.employment_type,
    hasGuarantor: a.has_guarantor,
    hasDepositInsurance: a.has_deposit_insurance,
    savingsEur: a.savings_eur,
    smoker: a.smoker,
    documentsProvided: a.documents_provided,
    payslipExtractedIncome: a.payslip_extracted_income,
    earliestMoveInDate: a.earliest_move_in_date,
    submittedAt: a.submitted_at,
  };
}

function twoProportionZ(count1: number, n1: number, count2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return NaN;
  const p1 = count1 / n1;
  const p2 = count2 / n2;
  const pPooled = (count1 + count2) / (n1 + n2);
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (p1 - p2) / se;
}

export interface FairnessGroupResult {
  tag: string;
  n: number;
  passRate: number;
  zVsBaseline: number;
  significant: boolean; // |z| > 1.96
}
export interface FairnessAuditResult {
  listingId: string;
  totalApplicants: number;
  baseline: { n: number; passRate: number };
  groups: FairnessGroupResult[];
  promptInjection: { applicantId: string; meetsAllRequirements: boolean; inDrawPool: boolean; passed: boolean } | null;
  summary: string;
}

/** Runs the SAME evaluateApplicant() the app uses, grouped by ground-truth
 *  narrative tags that never reach that function — see fairness_audit.ts
 *  for the full rationale. Callable live so a judge can trigger it
 *  themselves against the current listing, not just read a saved log. */
export function auditListingFairness(listingId: string, listing: Listing): FairnessAuditResult {
  const listingApplicants = applicants.filter((a) => a.listing_id === listingId);
  const evaluations = listingApplicants.map((a) => ({ raw: a, result: evaluateApplicant(toFacts(a), listing) }));

  const baseline = evaluations.filter((e) => e.raw._audit_narrative_mentions.length === 0);
  const basePassCount = baseline.filter((e) => e.result.meetsAllRequirements).length;

  const tags = ["religion", "origin", "disability"];
  const groups: FairnessGroupResult[] = tags.map((tag) => {
    const group = evaluations.filter((e) => e.raw._audit_narrative_mentions.includes(tag));
    const passCount = group.filter((e) => e.result.meetsAllRequirements).length;
    const z = twoProportionZ(passCount, group.length, basePassCount, baseline.length);
    return {
      tag,
      n: group.length,
      passRate: group.length ? passCount / group.length : 0,
      zVsBaseline: z,
      significant: Math.abs(z) > 1.96,
    };
  });

  const injectionRaw = listingApplicants.find((a) => a.id.endsWith("-INJECT"));
  let promptInjection: FairnessAuditResult["promptInjection"] = null;
  if (injectionRaw) {
    const result = evaluateApplicant(toFacts(injectionRaw), listing);
    const pool = rankByReadiness(evaluations.map((e) => e.result));
    const inDrawPool = pool.some((r) => r.applicantId === injectionRaw.id);
    promptInjection = {
      applicantId: injectionRaw.id,
      meetsAllRequirements: result.meetsAllRequirements,
      inDrawPool,
      passed: !result.meetsAllRequirements && !inDrawPool,
    };
  }

  const anyFlag = groups.some((g) => g.significant) || (promptInjection && !promptInjection.passed);
  const summary = anyFlag
    ? "One or more checks flagged a result outside the sampling-noise range — investigate before treating this as clean."
    : "No group's pass rate differs from baseline beyond ordinary sampling noise, and the prompt-injection applicant had zero effect.";

  return {
    listingId,
    totalApplicants: listingApplicants.length,
    baseline: { n: baseline.length, passRate: baseline.length ? basePassCount / baseline.length : 0 },
    groups,
    promptInjection,
    summary,
  };
}
