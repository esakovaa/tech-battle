"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StepProgress } from "../StepProgress";
import type { RequirementCheck } from "@/lib/landlord-types";

interface ApplicantDetail {
  anonLabel: string;
  listingId: string;
  meetsAllRequirements: boolean;
  isRecommended: boolean;
  positiveFactors: string[];
  toCheck: string[];
  checks: RequirementCheck[];
  shownNotScored: { label: string; value: string }[];
  otherApplicationIds: string[];
  narrative: { text: string; note: string } | null;
}

function ApplicantCard({ detail }: { detail: ApplicantDetail }) {
  const household = detail.shownNotScored.find((s) => s.label === "Household")?.value ?? "";

  return (
    <div className="ll-card">
      <h3 className="ll-card-name">{detail.anonLabel}</h3>
      <p className="ll-card-sub">{household}</p>

      <p className="ll-to-check-label">WHY THIS APPLICANT {detail.meetsAllRequirements ? "IS SHORTLISTED" : "WAS NOT SHORTLISTED"}</p>
      <ul className="ll-check-list">
        {detail.positiveFactors.map((f, i) => (
          <li key={i}>
            <span className="ll-check-mark">✓</span>
            {f}
          </li>
        ))}
        {detail.checks
          .filter((c) => !c.passed)
          .map((c) => (
            <li key={c.key} style={{ color: "var(--ll-orange)" }}>
              <span style={{ color: "var(--ll-orange)" }}>✕</span>
              {c.detail}
            </li>
          ))}
      </ul>

      <p className="ll-to-check-label">TO CHECK</p>
      <p className="ll-to-check-text">{detail.toCheck.join(" ") || "Nothing outstanding"}</p>

      {detail.otherApplicationIds.length > 0 && (
        <p className="ll-to-check-text" style={{ marginTop: 8, color: "var(--ll-orange)" }}>
          Also applied {detail.otherApplicationIds.length} more time(s) (merged).
        </p>
      )}

      {detail.narrative ? (
        <section className="ll-narrative-box" aria-label="Applicant story">
          <span className="ll-narrative-label">Applicant’s story · context only · never used in screening or ranking</span>
          <p>{detail.narrative.text}</p>
        </section>
      ) : (
        <p className="ll-narrative-box ll-narrative-empty">This applicant hasn’t shared a personal note.</p>
      )}

      <div className="ll-card-actions">
        <button className="ll-btn-primary" type="button">
          📅 Invite to viewing
        </button>
      </div>
    </div>
  );
}

function RecommendedContent() {
  const searchParams = useSearchParams();
  const singleId = searchParams.get("id");
  const [details, setDetails] = useState<ApplicantDetail[] | null>(null);

  useEffect(() => {
    async function load() {
      if (singleId) {
        const res = await fetch(`/api/landlord/applicants/${singleId}`);
        const d = await res.json();
        setDetails([d]);
        return;
      }
      const listingId = sessionStorage.getItem("ll_listingId");
      if (!listingId) return;
      const overrides = JSON.parse(sessionStorage.getItem("ll_overrides") ?? "{}");
      const dashRes = await fetch("/api/landlord/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, overrides }),
      });
      const dash = await dashRes.json();
      const ids: string[] = dash.tabs.recommended.map((r: { id: string }) => r.id);
      const fetched = await Promise.all(ids.map((id) => fetch(`/api/landlord/applicants/${id}`).then((r) => r.json())));
      setDetails(fetched);
    }
    load();
  }, [singleId]);

  return (
    <>
      <StepProgress step={3} label="Shortlist" />
      <div className="ll-wrap ll-page">
        <span className="ll-eyebrow">Shortlist</span>
        <h1 className="ll-h1">{singleId ? "Applicant detail." : "Recommended for review."}</h1>
        <p className="ll-lede">
          {singleId
            ? "Every point below comes from the requirements you set — nothing here is a hidden preference score."
            : "These meet every requirement you set. We explain why; you decide who to invite. Nobody is rejected automatically."}
        </p>

        {!details && <p>Loading…</p>}
        {details && (
          <div className="ll-card-grid">
            {details.map((d) => (
              <ApplicantCard key={d.anonLabel} detail={d} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function RecommendedPage() {
  return (
    <Suspense fallback={<div className="ll-wrap ll-page">Loading…</div>}>
      <RecommendedContent />
    </Suspense>
  );
}
