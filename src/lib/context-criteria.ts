import { GRUEN_SCALE, BELASTUNG_3_SCALE, getAllPlanungsraeume } from "./rank";
import type { PlanungsraumProfile } from "./types";

/**
 * The fixed taxonomy of "extra" criteria the agent is allowed to surface
 * beyond the 7-question intake — e.g. when a user's free-text answer to
 * "anything else important to you?" mentions something. Every entry here
 * is grounded in a real column; anything NOT in this list (nightlife,
 * cafes, general construction/development, internet speed, views — see
 * UNAVAILABLE_TOPICS below) has no data behind it, and the agent must say
 * so rather than guess. This is Node 2+3 of the free-text pipeline: match
 * a topic to one of these keys, then compute value + city-wide percentile.
 */
export interface ContextCriterion {
  key: string;
  label: string;
  /** Shown to the agent so it can judge whether a free-text topic matches. */
  description: string;
  /** Human-readable raw value for this Planungsraum. */
  displayValue: (p: PlanungsraumProfile) => string;
  /**
   * Higher = better, comparable across the whole city — used only for
   * percentile ranking. null if this criterion has no defensible universal
   * direction (e.g. distance from center, where the product's own stance
   * is deliberately "further is a feature," or raw construction-activity
   * counts, which aren't inherently good or bad) — those still get a
   * displayValue but no notability banding.
   */
  goodnessValue: ((p: PlanungsraumProfile) => number | null) | null;
}

const WOHNLAGE_SCALE: Record<string, number> = { gut: 1, mittel: 0.5, einfach: 0 };
// HIGHER = MORE advantaged — counter-intuitive given the field's name, see
// Kiez Profile Master Table/README.md. "-" is a literal sentinel for "no
// data," not a category — must be excluded, not treated as a low value.
const STATUS_INDEX_SCALE: Record<string, number> = {
  "hoher Status-Index": 1,
  "mittlerer Status-Index": 0.5,
  "niedriger/sehr niedriger Status-Index": 0,
};

function grade(p: PlanungsraumProfile): number | null {
  return p.abitur_mn_scls_plr_avg ?? p.abitur_mn_scls_bezirk_avg;
}
function kidsUnder18(p: PlanungsraumProfile): number {
  return p.n_population_under6 + p.n_population_6_15 + p.n_population_15_18;
}

export const CONTEXT_CRITERIA: ContextCriterion[] = [
  {
    key: "schools",
    label: "School quality (Abitur average grade)",
    description: "High school (Abitur) academic performance. No data exists for primary schools specifically.",
    displayValue: (p) => grade(p)?.toFixed(2) ?? "unknown",
    goodnessValue: (p) => (grade(p) == null ? null : -grade(p)!), // lower grade = better
  },
  {
    key: "green_space",
    label: "Green space / parks",
    description: "Access to parks and green space.",
    displayValue: (p) => p.ug_gruenversorgung ?? "unknown",
    goodnessValue: (p) => (p.ug_gruenversorgung && p.ug_gruenversorgung in GRUEN_SCALE ? GRUEN_SCALE[p.ug_gruenversorgung] : null),
  },
  {
    key: "noise",
    label: "Noise",
    description: "Ambient noise burden.",
    displayValue: (p) => p.ug_laerm ?? "unknown",
    goodnessValue: (p) => (p.ug_laerm && p.ug_laerm in BELASTUNG_3_SCALE ? BELASTUNG_3_SCALE[p.ug_laerm] : null),
  },
  {
    key: "air_quality",
    label: "Air quality",
    description: "Air pollution burden.",
    displayValue: (p) => p.ug_luft ?? "unknown",
    goodnessValue: (p) => (p.ug_luft && p.ug_luft in BELASTUNG_3_SCALE ? BELASTUNG_3_SCALE[p.ug_luft] : null),
  },
  {
    key: "crime",
    label: "Crime rate",
    description: "Crime per 10k residents, population-normalized, Bezirk-level grain.",
    displayValue: (p) => p.crime_rate_per_10k_2017_2019?.toFixed(1) ?? "unknown",
    goodnessValue: (p) => (p.crime_rate_per_10k_2017_2019 == null ? null : -p.crime_rate_per_10k_2017_2019),
  },
  {
    key: "affordability_rent",
    label: "Rental affordability",
    description: "Estimated rent per m² (SYNTHETIC — relative comparison only, ~25-40% below real market prices).",
    displayValue: (p) => (p.rent_per_m2_kalt_avg_synthetic == null ? "unknown" : `€${p.rent_per_m2_kalt_avg_synthetic.toFixed(2)}/m²`),
    goodnessValue: (p) => (p.rent_per_m2_kalt_avg_synthetic == null ? null : -p.rent_per_m2_kalt_avg_synthetic),
  },
  {
    key: "affordability_buy",
    label: "Buying affordability",
    description: "Real (non-synthetic) purchase price per m², where listings exist.",
    displayValue: (p) => (p.buy_price_per_m2_avg_REAL == null ? "unknown" : `€${p.buy_price_per_m2_avg_REAL.toFixed(0)}/m²`),
    goodnessValue: (p) => (p.buy_price_per_m2_avg_REAL == null ? null : -p.buy_price_per_m2_avg_REAL),
  },
  {
    key: "family_friendliness",
    label: "Family density (kids under 18)",
    description: "Total resident population under 18 — a general family-density signal, not a quality judgment.",
    displayValue: (p) => kidsUnder18(p).toLocaleString(),
    goodnessValue: (p) => kidsUnder18(p),
  },
  {
    key: "kita_access",
    label: "Kita (daycare) access",
    description: "Number of Kitas in the Planungsraum.",
    displayValue: (p) => (p.n_kitas > 0 ? `${p.n_kitas} nearby` : "none"),
    goodnessValue: (p) => p.n_kitas,
  },
  {
    key: "kinderarzt_access",
    label: "Kinderarzt (paediatrician) access",
    description: "Whether a paediatrician is present in the ZIP code.",
    displayValue: (p) => (p.has_kinderarzt_plz ? "yes, in ZIP code" : "no"),
    goodnessValue: null, // binary — displayValue alone is clear, no percentile banding needed
  },
  {
    key: "yoga",
    label: "Yoga studio access",
    description: "Whether a yoga studio is present in the ZIP code.",
    displayValue: (p) => (p.has_yoga_studios_plz ? "yes, in ZIP code" : "no"),
    goodnessValue: null,
  },
  {
    key: "gym",
    label: "Gym access",
    description: "Whether a fitness centre is present in the ZIP code.",
    displayValue: (p) => (p.has_gym_plz ? "yes, in ZIP code" : "no"),
    goodnessValue: null,
  },
  {
    key: "bouldering",
    label: "Bouldering gym access",
    description: "Whether a bouldering/climbing gym is present in the ZIP code.",
    displayValue: (p) => (p.has_bouldering_plz ? "yes, in ZIP code" : "no"),
    goodnessValue: null,
  },
  {
    key: "transit_access",
    label: "Transit access",
    description: "Distance to the nearest transit station.",
    displayValue: (p) =>
      p.transit_distance_km == null ? "unknown" : `${p.transit_distance_km.toFixed(2)} km to ${p.nearest_transit_station ?? "nearest station"}`,
    goodnessValue: (p) => (p.transit_distance_km == null ? null : -p.transit_distance_km),
  },
  {
    key: "wohnlage",
    label: "Residential address rating (Wohnlage)",
    description: "Berlin's official residential-quality classification (einfach/mittel/gut).",
    displayValue: (p) => p.dominant_wohnlage ?? "unknown",
    goodnessValue: (p) => (p.dominant_wohnlage && p.dominant_wohnlage in WOHNLAGE_SCALE ? WOHNLAGE_SCALE[p.dominant_wohnlage] : null),
  },
  {
    key: "socioeconomic_status",
    label: "Socioeconomic status index",
    description: "Official Status-Index — HIGHER means MORE advantaged. Shown as context only, never used in scoring.",
    displayValue: (p) => (p.ug_soziale_benachteiligung && p.ug_soziale_benachteiligung !== "-" ? p.ug_soziale_benachteiligung : "unknown"),
    goodnessValue: (p) =>
      p.ug_soziale_benachteiligung && p.ug_soziale_benachteiligung in STATUS_INDEX_SCALE
        ? STATUS_INDEX_SCALE[p.ug_soziale_benachteiligung]
        : null,
  },
  {
    key: "distance_from_center",
    label: "Distance from city center (Alexanderplatz)",
    description:
      "Straight-line distance from Alexanderplatz. This product deliberately favors GREATER distance " +
      "(a decentralization stance) — there is no universal 'better' direction here, judge it in that context, not " +
      "as a generic commute complaint.",
    displayValue: (p) => `${p.distance_from_center_km.toFixed(1)} km`,
    goodnessValue: null,
  },
  {
    key: "school_construction_activity",
    label: "School construction/expansion activity",
    description: "Count of planned school construction projects — investment signal, not inherently good or bad (can mean growth or disruption).",
    displayValue: (p) => `${p.n_school_construction_projects} planned project(s)`,
    goodnessValue: null,
  },
];

export const CONTEXT_CRITERIA_KEYS = CONTEXT_CRITERIA.map((c) => c.key) as [string, ...string[]];

/** Free-text topics with genuinely no data behind them anywhere in this
 *  project — listed explicitly so the agent doesn't keep trying to guess a
 *  matching category for them. Not exhaustive, just the common ones. */
export const UNAVAILABLE_TOPICS =
  "nightlife/bars/clubs, cafes/coffee shops, general (non-school) construction or development, " +
  "internet speed, views/aesthetics, walkability, parking availability";

const ALL = getAllPlanungsraeume();
const goodnessDistributions = new Map<string, number[]>();
for (const c of CONTEXT_CRITERIA) {
  if (!c.goodnessValue) continue;
  const values = ALL.map(c.goodnessValue).filter((v): v is number => v != null);
  goodnessDistributions.set(c.key, values.sort((a, b) => a - b));
}

function percentile(key: string, value: number): number {
  const dist = goodnessDistributions.get(key);
  if (!dist || dist.length === 0) return 50;
  const rank = dist.filter((v) => v <= value).length;
  return Math.round((rank / dist.length) * 100);
}

/** null = not notable enough to mention (broadly average). */
function notabilityNote(pct: number): string | null {
  if (pct >= 90) return "one of the best citywide (top 10%)";
  if (pct >= 75) return "well above average (top quarter)";
  if (pct <= 10) return "one of the worst citywide (bottom 10%)";
  if (pct <= 25) return "well below average (bottom quarter)";
  return null;
}

export interface ContextCriterionResult {
  key: string;
  label: string;
  value: string;
  /** Present only for criteria with a defensible universal direction AND
   *  where the value is actually notable — see notabilityNote. */
  notability: string | null;
}

/** Node 2+3 combined: given already-validated criterion keys (the agent
 *  matched free text to these itself — invalid keys can't reach this
 *  function, since the tool's Zod schema only accepts CONTEXT_CRITERIA_KEYS)
 *  and a Planungsraum, return each criterion's real value and — where a
 *  universal direction exists — how notable it is city-wide. */
export function evaluateContextCriteria(keys: string[], p: PlanungsraumProfile): ContextCriterionResult[] {
  return keys
    .map((key) => CONTEXT_CRITERIA.find((c) => c.key === key))
    .filter((c): c is ContextCriterion => c != null)
    .map((c) => {
      const value = c.displayValue(p);
      const goodness = c.goodnessValue?.(p);
      const notability = goodness == null ? null : notabilityNote(percentile(c.key, goodness));
      return { key: c.key, label: c.label, value, notability };
    });
}
