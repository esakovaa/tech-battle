"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StepProgress } from "./StepProgress";
import type { DocumentType, Listing, SmokingPolicy } from "@/lib/landlord-types";
import { DOCUMENT_LABELS } from "@/lib/landlord-types";

const ALL_DOCS: DocumentType[] = ["identity", "payslips", "schufa", "mietschuldenfreiheit", "employment_contract"];

export default function LandlordFlatSetupPage() {
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(null);
  const [warmRent, setWarmRent] = useState(1480);
  const [coldRent, setColdRent] = useState(1200);
  const [minIncomeMultiple, setMinIncomeMultiple] = useState(3);
  const [moveInDate, setMoveInDate] = useState("2026-12-01");
  const [rooms, setRooms] = useState(3);
  const [smokingPolicy, setSmokingPolicy] = useState<SmokingPolicy>("non_smoking_only");
  const [requiredDocs, setRequiredDocs] = useState<DocumentType[]>(["identity", "payslips", "schufa", "mietschuldenfreiheit"]);
  const [applicationsReceived, setApplicationsReceived] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/landlord/listings")
      .then((r) => r.json())
      .then((d: { listings: Listing[] }) => {
        const l = d.listings[0];
        if (!l) return;
        setListing(l);
        let setup: Partial<Listing> = {};
        try {
          const saved = sessionStorage.getItem("ll_setup_assistant");
          if (saved) setup = JSON.parse(saved) as Partial<Listing>;
          sessionStorage.removeItem("ll_setup_assistant");
        } catch { /* Ignore an invalid saved setup and use the listing defaults. */ }
        setWarmRent(setup.warmmiete_eur_monthly ?? l.warmmiete_eur_monthly);
        setColdRent(setup.kaltmiete_eur_monthly ?? l.kaltmiete_eur_monthly);
        setMinIncomeMultiple(setup.min_income_multiple ?? l.min_income_multiple);
        setMoveInDate(setup.move_in_date ?? l.move_in_date);
        setRooms(setup.rooms ?? l.rooms);
        setSmokingPolicy(setup.smoking_policy ?? l.smoking_policy);
        setRequiredDocs(setup.required_documents ?? l.required_documents);
      });
  }, []);

  useEffect(() => {
    if (!listing) return;
    fetch("/api/landlord/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId: listing.id }),
    })
      .then((r) => r.json())
      .then((d: { stats?: { applicationsReceived: number } }) => setApplicationsReceived(d.stats?.applicationsReceived ?? null));
  }, [listing]);

  function toggleDoc(doc: DocumentType) {
    setRequiredDocs((prev) => (prev.includes(doc) ? prev.filter((d) => d !== doc) : [...prev, doc]));
  }

  function handleOpenApplications() {
    if (!listing) return;
    const overrides: Partial<Listing> = {
      warmmiete_eur_monthly: warmRent,
      kaltmiete_eur_monthly: coldRent,
      min_income_multiple: minIncomeMultiple,
      move_in_date: moveInDate,
      rooms,
      smoking_policy: smokingPolicy,
      required_documents: requiredDocs,
    };
    sessionStorage.setItem("ll_listingId", listing.id);
    sessionStorage.setItem("ll_overrides", JSON.stringify(overrides));
    router.push("/landlord/applications");
  }

  const requiredIncome = listing ? Math.round(minIncomeMultiple * coldRent) : 0;

  return (
    <>
      <StepProgress step={1} label="The flat" />
      <div className="ll-wrap ll-page">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60 }}>
          <div>
            <span className="ll-eyebrow">Landlord</span>
            <h1 className="ll-h1">Tell us about the flat.</h1>
            <p className="ll-lede">What you set here becomes the only thing applicants are checked against.</p>

            <Link className="ll-btn-primary" href="/landlord/setup-chat" style={{ display: "inline-block", margin: "18px 0" }}>
              Set up the flat with an assistant →
            </Link>

            <div
              style={{
                border: "1px dashed var(--ll-line-strong)",
                borderRadius: 14,
                background: "var(--ll-paper)",
                padding: "60px 20px",
                textAlign: "center",
                color: "var(--ll-muted)",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              Photo: the flat or building on {listing?.address ?? "…"}
            </div>
            <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>
              {listing?.address} · {listing?.ortsteil} · {listing?.area_m2} m²
            </p>
          </div>

          <div>
            <div className="ll-field-row">
              <label style={{ display: "grid", gap: 8 }}>Warm rent (€)<input className="ll-input" value={warmRent} onChange={(e) => setWarmRent(Number(e.target.value) || 0)} /></label>
              <input className="ll-input" type="date" value={moveInDate} onChange={(e) => setMoveInDate(e.target.value)} />
            </div>

            <div className="ll-field-row" style={{ marginTop: 12 }}>
              <label style={{ display: "grid", gap: 8 }}>Cold rent (€)<input className="ll-input" value={coldRent} onChange={(e) => setColdRent(Number(e.target.value) || 0)} /></label>
              <label style={{ display: "grid", gap: 8 }}>Minimum income multiple (2–3x)<input className="ll-input" type="number" min={2} max={3} step={0.1} value={minIncomeMultiple} onChange={(e) => setMinIncomeMultiple(Math.min(3, Math.max(2, Number(e.target.value) || 2)))} /></label>
            </div>

            <p className="ll-section-label">Rooms</p>
            <div className="ll-pill-row">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={`ll-pill ${rooms === n ? "selected" : ""}`} onClick={() => setRooms(n)} type="button">
                  {n}
                </button>
              ))}
            </div>

            <p className="ll-section-label">Smoking</p>
            <div className="ll-pill-row">
              <button
                className={`ll-pill wide ${smokingPolicy === "no_preference" ? "selected" : ""}`}
                onClick={() => setSmokingPolicy("no_preference")}
                type="button"
              >
                No preference
              </button>
              <button
                className={`ll-pill wide ${smokingPolicy === "non_smoking_only" ? "selected" : ""}`}
                onClick={() => setSmokingPolicy("non_smoking_only")}
                type="button"
              >
                Non-smoking only
              </button>
            </div>

            <p className="ll-section-label">Required documents</p>
            {ALL_DOCS.map((doc) => (
              <label key={doc} className="ll-check-row">
                <input type="checkbox" checked={requiredDocs.includes(doc)} onChange={() => toggleDoc(doc)} />
                {DOCUMENT_LABELS[doc]}
              </label>
            ))}

            <hr className="ll-divider" />

            <h2 className="ll-panel-title" id="how-it-works">
              How applications will be reviewed
            </h2>
            <div className="ll-review-row">
              <span className="ll-review-tag required">REQUIRED</span>
              <span className="ll-review-detail">
                Net income at least {minIncomeMultiple} times the cold rent (€{requiredIncome.toLocaleString()}), the
                documents you selected, and a move-in from {moveInDate}
                {smokingPolicy === "non_smoking_only" ? ", non-smoking" : ""}.
              </span>
            </div>
            <div className="ll-review-row">
              <span className="ll-review-tag shown">
                SHOWN,
                <br />
                NOT SCORED
              </span>
              <span className="ll-review-detail">Household size for {rooms} rooms, employment security.</span>
            </div>
            <div className="ll-review-row">
              <span className="ll-review-tag never">NEVER USED</span>
              <span className="ll-review-detail">Protected characteristics, names, photos, nationality, writing style or language.</span>
            </div>
            <p className="ll-retention-note">Application data is kept only for this letting and deleted 30 days after the flat is let.</p>

            <div style={{ marginTop: 28, textAlign: "right" }}>
              <button className="ll-btn-primary" onClick={handleOpenApplications} disabled={!listing}>
                Open {applicationsReceived ?? "…"} applications →
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
