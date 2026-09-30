// Client-side presentation helpers for the Wurzelraum UI (src/components/wr).
// Pure functions over the /api/rank response — no server-only imports, so
// this is safe to bundle into client components. Everything shown to the
// user is derived from real rank/compare output; nothing here invents data.

import type { ComparisonTable } from "./compare";
import type { ExampleListing } from "./listings";
import type { PoiCategory } from "./poi-locations";
import type { PlanungsraumProfile, RankedResult, UserPreferences } from "./types";

export interface RankApiResponse {
  current: PlanungsraumProfile;
  alternatives: RankedResult[];
  comparisonTable: ComparisonTable;
  secondBest: boolean;
  droppedFilters: string[];
  distinctRadiusTiers: boolean;
  distanceConstraintRelaxed: boolean;
  commuteConstraintRelaxed: boolean;
  primarySchoolDataAvailable: false;
  primarySchoolNote?: string;
}

export interface ListingsApiResponse {
  plrId: string;
  roomsRequested: number | null;
  exactRoomMatch: boolean;
  listings: ExampleListing[];
  note: string;
}

export type Direction = "better" | "worse" | "same";

// ---------------------------------------------------------------
// Factor labels. compare.ts names factors for the agent/data layer;
// these are the short, family-facing versions shown in chips and tables.
// ---------------------------------------------------------------
interface FactorCopy {
  label: string;
  pro: string;
  con: string;
}

export function factorCopy(factor: string): FactorCopy {
  if (factor.startsWith("Distance from city center")) return { label: "Distance from centre", pro: "Further out, more space", con: "Closer to the centre" };
  if (factor.startsWith("Crime rate")) return { label: "Crime rate", pro: "Lower crime rate", con: "Higher crime rate" };
  if (factor.startsWith("Kids population")) return { label: "Kids population", pro: "More families with kids", con: "Fewer families with kids" };
  if (factor === "Rent") return { label: "Rent (cold, per m²)", pro: "Lower rent", con: "Higher rent" };
  if (factor === "Noise") return { label: "Noise", pro: "Quieter streets", con: "Noisier streets" };
  if (factor === "Air quality") return { label: "Air pollution", pro: "Cleaner air", con: "More air pollution" };
  if (factor.startsWith("Green space")) return { label: "Parks & green space", pro: "More green space", con: "Less green space" };
  if (factor.startsWith("High school")) return { label: "High schools (Abitur avg.)", pro: "Stronger high schools", con: "Weaker high schools" };
  if (factor === "Kita") return { label: "Kitas", pro: "More Kitas nearby", con: "Fewer Kitas nearby" };
  if (factor === "Kinderarzt") return { label: "Kids' doctor", pro: "Kids' doctor in the ZIP code", con: "No kids' doctor in the ZIP code" };
  if (factor === "Yoga studio") return { label: "Yoga", pro: "Yoga studio nearby", con: "No yoga studio in the ZIP code" };
  if (factor === "Gym") return { label: "Gym", pro: "Gym nearby", con: "No gym in the ZIP code" };
  if (factor === "Bouldering") return { label: "Bouldering", pro: "Bouldering nearby", con: "No bouldering in the ZIP code" };
  return { label: factor, pro: factor, con: factor };
}

const ORDINAL_EN: Record<string, string> = {
  gering: "low",
  mittel: "medium",
  hoch: "high",
  gut: "good",
  schlecht: "poor",
  unknown: "no data",
};

/** compare.ts displays some values in German (Umweltgerechtigkeit ordinals)
 *  and a few in data-layer phrasing — translate for display only. */
export function displayValue(v: string): string {
  if (v in ORDINAL_EN) return ORDINAL_EN[v];
  if (v === "Yes (in ZIP code)") return "Yes, in ZIP code";
  return v;
}

/** context-criteria.ts labels some criteria by the thing measured ("Air
 *  quality") while the value is a pollution/noise LEVEL ("high") — relabel
 *  so "high" reads the right way round. */
const CONTEXT_LABELS: Record<string, string> = {
  air_quality: "Air pollution",
  noise: "Noise level",
};
export const contextLabel = (key: string, fallback: string) => CONTEXT_LABELS[key] ?? fallback;

export function cellDirection(table: ComparisonTable, altIndex: number, factor: string): Direction {
  const pc = table.prosCons[altIndex];
  if (!pc) return "same";
  if (pc.pros.includes(factor)) return "better";
  if (pc.cons.includes(factor)) return "worse";
  return "same";
}

// ---------------------------------------------------------------
// Photos. There are no per-Planungsraum photos in the dataset, so cards
// use an illustrative pool (public/photos, from the repo's photos/ folder)
// assigned deterministically — always labelled "illustrative" in the UI.
// ---------------------------------------------------------------
const KIEZ_PHOTOS = [
  { src: "/photos/kiez-1.jpg", alt: "A quiet cobbled street lined with old houses" },
  { src: "/photos/kiez-2.jpg", alt: "Green meadows and trees at the edge of the city" },
  { src: "/photos/kiez-3.jpg", alt: "Kids playing in a leafy park" },
  { src: "/photos/kiez-4.jpg", alt: "A tree-lined residential street with a parked bike" },
  { src: "/photos/kiez-5.jpg", alt: "A meadow full of wildflowers" },
  { src: "/photos/kiez-6.jpg", alt: "A wide street with shops and cafés" },
  { src: "/photos/kiez-7.jpg", alt: "Open fields and hills under a blue sky" },
  { src: "/photos/kiez-8.jpg", alt: "A café corner on a neighbourhood street" },
  { src: "/photos/kiez-9.jpg", alt: "A busy shopping street after rain" },
];
const GREEN_PHOTOS = [1, 2, 4, 6];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Distinct illustrative photos for a set of Kieze — green-leaning photos
 *  for Kieze with good green space, street photos otherwise. */
export function assignKiezPhotos(plrs: PlanungsraumProfile[]): { src: string; alt: string }[] {
  const used = new Set<number>();
  return plrs.map((p) => {
    const green = p.ug_gruenversorgung === "gut";
    const pool = green ? GREEN_PHOTOS : KIEZ_PHOTOS.map((_, i) => i).filter((i) => !GREEN_PHOTOS.includes(i));
    let idx = pool[hash(p.plr_id) % pool.length];
    for (let k = 0; used.has(idx) && k < KIEZ_PHOTOS.length; k++) idx = (idx + 1) % KIEZ_PHOTOS.length;
    used.add(idx);
    return KIEZ_PHOTOS[idx];
  });
}

const FLAT_PHOTOS = [
  { src: "/photos/flat-1.jpg", alt: "Bright living room with a lounge chair and plants" },
  { src: "/photos/flat-2.jpg", alt: "Light kitchen with wooden floors" },
  { src: "/photos/flat-3.jpg", alt: "Warm bedroom with a window seat" },
  { src: "/photos/flat-4.jpg", alt: "Small kitchen with yellow cabinets" },
];
/** Distinct photos across one Kiez's listings: offset by the Kiez, then by
 *  position, so the three cards never repeat a photo. */
export function flatPhoto(plrId: string, index: number) {
  return FLAT_PHOTOS[(hash(plrId) + index) % FLAT_PHOTOS.length];
}

// ---------------------------------------------------------------
// Listings formatting
// ---------------------------------------------------------------
const CONDITION_EN: Record<string, string> = {
  modernisiert: "Modernised",
  saniert: "Refurbished",
  kernsaniert: "Fully renovated",
  renovierungsbedürftig: "Needs renovation",
  renoviert: "Renovated",
};
const ERA_EN: Record<string, string> = {
  altbau_pre_1949: "Altbau (pre-1949)",
  post_war_1949_1990: "Post-war (1949–1990)",
  modern_1990_2010: "1990–2010 build",
  new_post_2010: "New build (post-2010)",
};
export const conditionLabel = (c: string) => CONDITION_EN[c] ?? c;
export const eraLabel = (e: string) => ERA_EN[e] ?? e;

export function floorLabel(floor: number, total: number): string {
  if (floor === 0) return `Ground floor of ${total}`;
  const n = floor;
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${suffix} of ${total} floors`;
}

export const euro = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`;

// ---------------------------------------------------------------
// Narrative — the deterministic fallback used when /api/agent isn't
// configured (no LLM key). Built only from rank/compare output.
// ---------------------------------------------------------------
function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function lower(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function summarySentence(data: RankApiResponse): string {
  const c = data.current;
  const bits: string[] = [];
  if (c.ug_laerm === "hoch") bits.push("loud");
  if (c.ug_luft === "hoch") bits.push("hard on the air");
  if (c.ug_gruenversorgung === "schlecht") bits.push("short on green space");
  const tone = bits.length ? `, and for a family it's ${list(bits)}` : "";
  return `${c.plr_name} sits ${c.distance_from_center_km.toFixed(1)} km from Alexanderplatz${tone}. Here are three Kieze further out that fit what you told us.`;
}

export function composeNarrative(data: RankApiResponse, prefs: UserPreferences): string {
  const { current, alternatives, comparisonTable: t } = data;
  if (!alternatives.length) return "We couldn't find alternatives that fit — try loosening one of your answers.";

  const bestIdx = alternatives.reduce((bi, a, i) => (a.score > alternatives[bi].score ? i : bi), 0);
  const best = alternatives[bestIdx];
  const pc = t.prosCons[bestIdx];
  const rentRow = t.rows.find((r) => r.factor === "Rent");

  const paras: string[] = [];
  const pros = pc.pros.map((f) => lower(factorCopy(f).pro)).slice(0, 4);
  let p1 = `If you move to ${best.plr.plr_name} in ${best.plr.bezirk}, the biggest change is the pace of your days: ${list(pros)}.`;
  if (rentRow && rentRow.current !== "unknown" && rentRow.alternatives[bestIdx] !== "unknown") {
    p1 += ` Rent here models at ${rentRow.alternatives[bestIdx]} against ${rentRow.current} where you are now — treat that as a relative signal, not an asking price.`;
  }
  p1 += ` It's ${best.plr.distance_from_center_km.toFixed(1)} km from the centre, which is exactly the point: more room, less pressure on the inner city.`;
  paras.push(p1);

  const cons = pc.cons.map((f) => lower(factorCopy(f).con));
  const p2parts: string[] = [];
  if (cons.length) p2parts.push(`The honest trade-off: ${list(cons)}.`);
  else p2parts.push(`On everything you told us mattered, it doesn't lose to ${current.plr_name} anywhere.`);
  if (best.commuteMinutes != null) p2parts.push(`Your commute would be about ${Math.round(best.commuteMinutes)} minutes by public transport.`);
  if (best.plr.nearest_transit_station) {
    p2parts.push(`The nearest station is ${best.plr.nearest_transit_station.replace(" (Berlin)", "")} (${best.plr.nearest_transit_line}), ${best.plr.transit_distance_km?.toFixed(1)} km away.`);
  }
  paras.push(p2parts.join(" "));

  const others = alternatives
    .map((a, i) => ({ a, i }))
    .filter(({ i }) => i !== bestIdx)
    .map(({ a, i }) => {
      const top = t.prosCons[i].pros.filter((f) => !f.startsWith("Distance")).map((f) => lower(factorCopy(f).pro)).slice(0, 2);
      return `${a.plr.plr_name} (${a.plr.bezirk}) ${top.length ? `stands out for ${list(top)}` : "is a solid middle ground"}`;
    });
  if (others.length) paras.push(`The other two are worth a look too: ${others.join("; ")}.`);

  if (prefs.additionalContext?.trim()) {
    paras.push(
      `You also told us: “${prefs.additionalContext.trim().replace(/\n/g, "; ")}”. What the data can say about that is in “What else you mentioned” above — and where it's silent, we say so rather than guess.`
    );
  }

  const notes: string[] = [];
  if (prefs.kids.primarySchool) notes.push("There's no reliable primary-school data yet, so that answer didn't change the ranking.");
  if (data.droppedFilters.length) notes.push(`To find three matches we had to relax: ${data.droppedFilters.join(", ")}.`);
  if (data.distanceConstraintRelaxed) notes.push("You already live far out, so not every pick could be further from the centre than you are now.");
  if (!data.distinctRadiusTiers) notes.push("Berlin's geography didn't leave options at three different distances this time.");
  if (notes.length) paras.push(notes.join(" "));

  return paras.join("\n\n");
}

// ---------------------------------------------------------------
// Follow-up answers when the LLM agent isn't configured: keyword-routed,
// answered from the same rank data. Honest about being limited.
// ---------------------------------------------------------------
export function offlineAnswer(question: string, data: RankApiResponse, prefs: UserPreferences): string {
  const q = question.toLowerCase();
  const alts = data.alternatives;
  const name = (p: PlanungsraumProfile) => p.plr_name;

  if (/(car|auto|transit|bahn|train|tram|bus|commute|pendel|ubahn|sbahn|bike)/.test(q)) {
    const lines = alts.map(({ plr, commuteMinutes }) => {
      const st = plr.nearest_transit_station ? `${plr.nearest_transit_station.replace(" (Berlin)", "")} (${plr.nearest_transit_line}) is ${plr.transit_distance_km?.toFixed(1)} km away` : "no station data";
      const cm = commuteMinutes != null ? `, about ${Math.round(commuteMinutes)} min to your commute address` : "";
      return `${name(plr)}: ${st}${cm}`;
    });
    return `Without a car, the station matters most. ${lines.join(". ")}. Closer than about 1 km means an easy walk with a stroller.`;
  }
  if (/(school|schule|grundschule|gymnas|abitur)/.test(q)) {
    return "Honest answer: there's no reliable primary-school dataset yet, so we can't compare those. For high schools we have average Abitur grades (lower is better) — tick “High school” in your answers and they'll appear in the table.";
  }
  if (/(rent|price|money|afford|cheap|expensive|miete|budget|cost)/.test(q)) {
    const row = data.comparisonTable.rows.find((r) => r.factor === "Rent");
    if (!row) return "You told us rent isn't a concern, so we left it out of the comparison. Switch your budget answer and we'll include it.";
    return `Modelled cold rent per m²: ${data.current.plr_name} ${row.current}; ${alts.map((a, i) => `${name(a.plr)} ${row.alternatives[i]}`).join("; ")}. These come from a pricing model that runs below real asking prices, so compare them with each other rather than with listings you see online.`;
  }
  if (/(quiet|noise|loud|air|lärm|pollution)/.test(q)) {
    return alts.map((a) => `${name(a.plr)}: noise ${ORDINAL_EN[a.plr.ug_laerm ?? "unknown"]}, air pollution ${ORDINAL_EN[a.plr.ug_luft ?? "unknown"]}`).join(". ") + `. For comparison, ${data.current.plr_name} is noise ${ORDINAL_EN[data.current.ug_laerm ?? "unknown"]}, air ${ORDINAL_EN[data.current.ug_luft ?? "unknown"]}.`;
  }
  if (/(park|green|nature|grün|playground|spielplatz)/.test(q)) {
    return alts.map((a) => `${name(a.plr)}: green space ${ORDINAL_EN[a.plr.ug_gruenversorgung ?? "unknown"]}, playgrounds ${a.plr.has_playground_plz ? "yes" : "no"} in the ZIP code`).join(". ") + `. ${data.current.plr_name} rates ${ORDINAL_EN[data.current.ug_gruenversorgung ?? "unknown"]}.`;
  }
  if (/(cafe|café|coffee|kaffee)/.test(q)) {
    return alts.map((a) => `${name(a.plr)}: ${a.plr.has_cafe_plz ? "yes, cafes in the ZIP code" : "none mapped in the ZIP code"}`).join(". ") + ". These come from OpenStreetMap, so small independent cafes can be missing.";
  }
  if (/(safe|crime|danger|night)/.test(q)) {
    return alts.map((a) => `${name(a.plr)}: ${a.plr.crime_rate_per_10k_2017_2019?.toFixed(0) ?? "?"} per 10k residents`).join(". ") + `. ${data.current.plr_name}: ${data.current.crime_rate_per_10k_2017_2019?.toFixed(0) ?? "?"}. These are district-level figures from 2017–2019, so treat them as a rough relative signal.`;
  }
  if (/(kita|daycare|nursery|krippe)/.test(q)) {
    return alts.map((a) => `${name(a.plr)}: ${a.plr.n_kitas} Kitas${a.plr.total_kita_capacity ? ` with about ${a.plr.total_kita_capacity} places` : ""}`).join(". ") + `. ${data.current.plr_name} has ${data.current.n_kitas}.`;
  }
  if (/(doctor|arzt|kinderarzt|pediatric)/.test(q)) {
    return alts.map((a) => `${name(a.plr)}: ${a.plr.has_kinderarzt_plz ? "yes, a kids' doctor in the ZIP code" : "none mapped in the ZIP code"}`).join(". ") + ".";
  }
  if (/(yoga|gym|boulder|climb|sport)/.test(q)) {
    return alts
      .map((a) => `${name(a.plr)}: yoga ${a.plr.has_yoga_studios_plz ? "yes" : "no"}, gym ${a.plr.has_gym_plz ? "yes" : "no"}, bouldering ${a.plr.has_bouldering_plz ? "yes" : "no"} (in the ZIP code)`)
      .join(". ") + ". These come from OpenStreetMap, so small studios can be missing.";
  }
  void prefs;
  return "I can answer from the data about transport without a car, rent, noise and air, parks, playgrounds, cafes, safety, Kitas, kids' doctors, schools and hobbies. Try one of those — live, open-ended answers need the AI agent switched on (an API key in .env.local).";
}

/** Same mapping as preferencesToPoiCategories in lib/poi-locations.ts —
 *  duplicated here because importing that module would bundle its 400KB
 *  POI dataset into the client. Keep the two in sync. */
export function poiCategoriesFor(prefs: Pick<UserPreferences, "kids" | "hobbies">): PoiCategory[] {
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
