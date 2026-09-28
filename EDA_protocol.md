# EDA & Data Cleaning Protocol — Battle of the Tech Schools 2026

**Role:** You are the data analyst on a 5-person team (with Santiago as data scientist) in a 3-day AI hackathon on real Berlin data. Your job in the first hours is to turn whatever dataset(s) land at 10:00 CET Monday into one locked, defensible metric the team can build a feature around — fast, and legible to a business-facing judge panel (DocMorris, Delivery Hero, Get The Flat).

**Non-negotiable constraint:** this is time-boxed. Every phase below has a clock. When the clock runs out, you move on with whatever you have — an imperfect answer by 12:00 beats a perfect one by 15:00.

**Source of method:** adapted from the neuefische EDA workflow (research-question/hypothesis table, iterative "rough draft → deepen" approach) plus standard EDA/data-cleaning checklists (bookdown.org, DIME World Bank).

**Validated 2026-09-25** — ran Phases 1–4 end-to-end on the King County housing dataset as a dry run. Findings: the code itself runs in seconds; the actual time cost is judgment calls, not computation — so budget the phase clocks below for *thinking*, not typing. Three real gotchas the protocol below now accounts for: (1) redundant/decoy ID columns showed up and needed investigating, not just deduplicating; (2) duplicate keys turned out to be legitimate repeat events, not errors — check your grain before dropping; (3) a physically impossible outlier (33 "bedrooms" in a 1,620 sqft house) didn't show up in a single-column quantile check, only by cross-referencing two fields.

---

## Phase 0 — Pre-Monday setup (do this now, not Monday)

- [ ] `.venv` ready with: `pandas`, `numpy`, `matplotlib`, `seaborn`, `plotly`, `geopandas` (in case of shapefiles/WFS), `scikit-learn`, `openpyxl`
- [ ] Notebook template pre-built with the section headers from Phase 2 below, so you're not writing boilerplate live
- [ ] Bookmarked / test-accessed: [daten.berlin.de Mietspiegel datasets](https://daten.berlin.de/datensaetze?tags=Mietspiegel), [Mietspiegel 2026 PDF](https://mietspiegel.berlin.de/wp-content/uploads/2026/05/mietspiegel2026.pdf), Amt für Statistik Berlin-Brandenburg — so account creation/API-key friction doesn't eat Monday morning
- [ ] Agree with Santiago now: you own cleaning + EDA + metric proposal, he validates feasibility and owns modeling — see prior discussion, this doc assumes that split
- [ ] A scratch "data contract" template ready (bottom of this doc) to hand off to the SWE/web dev team once the metric is locked

---

## Phase 1 — Triage (10:00–10:20 CET, ~20 min, before touching cleaning)

The moment the brief and data drop, answer these — do not clean or plot yet:

1. **How many tables?** One flat file, or several needing joins?
2. **What's the grain of each table** — one row = one listing? One building? One district? One user/newcomer profile? One time period? *(Write this down explicitly — everything downstream depends on it.)*
3. **What's the likely subject** — flats/houses, users/people, or city-wide/geo aggregates? (branch logic in Phase 2 depends on this)
4. **Row/column count, dtypes at a glance** (`.shape`, `.info()`)
5. **Does it match a schema you'd expect** from the brief, or is something oddly missing/extra?
6. **Record**: source, extraction date, any version label on the dataset (e.g. "Mietspiegel 2026, valid 05/2026–05/2028") — you'll need this for the pitch's data-credibility slide.

Keep the **raw file untouched**. Load into a working copy; never overwrite source data — you may need to re-derive something at 14:00 on Wednesday.

---

## Phase 2 — Data Cleaning Protocol (10:20–10:50, ~30 min)

Run this checklist top to bottom on every table. It's the same sequence regardless of subject — the branch notes tell you what to watch for per data type.

### 2.1 Structural checks
- [ ] `df.duplicated().sum()` — check both full-row and key-column duplicates (e.g. duplicate listing IDs are common in scraped/aggregated housing data)
- [ ] **If you find redundant/near-identical ID columns** (e.g. two columns that are 100% identical, or one that matches nothing), don't just pick one and move on — figure out *why* it's there (join artifact? scrape leftover?), it usually signals something about how the data was assembled that matters later
- [ ] **Before dropping duplicate key values, check if they're real repeats or legitimate re-occurrences** (e.g. same property sold/listed twice at different dates/prices). Dropping these blindly deletes signal — revisit your Phase 1 grain decision: is a duplicate ID actually a duplicate *row*, or two valid rows sharing a key?
- [ ] Column name hygiene — strip whitespace, consistent casing/snake_case, no encoding artifacts (umlauts in German column names are a known failure point)
- [ ] `df.dtypes` vs what they *should* be — dates as datetime, categorical as category/string not object, numeric stored as string with units (`"75 m²"`, `"7,71 €"` — German decimal commas are a classic trap in Berlin data). Boolean-like fields (waterfront-style yes/no flags) often load as float with NaN mixed into the 0/1s — decide explicitly whether NaN means "no," "unknown," or needs its own category

### 2.2 Missing data
- [ ] `df.isnull().sum()` / `.mean()` per column — is missingness concentrated in specific columns or specific rows/districts?
- [ ] Decide per column: **drop** (if missingness is trivial and random), **impute** (mean/median for numeric, mode or "unknown" category for categorical, group-wise mean by district if geo-stratified), or **flag** (add a `_was_missing` boolean — sometimes "missing" itself is the signal, e.g. landlords who don't disclose a Wohnlage rating)
- [ ] Log how much data you dropped — you'll want this number for methodology transparency in the pitch

### 2.3 Outliers / extreme values
- [ ] Use IQR or quantile thresholds (`df[col].quantile(0.01)` / `0.99`) per numeric column, visualize with boxplot
- [ ] **Single-column quantiles miss cross-field impossibilities** — a count field can look fine in isolation (e.g. bedroom count within the 99th percentile) while still being absurd relative to another field (e.g. that many bedrooms in a tiny sqft area). Cross-check count/size fields against each other (a simple ratio) rather than trusting per-column quantiles alone
- [ ] Decide: genuine extreme (keep, it might be your insight — e.g. an extreme rent-gap district) vs. data error (drop) — don't auto-drop without looking, outliers in rent/price data are often the story

### 2.4 Branch by data type

**If flats/houses table:**
- Normalize price to a common unit: €/m² is almost always more useful than absolute rent
- Sanity-check size fields (`sqft`/`m²`, room counts) against physically plausible ranges
- Geo fields (lat/long, district, Wohnlage, zipcode) — verify they resolve to real Berlin locations, not nulls/placeholder coordinates

**If user/people table:**
- Check for PII before doing anything else — if there's any personal data, confirm what's safe to use/display in a public pitch demo (GDPR matters here, this is Berlin)
- Watch for class imbalance if there's any group/segment field (e.g. newcomer vs. resident) — it changes what's statistically defensible to claim

**If city-wide/geo-aggregate table:**
- Confirm the aggregation level matches your flats/users table (district-level joining to address-level data needs a join key — Kiez name spelling inconsistencies are a common silent-fail point)
- Check temporal alignment — is this year's snapshot or a time series? Matters for any "trend" claim

### 2.5 Multi-table joins (if applicable)
- [ ] Identify the join key explicitly before joining (district name? zipcode? address?) — spelling/format mismatches are the #1 silent data-loss bug
- [ ] After joining, re-run `.isnull().sum()` — a bad join manifests as a wall of new NaNs
- [ ] Check row count before/after join — did you lose rows you didn't mean to (inner join dropping unmatched) or duplicate rows (many-to-many join)?

### 2.6 Column renaming & PostgreSQL handoff readiness
Do this once, right after cleaning, before handing anything to the SWE/web dev team.

- [ ] Rename every column to **lower_snake_case**, ASCII-only (transliterate ü/ö/ä/ß → ue/oe/ae/ss in the column name; keep German in a separate display label if needed, not in the identifier itself)
- [ ] Check every renamed column against the SQL reserved-word list (`user`, `order`, `group`, `table`, `column`, `check`, `limit`, ...) — rename anything that collides
- [ ] Apply consistent suffixes: `_id` (keys), `_at`/`_date` (temporal), `is_`/`has_` (booleans), unit suffixes where ambiguous (`price_eur`, `size_m2`, `rent_per_m2`)
- [ ] **Use the same join-key column name across every table** (e.g. `district_id` everywhere, not `bezirk` in one table and `district` in another) — this is what makes your developer's joins fast instead of painful
- [ ] Pick and state the **canonical primary key per table explicitly** — if triage found redundant/decoy ID columns (see Phase 1), resolve that ambiguity yourself now, don't ship it downstream
- [ ] Confirm dtypes are handoff-clean: real booleans (not `0.0`/`1.0`/`NaN` floats), real datetimes, real numeric floats (not comma-decimal strings) — these map directly to Postgres `BOOLEAN`/`TIMESTAMP`/`NUMERIC` with no surprises
- [ ] Export as **UTF-8** explicitly, and say so when you hand the file over — German text breaks silently on encoding mismatches
- [ ] Don't over-normalize into many relational tables under time pressure — one wide, clean table per subject (flats/users/city-wide) is usually enough; only split further if the app has a concrete need (e.g. users favoriting listings)
- [ ] Write the raw→clean column crosswalk as you go (see `column_names.md` pattern) — this doc becomes your data dictionary handoff, not extra work

---

## Phase 3 — Structured EDA (10:50–11:40, ~50 min)

### 3.1 Research questions → hypotheses → indicators
Before plotting anything, fill this table (from your own EDA project template) — 3–5 rows minimum:

| Question | Hypothesis (if/then, measurable) | Indicator (column(s)) |
|---|---|---|
| e.g. Does location quality explain rent beyond size? | If Wohnlage is "good," rent/m² is higher even controlling for size band | `wohnlage`, `rent_per_m2`, `size_band` |
| ... | ... | ... |

This is the single highest-leverage step — it stops you from doing unfocused exploration and directly seeds Phase 4's metric choice.

### 3.2 Single-variable exploration
- [ ] Distributions of key numeric fields (histograms) — skew, multi-modality, obvious clusters
- [ ] Counts/proportions of key categorical fields (district, Wohnlage, building age band)

### 3.3 Paired/relationship exploration
- [ ] Correlation matrix on numeric fields relevant to your hypotheses
- [ ] `groupby()` + `.mean()`/`.median()` on your key categorical dimension (district, Wohnlage) against your target metric candidate — this is usually where the pitch-worthy chart comes from
- [ ] If geo data present: at minimum a `groupby('district')[metric].mean()` bar chart; a map plot if time allows (nice-to-have, not blocking)

### 3.4 Test each hypothesis
For each row in the 3.1 table: does the data support it, weakly support it, or contradict it? One sentence each. Kill hypotheses that don't hold — don't force a weak signal into the pitch.

### 3.5 Build the one-page visual report (do not skip — this is the deliverable)
This is what actually gets shown to Santiago, the design sprint, and eventually reused for the pitch — a notebook full of exploratory plots is not the deliverable, one clean page per surviving hypothesis is.

- [ ] One chart per **surviving** hypothesis only (3–5 charts, not an export of every plot you made along the way)
- [ ] Each chart gets: a plain-language title stating the finding (not the column name), the one-sentence insight underneath, and a Supported/Weak verdict tag
- [ ] Include one data-quality chart (missingness, or whatever anomaly Phase 2 caught) — it builds credibility that the numbers are trustworthy, judges notice its absence more than its presence
- [ ] Close with the locked metric restated in its own box — this page hands directly into Phase 4 and the design sprint
- [ ] Single hue per single-series chart, categorical colors only when comparing distinct entities, no dual-axis, direct/selective labels over a legend where it fits — keep it fast, not decorative
- [ ] Save it where the team can actually open it (a shared file/doc), not left inside your notebook

---

## Phase 4 — Metric lock (11:40–12:00, ~20 min) — before the design sprint

This is the step from our earlier discussion, made concrete: **pick the metric category from your strongest surviving hypothesis, before anyone proposes a feature.**

| If your strongest hypothesis is about... | Candidate metric | 
|---|---|
| Rent gap between existing vs. new contracts (lock-in) | € saved by moving within a defined "low-jump" zone vs. citywide average jump |
| Fair-rent deviation | € or % a given listing/area is above/below the Mietspiegel benchmark |
| Access/equity gap | % of city where [target group] can find a Wohnlage-verified fair-rent option |

Write the locked metric as one sentence with units, e.g. *"Average € the user saves per year by choosing district X over district Y at equivalent size/Wohnlage."* Hand this single sentence to the team before the design sprint starts — the sprint's only job is now "what's the smallest feature that visibly moves this number."

---

## Output / handoff templates

**Data contract for SWE/web dev** (fill and share immediately after Phase 4):
```
Dataset(s) used: ...
Grain: one row = ...
Primary key: column_name (confirmed unique, decoys removed)
Known limitations: ... (dropped rows, imputed fields, join caveats)
Locked metric: ...
Format handed off: CSV (UTF-8) / API / JSON — [decide with SWE]
```

**Data dictionary** (this is what your developer turns into the Postgres schema — one row per column, not prose):

| column_name | type (pandas → postgres) | unit | nullable | description |
|---|---|---|---|---|
| `listing_id` | int64 → BIGINT (PK) | — | no | unique listing identifier |
| `district_id` | string → TEXT | — | no | join key, consistent across all tables |
| `rent_per_m2` | float64 → NUMERIC | €/m² | no | normalized rent |
| `is_furnished` | bool → BOOLEAN | — | yes | true boolean, not 0/1 float |
| `listed_at` | datetime → TIMESTAMP | — | yes | real datetime, not string |

Fill this with your actual final columns — it's a few minutes of work once cleaning is done, and it's the single artifact that lets your developer create the table without asking you clarifying questions mid-build.

**Client-facing insight format** (for the Wednesday pitch, per your own EDA project's expected structure):
- Who is the user/client this solution serves
- What data you used (source, time span, coverage) — cite the open-data source explicitly, judges will value real-data credibility
- 3 main insights (data-backed, one sentence each)
- 3 recommendations / what the prototype does about them
- One honest limitation (what the data couldn't tell you — shows rigor, not weakness)

---

## Quick-reference: what NOT to do
- Don't build exhaustive EDA on every column — only columns tied to a hypothesis in 3.1
- Don't silently auto-drop outliers — look first, housing data outliers are often the insight
- Don't skip the metric-lock step and jump straight to "let's build X" — that's how teams end up demoing a feature with no data story behind it
- Don't let Phase 0–4 run past ~12:00 CET Monday — the rest of Day 1 is build time, not analysis time
