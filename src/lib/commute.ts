import { getBoundaryFeature } from "./geocode";
import { outlineCentroid } from "./geo";

/**
 * Real transit commute time (not map distance) from an arbitrary
 * user-supplied commute address to a Planungsraum, via VBB's live journey
 * planner (v6.vbb.transport.rest — a different domain from the static GTFS
 * files used elsewhere in this project for nearest_transit_station).
 *
 * Scope note: this is NOT run against all 542 Planungsräume per request —
 * VBB rate-limits to roughly 100 req/min (per the existing
 * src/tools/commute.py script), so that would take minutes per ranking
 * request. Instead rank.ts only calls this for a bounded shortlist (already
 * narrowed by the existing hard/soft filters), and results are cached by
 * (rounded origin, plr_id) for the life of the server process so repeat
 * requests for the same address are instant.
 */

const VBB_API_URL = "https://v6.vbb.transport.rest";
const REQUEST_CONCURRENCY = 5; // stay well under VBB's ~100 req/min
const ARRIVAL_HOUR = 9; // arrive by 09:00 on the reference weekday
const TIMEZONE = "Europe/Berlin";

/** Hard cutoff: a Kiez whose averaged commute exceeds this is excluded
 *  outright, same tier as the kita/kidDoctor hard filters. No intake
 *  question yet lets the user pick their own max, so this is a fixed,
 *  reasonable default for a family with kids commuting across Berlin. */
export const MAX_COMMUTE_MIN = 60;

function nextWeekdayArrival(hour = ARRIVAL_HOUR, weekday = 2 /* Tuesday, 0=Sunday */): Date {
  const now = new Date();
  const berlinNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const daysAhead = ((weekday - berlinNow.getDay() + 7) % 7) || 7;
  const target = new Date(berlinNow);
  target.setDate(berlinNow.getDate() + daysAhead);
  target.setHours(hour, 0, 0, 0);
  return target;
}

function locationParams(prefix: string, lat: number, lon: number): Record<string, string> {
  return {
    [`${prefix}.latitude`]: String(lat),
    [`${prefix}.longitude`]: String(lon),
    [`${prefix}.address`]: "Custom location",
  };
}

const VBB_REQUEST_TIMEOUT_MS = 6000; // this is a live public API with no SLA — seen it hang outright

async function vbbGet(path: string, params: Record<string, string>, retries = 2): Promise<unknown> {
  const url = `${VBB_API_URL}${path}?${new URLSearchParams(params).toString()}`;
  for (let attempt = 0; attempt < retries; attempt++) {
    let res: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VBB_REQUEST_TIMEOUT_MS);
    try {
      res = await fetch(url, {
        headers: { "User-Agent": "kiez-concierge-hackathon/1.0" },
        signal: controller.signal,
      });
    } catch {
      // Covers both network errors and our own abort-on-timeout.
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return res.json();
    if ([429, 500, 502, 503, 504].includes(res.status)) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
      continue;
    }
    return null; // non-retryable error (400/404/etc) — treat as "no journey found"
  }
  return null;
}

/** Best journey from (originLat, originLon) to (destLat, destLon), arriving
 *  by the next reference weekday 09:00. Returns null if VBB finds nothing
 *  or the request ultimately fails. */
async function fetchJourneyMinutes(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number
): Promise<number | null> {
  const arrival = nextWeekdayArrival();
  const params = {
    ...locationParams("from", originLat, originLon),
    ...locationParams("to", destLat, destLon),
    arrival: arrival.toISOString(),
    results: "3",
    stopovers: "false",
    remarks: "false",
    polylines: "false",
  };
  const data = (await vbbGet("/journeys", params)) as { journeys?: unknown[] } | null;
  if (!data?.journeys?.length) return null;

  let best: number | null = null;
  for (const journey of data.journeys as Record<string, unknown>[]) {
    const legs = (journey.legs as Record<string, unknown>[]) ?? [];
    if (!legs.length) continue;
    const dep = legs[0].departure ?? legs[0].plannedDeparture;
    const arr = legs[legs.length - 1].arrival ?? legs[legs.length - 1].plannedArrival;
    if (!dep || !arr) continue;
    const minutes = (new Date(arr as string).getTime() - new Date(dep as string).getTime()) / 60000;
    if (best === null || minutes < best) best = minutes;
  }
  return best === null ? null : Math.round(best);
}

// Cache keyed by "roundedLat,roundedLon->plrId" — coordinates rounded to
// ~100m precision so nearby-but-not-identical geocodes of the same address
// still hit the cache. Process-lifetime only (resets on server restart);
// fine for a hackathon demo, not meant to survive deploys.
const cache = new Map<string, Promise<number | null>>();

function cacheKey(originLat: number, originLon: number, plrId: string): string {
  return `${originLat.toFixed(3)},${originLon.toFixed(3)}->${plrId}`;
}

/** Real transit commute time (minutes) from an origin point to one
 *  Planungsraum's outline centroid, cached per (origin, plrId). */
export function getCommuteMinutesForKiez(
  originLat: number,
  originLon: number,
  plrId: string
): Promise<number | null> {
  const key = cacheKey(originLat, originLon, plrId);
  const cached = cache.get(key);
  if (cached) return cached;

  const boundary = getBoundaryFeature(plrId);
  const promise = boundary
    ? fetchJourneyMinutes(originLat, originLon, ...outlineCentroid(boundary.geometry))
    : Promise.resolve(null);
  cache.set(key, promise);
  return promise;
}

/** Runs `getCommuteMinutesForKiez` for many Planungsräume against one
 *  origin, with bounded concurrency (not one-by-one, not all-at-once) to
 *  stay within VBB's rate limit while still being reasonably fast. */
async function commuteMinutesForShortlist(
  originLat: number,
  originLon: number,
  plrIds: string[]
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  let cursor = 0;
  async function worker() {
    while (cursor < plrIds.length) {
      const plrId = plrIds[cursor++];
      result.set(plrId, await getCommuteMinutesForKiez(originLat, originLon, plrId));
    }
  }
  await Promise.all(Array.from({ length: Math.min(REQUEST_CONCURRENCY, plrIds.length) }, worker));
  return result;
}

export interface CommuteOrigin {
  address: string;
  lat: number;
  lon: number;
}

/** For each Planungsraum in `plrIds`, the average commute time across every
 *  origin in `origins` (partners' two workplaces, etc.) — null entries
 *  (VBB found no journey, or the call failed) are excluded from the
 *  average rather than counted as 0; a Kiez with no commute data for ANY
 *  origin averages to null, meaning "unknown", not "excluded" — see
 *  applyCommuteFilter in rank.ts for why unknown doesn't hard-fail it. */
export async function averageCommuteMinutes(
  origins: CommuteOrigin[],
  plrIds: string[]
): Promise<Map<string, number | null>> {
  const perOrigin = await Promise.all(
    origins.map((o) => commuteMinutesForShortlist(o.lat, o.lon, plrIds))
  );
  const result = new Map<string, number | null>();
  for (const plrId of plrIds) {
    const values = perOrigin.map((m) => m.get(plrId)).filter((v): v is number => v != null);
    result.set(plrId, values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  }
  return result;
}

