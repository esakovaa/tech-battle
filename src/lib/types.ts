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

  // Crime — Bezirk-level only, raw count (not per-capita)
  crime_total_avg_2017_2019: number | null;

  // Yoga / Kinderarzt — real (OSM/Overpass). PLR-level counts are heavily
  // zero-inflated; the _plz fields are "does this ZIP code have one at all"
  // and are what ranking should use (see README).
  n_yoga_studios: number;
  n_kinderarzt: number;
  n_yoga_studios_plz: number;
  n_kinderarzt_plz: number;
  has_yoga_studio_plz: 0 | 1;
  has_kinderarzt_plz: 0 | 1;
}

// The 9 user-facing ranking factors. Weights come from a 1-5 rating each,
// normalized to sum to 1 before scoring.
export interface FactorWeights {
  price: number;
  location_quality: number;
  green_space: number;
  environmental_comfort: number; // noise+air+heat combined (ug_mehrfachbelastung_umwelt)
  safety: number;
  schools: number;
  kitas: number;
  transit: number;
  family_hobbies_access: number; // has_kinderarzt_plz + has_yoga_studio_plz combined
}

export interface RankedResult {
  plr: PlanungsraumProfile;
  score: number;
  factorScores: Record<keyof FactorWeights, number>; // each 0-1, direction-corrected
}
