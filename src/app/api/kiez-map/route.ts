import { NextRequest, NextResponse } from "next/server";
import { getPlanungsraumById } from "@/lib/rank";
import { getBoundaryFeature, geocodeAddress } from "@/lib/geocode";
import { getPoisForKiez, type PoiCategory } from "@/lib/poi-locations";

const VALID_CATEGORIES: PoiCategory[] = ["kita", "n_yoga_studios", "n_kinderarzt", "n_gym", "n_bouldering"];

/**
 * Per-Kiez map data: real boundary polygon + real POI points (filtered to
 * whatever categories the caller cares about) + geocoded current/commute
 * addresses — everything a <KiezMap> component needs in one call.
 *
 * GET /api/kiez-map?plrId=03601347&categories=kita,n_yoga_studios&currentAddress=...&commuteAddress=...&commuteAddress=...
 * - plrId: required
 * - categories: optional comma-separated PoiCategory list; omit for all
 * - currentAddress: optional free-text address, geocoded server-side
 * - commuteAddress: optional, repeatable (0-2) — one query param per address
 */
export async function GET(req: NextRequest) {
  const plrId = req.nextUrl.searchParams.get("plrId");
  if (!plrId) {
    return NextResponse.json({ error: "plrId query param is required" }, { status: 400 });
  }
  const plr = getPlanungsraumById(plrId);
  if (!plr) {
    return NextResponse.json({ error: `Unknown plr_id: ${plrId}` }, { status: 404 });
  }

  const boundary = getBoundaryFeature(plrId);
  if (!boundary) {
    return NextResponse.json({ error: `No boundary polygon found for plr_id: ${plrId}` }, { status: 404 });
  }

  const categoriesParam = req.nextUrl.searchParams.get("categories");
  let categories: PoiCategory[] | undefined;
  if (categoriesParam) {
    const requested = categoriesParam.split(",").map((c) => c.trim());
    const invalid = requested.filter((c) => !VALID_CATEGORIES.includes(c as PoiCategory));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid categories: ${invalid.join(", ")}. Valid: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }
    categories = requested as PoiCategory[];
  }
  const pois = getPoisForKiez(plrId, categories);

  const currentAddress = req.nextUrl.searchParams.get("currentAddress");
  const commuteAddresses = req.nextUrl.searchParams.getAll("commuteAddress").slice(0, 2);

  const [currentCoords, commuteCoords] = await Promise.all([
    currentAddress ? geocodeAddress(currentAddress) : Promise.resolve(null),
    Promise.all(commuteAddresses.map((addr) => geocodeAddress(addr))),
  ]);

  return NextResponse.json({
    plrId,
    plrName: plr.plr_name,
    boundary,
    pois,
    current: currentCoords ? { ...currentCoords, address: currentAddress } : null,
    commutes: commuteAddresses
      .map((address, i) => (commuteCoords[i] ? { ...commuteCoords[i]!, address } : null))
      .filter((c): c is { lat: number; lon: number; address: string } => c !== null),
  });
}
