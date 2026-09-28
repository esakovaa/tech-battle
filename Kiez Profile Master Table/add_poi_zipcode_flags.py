"""
Add "does this ZIP code have at least one" boolean flags for yoga studios,
Kinderarzt, gyms, and bouldering gyms to planungsraum_profile.csv.

Why PLZ, not Planungsraum: at Planungsraum grain these are zero-inflated to
varying degrees (136 yoga / 122 Kinderarzt / 516 gym / 26 bouldering spread
across 542 areas). People walk/commute further than one Planungsraum for any
of these — same reasoning applies to all four, not just the first two — so
"is there one in this ZIP code" (193 areas, ~2.8x fewer) is the more usable
signal for all of them, applied consistently.

Uses osm_poi_counts_by_plz.csv (produced by fetch_osm_pois.py) and the same
dominant_plz crosswalk build_planungsraum_profile.py uses for real buy prices
— the majority PLZ of real Wohnlage addresses actually inside each
Planungsraum, not a distance guess.

Usage:
    python3 add_poi_zipcode_flags.py
Reads:
    osm_poi_counts_by_plz.csv
    planungsraum_profile.csv (must already have dominant_plz - i.e. run
    build_planungsraum_profile.py first)
Writes:
    planungsraum_profile.csv (updated in place, +8 columns:
    n_<category>_plz and has_<category>_plz for each of yoga_studios,
    kinderarzt, gym, bouldering)
"""
import pandas as pd

PROFILE = "planungsraum_profile.csv"
OSM_PLZ = "osm_poi_counts_by_plz.csv"
CATEGORIES = ["yoga_studios", "kinderarzt", "gym", "bouldering"]


def main():
    profile = pd.read_csv(PROFILE, dtype={"plr_id": str, "dominant_plz": str})
    osm_plz = pd.read_csv(OSM_PLZ, dtype={"plz": str})

    new_cols = []
    for cat in CATEGORIES:
        raw_col = f"n_{cat}"
        plz_col = f"n_{cat}_plz"
        has_col = f"has_{cat}_plz"
        osm_plz = osm_plz.rename(columns={raw_col: plz_col})
        osm_plz[has_col] = (osm_plz[plz_col] >= 1).astype(int)
        new_cols += [plz_col, has_col]

    # Idempotent on re-run: drop any of these columns if already present
    # (e.g. from an earlier run with fewer categories) before merging fresh.
    profile = profile.drop(columns=[c for c in new_cols if c in profile.columns])

    before = len(profile)
    merged = profile.merge(osm_plz, left_on="dominant_plz", right_on="plz", how="left").drop(columns=["plz"])
    assert len(merged) == before, "row count changed during merge"

    for col in new_cols:
        merged[col] = merged[col].fillna(0).astype(int)

    merged.to_csv(PROFILE, index=False)
    print(f"Updated {PROFILE}: {merged.shape}")
    for cat in CATEGORIES:
        has_col = f"has_{cat}_plz"
        print(f"  {has_col}: {merged[has_col].sum()}/{len(merged)} Planungsräume")


if __name__ == "__main__":
    main()
