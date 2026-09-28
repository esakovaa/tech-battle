# Kiez Concierge — Battle of the Tech Schools 2026

Data and analysis prep for the "Kiez Concierge" challenge (WBS CODING SCHOOL / 42 Berlin / Battle of the Tech Schools, 28–30 Sep 2026).

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

### Re-fetching the WFS sources

```bash
# Wohnlage (400k addresses)
curl -o wohnlagen_2026.geojson "https://gdi.berlin.de/services/wfs/wohnlagenadr2026?service=WFS&version=2.0.0&request=GetFeature&typeNames=wohnlagenadr2026:wohnlagenadr2026&outputFormat=json&srsName=EPSG:4326"

# Kitas (2,905 locations)
curl -o kitas_wfs.geojson "https://gdi.berlin.de/services/wfs/kita?service=WFS&version=2.0.0&request=GetFeature&typeNames=kita:kita&outputFormat=json&srsName=EPSG:4326"
```

Both are licensed **Datenlizenz Deutschland – Zero – Version 2.0** (public domain equivalent).

## Other files

- `EDA_protocol.md` — the EDA/data-cleaning protocol used to validate the datasets above before building on them
- `business_eda_report.html` — full business-focused EDA + data-reliability findings on the Kaggle datasets, cross-validated against the real Wohnlage/listings data
- `dry_run_report.html` — protocol dry-run on the King County housing dataset (methodology validation only, not Berlin findings)
- `charts/` — all generated chart images referenced by the two reports above
- `business_eda.py` — script that generates the business EDA charts
