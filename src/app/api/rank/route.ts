import { NextRequest, NextResponse } from "next/server";
import { findTopAlternatives, getPlanungsraumById, PRIMARY_SCHOOL_DATA_AVAILABLE } from "@/lib/rank";
import { resolveAddressToPlanungsraum } from "@/lib/geocode";
import { compareToCurrent } from "@/lib/compare";
import type { UserPreferences } from "@/lib/types";

/**
 * Steps 2-4: resolve the user's current Kiez (geocoding an address if a
 * plr_id wasn't already resolved client-side), filter with graceful
 * degradation, score, rank top-3 in different ZIP codes, compare each to
 * the current Kiez. Deterministic, no LLM call in this route.
 *
 * POST body: Partial<UserPreferences> with either currentPlrId or
 * currentAddress set.
 */
export async function POST(req: NextRequest) {
  let body: Partial<UserPreferences>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.currentPlrId && !body.currentAddress) {
    return NextResponse.json({ error: "Either currentPlrId or currentAddress is required" }, { status: 400 });
  }

  let currentPlrId = body.currentPlrId;
  if (!currentPlrId && body.currentAddress) {
    const resolved = await resolveAddressToPlanungsraum(body.currentAddress);
    if (!resolved) {
      return NextResponse.json(
        { error: `Could not resolve "${body.currentAddress}" to a Berlin Planungsraum` },
        { status: 404 }
      );
    }
    currentPlrId = resolved.plr_id;
  }

  const current = getPlanungsraumById(currentPlrId!);
  if (!current) {
    return NextResponse.json({ error: `Unknown plr_id: ${currentPlrId}` }, { status: 404 });
  }

  // Sensible defaults for anything the frontend didn't send — every field
  // defaults to "not selected" rather than rejecting an incomplete request.
  const prefs: UserPreferences = {
    currentPlrId,
    kids: {
      kita: body.kids?.kita ?? false,
      primarySchool: body.kids?.primarySchool ?? false,
      highSchool: body.kids?.highSchool ?? false,
      kidDoctor: body.kids?.kidDoctor ?? false,
    },
    rentBudget: body.rentBudget ?? "flexible",
    noiseAirSensitive: body.noiseAirSensitive ?? false,
    parksImportant: body.parksImportant ?? false,
    hobbies: {
      yoga: body.hobbies?.yoga ?? false,
      gym: body.hobbies?.gym ?? false,
      bouldering: body.hobbies?.bouldering ?? false,
    },
  };

  const { results, secondBest, droppedFilters } = findTopAlternatives(currentPlrId!, prefs, 3);
  const comparisons = compareToCurrent(current, results);

  return NextResponse.json({
    current,
    comparisons,
    secondBest,
    droppedFilters,
    primarySchoolDataAvailable: PRIMARY_SCHOOL_DATA_AVAILABLE,
    primarySchoolNote: prefs.kids.primarySchool
      ? "Primary school quality/presence data isn't available yet — this criterion wasn't used to filter or rank results."
      : undefined,
  });
}
