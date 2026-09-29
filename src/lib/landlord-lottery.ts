import { randomBytes, createHash } from "crypto";

/**
 * Verifiable commit-reveal lottery. Two-step so the commitment is real:
 * 1. commitLottery() generates a random seed, hashes it, and returns ONLY
 *    the hash — this is what a landlord would publish before drawing.
 * 2. revealLottery() takes that hash, looks up the seed that was
 *    committed to it, and performs the draw. Anyone holding the revealed
 *    seed can independently recompute sha256(seed) and confirm it matches
 *    the hash that was published first — the draw couldn't have been
 *    picked after the fact to favor anyone, because the pool and the
 *    seed were both fixed before the draw order was computable.
 *
 * Draw order itself: sort the qualifying pool by sha256(seed + ":" + id),
 * ascending. This is a standard "seeded random sort" — simpler to verify
 * by hand than a shuffle algorithm (anyone can recompute each applicant's
 * hash and confirm the sort), and every applicant's position depends on
 * every character of the seed, so there's no way to nudge one specific
 * person's placement without changing everyone else's too.
 *
 * Storage: in-memory, keyed by seedHash. Fine for a prototype/demo; a
 * production version would persist commitments (with a timestamp) so a
 * restart can't silently discard an already-published commitment.
 */

interface Commitment {
  seed: string;
  qualifyingApplicantIds: string[];
  listingId: string;
  committedAt: string;
}

const commitments = new Map<string, Commitment>();

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function commitLottery(listingId: string, qualifyingApplicantIds: string[]): { seedHash: string; poolSize: number } {
  const seed = randomBytes(32).toString("hex");
  const seedHash = sha256Hex(seed);
  commitments.set(seedHash, {
    seed,
    qualifyingApplicantIds: [...qualifyingApplicantIds].sort(), // fixed, order-independent pool
    listingId,
    committedAt: new Date().toISOString(),
  });
  return { seedHash, poolSize: qualifyingApplicantIds.length };
}

export interface LotteryReveal {
  seed: string;
  seedHash: string;
  listingId: string;
  qualifyingApplicantIds: string[];
  drawOrder: string[]; // every qualifying id, in full draw order
  drawnApplicantIds: string[]; // the requested shortlist size, drawOrder's prefix
  verification: string;
}

/** Deterministic given (seed, ids) — same inputs always produce the same
 *  order, which is exactly what makes it independently checkable. */
export function rankBySeed(seed: string, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ha = sha256Hex(`${seed}:${a}`);
    const hb = sha256Hex(`${seed}:${b}`);
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

export function revealLottery(seedHash: string, shortlistSize: number): LotteryReveal | null {
  const commitment = commitments.get(seedHash);
  if (!commitment) return null;
  const drawOrder = rankBySeed(commitment.seed, commitment.qualifyingApplicantIds);
  return {
    seed: commitment.seed,
    seedHash,
    listingId: commitment.listingId,
    qualifyingApplicantIds: commitment.qualifyingApplicantIds,
    drawOrder,
    drawnApplicantIds: drawOrder.slice(0, shortlistSize),
    verification:
      `Recompute sha256("${commitment.seed}") and confirm it equals ${seedHash} — ` +
      `that proves this seed is the one committed to before the draw. Then recompute ` +
      `sha256(seed + ":" + applicantId) for each qualifying id and confirm the sort order matches drawOrder.`,
  };
}
