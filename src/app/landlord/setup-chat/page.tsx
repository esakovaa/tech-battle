"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AgentNotConfigured, type ChatTurn } from "@/components/wr/shared";

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

  async function submit(text = draft) {
    if (!text.trim() || busy) return;
    const next = [...turns, { role: "user" as const, text: text.trim() }];
    setTurns(next); setDraft(""); setPending(""); setError(""); setBusy(true); setConfirmed(false);
    try {
      const reply = await ask(next, setPending);
      setTurns([...next, { role: "assistant", text: reply }]);
      setConfirmed(/confirm|looks good|correct/i.test(text) && /listing-config-json/.test(reply));
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

  return <main className="ll-wrap ll-page">
    <span className="ll-eyebrow">Landlord · Setup assistant</span>
    <h1 className="ll-h1">Let’s set up your listing.</h1>
    <p className="ll-lede">Describe the flat and your practical requirements. The assistant checks the details and asks you to confirm before they’re applied.</p>
    <section aria-live="polite" style={{ background: "var(--ll-paper)", border: "1px solid var(--ll-line)", borderRadius: 14, padding: 28, marginTop: 28 }}>
      {turns.length === 0 && <p>To begin, tell me the address, cold and warm rent, number of rooms, and when the flat is available.</p>}
      {turns.map((turn, i) => <article key={i} style={{ margin: "18px 0", whiteSpace: "pre-wrap" }}><strong>{turn.role === "user" ? "You" : "Setup assistant"}</strong><p>{turn.text}</p></article>)}
      {pending && <article style={{ margin: "18px 0", whiteSpace: "pre-wrap" }}><strong>Setup assistant</strong><p>{pending}</p></article>}
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <textarea className="ll-input" aria-label="Message the setup assistant" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} disabled={busy} style={{ flex: 1, resize: "vertical" }} />
        <button className="ll-btn-primary" type="submit" disabled={busy || !draft.trim()}>{busy ? "Thinking…" : "Send →"}</button>
      </form>
      {error && <p role="alert" style={{ color: "#a83b1c" }}>{error}</p>}
      {confirmed && <button className="ll-btn-primary" type="button" onClick={useSetup} style={{ marginTop: 18 }}>Use this confirmed setup →</button>}
    </section>
    <p style={{ marginTop: 22 }}><a href="/landlord">← Back to manual setup</a></p>
  </main>;
}
