import rentalsData from "@/data/rentals_by_planungsraum.json";

// Mirrors the KEEP_COLUMNS trimmed by
// "Kiez Profile Master Table/build_rentals_by_planungsraum.py". Source:
// rentals.csv — the SYNTHETIC Kaggle hedonic-model dataset (see Kiez
// Profile Master Table/README.md), not scraped real listings. Prices run
// ~25-40% below real market level — fine for "here's roughly what a
// 3-room in this Kiez looks like," not to be shown as real current offers.
export interface ExampleListing {
  id: string;
  plr_id: string;
  rooms: number;
  area_m2: number;
  floor: number;
  total_floors: number;
  building_era: string;
  condition: string;
  has_lift: boolean;
  has_balcony: boolean;
  furnished: boolean;
  kaltmiete_eur_monthly: number;
  warmmiete_eur_monthly: number;
  rent_per_m2_kalt_eur: number;
  ortsteil: string;
  date_listed: string;
}

const ALL: ExampleListing[] = rentalsData as unknown as ExampleListing[];

export interface ExampleListingsResult {
  listings: ExampleListing[];
  /** False if fewer than `count` listings existed with the exact
   *  requested room count, so the gap was filled with the closest room
   *  counts available in that Kiez instead — same "degrade gracefully,
   *  tell the caller what happened" shape as rank.ts's filterWithDegradation. */
  exactRoomMatch: boolean;
}

/** Example flat listings for one Planungsraum, optionally sized to a room
 *  count. Called on demand when the user clicks into a recommended Kiez —
 *  not precomputed for every alternative up front. */
export function getExampleListings(plrId: string, roomsNeeded?: number, count = 3): ExampleListingsResult {
  const inKiez = ALL.filter((l) => l.plr_id === plrId);

  if (roomsNeeded == null) {
    return { listings: inKiez.slice(0, count), exactRoomMatch: true };
  }

  const exact = inKiez.filter((l) => l.rooms === roomsNeeded);
  if (exact.length >= count) {
    return { listings: exact.slice(0, count), exactRoomMatch: true };
  }

  // Not enough exact matches in this Kiez — fill the rest with the
  // closest room counts available, closest first.
  const rest = inKiez
    .filter((l) => l.rooms !== roomsNeeded)
    .sort((a, b) => Math.abs(a.rooms - roomsNeeded) - Math.abs(b.rooms - roomsNeeded));

  const listings = [...exact, ...rest].slice(0, count);
  return { listings, exactRoomMatch: listings.every((l) => l.rooms === roomsNeeded) };
}
