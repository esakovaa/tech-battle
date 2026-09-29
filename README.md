# Kiez Concierge — Battle of the Tech Schools 2026

Data and analysis prep for the "Kiez Concierge" challenge (WBS CODING SCHOOL / 42 Berlin / Battle of the Tech Schools, 28–30 Sep 2026).

## Running the Wurzelraum prototype locally

The app at `/` is the full Wurzelraum flow (design Option B, see `design/wurzelraum/`): intake → ranking →
results with example flats, a per-Kiez map, the side-by-side table, a written trade-off summary and a follow-up chat.

```bash
npm install
npm run dev          # then open http://localhost:3000
```

- **Works without any keys.** Ranking, listings, the map, geocoding (Nominatim) and live commute times (VBB) all
  run on the repo's data and free public APIs. The address field also suggests Kieze from local data, so you can
  pick one even if geocoding is unavailable.
- **AI write-up and open-ended chat** switch on automatically once an LLM key is set: copy `.env.example` to
  `.env.local` and fill in `LLM_PROVIDER`, the matching API key and model id (optionally `TAVILY_API_KEY` for web
  search). Without a key, the write-up is composed from the ranking data and the chat answers data questions
  (transport without a car, rent, noise, parks, safety, Kitas, schools, hobbies).
- **Mock AI mode (no key needed):** put `AGENT_MOCK=1` in `.env.local` (or run `AGENT_MOCK=1 npm run dev`). The
  write-up and chat then stream pre-written replies filled in from the real ranking (`src/lib/agent-mock.ts`), in
  the same stream format as a real model, and the page labels them as mock. Good for demos and UI testing; it
  matches follow-ups by keyword and doesn't reason. Remove it to use the real model.
- Photos come from `photos/` (Unsplash), resized into `public/photos/`. Kiez and flat photos are illustrative —
  there are no per-Kiez photos in the data — and are labelled as such in the UI.

## Data sources

All raw data lives under `DATA  SOURCES/`. Government WFS geodata is **not committed as `.geojson`** — those files are large, regenerable on demand, and excluded via `.gitignore`. Each entry below gives the exact command to fetch it yourself; the flattened `.csv` version (small, git-friendly) is committed alongside it.

| Folder | Source | Format |
|---|---|---|
| `Berlin Real Estate Sales Rentals 2020-2026/` | Kaggle: [Berlin Real Estate: Sales, New Construction & Rentals 2020–2026](https://www.kaggle.com/datasets/sergionefedov/berlin-real-estate-sales-and-rentals-2020-2026) | CSV (synthetic, hybrid real-anchored dataset — see its Kaggle card for the hedonic pricing model methodology) |
| `Real Estate Listings Berlin (DE) April 2023/` | Kaggle: [Real Estate Listings Berlin (DE), April 2023](https://www.kaggle.com/datasets/mathisjander/real-estate-listings-berlin-de-april-2023) | CSV (real, scraped listings — used as external validation against the synthetic dataset above) |
| `all 400k houses in Berlin/` | daten.berlin.de: [Wohnlagen nach Adressen zum Berliner Mietspiegel 2026 — WFS](https://daten.berlin.de/datensaetze/wohnlagen-nach-adressen-zum-berliner-mietspiegel-2026-wfs-809faebe) | Real government data, address-level Wohnlage (einfach/mittel/gut), 400,505 rows |
| `Kita Standorte (WFS)/` | daten.berlin.de: [Kindertagesstätten — WFS](https://daten.berlin.de/datensaetze/kindertagesstatten-wfs-d03b94d2) | Real, 2,905 Kitas citywide, incl. capacity (`e_platz`) and Träger |
| `kitaliste-nov-2025.xlsx` | daten.berlin.de: [Kitas in Berlin](https://daten.berlin.de/datensaetze/kitas-in-berlin) | Real, official directory (XLSX), alternative/cross-check to the WFS above |
| `schulbaumassnahmen-2026.xlsx` | daten.berlin.de: [Schulbaumaßnahmen](https://daten.berlin.de/datensaetze/schulbaumassnahmen) | Real, all Berlin school locations 2013/14–2029/30, tagged existing/planned/under construction |
| `Berlin_crimes.csv` | Kaggle: [Crime in Berlin 2012–2019](https://www.kaggle.com/datasets/danilzyryanov/crime-in-berlin-2012-2019) | Real, official Kriminalitätsatlas-style data — 8 years × 12 Bezirke × 150 Prognosträume, 20 crime-type columns. **Dated**: ends 2019, 7 years old — use for relative area comparison, not as a current safety claim |
| `berlin_air_quality_feb_2026_kaggle.csv` | Kaggle: [Berlin Air Quality Hourly Measurements](https://www.kaggle.com/datasets/edinnn0/berlin-air-quality-hourly-measurements) | Real, hourly readings from 15 official Berlin monitoring stations, 5 pollutants (CO/NO2/O3/PM10/PM2.5). Only covers 1–19 Feb 2026 (partial month, not a full year) |

Both new sources, like everything else here, are **Berlin-only** — no Brandenburg coverage, consistent with every other government/Kaggle source checked so far.

### Re-fetching the WFS sources

```bash
# Wohnlage (400k addresses)
curl -o wohnlagen_2026.geojson "https://gdi.berlin.de/services/wfs/wohnlagenadr2026?service=WFS&version=2.0.0&request=GetFeature&typeNames=wohnlagenadr2026:wohnlagenadr2026&outputFormat=json&srsName=EPSG:4326"

# Kitas (2,905 locations)
curl -o kitas_wfs.geojson "https://gdi.berlin.de/services/wfs/kita?service=WFS&version=2.0.0&request=GetFeature&typeNames=kita:kita&outputFormat=json&srsName=EPSG:4326"
```

Both are licensed **Datenlizenz Deutschland – Zero – Version 2.0** (public domain equivalent).

## Kiez Profile Master Table

`Kiez Profile Master Table/kiez_profile_by_plz.csv` — the derived, agent-facing table: one row per Berlin postal code (193 total), joining every source above (centroid, Wohnlage, Kitas, schools, crime, air quality, rents, buy prices, transit). **Read `Kiez Profile Master Table/README.md` before querying it** — several columns are spatial approximations or Bezirk-level inherited values, not true PLZ-precise data, and that file documents exactly which are which. Rebuild with `python3 "Kiez Profile Master Table/build_kiez_profile.py"`.

`Kiez Profile Master Table/planungsraum_profile.csv` — a second, finer table (542 rows, one per Planungsraum — Berlin's own official planning geography, not PLZ) built via real point-in-polygon spatial joins, with `planungsraum_boundaries.geojson` holding the actual polygons. Doesn't replace the PLZ table as the agent-facing unit; several sources (Wohnlage, Kitas, Umweltgerechtigkeit, synthetic listings) are genuinely more precise here. See that folder's README for exactly what improved and what didn't.

## Other files

Analysis outputs live under `EDA on real estate listings/`:

- `EDA_protocol.md` — the EDA/data-cleaning protocol used to validate the datasets above before building on them
- `business_eda_report.html` — full business-focused EDA + data-reliability findings on the Kaggle datasets, cross-validated against the real Wohnlage/listings data
- `dry_run_report.html` — protocol dry-run on the King County housing dataset (methodology validation only, not Berlin findings)
- `charts/` — all generated chart images referenced by the two reports above
- `business_eda.py` — script that generates the business EDA charts (paths are relative to this subfolder, i.e. `../DATA  SOURCES/...`)
