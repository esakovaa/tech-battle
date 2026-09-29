import { getListingById, getApplicantFactsForListing, getAllApplicantIdentities } from "./landlord-data";
import { evaluateApplicant, findDuplicates } from "./landlord-eval";
import type { EvaluationResult, Listing } from "./landlord-types";

/**
 * The dedup + evaluate pipeline every landlord-facing route needs — pulled
 * out once so /api/landlord/dashboard, /api/landlord/applicants/:id, and
 * /api/landlord/lottery/commit can't quietly drift out of sync with each
 * other on how duplicates are resolved or which listing overrides apply.
 */
export interface ListingQueryResult {
  listing: Listing;
  /** One row per real person (duplicates already resolved to the earliest
   *  submission's canonical id). */
  evaluations: EvaluationResult[];
  rawApplicationCount: number;
  duplicatesMerged: number;
}

export function evaluateListing(listingId: string, overrides?: Partial<Listing>): ListingQueryResult | null {
  const baseListing = getListingById(listingId);
  if (!baseListing) return null;
  const listing: Listing = { ...baseListing, ...overrides };

  const facts = getApplicantFactsForListing(listingId);
  const rawApplicationCount = facts.length;

  // Dedup across the WHOLE applicant pool (every listing) — re-application
  // across listings is exactly the brief's concern, not just within one.
  const allIdentities = getAllApplicantIdentities();
  const duplicateGroups = findDuplicates(allIdentities);
  const duplicateIdToCanonical = new Map<string, string>();
  for (const group of duplicateGroups) {
    const sorted = [...group.applicantIds].sort();
    for (const id of sorted) duplicateIdToCanonical.set(id, sorted[0]);
  }

  const seenCanonical = new Set<string>();
  const dedupedFacts = facts.filter((f) => {
    const canonical = duplicateIdToCanonical.get(f.id) ?? f.id;
    if (seenCanonical.has(canonical)) return false;
    seenCanonical.add(canonical);
    return true;
  });

  return {
    listing,
    evaluations: dedupedFacts.map((f) => evaluateApplicant(f, listing)),
    rawApplicationCount,
    duplicatesMerged: rawApplicationCount - dedupedFacts.length,
  };
}
