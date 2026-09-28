"""
berlin_commute.py
=================
Commute-area tool for the Brandenburg -> Berlin demo.

Question it answers:
    "From where in Brandenburg can I reach Alexanderplatz by 09:00 on a weekday
     with a total commute of at most 45 minutes (walk to a train station + train)?"

Method (station-first):
    1. Find every train station in Brandenburg (OSM + VBB).
    2. Ask the VBB journey planner, once per station, for the best journey that
       arrives at Alexanderplatz by the target time -> train_minutes.
    3. Remaining budget per station: walk_minutes = min(MAX_WALK, MAX_COMMUTE - train_minutes).
    4. Draw the walkable street area around each station with OSMnx.
    5. Merge all station areas into one polygon = the commute area.

Steps 1-2 hit external APIs and are cached to disk. Once cached, changing the
maximum commute time (X) only re-runs steps 3-5, which are local.

See BERLIN_COMMUTE_TOOL.md for the full explanation.
"""

import os
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
import plotly.graph_objects as go
import requests
from shapely.geometry import Point
from shapely.ops import unary_union


# ── Configuration ─────────────────────────────────────────────────────────────

VBB_API_URL = "https://v6.vbb.transport.rest"
REQUEST_PAUSE_S = 0.7            # keeps us under the public API limit (~100 req/min)
USER_AGENT = "berlin-commute-demo"

TIMEZONE = ZoneInfo("Europe/Berlin")

ALEXANDERPLATZ_ID = "900100003"  # VBB stop id of "S+U Alexanderplatz Bhf (Berlin)"
ALEXANDERPLATZ_LATLNG = (52.521508, 13.411267)

BRANDENBURG_OSM_ID = "R62504"    # OSM relation of the State of Brandenburg (Berlin is a hole in it)

ARRIVAL_HOUR = 9                 # Y: arrive at the destination by 09:00
MAX_COMMUTE_MIN = 45             # X: walk + train must be <= 45 min
MAX_WALK_MIN = 20                # never walk more than 20 min to the station
WALKING_SPEED_MPM = 83.3         # ~5 km/h in metres per minute

# VBB product names that count as "train" for the starting station.
TRAIN_PRODUCTS = ("suburban", "regional", "express")

EDGE_BUFFER_M = 40               # how wide each walkable street is drawn in the area polygon

CACHE_DIR = "berlin_commute_cache"


# ── VBB API helpers ───────────────────────────────────────────────────────────

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": USER_AGENT})


def _vbb_get(path, params, retries=4):
    """GET a VBB endpoint and return the parsed JSON, retrying on rate limits / server errors."""
    # The API expects lowercase "true"/"false", not Python's "True"/"False".
    clean = {k: (str(v).lower() if isinstance(v, bool) else v) for k, v in params.items()}
    url = f"{VBB_API_URL}{path}"

    for attempt in range(retries):
        try:
            resp = _SESSION.get(url, params=clean, timeout=30)
        except requests.RequestException as exc:
            print(f"  network error ({exc}); retrying...")
            time.sleep(2 ** attempt)
            continue

        if resp.status_code == 200:
            time.sleep(REQUEST_PAUSE_S)
            return resp.json()
        if resp.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 ** (attempt + 1))
            continue
        resp.raise_for_status()

    raise RuntimeError(f"VBB request failed after {retries} attempts: {path} {clean}")


def _location_params(prefix, location):
    """
    Turns a location into VBB query params.
    location is either a VBB stop id (str) or a (lat, lng) tuple.
    """
    if isinstance(location, str):
        return {prefix: location}
    lat, lng = location
    return {
        f"{prefix}.latitude": lat,
        f"{prefix}.longitude": lng,
        f"{prefix}.address": "Custom location",
    }


def _parse_time(value):
    return datetime.fromisoformat(value) if value else None


# ── Function 1: arrival time ──────────────────────────────────────────────────

def next_weekday_arrival(hour=ARRIVAL_HOUR, minute=0, weekday=1):
    """
    Returns the next given weekday (0=Mon, 1=Tue, ...) at hour:minute, Berlin time.
    Defaults to next Tuesday 09:00 — a "normal" working day for the demo.

    Note: public holidays are not checked; pass an explicit datetime if needed.
    """
    now = datetime.now(TIMEZONE)
    days_ahead = (weekday - now.weekday()) % 7 or 7
    day = now + timedelta(days=days_ahead)
    return day.replace(hour=hour, minute=minute, second=0, microsecond=0)


# ── Function 2: stop lookup ───────────────────────────────────────────────────

def resolve_stop(query):
    """
    Looks up a VBB stop by name, e.g. resolve_stop("Alexanderplatz").

    Returns {"id", "name", "lat", "lng"} or None if nothing matches.
    Useful to verify ALEXANDERPLATZ_ID or to pick a different destination.
    """
    results = _vbb_get("/locations", {
        "query": query, "results": 1,
        "stops": True, "addresses": False, "poi": False,
    })
    if not results:
        return None
    stop = results[0]
    loc = stop.get("location") or {}
    return {
        "id": stop["id"],
        "name": stop.get("name"),
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
    }


# ── Function 3: journey planning ──────────────────────────────────────────────

def _normalize_leg(leg):
    """Converts one raw VBB leg into the tool's flat leg schema."""
    walking = bool(leg.get("walking"))
    line = leg.get("line") or {}
    origin = leg.get("origin") or {}
    destination = leg.get("destination") or {}
    dep = _parse_time(leg.get("departure") or leg.get("plannedDeparture"))
    arr = _parse_time(leg.get("arrival") or leg.get("plannedArrival"))

    coords = []
    polyline = leg.get("polyline")
    if polyline:
        for feature in polyline.get("features", []):
            lng, lat = feature["geometry"]["coordinates"][:2]
            coords.append([lat, lng])

    return {
        "mode": "walking" if walking else line.get("product", "unknown"),
        "line": None if walking else line.get("name"),
        "from": origin.get("name") or origin.get("address"),
        "to": destination.get("name") or destination.get("address"),
        "departure": dep.isoformat() if dep else None,
        "arrival": arr.isoformat() if arr else None,
        "duration_min": round((arr - dep).total_seconds() / 60, 1) if dep and arr else None,
        "distance_m": leg.get("distance"),   # VBB only provides this for walking legs
        "coordinates": coords,               # [[lat, lng], ...], only if include_route=True
    }


def get_journey(origin, destination=ALEXANDERPLATZ_ID, arrival=None, include_route=False):
    """
    Returns the best public-transport journey that arrives by `arrival`.

    Parameters
    ----------
    origin, destination : str | (lat, lng)
        A VBB stop id (e.g. "900100003") or a coordinate tuple. With coordinates,
        VBB adds the walking legs to/from the nearest stops automatically.
    arrival : datetime, optional
        Latest acceptable arrival (timezone-aware). Defaults to next weekday 09:00.
    include_route : bool
        If True, each leg includes its route shape as [[lat, lng], ...] for maps.

    Returns
    -------
    dict or None (if no journey found):
        {
          "duration_min": float,   # first departure -> final arrival
          "departure": iso str,
          "arrival": iso str,
          "transfers": int,
          "legs": [ {mode, line, from, to, departure, arrival,
                     duration_min, distance_m, coordinates}, ... ]
        }

    "Best" = the shortest journey among those arriving on time.
    """
    arrival = arrival or next_weekday_arrival()

    params = {
        **_location_params("from", origin),
        **_location_params("to", destination),
        "arrival": arrival.isoformat(),
        "results": 3,
        "stopovers": False,
        "remarks": False,
        "polylines": include_route,
    }
    data = _vbb_get("/journeys", params)

    best = None
    for journey in data.get("journeys", []):
        legs = [_normalize_leg(leg) for leg in journey.get("legs", [])]
        if not legs:
            continue
        dep = _parse_time(legs[0]["departure"])
        arr = _parse_time(legs[-1]["arrival"])
        if dep is None or arr is None or arr > arrival:
            continue

        duration = (arr - dep).total_seconds() / 60
        if best is None or duration < best["duration_min"]:
            vehicle_legs = [leg for leg in legs if leg["mode"] != "walking"]
            best = {
                "duration_min": round(duration, 1),
                "departure": dep.isoformat(),
                "arrival": arr.isoformat(),
                "transfers": max(0, len(vehicle_legs) - 1),
                "legs": legs,
            }

    return best


def check_commute(lat, lng, max_commute_min=MAX_COMMUTE_MIN, arrival=None):
    """
    Point check for the concierge: "Can I commute from this exact spot?"

    Uses the VBB journey from the coordinates (walking + any public transport).
    Returns the journey dict from get_journey plus "within_limit": bool,
    or None if VBB finds no journey.
    """
    journey = get_journey((lat, lng), arrival=arrival, include_route=True)
    if journey is None:
        return None
    journey["within_limit"] = journey["duration_min"] <= max_commute_min
    return journey


# ── Function 4: Brandenburg stations ──────────────────────────────────────────

def get_brandenburg_boundary(cache_dir=CACHE_DIR):
    """Returns the State of Brandenburg as a Shapely (Multi)Polygon in EPSG:4326 (cached)."""
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, "brandenburg_boundary.gpkg")

    if os.path.exists(path):
        return gpd.read_file(path).geometry.iloc[0]

    print("Downloading Brandenburg boundary from OpenStreetMap...")
    gdf = ox.geocode_to_gdf(BRANDENBURG_OSM_ID, by_osmid=True)
    gdf[["geometry"]].to_file(path, driver="GPKG")
    return gdf.geometry.iloc[0]


def get_brandenburg_stations(cache_dir=CACHE_DIR, refresh=False):
    """
    Returns every train station in Brandenburg (Berlin excluded) as a DataFrame:
        station_id (VBB id), name, lat, lng, products (e.g. "regional,suburban")

    How: OSM gives the station locations (railway=station/halt); each one is
    matched to its VBB stop via /stops/nearby, keeping only stops served by
    TRAIN_PRODUCTS. Cached as CSV — the first run takes a few minutes.
    """
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, "brandenburg_stations.csv")

    if os.path.exists(path) and not refresh:
        return pd.read_csv(path, dtype={"station_id": str})

    boundary = get_brandenburg_boundary(cache_dir)

    print("Downloading railway stations in Brandenburg from OpenStreetMap...")
    osm = ox.features_from_polygon(boundary, tags={"railway": ["station", "halt"]})
    points = osm.geometry.representative_point()
    points = points[points.within(boundary)]
    print(f"  {len(points)} OSM station candidates. Matching to VBB stops...")

    rows, seen = [], set()
    for i, pt in enumerate(points, start=1):
        if i % 50 == 0:
            print(f"  [{i}/{len(points)}]")
        nearby = _vbb_get("/stops/nearby", {
            "latitude": pt.y, "longitude": pt.x, "distance": 400, "results": 5,
        })
        for stop in nearby:
            products = stop.get("products") or {}
            train = [p for p in TRAIN_PRODUCTS if products.get(p)]
            if not train:
                continue
            loc = stop.get("location") or {}
            lat, lng = loc.get("latitude"), loc.get("longitude")
            if stop["id"] not in seen and lat is not None and boundary.contains(Point(lng, lat)):
                seen.add(stop["id"])
                rows.append({
                    "station_id": stop["id"],
                    "name": stop.get("name"),
                    "lat": lat,
                    "lng": lng,
                    "products": ",".join(train),
                })
            break  # nearest train stop only

    stations = pd.DataFrame(rows)
    stations.to_csv(path, index=False)
    print(f"--- Saved {len(stations)} Brandenburg train stations to '{path}' ---")
    return stations


# ── Function 5: train time per station ────────────────────────────────────────

def precompute_station_times(stations, destination=ALEXANDERPLATZ_ID, arrival=None,
                             cache_dir=CACHE_DIR, refresh=False):
    """
    For each station, fetches the best journey to `destination` arriving by `arrival`.

    Returns `stations` plus the columns:
        train_minutes, departure, arrival, transfers, lines
    (train_minutes is NaN when VBB finds no on-time journey.)

    Cached per arrival time, e.g. station_times_20261006_0900.csv. Only a new
    arrival time (Y) or destination triggers new API calls.
    """
    arrival = arrival or next_weekday_arrival()
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"station_times_{destination}_{arrival:%Y%m%d_%H%M}.csv")

    if os.path.exists(path) and not refresh:
        print(f"--- Cache hit: station times loaded from '{path}' ---")
        return pd.read_csv(path, dtype={"station_id": str})

    print(f"Computing journeys for {len(stations)} stations (arrive by {arrival:%a %d %b %H:%M})...")
    records = []
    for i, row in enumerate(stations.itertuples(index=False), start=1):
        record = row._asdict()
        try:
            journey = get_journey(row.station_id, destination, arrival)
        except Exception as exc:  # one failing station must not stop the batch
            print(f"  [{i}/{len(stations)}] {row.name}: error {exc}")
            journey = None

        if journey:
            record.update({
                "train_minutes": journey["duration_min"],
                "departure": journey["departure"],
                "arrival": journey["arrival"],
                "transfers": journey["transfers"],
                "lines": " -> ".join(l["line"] for l in journey["legs"] if l["line"]),
            })
        else:
            record.update({"train_minutes": float("nan"), "departure": None,
                           "arrival": None, "transfers": None, "lines": None})
        records.append(record)

        if i % 25 == 0:
            print(f"  [{i}/{len(stations)}]")

    result = pd.DataFrame(records)
    result.to_csv(path, index=False)
    print(f"--- Saved station times to '{path}' ---")
    return result


# ── Function 6: walking area around a station ─────────────────────────────────

def _load_station_graph(station_id, lat, lng, max_walk_min=MAX_WALK_MIN, cache_dir=CACHE_DIR):
    """
    Loads (or downloads) the walking street network around one station.
    The radius always covers max_walk_min, so the cached graph works for any
    shorter walk too.
    """
    graph_dir = os.path.join(cache_dir, "walk_graphs")
    os.makedirs(graph_dir, exist_ok=True)
    path = os.path.join(graph_dir, f"{station_id}.graphml")

    if os.path.exists(path):
        return ox.load_graphml(path)

    radius_m = max_walk_min * WALKING_SPEED_MPM + 300
    try:
        graph = ox.graph_from_point((lat, lng), dist=radius_m, dist_type="bbox", network_type="walk")
    except Exception as exc:
        print(f"  No walking network around station {station_id}: {exc}")
        return None
    ox.save_graphml(graph, filepath=path)
    return graph


def station_walk_area(station_id, lat, lng, walk_minutes,
                      walking_speed=WALKING_SPEED_MPM, edge_buffer_m=EDGE_BUFFER_M,
                      cache_dir=CACHE_DIR):
    """
    Returns the area (Shapely polygon, EPSG:4326) from which the station can be
    reached on foot within `walk_minutes`, following real streets and paths.

    The polygon is built by buffering every reachable street segment, so it
    follows the street network and does not spill over lakes or fields.
    Returns None if no walking network is available.
    """
    if walk_minutes <= 0:
        return None

    graph = _load_station_graph(station_id, lat, lng, cache_dir=cache_dir)
    if graph is None:
        return None

    walk_m = walk_minutes * walking_speed
    source = ox.nearest_nodes(graph, lng, lat)
    reachable = nx.single_source_dijkstra_path_length(
        graph.to_undirected(), source, cutoff=walk_m, weight="length"
    )

    sub = graph.subgraph(reachable.keys()).copy()
    if sub.number_of_edges() == 0:
        return None

    edges = ox.graph_to_gdfs(sub, nodes=False)
    utm_crs = edges.estimate_utm_crs()
    edges_m = edges.to_crs(utm_crs)
    station_m = gpd.GeoSeries([Point(lng, lat)], crs="EPSG:4326").to_crs(utm_crs).iloc[0]

    area_m = unary_union(list(edges_m.buffer(edge_buffer_m)) + [station_m.buffer(edge_buffer_m * 2)])
    return gpd.GeoSeries([area_m], crs=utm_crs).to_crs("EPSG:4326").iloc[0]


# ── Function 7: the commute area ──────────────────────────────────────────────

def build_commute_area(station_times, max_commute_min=MAX_COMMUTE_MIN,
                       max_walk_min=MAX_WALK_MIN, boundary=None, cache_dir=CACHE_DIR):
    """
    Combines train times and walking areas into the final commute area.

    Rule per station:  walk_minutes = min(max_walk_min, max_commute_min - train_minutes)
    Stations with train_minutes >= max_commute_min are skipped.

    Parameters
    ----------
    station_times : DataFrame from precompute_station_times
    boundary      : optional polygon to clip to (e.g. get_brandenburg_boundary())

    Returns
    -------
    station_areas : GeoDataFrame, one row per contributing station with
                    station_id, name, train_minutes, walk_minutes, geometry
    commute_area  : Shapely (Multi)Polygon — union of all station areas, or None
    """
    reachable = station_times.dropna(subset=["train_minutes"])
    reachable = reachable[reachable["train_minutes"] < max_commute_min]
    print(f"{len(reachable)} stations reach the destination in < {max_commute_min} min by train.")

    records = []
    for row in reachable.itertuples(index=False):
        walk_minutes = min(max_walk_min, max_commute_min - row.train_minutes)
        area = station_walk_area(row.station_id, row.lat, row.lng, walk_minutes, cache_dir=cache_dir)
        if area is None or area.is_empty:
            continue
        if boundary is not None:
            area = area.intersection(boundary)
            if area.is_empty:
                continue
        records.append({
            "station_id": row.station_id,
            "name": row.name,
            "train_minutes": row.train_minutes,
            "walk_minutes": round(walk_minutes, 1),
            "geometry": area,
        })

    columns = ["station_id", "name", "train_minutes", "walk_minutes", "geometry"]
    station_areas = gpd.GeoDataFrame(records, columns=columns, geometry="geometry", crs="EPSG:4326")
    commute_area = unary_union(station_areas.geometry.tolist()) if records else None
    return station_areas, commute_area


# ── Function 8: export for the web app ────────────────────────────────────────

def export_geojson(station_areas, commute_area, max_commute_min=MAX_COMMUTE_MIN,
                   arrival=None, out_dir=CACHE_DIR):
    """
    Writes two GeoJSON files that any web map (Mapbox, Leaflet, deck.gl) can load:
        commute_area_<X>min.geojson    — one merged polygon
        station_areas_<X>min.geojson   — one polygon per station, with train/walk minutes

    Returns the two file paths.
    """
    os.makedirs(out_dir, exist_ok=True)
    area_path = os.path.join(out_dir, f"commute_area_{max_commute_min}min.geojson")
    stations_path = os.path.join(out_dir, f"station_areas_{max_commute_min}min.geojson")

    if commute_area is not None:
        gpd.GeoDataFrame(
            {"max_commute_min": [max_commute_min],
             "arrival": [arrival.isoformat() if arrival else None]},
            geometry=[commute_area], crs="EPSG:4326",
        ).to_file(area_path, driver="GeoJSON")

    if len(station_areas):
        station_areas.to_file(stations_path, driver="GeoJSON")

    return area_path, stations_path


# ── Function 9: preview map ───────────────────────────────────────────────────

def _polygon_to_latlon(geom):
    """Flattens a (Multi)Polygon into lat/lon lists with None gaps for Plotly."""
    lats, lons = [], []
    parts = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
    for part in parts:
        if part.geom_type != "Polygon":
            continue
        for lon, lat in part.exterior.coords:
            lons.append(lon)
            lats.append(lat)
        lons.append(None)
        lats.append(None)
    return lats, lons


def plot_commute_area(commute_area, station_times, max_commute_min=MAX_COMMUTE_MIN,
                      destination_latlng=ALEXANDERPLATZ_LATLNG):
    """
    Returns a Plotly map for quick visual checks:
      - shaded commute area
      - stations coloured by train time (grey = too far)
      - destination marker
    """
    fig = go.Figure()

    if commute_area is not None and not commute_area.is_empty:
        lats, lons = _polygon_to_latlon(commute_area)
        fig.add_trace(go.Scattermap(
            lat=lats, lon=lons, mode="lines", fill="toself",
            fillcolor="rgba(46,213,115,0.35)", line=dict(width=1, color="rgba(46,213,115,0.9)"),
            name=f"Commute ≤ {max_commute_min} min", hoverinfo="name", connectgaps=False,
        ))

    timed = station_times.dropna(subset=["train_minutes"])
    in_range = timed[timed["train_minutes"] < max_commute_min]
    out_range = station_times.drop(in_range.index)

    fig.add_trace(go.Scattermap(
        lat=out_range["lat"], lon=out_range["lng"], mode="markers",
        marker=dict(size=6, color="rgba(128,128,128,0.6)"),
        text=out_range["name"], hoverinfo="text", name="Station (too far)",
    ))
    fig.add_trace(go.Scattermap(
        lat=in_range["lat"], lon=in_range["lng"], mode="markers",
        marker=dict(size=9, color=in_range["train_minutes"], colorscale="Viridis",
                    colorbar=dict(title="Train min")),
        text=[f"<b>{n}</b><br>{t:.0f} min by train" for n, t in
              zip(in_range["name"], in_range["train_minutes"])],
        hoverinfo="text", name="Station (in range)",
    ))
    fig.add_trace(go.Scattermap(
        lat=[destination_latlng[0]], lon=[destination_latlng[1]], mode="markers",
        marker=dict(size=14, color="rgb(231,76,60)"),
        text=["Alexanderplatz"], hoverinfo="text", name="Destination",
    ))

    fig.update_layout(
        map=dict(style="light", center=dict(lat=52.45, lon=13.4), zoom=7.5),
        margin={"r": 0, "t": 0, "l": 0, "b": 0},
        showlegend=True,
    )
    return fig


# ── End-to-end demo ───────────────────────────────────────────────────────────

def run_demo(max_commute_min=MAX_COMMUTE_MIN, max_walk_min=MAX_WALK_MIN, arrival=None):
    """
    Runs the full pipeline with the demo defaults:
    Brandenburg stations -> Alexanderplatz, arrive by next weekday 09:00, <= 45 min.

    Returns a dict with the station table, station areas, commute area,
    GeoJSON paths and the Plotly figure.
    """
    arrival = arrival or next_weekday_arrival()

    stations = get_brandenburg_stations()
    station_times = precompute_station_times(stations, ALEXANDERPLATZ_ID, arrival)
    boundary = get_brandenburg_boundary()
    station_areas, commute_area = build_commute_area(
        station_times, max_commute_min, max_walk_min, boundary=boundary
    )
    geojson_paths = export_geojson(station_areas, commute_area, max_commute_min, arrival)
    fig = plot_commute_area(commute_area, station_times, max_commute_min)

    return {
        "arrival": arrival,
        "station_times": station_times,
        "station_areas": station_areas,
        "commute_area": commute_area,
        "geojson_paths": geojson_paths,
        "figure": fig,
    }


if __name__ == "__main__":
    result = run_demo()
    html_path = os.path.join(CACHE_DIR, "commute_area_preview.html")
    result["figure"].write_html(html_path)
    print(f"Preview map written to '{html_path}'.")
