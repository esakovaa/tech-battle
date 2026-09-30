"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExampleListing } from "@/lib/listings";
import type { KidsCriteria } from "@/lib/types";
import { evaluateFinancialRoutes } from "@/lib/tenant-financial-routes";
import { ANNA_MUELLER_DEMO } from "@/lib/demo-profile";

const DOCS = [
  ["identity", "Proof of identity"],
  ["payslips", "Last three payslips"],
  ["schufa", "SCHUFA credit report"],
  ["mietschuldenfreiheit", "Mietschuldenfreiheitsbescheinigung"],
  ["employment_contract", "Employment contract (optional)"],
] as const;
type DocKey = (typeof DOCS)[number][0];
type DocStatus = { state: "checking" | "verified" | "rejected" | "unavailable"; detail: string };
const ACCEPT = ".pdf,.png,.jpg,.jpeg";
const euro = (value: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

const KID_NEED_LABELS: Record<keyof KidsCriteria, string> = {
  kita: "Kita / daycare",
  primarySchool: "primary school",
  highSchool: "high school",
  kidDoctor: "a children’s doctor",
};

export default function ApplyForm({ listing, kiez, initialKids, demoMode = false }: { listing: ExampleListing; kiez: string; initialKids: KidsCriteria; demoMode?: boolean }) {
  const minimumIncome = listing.kaltmiete_eur_monthly * 3;
  const minimumSavings = listing.warmmiete_eur_monthly * 3;
  const [demoProfile, setDemoProfile] = useState(demoMode);
  const [applicantName, setApplicantName] = useState(demoMode ? ANNA_MUELLER_DEMO.name : "");
  const [householdSummary, setHouseholdSummary] = useState(demoMode ? ANNA_MUELLER_DEMO.householdSummary : "");
  const [income, setIncome] = useState(demoMode ? String(minimumIncome) : "");
  const [hasGuarantor, setHasGuarantor] = useState<boolean | null>(demoMode ? false : null);
  const [hasDepositInsurance, setHasDepositInsurance] = useState<boolean | null>(demoMode ? false : null);
  const [savings, setSavings] = useState(demoMode ? "0" : "");
  const [smoking, setSmoking] = useState(demoMode ? "no" : "");
  const [moveIn, setMoveIn] = useState(demoMode ? "2026-12-01" : "");
  const [files, setFiles] = useState<Partial<Record<DocKey, File>>>({});
  const [docStatuses, setDocStatuses] = useState<Partial<Record<DocKey, DocStatus>>>({});
  const [answers, setAnswers] = useState(demoMode ? [ANNA_MUELLER_DEMO.familyAnswer, ANNA_MUELLER_DEMO.kiezAnswer, ANNA_MUELLER_DEMO.extraAnswer] : ["", "", ""]);
  const [draft, setDraft] = useState(demoMode ? ANNA_MUELLER_DEMO.story : "");
  const [landlordEmail, setLandlordEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoDocsLoading, setDemoDocsLoading] = useState(false);

  const checks = useMemo(() => {
    const financial = evaluateFinancialRoutes({
      monthlyIncome: income === "" ? null : Number(income),
      minimumIncome,
      hasGuarantor,
      hasDepositInsurance,
      savings: savings === "" ? null : Number(savings),
      minimumSavings,
    });
    const result: { label: string; pass: boolean | null; detail: string }[] = [
      { label: "Financial security", pass: financial.pass, detail: financial.pass ? `Meets the initial check via ${financial.satisfiedRoutes.join(", ")}. Supporting proof may be reviewed by the landlord.` : `One route is enough: income of ${euro(minimumIncome)} per month, a guarantor, deposit insurance, or savings of ${euro(minimumSavings)} (3× warm rent).` },
      { label: "Smoking", pass: smoking ? smoking === "no" : null, detail: "This prototype’s example screening requires a non-smoking household." },
      { label: "Move-in date", pass: moveIn ? moveIn >= "2026-12-01" : null, detail: "Move-in from 1 December 2026 (sample requirement)." },
      ...DOCS.slice(0, 4).map(([key, label]) => ({ label, pass: docStatuses[key]?.state === "verified" ? true : docStatuses[key]?.state === "rejected" ? false : null, detail: docStatuses[key]?.detail ?? (files[key] ? "Document check pending." : "Attach a file to continue.") })),
    ];
    return result;
  }, [docStatuses, files, hasDepositInsurance, hasGuarantor, income, minimumIncome, minimumSavings, moveIn, savings, smoking]);
  const failed = checks.some((c) => c.pass === false);
  const ready = checks.every((c) => c.pass === true);
  const validLandlordEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(landlordEmail.trim());

  function openEmailDraft() {
    if (!validLandlordEmail || !draft) return;
    const subject = `Rental application for a ${listing.rooms}-room flat in ${kiez}`;
    const body = `${draft.trim()}\n\nBest regards,`;
    const recipient = encodeURIComponent(landlordEmail.trim()).replace(/%40/gi, "@");
    const params = new URLSearchParams({ subject, body });
    window.location.href = `mailto:${recipient}?${params.toString()}`;
  }

  const chooseFile = useCallback(async (key: DocKey, file?: File) => {
    if (!file) return;
    if (!/^(application\/pdf|image\/(png|jpeg))$/.test(file.type) || file.size > 12 * 1024 * 1024) {
      setMessage("Please choose a PDF, PNG or JPG file smaller than 12 MB.");
      return;
    }
    setMessage("");
    setFiles((current) => ({ ...current, [key]: file }));
    if (key === "employment_contract") return;
    setDocStatuses((current) => ({ ...current, [key]: { state: "checking", detail: "Checking document…" } }));
    const form = new FormData();
    form.set("file", file);
    form.set("documentType", key);
    try {
      const response = await fetch("/api/landlord/documents/extract", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Document check failed (${response.status}).`);
      const values = Object.values(body.extracted ?? {}) as unknown[];
      const valid = values.length > 0 && values.every((value) => value !== false);
      const detail = body.demoFixture
        ? "Fictional demo sample accepted for this walkthrough. No real document was verified."
        : valid
          ? "Document type check passed. Only limited facts were extracted."
          : "This file did not pass the document type check. Please upload a clearer or correct document.";
      setDocStatuses((current) => ({ ...current, [key]: { state: valid ? "verified" : "rejected", detail } }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Document check failed.";
      setDocStatuses((current) => ({ ...current, [key]: { state: "unavailable", detail: `Could not verify this file: ${detail}` } }));
    }
  }, []);

  const loadDemoDocuments = useCallback(async () => {
    setDemoDocsLoading(true);
    setMessage("");
    try {
      for (const doc of ANNA_MUELLER_DEMO.documents) {
        const response = await fetch(doc.url);
        if (!response.ok) throw new Error(`Could not load ${doc.filename}.`);
        const file = new File([await response.blob()], doc.filename, { type: "application/pdf" });
        await chooseFile(doc.key, file);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the demo documents.");
    } finally {
      setDemoDocsLoading(false);
    }
  }, [chooseFile]);

  useEffect(() => {
    if (demoMode) void Promise.resolve().then(loadDemoDocuments);
  }, [demoMode, loadDemoDocuments]);

  function useAnnaDemo() {
    setDemoProfile(true);
    setApplicantName(ANNA_MUELLER_DEMO.name);
    setHouseholdSummary(ANNA_MUELLER_DEMO.householdSummary);
    setIncome(String(minimumIncome));
    setHasGuarantor(false);
    setHasDepositInsurance(false);
    setSavings("0");
    setSmoking("no");
    setMoveIn("2026-12-01");
    setAnswers([ANNA_MUELLER_DEMO.familyAnswer, ANNA_MUELLER_DEMO.kiezAnswer, ANNA_MUELLER_DEMO.extraAnswer]);
    setDraft(ANNA_MUELLER_DEMO.story);
    setLandlordEmail("");
    setMessage("");
    setFiles({});
    setDocStatuses({});
    void loadDemoDocuments();
  }

  function startFresh() {
    setDemoProfile(false);
    setApplicantName("");
    setHouseholdSummary("");
    setIncome("");
    setHasGuarantor(null);
    setHasDepositInsurance(null);
    setSavings("");
    setSmoking("");
    setMoveIn("");
    setAnswers(["", "", ""]);
    setDraft("");
    setLandlordEmail("");
    setFiles({});
    setDocStatuses({});
    setMessage("");
  }

  async function makeDraft() {
    if (!ready || failed) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tenant/cover-letter", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdSummary: [applicantName.trim(), householdSummary.trim()].filter(Boolean).join(" — ") || "Applicant household", moveInDate: moveIn, answers: { aboutYourFamily: answers[0], whyThisNeighborhood: answers[1], anythingElse: answers[2] } }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not prepare your story.");
      setDraft(body.draft);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare your story.");
    } finally { setBusy(false); }
  }

  return <main className="wr-apply-page">
    <div className="wr-apply-shell">
      <Link href="/" className="wr-apply-back">← Back to Wurzelraum</Link>
      <header className="wr-apply-heading"><span className="wr-eyebrow">Example flat · {kiez}</span><h1>Let’s get to know your household</h1><p>We’ll check the basic requirements first. If they don’t fit, we’ll tell you here before an application story is prepared.</p></header>
      <section className="wr-apply-section" aria-label="Demo profile options"><span className="wr-eyebrow">Quick demo</span>{demoProfile ? <><h2>Anna Müller’s fictional demo profile is loaded</h2><p>The sample documents and story are fictional walkthrough data. Change any field, or clear them to enter your own details.</p><button className="wr-btn wr-btn-ghost" type="button" onClick={startFresh} disabled={demoDocsLoading}>{demoDocsLoading ? "Finishing sample document checks…" : "Clear demo and enter my own details"}</button></> : <><h2>Try the full application journey</h2><p>Prefill this application with Anna Müller’s fictional household details and sample documents. You can edit everything before continuing.</p><button className="wr-btn wr-btn-yellow" type="button" onClick={useAnnaDemo} disabled={demoDocsLoading}>{demoDocsLoading ? "Loading demo documents…" : "Use Anna’s demo profile"}</button></>}</section>
      <div className="wr-apply-listing"><div><span>{listing.rooms} rooms · {listing.area_m2} m²</span><h2>{euro(listing.kaltmiete_eur_monthly)} cold rent <small>· {euro(listing.warmmiete_eur_monthly)} warm</small></h2></div><p>Example listing, not a live offer</p></div>
      <section className="wr-apply-section"><span className="wr-eyebrow">01 · A few basics</span><h2>Would this home work for you?</h2>
        <label className="wr-apply-field">Your name<input autoComplete="name" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} placeholder="Your full name" /></label>
        <label className="wr-apply-field">Your household<input value={householdSummary} onChange={(e) => setHouseholdSummary(e.target.value)} placeholder="Who would live here?" /></label>
        <label className="wr-apply-field">Monthly household income, including salary, benefits, pension or dividends (€)<input inputMode="decimal" type="number" min="0" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="Enter 0 if none; e.g. 3,570" /></label>
        <p style={{ color: "var(--wr-muted)", lineHeight: 1.5, marginTop: -12 }}>Income is one route—not a permanent-contract requirement. This prototype uses your answer for an initial self-reported check; it does not verify dividend statements.</p>
        <fieldset className="wr-apply-field"><legend>Could you provide a guarantor?</legend><div className="wr-apply-pills"><button type="button" className={hasGuarantor === true ? "is-active" : ""} onClick={() => setHasGuarantor(true)}>Yes</button><button type="button" className={hasGuarantor === false ? "is-active" : ""} onClick={() => setHasGuarantor(false)}>No</button></div></fieldset>
        <fieldset className="wr-apply-field"><legend>Do you have deposit insurance?</legend><div className="wr-apply-pills"><button type="button" className={hasDepositInsurance === true ? "is-active" : ""} onClick={() => setHasDepositInsurance(true)}>Yes</button><button type="button" className={hasDepositInsurance === false ? "is-active" : ""} onClick={() => setHasDepositInsurance(false)}>No</button></div></fieldset>
        <label className="wr-apply-field">Savings available (€)<input inputMode="decimal" type="number" min="0" value={savings} onChange={(e) => setSavings(e.target.value)} placeholder={`Enter 0 if none; ${euro(minimumSavings)} meets this route`} /></label>
        <p style={{ color: "var(--wr-muted)", lineHeight: 1.5 }}>Any one route can meet the financial check. These answers are self-reported; supporting evidence may be reviewed by a landlord later.</p>
        {Object.values(initialKids).some(Boolean) && <div style={{ borderLeft: "3px solid var(--wr-yellow)", padding: "12px 16px", margin: "18px 0", background: "var(--wr-card)", lineHeight: 1.55 }}><b>From your neighborhood search:</b> you said {Object.entries(initialKids).filter(([, relevant]) => relevant).map(([key]) => KID_NEED_LABELS[key as keyof KidsCriteria]).join(", ")} matter to your household. We’ll use this only to tailor your Kiez context. It won’t affect eligibility or the lottery, and it won’t be shared with the landlord unless you choose to include it in your story.</div>}
        <fieldset className="wr-apply-field"><legend>Does anyone in your household smoke?</legend><div className="wr-apply-pills"><button type="button" className={smoking === "no" ? "is-active" : ""} onClick={() => setSmoking("no")}>No</button><button type="button" className={smoking === "yes" ? "is-active" : ""} onClick={() => setSmoking("yes")}>Yes</button></div></fieldset>
        <label className="wr-apply-field">When could you move in?<input type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} /></label>
      </section>
      <section className="wr-apply-section"><span className="wr-eyebrow">02 · Documents</span><h2>Attach the requested documents</h2><p>Real uploads are sent to the configured vision model for a narrow type check. Identity documents are checked for validity only; no personal details are extracted. This prototype does not store the files.</p><p>The four fictional Wurzelraum demo PDFs are recognized by exact file contents, so you can preview the full interview even when document AI isn’t configured. They do not verify real documents.</p>
        <div className="wr-doc-list" key={demoProfile ? "anna-demo" : "fresh-entry"}>{DOCS.map(([key, label]) => <label className="wr-doc-row" key={key}><span><b>{label}</b>{files[key] ? <small>{files[key]!.name}</small> : <small>{key === "employment_contract" ? "Optional" : "Required"}</small>}</span><input type="file" accept={ACCEPT} onChange={(e) => chooseFile(key, e.target.files?.[0])} /></label>)}</div>
      </section>
      <section className="wr-apply-section"><span className="wr-eyebrow">03 · How the basic check works</span><h2>Clear before you continue</h2><div className="wr-check-list">{checks.map((check) => <div className="wr-check-row" key={check.label}><span className={check.pass === false ? "is-fail" : check.pass ? "is-pass" : ""}>{check.pass === false ? "×" : check.pass ? "✓" : "○"}</span><div><b>{check.label}</b><p>{check.detail}</p></div></div>)}</div>
        {failed && <div className="wr-apply-alert" role="alert"><b>This example’s basic requirements don’t fit.</b><p>We won’t prepare or forward an application. These are prototype criteria, not a real landlord decision.</p></div>}
        {!failed && !ready && Object.values(docStatuses).some((status) => status?.state === "unavailable") && <div className="wr-apply-alert" role="status"><b>We couldn’t verify one or more documents.</b><p>The document service may not be configured. We haven’t marked these files as valid, and the application story stays locked until the checks succeed.</p></div>}
      </section>
      {ready && !failed && <section className="wr-apply-section wr-interview"><span className="wr-eyebrow">04 · Your story</span><h2>A home is also about the people who live there.</h2><p>Now that we have your documents (and run basic checks on them), let’s craft your personal story to touch the landlord’s heart. Small neighbourhoods, Brandenburg and the suburbs often care about the people behind an application, especially when a landlord lives nearby. Tell us only what you’re comfortable sharing; your answers won’t affect the basic check.</p>{["Could you tell us a little about your household and what makes a place feel like home?", `What draws you to ${kiez}?${Object.values(initialKids).some(Boolean) ? ` You mentioned ${Object.entries(initialKids).filter(([, relevant]) => relevant).map(([key]) => KID_NEED_LABELS[key as keyof KidsCriteria]).join(", ")} in your neighborhood search—would you like to share how those needs shape your routines?` : ""}`, "Is there anything else you’d like the landlord to know?"] .map((question, i) => <label className="wr-apply-field" key={question}>{question}<textarea rows={3} value={answers[i]} onChange={(e) => setAnswers((current) => current.map((answer, j) => j === i ? e.target.value : answer))} /></label>)}<button className="wr-btn wr-btn-yellow" type="button" disabled={busy || !answers.some((a) => a.trim())} onClick={makeDraft}>{busy ? "Preparing your draft…" : "Help me shape my story →"}</button>{draft && <div className="wr-story-draft"><span className="wr-eyebrow">{demoProfile ? "Editable demo draft" : "Your editable draft"}</span><textarea aria-label="Editable application story" rows={9} value={draft} onChange={(e) => setDraft(e.target.value)} /><p>{demoProfile ? "This sample story is fictional and prefilled for the demo. Edit it before use." : "Review and edit every word."} Wurzelraum won’t send the email; your mail app will open a draft for you to review and send.</p><label className="wr-apply-field">Landlord’s email address<input type="email" autoComplete="email" value={landlordEmail} onChange={(e) => setLandlordEmail(e.target.value)} placeholder="landlord@example.com" /></label><button className="wr-btn wr-btn-yellow wr-story-email-btn" type="button" disabled={!validLandlordEmail} onClick={openEmailDraft}>Open in email app →</button></div>}</section>}
      {message && <p className="wr-apply-alert" role="status">{message}</p>}
      <p className="wr-apply-footnote">Prototype only. Example flats and sample requirements are not real offers. Wurzelraum doesn’t send applications; email opens in your own mail app for you to review and send.</p>
    </div>
  </main>;
}
