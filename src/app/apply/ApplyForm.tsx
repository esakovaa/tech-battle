"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ExampleListing } from "@/lib/listings";

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

export default function ApplyForm({ listing, kiez }: { listing: ExampleListing; kiez: string }) {
  const [income, setIncome] = useState("");
  const [smoking, setSmoking] = useState("");
  const [moveIn, setMoveIn] = useState("");
  const [files, setFiles] = useState<Partial<Record<DocKey, File>>>({});
  const [docStatuses, setDocStatuses] = useState<Partial<Record<DocKey, DocStatus>>>({});
  const [answers, setAnswers] = useState(["", "", ""]);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const minimumIncome = listing.kaltmiete_eur_monthly * 3;
  const checks = useMemo(() => {
    const result: { label: string; pass: boolean | null; detail: string }[] = [
      { label: "Net household income", pass: income ? Number(income) >= minimumIncome : null, detail: `At least ${euro(minimumIncome)} per month (3× example cold rent)` },
      { label: "Smoking", pass: smoking ? smoking === "no" : null, detail: "This prototype’s example screening requires a non-smoking household." },
      { label: "Move-in date", pass: moveIn ? moveIn >= "2026-12-01" : null, detail: "Move-in from 1 December 2026 (sample requirement)." },
      ...DOCS.slice(0, 4).map(([key, label]) => ({ label, pass: docStatuses[key]?.state === "verified" ? true : docStatuses[key]?.state === "rejected" ? false : null, detail: docStatuses[key]?.detail ?? (files[key] ? "Document check pending." : "Attach a file to continue.") })),
    ];
    return result;
  }, [docStatuses, files, income, minimumIncome, moveIn, smoking]);
  const failed = checks.some((c) => c.pass === false);
  const ready = checks.every((c) => c.pass === true);

  async function chooseFile(key: DocKey, file?: File) {
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
      setDocStatuses((current) => ({ ...current, [key]: { state: valid ? "verified" : "rejected", detail: valid ? "Document type check passed. Only limited facts were extracted." : "This file did not pass the document type check. Please upload a clearer or correct document." } }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Document check failed.";
      setDocStatuses((current) => ({ ...current, [key]: { state: "unavailable", detail: `Could not verify this file: ${detail}` } }));
    }
  }

  async function makeDraft() {
    if (!ready || failed) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tenant/cover-letter", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdSummary: "Applicant household", moveInDate: moveIn, answers: { aboutYourFamily: answers[0], whyThisNeighborhood: answers[1], anythingElse: answers[2] } }),
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
      <div className="wr-apply-listing"><div><span>{listing.rooms} rooms · {listing.area_m2} m²</span><h2>{euro(listing.kaltmiete_eur_monthly)} cold rent <small>· {euro(listing.warmmiete_eur_monthly)} warm</small></h2></div><p>Example listing, not a live offer</p></div>
      <section className="wr-apply-section"><span className="wr-eyebrow">01 · A few basics</span><h2>Would this home work for you?</h2>
        <label className="wr-apply-field">Net household income per month (€)<input inputMode="decimal" type="number" min="0" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="e.g. 3,570" /></label>
        <fieldset className="wr-apply-field"><legend>Does anyone in your household smoke?</legend><div className="wr-apply-pills"><button type="button" className={smoking === "no" ? "is-active" : ""} onClick={() => setSmoking("no")}>No</button><button type="button" className={smoking === "yes" ? "is-active" : ""} onClick={() => setSmoking("yes")}>Yes</button></div></fieldset>
        <label className="wr-apply-field">When could you move in?<input type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} /></label>
      </section>
      <section className="wr-apply-section"><span className="wr-eyebrow">02 · Documents</span><h2>Attach the requested documents</h2><p>Each required file is sent to the configured vision model for a narrow type check. Identity documents are checked for validity only; no personal details are extracted. This prototype does not store the files.</p>
        <div className="wr-doc-list">{DOCS.map(([key, label]) => <label className="wr-doc-row" key={key}><span><b>{label}</b>{files[key] ? <small>{files[key]!.name}</small> : <small>{key === "employment_contract" ? "Optional" : "Required"}</small>}</span><input type="file" accept={ACCEPT} onChange={(e) => chooseFile(key, e.target.files?.[0])} /></label>)}</div>
      </section>
      <section className="wr-apply-section"><span className="wr-eyebrow">03 · How the basic check works</span><h2>Clear before you continue</h2><div className="wr-check-list">{checks.map((check) => <div className="wr-check-row" key={check.label}><span className={check.pass === false ? "is-fail" : check.pass ? "is-pass" : ""}>{check.pass === false ? "×" : check.pass ? "✓" : "○"}</span><div><b>{check.label}</b><p>{check.detail}</p></div></div>)}</div>
        {failed && <div className="wr-apply-alert" role="alert"><b>This example’s basic requirements don’t fit.</b><p>We won’t prepare or forward an application. These are prototype criteria, not a real landlord decision.</p></div>}
        {!failed && !ready && Object.values(docStatuses).some((status) => status?.state === "unavailable") && <div className="wr-apply-alert" role="status"><b>We couldn’t verify one or more documents.</b><p>The document service may not be configured. We haven’t marked these files as valid, and the application story stays locked until the checks succeed.</p></div>}
      </section>
      {ready && !failed && <section className="wr-apply-section wr-interview"><span className="wr-eyebrow">04 · Your story</span><h2>A home is also about the people who live there.</h2><p>Now that we have your documents (and run basic checks on them), let’s craft your personal story to touch the landlord’s heart. Small neighbourhoods, Brandenburg and the suburbs often care about the people behind an application, especially when a landlord lives nearby. Tell us only what you’re comfortable sharing; your answers won’t affect the basic check.</p>{["Could you tell us a little about your household and what makes a place feel like home?", `What draws you to ${kiez}?`, "Is there anything else you’d like the landlord to know?"] .map((question, i) => <label className="wr-apply-field" key={question}>{question}<textarea rows={3} value={answers[i]} onChange={(e) => setAnswers((current) => current.map((answer, j) => j === i ? e.target.value : answer))} /></label>)}<button className="wr-btn wr-btn-yellow" type="button" disabled={busy || !answers.some((a) => a.trim())} onClick={makeDraft}>{busy ? "Preparing your draft…" : "Help me shape my story →"}</button>{draft && <div className="wr-story-draft"><span className="wr-eyebrow">Your editable draft</span><textarea aria-label="Editable application story" rows={9} value={draft} onChange={(e) => setDraft(e.target.value)} /><p>You stay in control: review and edit every word. This prototype does not submit or send your application.</p></div>}</section>}
      {message && <p className="wr-apply-alert" role="status">{message}</p>}
      <p className="wr-apply-footnote">Prototype only. Example flats, sample requirements and local file checks are not a real application service. Nothing is sent to a landlord.</p>
    </div>
  </main>;
}
