"use client";

import { useEffect, useState } from "react";
import Intake, { EMPTY_ANSWERS, type Answers } from "./Intake";
import Results from "./Results";
import type { RankApiResponse } from "@/lib/wurzelraum";
import type { UserPreferences } from "@/lib/types";

type Stage = { name: "intake" } | { name: "loading" } | { name: "results"; data: RankApiResponse; prefs: UserPreferences };

function toPreferences(a: Answers): UserPreferences {
  const commutes = a.nomad ? [] : [a.commute1, a.commute2].map((s) => s.trim()).filter((s) => s.length > 3);
  return {
    ...(a.plr ? { currentPlrId: a.plr.plr_id } : { currentAddress: a.address.trim() }),
    kids: a.noKids ? EMPTY_ANSWERS.kids : a.kids,
    rentBudget: a.rentBudget ?? "flexible",
    noiseAirSensitive: a.noiseAirSensitive === true,
    parksImportant: a.parksImportant === true,
    hobbies: a.hobbies,
    roomsNeeded: a.rooms,
    commuteAddresses: commutes.length ? commutes : undefined,
    maxCommuteMinutes: commutes.length && a.maxCommute != null ? a.maxCommute : undefined,
    additionalContext: additionalContext(a),
  };
}

/** Both free-text answers go to the agent layer as additionalContext —
 *  never into ranking (see UserPreferences.additionalContext). */
function additionalContext(a: Answers): string | undefined {
  const parts = [
    a.otherHobby && a.otherHobbyText.trim() ? `Other hobby: ${a.otherHobbyText.trim()}` : "",
    a.anythingElse.trim(),
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

const STEPS = ["Finding your Kiez on the map", "Reading all 542 Berlin Planungsräume", "Weighing what you told us matters", "Checking commutes and picking three"];
const MIN_LOADING_MS = 2200;

export default function WurzelraumApp() {
  const [answers, setAnswersState] = useState<Answers>(EMPTY_ANSWERS);
  const [stage, setStage] = useState<Stage>({ name: "intake" });
  const [addressError, setAddressError] = useState<string | null>(null);

  const setAnswers = (fn: (a: Answers) => Answers) => {
    setAddressError(null);
    setAnswersState(fn);
  };

  async function submit() {
    setAddressError(null);
    setStage({ name: "loading" });
    const prefs = toPreferences(answers);
    const started = Date.now();
    try {
      const res = await fetch("/api/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const body = await res.json();
      await new Promise((r) => setTimeout(r, Math.max(0, MIN_LOADING_MS - (Date.now() - started))));
      if (!res.ok) {
        setAddressError(
          res.status === 404
            ? "We couldn’t place that address in Berlin. Try street, number and postcode — or type your Kiez and pick a suggestion."
            : body.error ?? "Something went wrong — please try again."
        );
        setStage({ name: "intake" });
        requestAnimationFrame(() => document.getElementById("questions")?.scrollIntoView({ behavior: "smooth" }));
        return;
      }
      setStage({ name: "results", data: body as RankApiResponse, prefs });
      window.scrollTo({ top: 0 });
    } catch {
      setAddressError("We couldn’t reach the server — is `npm run dev` still running?");
      setStage({ name: "intake" });
    }
  }

  if (stage.name === "results") {
    return (
      <Results
        data={stage.data}
        prefs={stage.prefs}
        onEdit={() => {
          setStage({ name: "intake" });
          requestAnimationFrame(() => document.getElementById("questions")?.scrollIntoView());
        }}
        onRestart={() => {
          setAnswersState(EMPTY_ANSWERS);
          setStage({ name: "intake" });
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }

  return (
    <>
      <Intake answers={answers} setAnswers={setAnswers} onSubmit={submit} addressError={addressError} />
      {stage.name === "loading" && <Loading />}
    </>
  );
}

function Loading() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 650);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="wr-loading" role="status" aria-live="polite">
      <div className="wr-loading-copy">
        <span className="wr-eyebrow" style={{ color: "var(--wr-soft)" }}>One moment</span>
        <h2>Looking for where your family fits</h2>
        <ul className="wr-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={`${i <= step ? "is-on" : ""} ${i < step ? "is-done" : ""}`}>{s}</li>
          ))}
        </ul>
      </div>
      <div className="wr-loading-photo">
        <img className="wr-cover" src="/photos/kids-bubbles.jpg" alt="" />
      </div>
    </div>
  );
}
