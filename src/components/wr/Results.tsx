"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_KICKOFF, AgentNotConfigured, Emblem, Typed, streamAgent, type ChatTurn } from "./shared";
import {
  assignKiezPhotos,
  cellDirection,
  composeNarrative,
  conditionLabel,
  displayValue,
  eraLabel,
  euro,
  factorCopy,
  flatPhoto,
  floorLabel,
  offlineAnswer,
  poiCategoriesFor,
  summarySentence,
  type Direction,
  type ListingsApiResponse,
  type RankApiResponse,
} from "@/lib/wurzelraum";
import type { UserPreferences } from "@/lib/types";

const KiezMap = dynamic(() => import("@/components/KiezMap"), {
  ssr: false,
  loading: () => <div style={{ height: 380, display: "grid", placeItems: "center", fontSize: 14 }}>Loading map…</div>,
});

interface ResultsProps {
  data: RankApiResponse;
  prefs: UserPreferences;
  onEdit: () => void;
  onRestart: () => void;
}

const GLYPH: Record<Direction, string> = { better: "↑", same: "=", worse: "↓" };
const GLYPH_LABEL: Record<Direction, string> = { better: "Better for you", same: "About the same", worse: "Worse for you" };

export default function Results({ data, prefs, onEdit, onRestart }: ResultsProps) {
  const { current, alternatives, comparisonTable: table } = data;
  const photos = useMemo(() => assignKiezPhotos(alternatives.map((a) => a.plr)), [alternatives]);
  const bestIdx = alternatives.reduce((bi, a, i) => (a.score > alternatives[bi].score ? i : bi), 0);
  const [selected, setSelected] = useState<number | null>(null);
  const flatsRef = useRef<HTMLElement>(null);

  // Agent-facing preferences: pin the already-resolved Kiez so the agent
  // never has to re-geocode the address.
  const agentPrefs = useMemo(() => ({ ...prefs, currentPlrId: current.plr_id, currentAddress: undefined }), [prefs, current.plr_id]);

  function openFlats(i: number) {
    setSelected(i);
    requestAnimationFrame(() => flatsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const nameSize = `min(170px, calc((100vw - 48px) / ${Math.max(8, current.plr_name.length) * 0.5}))`;
  const matchedOn = [
    prefs.kids.kita && "Kita",
    prefs.kids.primarySchool && "primary school",
    prefs.kids.highSchool && "high schools",
    prefs.kids.kidDoctor && "a kids’ doctor",
    prefs.rentBudget === "minimal" ? "a tight budget" : prefs.rentBudget === "flexible" ? "a flexible budget" : null,
    prefs.roomsNeeded && `${prefs.roomsNeeded >= 5 ? "5+" : prefs.roomsNeeded} rooms`,
    prefs.noiseAirSensitive && "quiet and clean air",
    prefs.parksImportant && "parks",
    prefs.hobbies.yoga && "yoga",
    prefs.hobbies.gym && "a gym",
    prefs.hobbies.bouldering && "bouldering",
    prefs.commuteAddresses?.length && "your commute",
  ].filter(Boolean) as string[];

  return (
    <div className="wr-app">
      <section className="wr-rhero">
        <img className="wr-cover" src="/photos/street-now.jpg" alt="" />
        <div className="wr-rhero-shade" />
        <nav className="wr-nav wr-wrap" aria-label="Results">
          <button type="button" onClick={onEdit}>← Edit answers</button>
          <span className="wr-display" style={{ fontSize: 26, letterSpacing: 0, textTransform: "none", color: "var(--wr-yellow)" }}>Wurzelraum</span>
          <button type="button" onClick={onRestart}>Start over</button>
        </nav>
        <div className="wr-rhero-copy">
          <span className="wr-eyebrow">Where you live now · {current.bezirk}</span>
          <p aria-live="polite">
            <Typed text={summarySentence(data)} cps={70} />
          </p>
        </div>
        <h1 className="wr-rhero-name" style={{ fontSize: nameSize, margin: 0, fontWeight: 400 }}>{current.plr_name}</h1>
      </section>

      <section className="wr-section wr-wrap" aria-labelledby="cards-title">
        <div className="wr-section-head">
          <h2 id="cards-title" className="wr-h2">Three Kieze worth<br />a closer look</h2>
          <p>{matchedOn.length ? `Matched on ${matchedOn.join(", ")}` : "Matched on the basics every family cares about"} — each one further from the centre than where you are now.</p>
        </div>
        <div className="wr-cards">
          {alternatives.map((alt, i) => {
            const pc = table.prosCons[i];
            const isSel = selected === i;
            return (
              <article key={alt.plr.plr_id} className={`wr-card${isSel ? " is-selected" : ""}`}>
                <button type="button" className="wr-card-photo" onClick={() => openFlats(i)} aria-label={`${alt.plr.plr_name}: see example flats`}>
                  <img className="wr-cover" src={photos[i].src} alt={photos[i].alt} />
                  <span className="wr-card-tag">Illustrative photo</span>
                  {i === bestIdx && <span className="wr-card-pick">Best match</span>}
                  <span className="wr-card-name">
                    <span className="wr-eyebrow" style={{ fontSize: 10 }}>{alt.plr.bezirk} · {alt.plr.dominant_plz}</span>
                    <strong className={alt.plr.plr_name.length > 13 ? "is-long" : undefined}>{alt.plr.plr_name}</strong>
                  </span>
                </button>
                <span className="wr-card-fit">
                  {alt.plr.distance_from_center_km.toFixed(1)} km from Alexanderplatz
                  {alt.commuteMinutes != null ? ` · about ${Math.round(alt.commuteMinutes)} min commute` : ""}
                </span>
                <div className="wr-pc">
                  {pc.pros.slice(0, 5).map((f) => (
                    <div key={f}><span className="wr-mark is-pro" aria-label="Better">+</span>{factorCopy(f).pro}</div>
                  ))}
                  {pc.cons.map((f) => (
                    <div key={f} style={{ color: "var(--wr-ink-3)" }}><span className="wr-mark is-con" aria-label="Worse">–</span>{factorCopy(f).con}</div>
                  ))}
                </div>
                <button type="button" className="wr-btn wr-btn-ghost" onClick={() => openFlats(i)} aria-expanded={isSel} aria-controls="wr-flats">
                  {isSel ? "Showing example flats ↓" : "See example flats"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {selected != null && (
        <section id="wr-flats" ref={flatsRef} className="wr-flats" aria-label={`Example flats in ${alternatives[selected].plr.plr_name}`}>
          <Flats key={alternatives[selected].plr.plr_id} data={data} prefs={prefs} index={selected} onClose={() => setSelected(null)} />
        </section>
      )}

      <section className="wr-section wr-wrap" aria-labelledby="cmp-title">
        <div className="wr-section-head" style={{ marginBottom: 32 }}>
          <h2 id="cmp-title" className="wr-h2">Side by side</h2>
          <div className="wr-legend" style={{ justifySelf: "end" }}>
            {(["better", "same", "worse"] as Direction[]).map((d) => (
              <span key={d}><span className={`wr-glyph is-${d}`} aria-hidden>{GLYPH[d]}</span>{GLYPH_LABEL[d]}</span>
            ))}
          </div>
        </div>
        <div className="wr-table-scroll">
          <div className="wr-table" role="table" aria-labelledby="cmp-title">
            <div className="wr-tr is-head" role="row">
              <div className="wr-th" role="columnheader" style={{ paddingLeft: 0 }}><small>What you asked about</small></div>
              <div className="wr-th is-current" role="columnheader"><small>You are here</small>{current.plr_name}</div>
              {alternatives.map((a, i) => (
                <div key={a.plr.plr_id} className={`wr-th${selected === i ? " is-current" : ""}`} role="columnheader"><small>{a.plr.bezirk}</small>{a.plr.plr_name}</div>
              ))}
            </div>
            {table.rows.map((row) => (
              <div key={row.factor} className="wr-tr" role="row">
                <div className="wr-rh" role="rowheader">{factorCopy(row.factor).label}</div>
                <div className="wr-td is-current" role="cell">{displayValue(row.current)}</div>
                {row.alternatives.map((v, i) => {
                  const d = cellDirection(table, i, row.factor);
                  return (
                    <div key={i} className={`wr-td${selected === i ? " is-selected" : ""}`} role="cell">
                      <span className={`wr-glyph is-${d}`} role="img" aria-label={GLYPH_LABEL[d]}>{GLYPH[d]}</span>
                      {displayValue(v)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="wr-source" style={{ marginTop: 16 }}>
          Rent is a modelled estimate (runs below real asking prices) — compare Kieze with each other, not with live listings. Crime rates are district-level, 2017–2019.
          {data.primarySchoolNote ? ` ${data.primarySchoolNote}` : ""}
        </p>
      </section>

      <Conversation data={data} prefs={prefs} agentPrefs={agentPrefs} />
    </div>
  );
}

function Flats({ data, prefs, index, onClose }: { data: RankApiResponse; prefs: UserPreferences; index: number; onClose: () => void }) {
  const alt = data.alternatives[index];
  const rooms = prefs.roomsNeeded;
  const [state, setState] = useState<{ data: ListingsApiResponse | null; error: string | null }>({ data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ plrId: alt.plr.plr_id });
    if (rooms) q.set("rooms", String(rooms));
    fetch(`/api/listings?${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json() as Promise<ListingsApiResponse>;
      })
      .then((d) => !cancelled && setState({ data: d, error: null }))
      .catch((e) => !cancelled && setState({ data: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [alt.plr.plr_id, rooms]);

  const listings = state.data?.listings ?? [];
  const exact = state.data?.exactRoomMatch ?? true;
  const roomsText = rooms ? `${rooms >= 5 ? "5+" : rooms} rooms` : "Homes";
  const categories = poiCategoriesFor(prefs);

  return (
    <div className="wr-flats-inner wr-wrap">
      <div className="wr-flats-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <span className="wr-eyebrow">Example flats · {alt.plr.plr_name}</span>
          <h2>{state.data && listings.length === 0 ? "No example flats here yet" : exact ? `${roomsText}, as you asked` : `Closest matches to ${roomsText.toLowerCase()}`}</h2>
          <p>Example listings — for a feel of what’s typical here, not current live offers. Prices come from a pricing model and run below real market level.</p>
        </div>
        <button type="button" className="wr-btn wr-btn-ghost" onClick={onClose}>Hide flats</button>
      </div>

      {state.data && !exact && listings.length > 0 && (
        <div className="wr-flats-note" role="note">
          <Emblem size={28} color="var(--wr-ink)" />
          <span>
            <strong style={{ fontWeight: 600 }}>{roomsText} are rare in {alt.plr.plr_name} right now.</strong> Here are the closest matches instead — a little smaller or a little bigger than you asked for.
          </span>
        </div>
      )}

      {state.error && <div className="wr-flats-note" role="alert">Couldn’t load example flats: {state.error}</div>}
      {state.data && listings.length === 0 && <div className="wr-flats-note" role="note">The listings dataset has no flats in {alt.plr.plr_name}, so we can’t show what’s typical here. The map below still shows what’s nearby.</div>}

      <div className="wr-flats-grid" aria-busy={!state.data && !state.error}>
        {(state.data ? listings : [null, null, null]).map((l, i) =>
          l ? (
            <article key={l.id} className="wr-flat">
              <div className="wr-flat-photo">
                <img className="wr-cover" src={flatPhoto(alt.plr.plr_id, i).src} alt={`${flatPhoto(alt.plr.plr_id, i).alt} (illustrative)`} />
              </div>
              <div className="wr-flat-body">
                <div className="wr-flat-top">
                  <strong>{l.rooms} rooms</strong>
                  <span>{l.area_m2.toFixed(0)} m²</span>
                </div>
                {rooms && l.rooms !== rooms && <span className="wr-closest">Closest match · {l.rooms > rooms ? `${l.rooms - rooms} more` : `${rooms - l.rooms} fewer`} room{Math.abs(l.rooms - rooms) === 1 ? "" : "s"}</span>}
                <div className="wr-flat-rent">
                  <div><span>COLD RENT</span><b>{euro(l.kaltmiete_eur_monthly)}</b></div>
                  <div><span>WARM RENT</span><b>{euro(l.warmmiete_eur_monthly)}</b></div>
                </div>
                <div className="wr-flat-meta">
                  <span>{floorLabel(l.floor, l.total_floors)}</span>
                  <span>{conditionLabel(l.condition)}</span>
                  <span>{eraLabel(l.building_era)}</span>
                  {l.has_balcony && <b>+ Balcony</b>}
                  {l.has_lift && <b>+ Lift</b>}
                </div>
              </div>
            </article>
          ) : (
            <div key={i} className="wr-flat" style={{ minHeight: 420, opacity: 0.5 }} />
          )
        )}
      </div>

      <div className="wr-map">
        <KiezMap plrId={alt.plr.plr_id} categories={categories} currentAddress={prefs.currentAddress} commuteAddresses={prefs.commuteAddresses} height={380} />
      </div>
    </div>
  );
}

type Mode = "checking" | "agent" | "offline";

function Conversation({ data, prefs, agentPrefs }: { data: RankApiResponse; prefs: UserPreferences; agentPrefs: UserPreferences }) {
  const [mode, setMode] = useState<Mode>("checking");
  const [narrative, setNarrative] = useState("");
  const [narrativeDone, setNarrativeDone] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState<{ text: string; typed: boolean } | null>(null);
  const [input, setInput] = useState("");
  const fallback = useMemo(() => composeNarrative(data, prefs), [data, prefs]);

  useEffect(() => {
    const ctrl = new AbortController();
    streamAgent(agentPrefs, [], (t) => {
      setMode("agent");
      setNarrative(t);
    }, ctrl.signal)
      .then((t) => {
        if (!t) throw new Error("empty");
        setNarrative(t);
        setNarrativeDone(true);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        if (!(err instanceof AgentNotConfigured)) console.warn("Agent unavailable, using data-only write-up:", err);
        setMode("offline");
        setNarrative(fallback);
      });
    return () => ctrl.abort();
  }, [agentPrefs, fallback]);

  const busy = pending != null;

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const history: ChatTurn[] = [...turns, { role: "user", text: q }];
    setTurns(history);
    if (mode === "agent") {
      setPending({ text: "", typed: false });
      try {
        const base: ChatTurn[] = [{ role: "user", text: AGENT_KICKOFF }, { role: "assistant", text: narrative }];
        const answer = await streamAgent(agentPrefs, [...base, ...history], (t) => setPending({ text: t, typed: false }));
        setTurns((t) => [...t, { role: "assistant", text: answer || "Sorry — I didn’t get an answer back. Try asking again?" }]);
      } catch {
        setTurns((t) => [...t, { role: "assistant", text: offlineAnswer(q, data, prefs) }]);
      }
      setPending(null);
    } else {
      setPending({ text: offlineAnswer(q, data, prefs), typed: true });
    }
  }

  const paragraphs = narrative.split(/\n{2,}/);

  return (
    <>
      <section className="wr-narrative wr-wrap" aria-labelledby="note-title">
        <div className="wr-narrative-side">
          <Emblem size={72} color="var(--wr-yellow-deep)" />
          <span className="wr-eyebrow">A note from Wurzelraum</span>
          <h2 id="note-title" className="wr-h2" style={{ fontSize: 40 }}>What would actually change</h2>
          <span className="wr-source">
            {mode === "agent" ? "Written live by the AI agent from the ranking data." : mode === "offline" ? "Composed from the ranking data. Connect an LLM key for a live AI write-up." : "Writing…"}
          </span>
        </div>
        <div className="wr-narrative-text" aria-live="polite">
          {mode === "checking" && <p><span className="wr-caret" aria-hidden /></p>}
          {mode === "agent" &&
            paragraphs.map((p, i) => (
              <p key={i}>
                {p}
                {!narrativeDone && i === paragraphs.length - 1 && <span className="wr-caret" aria-hidden />}
              </p>
            ))}
          {mode === "offline" && <TypedParagraphs text={fallback} onDone={() => setNarrativeDone(true)} />}
        </div>
      </section>

      <section className="wr-dark" aria-labelledby="chat-title">
        <div className="wr-chat wr-wrap">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 id="chat-title">Still wondering?</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--wr-soft)" }}>Ask anything — a worry, a “but what about…”.</p>
          </div>
          <div className="wr-thread">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="wr-msg-user">{t.text}</div>
              ) : (
                <div key={i} className="wr-msg-bot"><span className="wr-eyebrow">Wurzelraum</span><p>{t.text}</p></div>
              )
            )}
            {pending && (
              <div className="wr-msg-bot" aria-live="polite">
                <span className="wr-eyebrow">Wurzelraum</span>
                <p>
                  {pending.typed ? (
                    <Typed
                      text={pending.text}
                      onDone={() => {
                        setTurns((t) => [...t, { role: "assistant", text: pending.text }]);
                        setPending(null);
                      }}
                    />
                  ) : (
                    <>
                      {pending.text}
                      <span className="wr-caret" aria-hidden />
                    </>
                  )}
                </p>
              </div>
            )}
            {turns.length === 0 && (
              <div className="wr-suggestions">
                {["But we don’t have a car — does that change anything?", "How do the rents compare?", "Which is quietest at night?", "What about Kitas?"].map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} disabled={!narrativeDone}>{s}</button>
                ))}
              </div>
            )}
            <form
              className="wr-ask"
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
            >
              <label htmlFor="wr-follow" className="wr-sr">Ask a follow-up</label>
              <input id="wr-follow" type="text" autoComplete="off" placeholder="Ask a follow-up, like ‘but I don’t have a car’" value={input} onChange={(e) => setInput(e.target.value)} />
              <button type="submit" className="wr-btn wr-btn-yellow" style={{ minHeight: 44, padding: "0 22px" }} disabled={busy || !input.trim()}>Ask</button>
            </form>
            {mode === "offline" && (
              <span className="wr-source" style={{ color: "var(--wr-soft)" }}>
                Answers come straight from the Kiez data. Add an LLM key to <code>.env.local</code> for open-ended answers.
              </span>
            )}
          </div>
        </div>
        <footer className="wr-footer wr-wrap">
          <span className="wr-display" style={{ fontSize: 28, letterSpacing: 0, color: "var(--wr-yellow)" }}>Wurzelraum</span>
          <span>BERLIN PLANUNGSRAUM DATA · PHOTOS VIA UNSPLASH · © 2026</span>
        </footer>
      </section>
    </>
  );
}

/** Types out a multi-paragraph text one paragraph after another. */
function TypedParagraphs({ text, onDone }: { text: string; onDone: () => void }) {
  const paras = text.split(/\n{2,}/);
  const [upTo, setUpTo] = useState(0);
  return (
    <>
      {paras.slice(0, upTo + 1).map((p, i) =>
        i < upTo ? (
          <p key={i}>{p}</p>
        ) : (
          <p key={i}>
            <Typed
              text={p}
              cps={140}
              onDone={() => {
                if (i < paras.length - 1) setUpTo(i + 1);
                else onDone();
              }}
            />
          </p>
        )
      )}
    </>
  );
}
