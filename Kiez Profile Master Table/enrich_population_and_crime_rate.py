"""
Enrich planungsraum_profile.csv with real population-by-age data, and add a
population-normalized crime rate to replace the address-count proxy that was
the only option before real population existed.

Population source: Kaggle "Berlin District Population"
(https://www.kaggle.com/datasets/shreejahoskerenatesh/berlin-district-population),
saved locally as DATA SOURCES/berlin_population_by_plz_bezirk.csv. Real
government-derived population counts, but only at PLZ x Bezirk grain (218
rows for 190 PLZ — 28 PLZ split across two Bezirke). No Planungsraum-level
population source exists, so this allocates each PLZ x Bezirk population
figure down to Planungsraum by real address-count share within that cell
(using the 400k-address Wohnlage dataset, which carries plz/bezname/plr_name
per address) — the same "distribute a coarser figure by a real, finer-grain
weight" approach already used elsewhere in this table (e.g. dominant_plz).

Usage:
    python3 enrich_population_and_crime_rate.py
Reads:
    DATA SOURCES/berlin_population_by_plz_bezirk.csv
    DATA SOURCES/all 400k houses in Berlin/wohnlagen_2026.csv
    planungsraum_boundaries.geojson
    planungsraum_profile.csv
Writes:
    planungsraum_profile.csv  (updated in place: population columns +
                                pct_population_coverage + crime rate)
"""
import pandas as pd
import geopandas as gpd

SRC = "../DATA  SOURCES"
PROFILE = "planungsraum_profile.csv"
BOUNDARIES = "planungsraum_boundaries.geojson"

BEZIRK_BY_NR = {
    1: "Mitte", 2: "Friedrichshain-Kreuzberg", 3: "Pankow", 4: "Charlottenburg-Wilmersdorf",
    5: "Spandau", 6: "Steglitz-Zehlendorf", 7: "Tempelhof-Schöneberg", 8: "Neukölln",
    9: "Treptow-Köpenick", 10: "Marzahn-Hellersdorf", 11: "Lichtenberg", 12: "Reinickendorf",
}

POP_COLS = ["pop_total", "pop_under6", "pop_6_15", "pop_15_18", "pop_18_27",
            "pop_27_45", "pop_45_55", "pop_55_65", "pop_65plus", "pop_female"]


def main():
    pop = pd.read_csv(f"{SRC}/berlin_population_by_plz_bezirk.csv", dtype={"plz": str})

    wohn = pd.read_csv(f"{SRC}/all 400k houses in Berlin/wohnlagen_2026.csv",
                        usecols=["plz", "bezname", "plr_name"], dtype={"plz": str}).dropna()
    wohn["plz"] = wohn["plz"].str.zfill(5)

    # plr_name is not globally unique (2 Planungsräume are both named
    # "Schloßstraße", in different Bezirke) — disambiguate via the Bezirk
    # encoded in plr_id's first two digits, same convention build_kiez_profile.py
    # already uses for the Abitur Bezirksnummer crosswalk.
    plr = gpd.read_file(BOUNDARIES)[["plr_id", "plr_name"]]
    plr["bezirk"] = plr["plr_id"].str[:2].astype(int).map(BEZIRK_BY_NR)

    addr = wohn.merge(plr[["plr_id", "plr_name", "bezirk"]], on="plr_name",
                       suffixes=("", "_plr"))
    addr = addr[addr["bezname"] == addr["bezirk"]]  # keep only the correct Schloßstraße match
    dropped = len(wohn) - len(addr)
    print(f"[1] {len(addr)}/{len(wohn)} addresses resolved to a plr_id "
          f"({dropped} dropped — should be ~0)")

    # Address-count share of each Planungsraum within its (plz, bezirk) cell
    cell_total = addr.groupby(["plz", "bezname"]).size().rename("n_addr_cell")
    cell_plr = addr.groupby(["plz", "bezname", "plr_id"]).size().rename("n_addr_plr").reset_index()
    cell_plr = cell_plr.merge(cell_total, on=["plz", "bezname"])
    cell_plr["share"] = cell_plr["n_addr_plr"] / cell_plr["n_addr_cell"]

    # Allocate: population columns are real at (plz, bezirk) grain; every
    # Planungsraum inside that cell gets its address-count-weighted share.
    alloc = cell_plr.merge(pop, left_on=["plz", "bezname"], right_on=["plz", "bezirk"], how="left")
    matched = alloc["pop_total"].notna()
    print(f"[2] {matched.sum()}/{len(alloc)} Planungsraum x cell rows matched a population row "
          f"({(~matched).sum()} cells have no population data in the source — "
          f"those addresses contribute 0, not a guess)")

    for col in POP_COLS:
        alloc[col] = alloc[col].fillna(0) * alloc["share"]

    RENAME = {
        "pop_total": "n_population", "pop_under6": "n_population_under6",
        "pop_6_15": "n_population_6_15", "pop_15_18": "n_population_15_18",
        "pop_18_27": "n_population_18_27", "pop_27_45": "n_population_27_45",
        "pop_45_55": "n_population_45_55", "pop_55_65": "n_population_55_65",
        "pop_65plus": "n_population_65plus", "pop_female": "n_population_female",
    }
    plr_pop = alloc.groupby("plr_id")[POP_COLS].sum().reset_index()
    plr_pop = plr_pop.rename(columns=RENAME)
    for c in plr_pop.columns:
        if c != "plr_id":
            plr_pop[c] = plr_pop[c].round(0).astype(int)

    # Coverage flag: what fraction of this Planungsraum's addresses actually
    # landed in a matched (plz, bezirk) population cell. <100% means the
    # population figures above are a real but partial undercount.
    coverage = alloc.groupby("plr_id").apply(
        lambda d: (d.loc[matched.loc[d.index], "n_addr_plr"].sum() / d["n_addr_plr"].sum()) * 100,
        include_groups=False,
    ).rename("pct_population_coverage").reset_index()

    # -----------------------------------------------------------------
    # Crime rate — real Bezirk population instead of the address-count
    # proxy that was the only option before this dataset existed.
    # -----------------------------------------------------------------
    bez_pop = pop.groupby("bezirk")["pop_total"].sum().rename("bezirk_population").reset_index()

    profile = pd.read_csv(PROFILE, dtype={"plr_id": str})
    before_rows = len(profile)

    profile = profile.merge(plr_pop, on="plr_id", how="left")
    profile = profile.merge(coverage, on="plr_id", how="left")
    for col in RENAME.values():
        profile[col] = profile[col].fillna(0).astype(int)
    profile["pct_population_coverage"] = profile["pct_population_coverage"].fillna(0).round(1)

    profile = profile.merge(bez_pop, on="bezirk", how="left")
    profile["crime_rate_per_10k_2017_2019"] = (
        profile["crime_total_avg_2017_2019"] / (profile["bezirk_population"] / 10_000)
    ).round(2)

    assert len(profile) == before_rows, "row count changed during merge"
    profile.to_csv(PROFILE, index=False)
    print(f"\n[3] Updated {PROFILE}: {profile.shape}")
    print(f"    Sum of n_population across all Planungsräume: {profile['n_population'].sum():,} "
          f"(source file total: {pop['pop_total'].sum():,})")
    print(f"    Planungsräume with <100% population coverage: "
          f"{(profile['pct_population_coverage'] < 100).sum()}")
    print(f"    Planungsräume with 0% population coverage (no data at all): "
          f"{(profile['pct_population_coverage'] == 0).sum()}")


if __name__ == "__main__":
    main()
