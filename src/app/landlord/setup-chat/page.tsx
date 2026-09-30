"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgentNotConfigured, type ChatTurn } from "@/components/wr/shared";

type SpeechResultEvent = { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
type SpeechErrorEvent = { error: string };
type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

async function ask(history: ChatTurn[], onText: (s: string) => void): Promise<string> {
  const messages = history.map((m, i) => ({ id: `setup-${i}`, role: m.role, parts: [{ type: "text", text: m.text }] }));
  const response = await fetch("/api/landlord/setup-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
  if (response.status === 501) throw new AgentNotConfigured();
  if (!response.ok || !response.body) throw new Error(`Assistant request failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as { type?: string; delta?: string; errorText?: string };
        if (event.type === "text-delta" && event.delta) { full += event.delta; onText(full); }
        if (event.type === "error") throw new Error(event.errorText ?? "Assistant error");
      } catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    }
  }
  return full;
}

export default function LandlordSetupChatPage() {
  const router = useRouter();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  async function submit(text = draft) {
    if (!text.trim() || busy) return;
    const next = [...turns, { role: "user" as const, text: text.trim() }];
    setTurns(next); setDraft(""); setPending(""); setError(""); setBusy(true); setConfirmed(false);
    try {
      const reply = await ask(next, setPending);
      setTurns([...next, { role: "assistant", text: reply }]);
      setConfirmed(/listing-config-json/.test(reply));
    } catch (err) {
      setError(err instanceof AgentNotConfigured ? "The setup assistant needs an LLM provider and API key configured." : err instanceof Error ? err.message : "Request failed.");
    } finally { setBusy(false); setPending(""); }
  }

  function useSetup() {
    const final = [...turns].reverse().find((t) => t.role === "assistant")?.text ?? "";
    const block = final.match(/```listing-config-json\s*([\s\S]*?)```/);
    if (!block) return;
    try {
      const config = JSON.parse(block[1]) as Record<string, unknown>;
      sessionStorage.setItem("ll_setup_assistant", JSON.stringify(config));
      router.push("/landlord?setup=assistant");
    } catch { setError("The proposed setup could not be loaded. Please review it with the assistant again."); }
  }

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Speech recognition isn’t available in this browser. You can type your description instead.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).filter((result) => result.isFinal).map((result) => result[0].transcript.trim()).join(" ");
      if (transcript) setDraft((current) => `${current.trim()}${current.trim() ? " " : ""}${transcript}`);
    };
    recognition.onerror = (event) => {
      setListening(false);
      setError(event.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser settings, or type your description." : "We couldn’t hear that clearly. Please try again or type your description.");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      setError("Speech recognition couldn’t start. Please try again or type your description.");
    }
  }

  return <main className="ll-wrap ll-page">
    <span className="ll-eyebrow">Landlord · Setup assistant</span>
    <h1 className="ll-h1">Let’s set up your listing.</h1>
    <p className="ll-lede">Describe the property in your own words. We’ll help capture the listing details; you can set documents and other requirements on the next screen.</p>
    <section aria-live="polite" style={{ background: "var(--ll-paper)", border: "1px solid var(--ll-line)", borderRadius: 14, padding: 28, marginTop: 28 }}>
      {turns.length === 0 && <p>Tell me about the property—what kind of home it is, where it is, its size and rooms, rent, and when it will be available. You can describe it naturally; you don’t need to answer a checklist.</p>}
      {turns.map((turn, i) => <article key={i} style={{ margin: "18px 0", whiteSpace: "pre-wrap" }}><strong>{turn.role === "user" ? "You" : "Setup assistant"}</strong><p>{turn.text}</p></article>)}
      {pending && <article style={{ margin: "18px 0", whiteSpace: "pre-wrap" }}><strong>Setup assistant</strong><p>{pending}</p></article>}
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: "flex", gap: 12, marginTop: 24, alignItems: "stretch", flexWrap: "wrap" }}>
        <textarea className="ll-input" aria-label="Describe the property" placeholder="Describe the property…" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} disabled={busy} style={{ flex: "1 1 300px", resize: "vertical" }} />
        <button className={`ll-pill wide ${listening ? "selected" : ""}`} type="button" onClick={toggleDictation} disabled={busy} aria-pressed={listening}>{listening ? "Stop recording ■" : "Dictate 🎙"}</button>
        <button className="ll-btn-primary" type="submit" disabled={busy || !draft.trim()}>{busy ? "Thinking…" : "Send →"}</button>
      </form>
      <p className="ll-retention-note">Dictation uses your browser’s speech-recognition service. Review the transcript above before sending it to the assistant.</p>
      {listening && <p role="status" style={{ color: "var(--ll-muted)" }}>Listening… Your transcript will appear above so you can review it before sending.</p>}
      {error && <p role="alert" style={{ color: "#a83b1c" }}>{error}</p>}
      {confirmed && <button className="ll-btn-primary" type="button" onClick={useSetup} style={{ marginTop: 18 }}>Review setup and continue →</button>}
    </section>
    <p style={{ marginTop: 22 }}><a href="/landlord">← Back to manual setup</a></p>
  </main>;
}
