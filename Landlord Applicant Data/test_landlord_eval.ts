/**
 * Run with: npx tsx "Landlord Applicant Data/test_landlord_eval.ts"
 * No test framework is in package.json yet — this follows the project's
 * existing convention of small assert-based tsx scripts for verification.
 */
import { evaluateApplicant, rankByReadiness, findDuplicates, anonymizedLabel } from "../src/lib/landlord-eval";
import { redactNameFromText } from "../src/lib/redact-name";
import type { ApplicantFacts, ApplicantIdentity, Listing } from "../src/lib/landlord-types";

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

const listing: Listing = {
  id: "L001",
  address: "Test Str. 1",
  ortsteil: "Testkiez",
  area_m2: 70,
  rooms: 3,
  kaltmiete_eur_monthly: 1000,
  warmmiete_eur_monthly: 1300,
  move_in_date: "2026-12-01",
  smoking_policy: "non_smoking_only",
  required_documents: ["identity", "payslips", "schufa", "mietschuldenfreiheit"],
  min_income_multiple: 3,
};

function baseFacts(overrides: Partial<ApplicantFacts> = {}): ApplicantFacts {
  return {
    id: "T001",
    listingId: "L001",
    householdAdults: 2,
    householdChildren: 1,
    netIncomeMonthlyDeclared: 3000,
    employmentType: "permanent",
    hasGuarantor: false,
    hasDepositInsurance: false,
    savingsEur: 0,
    smoker: false,
    documentsProvided: ["identity", "payslips", "schufa", "mietschuldenfreiheit"],
    payslipExtractedIncome: 3000,
    earliestMoveInDate: "2026-11-01",
    submittedAt: "2026-09-01",
    ...overrides,
  };
}

// --- Affordability edge cases ---
assert(evaluateApplicant(baseFacts({ netIncomeMonthlyDeclared: 3000 }), listing).meetsAllRequirements, "exactly at 3x threshold passes");
assert(!evaluateApplicant(baseFacts({ netIncomeMonthlyDeclared: 2999 }), listing).meetsAllRequirements, "just below 3x threshold fails");
assert(evaluateApplicant(baseFacts({ netIncomeMonthlyDeclared: 3001 }), listing).meetsAllRequirements, "just above 3x threshold passes");

// --- Alternate financial-security routes (income isn't the only path) ---
const lowIncome = { netIncomeMonthlyDeclared: 500 }; // fails income outright
assert(!evaluateApplicant(baseFacts(lowIncome), listing).meetsAllRequirements, "low income with no alternate route fails");
assert(
  evaluateApplicant(baseFacts({ ...lowIncome, hasGuarantor: true }), listing).meetsAllRequirements,
  "low income + guarantor passes via the guarantor route"
);
assert(
  evaluateApplicant(baseFacts({ ...lowIncome, hasDepositInsurance: true }), listing).meetsAllRequirements,
  "low income + deposit insurance passes"
);
assert(
  evaluateApplicant(baseFacts({ ...lowIncome, savingsEur: listing.warmmiete_eur_monthly * 3 }), listing).meetsAllRequirements,
  "low income + 3x warm rent in savings passes"
);
assert(
  !evaluateApplicant(baseFacts({ ...lowIncome, savingsEur: listing.warmmiete_eur_monthly * 2 }), listing).meetsAllRequirements,
  "savings below the 3x threshold don't rescue a low-income applicant"
);

// --- Income multiple is clamped (Portland-style cap) ---
const uncappedListing: Listing = { ...listing, min_income_multiple: 5 };
assert(
  evaluateApplicant(baseFacts({ netIncomeMonthlyDeclared: 3000 }), uncappedListing).meetsAllRequirements,
  "a listing set to demand 5x rent is clamped down to 3x, so 3x income still passes"
);

// --- Documents ---
assert(
  !evaluateApplicant(baseFacts({ documentsProvided: ["identity", "payslips", "schufa"] }), listing).meetsAllRequirements,
  "missing one required document fails"
);
assert(
  evaluateApplicant(baseFacts({ documentsProvided: ["identity", "payslips", "schufa", "mietschuldenfreiheit", "employment_contract"] }), listing)
    .meetsAllRequirements,
  "extra optional document doesn't hurt"
);

// --- Move-in date ---
assert(!evaluateApplicant(baseFacts({ earliestMoveInDate: "2027-01-01" }), listing).meetsAllRequirements, "too-late move-in fails");
assert(evaluateApplicant(baseFacts({ earliestMoveInDate: "2026-12-01" }), listing).meetsAllRequirements, "exact move-in date passes");

// --- Smoking gate is policy-dependent ---
assert(!evaluateApplicant(baseFacts({ smoker: true }), listing).meetsAllRequirements, "smoker fails a non-smoking-only listing");
const noPreferenceListing: Listing = { ...listing, smoking_policy: "no_preference" };
assert(evaluateApplicant(baseFacts({ smoker: true }), noPreferenceListing).meetsAllRequirements, "smoker passes a no-preference listing");

// --- Income mismatch surfaces as a to-check item, not a hard fail ---
const mismatch = evaluateApplicant(baseFacts({ netIncomeMonthlyDeclared: 3500, payslipExtractedIncome: 3000 }), listing);
assert(mismatch.meetsAllRequirements, "income mismatch doesn't itself fail the requirement gate");
assert(mismatch.toCheck.some((t) => t.includes("payslip-extracted")), "income mismatch is flagged as a to-check item");

// --- rankByReadiness ---
const readyClean = evaluateApplicant(baseFacts({ id: "clean" }), listing);
const readyWithFlag = evaluateApplicant(baseFacts({ id: "flagged", employmentType: "selfemployed" }), listing);
const notQualifying = evaluateApplicant(baseFacts({ id: "unqualified", netIncomeMonthlyDeclared: 100 }), listing);
const ranked = rankByReadiness([readyWithFlag, readyClean, notQualifying]);
assert(ranked.length === 2, "rankByReadiness excludes non-qualifying applicants");
assert(ranked[0].applicantId === "clean", "cleanest application (fewest to-check items) ranks first");

// --- findDuplicates ---
const identities: ApplicantIdentity[] = [
  { id: "a1", fullName: "Anna Müller", dateOfBirth: "1990-01-01", email: "a@x.com" },
  { id: "a2", fullName: "anna   müller", dateOfBirth: "1990-01-01", email: "a2@x.com" }, // same person, re-applied
  { id: "b1", fullName: "Anna Müller", dateOfBirth: "1985-05-05", email: "b@x.com" }, // different person, same name
];
const dupes = findDuplicates(identities);
assert(dupes.length === 1, "exactly one duplicate group found");
assert(dupes[0].applicantIds.sort().join(",") === "a1,a2", "duplicate group contains the two matching re-applications, not the different person");

// --- anonymizedLabel sequence ---
assert(anonymizedLabel(0) === "Applicant A", "index 0 -> A");
assert(anonymizedLabel(25) === "Applicant Z", "index 25 -> Z");
assert(anonymizedLabel(26) === "Applicant AA", "index 26 -> AA");

// --- redactNameFromText ---
assert(
  redactNameFromText("Hi, I'm Ahmed and I work in tech.", "Ahmed Hassan") === "Hi, I'm [name] and I work in tech.",
  "first name is redacted"
);
assert(
  redactNameFromText("Best regards, Ahmed Hassan", "Ahmed Hassan") === "Best regards, [name]",
  "full name redacts as one unit, not as two separate replacements"
);
assert(
  redactNameFromText("No name mentioned here at all.", "Ahmed Hassan") === "No name mentioned here at all.",
  "text without the name is unchanged"
);
assert(
  redactNameFromText("I love hassan-style architecture.", "Anna Hassan").includes("[name]"),
  "case-insensitive match still redacts"
);

// --- Compile-time fairness boundary proof ---
// If this line does NOT produce a type error, the boundary has been
// weakened (e.g. ApplicantFacts gained a stray field) and this cast would
// need updating — that failure mode is itself the point: it forces a
// human to notice before merging.
// @ts-expect-error narrative/name fields don't exist on ApplicantFacts — this must fail to type-check
evaluateApplicant({ ...baseFacts(), narrative: "I am a wonderful tenant", fullName: "Leaked Name" }, listing);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
