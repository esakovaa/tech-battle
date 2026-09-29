import type { UIMessage } from "ai";
import { findTopAlternatives, getPlanungsraumById } from "./rank";
import { buildComparisonTable, type ComparisonTable } from "./compare";
import { resolveAddressToPlanungsraum } from "./geocode";
import type { PlanungsraumProfile, RankedResult, UserPreferences } from "./types";
import { factorCopy } from "./wurzelraum";

/**
 * AGENT_MOCK=1 — a stand-in for the LLM behind /api/agent, for demos and
 * UI testing without an API key. It runs the real ranking, then answers
 * with pre-written replies filled in from that ranking's actual numbers.
 * It does NOT reason: follow-ups are matched by keyword to one of a fixed
 * set of topics. The route streams the text in the same UI-message-stream
 * format a real model produces, so the frontend path is identical.
 */

interface Ctx {
  current: PlanungsraumProfile;
  alts: RankedResult[];
  table: ComparisonTable;
  prefs: UserPreferences;
  bestIdx: number;
}

const EN: Record<string, string> = { gering: "low", mittel: "medium", hoch: "high", gut: "good", schlecht: "poor" };
const en = (v: string | null | undefined) => (v ? EN[v] ?? v : "unknown");
const station = (p: PlanungsraumProfile) => p.nearest_transit_station?.replace(" (Berlin)", "") ?? null;
const rentOf = (p: PlanungsraumProfile) => (p.rent_per_m2_kalt_avg_synthetic == null ? null : `€${p.rent_per_m2_kalt_avg_synthetic.toFixed(2)}/m²`);

function listJoin(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

async function buildCtx(prefs: UserPreferences): Promise<Ctx | { error: string }> {
  let plrId = prefs.currentPlrId;
  if (!plrId && prefs.currentAddress) plrId = (await resolveAddressToPlanungsraum(prefs.currentAddress))?.plr_id;
  const current = plrId ? getPlanungsraumById(plrId) : undefined;
  if (!current) return { error: "I couldn't find your current Kiez, so I can't compare anything yet." };
  const { results } = await findTopAlternatives(current.plr_id, prefs, 3);
  const table = buildComparisonTable(current, results, prefs);
  const bestIdx = results.reduce((bi, a, i) => (a.score > results[bi].score ? i : bi), 0);
  return { current, alts: results, table, prefs, bestIdx };
}

function narrative(c: Ctx): string {
  const best = c.alts[c.bestIdx].plr;
  const others = c.alts.filter((_, i) => i !== c.bestIdx).map((a) => a.plr);
  const quieter = en(best.ug_laerm) !== en(c.current.ug_laerm) ? `noise goes from ${en(c.current.ug_laerm)} to ${en(best.ug_laerm)}` : null;
  const greener = best.ug_gruenversorgung === "gut" && c.current.ug_gruenversorgung !== "gut" ? "green space is rated good rather than " + en(c.current.ug_gruenversorgung) : null;
  const rentLine =
    rentOf(best) && rentOf(c.current)
      ? ` Rents model at ${rentOf(best)} against ${rentOf(c.current)} in ${c.current.plr_name} — a pricing model, so trust the gap more than the exact figure.`
      : "";
  const cons = c.table.prosCons[c.bestIdx].cons;
  const tradeoff = cons.length
    ? `The honest trade-off: ${listJoin(cons.map((f) => { const t = factorCopy(f).con; return t.charAt(0).toLowerCase() + t.slice(1); }))} — worth weighing before you fall for it.`
    : `On everything you told me mattered, it doesn't lose to ${c.current.plr_name} anywhere, which is rare.`;
  const kids = best.n_population_under6 > c.current.n_population_under6 ? ` There are more under-sixes around, too — about ${best.n_population_under6.toLocaleString()} versus ${c.current.n_population_under6.toLocaleString()}.` : "";

  return [
    `If I were in your shoes, I'd look hardest at ${best.plr_name} in ${best.bezirk}. It's ${best.distance_from_center_km.toFixed(1)} km out from Alexanderplatz, and that distance buys you a different pace of life: ${listJoin([quieter, greener].filter(Boolean) as string[]) || "calmer streets and more room"}.${rentLine}${kids}`,
    tradeoff +
      (station(best) ? ` Getting around, your nearest station would be ${station(best)} (${best.nearest_transit_line}), ${best.transit_distance_km?.toFixed(1)} km away.` : "") +
      (c.alts[c.bestIdx].commuteMinutes != null ? ` Your commute would be roughly ${Math.round(c.alts[c.bestIdx].commuteMinutes!)} minutes door to door.` : ""),
    `Don't dismiss the other two. ${others.map((p) => `${p.plr_name} (${p.bezirk}) sits ${p.distance_from_center_km.toFixed(1)} km out with green space rated ${en(p.ug_gruenversorgung)}`).join("; ")}. Ask me anything — the car question, schools, rent, what evenings are like.`,
  ].join("\n\n");
}

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return (last?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ");
}

function followUp(q: string, c: Ctx): string {
  const s = q.toLowerCase();
  const names = c.alts.map((a) => a.plr);
  const best = names[c.bestIdx];

  if (/(car|auto|bahn|train|tram|bus|transit|commute|bike)/.test(s)) {
    const lines = c.alts.map(({ plr, commuteMinutes }) => {
      const st = station(plr) ? `${station(plr)} (${plr.nearest_transit_line}), ${plr.transit_distance_km?.toFixed(1)} km away` : "no station on record";
      return `${plr.plr_name}: ${st}${commuteMinutes != null ? `, about ${Math.round(commuteMinutes)} min to work` : ""}`;
    });
    const closest = [...names].sort((a, b) => (a.transit_distance_km ?? 99) - (b.transit_distance_km ?? 99))[0];
    return `Good that you raised it — going car-free changes the maths more than anything else. Here's how close each one is to public transport:\n\n${lines.join("\n")}\n\nWithout a car I'd favour ${closest.plr_name}: its nearest stop is the shortest walk, and that matters every single morning with a stroller.`;
  }
  if (/(rent|price|afford|cheap|expensive|budget|money|cost)/.test(s)) {
    const sorted = [...names].filter((p) => rentOf(p)).sort((a, b) => a.rent_per_m2_kalt_avg_synthetic! - b.rent_per_m2_kalt_avg_synthetic!);
    return `On rent, the order runs ${sorted.map((p) => `${p.plr_name} (${rentOf(p)})`).join(", then ")} — against ${rentOf(c.current) ?? "unknown"} where you are now. These come from a pricing model that sits below real asking prices, so use them to compare Kieze, not to budget to the euro. ${sorted[0] ? `${sorted[0].plr_name} is where your money stretches furthest.` : ""}`;
  }
  if (/(school|schule|abitur|gymnas)/.test(s)) {
    return "I'll be straight with you: there's no reliable primary-school data in what I can see, so I won't pretend to rank them. For high schools there are average Abitur grades per district — tick “High school” in your answers and I'll fold them in. For primary schools, the Bezirk's school office (Schulamt) can tell you the catchment school for a specific address.";
  }
  if (/(quiet|noise|loud|night|air|pollution|sleep)/.test(s)) {
    return names.map((p) => `${p.plr_name}: noise ${en(p.ug_laerm)}, air pollution ${en(p.ug_luft)}`).join("\n") + `\n\nFor comparison, ${c.current.plr_name} is noise ${en(c.current.ug_laerm)}, air ${en(c.current.ug_luft)}. If sleep is the priority, the “low noise” ones are the safe bet — these are the city's own environmental-justice ratings, not guesses.`;
  }
  if (/(park|green|nature|playground|forest|lake)/.test(s)) {
    return names.map((p) => `${p.plr_name}: green space ${en(p.ug_gruenversorgung)}`).join("\n") + `\n\n${c.current.plr_name} rates ${en(c.current.ug_gruenversorgung)}. The rating is about how much green is within walking reach of home — exactly what matters for after-Kita afternoons.`;
  }
  if (/(safe|crime|danger)/.test(s)) {
    return names.map((p) => `${p.plr_name}: ${p.crime_rate_per_10k_2017_2019?.toFixed(0) ?? "?"} incidents per 10k residents`).join("\n") + `\n\n${c.current.plr_name}: ${c.current.crime_rate_per_10k_2017_2019?.toFixed(0) ?? "?"}. One caveat: these are district-wide figures from 2017–2019, so they tell you about the Bezirk, not your street.`;
  }
  if (/(kita|daycare|nursery|doctor|arzt)/.test(s)) {
    return names.map((p) => `${p.plr_name}: ${p.n_kitas} Kitas${p.total_kita_capacity ? ` (about ${p.total_kita_capacity} places)` : ""}, kids' doctor in the ZIP code: ${p.has_kinderarzt_plz ? "yes" : "no"}`).join("\n") + `\n\nIn Berlin the number of places matters more than the number of Kitas — apply early wherever you land.`;
  }
  if (/(yoga|gym|boulder|climb|sport)/.test(s)) {
    return names.map((p) => `${p.plr_name}: yoga ${p.has_yoga_studios_plz ? "yes" : "no"}, gym ${p.has_gym_plz ? "yes" : "no"}, bouldering ${p.has_bouldering_plz ? "yes" : "no"}`).join("\n") + "\n\nThat's from OpenStreetMap at ZIP-code level, so a small studio can be missing — worth a quick search before you rule a place out.";
  }
  if (/(which|pick|choose|recommend|best|you think)/.test(s)) {
    return `${best.plr_name}. It scored highest on the things you said matter, and its trade-offs are the kind you can plan around. If one thing would change my mind, it's the commute — tell me more about your daily trips and I'll say which of the three holds up best.`;
  }
  return `That's a good question, but I'm running in mock mode, so I only have answers prepared for transport without a car, rent, schools, noise and air, parks, safety, Kitas and doctors, and hobbies. Switch on a real model with an API key in .env.local and I can take anything.`;
}

/** The full reply text for this turn — narrative on the first turn, a
 *  topic-matched follow-up afterwards. */
export async function mockAgentReply(prefs: UserPreferences, messages: UIMessage[]): Promise<string> {
  const ctx = await buildCtx(prefs);
  if ("error" in ctx) return ctx.error;
  const userTurns = messages.filter((m) => m.role === "user");
  // First turn: no messages, or only the kickoff request.
  if (userTurns.length <= 1 && messages.filter((m) => m.role === "assistant").length === 0) return narrative(ctx);
  return followUp(lastUserText(messages), ctx);
}
