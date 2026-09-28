import planungsraumData from "@/data/planungsraum.json";
import { SOFT_FACTOR_KEYS } from "./types";
import type { FactorWeights, PlanungsraumProfile, RankedResult, UserPreferences } from "./types";

const ALL: PlanungsraumProfile[] = planungsraumData as unknown as PlanungsraumProfile[];

// No reliable data source exists for primary-school quality/presence yet
// (only Abitur/Oberstufe data, which is high school). Never filter or score
// on it — see KidsCriteria.primarySchool in types.ts.
export const PRIMARY_SCHOOL_DATA_AVAILABLE = false;

// ---------------------------------------------------------------
// Ordinal encoders — 1 = best, verified against actual data (see Kiez
// Profile Master Table/README.md for why these specific scales, not the
// ones an earlier version of this code/README assumed).
// ---------------------------------------------------------------
const GRUEN_SCALE: Record<string, number> = { gut: 1, mittel: 0.5, schlecht: 0 };
const BELASTUNG_3_SCALE: Record<string, number> = { gering: 1, mittel: 0.5, hoch: 0 }; // ug_laerm, ug_luft individually

function minMax(values: number[]): { min: number; max: number } {
  return { min: Math.min(...values), max: Math.max(...values) };
}
function normalize(value: number, min: number, max: number, higherIsBetter: boolean): number {
  if (max === min) return 0.5;
  const t = (value - min) / (max - min);
  return higherIsBetter ? t : 1 - t;
}

const priceValues = ALL.map((p) => p.rent_per_m2_kalt_avg_synthetic).filter((v): v is number => v != null);
const priceRange = minMax(priceValues);

const schoolGrades = ALL.map((p) => p.abitur_mn_scls_plr_avg ?? p.abitur_mn_scls_bezirk_avg!);
const schoolRange = minMax(schoolGrades);

// ---------------------------------------------------------------
// Soft (weighted, non-excluding) factors — only the 4 things actually
// asked about in the intake. Everything else the earlier version of this
// file scored (safety, transit, kita capacity, location quality) either
// isn't asked about at all, or is handled as a hard filter instead (see
// deriveFilters below), not a weighted score.
// ---------------------------------------------------------------
function factorScore(p: PlanungsraumProfile, key: keyof FactorWeights): number | null {
  switch (key) {
    case "price": {
      if (p.rent_per_m2_kalt_avg_synthetic == null) return null;
      return normalize(p.rent_per_m2_kalt_avg_synthetic, priceRange.min, priceRange.max, false);
    }
    case "green_space": {
      const v = p.ug_gruenversorgung;
      if (v == null || !(v in GRUEN_SCALE)) return null;
      return GRUEN_SCALE[v];
    }
    case "noise_air": {
      // Specifically noise + air, NOT the combined ug_mehrfachbelastung_umwelt
      // (which also folds in heat/thermal stress — nobody asked about heat).
      const laerm = p.ug_laerm != null && p.ug_laerm in BELASTUNG_3_SCALE ? BELASTUNG_3_SCALE[p.ug_laerm] : null;
      const luft = p.ug_luft != null && p.ug_luft in BELASTUNG_3_SCALE ? BELASTUNG_3_SCALE[p.ug_luft] : null;
      if (laerm == null && luft == null) return null;
      if (laerm == null) return luft;
      if (luft == null) return laerm;
      return (laerm + luft) / 2;
    }
    case "schools": {
      const grade = p.abitur_mn_scls_plr_avg ?? p.abitur_mn_scls_bezirk_avg;
      if (grade == null) return null; // shouldn't happen — Bezirk fallback is complete
      return normalize(grade, schoolRange.min, schoolRange.max, false); // lower grade = better
    }
  }
}

/** Fixed weight per answer tier — these are intake answers (minimal/flexible/
 *  not_a_concern, yes/no), not a 1-5 slider, so weights are fixed constants
 *  per tier rather than user-supplied numbers. */
export function preferencesToWeights(prefs: UserPreferences): FactorWeights {
  const raw: FactorWeights = {
    price: prefs.rentBudget === "minimal" ? 3 : prefs.rentBudget === "flexible" ? 1.5 : 0,
    green_space: prefs.parksImportant ? 3 : 0,
    noise_air: prefs.noiseAirSensitive ? 3 : 0,
    schools: prefs.kids.highSchool ? 3 : 0,
  };
  const total = SOFT_FACTOR_KEYS.reduce((s, k) => s + raw[k], 0);
  // Safety net: if the user flagged nothing as important, don't degenerate
  // to an all-zero score (which would make ranking a tie-break coin flip) —
  // fall back to equal weight across all 4 soft factors.
  if (total === 0) {
    const w = {} as FactorWeights;
    for (const k of SOFT_FACTOR_KEYS) w[k] = 1 / SOFT_FACTOR_KEYS.length;
    return w;
  }
  const w = {} as FactorWeights;
  for (const k of SOFT_FACTOR_KEYS) w[k] = raw[k] / total;
  return w;
}

export function scorePlanungsraum(
  p: PlanungsraumProfile,
  weights: FactorWeights
): { score: number; factorScores: Record<keyof FactorWeights, number | null> } {
  const factorScores = {} as Record<keyof FactorWeights, number | null>;
  let weightedSum = 0;
  let weightUsed = 0;
  for (const key of SOFT_FACTOR_KEYS) {
    const s = factorScore(p, key);
    factorScores[key] = s;
    if (s != null) {
      weightedSum += s * weights[key];
      weightUsed += weights[key];
    }
  }
  return { score: weightUsed > 0 ? weightedSum / weightUsed : 0, factorScores };
}

// ---------------------------------------------------------------
// Hard filters — excluding, not just score-affecting. Only kita and
// kid-doctor presence and the selected hobbies work this way; everything
// else the user rates is a soft weight (above).
// ---------------------------------------------------------------
export interface Filter {
  key: string;
  label: string;
  test: (p: PlanungsraumProfile) => boolean;
}

export function deriveFilters(prefs: UserPreferences): Filter[] {
  const filters: Filter[] = [];

  if (prefs.kids.kita) {
    filters.push({ key: "kita", label: "Has a Kita", test: (p) => p.n_kitas >= 1 });
  }
  if (prefs.kids.kidDoctor) {
    filters.push({ key: "kidDoctor", label: "Has a Kinderarzt in the ZIP code", test: (p) => p.has_kinderarzt_plz === 1 });
  }

  const selectedHobbies: ("yoga" | "gym" | "bouldering")[] = [];
  if (prefs.hobbies.yoga) selectedHobbies.push("yoga");
  if (prefs.hobbies.gym) selectedHobbies.push("gym");
  if (prefs.hobbies.bouldering) selectedHobbies.push("bouldering");
  // OR across selected hobbies (at least one available), not AND — picking
  // yoga+gym means "either is fine," not "both are required."
  if (selectedHobbies.length > 0) {
    filters.push({
      key: "hobbies",
      label: `Has at least one of: ${selectedHobbies.join(", ")} (in the ZIP code)`,
      test: (p) =>
        selectedHobbies.some((h) => {
          if (h === "yoga") return p.has_yoga_studios_plz === 1;
          if (h === "gym") return p.has_gym_plz === 1;
          if (h === "bouldering") return p.has_bouldering_plz === 1;
          return false;
        }),
    });
  }

  // kids.primarySchool and kids.highSchool are intentionally not filters —
  // primarySchool has no data at all (see PRIMARY_SCHOOL_DATA_AVAILABLE),
  // and highSchool's data (Abitur, Bezirk-fallback) is ~100% complete so a
  // presence filter wouldn't exclude anything meaningful — it's a soft
  // weight on the `schools` factor instead (see preferencesToWeights).

  return filters;
}

/** Apply all active filters; if fewer than `minResults` distinct-PLZ
 *  candidates remain, greedily drop whichever active filter unlocks the
 *  most additional candidates, and repeat — until enough results or no
 *  filters left. Returns which filters were dropped, if any, so the
 *  caller can tell the user "couldn't find a match with X, here's the
 *  next best without it." */
function filterWithDegradation(
  candidates: PlanungsraumProfile[],
  filters: Filter[],
  minResults: number
): { filtered: PlanungsraumProfile[]; droppedFilters: string[] } {
  let active = [...filters];
  const apply = (fs: Filter[]) => candidates.filter((p) => fs.every((f) => f.test(p)));
  const distinctPlz = (list: PlanungsraumProfile[]) => new Set(list.map((p) => p.dominant_plz)).size;

  let filtered = apply(active);

  while (distinctPlz(filtered) < minResults && active.length > 0) {
    let bestDrop: Filter | null = null;
    let bestGain = -1;
    for (const f of active) {
      const without = active.filter((x) => x.key !== f.key);
      const gain = distinctPlz(apply(without)) - distinctPlz(filtered);
      if (gain > bestGain) {
        bestGain = gain;
        bestDrop = f;
      }
    }
    if (!bestDrop) break;
    active = active.filter((x) => x.key !== bestDrop!.key);
    filtered = apply(active);
  }

  const droppedFilters = filters.filter((f) => !active.some((a) => a.key === f.key)).map((f) => f.label);
  return { filtered, droppedFilters };
}

export interface FindTopAlternativesResult {
  results: RankedResult[];
  secondBest: boolean;
  droppedFilters: string[];
}

/** Steps 2-4: filter (with graceful degradation), score, and pick the top 3
 *  in different ZIP codes, excluding the user's own current ZIP code too. */
export function findTopAlternatives(
  currentPlrId: string,
  prefs: UserPreferences,
  count = 3
): FindTopAlternativesResult {
  const current = ALL.find((p) => p.plr_id === currentPlrId);
  if (!current) throw new Error(`Unknown plr_id: ${currentPlrId}`);
  const currentPlz = current.dominant_plz;

  const candidatePool = ALL.filter((p) => p.plr_id !== currentPlrId && p.dominant_plz !== currentPlz);
  const filters = deriveFilters(prefs);
  const { filtered, droppedFilters } = filterWithDegradation(candidatePool, filters, count);

  const weights = preferencesToWeights(prefs);
  const ranked = filtered
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

  return { results: picked, secondBest: droppedFilters.length > 0, droppedFilters };
}

export function getPlanungsraumById(plrId: string): PlanungsraumProfile | undefined {
  return ALL.find((p) => p.plr_id === plrId);
}

export function getAllPlanungsraeume(): PlanungsraumProfile[] {
  return ALL;
}
