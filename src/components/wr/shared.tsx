"use client";

import { useEffect, useState } from "react";

/** The Option B mark: a bowl-shaped pot, a child reaching up as the middle
 *  stem, two sprouts curling out and roots below. */
export function Emblem({ size = 52, color = "var(--wr-yellow)", label }: { size?: number; color?: string; label?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <g fill="none" stroke={color} strokeWidth={3.4} strokeLinecap="round">
        <path d="M32 34V16" />
        <path d="M32 23l-7-8M32 23l7-8" />
        <path d="M22 34c0-8-3-12-9-14" />
        <path d="M42 34c0-8 3-12 9-14" />
        <path d="M32 56v6M26 55l-3 6M38 55l3 6" />
      </g>
      <circle cx={32} cy={9.5} r={4.2} fill={color} />
      <path d="M8 34h48a24 21 0 0 1-48 0z" fill={color} />
    </svg>
  );
}

/** Reveals `text` progressively, like a message being written. Restarts
 *  whenever `text` changes; calls onDone once fully shown. */
export function Typed({ text, cps = 90, onDone }: { text: string; cps?: number; onDone?: () => void }) {
  const [state, setState] = useState({ text: "", shown: 0 });
  const shown = state.text === text ? state.shown : 0;

  useEffect(() => {
    const step = Math.max(1, Math.round(cps / 30));
    const id = setInterval(() => {
      setState((s) => {
        const cur = s.text === text ? s.shown : 0;
        const next = Math.min(text.length, cur + step);
        if (next >= text.length) clearInterval(id);
        return { text, shown: next };
      });
    }, 33);
    return () => clearInterval(id);
  }, [text, cps]);

  const done = shown >= text.length;
  useEffect(() => {
    if (done && text) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per completed text
  }, [done, text]);

  return (
    <>
      {text.slice(0, shown)}
      {!done && <span className="wr-caret" aria-hidden />}
    </>
  );
}

// ---------------------------------------------------------------
// /api/agent client. The route returns the ai SDK's UI message stream
// (server-sent events); we only need the assistant's text deltas.
// ---------------------------------------------------------------
export class AgentNotConfigured extends Error {}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export async function streamAgent(
  preferences: unknown,
  history: ChatTurn[],
  onText: (full: string) => void,
  signal?: AbortSignal,
  onMock?: () => void
): Promise<string> {
  const messages = history.map((m, i) => ({ id: `m${i}`, role: m.role, parts: [{ type: "text", text: m.text }] }));
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences, messages }),
    signal,
  });
  if (res.status === 501) throw new AgentNotConfigured();
  if (!res.ok || !res.body) throw new Error(`Agent request failed (${res.status})`);
  if (res.headers.get("x-wurzelraum-agent") === "mock") onMock?.();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as { type?: string; delta?: string; errorText?: string };
        if (evt.type === "text-delta" && evt.delta) {
          full += evt.delta;
          onText(full);
        } else if (evt.type === "error") {
          throw new Error(evt.errorText ?? "Agent error");
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
  return full;
}

export const AGENT_KICKOFF =
  "Please give me your top 3 Kiez recommendations compared to my current one, " +
  "with a narrative summary of the trade-offs.";
