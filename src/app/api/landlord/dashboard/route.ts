import { NextRequest, NextResponse } from "next/server";
import { getListingById, getApplicantFactsForListing, getAllApplicantIdentities } from "@/lib/landlord-data";
import { evaluateApplicant, rankByReadiness, findDuplicates, anonymizedLabel } from "@/lib/landlord-eval";
import { EMPLOYMENT_LABELS } from "@/lib/landlord-types";
import type { Listing } from "@/lib/landlord-types";

/**
 * POST /api/landlord/dashboard — screen 2 ("527 applications. Here's where
 * they stand."). Body: { listingId, overrides? }. `overrides` lets the
 * landlord's "Tell us about the flat" form (screen 1) actually change the
 * evaluation — e.g. a different min_income_multiple, required_documents,
 * smoking_policy, or move_in_date than the stored demo listing — without
 * needing a real database to persist listing edits for this prototype.
 *
 * Response never includes an applicant's real name, date of birth, email,
 * or narrative text — see anonymizedLabel/ApplicantIdentity in
 * lib/landlord-eval.ts and lib/landlord-types.ts for why.
 */
export async function POST(req: NextRequest) {
  let body: { listingId?: string; overrides?: Partial<Listing> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.listingId) {
    return NextResponse.json({ error: "listingId is required" }, { status: 400 });
  }

  const baseListing = getListingById(body.listingId);
  if (!baseListing) {
    return NextResponse.json({ error: `Unknown listingId: ${body.listingId}` }, { status: 404 });
  }
  const listing: Listing = { ...baseListing, ...body.overrides };

  const facts = getApplicantFactsForListing(body.listingId);
  const rawCount = facts.length;

  // Dedup across the WHOLE applicant pool (every listing), since the
  // brief's concern is re-application across listings, not just this one —
  // then keep only this listing's earliest-submission-per-person facts.
  const allIdentities = getAllApplicantIdentities();
  const duplicateGroups = findDuplicates(allIdentities);
  const duplicateIdToCanonical = new Map<string, string>();
  for (const group of duplicateGroups) {
    const sorted = [...group.applicantIds].sort(); // ids are chronological (Axxxx) within a listing; cross-listing ties broken arbitrarily but deterministically
    const canonical = sorted[0];
    for (const id of sorted) duplicateIdToCanonical.set(id, canonical);
  }

  const seenCanonical = new Set<string>();
  const dedupedFacts = facts.filter((f) => {
    const canonical = duplicateIdToCanonical.get(f.id) ?? f.id;
    if (seenCanonical.has(canonical)) return false;
    seenCanonical.add(canonical);
    return true;
  });
  const duplicatesMerged = rawCount - dedupedFacts.length;

  const evaluations = dedupedFacts.map((f) => evaluateApplicant(f, listing));

  const meetsRequirements = evaluations.filter((e) => e.meetsAllRequirements);
  const needsCheck = evaluations.filter(
    (e) => !e.meetsAllRequirements && e.checks.every((c) => c.passed || c.key === "documents")
  );
  const doesNotMeet = evaluations.filter(
    (e) => !e.meetsAllRequirements && e.checks.some((c) => !c.passed && c.key !== "documents")
  );
  const recommended = rankByReadiness(evaluations).slice(0, 3);

  const factsById = new Map(dedupedFacts.map((f) => [f.id, f]));
  const anonLabelById = new Map(dedupedFacts.map((f, i) => [f.id, anonymizedLabel(i)]));

  function toRow(e: (typeof evaluations)[number]) {
    const f = factsById.get(e.applicantId)!;
    const incomeMultiple = f.netIncomeMonthlyDeclared / listing.kaltmiete_eur_monthly;
    return {
      id: e.applicantId,
      anonLabel: anonLabelById.get(e.applicantId),
      household: e.shownNotScored.find((s) => s.label === "Household")?.value,
      incomeToRentRatio: `${incomeMultiple.toFixed(1)}×`,
      employment: EMPLOYMENT_LABELS[f.employmentType],
      documents: `${e.documentsCompleteCount} of ${e.documentsRequiredCount}`,
      meetsAllRequirements: e.meetsAllRequirements,
      status: e.meetsAllRequirements ? "Meets all criteria" : "Needs a check",
    };
  }

  return NextResponse.json({
    listing,
    stats: {
      applicationsReceived: rawCount,
      duplicatesMerged,
      meetsRequirementsCount: meetsRequirements.length,
      needsCheckCount: needsCheck.length,
      doesNotMeetCount: doesNotMeet.length,
    },
    tabs: {
      recommended: recommended.map(toRow),
      meetsRequirements: meetsRequirements.map(toRow),
      needsCheck: needsCheck.map(toRow),
      all: evaluations.map(toRow),
    },
  });
}
