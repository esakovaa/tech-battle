"use client";

import { Fragment, useEffect, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Polyline, Tooltip, Popup } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PoiCategory } from "@/lib/poi-locations";
import { outlineCentroid, haversineKm, flattenCoords } from "@/lib/geo";

/**
 * Per-Kiez map: real boundary polygon, real POI points (colored by
 * category), the user's current address, and up to 2 commute addresses —
 * everything from GET /api/kiez-map for one Planungsraum.
 *
 * Leaflet touches `window`/`document` at import time, so this component
 * must never be server-rendered. Import it with next/dynamic and
 * ssr:false wherever it's actually used:
 *
 *   const KiezMap = dynamic(() => import("@/components/KiezMap"), { ssr: false });
 *
 * Marking this file "use client" alone is NOT enough — that only moves
 * hydration to the client, it doesn't skip the server-side pre-render of
 * this component's initial HTML, which is where Leaflet would throw.
 */

const CATEGORY_STYLE: Record<PoiCategory, { color: string; label: string }> = {
  kita: { color: "#f39c12", label: "Kita" },
  n_yoga_studios: { color: "#9b59b6", label: "Yoga studio" },
  n_kinderarzt: { color: "#e74c3c", label: "Kinderarzt" },
  n_gym: { color: "#16a085", label: "Gym" },
  n_bouldering: { color: "#8d6e63", label: "Bouldering" },
};
const CURRENT_COLOR = "#1a1a2e";
const COMMUTE_COLOR = "#2563eb";

// Thunderforest's "Pioneer" style reads closer to the Wurzelraum
// cottagecore brand than plain OSM tiles. Falls back to keyless OSM tiles
// when no key is configured (e.g. a fresh clone without .env.local set up).
const THUNDERFOREST_API_KEY = process.env.NEXT_PUBLIC_THUNDERFOREST_API_KEY;
const TILE_LAYER = THUNDERFOREST_API_KEY
  ? {
      url: `https://{s}.tile.thunderforest.com/pioneer/{z}/{x}/{y}.png?apikey=${THUNDERFOREST_API_KEY}`,
      attribution:
        '&copy; <a href="https://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }
  : {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    };

interface PoiLocation {
  plr_id: string;
  category: PoiCategory;
  name: string;
  lat: number;
  lon: number;
}
interface GeoPoint {
  lat: number;
  lon: number;
  address: string;
}
interface KiezMapData {
  plrId: string;
  plrName: string;
  boundary: GeoJSON.Feature;
  pois: PoiLocation[];
  current: GeoPoint | null;
  commutes: GeoPoint[];
}

export interface KiezMapProps {
  plrId: string;
  /** Which POI categories to show — pass the ones the user actually
   *  selected in the intake (e.g. kids.kita -> "kita", hobbies.yoga ->
   *  "n_yoga_studios"). Omit for all categories. */
  categories?: PoiCategory[];
  currentAddress?: string;
  commuteAddresses?: string[];
  height?: number | string;
}

function computeBounds(data: KiezMapData): LatLngBoundsExpression {
  const points: LatLngTuple[] = flattenCoords(data.boundary.geometry);
  data.pois.forEach((p) => points.push([p.lat, p.lon]));
  if (data.current) points.push([data.current.lat, data.current.lon]);
  data.commutes.forEach((c) => points.push([c.lat, c.lon]));
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  return [
    [Math.min(...lats), Math.min(...lons)],
    [Math.max(...lats), Math.max(...lons)],
  ];
}

export default function KiezMap({ plrId, categories, currentAddress, commuteAddresses, height = 480 }: KiezMapProps) {
  // A single string key for "what was requested" — lets the render derive
  // isLoading by comparing it to what's actually loaded (result.key),
  // instead of eagerly nulling state at the top of the effect (which an
  // extra render + a race on rapid prop changes; flagged by
  // react-hooks/set-state-in-effect). Every setResult call below happens
  // after the fetch settles, never synchronously in the effect body.
  const requestKey = [plrId, categories?.join(",") ?? "", currentAddress ?? "", commuteAddresses?.join(",") ?? ""].join("|");
  const [result, setResult] = useState<{ key: string; data: KiezMapData | null; error: string | null }>({
    key: "",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ plrId });
    if (categories?.length) params.set("categories", categories.join(","));
    if (currentAddress) params.set("currentAddress", currentAddress);
    commuteAddresses?.slice(0, 2).forEach((a) => params.append("commuteAddress", a));

    fetch(`/api/kiez-map?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setResult({ key: requestKey, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) setResult({ key: requestKey, data: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey already encodes every input below
  }, [requestKey]);

  const isLoading = result.key !== requestKey;
  const { data, error } = result;

  if (error && !isLoading) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6" }}>
        <p style={{ color: "#991b1b" }}>Couldn&apos;t load the map: {error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6" }}>
        <p>Loading map…</p>
      </div>
    );
  }

  const categoriesPresent = Array.from(new Set(data.pois.map((p) => p.category)));
  const kiezCenter = outlineCentroid(data.boundary.geometry);

  return (
    <div style={{ position: "relative", height }}>
      <MapContainer bounds={computeBounds(data)} boundsOptions={{ padding: [24, 24] }} style={{ height: "100%", width: "100%" }}>
        <TileLayer url={TILE_LAYER.url} attribution={TILE_LAYER.attribution} />
        <GeoJSON
          data={data.boundary}
          style={{ color: "#334155", weight: 2, fillColor: "#94a3b8", fillOpacity: 0.08 }}
        />
        {data.pois.map((poi, i) => (
          <CircleMarker
            key={i}
            center={[poi.lat, poi.lon]}
            radius={7}
            pathOptions={{ color: "#fff", weight: 1.5, fillColor: CATEGORY_STYLE[poi.category].color, fillOpacity: 0.9 }}
          >
            <Popup>
              <strong>{CATEGORY_STYLE[poi.category].label}</strong>
              <br />
              {poi.name || "Unnamed"}
            </Popup>
          </CircleMarker>
        ))}
        {data.current && (
          <CircleMarker
            center={[data.current.lat, data.current.lon]}
            radius={10}
            pathOptions={{ color: "#fff", weight: 2, fillColor: CURRENT_COLOR, fillOpacity: 1 }}
          >
            <Popup>
              <strong>Your current address</strong>
              <br />
              {data.current.address}
            </Popup>
          </CircleMarker>
        )}
        {data.commutes.map((c, i) => {
          const commutePoint: [number, number] = [c.lat, c.lon];
          return (
            <Fragment key={i}>
              <Polyline
                positions={[kiezCenter, commutePoint]}
                pathOptions={{ color: COMMUTE_COLOR, weight: 2, dashArray: "6 8", opacity: 0.7 }}
              >
                <Tooltip direction="center" permanent={false}>
                  {haversineKm(kiezCenter, commutePoint).toFixed(1)} km (straight-line) to {c.address}
                </Tooltip>
              </Polyline>
              <CircleMarker
                center={commutePoint}
                radius={9}
                pathOptions={{ color: "#fff", weight: 2, fillColor: COMMUTE_COLOR, fillOpacity: 1 }}
              >
                <Popup>
                  <strong>Commute destination</strong>
                  <br />
                  {c.address}
                  <br />
                  {haversineKm(kiezCenter, commutePoint).toFixed(1)} km straight-line from this Kiez
                </Popup>
              </CircleMarker>
            </Fragment>
          );
        })}
      </MapContainer>

      <div
        style={{
          position: "absolute", bottom: 12, left: 12, zIndex: 1000,
          background: "rgba(255,255,255,0.92)", borderRadius: 8, padding: "8px 12px",
          fontSize: 13, lineHeight: 1.6, boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        }}
      >
        {categoriesPresent.map((cat) => (
          <div key={cat} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: CATEGORY_STYLE[cat].color, display: "inline-block" }} />
            {CATEGORY_STYLE[cat].label}
          </div>
        ))}
        {data.current && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: CURRENT_COLOR, display: "inline-block" }} />
            Current address
          </div>
        )}
        {data.commutes.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: COMMUTE_COLOR, display: "inline-block" }} />
            Commute
          </div>
        )}
      </div>
    </div>
  );
}
