"""
Replace nearest_transit_station / nearest_transit_line / transit_distance_km
with REAL data from VBB's official GTFS feed, instead of the synthetic
Kaggle dataset's Berlin-only 135-station list those columns previously came
from (see Kiez Profile Master Table/README.md's old column-quality note).

Source: VBB-Fahrplandaten via GTFS (CC-BY 4.0), official feed published by
VBB (Verkehrsverbund Berlin-Brandenburg) via daten.berlin.de, mirrored with
stable URLs at https://vbb-gtfs.jannisr.de/latest/ (maintained by the same
person behind v6.vbb.transport.rest, which src/tools/commute.py already
uses). Version 2026-09-24 at the time this was fetched. Covers Berlin AND
Brandenburg (plus some cross-border regional/express routes reaching just
beyond both) — real, comprehensive, not the old Berlin-only limitation.

Method:
    1. stops.csv location_type=="1" rows are the 878 real named stations
       (everything else — platforms, entrances, generic nodes — is a child
       of one of these via parent_station).
    2. stop_times.csv -> trips.csv -> routes.csv gives, for every platform
       stop_id, which route_short_names actually call there.
    3. Roll platform-level route sets up to their parent station.
    4. Nearest real station per Planungsraum via cKDTree (same pattern as
       the rest of this pipeline), with real line names attached.

Usage:
    python3 build_real_transit_data.py
Fetches (if not already present — not committed, see .gitignore; stop_times.csv
alone is ~400MB):
    DATA SOURCES/VBB GTFS/{stops,routes,trips,stop_times}.csv
    from https://vbb-gtfs.jannisr.de/latest/ (mirror of VBB's official feed)
Reads/writes:
    planungsraum_profile.csv       (nearest_transit_station/_line/transit_distance_km updated in place)
    ../src/data/planungsraum.json  (regenerated, same as add_distance_from_center.py)
"""
import os
import json
import pandas as pd
import requests
from scipy.spatial import cKDTree

GTFS_DIR = "../DATA  SOURCES/VBB GTFS"
GTFS_MIRROR = "https://vbb-gtfs.jannisr.de/latest"
GTFS_FILES = ["stops.csv", "routes.csv", "trips.csv", "stop_times.csv"]
PROFILE = "planungsraum_profile.csv"
JSON_OUT = "../src/data/planungsraum.json"


def fetch_gtfs_files():
    os.makedirs(GTFS_DIR, exist_ok=True)
    for fname in GTFS_FILES:
        path = f"{GTFS_DIR}/{fname}"
        if os.path.exists(path):
            continue
        print(f"Fetching {fname} from {GTFS_MIRROR}...")
        resp = requests.get(f"{GTFS_MIRROR}/{fname}", timeout=120)
        resp.raise_for_status()
        with open(path, "wb") as f:
            f.write(resp.content)
        print(f"  saved {len(resp.content) / 1e6:.1f} MB")


def main():
    fetch_gtfs_files()
    stops = pd.read_csv(f"{GTFS_DIR}/stops.csv", dtype=str)
    stops["stop_lat"] = stops["stop_lat"].astype(float)
    stops["stop_lon"] = stops["stop_lon"].astype(float)

    stations = stops[stops["location_type"] == "1"][["stop_id", "stop_name", "stop_lat", "stop_lon"]].copy()
    print(f"[1] {len(stations)} real named stations (location_type=1)")

    # Every stop resolves to itself (if it's already a station) or its
    # parent_station (platforms/entrances/nodes) — one level, which covers
    # this feed's actual hierarchy depth (checked: no stop's parent is
    # itself a non-station).
    parent_map = stops.set_index("stop_id")["parent_station"]
    station_ids = set(stations["stop_id"])

    def resolve_station(stop_id):
        if stop_id in station_ids:
            return stop_id
        parent = parent_map.get(stop_id)
        if isinstance(parent, str) and parent in station_ids:
            return parent
        return None  # a stop with no station ancestor (e.g. a lone bus pole) — excluded

    stops["resolved_station_id"] = stops["stop_id"].map(resolve_station)
    unresolved = stops["resolved_station_id"].isna().sum()
    print(f"[2] {len(stops) - unresolved}/{len(stops)} stops resolved to a parent station "
          f"({unresolved} standalone stops with no station ancestor, excluded)")

    stop_times = pd.read_csv(f"{GTFS_DIR}/stop_times.csv", usecols=["trip_id", "stop_id"], dtype=str)
    trips = pd.read_csv(f"{GTFS_DIR}/trips.csv", usecols=["trip_id", "route_id"], dtype=str)
    routes = pd.read_csv(f"{GTFS_DIR}/routes.csv", usecols=["route_id", "route_short_name"], dtype=str)
    print(f"[3] Loaded {len(stop_times):,} stop_times, {len(trips):,} trips, {len(routes):,} routes")

    merged = stop_times.merge(trips, on="trip_id", how="inner").merge(routes, on="route_id", how="inner")
    merged = merged.merge(stops[["stop_id", "resolved_station_id"]], on="stop_id", how="inner")
    merged = merged.dropna(subset=["resolved_station_id"])

    lines_per_station = merged.groupby("resolved_station_id")["route_short_name"].unique()
    print(f"[4] {len(lines_per_station)} stations have at least one real route serving them")

    stations["lines"] = stations["stop_id"].map(lambda sid: sorted(lines_per_station.get(sid, [])))
    stations["lines_str"] = stations["lines"].apply(lambda ls: ", ".join(ls) if ls else None)

    tree = cKDTree(stations[["stop_lon", "stop_lat"]].values)
    profile = pd.read_csv(PROFILE, dtype={"plr_id": str, "dominant_plz": str})

    dist, idx = tree.query(profile[["lon", "lat"]].values, k=1)
    profile["nearest_transit_station"] = stations["stop_name"].values[idx]
    profile["nearest_transit_line"] = stations["lines_str"].values[idx]
    profile["transit_distance_km"] = (dist * 111).round(4)  # deg->km, consistent with this pipeline's other uses

    profile.to_csv(PROFILE, index=False)
    print(f"[5] Updated {PROFILE}: {profile.shape}")
    print(f"    transit_distance_km range: {profile['transit_distance_km'].min():.2f} - "
          f"{profile['transit_distance_km'].max():.2f} km")
    print(f"    Planungsräume with no line data at nearest station: {profile['nearest_transit_line'].isna().sum()}")

    records = profile.astype(object).where(pd.notna(profile), None).to_dict(orient="records")
    with open(JSON_OUT, "w") as f:
        json.dump(records, f, separators=(",", ":"))
    print(f"[6] Regenerated {JSON_OUT}: {len(records)} rows")


if __name__ == "__main__":
    main()
