# Landlord flow — backend, data, and fairness logic

Built solo for the "Landlords Want In" twist (released Tue 29 Sep 16:00, due
Wed 15:00). The team's frontend (screens: flat setup, applications
dashboard, shortlist detail) already encoded the right philosophy —
REQUIRED / SHOWN-NOT-SCORED / NEVER-USED — before this backend existed.
This folder + the corresponding `src/lib/landlord-*.ts` and
`src/app/api/landlord/*`, `src/app/api/tenant/cover-letter` files make
those labels actually true.

## The core design decision

The brief lists "overall impression" as one of six things landlords weigh,
but also requires that the system never pick up protected characteristics
from applicant messages. Those two asks are in tension. Resolution:
**"overall impression" is never auto-scored.** The free-text narrative is
shown to the landlord in full, labeled "not used in scoring," and could
optionally get an AI-written clarity/completeness summary — but it never
contributes a point to any ranking.

The second design decision, less obvious but arguably more important: once
an applicant clears every requirement the landlord actually set, **the
shortlist doesn't re-rank them by a hidden desirability score.** It ranks
by *readiness* — fewest outstanding verification items (missing optional
docs, a self-employed income needing a tax assessment, a declared-vs-
document income mismatch) — which is content-neutral and reduces the
landlord's actual manual-triage burden, instead of re-introducing a
preference judgment exactly where bias would creep back in.

## The fairness boundary is a type, not a convention

`src/lib/landlord-types.ts` splits every applicant into three types that
are never merged:

- `ApplicantFacts` — the ONLY input `evaluateApplicant()`/`rankByReadiness()`
  accept. No name, no free text, no nationality/religion/disability field
  of any kind exists on this type.
- `ApplicantIdentity` — name/DOB/email, used only by `findDuplicates()` and
  a (not yet built) post-shortlist identity reveal.
- `ApplicantNarrative` — the free text, read only by a human landlord or an
  optional non-scoring AI summary.

`Landlord Applicant Data/test_landlord_eval.ts` includes a compile-time
proof of this: a `// @ts-expect-error` line attempts to pass a `narrative`
+ `fullName` field into `evaluateApplicant()` and asserts TypeScript
rejects it. If a future edit ever weakens `ApplicantFacts` enough for that
call to type-check, `npx tsc --noEmit` fails the whole project build —
this is a guard a future editor has to notice, not just a docstring.

Document extraction (`src/app/api/landlord/documents/extract`) applies the
same principle to file uploads: the `identity` document's extraction
schema returns only `looksLikeAValidIdentityDocument: boolean` — nothing
else. A naive "just OCR the ID" implementation would trivially hand the
pipeline a name, nationality, and photo; the schema is the enforcement,
not a prompt instruction that could be ignored or later weakened.

## Blind screening, not just blind scoring

Applicants are shown to landlords as `Applicant A`, `Applicant B`, ... —
never by real name — during the entire evaluation and shortlist phase (see
`anonymizedLabel()` in `landlord-eval.ts`). This is the "blind orchestra
audition" pattern applied to renting: identity would be revealed only once
a landlord commits to inviting someone to view the flat, not during
screening. (The reveal endpoint itself isn't built yet — see Not built.)

## What's unique about the evaluation, concretely

| Tier | What's in it | Behavior |
|---|---|---|
| REQUIRED (hard gate) | income ≥ landlord's multiple × cold rent, all required documents present, move-in date compatible, non-smoking if the landlord set that | Must ALL pass to appear in "meets requirements" |
| SHOWN, NOT SCORED | household composition, employment type detail, smoker flag (when not itself a hard filter) | Displayed on every applicant card; never gates or ranks |
| TO CHECK (drives readiness rank, not desirability) | missing optional docs, self-employed income needing verification, declared-vs-payslip income mismatch, closest-to-threshold flag | Fewer open items → surfaces earlier in "Recommended" |
| NEVER USED | protected characteristics, names, photos, nationality, writing style/language | Never reaches `ApplicantFacts`; enforced by the type boundary above |

## Data — `generate_synthetic_applicants.py`

Procedural, not per-applicant LLM calls (would be slow/expensive for
hundreds of rows and isn't needed — this is exactly where hand-written
phrase banks + randomization is the right tool). Produces
`src/data/landlord_applicants.json` (471 applicants across 2 demo
listings) and `src/data/landlord_listings.json`.

Deliberately realistic, per the brief ("making it realistic is part of the
job"):
- Messages range formal → casual → careless.
- ~15-18% of narratives naturally mention religion or national origin,
  ~7% disability — because the "never used" guarantee has to hold against
  real sentences that contain this content, not a strawman with nothing to
  filter.
- ~9% of applicants with a payslip have a declared income that doesn't
  match the payslip figure (the brief's "applicants don't always tell the
  truth") — surfaced as a `toCheck` item, not an automatic rejection
  (could be an honest error on either side).
- ~8% of applicants are the same person applying again, sometimes to a
  different listing (the brief's "same person often applies more than
  once, across listings or platforms").
- Every `_audit_*`-prefixed field is ground truth for
  `fairness_audit.ts` ONLY — `src/lib/landlord-data.ts` strips these before
  anything reaches the app.

Run: `python3 "Landlord Applicant Data/generate_synthetic_applicants.py"`

## Fairness audit — `fairness_audit.ts`

Runs the REAL `evaluateApplicant()` (not a reimplementation) against the
whole synthetic cohort, grouped by the ground-truth narrative tags, and
computes a two-proportion z-test per group vs. baseline. Latest run
(`fairness_audit_output.txt`): every |z| is well under the 1.96
significance threshold across both listings — no detectable correlation
between narrative-mentioned topics and pass rate or shortlist position,
which is exactly what the type boundary predicts, empirically confirmed
rather than just assumed.

Run: `npx tsx "Landlord Applicant Data/fairness_audit.ts"`

## Tests — `test_landlord_eval.ts`

No test framework in `package.json` yet, so this follows the project's
existing convention of small assert-based tsx scripts. Covers affordability
edge cases (exactly-at-threshold, just above/below), document
completeness, move-in date, the smoking gate's policy-dependence, the
income-mismatch-is-a-flag-not-a-fail behavior, readiness ranking order,
duplicate detection (including a same-name-different-person non-match),
`anonymizedLabel` sequencing, and the compile-time fairness-boundary proof.
18/18 pass.

Run: `npx tsx "Landlord Applicant Data/test_landlord_eval.ts"`

## API endpoints

- `GET /api/landlord/listings` — the demo listings.
- `POST /api/landlord/dashboard` — `{ listingId, overrides? }` → stats +
  four tabs (recommended/meetsRequirements/needsCheck/all), anonymized.
- `GET /api/landlord/applicants/:id` — one applicant's full breakdown
  (positive factors, to-check items, narrative separately labeled), still
  anonymized — recomputes the same dedup/ranking as the dashboard so the
  label and status stay consistent.
- `POST /api/landlord/documents/extract` — multipart upload + real
  document reading via a vision-capable model, narrow per-document-type
  extraction schema (see above). Needs `LLM_PROVIDER` + matching key/model
  configured; degrades to a clean 501 otherwise, same pattern as
  `/api/agent`.
- `POST /api/tenant/cover-letter` — AI-drafted cover letter from the
  tenant's structured facts + guided free-text answers. Instructed to
  never invent facts and never add protected-characteristic content that
  the applicant didn't themselves mention. Same 501-if-unconfigured
  pattern.

## GDPR posture (documented, not fully built)

The team's own screen 1 mockup already states "Application data is kept
only for this letting and deleted 30 days after the flat is let" — that's
the right policy, but no retention/deletion job exists yet; the synthetic
data has no real applicants to protect. Worth building before any real
applicant data touches this if there's time: a scheduled deletion job
keyed on `submittedAt` + listing-closed date, and a consent checkbox at
the tenant application step (frontend concern).

## Not built (deferred, time-boxed decision)

- Identity-reveal endpoint (post-shortlist, "Invite to viewing" action).
- Fuzzy duplicate matching (current version is exact name+DOB match —
  catches re-applications, not spelling variants or different emails for
  the same person under a slightly different name).
- Real document authenticity verification — extraction reads *stated*
  content, it doesn't verify a payslip isn't forged.
- GDPR deletion job (see above).
