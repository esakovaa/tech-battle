/** Shared geometry helpers used both client-side (KiezMap) and server-side
 *  (commute time lookups) — kept in one place so "where is this Kiez,
 *  roughly" means the same point everywhere. */

export function flattenCoords(geom: GeoJSON.Geometry): [number, number][] {
  const points: [number, number][] = [];
  const walk = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      const [lon, lat] = coords as [number, number];
      points.push([lat, lon]);
    } else if (Array.isArray(coords)) {
      coords.forEach(walk);
    }
  };
  if ("coordinates" in geom) walk(geom.coordinates);
  return points;
}

/** Average of the boundary's outline points — a good enough anchor for
 *  "where this Kiez is" (map display, commute-time origin/destination),
 *  not a true area-weighted centroid. */
export function outlineCentroid(geom: GeoJSON.Geometry): [number, number] {
  const points = flattenCoords(geom);
  const [latSum, lonSum] = points.reduce(([la, lo], [lat, lon]) => [la + lat, lo + lon], [0, 0]);
  return [latSum / points.length, lonSum / points.length];
}

export function haversineKm([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
