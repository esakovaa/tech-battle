"""
Pull POI counts (yoga studios, Kinderarzt practices, etc.) from the Overpass
API and aggregate them to PLZ, using the same nearest-centroid join pattern
build_kiez_profile.py uses for rentals/secondary_sales/transit_stations.

Overpass has no reliable addr:postcode on most POIs, so we don't try to read
PLZ off the OSM tags — we join each POI to the nearest PLZ centroid from the
already-built master table instead.

Usage:
    python3 fetch_osm_pois.py
Produces:
    osm_poi_counts_by_plz.csv  (plz, n_yoga_studios, n_kinderarzt, ...)
Merge this into kiez_profile_by_plz.csv the same way build_kiez_profile.py
merges kita_agg / schools_agg (pd.merge on "plz", how="left", then fillna(0)
on the count columns).
"""
import time
import requests
import pandas as pd
from scipy.spatial import cKDTree

MASTER_TABLE = "kiez_profile_by_plz.csv"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Berlin bounding box (south, west, north, east) — a rough box is fine, we
# filter to real PLZ coverage via the nearest-centroid join afterward.
BERLIN_BBOX = (52.33, 13.09, 52.68, 13.76)

# One Overpass query per POI category. `nwr` = node/way/relation, catches
# POIs mapped as points, buildings, or areas. `out center;` collapses
# ways/relations to a representative point so every result is lat/lon.
QUERIES = {
    "n_yoga_studios": """
        [out:json][timeout:60];
        nwr["sport"="yoga"]({bbox});
        out center;
    """,
    "n_kinderarzt": """
        [out:json][timeout:60];
        (
          nwr["amenity"="doctors"]["healthcare:speciality"~"paediatric|child_health"]({bbox});
          nwr["amenity"="doctors"]["healthcare:speciality"~"pädiatrie|kinder", i]({bbox});
        );
        out center;
    """,
}


def fetch_pois(query_template: str) -> pd.DataFrame:
    bbox_str = ",".join(str(v) for v in BERLIN_BBOX)
    query = query_template.format(bbox=bbox_str)
    resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=90)
    resp.raise_for_status()
    elements = resp.json()["elements"]

    rows = []
    for el in elements:
        if el["type"] == "node":
            lat, lon = el["lat"], el["lon"]
        else:  # way/relation -> use the "center" Overpass computed
            center = el.get("center")
            if not center:
                continue
            lat, lon = center["lat"], center["lon"]
        rows.append({"lat": lat, "lon": lon, "name": el.get("tags", {}).get("name")})
    return pd.DataFrame(rows)


def main():
    plz_base = pd.read_csv(MASTER_TABLE, dtype={"plz": str})[["plz", "lat", "lon"]].dropna()
    plz_tree = cKDTree(plz_base[["lon", "lat"]].values)
    plz_list = plz_base["plz"].values

    out = plz_base[["plz"]].copy()

    for count_col, query_template in QUERIES.items():
        pois = fetch_pois(query_template)
        print(f"[{count_col}] fetched {len(pois)} POIs from Overpass")

        if len(pois):
            _, idx = plz_tree.query(pois[["lon", "lat"]].values, k=1)
            pois["plz"] = plz_list[idx]
            agg = pois.groupby("plz").size().rename(count_col).reset_index()
            out = out.merge(agg, on="plz", how="left")
        else:
            out[count_col] = 0

        out[count_col] = out[count_col].fillna(0).astype(int)
        time.sleep(2)  # be polite to the public Overpass instance between queries

    out.to_csv("osm_poi_counts_by_plz.csv", index=False)
    print(f"\nSaved osm_poi_counts_by_plz.csv: {out.shape}")
    print(out.sum(numeric_only=True))


if __name__ == "__main__":
    main()
