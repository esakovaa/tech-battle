import { NextRequest, NextResponse } from "next/server";
import { CONTEXT_CRITERIA_KEYS, evaluateContextCriteria } from "@/lib/context-criteria";
import { getPlanungsraumById } from "@/lib/rank";

/**
 * Values + city-wide notability for a set of extra criteria across several
 * Kieze — backs the "What else you mentioned" section on the results page
 * (the user's free-text answers, matched to criteria by lib/context-match).
 *
 * GET /api/context-criteria?keys=schools,noise&plrId=01100308&plrId=05400943
 */
export async function GET(req: NextRequest) {
  const keys = (req.nextUrl.searchParams.get("keys") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const invalid = keys.filter((k) => !(CONTEXT_CRITERIA_KEYS as readonly string[]).includes(k));
  if (invalid.length) {
    return NextResponse.json({ error: `Unknown criteria: ${invalid.join(", ")}` }, { status: 400 });
  }
  const plrIds = req.nextUrl.searchParams.getAll("plrId").slice(0, 6);
  const plrs = plrIds.map((id) => getPlanungsraumById(id));
  if (plrs.some((p) => !p)) {
    return NextResponse.json({ error: "Unknown plrId" }, { status: 404 });
  }

  const perPlr = plrs.map((p) => evaluateContextCriteria(keys, p!));
  const rows = keys.map((key, i) => ({
    key,
    label: perPlr[0]?.[i]?.label ?? key,
    values: perPlr.map((results, j) => ({ plrId: plrIds[j], value: results[i].value, notability: results[i].notability })),
  }));
  return NextResponse.json({ rows });
}
