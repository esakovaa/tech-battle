import poiData from "@/data/poi_locations.json";
import type { UserPreferences } from "./types";

/** category matches the corresponding count-column name in
 *  PlanungsraumProfile (n_yoga_studios, n_kinderarzt, n_gym, n_bouldering)
 *  except "kita", which has no single matching column name (n_kitas is
 *  close enough conceptually, named differently for historical reasons —
 *  kept as "kita" here to avoid implying a 1:1 column match that isn't
 *  exact). Real point-in-polygon join — see
 *  "Kiez Profile Master Table/build_poi_locations.py". */
export type PoiCategory = "kita" | "n_yoga_studios" | "n_kinderarzt" | "n_gym" | "n_bouldering" | "n_cafe" | "n_playground";

export interface PoiLocation {
  plr_id: string;
  category: PoiCategory;
  name: string;
  lat: number;
  lon: number;
}

const ALL: PoiLocation[] = poiData as unknown as PoiLocation[];

/** POIs inside one Planungsraum, optionally filtered to specific
 *  categories (e.g. only what the user actually selected in the intake).
 *
 *  `categories` OMITTED (undefined) -> every category. `categories` an
 *  empty array -> nothing — deliberately NOT treated the same as omitted.
 *  A real user whose intake matched zero of the 5 mappable categories
 *  (see preferencesToPoiCategories) should see an empty map, not every
 *  POI in the Kiez; only a caller that explicitly wants "no filter" (the
 *  /map-test QA harness's default) should omit the argument entirely. */
export function getPoisForKiez(plrId: string, categories?: PoiCategory[]): PoiLocation[] {
  const inKiez = ALL.filter((p) => p.plr_id === plrId);
  if (categories === undefined) return inKiez;
  const wanted = new Set(categories);
  return inKiez.filter((p) => wanted.has(p.category));
}

/** Maps the user's actual intake answers to the map categories relevant to
 *  them — the single source of truth for "only show what this user asked
 *  about" on the per-Kiez map. Whoever renders <KiezMap> for a real user
 *  (not the /map-test QA harness, which lets you pick categories by hand)
 *  should pass this, not omit `categories` (which shows everything).
 *
 *  kids.highSchool/primarySchool are deliberately NOT mapped to anything —
 *  there is no point-location school data at all (see
 *  PRIMARY_SCHOOL_DATA_AVAILABLE in rank.ts and n_abitur_schools_in_plr in
 *  types.ts, which is a PLR-level aggregate, not individual school
 *  addresses). A school category on this map would have to be silently
 *  fabricated — omitted instead of faked. */
export function preferencesToPoiCategories(prefs: Pick<UserPreferences, "kids" | "hobbies">): PoiCategory[] {
  const categories: PoiCategory[] = [];
  if (prefs.kids.kita) categories.push("kita");
  if (prefs.kids.kidDoctor) categories.push("n_kinderarzt");
  if (prefs.hobbies.yoga) categories.push("n_yoga_studios");
  if (prefs.hobbies.gym) categories.push("n_gym");
  if (prefs.hobbies.bouldering) categories.push("n_bouldering");
  if (prefs.hobbies.cafe) categories.push("n_cafe");
  if (prefs.hobbies.playground) categories.push("n_playground");
  return categories;
}
