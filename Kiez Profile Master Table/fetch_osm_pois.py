"""
Pull POI counts (yoga studios, Kinderarzt practices, etc.) from the Overpass
API and aggregate them to PLZ.

Many OSM POIs do carry a real addr:postcode — we use that when present. For
the rest, we fall back to the nearest-PLZ-centroid join build_kiez_profile.py
already uses for rentals/secondary_sales/transit_stations.

Usage:
    python3 fetch_osm_pois.py
Produces:
    osm_pois_raw.csv          (every fetched POI, unaggregated: category, osm
                                id/type, lat, lon, name, osm_postcode — reuse
                                this for any other geography's join instead of
                                re-hitting Overpass, e.g. Planungsraum grain)
    osm_poi_counts_by_plz.csv (plz, n_yoga_studios, n_kinderarzt, ...)
Merge the PLZ file into kiez_profile_by_plz.csv the same way
build_kiez_profile.py merges kita_agg / schools_agg (pd.merge on "plz",
how="left", then fillna(0) on the count columns).
"""
import time
import urllib.parse
import requests
import pandas as pd
from scipy.spatial import cKDTree

MASTER_TABLE = "kiez_profile_by_plz.csv"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "kiez-research/1.0"}

# Berlin bounding box (south, west, north, east) — a rough box is fine, we
# filter to real PLZ coverage via the nearest-centroid join afterward.
BERLIN_BBOX = (52.33, 13.09, 52.68, 13.76)

# One or more Overpass queries per POI category. `nwr` = node/way/relation,
# catches POIs mapped as points, buildings, or areas. `out center;` collapses
# ways/relations to a representative point so every result is lat/lon.
#
# Each query is kept to a single filter clause, not an Overpass union (...);
# — a union of two nwr clauses reliably timed out through this environment's
# proxy/gateway path even though each clause alone runs fine. Categories that
# need multiple filters (like paediatrician tagging variants) run as separate
# requests here and get merged + deduped in Python instead.
QUERIES = {
    "n_yoga_studios": [
        """[out:json][timeout:60];
        nwr["sport"="yoga"]({bbox});
        out center;""",
    ],
    "n_kinderarzt": [
        """[out:json][timeout:60];
        nwr["amenity"="doctors"]["healthcare:speciality"~"paediatric|child_health"]({bbox});
        out center;""",
        """[out:json][timeout:60];
        nwr["amenity"="doctors"]["healthcare:speciality"~"pädiatrie|kinder",i]({bbox});
        out center;""",
    ],
    # gym: standard OSM tag for fitness studios/gyms
    "n_gym": [
        """[out:json][timeout:60];
        nwr["leisure"="fitness_centre"]({bbox});
        out center;""",
    ],
    # bouldering: dedicated boulder gyms (climbing=boulder) plus general
    # climbing gyms (sport=climbing at a sports centre) — two clauses,
    # same reason as the Kinderarzt regex split: a union times out here,
    # separate requests don't.
    "n_bouldering": [
        """[out:json][timeout:60];
        nwr["climbing"="boulder"]({bbox});
        out center;""",
        """[out:json][timeout:60];
        nwr["sport"="climbing"]["leisure"="sports_centre"]({bbox});
        out center;""",
    ],
}


def fetch_pois(query_template: str, retries: int = 8) -> pd.DataFrame:
    bbox_str = ",".join(str(v) for v in BERLIN_BBOX)
    query = query_template.format(bbox=bbox_str)
    # GET with the query as a URL param, not POST — POST bodies get reset by
    # some proxies in front of this API; GET works reliably.
    url = OVERPASS_URL + "?data=" + urllib.parse.quote(query)

    # The public Overpass instance (and some proxy paths to it) drop
    # connections intermittently — retry with backoff rather than fail once.
    last_exc = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=90)
            if resp.status_code in (429, 502, 503, 504):
                raise requests.exceptions.HTTPError(f"{resp.status_code} from Overpass", response=resp)
            resp.raise_for_status()
            elements = resp.json()["elements"]
            break
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                requests.exceptions.HTTPError) as exc:
            last_exc = exc
            wait = min(2 ** (attempt + 1), 30)
            print(f"  retry {attempt + 1}/{retries} after {type(exc).__name__} ({exc}), waiting {wait}s")
            time.sleep(wait)
    else:
        raise RuntimeError(f"Overpass request failed after {retries} attempts") from last_exc

    rows = []
    for el in elements:
        if el["type"] == "node":
            lat, lon = el["lat"], el["lon"]
        else:  # way/relation -> use the "center" Overpass computed
            center = el.get("center")
            if not center:
                continue
            lat, lon = center["lat"], center["lon"]
        tags = el.get("tags", {})
        rows.append({
            "osm_type": el["type"], "osm_id": el["id"],
            "lat": lat, "lon": lon, "name": tags.get("name"),
            "osm_postcode": tags.get("addr:postcode"),
        })
    return pd.DataFrame(rows)


def fetch_all_categories() -> pd.DataFrame:
    """Fetch + dedupe every category in QUERIES, tagged with a 'category'
    column (e.g. 'n_yoga_studios'). Grain-independent — no PLZ/Planungsraum
    join happens here, so this result can be reused for any geography."""
    parts = []
    for count_col, query_templates in QUERIES.items():
        cat_parts = []
        for query_template in query_templates:
            cat_parts.append(fetch_pois(query_template))
            time.sleep(2)  # be polite to the public Overpass instance between requests
        pois = pd.concat(cat_parts, ignore_index=True).drop_duplicates(subset=["osm_type", "osm_id"])
        pois["category"] = count_col
        print(f"[{count_col}] fetched {len(pois)} unique POIs from Overpass "
              f"({len(query_templates)} request(s))")
        parts.append(pois)
        time.sleep(2)
    return pd.concat(parts, ignore_index=True)


def join_to_plz(raw_pois: pd.DataFrame) -> pd.DataFrame:
    plz_base = pd.read_csv(MASTER_TABLE, dtype={"plz": str})[["plz", "lat", "lon"]].dropna()
    plz_tree = cKDTree(plz_base[["lon", "lat"]].values)
    plz_list = plz_base["plz"].values
    valid_plz = set(plz_base["plz"])

    out = plz_base[["plz"]].copy()

    for count_col in QUERIES:
        pois = raw_pois[raw_pois["category"] == count_col].copy()

        if len(pois):
            # Prefer the POI's own addr:postcode when it's a real Berlin PLZ;
            # fall back to nearest-centroid join for everything else.
            has_real_plz = pois["osm_postcode"].isin(valid_plz)
            pois["plz"] = pois["osm_postcode"].where(has_real_plz)

            missing = pois["plz"].isna()
            if missing.any():
                _, idx = plz_tree.query(pois.loc[missing, ["lon", "lat"]].values, k=1)
                pois.loc[missing, "plz"] = plz_list[idx]
            print(f"  -> {has_real_plz.sum()} used real addr:postcode, "
                  f"{missing.sum()} used nearest-centroid fallback")

            agg = pois.groupby("plz").size().rename(count_col).reset_index()
            out = out.merge(agg, on="plz", how="left")
        else:
            out[count_col] = 0

        out[count_col] = out[count_col].fillna(0).astype(int)

    return out


def main():
    raw_pois = fetch_all_categories()
    raw_pois.to_csv("osm_pois_raw.csv", index=False)
    print(f"\nSaved osm_pois_raw.csv: {raw_pois.shape}")

    out = join_to_plz(raw_pois)
    out.to_csv("osm_poi_counts_by_plz.csv", index=False)
    print(f"\nSaved osm_poi_counts_by_plz.csv: {out.shape}")
    print(out.sum(numeric_only=True))


if __name__ == "__main__":
    main()
