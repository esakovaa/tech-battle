"""
Join the raw OSM POIs fetched by fetch_osm_pois.py (osm_pois_raw.csv) to the
real Planungsraum polygons in planungsraum_boundaries.geojson via proper
point-in-polygon spatial join — the same gpd.sjoin(..., predicate="within")
convention build_planungsraum_profile.py uses everywhere else in this table.

This is strictly more accurate than a nearest-centroid join: a POI right on
the edge of a large Planungsraum can be nearer another area's centroid than
its own polygon, which nearest-centroid would get wrong and point-in-polygon
does not.

Usage:
    python3 join_osm_pois_to_planungsraum.py
Reads:
    osm_pois_raw.csv (produced by fetch_osm_pois.py)
    planungsraum_boundaries.geojson
Writes:
    osm_poi_counts_by_planungsraum.csv  (plr_id, plr_name, n_yoga_studios, n_kinderarzt)
    planungsraum_profile.csv            (updated in place with the two new columns merged in)
"""
import pandas as pd
import geopandas as gpd
from scipy.spatial import cKDTree

RAW_POIS = "osm_pois_raw.csv"
BOUNDARIES = "planungsraum_boundaries.geojson"
PROFILE = "planungsraum_profile.csv"

CATEGORIES = ["n_yoga_studios", "n_kinderarzt", "n_gym", "n_bouldering"]


def main():
    raw_pois = pd.read_csv(RAW_POIS)
    plr_poly = gpd.read_file(BOUNDARIES)[["plr_id", "plr_name", "geometry"]]

    profile = pd.read_csv(PROFILE, dtype={"plr_id": str})
    plr_tree = cKDTree(profile[["lon", "lat"]].values)
    plr_ids = profile["plr_id"].values

    out = plr_poly[["plr_id", "plr_name"]].copy()

    for count_col in CATEGORIES:
        pois = raw_pois[raw_pois["category"] == count_col].copy()
        if not len(pois):
            out[count_col] = 0
            continue

        pois_gdf = gpd.GeoDataFrame(
            pois, geometry=gpd.points_from_xy(pois.lon, pois.lat), crs="EPSG:4326"
        )
        joined = gpd.sjoin(pois_gdf, plr_poly, how="left", predicate="within")

        # A few points can fall just outside every polygon (gaps at the city
        # boundary, or a POI mapped slightly off) — same edge case
        # build_planungsraum_profile.py already documents for its own joins.
        # Fall back to nearest-Planungsraum-centroid for those only.
        unmatched = joined["plr_id"].isna()
        if unmatched.any():
            _, idx = plr_tree.query(joined.loc[unmatched, ["lon", "lat"]].values, k=1)
            joined.loc[unmatched, "plr_id"] = plr_ids[idx]
        print(f"[{count_col}] {len(pois)} POIs: {(~unmatched).sum()} matched by polygon, "
              f"{unmatched.sum()} fell back to nearest-centroid")

        agg = joined.groupby("plr_id").size().rename(count_col).reset_index()
        out = out.merge(agg, on="plr_id", how="left")
        out[count_col] = out[count_col].fillna(0).astype(int)

    out.to_csv("osm_poi_counts_by_planungsraum.csv", index=False)
    print(f"\nSaved osm_poi_counts_by_planungsraum.csv: {out.shape}")
    print(out[CATEGORIES].sum())

    # Merge straight into the full Planungsraum table. Idempotent on re-run:
    # drop any CATEGORIES columns already present (e.g. from an earlier run
    # with fewer categories) before merging fresh, so re-running with new
    # categories added doesn't create duplicate/suffixed columns.
    profile = profile.drop(columns=[c for c in CATEGORIES if c in profile.columns])
    merged = profile.merge(out.drop(columns=["plr_name"]), on="plr_id", how="left")
    for col in CATEGORIES:
        merged[col] = merged[col].fillna(0).astype(int)
    assert len(merged) == len(profile), "row count changed during merge"
    merged.to_csv(PROFILE, index=False)
    print(f"\nUpdated {PROFILE} in place: {merged.shape}, added columns {CATEGORIES}")


if __name__ == "__main__":
    main()
