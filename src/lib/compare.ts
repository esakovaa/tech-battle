import type { PlanungsraumProfile, RankedResult } from "./types";

export interface FactorDelta {
  factor: string;
  currentDisplay: string;
  alternativeDisplay: string;
  /** "better" | "worse" | "same" | "unknown" — direction-corrected, so
   *  "better" always means better for the user, regardless of which raw
   *  column direction that corresponds to. */
  direction: "better" | "worse" | "same" | "unknown";
}

function fmtPrice(v: number | null): string {
  return v == null ? "unknown" : `€${v.toFixed(2)}/m²`;
}
function fmtPct(v: number): string {
  return `${v.toFixed(0)}%`;
}
function fmtKm(v: number | null): string {
  return v == null ? "unknown" : `${(v * 1000).toFixed(0)}m`;
}

/** One row per factor, current vs. alternative, in plain display terms —
 *  not the normalized 0-1 scores, actual values a person can read. */
export function buildComparisonRows(current: PlanungsraumProfile, alt: PlanungsraumProfile): FactorDelta[] {
  const rows: FactorDelta[] = [];

  const price = (p: PlanungsraumProfile) => p.rent_per_m2_kalt_avg_synthetic;
  rows.push({
    factor: "Rent",
    currentDisplay: fmtPrice(price(current)),
    alternativeDisplay: fmtPrice(price(alt)),
    direction: dir(price(alt), price(current), false),
  });

  rows.push({
    factor: "Location quality (Wohnlage gut)",
    currentDisplay: fmtPct(current.pct_wohnlage_gut),
    alternativeDisplay: fmtPct(alt.pct_wohnlage_gut),
    direction: dir(alt.pct_wohnlage_gut, current.pct_wohnlage_gut, true),
  });

  rows.push({
    factor: "Green space",
    currentDisplay: current.ug_gruenversorgung ?? "unknown",
    alternativeDisplay: alt.ug_gruenversorgung ?? "unknown",
    direction: ordinalDir(alt.ug_gruenversorgung, current.ug_gruenversorgung, { gut: 2, mittel: 1, schlecht: 0 }),
  });

  rows.push({
    factor: "Noise/air/heat burden (combined)",
    currentDisplay: current.ug_mehrfachbelastung_umwelt ?? "unknown",
    alternativeDisplay: alt.ug_mehrfachbelastung_umwelt ?? "unknown",
    // "how many burden criteria stack up" scale, not gering/mittel/hoch —
    // verified against actual data, see rank.ts's MEHRFACH_SCALE.
    direction: ordinalDir(alt.ug_mehrfachbelastung_umwelt, current.ug_mehrfachbelastung_umwelt, {
      "keine starke Belastung": 4,
      einfach: 3,
      zweifach: 2,
      dreifach: 1,
      vierfach: 0,
    }),
  });

  const safetyRate = (p: PlanungsraumProfile) => (p.crime_total_avg_2017_2019 ?? 0) / p.n_addresses;
  rows.push({
    factor: "Safety (Bezirk-level, crime/address)",
    currentDisplay: safetyRate(current).toFixed(1),
    alternativeDisplay: safetyRate(alt).toFixed(1),
    direction: dir(safetyRate(alt), safetyRate(current), false),
  });

  const grade = (p: PlanungsraumProfile) => p.abitur_mn_scls_plr_avg ?? p.abitur_mn_scls_bezirk_avg;
  rows.push({
    factor: "Schools (Abitur avg. grade)",
    currentDisplay: grade(current)?.toFixed(2) ?? "unknown",
    alternativeDisplay: grade(alt)?.toFixed(2) ?? "unknown",
    direction: dir(grade(alt), grade(current), false), // lower grade = better
  });

  const kitaRate = (p: PlanungsraumProfile) => (p.total_kita_capacity ?? 0) / p.n_addresses;
  rows.push({
    factor: "Kita capacity per address",
    currentDisplay: kitaRate(current).toFixed(3),
    alternativeDisplay: kitaRate(alt).toFixed(3),
    direction: dir(kitaRate(alt), kitaRate(current), true),
  });

  rows.push({
    factor: "Nearest transit",
    currentDisplay: `${current.nearest_transit_station ?? "unknown"} (${fmtKm(current.transit_distance_km)})`,
    alternativeDisplay: `${alt.nearest_transit_station ?? "unknown"} (${fmtKm(alt.transit_distance_km)})`,
    direction: dir(alt.transit_distance_km, current.transit_distance_km, false),
  });

  const familyScore = (p: PlanungsraumProfile) => p.has_kinderarzt_plz + p.has_yoga_studio_plz;
  rows.push({
    factor: "Kinderarzt / yoga studio in ZIP code",
    currentDisplay: `${current.has_kinderarzt_plz ? "Kinderarzt" : ""}${
      current.has_kinderarzt_plz && current.has_yoga_studio_plz ? " + " : ""
    }${current.has_yoga_studio_plz ? "Yoga" : ""}` || "neither",
    alternativeDisplay: `${alt.has_kinderarzt_plz ? "Kinderarzt" : ""}${
      alt.has_kinderarzt_plz && alt.has_yoga_studio_plz ? " + " : ""
    }${alt.has_yoga_studio_plz ? "Yoga" : ""}` || "neither",
    direction: dir(familyScore(alt), familyScore(current), true),
  });

  return rows;
}

function dir(altVal: number | null | undefined, curVal: number | null | undefined, higherIsBetter: boolean): FactorDelta["direction"] {
  if (altVal == null || curVal == null) return "unknown";
  if (altVal === curVal) return "same";
  const altBetter = higherIsBetter ? altVal > curVal : altVal < curVal;
  return altBetter ? "better" : "worse";
}

function ordinalDir(
  altVal: string | null,
  curVal: string | null,
  scale: Record<string, number>
): FactorDelta["direction"] {
  if (altVal == null || curVal == null || !(altVal in scale) || !(curVal in scale)) return "unknown";
  return dir(scale[altVal], scale[curVal], true);
}

export interface KiezComparison {
  current: PlanungsraumProfile;
  alternative: RankedResult;
  rows: FactorDelta[];
}

export function compareToCurrent(current: PlanungsraumProfile, alternatives: RankedResult[]): KiezComparison[] {
  return alternatives.map((alt) => ({
    current,
    alternative: alt,
    rows: buildComparisonRows(current, alt.plr),
  }));
}
