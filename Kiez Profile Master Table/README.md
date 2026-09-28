# Kiez Profile Master Table

`kiez_profile_by_plz.csv` — one row per Berlin postal code (193 total), built by `build_kiez_profile.py` from every dataset in `DATA  SOURCES/`. This is the searchable unit for the agent — filter/rank on these columns directly.

**Not every column has the same grain or trustworthiness.** Read this before querying, especially before quoting a number to judges.

## Quick reference — factors by theme

- **Location:** `plz`, `lat`, `lon`, `bezirk`, `n_addresses`
- **Location quality (Wohnlage):** `pct_wohnlage_einfach`, `pct_wohnlage_mittel`, `pct_wohnlage_gut`, `dominant_wohnlage`
- **Kitas:** `n_kitas`, `total_kita_capacity`
- **Schools — existing, quality rating:** `abitur_tier_bezirk`, `abitur_mn_scls_bezirk_avg`, `abitur_performance_vs_peer_bezirk_avg`, `n_abitur_schools_in_bezirk` (Oberstufe schools only — no Grundschule quality signal exists)
- **Schools — being built/expanded:** `n_school_construction_projects`, `n_unique_schools_with_projects`, `total_planned_school_capacity` (covers all school types, including Grundschulen — this is capacity, not quality)
- **Safety:** `crime_total_avg_2017_2019`
- **Air quality:** `nearest_air_station`, `air_station_distance_km`, `air_co_avg`, `air_no2_avg`, `air_o3_avg`, `air_pm10_avg`, `air_pm25_avg`
- **Rent:** `rent_per_m2_kalt_avg_synthetic`, `n_rental_listings_synthetic`
- **Buy price:** `buy_price_per_m2_avg_REAL`, `n_real_listings`, `buy_price_per_m2_avg_synthetic`, `n_synthetic_sales_listings`
- **New housing supply:** `new_construction_price_per_m2_avg`, `n_new_construction_listings`
- **Commute:** `nearest_transit_station`, `nearest_transit_line`, `transit_distance_km`

## Column-by-column data quality

| Columns | Grain | Trust level |
|---|---|---|
| `lat`, `lon`, `n_addresses`, `pct_wohnlage_*`, `dominant_wohnlage`, `bezirk` | **Exact PLZ**, real government data (400k address WFS) | High — this is the anchor table everything else joins against |
| `n_kitas`, `total_kita_capacity` | **Exact PLZ**, real (Kita WFS) | High |
| `n_school_construction_projects`, `n_unique_schools_with_projects`, `total_planned_school_capacity` | **Exact PLZ**, real, but scoped to schools with a construction/expansion project on record — **not a full census of every school** | High for what it measures, incomplete in coverage |
| `buy_price_per_m2_avg_REAL`, `n_real_listings` | **Exact PLZ**, real listings (April 2023 snapshot) | High, but a single point in time, 3+ years old |
| `crime_total_avg_2017_2019` | **Bezirk-level only**, inherited — every PLZ in the same Bezirk shows the identical number | Directional only. Not PLZ-precise, and the source data is dated (ends 2019) |
| `nearest_air_station`, `air_*_avg`, `air_station_distance_km` | Real station readings, but **projected via nearest-station spatial join** — a PLZ far from all 15 stations gets its "nearest" value regardless of distance (check `air_station_distance_km` before trusting) | Medium — real numbers, approximate assignment. `air_co_avg`/`air_o3_avg` are missing for ~45–73% of rows because most stations don't measure those pollutants at all (real limitation of the monitoring network, not a bug) |
| `rent_per_m2_kalt_avg_synthetic`, `buy_price_per_m2_avg_synthetic`, `new_construction_price_per_m2_avg`, plus their `n_*_listings` counts | **Synthetic** (Kaggle hedonic-model dataset), assigned to PLZ via nearest-centroid spatial join (no real PLZ field in the source) | Low for absolute €, useful for relative structure (which areas rank where) — see the main business EDA report for why the synthetic price level runs ~25–40% below real listings |
| `nearest_transit_station`, `nearest_transit_line`, `transit_distance_km` | From the synthetic dataset's 135-station list (Berlin only), nearest-station join | Medium — real station names/lines, but not the full VBB network |
| `abitur_mn_scls_bezirk_avg`, `abitur_performance_vs_peer_bezirk_avg`, `n_abitur_schools_in_bezirk`, `abitur_tier_bezirk` | **Bezirk-level only**, inherited (same reason as crime — see `abitur_by_school.csv` for the school-level detail this is built from) | Real, official 2025 results. **Lower `mn.scls` = better** (German grading, 1.0 is best) |

## Abitur / school-quality signal

Two different tiering methodologies are provided in `abitur_by_school.csv` (185 schools, real 2025 Abitur results) — **use `tier_vs_peer`, not `tier_raw_grade`, unless you have a specific reason not to:**

- **`tier_raw_grade`** — quartile tiers on the raw average grade (`mn.scls`), pooling all school types together. This is literally "AMAZING = lowest average grade," which sounds right but **conflates school quality with student population** — Gymnasien structurally post better averages than ISS/vocational schools regardless of teaching quality, because of which students attend each track.
- **`tier_vs_peer`** — quartile tiers on `performance_vs_peer` (= the school's own type's state-wide benchmark `mn.vgl`, minus the school's `mn.scls`). This asks "does this school beat its own peer group," which is the fairer comparison.
- **These two disagree on 91 of 185 schools (49%)** — not a rounding difference, a real methodological fork. Checked and confirmed, not a guess.

Coverage limits, both real:
- Only 63 of 185 Abitur schools (34%) have a real PLZ, via a crosswalk to `schulbaumassnahmen-2026.xlsx` — Berlin doesn't appear to publish an open, downloadable directory of every school's address (checked; nothing found under "Schulverzeichnis"/"Schulliste"). The other 122 schools are Bezirk-located only.
- The Abitur dataset itself suppresses any school with fewer than 16 candidates — those schools simply don't appear anywhere in this data, at any tier.
- Abitur only exists at schools with an Oberstufe (Gymnasien, ISS, vocational, private, Kollegs) — **this signal says nothing about Grundschulen**, which is what most families with young kids actually care about first.

## Known gap: population by age

Not included. Real data exists in principle (Amt für Statistik Berlin-Brandenburg publishes population-by-age at Ortsteil/Planungsraum level), but the link daten.berlin.de points to is dead — their `/opendata` path 404s, the site was restructured. Needs either finding the current URL on their site directly, or an archive.org snapshot of the old CSV. Flagging rather than faking it.

## Reproducing

```bash
python3 build_kiez_profile.py
```

Requires `pandas`, `numpy`, `scipy`. Makes one live call per air-quality station to Nominatim for geocoding (15 calls, rate-limited to 1/sec per their usage policy) — everything else runs on local files in `DATA  SOURCES/`.
