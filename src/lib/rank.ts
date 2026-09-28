import planungsraumData from "@/data/planungsraum.json";
import type { FactorWeights, PlanungsraumProfile, RankedResult } from "./types";

const ALL: PlanungsraumProfile[] = planungsraumData as unknown as PlanungsraumProfile[];

export const FACTOR_KEYS: (keyof FactorWeights)[] = [
  "price",
  "location_quality",
  "green_space",
  "environmental_comfort",
  "safety",
  "schools",
  "kitas",
  "transit",
  "family_hobbies_access",
];

// ---------------------------------------------------------------
// Ordinal encoders — map category strings onto 0-1, 1 = best.
// Direction per column documented in Kiez Profile Master Table/README.md.
// ---------------------------------------------------------------
const GRUEN_SCALE: Record<string, number> = { gut: 1, mittel: 0.5, schlecht: 0 };

// ug_mehrfachbelastung_umwelt is NOT gering/mittel/hoch (that's the single
// indicators like ug_laerm) — it's the "how many burden criteria stack up
// simultaneously" scale, same family as ug_gesamt_umweltgerechtigkeitskarte.
// Verified against the actual data (planungsraum_profile.csv), not assumed —
// an earlier version of this file and the README got this wrong.
const MEHRFACH_SCALE: Record<string, number> = {
  "keine starke Belastung": 1,
  einfach: 0.75,
  zweifach: 0.5,
  dreifach: 0.25,
  vierfach: 0,
  fünffach: 0,
};

// ---------------------------------------------------------------
// Continuous fields need min-max normalization across the dataset.
// Computed once from ALL 542 rows, direction-corrected so 1 = best.
// ---------------------------------------------------------------
function minMax(values: number[]): { min: number; max: number } {
  return { min: Math.min(...values), max: Math.max(...values) };
}

function normalize(value: number, min: number, max: number, higherIsBetter: boolean): number {
  if (max === min) return 0.5; // no variance in the dataset for this factor — treat as neutral
  const t = (value - min) / (max - min);
  return higherIsBetter ? t : 1 - t;
}

// safety = crime_total_avg_2017_2019 / n_addresses, a rough population-density
// proxy per the user's explicit call — addresses aren't people, but it's the
// only denominator we have, and it beats a raw count that just penalizes
// bigger Planungsräume for being bigger.
const safetyRates = ALL.map((p) => p.crime_total_avg_2017_2019! / p.n_addresses);
const safetyRange = minMax(safetyRates);

const priceValues = ALL.map((p) => p.rent_per_m2_kalt_avg_synthetic).filter(
  (v): v is number => v != null
);
const priceRange = minMax(priceValues);

const wohnlageRange = minMax(ALL.map((p) => p.pct_wohnlage_gut));

// schools: PLR-exact value if present, else the complete Bezirk fallback —
// per the explicit "silently fall back to Bezirk" decision.
const schoolGrades = ALL.map((p) => p.abitur_mn_scls_plr_avg ?? p.abitur_mn_scls_bezirk_avg!);
const schoolRange = minMax(schoolGrades);

// kitas: capacity per address, same population-proxy reasoning as safety —
// a raw capacity count otherwise just rewards bigger Planungsräume.
const kitaRates = ALL.map((p) => (p.total_kita_capacity ?? 0) / p.n_addresses);
const kitaRange = minMax(kitaRates);

const transitRange = minMax(ALL.map((p) => p.transit_distance_km!));

// ---------------------------------------------------------------
// Per-factor score for one Planungsraum. Returns null if the underlying
// data is genuinely missing (only price ~3% and green_space ~0.4% ever
// are) — the caller excludes that factor and redistributes its weight
// for that specific row, rather than guessing a value.
// ---------------------------------------------------------------
function factorScore(p: PlanungsraumProfile, key: keyof FactorWeights): number | null {
  switch (key) {
    case "price": {
      if (p.rent_per_m2_kalt_avg_synthetic == null) return null;
      return normalize(p.rent_per_m2_kalt_avg_synthetic, priceRange.min, priceRange.max, false);
    }
    case "location_quality":
      return normalize(p.pct_wohnlage_gut, wohnlageRange.min, wohnlageRange.max, true);
    case "green_space": {
      const v = p.ug_gruenversorgung;
      if (v == null || !(v in GRUEN_SCALE)) return null;
      return GRUEN_SCALE[v];
    }
    case "environmental_comfort": {
      const v = p.ug_mehrfachbelastung_umwelt;
      if (v == null || !(v in MEHRFACH_SCALE)) return null;
      return MEHRFACH_SCALE[v];
    }
    case "safety": {
      const rate = p.crime_total_avg_2017_2019! / p.n_addresses;
      return normalize(rate, safetyRange.min, safetyRange.max, false);
    }
    case "schools": {
      const grade = p.abitur_mn_scls_plr_avg ?? p.abitur_mn_scls_bezirk_avg;
      if (grade == null) return null; // shouldn't happen — Bezirk fallback is 100% complete
      return normalize(grade, schoolRange.min, schoolRange.max, false); // lower grade = better
    }
    case "kitas": {
      const rate = (p.total_kita_capacity ?? 0) / p.n_addresses;
      return normalize(rate, kitaRange.min, kitaRange.max, true);
    }
    case "transit": {
      if (p.transit_distance_km == null) return null;
      return normalize(p.transit_distance_km, transitRange.min, transitRange.max, false);
    }
    case "family_hobbies_access":
      return (p.has_kinderarzt_plz + p.has_yoga_studio_plz) / 2; // already 0-1 each
  }
}

/** Weighted score, 0-1. Missing factors are excluded and the remaining
 *  weights renormalized for that row, rather than penalizing a Planungsraum
 *  for a gap in the data. */
export function scorePlanungsraum(
  p: PlanungsraumProfile,
  weights: FactorWeights
): { score: number; factorScores: Record<keyof FactorWeights, number | null> } {
  const factorScores = {} as Record<keyof FactorWeights, number | null>;
  let weightedSum = 0;
  let weightUsed = 0;

  for (const key of FACTOR_KEYS) {
    const s = factorScore(p, key);
    factorScores[key] = s;
    if (s != null) {
      weightedSum += s * weights[key];
      weightUsed += weights[key];
    }
  }

  const score = weightUsed > 0 ? weightedSum / weightUsed : 0;
  return { score, factorScores };
}

/** Top 3 Planungsräume by score, no two sharing a PLZ, and none sharing
 *  the user's current PLZ either (per the explicit design decision). */
export function findTopAlternatives(
  currentPlrId: string,
  weights: FactorWeights,
  count = 3
): RankedResult[] {
  const current = ALL.find((p) => p.plr_id === currentPlrId);
  if (!current) throw new Error(`Unknown plr_id: ${currentPlrId}`);
  const currentPlz = current.dominant_plz;

  const ranked = ALL.filter((p) => p.plr_id !== currentPlrId && p.dominant_plz !== currentPlz)
    .map((p) => {
      const { score, factorScores } = scorePlanungsraum(p, weights);
      return { plr: p, score, factorScores } as RankedResult;
    })
    .sort((a, b) => b.score - a.score);

  const picked: RankedResult[] = [];
  const seenPlz = new Set<string>();
  for (const r of ranked) {
    if (seenPlz.has(r.plr.dominant_plz)) continue;
    picked.push(r);
    seenPlz.add(r.plr.dominant_plz);
    if (picked.length === count) break;
  }
  return picked;
}

export function getPlanungsraumById(plrId: string): PlanungsraumProfile | undefined {
  return ALL.find((p) => p.plr_id === plrId);
}

export function getAllPlanungsraeume(): PlanungsraumProfile[] {
  return ALL;
}

/** Default weights: all factors equal (1/9 each after normalization). Used
 *  only as a fallback — real weights come from the intake form's 1-5 ratings. */
export function equalWeights(): FactorWeights {
  const w = {} as FactorWeights;
  for (const key of FACTOR_KEYS) w[key] = 1 / FACTOR_KEYS.length;
  return w;
}

/** Convert 1-5 ratings per factor into normalized weights summing to 1. */
export function ratingsToWeights(ratings: Record<keyof FactorWeights, number>): FactorWeights {
  const total = FACTOR_KEYS.reduce((sum, k) => sum + ratings[k], 0);
  const w = {} as FactorWeights;
  for (const key of FACTOR_KEYS) w[key] = total > 0 ? ratings[key] / total : 1 / FACTOR_KEYS.length;
  return w;
}
