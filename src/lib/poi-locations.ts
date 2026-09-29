import poiData from "@/data/poi_locations.json";

/** category matches the corresponding count-column name in
 *  PlanungsraumProfile (n_yoga_studios, n_kinderarzt, n_gym, n_bouldering)
 *  except "kita", which has no single matching column name (n_kitas is
 *  close enough conceptually, named differently for historical reasons —
 *  kept as "kita" here to avoid implying a 1:1 column match that isn't
 *  exact). Real point-in-polygon join — see
 *  "Kiez Profile Master Table/build_poi_locations.py". */
export type PoiCategory = "kita" | "n_yoga_studios" | "n_kinderarzt" | "n_gym" | "n_bouldering";

export interface PoiLocation {
  plr_id: string;
  category: PoiCategory;
  name: string;
  lat: number;
  lon: number;
}

const ALL: PoiLocation[] = poiData as unknown as PoiLocation[];

/** POIs inside one Planungsraum, optionally filtered to specific
 *  categories (e.g. only what the user actually selected in the intake). */
export function getPoisForKiez(plrId: string, categories?: PoiCategory[]): PoiLocation[] {
  const inKiez = ALL.filter((p) => p.plr_id === plrId);
  if (!categories || categories.length === 0) return inKiez;
  const wanted = new Set(categories);
  return inKiez.filter((p) => wanted.has(p.category));
}
