import { NextRequest, NextResponse } from "next/server";
import {
  getListingById,
  getApplicantFactsForListing,
  getApplicantFactsById,
  getApplicantNarrative,
  getAllApplicantIdentities,
} from "@/lib/landlord-data";
import { evaluateApplicant, rankByReadiness, findDuplicates, anonymizedLabel } from "@/lib/landlord-eval";
import { DOCUMENT_LABELS } from "@/lib/landlord-types";

/**
 * GET /api/landlord/applicants/:id — screen 3 (shortlist detail card).
 * Recomputes the same listing-wide dedup + evaluation as
 * /api/landlord/dashboard so this applicant's anonLabel and "recommended"
 * status stay consistent with the dashboard list — no separate source of
 * truth to drift out of sync.
 *
 * `narrative` is returned as its own top-level field, clearly separate from
 * `positiveFactors`/`toCheck` (which come only from evaluateApplicant, which
 * never receives the narrative) — the frontend should label it "not used
 * in scoring" per screen 1's own copy.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const facts = getApplicantFactsById(id);
  if (!facts) return NextResponse.json({ error: `Unknown applicant id: ${id}` }, { status: 404 });

  const listing = getListingById(facts.listingId);
  if (!listing) return NextResponse.json({ error: `Unknown listingId: ${facts.listingId}` }, { status: 404 });

  const allIdentities = getAllApplicantIdentities();
  const duplicateGroups = findDuplicates(allIdentities);
  const duplicateIdToCanonical = new Map<string, string>();
  const duplicateGroupOf = new Map<string, string[]>();
  for (const group of duplicateGroups) {
    const sorted = [...group.applicantIds].sort();
    for (const gid of sorted) {
      duplicateIdToCanonical.set(gid, sorted[0]);
      duplicateGroupOf.set(gid, sorted);
    }
  }

  const listingFacts = getApplicantFactsForListing(facts.listingId);
  const seenCanonical = new Set<string>();
  const dedupedFacts = listingFacts.filter((f) => {
    const canonical = duplicateIdToCanonical.get(f.id) ?? f.id;
    if (seenCanonical.has(canonical)) return false;
    seenCanonical.add(canonical);
    return true;
  });

  const canonicalId = duplicateIdToCanonical.get(facts.id) ?? facts.id;
  const canonicalFacts = dedupedFacts.find((f) => f.id === canonicalId) ?? facts;
  const evaluations = dedupedFacts.map((f) => evaluateApplicant(f, listing));
  const evaluation = evaluations.find((e) => e.applicantId === canonicalFacts.id)!;
  const recommended = rankByReadiness(evaluations).slice(0, 3);
  const anonLabel = anonymizedLabel(dedupedFacts.findIndex((f) => f.id === canonicalFacts.id));

  const positiveFactors = [
    ...evaluation.checks.filter((c) => c.passed).map((c) => c.detail),
    ...evaluation.shownNotScored.map((s) => `${s.label}: ${s.value}`),
  ];
  if (canonicalFacts.documentsProvided.includes("mietschuldenfreiheit")) {
    positiveFactors.push(`${DOCUMENT_LABELS.mietschuldenfreiheit} provided.`);
  }
  const hasIncomeMismatchFlag = evaluation.toCheck.some((t) => t.includes("payslip-extracted"));
  if (!hasIncomeMismatchFlag) positiveFactors.push("No inconsistencies detected between declared and document data.");

  const otherApplications = (duplicateGroupOf.get(facts.id) ?? [facts.id]).filter((gid) => gid !== canonicalFacts.id);

  const narrative = getApplicantNarrative(canonicalFacts.id);

  return NextResponse.json({
    anonLabel,
    listingId: listing.id,
    meetsAllRequirements: evaluation.meetsAllRequirements,
    isRecommended: recommended.some((r) => r.applicantId === canonicalFacts.id),
    positiveFactors,
    toCheck: evaluation.toCheck,
    checks: evaluation.checks,
    shownNotScored: evaluation.shownNotScored,
    otherApplicationIds: otherApplications, // duplicate/re-application flag — no names, just internal ids
    narrative: narrative
      ? { text: narrative.text, note: "Shown for context only — never used in scoring or ranking." }
      : null,
  });
}
