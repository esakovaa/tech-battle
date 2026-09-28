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

Source: [Umweltgerechtigkeit 2023/2024 (Umweltatlas)](https://daten.berlin.de/datensaetze/umweltgerechtigkeit-2023-2024-umweltatlas-wms-c4a4e505), Senatsverwaltung für Mobilität, Verkehr, Klimaschutz und Umwelt. The daten.berlin.de page only links WMS resources, but a **WFS exists at the same service name** (`https://gdi.berlin.de/services/wfs/ua_umweltgerechtigkeit2023`, undocumented on the metadata page — found by testing the naming convention) — see `planungsraum_profile.csv` below for the full 542-Planungsraum bulk pull via that WFS. The columns in *this* PLZ table were pulled earlier via 193 individual `GetFeatureInfo` point queries against the WMS (before the WFS was found), one per PLZ centroid.

Columns (all ordinal categories, not numbers):
- `ug_laerm` — noise burden: gering / mittel / hoch
- `ug_luft` — air pollution burden (Umweltatlas's own modeled layer, independent of the Kaggle station data elsewhere in this table): gering / mittel / hoch
- `ug_gruenversorgung` — green space supply: gut / mittel / schlecht
- `ug_thermisch` — heat/thermal stress: gering / mittel / hoch
- `ug_mehrfachbelastung_umwelt` — combined score across the 4 environmental indicators above: gering / mittel / hoch
- `ug_gesamt_umweltgerechtigkeitskarte` — **correction:** an earlier version of this doc described this as a binary hotspot flag. That was wrong — it's actually a real 6-level ordinal scale (`keine starke Belastung` → `einfach` → `zweifach` → `dreifach` → `vierfach` → `fünffach`, counting how many burden criteria stack up simultaneously), only fully visible once pulled via WFS. The point-query version in this PLZ table only ever surfaced the flagged-hotspot cases because of how GetFeatureInfo happened to render that specific layer — use `planungsraum_profile.csv`'s version of this column instead if you need the full gradation

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

## Planungsraum Profile — a second, finer table

`planungsraum_profile.csv` — one row per **Planungsraum** (Berlin's official urban-planning geography, finer than Bezirk and independent of PLZ boundaries), **542 areas**, not the 447 an older 2012 boundaries dataset suggested — the LOR system has apparently been revised since then, worth knowing if you cite a Planungsraum count elsewhere. Built by `build_planungsraum_profile.py`. `planungsraum_boundaries.geojson` has the real polygon geometry for all 542, reusable for mapping.

**This does not replace the PLZ table.** PLZ stays the agent-facing "kiez recommendation unit" (people search by postal code, not by Planungsraum name). This exists because several sources are exact at Planungsraum grain and get meaningfully more precise here than they were as PLZ approximations:

| What got more precise | How |
|---|---|
| Umweltgerechtigkeit (all 8 indicators) | Native grain now — bulk WFS pull with real polygons, not a single centroid point query per area. Also revealed `ug_gesamt_umweltgerechtigkeitskarte` is a real 6-level scale, not the binary flag the PLZ table's docs used to say (see correction above) |
| Wohnlage mix, Kitas, school-construction projects | Real point-in-polygon spatial join (100% address match rate on Wohnlage, 400,505/400,505) instead of nearest-centroid guessing |
| secondary_sales / rentals / new_construction (synthetic) | Same — real polygon containment, 96–98% match rate (the rest fall just outside city-boundary gaps) |
| Abitur | **Partially** — the 63 schools with known coordinates now get an exact Planungsraum match (`abitur_mn_scls_plr_avg` etc., covering 61/542 areas directly); every area also carries the Bezirk-level fallback (`abitur_mn_scls_bezirk_avg`, 542/542) so coverage doesn't regress versus the PLZ table |

**What did NOT get more precise, and can't:**
- `buy_price_per_m2_avg_REAL` (dataset2) — still PLZ-only at the source (no lat/lon in that file at all). Linked in via `dominant_plz`, which is the *majority PLZ of real Wohnlage addresses actually inside that Planungsraum* — a real ground-truth crosswalk, not a centroid-distance guess, but still inherits one PLZ's price across every Planungsraum within it
- Crime — the raw count (`crime_total_avg_2017_2019`) is still Bezirk-level only, inherited. A Prognoseraum-level crosswalk (Prognoseraum is Planungsraum's direct parent in the LOR hierarchy, so this should in principle be decodable from the code structure) was considered but not verified — flagging as unresolved rather than guessing at a mapping. **`crime_rate_per_10k_2017_2019` is new** — see the Population section below, which is what made a real rate possible instead of the raw count

### `n_yoga_studios`, `n_kinderarzt` — new, live OSM data (Overpass API)

Pulled from OpenStreetMap via the public Overpass API — `fetch_osm_pois.py` fetches raw POIs (yoga studios: `sport=yoga`; paediatricians: `amenity=doctors` + a `healthcare:speciality` regex covering both English and German tagging variants) and caches them unaggregated in `osm_pois_raw.csv`. `join_osm_pois_to_planungsraum.py` then does a real point-in-polygon spatial join against `planungsraum_boundaries.geojson` (same `gpd.sjoin(..., predicate="within")` convention as the rest of this table) and merges the two count columns straight into `planungsraum_profile.csv`.

- 136 yoga studios, 122 Kinderarzt practices found citywide (Berlin bbox query, not filtered further).
- Most matched by real polygon containment (128/136 yoga, 107/122 Kinderarzt); the rest fell back to nearest-Planungsraum-centroid — same edge case as the other joins in this table (a POI mapped just outside every polygon, e.g. near a city-boundary gap).
- Not yet joined into `kiez_profile_by_plz.csv` (the PLZ-level table) — `osm_poi_counts_by_plz.csv` has the same counts pre-aggregated to PLZ (nearest-centroid join, since that table has no real polygons) if that merge is wanted later.
- Coverage caveat: this is whatever's mapped in OSM, not a licensed business directory — completeness varies by neighborhood the way OSM contributor density does, and the Kinderarzt regex may miss practices tagged without a `healthcare:speciality` value at all (e.g. just named "Kinderarztpraxis X" with no structured specialty tag).

## Source-file audit

Before merging, each input file was checked individually — shape, dtypes, duplicates, missingness, cardinality, value-range sanity — rather than trusting the join to surface problems on its own. `secondary_sales`/`rentals`/`new_construction`/`kiez_prices_monthly` already got this treatment in the main business EDA report; the five sources unique to this table were audited separately.

**Clean, no fixes needed:** `Berlin_crimes.csv` (District names match our Bezirk naming exactly, 150 Codes = 150 Locations 1:1, no negatives, no dupes), `berlin_air_quality...csv` (station_id↔station_name 1:1, no dupes, no negative readings, sparse CO/O3 confirmed as a real network limitation not a bug), `kitas_wfs.csv` (no dupe `e_nr`, all PLZ well-formed; `e_platz` is 0.8% missing — those 22 Kitas contribute nothing to `total_kita_capacity`, a small known undercount, not an error), `abitur-2025.xlsx` (all sanity checks pass: `n.best` ∈ [0,1], `mn.scls` ∈ [1.5, 3.06], passed-count never exceeds total-count; 6 private-school codes have a `-K`/`-Y` suffix format that wouldn't have matched the PLZ crosswalk anyway, so no actual impact).

**Two real bugs found and fixed** in `schulbaumassnahmen-2026.xlsx`:
1. `n_school_construction_projects` was counted via the `BSO-Tranche` column, which is 17% null — real construction-project rows with no tranche label were silently excluded, undercounting activity. Fixed by counting on `Adresse` instead (100% populated). Verified: the column now sums to exactly 370 across all PLZ, matching the source file's row count.
2. One school (`09K07`, Sophie-Brahe-Gemeinschaftsschule) has two campuses listed as one field, `"12435, 12437"` — this failed the 5-digit PLZ format check entirely and the whole row silently dropped out of the PLZ join. Fixed by taking the first PLZ as primary; the second campus still isn't independently represented, a remaining minor gap for that one school.

### `n_population`, `n_population_<age band>`, `n_population_female`, `pct_population_coverage` — population by age (Planungsraum-only, allocated)

Previously flagged as a known gap (the daten.berlin.de link for Amt für Statistik population-by-age data was dead). Resolved via a different source: [Berlin District Population (Kaggle)](https://www.kaggle.com/datasets/shreejahoskerenatesh/berlin-district-population), saved locally as `DATA  SOURCES/berlin_population_by_plz_bezirk.csv`. Real population counts, `unter 6 / 6–15 / 15–18 / 18–27 / 27–45 / 45–55 / 55–65 / 65 und mehr` age bands plus a female count — but **only at PLZ × Bezirk grain** (218 rows covering 190 PLZ; 28 PLZ split across two Bezirke each get their own row), not Planungsraum. The source file's exact vintage year isn't stated in the data itself; cite the Kaggle page if that matters for a claim. (The raw upload used Mac-style `\r` line endings and Mac-Roman encoding — umlauts and Bezirk abbreviations like `Tempelh.-Schöneb.` decode incorrectly under UTF-8/cp1252; the cleaned copy fixes both and maps abbreviations to this table's full Bezirk names.)

No Planungsraum-level population source exists, so `enrich_population_and_crime_rate.py` allocates each PLZ × Bezirk population figure down to Planungsraum by **real address-count share within that (PLZ, Bezirk) cell** — using the same 400k-address Wohnlage dataset every other point-in-polygon join in this table already relies on (each address carries its own `plz`, `bezname`, and `plr_name`). This is a real, address-weighted split, not a uniform or area-based guess — but it is still an *estimate*, not an independently measured Planungsraum figure.

- Columns: `n_population` (total), `n_population_under6`, `n_population_6_15`, `n_population_15_18`, `n_population_18_27`, `n_population_27_45`, `n_population_45_55`, `n_population_55_65`, `n_population_65plus`, `n_population_female`.
- Sums to 3,710,938 across all 542 Planungsräume vs. 3,710,929 in the source file — the 9-person gap is rounding drift from rounding each Planungsraum's fractional allocation independently, not an error.
- **`pct_population_coverage`** — what share of this Planungsraum's own addresses actually landed in a matched (PLZ, Bezirk) population cell. 503/542 areas are at 100%. The other 39 are partial (as low as 86.6%, e.g. `Nonnendammallee`) because a small number of addresses sit in a (PLZ, Bezirk) combination the population source doesn't break out separately — city-boundary slivers where a PLZ mostly belongs to one Bezirk but a handful of addresses fall in a neighboring one. Those addresses contribute 0 to the population figures, not a guess, and it affects a tiny share of the city overall (272/400,505 addresses, 0.07%). **No Planungsraum has 0% coverage** — every area's population estimate is at least partially real. Treat `n_population*` as directional in the 39 partial-coverage areas, and check this column before quoting an exact number for one of them.

### `crime_rate_per_10k_2017_2019` — the first population-normalized crime metric in this table

`crime_total_avg_2017_2019` (the existing Bezirk-level absolute count) has no per-capita form anywhere in this project until now — the only per-area denominator available before this dataset existed would have been `n_addresses`, a real but imperfect population proxy (address count tracks housing density, not household size or non-residential population). With real Bezirk population now available (summed directly from `berlin_population_by_plz_bezirk.csv`, no allocation needed since this is a straight sum, not a Planungsraum split), `crime_rate_per_10k_2017_2019 = crime_total_avg_2017_2019 / (bezirk_population / 10,000)` replaces that gap with a real rate. Still Bezirk-level and inherited (same caveat as the raw count) — every Planungsraum in a Bezirk shows the identical rate. `bezirk_population` is included alongside it for transparency. Directionally sane on inspection: inner-city Bezirke (e.g. Neukölln, Friedrichshain-Kreuzberg) run roughly 2× the rate of outer, more suburban ones (e.g. Steglitz-Zehlendorf).

## Reproducing

```bash
python3 build_kiez_profile.py             # PLZ table
python3 build_planungsraum_profile.py     # Planungsraum table (needs geopandas, shapely; live WFS pull)
python3 fetch_osm_pois.py                 # live Overpass pull -> osm_pois_raw.csv, osm_poi_counts_by_plz.csv
python3 join_osm_pois_to_planungsraum.py  # merges POI counts into planungsraum_profile.csv
python3 enrich_population_and_crime_rate.py  # merges population + crime rate into planungsraum_profile.csv
```

Requires `pandas`, `numpy`, `scipy`, `requests`; `build_planungsraum_profile.py` and `join_osm_pois_to_planungsraum.py` also need `geopandas`/`shapely` for real point-in-polygon joins. `build_kiez_profile.py` makes one live call per air-quality station to Nominatim for geocoding (15 calls, rate-limited to 1/sec per their usage policy). `build_planungsraum_profile.py` pulls the Umweltgerechtigkeit layers live via WFS. `fetch_osm_pois.py` hits the public Overpass API — expect it to need several retries with backoff even on a good connection, that's normal for the public instance, not a bug in the script. The last two scripts (`join_osm_pois_to_planungsraum.py`, `enrich_population_and_crime_rate.py`) only need to be re-run after `build_planungsraum_profile.py`, since they modify `planungsraum_profile.csv` in place.
