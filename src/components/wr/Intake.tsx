"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Emblem, LandlordBand } from "./shared";
import type { RentBudget } from "@/lib/types";

export interface PlrPick {
  plr_id: string;
  plr_name: string;
  bezirk: string;
  dominant_plz: string;
}

export interface Answers {
  address: string;
  plr: PlrPick | null;
  kids: { kita: boolean; primarySchool: boolean; highSchool: boolean; kidDoctor: boolean };
  noKids: boolean;
  rentBudget: RentBudget | null;
  rooms: number;
  noiseAirSensitive: boolean | null;
  parksImportant: boolean | null;
  hobbies: { yoga: boolean; gym: boolean; bouldering: boolean; cafe: boolean; playground: boolean };
  otherHobby: boolean;
  otherHobbyText: string;
  commute1: string;
  commute2: string;
  /** Minutes; null = not chosen (the ranking's 60-minute default applies). */
  maxCommute: number | null;
  nomad: boolean;
  anythingElse: string;
}

export const EMPTY_ANSWERS: Answers = {
  address: "",
  plr: null,
  kids: { kita: false, primarySchool: false, highSchool: false, kidDoctor: false },
  noKids: false,
  rentBudget: null,
  rooms: 3,
  noiseAirSensitive: null,
  parksImportant: null,
  hobbies: { yoga: false, gym: false, bouldering: false, cafe: false, playground: false },
  otherHobby: false,
  otherHobbyText: "",
  commute1: "",
  commute2: "",
  maxCommute: null,
  nomad: false,
  anythingElse: "",
};

export const QUESTION_COUNT = 8;

function answeredCount(a: Answers): number {
  const kidsAnswered = a.noKids || Object.values(a.kids).some(Boolean);
  const niceToHaveAnswered =
    Object.values(a.hobbies).some(Boolean) || a.parksImportant != null || (a.otherHobby && a.otherHobbyText.trim().length > 1);
  return [
    a.plr != null || a.address.trim().length > 3,
    kidsAnswered,
    a.rentBudget != null,
    true, // rooms always has a value
    a.noiseAirSensitive != null,
    niceToHaveAnswered,
    a.nomad || a.commute1.trim().length > 3,
    a.anythingElse.trim().length > 2,
  ].filter(Boolean).length;
}

interface IntakeProps {
  answers: Answers;
  setAnswers: (fn: (a: Answers) => Answers) => void;
  onSubmit: () => void;
  addressError: string | null;
}

export default function Intake({ answers: a, setAnswers, onSubmit, addressError }: IntakeProps) {
  const set = (patch: Partial<Answers>) => setAnswers((prev) => ({ ...prev, ...patch }));
  const canSubmit = a.plr != null || a.address.trim().length > 3;
  const done = answeredCount(a);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (canSubmit) onSubmit();
    else document.getElementById("wr-address")?.focus();
  }

  return (
    <div className="wr-app">
      <section className="wr-hero">
        <img className="wr-cover" src="/photos/hero-aerial.jpg" alt="A park playground seen from above, with three round sandpits" />
        <div className="wr-hero-shade" />
        <nav className="wr-nav wr-wrap" aria-label="Main">
          <div className="wr-nav-group">
            <a href="#how">How it works</a>
            <a href="#questions">The questions</a>
          </div>
          <Emblem size={52} label="Wurzelraum" />
          <div className="wr-nav-group is-secondary">
            <a href="#how">For families</a>
            <a href="#footer">Contact</a>
          </div>
        </nav>
        <div className="wr-hero-copy">
          <p>Find the Berlin Kiez where your family fits — compared against where you live now, with real data and an honest word on the trade-offs.</p>
          <a href="#questions" className="wr-btn wr-btn-yellow">Find my Kiez</a>
        </div>
        <div className="wr-wordmark" aria-hidden>Wurzelraum</div>
      </section>

      <section className="wr-split wr-wrap" id="how">
        <div className="wr-story">
          <h2 className="wr-h2">Your family already knows where it belongs</h2>
          <Emblem size={110} color="var(--wr-yellow-deep)" />
          <p>
            The Kita walk, the Sunday park, the quiet at night, the ride to work. Tell us what shapes your days and
            we’ll show you the three Kieze that fit — and exactly what would change if you moved.
          </p>
          <a href="#questions" className="wr-btn">Start the questions</a>
        </div>
        <div className="wr-orbit">
          <img className="wr-cover" src="/photos/boy-jumping.jpg" alt="A small boy jumping on an open road under a blue sky" />
          <div className="wr-orbit-shade" />
          <svg viewBox="0 0 600 600" aria-hidden>
            <circle cx="300" cy="300" r="270" fill="none" stroke="#F4E48C" strokeWidth="1.6" strokeDasharray="4 7" />
          </svg>
          {[
            ["Where you are now", 50, 7],
            ["Kita + school", 81, 19],
            ["Rent budget", 93, 50],
            ["Rooms", 81, 81],
            ["Quiet + clean air", 50, 93],
            ["Parks + nature", 19, 81],
            ["Hobbies", 7, 50],
            ["Commute", 19, 19],
          ].map(([label, x, y]) => (
            <span key={label as string} style={{ left: `${x}%`, top: `${y}%` }}>
              {label}
            </span>
          ))}
        </div>
      </section>

      <section className="wr-band">
        <div className="wr-band-inner wr-wrap">
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <span className="wr-eyebrow">Why families use us</span>
            <h2>Real data, plain words, three honest options</h2>
            <p>
              We look past rent and square metres to the things that shape a family’s week — then tell you what you’d
              gain and give up, like a friend who knows every Kiez.
            </p>
          </div>
          <div className="wr-why">
            <div>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="#141414" aria-hidden><path d="M12 2c1.2 3 1.2 5.5 0 8 2.5-1.2 5-1.2 8 0-3 1.2-5.5 1.2-8 0 1.2 2.5 1.2 5 0 8-1.2-3-1.2-5.5 0-8-2.5 1.2-5 1.2-8 0 3-1.2 5.5-1.2 8 0-1.2-2.5-1.2-5 0-8z" /><path d="M11 18h2v4h-2z" /></svg>
              <strong>Compared with your Kiez</strong>
              <p>Every result is measured against where you live today, so better and worse mean something.</p>
            </div>
            <div>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="#141414" aria-hidden><path d="M3 20C6 12 12 6 21 4c-2 9-8 15-16 17z" /></svg>
              <strong>Only what you care about</strong>
              <p>No kids? No Kita rows. No hobbies? No gym counts. The comparison follows your answers.</p>
            </div>
            <div>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="#141414" aria-hidden><path d="M3 5h18v11H9l-5 4v-4H3z" /></svg>
              <strong>Explained, then open for questions</strong>
              <p>A clear write-up of the trade-offs, and a place to ask “but what about…”.</p>
            </div>
          </div>
        </div>
      </section>

      <form id="questions" className="wr-form wr-wrap" onSubmit={submit} noValidate>
        <div className="wr-form-intro">
          <span className="wr-eyebrow">The questions</span>
          <h2>Tell us how you live</h2>
          <p>Nine short questions. Skip anything that doesn’t apply — we only compare what matters to you.</p>
          <div className="wr-progress" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={QUESTION_COUNT} aria-valuenow={done}>
            <div style={{ width: `${(done / QUESTION_COUNT) * 100}%` }} />
          </div>
          <span className="wr-help">{done} of {QUESTION_COUNT} answered</span>
        </div>

        <div>
          <Question num="01">
            <AddressField answers={a} set={set} error={addressError} />
          </Question>

          <Question num="02">
            <fieldset>
              <legend className="wr-q-title">If you have kids, what matters?</legend>
              <div className="wr-chips" style={{ marginTop: 16 }}>
                {(
                  [
                    ["kita", "Kita (daycare)"],
                    ["primarySchool", "Primary school"],
                    ["highSchool", "High school"],
                    ["kidDoctor", "Kids’ doctor nearby"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="wr-chip">
                    <input
                      type="checkbox"
                      checked={a.kids[key]}
                      onChange={(e) => set({ kids: { ...a.kids, [key]: e.target.checked }, noKids: false })}
                    />
                    {label}
                  </label>
                ))}
                <label className="wr-chip is-dashed">
                  <input
                    type="checkbox"
                    checked={a.noKids}
                    onChange={(e) =>
                      set({ noKids: e.target.checked, kids: e.target.checked ? EMPTY_ANSWERS.kids : a.kids })
                    }
                  />
                  No kids / not relevant
                </label>
              </div>
              {a.kids.primarySchool && (
                <p className="wr-help" style={{ margin: "12px 0 0" }}>
                  Heads-up: there’s no reliable primary-school data yet, so we’ll note it rather than rank on it.
                </p>
              )}
            </fieldset>
          </Question>

          <Question num="03">
            <fieldset>
              <legend className="wr-q-title">Rent budget</legend>
              <div className="wr-seg is-wide" style={{ marginTop: 16 }}>
                {(
                  [
                    ["minimal", "Keep it minimal"],
                    ["flexible", "Flexible"],
                    ["not_a_concern", "Not a concern"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="wr-chip">
                    <input type="radio" name="rent" checked={a.rentBudget === value} onChange={() => set({ rentBudget: value })} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </Question>

          <Question num="04">
            <div className="wr-q-row">
              <span id="rooms-label" className="wr-q-title">Minimum rooms</span>
              <div className="wr-stepper" role="group" aria-labelledby="rooms-label">
                <button type="button" aria-label="Fewer rooms" disabled={a.rooms <= 1} onClick={() => set({ rooms: Math.max(1, a.rooms - 1) })}>−</button>
                <output aria-live="polite">{a.rooms >= 5 ? "5+" : a.rooms}</output>
                <button type="button" aria-label="More rooms" disabled={a.rooms >= 5} onClick={() => set({ rooms: Math.min(5, a.rooms + 1) })}>+</button>
              </div>
            </div>
            <span className="wr-help">Counted the German way — bedrooms plus living room, not kitchen or bath.</span>
          </Question>

          <Question num="05">
            <fieldset className="wr-q-row">
              <legend className="wr-q-title" style={{ float: "left" }}>Sensitive to noise and air quality?</legend>
              <YesNo name="noise" value={a.noiseAirSensitive} onChange={(v) => set({ noiseAirSensitive: v })} yes="Yes" no="No" />
            </fieldset>
          </Question>

          <Question num="06">
            <fieldset className="wr-q-row">
              <legend className="wr-q-title" style={{ float: "left" }}>Nice to have nearby</legend>
              <div className="wr-chips">
                {(
                  [
                    ["yoga", "Yoga"],
                    ["gym", "Gym"],
                    ["bouldering", "Bouldering"],
                    ["cafe", "Cafe"],
                    ["playground", "Playground"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="wr-chip">
                    <input type="checkbox" checked={a.hobbies[key]} onChange={(e) => set({ hobbies: { ...a.hobbies, [key]: e.target.checked } })} />
                    {label}
                  </label>
                ))}
                <label className="wr-chip">
                  <input type="checkbox" checked={a.parksImportant === true} onChange={(e) => set({ parksImportant: e.target.checked })} />
                  Park/Nature
                </label>
                <label className="wr-chip">
                  <input
                    type="checkbox"
                    checked={a.otherHobby}
                    aria-controls="wr-other-hobby"
                    onChange={(e) => {
                      set({ otherHobby: e.target.checked });
                      if (e.target.checked) requestAnimationFrame(() => document.getElementById("wr-other-hobby")?.focus());
                    }}
                  />
                  Other
                </label>
              </div>
            </fieldset>
            {a.otherHobby && (
              <>
                <label htmlFor="wr-other-hobby" className="wr-sr">Your other hobby</label>
                <input
                  id="wr-other-hobby"
                  className="wr-input"
                  type="text"
                  autoComplete="off"
                  maxLength={120}
                  placeholder="Which one? e.g. running, swimming, choir"
                  value={a.otherHobbyText}
                  onChange={(e) => set({ otherHobbyText: e.target.value })}
                />
              </>
            )}
          </Question>

          <Question num="07">
            <span className="wr-q-title">Your core commute address(es)</span>
            <span className="wr-help">Work, a studio, grandparents. We check real public-transport times — totally optional.</span>
            <label htmlFor="wr-c1" className="wr-sr">First commute address</label>
            <input
              id="wr-c1"
              className="wr-input"
              type="text"
              autoComplete="off"
              placeholder="e.g. Friedrichstraße 43, 10117 Berlin"
              value={a.commute1}
              disabled={a.nomad}
              onChange={(e) => set({ commute1: e.target.value })}
            />
            <label htmlFor="wr-c2" className="wr-sr">Second commute address</label>
            <input
              id="wr-c2"
              className="wr-input is-optional"
              type="text"
              autoComplete="off"
              placeholder="A second address (optional)"
              value={a.commute2}
              disabled={a.nomad}
              onChange={(e) => set({ commute2: e.target.value })}
            />
            <fieldset className="wr-q-row" disabled={a.nomad} style={{ marginTop: 10, opacity: a.nomad ? 0.4 : 1 }}>
              <legend className="wr-sub-title" style={{ float: "left" }}>Maximum commute time for you</legend>
              <div className="wr-seg">
                {[20, 30, 45, 60, 90].map((m) => (
                  <label key={m} className="wr-chip" style={{ padding: "0 16px" }}>
                    <input type="radio" name="max-commute" checked={a.maxCommute === m} onChange={() => set({ maxCommute: m })} />
                    {m} min
                  </label>
                ))}
              </div>
            </fieldset>
            <span className="wr-help">
              One way, by public transport. Kieze over it are left out while there are enough others{a.maxCommute == null ? " — no choice means 60 minutes" : ""}.
            </span>
            <label className="wr-chip is-yellow" style={{ alignSelf: "flex-start", marginTop: 8 }}>
              <input type="checkbox" checked={a.nomad} onChange={(e) => set({ nomad: e.target.checked })} />
              None — I’m flexible / a nomad
            </label>
          </Question>

          <Question num="08">
            <label htmlFor="wr-anything" className="wr-q-title">Anything else is important for you?</label>
            <span id="wr-anything-help" className="wr-help">In your own words — we’ll check what our data can tell you about it, and say honestly where it can’t.</span>
            <textarea
              id="wr-anything"
              className="wr-input wr-textarea"
              rows={3}
              maxLength={600}
              aria-describedby="wr-anything-help"
              placeholder="e.g. we both work from home, grandparents live in Spandau, our eldest has asthma…"
              value={a.anythingElse}
              onChange={(e) => set({ anythingElse: e.target.value })}
            />
          </Question>
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>

      <section className="wr-dark">
        <div className="wr-cta wr-wrap">
          <h2>Ready when you are.</h2>
          <div className="wr-cta-side">
            <button type="button" className="wr-btn wr-btn-yellow" style={{ minHeight: 60, padding: "0 38px", fontSize: 16 }} onClick={() => (canSubmit ? onSubmit() : document.getElementById("wr-address")?.focus())}>
              Find my Kiez
            </button>
            <span>{canSubmit ? "Takes a few seconds. You can change any answer later." : "Add your current address first — question 01."}</span>
          </div>
        </div>
      </section>

      <LandlordBand />

      <section className="wr-dark">
        <footer id="footer" className="wr-footer wr-wrap">
          <span className="wr-display" style={{ fontSize: 28, letterSpacing: 0, color: "var(--wr-yellow)" }}>Wurzelraum</span>
          <span>BERLIN PLANUNGSRAUM DATA · PHOTOS VIA UNSPLASH · © 2026</span>
        </footer>
      </section>
    </div>
  );
}

function Question({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <div className="wr-q">
      <span className="wr-q-num">{num}</span>
      <div className="wr-q-body">{children}</div>
    </div>
  );
}

function YesNo({ name, value, onChange, yes, no }: { name: string; value: boolean | null; onChange: (v: boolean) => void; yes: string; no: string }) {
  return (
    <div className="wr-seg">
      <label className="wr-chip">
        <input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} />
        {yes}
      </label>
      <label className="wr-chip">
        <input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} />
        {no}
      </label>
    </div>
  );
}

function AddressField({ answers: a, set, error }: { answers: Answers; set: (p: Partial<Answers>) => void; error: string | null }) {
  const [results, setResults] = useState<PlrPick[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const reqRef = useRef(0);

  const query = a.address.trim();
  useEffect(() => {
    if (query.length < 2 || a.plr) return;
    const req = ++reqRef.current;
    const t = setTimeout(() => {
      fetch(`/api/plr-search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d: { results: PlrPick[] }) => {
          if (req === reqRef.current) {
            setResults(d.results);
            setActive(-1);
          }
        })
        .catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [query, a.plr]);

  const shown = open && !a.plr && query.length >= 2 ? results : [];

  function pick(p: PlrPick) {
    set({ plr: p, address: `${p.plr_name}, ${p.dominant_plz} Berlin` });
    setOpen(false);
  }

  return (
    <>
      <label htmlFor="wr-address" className="wr-q-title">Your current address</label>
      <div className="wr-suggest-wrap">
        <input
          id="wr-address"
          className="wr-input"
          type="text"
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby="wr-address-help"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          placeholder="Street and number, or your Kiez / postcode"
          value={a.address}
          onChange={(e) => {
            set({ address: e.target.value, plr: null });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!shown.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(shown.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              pick(shown[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {shown.length > 0 && (
          <ul className="wr-suggest" id={listId} role="listbox" aria-label="Matching Kieze">
            {shown.map((p, i) => (
              <li key={p.plr_id} role="presentation">
                <button type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
                  <span>{p.plr_name}</span>
                  <small>
                    {p.bezirk} · {p.dominant_plz}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? (
        <span className="wr-error" role="alert">{error}</span>
      ) : a.plr ? (
        <span className="wr-picked">
          Your Kiez: {a.plr.plr_name}, {a.plr.bezirk}
        </span>
      ) : (
        <span id="wr-address-help" className="wr-help">So we know what you’re comparing against. Pick a suggestion, or type a full street address.</span>
      )}
    </>
  );
}
