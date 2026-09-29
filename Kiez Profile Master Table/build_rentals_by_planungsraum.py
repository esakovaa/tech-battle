"""
Join rentals.csv (synthetic Kaggle hedonic-model dataset — see the main
README's trust-level notes) to real Planungsraum polygons, and export a
trimmed per-listing JSON the Next.js app can bundle and filter at request
time (no DB, no live join per request — same "touch the data once, filter
in memory after" approach as src/data/planungsraum.json).

Used to power "click a recommended Kiez -> show 3 example flat listings
matching the room count the user asked for" in the app.

Usage:
    python3 build_rentals_by_planungsraum.py
Reads:
    DATA SOURCES/Berlin Real Estate Sales Rentals 2020-2026/rentals.csv
    planungsraum_boundaries.geojson
Writes:
    ../src/data/rentals_by_planungsraum.json
"""
import json
import pandas as pd
import geopandas as gpd

SRC = "../DATA  SOURCES/Berlin Real Estate Sales Rentals 2020-2026/rentals.csv"
BOUNDARIES = "planungsraum_boundaries.geojson"
OUT = "../src/data/rentals_by_planungsraum.json"

KEEP_COLUMNS = [
    "id", "plr_id", "rooms", "area_m2", "floor", "total_floors", "building_era",
    "condition", "has_lift", "has_balcony", "furnished",
    "kaltmiete_eur_monthly", "warmmiete_eur_monthly", "rent_per_m2_kalt_eur",
    "ortsteil", "date_listed",
]


def main():
    rentals = pd.read_csv(SRC)
    plr_poly = gpd.read_file(BOUNDARIES)[["plr_id", "geometry"]]

    gdf = gpd.GeoDataFrame(rentals, geometry=gpd.points_from_xy(rentals.lon, rentals.lat), crs="EPSG:4326")
    joined = gpd.sjoin(gdf, plr_poly, how="inner", predicate="within")
    print(f"[1] {len(joined)}/{len(rentals)} listings matched to a Planungsraum by real polygon containment "
          f"({len(rentals) - len(joined)} fell outside every polygon — city-boundary gaps, dropped, not guessed)")

    out = joined[KEEP_COLUMNS].copy()
    out["date_listed"] = out["date_listed"].astype(str)

    records = out.to_dict(orient="records")
    with open(OUT, "w") as f:
        json.dump(records, f, separators=(",", ":"))

    print(f"[2] Saved {OUT}: {len(records)} listings")
    print(f"    Rooms distribution: {out['rooms'].value_counts().sort_index().to_dict()}")
    print(f"    Planungsräume covered: {out['plr_id'].nunique()}/542")


if __name__ == "__main__":
    main()
