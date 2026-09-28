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
- **Noise, green space, heat, socioeconomic status (Planungsraum-level, real):** `ug_laerm`, `ug_gruenversorgung`, `ug_thermisch`, `ug_soziale_benachteiligung` (⚠️ higher = more advantaged, see below), `ug_mehrfachbelastung_umwelt`, `ug_gesamt_umweltgerechtigkeitskarte`

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
| `ug_planungsraum_nr`, `ug_planungsraum_name`, `ug_laerm`, `ug_luft`, `ug_gruenversorgung`, `ug_thermisch`, `ug_soziale_benachteiligung`, `ug_mehrfachbelastung_umwelt`, `ug_mehrfachbelastung_umwelt_sozial`, `ug_gesamt_umweltgerechtigkeitskarte` | **Planungsraum-level** (finer than Bezirk, matched at the PLZ's centroid point via live WMS query — not an area-weighted average across the whole PLZ) | Real, official 2023/24 Umweltatlas data — see "Umweltgerechtigkeit" section below, **especially the Status-Index direction warning** |

## Umweltgerechtigkeit (environmental justice) — real, Planungsraum-level

Source: [Umweltgerechtigkeit 2023/2024 (Umweltatlas)](https://daten.berlin.de/datensaetze/umweltgerechtigkeit-2023-2024-umweltatlas-wms-c4a4e505), Senatsverwaltung für Mobilität, Verkehr, Klimaschutz und Umwelt. Published as **WMS only** — no WFS/bulk download exists — so this was pulled with 193 live `GetFeatureInfo` point queries (one per PLZ centroid) against the underlying `PLR_2021_*` (Planungsraum) layers, not scraped or estimated.

Columns (all ordinal categories, not numbers):
- `ug_laerm` — noise burden: gering / mittel / hoch
- `ug_luft` — air pollution burden (Umweltatlas's own modeled layer, independent of the Kaggle station data elsewhere in this table): gering / mittel / hoch
- `ug_gruenversorgung` — green space supply: gut / mittel / schlecht
- `ug_thermisch` — heat/thermal stress: gering / mittel / hoch
- `ug_mehrfachbelastung_umwelt` — combined score across the 4 environmental indicators above: gering / mittel / hoch
- `ug_gesamt_umweltgerechtigkeitskarte` — **not a graded scale.** Only present where an area meets a specific severe-multi-burden threshold ("simple Wohnlage >66% AND high noise and/or air burden"); present = flagged hotspot, absent = not flagged (61 of 193 PLZ flagged) — do not treat a blank here as missing data

**Read this before using `ug_soziale_benachteiligung` or `ug_mehrfachbelastung_umwelt_sozial` — the direction is counter-intuitive:** despite the layer being named "Kernindikator Soziale Benachteiligung" (social disadvantage), the value returned is framed as a **Status-Index where HIGHER = MORE ADVANTAGED** (`hoher Status-Index` = high socioeconomic status = *less* disadvantaged; `niedriger/sehr niedriger Status-Index` = *more* disadvantaged). This is the opposite of what the indicator's own name suggests. Verified directly against Berlin's Monitoring Soziale Stadtentwicklung (MSS) convention, where Status-Index has always meant this.

## Abitur / school-quality signal

Two different tiering methodologies are provided in `abitur_by_school.csv` (185 schools, real 2025 Abitur results) — **use `tier_vs_peer`, not `tier_raw_grade`, unless you have a specific reason not to:**

- **`tier_raw_grade`** — quartile tiers on the raw average grade (`mn.scls`), pooling all school types together. This is literally "AMAZING = lowest average grade," which sounds right but **conflates school quality with student population** — Gymnasien structurally post better averages than ISS/vocational schools regardless of teaching quality, because of which students attend each track.
- **`tier_vs_peer`** — quartile tiers on `performance_vs_peer` (= the school's own type's state-wide benchmark `mn.vgl`, minus the school's `mn.scls`). This asks "does this school beat its own peer group," which is the fairer comparison.
- **These two disagree on 91 of 185 schools (49%)** — not a rounding difference, a real methodological fork. Checked and confirmed, not a guess.

Coverage limits, both real:
- Only 63 of 185 Abitur schools (34%) have a real PLZ, via a crosswalk to `schulbaumassnahmen-2026.xlsx` — Berlin doesn't appear to publish an open, downloadable directory of every school's address (checked; nothing found under "Schulverzeichnis"/"Schulliste"). The other 122 schools are Bezirk-located only.
- The Abitur dataset itself suppresses any school with fewer than 16 candidates — those schools simply don't appear anywhere in this data, at any tier.
- Abitur only exists at schools with an Oberstufe (Gymnasien, ISS, vocational, private, Kollegs) — **this signal says nothing about Grundschulen**, which is what most families with young kids actually care about first.

## Source-file audit

Before merging, each input file was checked individually — shape, dtypes, duplicates, missingness, cardinality, value-range sanity — rather than trusting the join to surface problems on its own. `secondary_sales`/`rentals`/`new_construction`/`kiez_prices_monthly` already got this treatment in the main business EDA report; the five sources unique to this table were audited separately.

**Clean, no fixes needed:** `Berlin_crimes.csv` (District names match our Bezirk naming exactly, 150 Codes = 150 Locations 1:1, no negatives, no dupes), `berlin_air_quality...csv` (station_id↔station_name 1:1, no dupes, no negative readings, sparse CO/O3 confirmed as a real network limitation not a bug), `kitas_wfs.csv` (no dupe `e_nr`, all PLZ well-formed; `e_platz` is 0.8% missing — those 22 Kitas contribute nothing to `total_kita_capacity`, a small known undercount, not an error), `abitur-2025.xlsx` (all sanity checks pass: `n.best` ∈ [0,1], `mn.scls` ∈ [1.5, 3.06], passed-count never exceeds total-count; 6 private-school codes have a `-K`/`-Y` suffix format that wouldn't have matched the PLZ crosswalk anyway, so no actual impact).

**Two real bugs found and fixed** in `schulbaumassnahmen-2026.xlsx`:
1. `n_school_construction_projects` was counted via the `BSO-Tranche` column, which is 17% null — real construction-project rows with no tranche label were silently excluded, undercounting activity. Fixed by counting on `Adresse` instead (100% populated). Verified: the column now sums to exactly 370 across all PLZ, matching the source file's row count.
2. One school (`09K07`, Sophie-Brahe-Gemeinschaftsschule) has two campuses listed as one field, `"12435, 12437"` — this failed the 5-digit PLZ format check entirely and the whole row silently dropped out of the PLZ join. Fixed by taking the first PLZ as primary; the second campus still isn't independently represented, a remaining minor gap for that one school.

## Known gap: population by age

Not included. Real data exists in principle (Amt für Statistik Berlin-Brandenburg publishes population-by-age at Ortsteil/Planungsraum level), but the link daten.berlin.de points to is dead — their `/opendata` path 404s, the site was restructured. Needs either finding the current URL on their site directly, or an archive.org snapshot of the old CSV. Flagging rather than faking it.

## Reproducing

```bash
python3 build_kiez_profile.py
```

Requires `pandas`, `numpy`, `scipy`. Makes one live call per air-quality station to Nominatim for geocoding (15 calls, rate-limited to 1/sec per their usage policy) — everything else runs on local files in `DATA  SOURCES/`.
