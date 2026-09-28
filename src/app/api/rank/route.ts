import { NextRequest, NextResponse } from "next/server";
import { FACTOR_KEYS } from "@/lib/rank";
import { findTopAlternatives, getPlanungsraumById, ratingsToWeights } from "@/lib/rank";
import { compareToCurrent } from "@/lib/compare";
import type { FactorWeights } from "@/lib/types";

/**
 * Steps 2-4: query the database, rank top-3 in different ZIP codes,
 * compare each to the user's current Kiez. Pure deterministic logic,
 * no LLM call in this route at all.
 *
 * POST body:
 *   { currentPlrId: string, ratings: Record<FactorKey, number> }  // ratings 1-5
 * Response:
 *   { current: PlanungsraumProfile, comparisons: KiezComparison[] }
 */
export async function POST(req: NextRequest) {
  let body: { currentPlrId?: string; ratings?: Partial<Record<keyof FactorWeights, number>> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { currentPlrId, ratings } = body;
  if (!currentPlrId) {
    return NextResponse.json({ error: "currentPlrId is required" }, { status: 400 });
  }

  const current = getPlanungsraumById(currentPlrId);
  if (!current) {
    return NextResponse.json({ error: `Unknown plr_id: ${currentPlrId}` }, { status: 404 });
  }

  // Fill any missing rating with 3 (neutral) rather than reject the request —
  // the frontend form should always send all 9, this is just a safety net.
  const fullRatings = {} as Record<keyof FactorWeights, number>;
  for (const key of FACTOR_KEYS) fullRatings[key] = ratings?.[key] ?? 3;
  const weights = ratingsToWeights(fullRatings);

  const alternatives = findTopAlternatives(currentPlrId, weights, 3);
  const comparisons = compareToCurrent(current, alternatives);

  return NextResponse.json({ current, weights, comparisons });
}
