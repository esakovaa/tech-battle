// Mirrors "Landlord Applicant Data/generate_synthetic_applicants.py"'s output
// (src/data/landlord_applicants.json, src/data/landlord_listings.json).

export type EmploymentType =
  | "permanent"
  | "permanent_plus_selfemployed"
  | "selfemployed"
  | "fixed_term"
  | "probation"
  | "student"
  | "unemployed";

export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  permanent: "Permanent",
  permanent_plus_selfemployed: "Permanent + self-employed",
  selfemployed: "Self-employed",
  fixed_term: "Fixed-term contract",
  probation: "Probationary period",
  student: "Student",
  unemployed: "Unemployed",
};

export type DocumentType = "identity" | "payslips" | "schufa" | "mietschuldenfreiheit" | "employment_contract";

export const ALL_DOCUMENT_TYPES: DocumentType[] = [
  "identity",
  "payslips",
  "schufa",
  "mietschuldenfreiheit",
  "employment_contract",
];

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  identity: "Proof of identity",
  payslips: "Last three payslips",
  schufa: "SCHUFA credit report",
  mietschuldenfreiheit: "Mietschuldenfreiheitsbescheinigung",
  employment_contract: "Employment contract",
};

export type SmokingPolicy = "no_preference" | "non_smoking_only";

export interface Listing {
  id: string;
  address: string;
  ortsteil: string;
  area_m2: number;
  rooms: number;
  kaltmiete_eur_monthly: number;
  warmmiete_eur_monthly: number;
  move_in_date: string; // ISO date
  smoking_policy: SmokingPolicy;
  required_documents: DocumentType[];
  /** Capped at 3.0x, per Portland's FAIR ordinance precedent (landlords
   *  there may not demand above 2-2.5x depending on rent level) — see
   *  clampIncomeMultiple in landlord-eval.ts. */
  min_income_multiple: number;
}

/**
 * THE FAIRNESS BOUNDARY. Every field an evaluation/ranking function is
 * allowed to see. No name, no free text, no nationality/religion/
 * disability/photo field of any kind exists on this type — a function
 * typed to accept only `ApplicantFacts` structurally cannot read the
 * narrative or identity even by accident, because the fields don't exist
 * here. See ApplicantIdentity and ApplicantNarrative below: kept as
 * separate types on purpose, never merged into this one.
 */
export interface ApplicantFacts {
  id: string;
  listingId: string;
  householdAdults: number;
  householdChildren: number;
  /** Cumulative resources, not wages alone — includes benefits (Wohngeld,
   *  Jobcenter/ALG) where applicable, per the DSK/Portland precedent that
   *  income shouldn't mean "wages only." */
  netIncomeMonthlyDeclared: number;
  employmentType: EmploymentType;
  smoker: boolean;
  documentsProvided: DocumentType[];
  /** From payslip document extraction, when provided — used only to flag a
   *  self-declared-vs-document mismatch as a "to check" item, never to
   *  penalize the applicant directly (a mismatch might be a genuine error
   *  on either side, not necessarily dishonesty). */
  payslipExtractedIncome: number | null;
  earliestMoveInDate: string;
  submittedAt: string;
  /** Alternative routes to satisfy the financial-security requirement,
   *  alongside income — a permanent contract is ONE way to look secure,
   *  not the only one. Each is an independent OR branch in
   *  evaluateApplicant; freelancers, students, and newcomers without a
   *  long employment history aren't structurally excluded just because
   *  they lack the one route a landlord happened to think of first. */
  hasGuarantor: boolean;
  hasDepositInsurance: boolean;
  savingsEur: number;
}

/** PII — used ONLY by findDuplicates() and a post-shortlist identity
 *  reveal, NEVER passed to evaluateApplicant/rankByReadiness. */
export interface ApplicantIdentity {
  id: string;
  fullName: string;
  dateOfBirth: string;
  email: string;
}

/** Free text — shown to the landlord for their own reading, optionally
 *  summarized by an LLM for clarity/completeness only, but never an input
 *  to evaluateApplicant or rankByReadiness. */
export interface ApplicantNarrative {
  id: string;
  text: string;
}

export interface RequirementCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface EvaluationResult {
  applicantId: string;
  meetsAllRequirements: boolean;
  checks: RequirementCheck[];
  /** Non-gating context, shown but never scored or ranked on. */
  shownNotScored: { label: string; value: string }[];
  /** Follow-up/verification items. Drives the readiness ranking among
   *  applicants who already meet every requirement — fewer open items
   *  means less remaining work for the landlord, not "a better tenant." */
  toCheck: string[];
  documentsCompleteCount: number;
  documentsRequiredCount: number;
}
