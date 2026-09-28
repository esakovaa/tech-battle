# Kiez Profile Master Table

`kiez_profile_by_plz.csv` — one row per Berlin postal code (193 total), built by `build_kiez_profile.py` from every dataset in `DATA  SOURCES/`. This is the searchable unit for the agent — filter/rank on these columns directly.

**Not every column has the same grain or trustworthiness.** Read this before querying, especially before quoting a number to judges.

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

## Known gap: population by age

Not included. Real data exists in principle (Amt für Statistik Berlin-Brandenburg publishes population-by-age at Ortsteil/Planungsraum level), but the link daten.berlin.de points to is dead — their `/opendata` path 404s, the site was restructured. Needs either finding the current URL on their site directly, or an archive.org snapshot of the old CSV. Flagging rather than faking it.

## Reproducing

```bash
python3 build_kiez_profile.py
```

Requires `pandas`, `numpy`, `scipy`. Makes one live call per air-quality station to Nominatim for geocoding (15 calls, rate-limited to 1/sec per their usage policy) — everything else runs on local files in `DATA  SOURCES/`.
