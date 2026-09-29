import { NextRequest, NextResponse } from "next/server";
import { getExampleListings } from "@/lib/listings";
import { getPlanungsraumById } from "@/lib/rank";

/**
 * "Click a recommended Kiez -> show 3 example flat listings" — called
 * on demand from the frontend, not bundled into /api/rank's response, so
 * the initial recommendation load doesn't pay for listings on all 4 Kieze
 * (current + 3 alternatives) up front.
 *
 * GET /api/listings?plrId=03601347&rooms=3
 * rooms is optional — omit it to get unfiltered examples for that Kiez.
 * all=1 returns the full matching set instead of the three-card preview.
 */
export async function GET(req: NextRequest) {
  const plrId = req.nextUrl.searchParams.get("plrId");
  if (!plrId) {
    return NextResponse.json({ error: "plrId query param is required" }, { status: 400 });
  }
  if (!getPlanungsraumById(plrId)) {
    return NextResponse.json({ error: `Unknown plr_id: ${plrId}` }, { status: 404 });
  }

  const roomsParam = req.nextUrl.searchParams.get("rooms");
  let rooms: number | undefined;
  if (roomsParam != null) {
    rooms = Number(roomsParam);
    if (!Number.isFinite(rooms) || rooms <= 0) {
      return NextResponse.json({ error: "rooms must be a positive number" }, { status: 400 });
    }
  }

  const all = req.nextUrl.searchParams.get("all") === "1";
  const { listings, exactRoomMatch } = getExampleListings(plrId, rooms, all ? Number.MAX_SAFE_INTEGER : 3);

  return NextResponse.json({
    plrId,
    roomsRequested: rooms ?? null,
    exactRoomMatch,
    listings,
    note:
      "These are synthetic example listings (a hedonic-model dataset), not live real-estate offers — " +
      "prices run roughly 25-40% below real market level. Useful for 'what does a place like this look like " +
      "here', not as an actual current offer.",
  });
}
