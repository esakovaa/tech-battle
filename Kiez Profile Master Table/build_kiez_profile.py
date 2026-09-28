import pandas as pd
import numpy as np
from scipy.spatial import cKDTree
import json
import urllib.request
import time

SRC = "/Users/annaesakova/Hackahon26/DATA  SOURCES"

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
schools["PLZ"] = schools["PLZ"].astype(str).str.zfill(5)
schools["Schulplätze nach Baumaßnahme"] = pd.to_numeric(schools["Schulplätze nach Baumaßnahme"], errors="coerce")
schools_agg = schools.groupby("PLZ").agg(
    n_school_construction_projects=("BSO-Tranche", "count"),
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
