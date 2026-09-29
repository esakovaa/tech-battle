import planungsraumData from "@/data/planungsraum.json";
import { SOFT_FACTOR_KEYS } from "./types";
import type { FactorWeights, PlanungsraumProfile, RankedResult, UserPreferences } from "./types";
import { averageCommuteMinutes, commuteLimit, type CommuteOrigin } from "./commute";
import { geocodeAddress } from "./geocode";

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
export const GRUEN_SCALE: Record<string, number> = { gut: 1, mittel: 0.5, schlecht: 0 };
export const BELASTUNG_3_SCALE: Record<string, number> = { gering: 1, mittel: 0.5, hoch: 0 }; // ug_laerm, ug_luft individually

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

const crimeValues = ALL.map((p) => p.crime_rate_per_10k_2017_2019).filter((v): v is number => v != null);
const crimeRange = minMax(crimeValues);

// Two precomputed ranges for the kids-population score, since the formula
// itself changes (under-6 counted once vs. twice) depending on whether
// kita was marked relevant — each needs its own min/max to normalize against.
function kidsUnder18Weighted(p: PlanungsraumProfile, under6Multiplier: number): number {
  return p.n_population_under6 * under6Multiplier + p.n_population_6_15 + p.n_population_15_18;
}
const kidsPopRange = minMax(ALL.map((p) => kidsUnder18Weighted(p, 1)));
const kidsPopKitaRange = minMax(ALL.map((p) => kidsUnder18Weighted(p, 2)));

// ---------------------------------------------------------------
// Distance-from-center tiers ("recommend more remote Kieze first") —
// terciles computed once over the whole city, so tier boundaries are a
// stable, meaningful reference (not shifting per-request based on
// whatever's left after filtering). See findTopAlternatives for how these
// combine with the "always further than the user's current Kiez" rule.
// ---------------------------------------------------------------
function quantile(sortedAsc: number[], q: number): number {
  const idx = (sortedAsc.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}
const distancesAsc = ALL.map((p) => p.distance_from_center_km).sort((a, b) => a - b);
const DISTANCE_TIER_BOUNDS: [number, number] = [quantile(distancesAsc, 1 / 3), quantile(distancesAsc, 2 / 3)];

/** 0 = near, 1 = mid, 2 = far, by city-wide terciles of distance from
 *  Alexanderplatz. */
function distanceTier(km: number): 0 | 1 | 2 {
  if (km < DISTANCE_TIER_BOUNDS[0]) return 0;
  if (km < DISTANCE_TIER_BOUNDS[1]) return 1;
  return 2;
}

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
    case "hobbies": {
      // Only meaningful when computed with the user's selected hobbies in
      // scope — see selectedHobbiesScore below, called from scorePlanungsraum.
      return null;
    }
    case "crime": {
      // Always on, for every user — crime is bad regardless of what anyone
      // selected in the intake (see preferencesToWeights).
      const v = p.crime_rate_per_10k_2017_2019;
      if (v == null) return null;
      return normalize(v, crimeRange.min, crimeRange.max, false); // lower crime rate = better
    }
    case "kids_population": {
      // Formula depends on whether kita was marked relevant (double-counts
      // under-6) — see kidsPopulationScore below, called from scorePlanungsraum.
      return null;
    }
    case "commute": {
      // Not a static PlanungsraumProfile field — fetched live per request,
      // only for a bounded shortlist. See commuteScore below, called from
      // scorePlanungsraum, and findTopAlternatives for how the shortlist
      // and its min/max normalization range get built.
      return null;
    }
  }
}

/** Fraction of the user's selected hobbies available in this Planungsraum's
 *  ZIP code — e.g. picking yoga+gym and having only gym nearby scores 0.5,
 *  not a full miss. Returns null if no hobbies were selected (factor
 *  excluded from scoring entirely, same as any other unmeasured factor). */
function selectedHobbiesScore(p: PlanungsraumProfile, hobbies: UserPreferences["hobbies"]): number | null {
  const selected: ("yoga" | "gym" | "bouldering")[] = [];
  if (hobbies.yoga) selected.push("yoga");
  if (hobbies.gym) selected.push("gym");
  if (hobbies.bouldering) selected.push("bouldering");
  if (selected.length === 0) return null;

  const has = (h: "yoga" | "gym" | "bouldering") =>
    h === "yoga" ? p.has_yoga_studios_plz : h === "gym" ? p.has_gym_plz : p.has_bouldering_plz;
  const hits = selected.filter((h) => has(h) === 1).length;
  return hits / selected.length;
}

/** More kids under 18 = higher score, for every user (family-density is a
 *  general neighborhood signal, not gated behind having kids yourself).
 *  When kita is marked relevant, the under-6 slice counts twice — kita
 *  access matters most where there are actually a lot of under-6s. */
function kidsPopulationScore(p: PlanungsraumProfile, kitaRelevant: boolean): number {
  const multiplier = kitaRelevant ? 2 : 1;
  const range = kitaRelevant ? kidsPopKitaRange : kidsPopRange;
  return normalize(kidsUnder18Weighted(p, multiplier), range.min, range.max, true);
}

/** Context needed to score the "commute" factor — unlike every other
 *  factor, this isn't a static field on PlanungsraumProfile, it's fetched
 *  live for a bounded shortlist (see findTopAlternatives). `range` is the
 *  min/max of whatever commute minutes were actually fetched this
 *  request, NOT a city-wide constant like priceRange/schoolRange — there's
 *  no live commute data for the whole dataset. */
export interface CommuteScoreContext {
  minutesByPlr: Map<string, number | null>;
  range: { min: number; max: number };
  /** The user's own max commute, when they gave one. */
  limit?: number;
}

function commuteScore(p: PlanungsraumProfile, ctx: CommuteScoreContext | undefined): number | null {
  if (!ctx) return null;
  const minutes = ctx.minutesByPlr.get(p.plr_id);
  if (minutes == null) return null; // no VBB data for this Kiez — excluded, not penalized
  if (ctx.limit) {
    // Anchored to what THIS user said is acceptable, not just relative to
    // the shortlist: a door-to-door trip scores 1, one right at the limit
    // scores 0.2; anything over it (only reachable when the cutoff had
    // to be relaxed — see pickWithCommute). Past the limit it keeps
    // falling, so when the cutoff is relaxed, "a bit over" still beats
    // "far over"; at twice the limit it bottoms out at 0.
    if (minutes > ctx.limit) return Math.max(0, 0.2 * (1 - (minutes - ctx.limit) / ctx.limit));
    return 1 - 0.8 * (minutes / ctx.limit);
  }
  return normalize(minutes, ctx.range.min, ctx.range.max, false); // fewer minutes = better
}

/** Fixed weight per answer tier — these are intake answers (minimal/flexible/
 *  not_a_concern, yes/no), not a 1-5 slider, so weights are fixed constants
 *  per tier rather than user-supplied numbers. */
export function preferencesToWeights(prefs: UserPreferences): FactorWeights {
  const anyHobbySelected = prefs.hobbies.yoga || prefs.hobbies.gym || prefs.hobbies.bouldering;
  const raw: FactorWeights = {
    price: prefs.rentBudget === "minimal" ? 3 : prefs.rentBudget === "flexible" ? 1.5 : 0,
    green_space: prefs.parksImportant ? 3 : 0,
    noise_air: prefs.noiseAirSensitive ? 3 : 0,
    schools: prefs.kids.highSchool ? 3 : 0,
    // Deliberately much lighter than the other tiers (max 3) — a missing
    // hobby should nudge the score down a little, not act as a gate.
    hobbies: anyHobbySelected ? 1 : 0,
    // Always-on baseline factors — not conditional on an intake answer.
    crime: 2,
    kids_population: 2,
    // Same weight tier as price/schools/parks/noise — "an important factor"
    // per product direction, not a minor nudge like hobbies. Zero unless
    // the user actually gave a commute address (see findTopAlternatives).
    commute: (prefs.commuteAddresses?.length ?? 0) > 0 ? 3 : 0,
  };
  const total = SOFT_FACTOR_KEYS.reduce((s, k) => s + raw[k], 0);
  // Safety net: if the user flagged nothing as important, don't degenerate
  // to an all-zero score (which would make ranking a tie-break coin flip) —
  // fall back to equal weight across all soft factors.
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
  weights: FactorWeights,
  prefs: Pick<UserPreferences, "hobbies" | "kids">,
  commuteCtx?: CommuteScoreContext
): { score: number; factorScores: Record<keyof FactorWeights, number | null> } {
  const factorScores = {} as Record<keyof FactorWeights, number | null>;
  let weightedSum = 0;
  let weightUsed = 0;
  for (const key of SOFT_FACTOR_KEYS) {
    const s =
      key === "hobbies"
        ? selectedHobbiesScore(p, prefs.hobbies)
        : key === "kids_population"
          ? kidsPopulationScore(p, prefs.kids.kita)
          : key === "commute"
            ? commuteScore(p, commuteCtx)
            : factorScore(p, key);
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
// kid-doctor presence work this way; everything else the user rates
// (including hobbies, deliberately — see preferencesToWeights) is a soft
// weight instead.
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
  /** All 3 results landed in 3 different distance-from-center tiers. */
  distinctRadiusTiers: boolean;
  /** The "further than your current Kiez" rule had to be dropped entirely
   *  to reach `count` results — see the comment on findTopAlternatives. */
  distanceConstraintRelaxed: boolean;
  /** commuteAddresses were given but the max-commute hard cutoff had to be
   *  dropped to reach `count` results. False (not absent) when no
   *  commuteAddresses were given. */
  commuteConstraintRelaxed: boolean;
}

// Real commute time is only ever fetched for a bounded shortlist, never
// the full ~540-Planungsraum pool — VBB rate-limits to ~100 req/min (see
// src/tools/commute.py), so calling it per-candidate for the whole city
// would take minutes. This many top candidates per distance tier (by
// every OTHER factor's score) is the shortlist that gets a real commute
// check — generous enough that the commute hard-cutoff has room to
// exclude some of them and still leave `count` distinct-PLZ survivors.
const COMMUTE_SHORTLIST_PER_TIER = 8;

// A live public API with no SLA (has been observed hanging outright) must
// never be allowed to hang the whole ranking request — past this budget,
// give up on commute data for this request and score/return without it,
// same as if commuteAddresses had never been given. Whatever VBB calls
// are still in flight keep running in the background and land in
// lib/commute.ts's cache anyway, warming it for the next request.
const COMMUTE_PHASE_BUDGET_MS = 15000;

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer!);
  return result;
}

async function resolveCommuteOrigins(addresses: string[] | undefined): Promise<CommuteOrigin[]> {
  const trimmed = (addresses ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 2);
  if (trimmed.length === 0) return [];
  const resolved = await Promise.all(
    trimmed.map(async (address) => {
      const coords = await geocodeAddress(address);
      return coords ? { address, lat: coords.lat, lon: coords.lon } : null;
    })
  );
  return resolved.filter((o): o is CommuteOrigin => o != null);
}

/** Top N candidates per distance tier, by non-commute score — the pool
 *  that's actually worth spending live VBB calls on. */
function buildCommuteShortlist(candidates: PlanungsraumProfile[], weights: FactorWeights, prefs: UserPreferences): PlanungsraumProfile[] {
  const byTier: { plr: PlanungsraumProfile; score: number }[][] = [[], [], []];
  for (const p of candidates) {
    byTier[distanceTier(p.distance_from_center_km)].push({ plr: p, score: scorePlanungsraum(p, weights, prefs).score });
  }
  return byTier.flatMap((tierList) =>
    tierList
      .sort((a, b) => b.score - a.score)
      .slice(0, COMMUTE_SHORTLIST_PER_TIER)
      .map((r) => r.plr)
  );
}

/** Fetches real commute time for a bounded shortlist of `candidates`,
 *  applies the max-commute hard cutoff (the user's maxCommuteMinutes, else
 *  lib/commute.ts's MAX_COMMUTE_MIN), and ranks+picks from the
 *  survivors — falling back to the full (uncut) shortlist, commute used
 *  only as a soft factor, if the cutoff left too few distinct-PLZ results. */
async function pickWithCommute(
  candidates: PlanungsraumProfile[],
  weights: FactorWeights,
  prefs: UserPreferences,
  count: number,
  origins: CommuteOrigin[]
): Promise<{ picked: RankedResult[]; distinctRadiusTiers: boolean; commuteConstraintRelaxed: boolean }> {
  const shortlist = buildCommuteShortlist(candidates, weights, prefs);
  const shortlistIds = shortlist.map((p) => p.plr_id);

  const fallbackMinutes = new Map<string, number | null>(shortlistIds.map((id) => [id, null]));
  const minutesByPlr = await withTimeout(averageCommuteMinutes(origins, shortlistIds), COMMUTE_PHASE_BUDGET_MS, fallbackMinutes);

  const knownMinutes = Array.from(minutesByPlr.values()).filter((v): v is number => v != null);
  const limit = commuteLimit(prefs.maxCommuteMinutes);
  const commuteCtx: CommuteScoreContext | undefined =
    knownMinutes.length > 0
      ? { minutesByPlr, range: minMax(knownMinutes), limit: prefs.maxCommuteMinutes != null ? limit : undefined }
      : undefined;

  const withinCutoff = shortlist.filter((p) => {
    const m = minutesByPlr.get(p.plr_id);
    return m == null || m <= limit; // unknown passes through — never excluded on missing data
  });

  let { picked, distinctRadiusTiers } = rankAndPickByTier(withinCutoff, weights, prefs, count, commuteCtx);
  let commuteConstraintRelaxed = false;

  if (picked.length < count) {
    commuteConstraintRelaxed = true;
    const result = rankAndPickByTier(shortlist, weights, prefs, count, commuteCtx);
    picked = result.picked;
    distinctRadiusTiers = result.distinctRadiusTiers;
  }

  return { picked, distinctRadiusTiers, commuteConstraintRelaxed };
}

/** Score + rank a candidate pool, then greedily pick one winner per
 *  distance tier (visiting far -> mid -> near, so a fallback-fill below
 *  favors remoteness too), falling back to best-score-regardless-of-tier
 *  for any slots a tier couldn't fill. Final order is furthest-from-center
 *  first — "recommend more remote Kieze first" as literal presentation
 *  order, not just a selection bias. */
function rankAndPickByTier(
  candidates: PlanungsraumProfile[],
  weights: FactorWeights,
  prefs: UserPreferences,
  count: number,
  commuteCtx?: CommuteScoreContext
): { picked: RankedResult[]; distinctRadiusTiers: boolean } {
  const ranked = candidates
    .map((p) => {
      const { score, factorScores } = scorePlanungsraum(p, weights, prefs, commuteCtx);
      const result: RankedResult = { plr: p, score, factorScores };
      if (commuteCtx) result.commuteMinutes = commuteCtx.minutesByPlr.get(p.plr_id) ?? null;
      return result;
    })
    .sort((a, b) => b.score - a.score);

  const seenPlz = new Set<string>();
  const byTier: (RankedResult | undefined)[] = [undefined, undefined, undefined];
  for (const tier of [2, 1, 0] as const) {
    const winner = ranked.find((r) => distanceTier(r.plr.distance_from_center_km) === tier && !seenPlz.has(r.plr.dominant_plz));
    if (winner) {
      byTier[tier] = winner;
      seenPlz.add(winner.plr.dominant_plz);
    }
  }
  const picked = [2, 1, 0].map((t) => byTier[t]).filter((r): r is RankedResult => r != null);
  const distinctRadiusTiers = picked.length === count;

  for (const r of ranked) {
    if (picked.length >= count) break;
    if (seenPlz.has(r.plr.dominant_plz)) continue;
    picked.push(r);
    seenPlz.add(r.plr.dominant_plz);
  }

  picked.sort((a, b) => b.plr.distance_from_center_km - a.plr.distance_from_center_km);
  return { picked: picked.slice(0, count), distinctRadiusTiers };
}

/** Steps 2-4: filter (with graceful degradation), score, and pick the top 3
 *  in different ZIP codes, excluding the user's own current ZIP code too.
 *
 * Two deliberately separate rules about distance from Alexanderplatz:
 * 1. Every alternative must be further from the center than the user's
 *    current Kiez — applied as a strict pre-filter, BEFORE kita/kidDoctor
 *    degradation runs, so those get degraded first if candidates are tight.
 *    Only relaxed as an absolute last resort (see distanceConstraintRelaxed
 *    below) — this is the one rule the product wants to basically never
 *    break, unlike kita/kidDoctor which are expected to degrade sometimes.
 * 2. The 3 picks should land in 3 different distance tiers (near/mid/far)
 *    where possible, furthest first — see rankAndPickByTier.
 */
export async function findTopAlternatives(
  currentPlrId: string,
  prefs: UserPreferences,
  count = 3
): Promise<FindTopAlternativesResult> {
  const current = ALL.find((p) => p.plr_id === currentPlrId);
  if (!current) throw new Error(`Unknown plr_id: ${currentPlrId}`);
  const currentPlz = current.dominant_plz;

  const candidatePool = ALL.filter((p) => p.plr_id !== currentPlrId && p.dominant_plz !== currentPlz);
  const fartherPool = candidatePool.filter((p) => p.distance_from_center_km > current.distance_from_center_km);

  const filters = deriveFilters(prefs);
  const weights = preferencesToWeights(prefs);
  const commuteOrigins = await resolveCommuteOrigins(prefs.commuteAddresses);

  const pick = (pool: PlanungsraumProfile[]) =>
    commuteOrigins.length > 0
      ? pickWithCommute(pool, weights, prefs, count, commuteOrigins)
      : Promise.resolve({ ...rankAndPickByTier(pool, weights, prefs, count), commuteConstraintRelaxed: false });

  const { filtered, droppedFilters } = filterWithDegradation(fartherPool, filters, count);
  let { picked, distinctRadiusTiers, commuteConstraintRelaxed } = await pick(filtered);
  let distanceConstraintRelaxed = false;

  // Last resort: even the full farther-than-current pool (with every
  // kita/kidDoctor filter already dropped) couldn't reach `count` — relax
  // the distance rule itself rather than ever returning fewer than
  // requested. Re-run filter degradation against the full candidate pool.
  if (picked.length < count) {
    distanceConstraintRelaxed = true;
    const fallback = filterWithDegradation(candidatePool, filters, count);
    const result = await pick(fallback.filtered);
    picked = result.picked;
    distinctRadiusTiers = result.distinctRadiusTiers;
    commuteConstraintRelaxed ||= result.commuteConstraintRelaxed;
    droppedFilters.push(...fallback.droppedFilters.filter((f) => !droppedFilters.includes(f)));
  }

  return {
    results: picked,
    secondBest: droppedFilters.length > 0,
    droppedFilters,
    distinctRadiusTiers,
    distanceConstraintRelaxed,
    commuteConstraintRelaxed,
  };
}

export function getPlanungsraumById(plrId: string): PlanungsraumProfile | undefined {
  return ALL.find((p) => p.plr_id === plrId);
}

export function getAllPlanungsraeume(): PlanungsraumProfile[] {
  return ALL;
}
