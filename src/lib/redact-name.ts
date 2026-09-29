/**
 * Deterministic name redaction — no LLM call, so it can't be talked out of
 * doing its job and works even when the LLM provider isn't configured.
 * Redacts the applicant's own declared full name (and its parts) wherever
 * it appears in free text, e.g. a narrative that opens "Hi, I'm Ahmed
 * and..." becomes "Hi, I'm [name] and...".
 *
 * Scope, stated honestly: this catches the applicant's OWN declared name,
 * not every proper noun (a mentioned third party, a nickname that differs
 * from the legal name, a name in a language script regex word-boundaries
 * don't handle well). It's a real, working mitigation for the common case
 * — a full NER pass would be a reasonable upgrade, not a prerequisite for
 * shipping this one.
 */
export function redactNameFromText(text: string, fullName: string): string {
  const parts = fullName.split(/\s+/).filter((p) => p.length >= 2);
  if (parts.length === 0) return text;

  // Longest candidates first, so "Anna Müller" redacts before a
  // subsequent pass would otherwise leave "Müller" as a lone leftover
  // once "Anna" was already replaced.
  const candidates = [fullName, ...parts].sort((a, b) => b.length - a.length);

  let redacted = text;
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "giu");
    redacted = redacted.replace(re, "[name]");
  }
  return redacted;
}
