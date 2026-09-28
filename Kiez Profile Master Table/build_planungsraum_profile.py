import pandas as pd
import numpy as np
import geopandas as gpd
from shapely.geometry import Point
import urllib.request
import json

SRC = "/Users/annaesakova/Hackahon26/DATA  SOURCES"
OUT = "/Users/annaesakova/Hackahon26/Kiez Profile Master Table"
WFS = "https://gdi.berlin.de/services/wfs/ua_umweltgerechtigkeit2023"

LAYERS = ["a_laerm2023", "b_luft2023", "c_gruen2023", "d_bioklima2023", "e_sozial2023",
          "f_mehrfach4_2023", "g_mehrfach5_2023", "z_gesamt_umwelt2023"]
LABELS = {
    "a_laerm2023": "ug_laerm", "b_luft2023": "ug_luft", "c_gruen2023": "ug_gruenversorgung",
    "d_bioklima2023": "ug_thermisch", "e_sozial2023": "ug_soziale_benachteiligung",
    "f_mehrfach4_2023": "ug_mehrfachbelastung_umwelt",
    "g_mehrfach5_2023": "ug_mehrfachbelastung_umwelt_sozial",
    "z_gesamt_umwelt2023": "ug_gesamt_umweltgerechtigkeitskarte",
}

def fetch_layer(layer):
    url = (f"{WFS}?service=WFS&version=2.0.0&request=GetFeature"
           f"&typeNames=ua_umweltgerechtigkeit2023:{layer}&outputFormat=json&srsName=EPSG:4326")
    req = urllib.request.Request(url, headers={"User-Agent": "hackathon-kiez-concierge/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    gdf = gpd.GeoDataFrame.from_features(data["features"], crs="EPSG:4326")
    return gdf[["plr_id", "plr_name", "kategorie", "geometry"]].rename(columns={"kategorie": LABELS[layer]})

# =================================================================
# 1. Planungsraum master polygons + all 8 Umweltgerechtigkeit indicators
# =================================================================
print("[1] Pulling 8 Umweltgerechtigkeit layers via WFS (bulk, with real geometry)...")
base = fetch_layer(LAYERS[0])
for layer in LAYERS[1:]:
    other = fetch_layer(layer)
    base = base.merge(other.drop(columns="geometry"), on=["plr_id", "plr_name"], how="outer")
plr = base.copy()
plr["centroid"] = plr.geometry.to_crs("EPSG:25833").centroid.to_crs("EPSG:4326")
plr["lat"] = plr["centroid"].y
plr["lon"] = plr["centroid"].x
print(f"    {len(plr)} Planungsräume, columns: {list(plr.columns)}")

plr_poly = plr[["plr_id", "plr_name", "geometry"]].copy()  # for spatial joins below

# =================================================================
# 2. Wohnlage (400k addresses) -> point-in-polygon -> Wohnlage mix + PLZ crosswalk
# =================================================================
print("[2] Point-in-polygon: Wohnlage addresses (this is the big one, ~400k points)...")
wohn = pd.read_csv(f"{SRC}/all 400k houses in Berlin/wohnlagen_2026.csv", dtype={"plz": str})
wohn = wohn.dropna(subset=["plz", "lat", "lon"])
wohn["plz"] = wohn["plz"].str.zfill(5)
wohn_gdf = gpd.GeoDataFrame(wohn, geometry=gpd.points_from_xy(wohn.lon, wohn.lat), crs="EPSG:4326")
wohn_joined = gpd.sjoin(wohn_gdf, plr_poly, how="inner", predicate="within")
print(f"    {len(wohn_joined)}/{len(wohn)} addresses matched to a Planungsraum ({100*len(wohn_joined)/len(wohn):.1f}%)")

def mode_or_first(s):
    m = s.mode()
    return m.iloc[0] if len(m) else np.nan

wol_pct = wohn_joined.groupby("plr_id")["wol"].value_counts(normalize=True).unstack(fill_value=0) * 100
wol_pct.columns = [f"pct_wohnlage_{c}" for c in wol_pct.columns]
plr_wohn = wohn_joined.groupby("plr_id").agg(
    n_addresses=("schluessel", "count"),
    bezirk=("bezname", mode_or_first),
    dominant_plz=("plz", mode_or_first),  # for linking PLZ-only real data (dataset2)
).reset_index()
plr_wohn = plr_wohn.merge(wol_pct.reset_index(), on="plr_id", how="left")
plr_wohn["dominant_wohnlage"] = wohn_joined.groupby("plr_id")["wol"].agg(mode_or_first).values

# =================================================================
# 3. Kitas -> point-in-polygon
# =================================================================
print("[3] Point-in-polygon: Kitas...")
kita = pd.read_csv(f"{SRC}/Kita Standorte (WFS)/kitas_wfs.csv")
kita_gdf = gpd.GeoDataFrame(kita, geometry=gpd.points_from_xy(kita.lon, kita.lat), crs="EPSG:4326")
kita_joined = gpd.sjoin(kita_gdf, plr_poly, how="inner", predicate="within")
kita_agg = kita_joined.groupby("plr_id").agg(
    n_kitas=("e_nr", "count"), total_kita_capacity=("e_platz", "sum")
).reset_index()
print(f"    {len(kita_joined)}/{len(kita)} Kitas matched")

# =================================================================
# 4. Schools (schulbaumassnahmen) -> point-in-polygon
# =================================================================
print("[4] Point-in-polygon: school construction projects...")
schools = pd.read_excel(f"{SRC}/schulbaumassnahmen-2026.xlsx", sheet_name="Schulen")
schools["Schulplätze nach Baumaßnahme"] = pd.to_numeric(schools["Schulplätze nach Baumaßnahme"], errors="coerce")
schools_gdf = gpd.GeoDataFrame(schools, geometry=gpd.points_from_xy(schools["Längengrad"], schools["Breitengrad"]), crs="EPSG:4326")
schools_joined = gpd.sjoin(schools_gdf, plr_poly, how="inner", predicate="within")
schools_agg = schools_joined.groupby("plr_id").agg(
    n_school_construction_projects=("Adresse", "count"),
    n_unique_schools_with_projects=("Berliner Schulnummer", "nunique"),
    total_planned_school_capacity=("Schulplätze nach Baumaßnahme", "max"),
).reset_index()
print(f"    {len(schools_joined)}/{len(schools)} school-project rows matched")

# =================================================================
# 5. Abitur schools with a real lat/lon (via the 63/185 crosswalk) -> point-in-polygon
# =================================================================
print("[5] Point-in-polygon: the 63 Abitur schools with known coordinates...")
abi_detail = pd.read_csv(f"{OUT}/abitur_by_school.csv")
abi_with_coords = abi_detail.dropna(subset=["PLZ"]).merge(
    schools[["Berliner Schulnummer", "Längengrad", "Breitengrad"]].drop_duplicates("Berliner Schulnummer"),
    left_on="BSN", right_on="Berliner Schulnummer", how="left"
).dropna(subset=["Längengrad", "Breitengrad"])
abi_gdf = gpd.GeoDataFrame(abi_with_coords,
                            geometry=gpd.points_from_xy(abi_with_coords["Längengrad"], abi_with_coords["Breitengrad"]),
                            crs="EPSG:4326")
abi_joined = gpd.sjoin(abi_gdf, plr_poly, how="inner", predicate="within")
def wavg(vals, weights):
    return np.average(vals, weights=weights) if len(vals) else np.nan
abi_plr = abi_joined.groupby("plr_id").apply(
    lambda d: pd.Series({
        "abitur_mn_scls_plr_avg": wavg(d["mn.scls"], d["n.scls"]),
        "abitur_performance_vs_peer_plr_avg": wavg(d["performance_vs_peer"], d["n.scls"]),
        "n_abitur_schools_in_plr": len(d),
    }), include_groups=False
).reset_index()
print(f"    {len(abi_joined)}/{len(abi_with_coords)} coordinate-matched Abitur schools placed in a Planungsraum "
      f"(covers {len(abi_plr)}/{len(plr)} Planungsräume directly)")

# =================================================================
# 6. Synthetic secondary_sales / rentals / new_construction -> point-in-polygon
# =================================================================
print("[6] Point-in-polygon: synthetic sales/rentals/new-construction...")
def pip_agg(path, value_col, count_col_name, agg_col_name):
    df = pd.read_csv(path)
    gdf = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df.lon, df.lat), crs="EPSG:4326")
    joined = gpd.sjoin(gdf, plr_poly, how="inner", predicate="within")
    agg = joined.groupby("plr_id").agg(**{agg_col_name: (value_col, "mean"), count_col_name: (value_col, "count")}).reset_index()
    return agg, len(joined), len(df)

rent_agg, n1, n1t = pip_agg(f"{SRC}/Berlin Real Estate Sales Rentals 2020-2026/rentals.csv",
                             "rent_per_m2_kalt_eur", "n_rental_listings_synthetic", "rent_per_m2_kalt_avg_synthetic")
sec_agg, n2, n2t = pip_agg(f"{SRC}/Berlin Real Estate Sales Rentals 2020-2026/secondary_sales.csv",
                            "price_per_m2_eur", "n_synthetic_sales_listings", "buy_price_per_m2_avg_synthetic")
newc_agg, n3, n3t = pip_agg(f"{SRC}/Berlin Real Estate Sales Rentals 2020-2026/new_construction.csv",
                             "price_per_m2_eur", "n_new_construction_listings", "new_construction_price_per_m2_avg")
print(f"    rentals {n1}/{n1t}, secondary_sales {n2}/{n2t}, new_construction {n3}/{n3t} matched")

# =================================================================
# 7. Transit — nearest station to each Planungsraum centroid
# =================================================================
from scipy.spatial import cKDTree
transit = pd.read_csv(f"{SRC}/Berlin Real Estate Sales Rentals 2020-2026/transit_stations.csv")
t_tree = cKDTree(transit[["lon", "lat"]].values)
dist, idx = t_tree.query(plr[["lon", "lat"]].values, k=1)
plr_transit = plr[["plr_id"]].copy()
plr_transit["nearest_transit_station"] = transit["station_name"].values[idx]
plr_transit["nearest_transit_line"] = transit["line"].values[idx]
plr_transit["transit_distance_km"] = dist * 111

# =================================================================
# 8. Real buy prices (dataset2, PLZ-only) -> inherited via dominant_plz crosswalk
#    (built from real Wohnlage addresses actually inside each Planungsraum — NOT a
#    centroid-distance guess, an honest majority-vote from ground-truth addresses)
# =================================================================
ext = pd.read_csv(f"{SRC}/Real Estate Listings Berlin (DE) April 2023/real_estate_listings_clean.csv")
ext["plz"] = ext["zipcode"].dropna().astype(int).astype(str).str.zfill(5)
ext_agg = ext.groupby("plz").agg(buy_price_per_m2_avg_REAL=("price_per_area", "mean"), n_real_listings=("price_per_area", "count")).reset_index()

# =================================================================
# 9. Crime — still Bezirk-level only (Prognoseraum crosswalk not yet verified)
# =================================================================
crime = pd.read_csv(f"{SRC}/Berlin_crimes.csv")
crime_cols = ['Robbery','Street_robbery','Injury','Agg_assault','Threat','Theft','Car',
              'From_car','Bike','Burglary','Fire','Arson','Damage','Graffiti','Drugs']
crime["total_crime"] = crime[crime_cols].sum(axis=1)
crime_recent = crime[crime.Year >= 2017]
tmp = crime_recent.groupby(["District", "Year"])["total_crime"].sum().reset_index()
crime_bez = tmp.groupby("District")["total_crime"].mean().reset_index().rename(
    columns={"District": "bezirk", "total_crime": "crime_total_avg_2017_2019"})

# =================================================================
# 9b. Abitur Bezirk-level fallback — the exact PLR match above only covers
#     61/542 Planungsräume (only 63 schools have known coordinates at all);
#     keep the Bezirk-level number available too so coverage doesn't regress
#     vs. the PLZ table, clearly as a separate, coarser column.
# =================================================================
abi_full = pd.read_csv(f"{OUT}/abitur_by_school.csv")
abi_bez = abi_full.groupby("bezirk").apply(
    lambda d: pd.Series({
        "abitur_mn_scls_bezirk_avg": wavg(d["mn.scls"], d["n.scls"]),
        "abitur_performance_vs_peer_bezirk_avg": wavg(d["performance_vs_peer"], d["n.scls"]),
    }), include_groups=False
).reset_index()

# =================================================================
# ASSEMBLE
# =================================================================
master = plr.drop(columns=["geometry", "centroid"]).merge(plr_wohn, on="plr_id", how="left")
master = master.merge(kita_agg, on="plr_id", how="left")
master = master.merge(schools_agg, on="plr_id", how="left")
master = master.merge(abi_plr, on="plr_id", how="left")
master = master.merge(rent_agg, on="plr_id", how="left")
master = master.merge(sec_agg, on="plr_id", how="left")
master = master.merge(newc_agg, on="plr_id", how="left")
master = master.merge(plr_transit, on="plr_id", how="left")
master = master.merge(ext_agg.rename(columns={"plz": "dominant_plz"}), on="dominant_plz", how="left")
master = master.merge(crime_bez, on="bezirk", how="left")
master = master.merge(abi_bez, on="bezirk", how="left")

for col in ["n_addresses", "n_kitas", "total_kita_capacity", "n_school_construction_projects",
            "n_unique_schools_with_projects", "n_rental_listings_synthetic", "n_real_listings",
            "n_synthetic_sales_listings", "n_new_construction_listings", "n_abitur_schools_in_plr"]:
    if col in master.columns:
        master[col] = master[col].fillna(0)

master = master.sort_values("plr_id").reset_index(drop=True)
print(f"\nFINAL: {master.shape}")
master.to_csv(f"{OUT}/planungsraum_profile.csv", index=False)

# also save the polygon boundaries themselves as reusable geometry (small enough for git)
plr_geo = plr[["plr_id", "plr_name", "geometry"]].copy()
plr_geo.to_file(f"{OUT}/planungsraum_boundaries.geojson", driver="GeoJSON")
print(f"Saved planungsraum_profile.csv and planungsraum_boundaries.geojson to {OUT}")
