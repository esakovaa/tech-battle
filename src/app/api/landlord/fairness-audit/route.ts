import { NextRequest, NextResponse } from "next/server";
import { getListingById } from "@/lib/landlord-data";
import { auditListingFairness } from "@/lib/fairness-audit-core";
import type { Listing } from "@/lib/landlord-types";

/**
 * POST /api/landlord/fairness-audit — the "run it live" version of
 * "Landlord Applicant Data/fairness_audit.ts". Body: { listingId,
 * overrides? }. Runs the real evaluateApplicant() against the synthetic
 * cohort grouped by ground-truth narrative tags (which evaluateApplicant
 * never sees) and reports whether pass rates differ beyond sampling
 * noise, plus the prompt-injection applicant's result. Meant to be called
 * from a "Run fairness audit" button on the dashboard — a judge should be
 * able to trigger this themselves, not just read a saved log file.
 */
export async function POST(req: NextRequest) {
  let body: { listingId?: string; overrides?: Partial<Listing> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.listingId) return NextResponse.json({ error: "listingId is required" }, { status: 400 });

  const baseListing = getListingById(body.listingId);
  if (!baseListing) return NextResponse.json({ error: `Unknown listingId: ${body.listingId}` }, { status: 404 });
  const listing: Listing = { ...baseListing, ...body.overrides };

  const result = auditListingFairness(body.listingId, listing);
  return NextResponse.json(result);
}
