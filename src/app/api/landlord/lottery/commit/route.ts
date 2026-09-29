import { NextRequest, NextResponse } from "next/server";
import { evaluateListing } from "@/lib/landlord-query";
import { commitLottery } from "@/lib/landlord-lottery";
import type { Listing } from "@/lib/landlord-types";

/**
 * POST /api/landlord/lottery/commit — step 1 of the verifiable lottery.
 * Body: { listingId, overrides? }. Computes who qualifies (same
 * REQUIRED-gate logic as the dashboard), generates a random seed, and
 * returns ONLY its SHA-256 hash — the seed itself is not revealed yet.
 * This is the "publish the hash before drawing" half of a commit-reveal
 * scheme: whoever calls /reveal afterwards gets a seed that provably
 * existed before the draw could have been computed, because its hash was
 * already fixed here.
 */
export async function POST(req: NextRequest) {
  let body: { listingId?: string; overrides?: Partial<Listing> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.listingId) return NextResponse.json({ error: "listingId is required" }, { status: 400 });

  const result = evaluateListing(body.listingId, body.overrides);
  if (!result) return NextResponse.json({ error: `Unknown listingId: ${body.listingId}` }, { status: 404 });

  const qualifyingIds = result.evaluations.filter((e) => e.meetsAllRequirements).map((e) => e.applicantId);
  const { seedHash, poolSize } = commitLottery(body.listingId, qualifyingIds);

  return NextResponse.json({
    seedHash,
    poolSize,
    note: "This hash is committed now, before the draw. Call /api/landlord/lottery/reveal with it to draw and get a seed you can independently verify against this hash.",
  });
}
