import { NextRequest, NextResponse } from "next/server";
import { revealLottery, sha256Hex } from "@/lib/landlord-lottery";
import { getApplicantFactsById } from "@/lib/landlord-data";
import { anonymizedLabel } from "@/lib/landlord-eval";

/**
 * POST /api/landlord/lottery/reveal — step 2. Body: { seedHash,
 * shortlistSize? }. Reveals the seed committed to that hash and performs
 * the draw. The response includes `verification`, a plain-language
 * description of exactly how to check it wasn't rigged: recompute
 * sha256(seed) yourself and confirm it matches seedHash you already had.
 */
export async function POST(req: NextRequest) {
  let body: { seedHash?: string; shortlistSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.seedHash) return NextResponse.json({ error: "seedHash is required" }, { status: 400 });

  const reveal = revealLottery(body.seedHash, body.shortlistSize ?? 10);
  if (!reveal) {
    return NextResponse.json(
      { error: "Unknown seedHash — call /api/landlord/lottery/commit first (commitments are in-memory and reset on server restart)." },
      { status: 404 }
    );
  }

  const recomputedHash = sha256Hex(reveal.seed);
  const anonLabelById = new Map(reveal.qualifyingApplicantIds.map((id, i) => [id, anonymizedLabel(i)]));

  const drawn = reveal.drawnApplicantIds.map((id, i) => {
    const facts = getApplicantFactsById(id);
    return {
      drawPosition: i + 1,
      applicantId: id,
      anonLabel: anonLabelById.get(id),
      household: facts ? `${facts.householdAdults} adult(s), ${facts.householdChildren} child(ren)` : undefined,
    };
  });

  return NextResponse.json({
    seed: reveal.seed,
    seedHash: reveal.seedHash,
    hashMatchesCommitment: recomputedHash === reveal.seedHash,
    poolSize: reveal.qualifyingApplicantIds.length,
    drawn,
    verification: reveal.verification,
  });
}
