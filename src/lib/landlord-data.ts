import listingsData from "@/data/landlord_listings.json";
import applicantsData from "@/data/landlord_applicants.json";
import type { ApplicantFacts, ApplicantIdentity, ApplicantNarrative, DocumentType, EmploymentType, Listing } from "./landlord-types";

interface RawApplicant {
  id: string;
  listing_id: string;
  full_name: string;
  date_of_birth: string;
  email: string;
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
  narrative: string;
}

const RAW_LISTINGS = listingsData as unknown as Listing[];
const RAW_APPLICANTS = applicantsData as unknown as RawApplicant[];

export function getAllListings(): Listing[] {
  return RAW_LISTINGS;
}

export function getListingById(id: string): Listing | undefined {
  return RAW_LISTINGS.find((l) => l.id === id);
}

/** Splits the raw record into the three fairness-boundary types on the way
 *  in — nothing downstream ever reconstructs the merged shape. */
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
function toIdentity(a: RawApplicant): ApplicantIdentity {
  return { id: a.id, fullName: a.full_name, dateOfBirth: a.date_of_birth, email: a.email };
}
function toNarrative(a: RawApplicant): ApplicantNarrative {
  return { id: a.id, text: a.narrative };
}

export function getApplicantFactsForListing(listingId: string): ApplicantFacts[] {
  return RAW_APPLICANTS.filter((a) => a.listing_id === listingId).map(toFacts);
}
export function getApplicantIdentitiesForListing(listingId: string): ApplicantIdentity[] {
  return RAW_APPLICANTS.filter((a) => a.listing_id === listingId).map(toIdentity);
}
/** All identities across every listing — duplicate detection needs the
 *  whole pool, since the brief's concern is re-application ACROSS listings. */
export function getAllApplicantIdentities(): ApplicantIdentity[] {
  return RAW_APPLICANTS.map(toIdentity);
}
export function getApplicantNarrative(applicantId: string): ApplicantNarrative | undefined {
  const found = RAW_APPLICANTS.find((a) => a.id === applicantId);
  return found ? toNarrative(found) : undefined;
}
export function getApplicantFactsById(applicantId: string): ApplicantFacts | undefined {
  const found = RAW_APPLICANTS.find((a) => a.id === applicantId);
  return found ? toFacts(found) : undefined;
}
/** Used ONLY to redact the applicant's own name out of their narrative
 *  before it's shown to a landlord — see lib/redact-name.ts. Never passed
 *  to evaluateApplicant, never returned to a landlord-facing response. */
export function getApplicantIdentityById(applicantId: string): ApplicantIdentity | undefined {
  const found = RAW_APPLICANTS.find((a) => a.id === applicantId);
  return found ? toIdentity(found) : undefined;
}
