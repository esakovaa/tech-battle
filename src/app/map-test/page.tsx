"use client";

import dynamic from "next/dynamic";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PoiCategory } from "@/lib/poi-locations";

const KiezMap = dynamic(() => import("@/components/KiezMap"), { ssr: false });

// A few real Planungsräume spanning different profiles, for quick testing
// without having to know a plr_id off the top of your head.
const PRESETS = [
  { plrId: "03601347", label: "Helmholtzplatz (Prenzlauer Berg, dense, inner-city)" },
  { plrId: "06400735", label: "Wannsee (lakeside, low density)" },
  { plrId: "09301228", label: "Schmöckwitz/Rauchfangswerder (most remote in the dataset)" },
  { plrId: "01100308", label: "Charitéviertel (Mitte, central)" },
];

// Label shows the real intake field each category maps to — see
// preferencesToPoiCategories in lib/poi-locations.ts, the single source of
// truth a real (non-QA) caller should use instead of picking categories by
// hand. There's deliberately no "schools" entry: no point-location school
// data exists at all (kids.highSchool/primarySchool never map to anything).
const ALL_CATEGORIES: { value: PoiCategory; label: string }[] = [
  { value: "kita", label: "Kita (kids.kita)" },
  { value: "n_kinderarzt", label: "Kinderarzt (kids.kidDoctor)" },
  { value: "n_yoga_studios", label: "Yoga studio (hobbies.yoga)" },
  { value: "n_gym", label: "Gym (hobbies.gym)" },
  { value: "n_bouldering", label: "Bouldering (hobbies.bouldering)" },
];

export default function MapTestPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <MapTestForm />
    </Suspense>
  );
}

function MapTestForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [plrId, setPlrId] = useState(params.get("plrId") ?? PRESETS[0].plrId);
  const [categories, setCategories] = useState<PoiCategory[]>(
    (params.get("categories")?.split(",").filter(Boolean) as PoiCategory[]) ?? []
  );
  const [currentAddress, setCurrentAddress] = useState(params.get("currentAddress") ?? "");
  const [commuteAddress, setCommuteAddress] = useState(params.get("commuteAddress") ?? "");

  const [applied, setApplied] = useState({ plrId, categories, currentAddress, commuteAddress });

  function apply() {
    setApplied({ plrId, categories, currentAddress, commuteAddress });
    const q = new URLSearchParams();
    q.set("plrId", plrId);
    if (categories.length) q.set("categories", categories.join(","));
    if (currentAddress) q.set("currentAddress", currentAddress);
    if (commuteAddress) q.set("commuteAddress", commuteAddress);
    router.replace(`/map-test?${q.toString()}`);
  }

  function toggleCategory(cat: PoiCategory) {
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>KiezMap manual test page</h1>
      <p style={{ color: "#555" }}>
        Not a real app screen — a QA harness for <code>&lt;KiezMap&gt;</code>. Pick a Kiez, toggle which POI
        categories to highlight, optionally add addresses, then Apply. The URL updates so you can bookmark/share
        a specific test scenario.
      </p>

      <div style={{ display: "grid", gap: 12, background: "#f8f9fa", padding: 16, borderRadius: 8, marginBottom: 16 }}>
        <label>
          Kiez:{" "}
          <select value={plrId} onChange={(e) => setPlrId(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.plrId} value={p.plrId}>
                {p.label} ({p.plrId})
              </option>
            ))}
          </select>{" "}
          or type a plr_id directly:{" "}
          <input value={plrId} onChange={(e) => setPlrId(e.target.value)} style={{ width: 100 }} />
        </label>

        <div>
          Highlight categories (none checked = show all — a real user&apos;s map instead passes
          preferencesToPoiCategories(prefs), where none-selected correctly means show nothing):{" "}
          {ALL_CATEGORIES.map(({ value, label }) => (
            <label key={value} style={{ marginRight: 12 }}>
              <input type="checkbox" checked={categories.includes(value)} onChange={() => toggleCategory(value)} /> {label}
            </label>
          ))}
        </div>

        <label>
          Current address (needs nominatim.openstreetmap.org reachable):{" "}
          <input
            value={currentAddress}
            onChange={(e) => setCurrentAddress(e.target.value)}
            placeholder="e.g. Alexanderplatz, Berlin"
            style={{ width: 280 }}
          />
        </label>

        <label>
          Commute address (up to 1 here for simplicity; the API supports 2):{" "}
          <input
            value={commuteAddress}
            onChange={(e) => setCommuteAddress(e.target.value)}
            placeholder="e.g. Potsdamer Platz, Berlin"
            style={{ width: 280 }}
          />
        </label>

        <button onClick={apply} style={{ justifySelf: "start", padding: "6px 16px" }}>
          Apply
        </button>
      </div>

      <KiezMap
        key={JSON.stringify(applied)}
        plrId={applied.plrId}
        categories={applied.categories.length ? applied.categories : undefined}
        currentAddress={applied.currentAddress || undefined}
        commuteAddresses={applied.commuteAddress ? [applied.commuteAddress] : undefined}
        height={500}
      />
    </div>
  );
}
