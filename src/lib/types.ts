// Mirrors Kiez Profile Master Table/planungsraum_profile.csv exactly.
// See that folder's README.md for grain/trust-level notes per column —
// especially the Status-Index direction warning and the real-vs-synthetic
// price distinction.
export interface PlanungsraumProfile {
  plr_id: string;
  plr_name: string;
  bezirk: string;
  dominant_plz: string;
  lat: number;
  lon: number;
  n_addresses: number;

  // Wohnlage (real, exact)
  pct_wohnlage_einfach: number;
  pct_wohnlage_mittel: number;
  pct_wohnlage_gut: number;
  dominant_wohnlage: "einfach" | "mittel" | "gut";

  // Umweltgerechtigkeit (real, exact — ordinal categories, not numbers)
  ug_laerm: "gering" | "mittel" | "hoch" | null;
  ug_luft: "gering" | "mittel" | "hoch" | null;
  ug_gruenversorgung: "gut" | "mittel" | "schlecht" | null;
  ug_thermisch: "gering" | "mittel" | "hoch" | null;
  ug_soziale_benachteiligung: string | null; // "hoher/mittlerer/niedriger Status-Index" — HIGHER = MORE ADVANTAGED
  // "how many burden criteria stack up" scale — NOT gering/mittel/hoch,
  // verified against actual data. 5-level for _umwelt, 6-level for _sozial.
  ug_mehrfachbelastung_umwelt:
    | "keine starke Belastung"
    | "einfach"
    | "zweifach"
    | "dreifach"
    | "vierfach"
    | null;
  ug_mehrfachbelastung_umwelt_sozial:
    | "keine starke Belastung"
    | "einfach"
    | "zweifach"
    | "dreifach"
    | "vierfach"
    | "fünffach"
    | null;
  ug_gesamt_umweltgerechtigkeitskarte: string | null; // same family, only present on flagged hotspot areas

  // Kitas (real, exact)
  n_kitas: number;
  total_kita_capacity: number | null;

  // Schools — construction/expansion activity (real, exact; NOT a quality signal)
  n_school_construction_projects: number;
  n_unique_schools_with_projects: number;
  total_planned_school_capacity: number | null;

  // Abitur — school quality (real; exact PLR match sparse, Bezirk fallback complete)
  abitur_mn_scls_plr_avg: number | null; // lower = better (German grading)
  abitur_performance_vs_peer_plr_avg: number | null;
  n_abitur_schools_in_plr: number;
  abitur_mn_scls_bezirk_avg: number | null;
  abitur_performance_vs_peer_bezirk_avg: number | null;

  // Price (synthetic = ranking-precise but ~25-40% below real market level;
  // real = trustworthy absolute number but PLZ-inherited, not PLR-exact)
  rent_per_m2_kalt_avg_synthetic: number | null;
  n_rental_listings_synthetic: number;
  buy_price_per_m2_avg_synthetic: number | null;
  n_synthetic_sales_listings: number;
  buy_price_per_m2_avg_REAL: number | null;
  n_real_listings: number;
  new_construction_price_per_m2_avg: number | null;
  n_new_construction_listings: number;

  // Transit (real)
  nearest_transit_station: string | null;
  nearest_transit_line: string | null;
  transit_distance_km: number | null;

  // Crime — Bezirk-level only. crime_total_avg_2017_2019 is the raw count
  // (not per-capita); crime_rate_per_10k_2017_2019 (below) normalizes it by
  // real Bezirk population and is the one to use for comparisons.
  crime_total_avg_2017_2019: number | null;

  // Population by age band (real; Kaggle "Berlin District Population",
  // real at PLZ x Bezirk grain only — allocated down to Planungsraum by
  // real address-count share within that cell, not a uniform guess).
  // pct_population_coverage < 100 means some of this Planungsraum's
  // addresses fell outside a matched population cell (never 0/no-data).
  n_population: number;
  n_population_under6: number;
  n_population_6_15: number;
  n_population_15_18: number;
  n_population_18_27: number;
  n_population_27_45: number;
  n_population_45_55: number;
  n_population_55_65: number;
  n_population_65plus: number;
  n_population_female: number;
  pct_population_coverage: number;
  bezirk_population: number;
  crime_rate_per_10k_2017_2019: number | null;

  // Yoga / Kinderarzt / gym / bouldering — real (OSM/Overpass). PLR-level
  // counts are zero-inflated to varying degrees; the _plz fields ("does
  // this ZIP code have one at all") are what filtering/ranking should use
  // — see Kiez Profile Master Table/README.md.
  n_yoga_studios: number;
  n_kinderarzt: number;
  n_gym: number;
  n_bouldering: number;
  n_yoga_studios_plz: number;
  n_kinderarzt_plz: number;
  n_gym_plz: number;
  n_bouldering_plz: number;
  has_yoga_studios_plz: 0 | 1;
  has_kinderarzt_plz: 0 | 1;
  has_gym_plz: 0 | 1;
  has_bouldering_plz: 0 | 1;
}

// ---------------------------------------------------------------
// User intake — mirrors the actual 6 questions currently being asked
// (question 7, commute, is deferred; accepted but not yet used).
// ---------------------------------------------------------------
export interface KidsCriteria {
  kita: boolean;
  /** No reliable data source exists for this yet (only Abitur/Oberstufe
   *  data, which is high school). Never used as a filter or score input —
   *  see PRIMARY_SCHOOL_DATA_AVAILABLE in rank.ts. Kept in the schema so
   *  the frontend can still show the checkbox and an honest "no data yet"
   *  note rather than silently dropping the question. */
  primarySchool: boolean;
  highSchool: boolean;
  kidDoctor: boolean;
}

export interface HobbiesCriteria {
  yoga: boolean;
  gym: boolean;
  bouldering: boolean;
}

export type RentBudget = "minimal" | "flexible" | "not_a_concern";

export interface UserPreferences {
  /** Either pass a resolved plr_id directly, or a free-text address to be
   *  geocoded server-side (see lib/geocode.ts). */
  currentPlrId?: string;
  currentAddress?: string;
  kids: KidsCriteria;
  rentBudget: RentBudget;
  noiseAirSensitive: boolean;
  parksImportant: boolean;
  hobbies: HobbiesCriteria;
  // commuteAddresses?: string[] — question 7, added once the commute script lands
}

// The soft-weighted (non-filter) scoring factors, derived from the intake
// above. Only kids.kita/kidDoctor are hard filters (see deriveFilters in
// rank.ts) — hobbies are a soft, deliberately lightly-weighted factor
// (see preferencesToWeights): a missing hobby shouldn't exclude an
// otherwise-great Kiez, just nudge it down a little. crime and
// kids_population are always-on baseline factors, not gated behind an
// intake answer — crime is bad for everyone, and family-with-kids density
// is scored for every user "in general" (kids.kita additionally
// double-weights the under-6 slice of it — see kidsPopulationScore).
export interface FactorWeights {
  price: number;
  green_space: number;
  noise_air: number;
  schools: number;
  hobbies: number;
  crime: number;
  kids_population: number;
}

export const SOFT_FACTOR_KEYS: (keyof FactorWeights)[] = [
  "price",
  "green_space",
  "noise_air",
  "schools",
  "hobbies",
  "crime",
  "kids_population",
];

export interface RankedResult {
  plr: PlanungsraumProfile;
  score: number;
  factorScores: Record<keyof FactorWeights, number | null>;
}

export interface RankResponse {
  current: PlanungsraumProfile;
  alternatives: RankedResult[];
  comparisonTable: unknown; // filled in by compare.ts's ComparisonTable
  secondBest: boolean;
  droppedFilters: string[];
  primarySchoolDataAvailable: false;
}
