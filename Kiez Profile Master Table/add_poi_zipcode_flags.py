"""
Add "does this ZIP code have at least one" boolean flags for yoga studios and
Kinderarzt (pediatricians) to planungsraum_profile.csv.

Why PLZ, not Planungsraum: at Planungsraum grain these are heavily
zero-inflated (136 yoga studios / 122 Kinderarzt spread across 542 areas, most
scoring 0). People walk further than one Planungsraum for these, so "is there
one in this ZIP code" (193 areas, ~2.8x fewer, much less sparse: 70/193 have a
yoga studio, 81/193 a Kinderarzt) is a more usable signal than the raw count.

Uses osm_poi_counts_by_plz.csv (already produced by fetch_osm_pois.py) and the
same dominant_plz crosswalk build_planungsraum_profile.py uses for real buy
prices — the majority PLZ of real Wohnlage addresses actually inside each
Planungsraum, not a distance guess.

Usage:
    python3 add_poi_zipcode_flags.py
Reads:
    osm_poi_counts_by_plz.csv
    planungsraum_profile.csv (must already have dominant_plz - i.e. run
    build_planungsraum_profile.py first)
Writes:
    planungsraum_profile.csv (updated in place, +4 columns:
    n_yoga_studios_plz, has_yoga_studio_plz, n_kinderarzt_plz, has_kinderarzt_plz)
"""
import pandas as pd

PROFILE = "planungsraum_profile.csv"
OSM_PLZ = "osm_poi_counts_by_plz.csv"


def main():
    profile = pd.read_csv(PROFILE, dtype={"plr_id": str, "dominant_plz": str})
    osm_plz = pd.read_csv(OSM_PLZ, dtype={"plz": str})

    osm_plz = osm_plz.rename(columns={"n_yoga_studios": "n_yoga_studios_plz", "n_kinderarzt": "n_kinderarzt_plz"})
    osm_plz["has_yoga_studio_plz"] = (osm_plz["n_yoga_studios_plz"] >= 1).astype(int)
    osm_plz["has_kinderarzt_plz"] = (osm_plz["n_kinderarzt_plz"] >= 1).astype(int)

    before = len(profile)
    merged = profile.merge(osm_plz, left_on="dominant_plz", right_on="plz", how="left").drop(columns=["plz"])
    assert len(merged) == before, "row count changed during merge"

    for col in ["n_yoga_studios_plz", "n_kinderarzt_plz", "has_yoga_studio_plz", "has_kinderarzt_plz"]:
        merged[col] = merged[col].fillna(0).astype(int)

    merged.to_csv(PROFILE, index=False)
    print(f"Updated {PROFILE}: {merged.shape}")
    print(f"  has_yoga_studio_plz: {merged.has_yoga_studio_plz.sum()}/{len(merged)} Planungsräume")
    print(f"  has_kinderarzt_plz:  {merged.has_kinderarzt_plz.sum()}/{len(merged)} Planungsräume")


if __name__ == "__main__":
    main()
