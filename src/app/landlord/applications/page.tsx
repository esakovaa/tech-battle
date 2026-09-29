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

type TabKey = "meetsRequirements" | "needsCheck" | "all";
const TAB_LABELS: Record<TabKey, string> = {
  meetsRequirements: "Meet requirements",
  needsCheck: "Need a check",
  all: "All",
};

function isCompleteDocs(documents: string): boolean {
  const [have, of] = documents.split(" of ").map(Number);
  return have === of;
}

interface LotteryDrawn {
  drawPosition: number;
  applicantId: string;
  anonLabel: string;
  household: string;
  invitationEmail?: string;
}

function LotteryPanel({ listingId, address }: { listingId: string; address: string }) {
  const [reveal, setReveal] = useState<{ seed: string; seedHash: string; hashMatchesCommitment: boolean; poolSize: number; drawn: LotteryDrawn[]; verification: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingAt, setViewingAt] = useState("");

  async function runLottery() {
    setLoading(true);
    setError(null);
    setReveal(null);
    try {
      const overrides = JSON.parse(sessionStorage.getItem("ll_overrides") ?? "{}");
      const committed = await fetch("/api/landlord/lottery/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, overrides }),
      });
      const commitment = await committed.json();
      if (!committed.ok) throw new Error(commitment.error ?? "Could not prepare the draw.");

      const drawn = await fetch("/api/landlord/lottery/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedHash: commitment.seedHash, shortlistSize: 15 }),
      });
      const result = await drawn.json();
      if (!drawn.ok) throw new Error(result.error ?? "Could not complete the draw.");
      setReveal(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete the draw.");
    } finally {
      setLoading(false);
    }
  }

  function prepareInvitations() {
    if (!reveal || !viewingAt) return;
    const recipients = reveal.drawn.map((winner) => winner.invitationEmail).filter((email): email is string => Boolean(email));
    if (!recipients.length) {
      setError("We couldn’t find invitation email addresses for these selected applicants.");
      return;
    }
    const date = new Date(viewingAt);
    const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short" }).format(date);
    const subject = `Viewing invitation — ${address}`;
    const body = `Hello,\n\nYou’re invited to view the apartment at ${address}.\n\nViewing: ${when}\n\nPlease reply to let us know whether you can attend.\n\nBest,\nYour landlord`;
    window.location.href = `mailto:?bcc=${encodeURIComponent(recipients.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <div className="ll-card">
      <h3 className="ll-card-name" style={{ fontSize: 20 }}>
        A fair draw for viewings
      </h3>
      <p className="ll-card-sub">
        Every applicant who meets all your requirements has an equal chance. We’ll draw up to 15 people to invite to a viewing.
      </p>

      {!reveal && (
        <button className="ll-btn-primary" type="button" onClick={runLottery} disabled={loading}>
          {loading ? "Drawing fairly…" : "Run lottery →"}
        </button>
      )}
      {error && <p className="ll-to-check-text" role="alert" style={{ color: "var(--ll-orange)" }}>{error}</p>}

      {reveal && (
        <div style={{ marginTop: 14 }}>
          <p
            className="ll-to-check-text"
            style={{ fontWeight: 500, color: reveal.hashMatchesCommitment ? "var(--ll-green)" : "var(--ll-orange)" }}
          >
            {reveal.hashMatchesCommitment
              ? `✓ Draw complete. ${reveal.drawn.length} applicants selected from ${reveal.poolSize} qualified applications.`
              : "✕ We couldn’t verify this draw. Please run it again."}
          </p>
          <ol className="ll-check-list" style={{ marginTop: 10 }}>
            {reveal.drawn.map((d) => (
              <li key={d.applicantId}>
                <span className="ll-check-mark">{d.drawPosition}.</span>
                {d.anonLabel} — {d.household}
              </li>
            ))}
          </ol>
          <p className="ll-to-check-text" style={{ fontSize: 12, color: "var(--ll-muted)", marginTop: 8 }}>
            The draw is random and can be verified. Each selected applicant’s email will be placed in BCC so invitees cannot see one another’s addresses.
          </p>
          <details className="ll-draw-details">
            <summary>How the draw stays fair</summary>
            <p>We fixed the eligible pool, then committed to a random seed before drawing. The seed and its published fingerprint are shown here so the result can be checked later.</p>
            <p><strong>Published fingerprint</strong><code>{reveal.seedHash}</code></p>
            <p><strong>Draw seed</strong><code>{reveal.seed}</code></p>
          </details>
          {reveal.hashMatchesCommitment && reveal.drawn.length > 0 && (
            <div className="ll-viewing-form">
              <label htmlFor="viewing-at">Set up a viewing day</label>
              <div className="ll-viewing-controls">
                <input id="viewing-at" type="datetime-local" value={viewingAt} onChange={(event) => setViewingAt(event.target.value)} />
                <button className="ll-btn-primary" type="button" onClick={prepareInvitations} disabled={!viewingAt}>
                  Open invitations in email app →
                </button>
              </div>
              <p className="ll-card-sub">We’ll open a ready-to-send email in your email app, addressed to all selected applicants.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApplicationsDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [tab, setTab] = useState<TabKey>("all");

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
        <h1 className="ll-h1">Your applications, clearly organized.</h1>

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
              {k === "all"
                ? `All applicants (${stats.applicationsReceived - stats.duplicatesMerged})`
                : k === "meetsRequirements"
                  ? `Meet all criteria (${stats.meetsRequirementsCount})`
                  : TAB_LABELS[k]}
            </button>
          ))}
        </div>

        <div className="ll-table-wrap">
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
            {rows.map((r) => (
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
        </div>

        <p className="ll-footnote">Showing all {rows.length} applicants in this view. Protected characteristics and personal stories are not used to decide who qualifies.</p>

        <hr className="ll-divider" />
        <h2 className="ll-panel-title">Invite people to a viewing</h2>
        <p className="ll-card-sub">First review the applicants who meet every requirement. When you’re ready, draw a fair shortlist of up to 15 people and choose a viewing time.</p>
        <LotteryPanel listingId={listing.id} address={listing.address} />
      </div>
    </>
  );
}
