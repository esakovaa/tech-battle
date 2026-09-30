"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StepProgress } from "./StepProgress";
import type { DocumentType, EmploymentContextType, Listing, PropertyType, SmokingPolicy } from "@/lib/landlord-types";
import { DOCUMENT_LABELS } from "@/lib/landlord-types";

const ALL_DOCS: DocumentType[] = ["identity", "payslips", "schufa", "mietschuldenfreiheit", "employment_contract"];

export default function LandlordFlatSetupPage() {
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(null);
  const [assistantSetupLoaded, setAssistantSetupLoaded] = useState(false);
  const [sampleListingActive, setSampleListingActive] = useState(true);
  const [address, setAddress] = useState("");
  const [ortsteil, setOrtsteil] = useState("");
  const [areaM2, setAreaM2] = useState(0);
  const [propertyType, setPropertyType] = useState<PropertyType>("flat");
  const [childrenWelcome, setChildrenWelcome] = useState(false);
  const [employmentContexts, setEmploymentContexts] = useState<EmploymentContextType[]>([
    "unlimited_contract", "self_employed", "retired", "limited_contract", "burgergeld",
  ]);
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
          if (saved) {
            setup = JSON.parse(saved) as Partial<Listing>;
            setAssistantSetupLoaded(true);
            setSampleListingActive(false);
          } else {
            setSampleListingActive(true);
          }
          sessionStorage.removeItem("ll_setup_assistant");
        } catch { /* Ignore an invalid saved setup and use the listing defaults. */ }
        setAddress(setup.address ?? l.address);
        setOrtsteil(setup.ortsteil ?? l.ortsteil);
        setAreaM2(setup.area_m2 ?? l.area_m2);
        setWarmRent(setup.warmmiete_eur_monthly ?? l.warmmiete_eur_monthly);
        setPropertyType(setup.property_type ?? l.property_type ?? "flat");
        setChildrenWelcome(setup.households_with_children_welcome ?? l.households_with_children_welcome ?? false);
        setEmploymentContexts(setup.employment_context_types ?? l.employment_context_types ?? ["unlimited_contract", "self_employed", "retired", "limited_contract", "burgergeld"]);
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

  function toggleEmploymentContext(type: EmploymentContextType) {
    setEmploymentContexts((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }

  function loadSampleListing() {
    if (!listing) return;
    sessionStorage.removeItem("ll_setup_assistant");
    setAddress(listing.address);
    setOrtsteil(listing.ortsteil);
    setAreaM2(listing.area_m2);
    setWarmRent(listing.warmmiete_eur_monthly);
    setColdRent(listing.kaltmiete_eur_monthly);
    setMinIncomeMultiple(listing.min_income_multiple);
    setPropertyType(listing.property_type ?? "flat");
    setChildrenWelcome(listing.households_with_children_welcome ?? false);
    setEmploymentContexts(listing.employment_context_types ?? ["unlimited_contract", "self_employed", "retired", "limited_contract", "burgergeld"]);
    setMoveInDate(listing.move_in_date);
    setRooms(listing.rooms);
    setSmokingPolicy(listing.smoking_policy);
    setRequiredDocs(listing.required_documents);
    setSampleListingActive(true);
    setAssistantSetupLoaded(false);
  }

  function startOwnListing() {
    setAddress("");
    setOrtsteil("");
    setAreaM2(0);
    setWarmRent(0);
    setColdRent(0);
    setMinIncomeMultiple(3);
    setPropertyType("flat");
    setChildrenWelcome(false);
    setEmploymentContexts([]);
    setMoveInDate("");
    setRooms(3);
    setSmokingPolicy("no_preference");
    setRequiredDocs([]);
    setSampleListingActive(false);
    setAssistantSetupLoaded(false);
    sessionStorage.removeItem("ll_setup_assistant");
  }

  function handleOpenApplications() {
    if (!listing) return;
    const overrides: Partial<Listing> = {
      address,
      ortsteil,
      area_m2: areaM2,
      warmmiete_eur_monthly: warmRent,
      kaltmiete_eur_monthly: coldRent,
      min_income_multiple: minIncomeMultiple,
      property_type: propertyType,
      households_with_children_welcome: childrenWelcome,
      employment_context_types: employmentContexts,
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
  const canContinue = Boolean(listing && address.trim() && warmRent > 0 && coldRent > 0 && areaM2 > 0 && moveInDate);

  return (
    <>
      <StepProgress step={1} label="The flat" />
      <div className="ll-wrap ll-page">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60 }}>
          <div>
            <span className="ll-eyebrow">Landlord</span>
            <h1 className="ll-h1">Tell us about the flat.</h1>
            <p className="ll-lede">What you set here becomes the only thing applicants are checked against.</p>

            <div role="group" aria-label="Listing demo options" style={{ background: "var(--ll-paper)", border: "1px solid var(--ll-line)", borderRadius: 14, padding: 18, margin: "20px 0" }}>
              <strong>{sampleListingActive ? "Sample listing prefilled" : "Your listing details"}</strong>
              <p style={{ margin: "8px 0 12px", color: "var(--ll-muted)" }}>{sampleListingActive ? "Use the sample flat and applicant dataset for a quick landlord walkthrough, or clear the property fields to enter your own listing." : "Enter your own property details, or reload the fictional sample listing."}</p>
              {sampleListingActive
                ? <button className="ll-btn-ghost" type="button" onClick={startOwnListing} disabled={!listing}>Start with my own listing →</button>
                : <button className="ll-btn-ghost" type="button" onClick={loadSampleListing} disabled={!listing}>Load sample listing →</button>}
            </div>

            {assistantSetupLoaded && (
              <div role="status" style={{ background: "var(--ll-paper)", border: "1px solid var(--ll-line-strong)", borderRadius: 14, padding: 18, margin: "20px 0" }}>
                <strong>Your assistant setup is ready to review.</strong>
                <p style={{ margin: "8px 0 0", color: "var(--ll-muted)" }}>We’ve filled in the details below. Check or edit them, then continue to the applications dashboard to apply these requirements and run the viewing lottery.</p>
              </div>
            )}

            <Link className="ll-btn-primary" href="/landlord/setup-chat" style={{ display: "inline-block", margin: "18px 0" }}>
              Set up the flat with an assistant →
            </Link>

            <p className="ll-section-label">Property type</p>
            <div className="ll-pill-row" role="group" aria-label="Property type">
              {([{ value: "flat", label: "Flat" }, { value: "house", label: "House" }] as const).map((option) => (
                <button key={option.value} className={`ll-pill wide ${propertyType === option.value ? "selected" : ""}`} onClick={() => setPropertyType(option.value)} type="button">{option.label}</button>
              ))}
            </div>

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
              Photo: the flat or building on {address || "…"}
            </div>
            <label style={{ display: "grid", gap: 8, marginBottom: 12 }}>Address<input className="ll-input" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
            <div className="ll-field-row">
              <label style={{ display: "grid", gap: 8 }}>Neighborhood<input className="ll-input" value={ortsteil} onChange={(e) => setOrtsteil(e.target.value)} /></label>
              <label style={{ display: "grid", gap: 8 }}>Area (m²)<input className="ll-input" type="number" min={1} value={areaM2} onChange={(e) => setAreaM2(Number(e.target.value) || 0)} /></label>
            </div>
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
            <p className="ll-section-label">Would you like to give priority to people with children?</p>
            <p className="ll-retention-note" style={{ marginTop: 0 }}>Every eligible household gets the same chance in the lottery. You can choose to add a welcoming note; family status never affects eligibility or draw order.</p>
            <div className="ll-pill-row" role="group" aria-label="Welcoming households with children">
              <button className={`ll-pill wide ${!childrenWelcome ? "selected" : ""}`} type="button" onClick={() => setChildrenWelcome(false)}>No extra welcome note</button>
              <button className={`ll-pill wide ${childrenWelcome ? "selected" : ""}`} type="button" onClick={() => setChildrenWelcome(true)}>Families are welcome</button>
            </div>

            <p className="ll-section-label">Which employment situations do you consider?</p>
            <p className="ll-retention-note" style={{ marginTop: 0 }}>Choose what to highlight as welcome context. These selections never exclude, score, or rank applicants.</p>
            {([
              ["unlimited_contract", "Unlimited contract"], ["self_employed", "Self-employed"], ["retired", "Retired"],
              ["limited_contract", "Limited working contract"], ["burgergeld", "Bürgergeld"],
            ] as const).map(([type, label]) => (
              <label key={type} className="ll-check-row"><input type="checkbox" checked={employmentContexts.includes(type)} onChange={() => toggleEmploymentContext(type)} />{label}</label>
            ))}

            <p className="ll-section-label">If someone doesn’t have an unlimited contract, will you consider alternative proof?</p>
            <div style={{ border: "1px solid var(--ll-line)", borderRadius: 12, padding: 16, background: "var(--ll-paper)" }}>
              <p style={{ margin: "0 0 12px", fontWeight: 600 }}>Yes. The same four financial routes are accepted equally for every applicant:</p>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                <li>Income meeting the threshold (income may include dividends; the current tenant form has no dedicated dividend-proof upload yet)</li>
                <li>A guarantor</li>
                <li>Deposit insurance</li>
                <li>Savings covering at least three months of warm rent</li>
              </ul>
              <p className="ll-retention-note" style={{ marginBottom: 0 }}>A permanent contract is not a requirement. Financial security is checked the same way regardless of employment type.</p>
            </div>

            <hr className="ll-divider" />

            <h2 className="ll-panel-title" id="how-it-works">
              How applications will be reviewed
            </h2>
            <div className="ll-review-row">
              <span className="ll-review-tag required">REQUIRED</span>
              <span className="ll-review-detail">
                Financial security via income of at least {minIncomeMultiple}× cold rent (€{requiredIncome.toLocaleString()}), a guarantor,
                deposit insurance, or savings of at least 3× warm rent; the documents you selected; and move-in from {moveInDate}
                {smokingPolicy === "non_smoking_only" ? ", non-smoking" : ""}.
              </span>
            </div>
            <div className="ll-review-row">
              <span className="ll-review-tag shown">
                SHOWN,
                <br />
                NOT SCORED
              </span>
              <span className="ll-review-detail">Household size for {rooms} rooms and employment context. {childrenWelcome ? "Households with children are welcome; there is no priority." : "Family status does not affect eligibility or the lottery."} Employment selections are context only.</span>
            </div>
            <div className="ll-review-row">
              <span className="ll-review-tag never">NEVER USED</span>
              <span className="ll-review-detail">Protected characteristics, names, photos, nationality, writing style or language.</span>
            </div>
            <p className="ll-retention-note">Application data is kept only for this letting and deleted 30 days after the flat is let.</p>

            <div style={{ marginTop: 28, textAlign: "right" }}>
              <button className="ll-btn-primary" onClick={handleOpenApplications} disabled={!canContinue}>
                Open {applicationsReceived ?? "…"} applications →
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
