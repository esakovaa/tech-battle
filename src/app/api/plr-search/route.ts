import { NextRequest, NextResponse } from "next/server";
import { getAllPlanungsraeume } from "@/lib/rank";

/**
 * Type-ahead for the intake's "current address" field: matches the query
 * against Planungsraum name, Bezirk and dominant ZIP code, entirely from
 * local data (no geocoding call). Picking a suggestion lets the frontend
 * send currentPlrId directly; free text still goes through /api/rank's
 * server-side geocoding as currentAddress.
 *
 * GET /api/plr-search?q=prenz  ->  { results: [{ plr_id, plr_name, bezirk, dominant_plz }] }
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const scored = getAllPlanungsraeume()
    .map((p) => {
      const name = p.plr_name.toLowerCase();
      const bezirk = p.bezirk.toLowerCase();
      let rank = -1;
      if (p.dominant_plz.startsWith(q)) rank = 0;
      else if (name.startsWith(q)) rank = 1;
      else if (name.includes(q)) rank = 2;
      else if (bezirk.startsWith(q)) rank = 3;
      return { p, rank };
    })
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.p.plr_name.localeCompare(b.p.plr_name, "de"))
    .slice(0, 8)
    .map(({ p }) => ({ plr_id: p.plr_id, plr_name: p.plr_name, bezirk: p.bezirk, dominant_plz: p.dominant_plz }));

  return NextResponse.json({ results: scored });
}
