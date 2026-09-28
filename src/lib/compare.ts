import type { PlanungsraumProfile, RankedResult, UserPreferences } from "./types";

export interface FactorDelta {
  factor: string;
  currentDisplay: string;
  alternativeDisplay: string;
  direction: "better" | "worse" | "same" | "unknown";
}

function fmtPrice(v: number | null): string {
  return v == null ? "unknown" : `€${v.toFixed(2)}/m²`;
}
function fmtBool(v: 0 | 1, label: string): string {
  return v ? `Yes (${label})` : "No";
}

function dir(altVal: number | null | undefined, curVal: number | null | undefined, higherIsBetter: boolean): FactorDelta["direction"] {
  if (altVal == null || curVal == null) return "unknown";
  if (altVal === curVal) return "same";
  const altBetter = higherIsBetter ? altVal > curVal : altVal < curVal;
  return altBetter ? "better" : "worse";
}

function ordinalDir(altVal: string | null, curVal: string | null, scale: Record<string, number>): FactorDelta["direction"] {
  if (altVal == null || curVal == null || !(altVal in scale) || !(curVal in scale)) return "unknown";
  return dir(scale[altVal], scale[curVal], true);
}

/** Human-readable comparison rows, current vs. one alternative — only for
 *  the criteria the user actually selected in the intake. A row for Kita,
 *  a hobby, etc. the user marked as not relevant would misleadingly imply
 *  it mattered to their ranking when it didn't filter or score anything. */
export function buildComparisonRows(
  current: PlanungsraumProfile,
  alt: PlanungsraumProfile,
  prefs: UserPreferences
): FactorDelta[] {
  const rows: FactorDelta[] = [];

  if (prefs.rentBudget !== "not_a_concern") {
    rows.push({
      factor: "Rent",
      currentDisplay: fmtPrice(current.rent_per_m2_kalt_avg_synthetic),
      alternativeDisplay: fmtPrice(alt.rent_per_m2_kalt_avg_synthetic),
      direction: dir(alt.rent_per_m2_kalt_avg_synthetic, current.rent_per_m2_kalt_avg_synthetic, false),
    });
  }

  if (prefs.noiseAirSensitive) {
    rows.push({
      factor: "Noise",
      currentDisplay: current.ug_laerm ?? "unknown",
      alternativeDisplay: alt.ug_laerm ?? "unknown",
      direction: ordinalDir(alt.ug_laerm, current.ug_laerm, { gering: 2, mittel: 1, hoch: 0 }),
    });
    rows.push({
      factor: "Air quality",
      currentDisplay: current.ug_luft ?? "unknown",
      alternativeDisplay: alt.ug_luft ?? "unknown",
      direction: ordinalDir(alt.ug_luft, current.ug_luft, { gering: 2, mittel: 1, hoch: 0 }),
    });
  }

  if (prefs.parksImportant) {
    rows.push({
      factor: "Green space / parks",
      currentDisplay: current.ug_gruenversorgung ?? "unknown",
      alternativeDisplay: alt.ug_gruenversorgung ?? "unknown",
      direction: ordinalDir(alt.ug_gruenversorgung, current.ug_gruenversorgung, { gut: 2, mittel: 1, schlecht: 0 }),
    });
  }

  if (prefs.kids.highSchool) {
    const grade = (p: PlanungsraumProfile) => p.abitur_mn_scls_plr_avg ?? p.abitur_mn_scls_bezirk_avg;
    rows.push({
      factor: "High school (Abitur avg. grade)",
      currentDisplay: grade(current)?.toFixed(2) ?? "unknown",
      alternativeDisplay: grade(alt)?.toFixed(2) ?? "unknown",
      direction: dir(grade(alt), grade(current), false), // lower grade = better
    });
  }

  if (prefs.kids.kita) {
    rows.push({
      factor: "Kita",
      currentDisplay: current.n_kitas > 0 ? `${current.n_kitas} nearby` : "None",
      alternativeDisplay: alt.n_kitas > 0 ? `${alt.n_kitas} nearby` : "None",
      direction: dir(alt.n_kitas, current.n_kitas, true),
    });
  }

  if (prefs.kids.kidDoctor) {
    rows.push({
      factor: "Kinderarzt",
      currentDisplay: fmtBool(current.has_kinderarzt_plz, "in ZIP code"),
      alternativeDisplay: fmtBool(alt.has_kinderarzt_plz, "in ZIP code"),
      direction: dir(alt.has_kinderarzt_plz, current.has_kinderarzt_plz, true),
    });
  }

  if (prefs.hobbies.yoga) {
    rows.push({
      factor: "Yoga studio",
      currentDisplay: fmtBool(current.has_yoga_studios_plz, "in ZIP code"),
      alternativeDisplay: fmtBool(alt.has_yoga_studios_plz, "in ZIP code"),
      direction: dir(alt.has_yoga_studios_plz, current.has_yoga_studios_plz, true),
    });
  }
  if (prefs.hobbies.gym) {
    rows.push({
      factor: "Gym",
      currentDisplay: fmtBool(current.has_gym_plz, "in ZIP code"),
      alternativeDisplay: fmtBool(alt.has_gym_plz, "in ZIP code"),
      direction: dir(alt.has_gym_plz, current.has_gym_plz, true),
    });
  }
  if (prefs.hobbies.bouldering) {
    rows.push({
      factor: "Bouldering",
      currentDisplay: fmtBool(current.has_bouldering_plz, "in ZIP code"),
      alternativeDisplay: fmtBool(alt.has_bouldering_plz, "in ZIP code"),
      direction: dir(alt.has_bouldering_plz, current.has_bouldering_plz, true),
    });
  }

  return rows;
}

export interface KiezComparison {
  current: PlanungsraumProfile;
  alternative: RankedResult;
  rows: FactorDelta[];
}

export function compareToCurrent(
  current: PlanungsraumProfile,
  alternatives: RankedResult[],
  prefs: UserPreferences
): KiezComparison[] {
  return alternatives.map((alt) => ({
    current,
    alternative: alt,
    rows: buildComparisonRows(current, alt.plr, prefs),
  }));
}
