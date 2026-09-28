import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import boundariesData from "@/data/planungsraum_boundaries.json";
import { getAllPlanungsraeume } from "./rank";
import type { PlanungsraumProfile } from "./types";

interface BoundaryFeature {
  type: "Feature";
  properties: { plr_id: string; plr_name: string };
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon;
}
const boundaries = (boundariesData as unknown as { features: BoundaryFeature[] }).features;

/** Nominatim usage policy: max 1 req/sec, identify with a real User-Agent.
 *  Same pattern already used for the air-quality station geocoding in the
 *  Python pipeline (Kiez Profile Master Table/build_kiez_profile.py). */
export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    address + ", Berlin, Germany"
  )}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "kiez-concierge-hackathon/1.0" } });
  if (!res.ok) return null;
  const data: { lat: string; lon: string }[] = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

/** Real point-in-polygon against the actual Planungsraum boundaries — same
 *  geometry the Python pipeline used, not a nearest-centroid guess. */
export function findPlanungsraumForPoint(lat: number, lon: number): PlanungsraumProfile | undefined {
  const pt = point([lon, lat]);
  const hit = boundaries.find((f) => booleanPointInPolygon(pt, f.geometry));
  if (!hit) return undefined;
  return getAllPlanungsraeume().find((p) => p.plr_id === hit.properties.plr_id);
}

/** Address -> Planungsraum, end to end. Returns null if geocoding fails or
 *  the point falls outside every Planungsraum polygon (e.g. an address
 *  outside Berlin, or right at a boundary/water gap). */
export async function resolveAddressToPlanungsraum(address: string): Promise<PlanungsraumProfile | null> {
  const coords = await geocodeAddress(address);
  if (!coords) return null;
  const plr = findPlanungsraumForPoint(coords.lat, coords.lon);
  return plr ?? null;
}
