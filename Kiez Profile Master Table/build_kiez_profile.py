import pandas as pd
import numpy as np
from scipy.spatial import cKDTree
import json
import urllib.request
import time

SRC = "/Users/annaesakova/Hackahon26/DATA  SOURCES"
out_path_placeholder = "/Users/annaesakova/Hackahon26/Kiez Profile Master Table"

# =================================================================
# 1. PLZ master index + centroids, from Wohnlage (real, address-level)
# =================================================================
wohn = pd.read_csv(f"{SRC}/all 400k houses in Berlin/wohnlagen_2026.csv", dtype={"plz": str})
wohn = wohn.dropna(subset=["plz"])
wohn["plz"] = wohn["plz"].str.zfill(5)

def mode_or_first(s):
    m = s.mode()
    return m.iloc[0] if len(m) else np.nan

plz_base = wohn.groupby("plz").agg(
    lat=("lat", "mean"),
    lon=("lon", "mean"),
    n_addresses=("schluessel", "count"),
    bezirk=("bezname", mode_or_first),
).reset_index()

wol_pct = wohn.groupby("plz")["wol"].value_counts(normalize=True).unstack(fill_value=0) * 100
wol_pct.columns = [f"pct_wohnlage_{c}" for c in wol_pct.columns]
wol_pct["dominant_wohnlage"] = wohn.groupby("plz")["wol"].agg(mode_or_first)

plz_base = plz_base.merge(wol_pct.reset_index(), on="plz", how="left")
print(f"[1] PLZ master index: {len(plz_base)} Berlin postal codes")

plz_tree = cKDTree(plz_base[["lon", "lat"]].values)
plz_list = plz_base["plz"].values

def nearest_plz(lons, lats):
    _, idx = plz_tree.query(np.column_stack([lons, lats]), k=1)
    return plz_list[idx]

# =================================================================
# 2. Kitas — real, direct PLZ
# =================================================================
kita = pd.read_csv(f"{SRC}/Kita Standorte (WFS)/kitas_wfs.csv", dtype={"e_plz": str})
kita["e_plz"] = kita["e_plz"].str.zfill(5)
kita_agg = kita.groupby("e_plz").agg(
    n_kitas=("e_nr", "count"),
    total_kita_capacity=("e_platz", "sum"),
).reset_index().rename(columns={"e_plz": "plz"})
print(f"[2] Kitas aggregated: {kita_agg['n_kitas'].sum()} total across {len(kita_agg)} PLZ")

# =================================================================
# 3. Schools (construction/expansion projects) — real, direct PLZ
# =================================================================
schools = pd.read_excel(f"{SRC}/schulbaumassnahmen-2026.xlsx", sheet_name="Schulen", dtype={"PLZ": str})
schools["Schulplätze nach Baumaßnahme"] = pd.to_numeric(schools["Schulplätze nach Baumaßnahme"], errors="coerce")
# One school (09K07) has two campus PLZs in one field ("12435, 12437") — take the
# first as primary; its second campus won't independently appear in the PLZ join.
schools["PLZ"] = schools["PLZ"].astype(str).str.split(",").str[0].str.strip().str.zfill(5)
schools_agg = schools.groupby("PLZ").agg(
    # count on "Adresse", not "BSO-Tranche" (17% null -> undercounts real project rows)
    n_school_construction_projects=("Adresse", "count"),
    n_unique_schools_with_projects=("Berliner Schulnummer", "nunique"),
    total_planned_school_capacity=("Schulplätze nach Baumaßnahme", "max"),
).reset_index().rename(columns={"PLZ": "plz"})
print(f"[3] School projects aggregated: {schools_agg['n_unique_schools_with_projects'].sum()} unique schools across {len(schools_agg)} PLZ")

# =================================================================
# 4. Crime — real, Bezirk-level only -> inherited per PLZ's dominant Bezirk
# =================================================================
crime = pd.read_csv(f"{SRC}/Berlin_crimes.csv")
crime_cols = ['Robbery','Street_robbery','Injury','Agg_assault','Threat','Theft','Car',
              'From_car','Bike','Burglary','Fire','Arson','Damage','Graffiti','Drugs']
crime["total_crime"] = crime[crime_cols].sum(axis=1)
crime_recent = crime[crime.Year >= 2017]
crime_bez = crime_recent.groupby("District").agg(
    crime_total_avg_2017_2019=("total_crime", lambda s: s.groupby(crime_recent.loc[s.index, "Year"]).sum().mean()),
).reset_index()
# simpler robust version: sum per year per district, then mean across years
tmp = crime_recent.groupby(["District", "Year"])["total_crime"].sum().reset_index()
crime_bez = tmp.groupby("District")["total_crime"].mean().reset_index().rename(
    columns={"District": "bezirk", "total_crime": "crime_total_avg_2017_2019"})
print(f"[4] Crime aggregated to {len(crime_bez)} Bezirke (2017-2019 avg, Bezirk-level only — NOT PLZ-precise)")

# =================================================================
# 5. Air quality — geocode 15 stations, nearest-station join
# =================================================================
air = pd.read_csv(f"{SRC}/berlin_air_quality_feb_2026_kaggle.csv")
stations = sorted(air.station_name.unique())

def geocode_nominatim(name):
    url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(name + ', Berlin, Germany')}&format=json&limit=1"
    req = urllib.request.Request(url, headers={"User-Agent": "hackathon-kiez-concierge/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    if data:
        return float(data[0]["lat"]), float(data[0]["lon"])
    return None, None

import urllib.parse
station_coords = {}
for s in stations:
    lat, lon = geocode_nominatim(s)
    station_coords[s] = (lat, lon)
    time.sleep(1.1)  # Nominatim usage policy: max 1 req/sec

station_df = pd.DataFrame([{"station_name": k, "lat": v[0], "lon": v[1]} for k, v in station_coords.items()]).dropna()
print(f"[5a] Geocoded {len(station_df)}/{len(stations)} air quality stations")

air_wide = air.pivot_table(index="station_name", columns="pollutant", values="value", aggfunc="mean").reset_index()
air_wide.columns = ["station_name"] + [f"air_{c.lower().replace('.', '')}_avg" for c in air_wide.columns[1:]]
air_wide = air_wide.merge(station_df, on="station_name", how="inner")

station_tree = cKDTree(air_wide[["lon", "lat"]].values)
dist, idx = station_tree.query(plz_base[["lon", "lat"]].values, k=1)
plz_air = plz_base[["plz"]].copy()
plz_air["nearest_air_station"] = air_wide["station_name"].values[idx]
plz_air["air_station_distance_km"] = dist * 111  # rough deg->km
for col in [c for c in air_wide.columns if c.startswith("air_")]:
    plz_air[col] = air_wide[col].values[idx]
print(f"[5b] Air quality projected onto all {len(plz_air)} PLZ via nearest-station join")

# =================================================================
# 6. Rentals (synthetic) — nearest-PLZ-centroid spatial join
# =================================================================
rent = pd.read_csv(f"{SRC}/Berlin Real Estate Sales Rentals 2020-2026/rentals.csv")
rent["plz"] = nearest_plz(rent["lon"].values, rent["lat"].values)
rent_agg = rent.groupby("plz").agg(
    rent_per_m2_kalt_avg_synthetic=("rent_per_m2_kalt_eur", "mean"),
    n_rental_listings_synthetic=("id", "count"),
).reset_index()
print(f"[6] Rentals (synthetic, spatially joined): {len(rent_agg)} PLZ covered")

# =================================================================
# 7. Buy prices — REAL (dataset2, direct PLZ) + synthetic (spatial join) side by side
# =================================================================
ext = pd.read_csv(f"{SRC}/Real Estate Listings Berlin (DE) April 2023/real_estate_listings_clean.csv")
ext["plz"] = ext["zipcode"].dropna().astype(int).astype(str).str.zfill(5)
ext_agg = ext.groupby("plz").agg(
    buy_price_per_m2_avg_REAL=("price_per_area", "mean"),
    n_real_listings=("price_per_area", "count"),
).reset_index()

sec = pd.read_csv(f"{SRC}/Berlin Real Estate Sales Rentals 2020-2026/secondary_sales.csv")
sec["plz"] = nearest_plz(sec["lon"].values, sec["lat"].values)
sec_agg = sec.groupby("plz").agg(
    buy_price_per_m2_avg_synthetic=("price_per_m2_eur", "mean"),
    n_synthetic_sales_listings=("id", "count"),
).reset_index()
print(f"[7] Buy prices: {len(ext_agg)} PLZ with REAL data, {len(sec_agg)} PLZ with synthetic (spatial join)")

# =================================================================
# 8. New construction (synthetic) — spatial join
# =================================================================
newc = pd.read_csv(f"{SRC}/Berlin Real Estate Sales Rentals 2020-2026/new_construction.csv")
newc["plz"] = nearest_plz(newc["lon"].values, newc["lat"].values)
newc_agg = newc.groupby("plz").agg(
    new_construction_price_per_m2_avg=("price_per_m2_eur", "mean"),
    n_new_construction_listings=("id", "count"),
).reset_index()

# =================================================================
# 9. Transit — nearest station + distance, from PLZ centroid
# =================================================================
transit = pd.read_csv(f"{SRC}/Berlin Real Estate Sales Rentals 2020-2026/transit_stations.csv")
t_tree = cKDTree(transit[["lon", "lat"]].values)
dist, idx = t_tree.query(plz_base[["lon", "lat"]].values, k=1)
plz_transit = plz_base[["plz"]].copy()
plz_transit["nearest_transit_station"] = transit["station_name"].values[idx]
plz_transit["nearest_transit_line"] = transit["line"].values[idx]
plz_transit["transit_distance_km"] = dist * 111

# =================================================================
# ASSEMBLE MASTER TABLE
# =================================================================
master = plz_base.merge(kita_agg, on="plz", how="left")
master = master.merge(schools_agg, on="plz", how="left")
master = master.merge(crime_bez, on="bezirk", how="left")
master = master.merge(plz_air.drop(columns=["plz"]).assign(plz=plz_air["plz"]), on="plz", how="left")
master = master.merge(rent_agg, on="plz", how="left")
master = master.merge(ext_agg, on="plz", how="left")
master = master.merge(sec_agg, on="plz", how="left")
master = master.merge(newc_agg, on="plz", how="left")
master = master.merge(plz_transit.drop(columns=["plz"]).assign(plz=plz_transit["plz"]), on="plz", how="left")

# =================================================================
# 10. Abitur results — real, school-level, Bezirk-inherited (like crime)
# =================================================================
BEZIRK_BY_NR = {
    1: "Mitte", 2: "Friedrichshain-Kreuzberg", 3: "Pankow", 4: "Charlottenburg-Wilmersdorf",
    5: "Spandau", 6: "Steglitz-Zehlendorf", 7: "Tempelhof-Schöneberg", 8: "Neukölln",
    9: "Treptow-Köpenick", 10: "Marzahn-Hellersdorf", 11: "Lichtenberg", 12: "Reinickendorf",
}
SCHULFORM = {1: "berufliche Schulen", 2: "Gymnasien", 3: "ISS/Gemeinschaftsschulen",
             4: "privat", 5: "Kollegs/Abendgymnasien"}

abi = pd.read_excel(f"{SRC}/abitur-2025.xlsx", sheet_name="Schuldaten|Gesamt")
vgl = pd.read_excel(f"{SRC}/abitur-2025.xlsx", sheet_name="Vergleichsdaten|Gesamt")
vgl_by_form = vgl[vgl["Bezirksnummer"] == "-"].copy()
vgl_by_form = vgl_by_form[vgl_by_form["Schulform"] != "-"]
vgl_by_form["Schulform"] = vgl_by_form["Schulform"].astype(int)
vgl_map = dict(zip(vgl_by_form["Schulform"], vgl_by_form["mn.vgl"]))

abi["bezirk"] = abi["Bezirksnummer"].map(BEZIRK_BY_NR)
abi["schulform_name"] = abi["Schulform"].map(SCHULFORM)
abi["peer_benchmark_mn_vgl"] = abi["Schulform"].map(vgl_map)
# lower grade = better; positive = school beats its own school-type's state average
abi["performance_vs_peer"] = abi["peer_benchmark_mn_vgl"] - abi["mn.scls"]

# school-level PLZ crosswalk, where available (only ~34% coverage — see README)
sch_lookup = schools.dropna(subset=["Berliner Schulnummer"]).drop_duplicates("Berliner Schulnummer")
sch_lookup = sch_lookup.set_index("Berliner Schulnummer")[["Schulname", "PLZ"]]
abi = abi.join(sch_lookup, on="BSN")

# quartile tiers — computed on the real 185-school distribution, not arbitrary cutoffs
# raw: lower mn.scls = better grade, so quartiles are reversed for labeling
abi["tier_raw_grade"] = pd.qcut(abi["mn.scls"], 4, labels=["AMAZING", "GOOD", "OK", "BAD"])
abi["tier_vs_peer"] = pd.qcut(abi["performance_vs_peer"], 4, labels=["BAD", "OK", "GOOD", "AMAZING"])

abi_detail_cols = ["BSN", "Schulname", "PLZ", "bezirk", "schulform_name", "n", "n.best", "n.scls",
                    "mn.scls", "peer_benchmark_mn_vgl", "performance_vs_peer", "tier_raw_grade", "tier_vs_peer"]
abi[abi_detail_cols].to_csv(f"{out_path_placeholder}/abitur_by_school.csv", index=False)
print(f"[10a] Abitur school-level detail: {len(abi)} schools "
      f"({abi['PLZ'].notna().sum()} with a real PLZ via schulbaumassnahmen crosswalk)")

# Bezirk-level aggregate (weighted by n.scls), for the main master table — same
# methodology as crime: every PLZ in a Bezirk inherits the identical value.
def wavg(vals, weights):
    return np.average(vals, weights=weights)

abi_bez = abi.groupby("bezirk").apply(
    lambda d: pd.Series({
        "abitur_mn_scls_bezirk_avg": wavg(d["mn.scls"], d["n.scls"]),
        "abitur_performance_vs_peer_bezirk_avg": wavg(d["performance_vs_peer"], d["n.scls"]),
        "n_abitur_schools_in_bezirk": len(d),
    }), include_groups=False
).reset_index()
abi_bez["abitur_tier_bezirk"] = pd.qcut(
    abi_bez["abitur_mn_scls_bezirk_avg"], 4, labels=["AMAZING", "GOOD", "OK", "BAD"])
print(f"[10b] Abitur aggregated to {len(abi_bez)} Bezirke")

master = master.merge(abi_bez, on="bezirk", how="left")

# =================================================================
# 11. Umweltgerechtigkeit (environmental justice) — real, Planungsraum-level,
#     queried live via WMS GetFeatureInfo per PLZ centroid (no WFS/bulk export
#     exists for this dataset). ~193 point queries, one per PLZ.
# =================================================================
import urllib.parse

UG_WMS = "https://gdi.berlin.de/services/wms/ua_umweltgerechtigkeit2023"
UG_LAYERS = ["a_laerm2023", "b_luft2023", "c_gruen2023", "d_bioklima2023", "e_sozial2023",
             "f_mehrfach4_2023", "g_mehrfach5_2023", "z_gesamt_umwelt2023"]
UG_LABELS = {
    "a_laerm2023": "ug_laerm", "b_luft2023": "ug_luft", "c_gruen2023": "ug_gruenversorgung",
    "d_bioklima2023": "ug_thermisch", "e_sozial2023": "ug_soziale_benachteiligung",
    "f_mehrfach4_2023": "ug_mehrfachbelastung_umwelt",
    "g_mehrfach5_2023": "ug_mehrfachbelastung_umwelt_sozial",
    "z_gesamt_umwelt2023": "ug_gesamt_umweltgerechtigkeitskarte",
}

def ug_query_point(lat, lon, retries=3):
    d = 0.001
    params = {
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo",
        "LAYERS": ",".join(UG_LAYERS), "STYLES": "," * (len(UG_LAYERS) - 1),
        "QUERY_LAYERS": ",".join(UG_LAYERS), "CRS": "EPSG:4326",
        "BBOX": f"{lat-d},{lon-d},{lat+d},{lon+d}",
        "WIDTH": "101", "HEIGHT": "101", "I": "50", "J": "50",
        "INFO_FORMAT": "application/json", "FEATURE_COUNT": str(len(UG_LAYERS)),
    }
    url = UG_WMS + "?" + urllib.parse.urlencode(params)
    text = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "hackathon-kiez-concierge/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                text = resp.read().decode("utf-8")
            break
        except Exception:
            if attempt == retries - 1:
                return {}
            time.sleep(1)
    # response is multiple concatenated FeatureCollection JSON objects, not one
    # valid document -> decode them one at a time with raw_decode
    decoder = json.JSONDecoder()
    pos, result = 0, {}
    while pos < len(text):
        while pos < len(text) and text[pos] in " \t\r\n,":
            pos += 1
        if pos >= len(text):
            break
        try:
            obj, end = decoder.raw_decode(text, pos)
        except json.JSONDecodeError:
            break
        pos = end
        feats = obj.get("features", [])
        if feats:
            fid = feats[0].get("id", "")
            layer = fid.rsplit(".", 1)[0] if "." in fid else fid
            props = feats[0].get("properties", {})
            if layer in UG_LABELS:
                result[UG_LABELS[layer]] = list(props.values())[-1] if props else None
                result["ug_planungsraum_name"] = props.get("Planungsraum-Name")
                result["ug_planungsraum_nr"] = props.get("Planungsraum-Nummer")
    return result

ug_rows = []
for i, r in master[["plz", "lat", "lon"]].iterrows():
    res = ug_query_point(r["lat"], r["lon"])
    res["plz"] = r["plz"]
    ug_rows.append(res)
    time.sleep(0.15)
ug = pd.DataFrame(ug_rows)
ug_cols = ["plz", "ug_planungsraum_nr", "ug_planungsraum_name"] + list(UG_LABELS.values())
ug = ug[[c for c in ug_cols if c in ug.columns]]
ug.to_csv(f"{out_path_placeholder}/umweltgerechtigkeit_by_plz.csv", index=False)
print(f"[11] Umweltgerechtigkeit: {ug['ug_laerm'].notna().sum()}/{len(ug)} PLZ matched to a Planungsraum")

master = master.merge(ug, on="plz", how="left")

# fill count columns with 0 (no listings found there, not missing data)
for col in ["n_kitas", "total_kita_capacity", "n_school_construction_projects",
            "n_unique_schools_with_projects", "n_rental_listings_synthetic",
            "n_real_listings", "n_synthetic_sales_listings", "n_new_construction_listings"]:
    if col in master.columns:
        master[col] = master[col].fillna(0)

master = master.sort_values("plz").reset_index(drop=True)
print(f"\nFINAL MASTER TABLE: {master.shape}")
print(master.columns.tolist())

out_path = "/Users/annaesakova/Hackahon26/Kiez Profile Master Table"
import os
os.makedirs(out_path, exist_ok=True)
master.to_csv(f"{out_path}/kiez_profile_by_plz.csv", index=False)
print(f"\nSaved to {out_path}/kiez_profile_by_plz.csv")
