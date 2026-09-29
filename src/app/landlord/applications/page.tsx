"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StepProgress } from "../StepProgress";
import type { Listing } from "@/lib/landlord-types";

interface Row {
  id: string;
  anonLabel: string;
  household: string;
  incomeToRentRatio: string;
  employment: string;
  documents: string;
  meetsAllRequirements: boolean;
  status: string;
}
interface DashboardResponse {
  listing: Listing;
  stats: {
    applicationsReceived: number;
    duplicatesMerged: number;
    meetsRequirementsCount: number;
    needsCheckCount: number;
    doesNotMeetCount: number;
  };
  tabs: { recommended: Row[]; meetsRequirements: Row[]; needsCheck: Row[]; all: Row[] };
}

type TabKey = "recommended" | "meetsRequirements" | "needsCheck" | "all";
const TAB_LABELS: Record<TabKey, string> = {
  recommended: "Recommended",
  meetsRequirements: "Meet requirements",
  needsCheck: "Need a check",
  all: "All",
};

function isCompleteDocs(documents: string): boolean {
  const [have, of] = documents.split(" of ").map(Number);
  return have === of;
}

export default function ApplicationsDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [tab, setTab] = useState<TabKey>("recommended");

  useEffect(() => {
    const listingId = sessionStorage.getItem("ll_listingId");
    if (!listingId) {
      router.replace("/landlord");
      return;
    }
    const overrides = JSON.parse(sessionStorage.getItem("ll_overrides") ?? "{}");
    fetch("/api/landlord/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, overrides }),
    })
      .then((r) => r.json())
      .then(setData);
  }, [router]);

  if (!data) {
    return (
      <div className="ll-wrap ll-page">
        <p>Loading applications…</p>
      </div>
    );
  }

  const { listing, stats } = data;
  const rows = data.tabs[tab];

  return (
    <>
      <StepProgress step={2} label="Applications" />
      <div className="ll-wrap ll-page">
        <div className="ll-kicker">
          {listing.address.toUpperCase()} · €{listing.warmmiete_eur_monthly.toLocaleString()} · {listing.rooms} ROOMS
        </div>
        <h1 className="ll-h1">
          {stats.applicationsReceived} applications. Here&apos;s where they
          <br />
          stand.
        </h1>

        <div className="ll-stat-row">
          <div>
            <div className="ll-stat-num">{stats.applicationsReceived}</div>
            <div className="ll-stat-label">applications received</div>
          </div>
          <div>
            <div className="ll-stat-num">{stats.duplicatesMerged}</div>
            <div className="ll-stat-label">duplicates merged</div>
          </div>
          <div>
            <div className="ll-stat-num">{stats.meetsRequirementsCount}</div>
            <div className="ll-stat-label">meet all your requirements</div>
          </div>
          <div>
            <div className="ll-stat-num accent">{stats.needsCheckCount}</div>
            <div className="ll-stat-label">missing information or need a check</div>
          </div>
        </div>

        <p className="ll-fairness-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden style={{ flexShrink: 0 }}>
            <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          Protected characteristics are excluded from applicant scoring.{" "}
          <a href="/landlord#how-it-works">What we use and ignore</a>
        </p>

        <h2 className="ll-panel-title">Applicants</h2>
        <div className="ll-tab-row">
          {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => (
            <button key={k} className={`ll-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)} type="button">
              {TAB_LABELS[k]}
            </button>
          ))}
        </div>

        <table className="ll-table">
          <thead>
            <tr>
              <th>Applicant</th>
              <th>Household</th>
              <th>Income / rent</th>
              <th>Employment</th>
              <th>Documents</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.id}>
                <td className="ll-applicant-name">{r.anonLabel}</td>
                <td>{r.household}</td>
                <td>{r.incomeToRentRatio}</td>
                <td>{r.employment}</td>
                <td style={{ color: isCompleteDocs(r.documents) ? undefined : "var(--ll-orange)" }}>{r.documents}</td>
                <td>
                  <span className="ll-status">
                    {r.meetsAllRequirements && <span className="ll-status-dot" />}
                    {r.status}
                  </span>
                </td>
                <td>
                  <a className="ll-open-link" href={`/landlord/recommended?id=${r.id}`}>
                    Open →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ll-bottom-cta-row">
          <p className="ll-footnote">A sample of synthetic applicants for this prototype.</p>
          <a className="ll-btn-primary" href="/landlord/recommended">
            See who is recommended →
          </a>
        </div>
      </div>
    </>
  );
}
