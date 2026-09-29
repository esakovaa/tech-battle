import { NextResponse } from "next/server";
import { getAllListings } from "@/lib/landlord-data";

/** GET /api/landlord/listings — the demo listings a landlord can pick from
 *  (screen 1: "Tell us about the flat" — pre-filled from these, editable
 *  via the `overrides` field on POST /api/landlord/dashboard). */
export async function GET() {
  return NextResponse.json({ listings: getAllListings() });
}
