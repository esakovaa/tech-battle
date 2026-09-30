import Link from "next/link";
import { getExampleListings } from "@/lib/listings";
import { getPlanungsraumById } from "@/lib/rank";
import ApplyForm from "./ApplyForm";

export default async function ApplyPage({ searchParams }: PageProps<"/apply">) {
  const q = await searchParams;
  const plrId = typeof q.plrId === "string" ? q.plrId : "";
  const listingId = typeof q.listingId === "string" ? q.listingId : "";
  const kiez = typeof q.kiez === "string" ? q.kiez : "this Kiez";
  const initialKids = {
    kita: q.kita === "1",
    primarySchool: q.primarySchool === "1",
    highSchool: q.highSchool === "1",
    kidDoctor: q.kidDoctor === "1",
  };
  const listing = plrId && listingId
    ? getExampleListings(plrId, undefined, Number.MAX_SAFE_INTEGER).listings.find((item) => item.id === listingId)
    : undefined;
  const plr = getPlanungsraumById(plrId);

  if (!listing || !plr) {
    return <main className="wr-apply-page"><div className="wr-apply-shell"><Link href="/" className="wr-apply-back">← Back to Wurzelraum</Link><h1>This example flat isn’t available</h1><p>Return to your Kiez results and choose one of the example flats shown there.</p></div></main>;
  }

  return <ApplyForm listing={listing} kiez={kiez || plr.plr_name} initialKids={initialKids} demoMode={q.demo === "anna-mueller"} />;
}
