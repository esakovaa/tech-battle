"""
Real point-level POI locations (Kitas + OSM yoga/kinderarzt/gym/bouldering),
each joined to its real Planungsraum via point-in-polygon. Powers the
per-Kiez map feature: "highlight things relevant from the user's form" needs
actual coordinates per POI, not just the counts already in
planungsraum_profile.csv.

Usage:
    python3 build_poi_locations.py
Reads:
    DATA SOURCES/Kita Standorte (WFS)/kitas_wfs.csv
    osm_pois_raw.csv          (from fetch_osm_pois.py)
    planungsraum_boundaries.geojson
Writes:
    ../src/data/poi_locations.json — [{plr_id, category, name, lat, lon}, ...]
    category is one of: kita, n_yoga_studios, n_kinderarzt, n_gym, n_bouldering
    (matching the profile table's existing count-column names, so the
    frontend can reuse the same category keys it already knows from
    PlanungsraumProfile instead of inventing a second vocabulary).
"""
import json
import pandas as pd
import geopandas as gpd

KITAS = "../DATA  SOURCES/Kita Standorte (WFS)/kitas_wfs.csv"
OSM_POIS = "osm_pois_raw.csv"
BOUNDARIES = "planungsraum_boundaries.geojson"
JSON_OUT = "../src/data/poi_locations.json"


def point_in_polygon_join(df: pd.DataFrame, plr_poly: gpd.GeoDataFrame) -> pd.DataFrame:
    gdf = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df.lon, df.lat), crs="EPSG:4326")
    joined = gpd.sjoin(gdf, plr_poly, how="inner", predicate="within")
    return pd.DataFrame(joined.drop(columns=["geometry", "index_right"]))


def main():
    plr_poly = gpd.read_file(BOUNDARIES)[["plr_id", "geometry"]]

    kitas = pd.read_csv(KITAS, usecols=["e_name", "lat", "lon"]).rename(columns={"e_name": "name"})
    kitas = kitas.dropna(subset=["lat", "lon"])
    kitas["category"] = "kita"
    kitas_joined = point_in_polygon_join(kitas, plr_poly)
    print(f"[1] Kitas: {len(kitas_joined)}/{len(kitas)} matched to a Planungsraum by real polygon")

    osm = pd.read_csv(OSM_POIS, usecols=["lat", "lon", "name", "category"])
    osm = osm.dropna(subset=["lat", "lon"])
    osm_joined = point_in_polygon_join(osm, plr_poly)
    print(f"[2] OSM POIs: {len(osm_joined)}/{len(osm)} matched to a Planungsraum by real polygon")
    print(f"    by category: {osm_joined['category'].value_counts().to_dict()}")

    combined = pd.concat([
        kitas_joined[["plr_id", "category", "name", "lat", "lon"]],
        osm_joined[["plr_id", "category", "name", "lat", "lon"]],
    ], ignore_index=True)
    combined["name"] = combined["name"].fillna("")

    records = combined.to_dict(orient="records")
    with open(JSON_OUT, "w") as f:
        json.dump(records, f, separators=(",", ":"))
    print(f"[3] Saved {JSON_OUT}: {len(records)} POI locations across "
          f"{combined['plr_id'].nunique()} Planungsräume")


if __name__ == "__main__":
    main()
