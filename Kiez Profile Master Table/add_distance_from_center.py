"""
Add distance_from_center_km to every Planungsraum — great-circle (haversine)
distance from each area's centroid to Alexanderplatz, Berlin's conventional
city-center reference point (52.5219 N, 13.4132 E).

Powers the "recommend more remote Kieze first" ranking logic in
lib/rank.ts: a hard "further from the center than the user's current
address" filter, plus a 3-way distance-tier split so the 3 recommendations
spread across near/mid/far bands rather than clustering in one ring.

This script is the single source of truth for both planungsraum_profile.csv
AND src/data/planungsraum.json — it re-exports the full table to JSON after
adding the column, so the two never drift out of sync (verified 1:1 column
parity before writing this).

Usage:
    python3 add_distance_from_center.py
Reads/writes:
    planungsraum_profile.csv       (adds distance_from_center_km, in place)
    ../src/data/planungsraum.json  (regenerated from the updated CSV)
"""
import json
import math
import pandas as pd

PROFILE = "planungsraum_profile.csv"
JSON_OUT = "../src/data/planungsraum.json"

ALEXANDERPLATZ = (52.5219, 13.4132)


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0  # Earth radius, km
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def main():
    # dominant_plz must stay a string (JSON "10787", not number 10787) — the
    # TS side does strict string equality on it (e.g. excluding the user's
    # current PLZ from candidates). Re-reading the CSV without pinning this
    # dtype silently turned it into an int on the first pass — caught by
    # diffing the regenerated JSON against the pre-existing one before
    # trusting this script, worth keeping as a guard here.
    df = pd.read_csv(PROFILE, dtype={"plr_id": str, "dominant_plz": str})

    df["distance_from_center_km"] = df.apply(
        lambda r: round(haversine_km(r["lat"], r["lon"], *ALEXANDERPLATZ), 3), axis=1
    )

    df.to_csv(PROFILE, index=False)
    print(f"[1] Added distance_from_center_km to {PROFILE}: {df.shape}")
    print(f"    Range: {df['distance_from_center_km'].min():.2f} - {df['distance_from_center_km'].max():.2f} km, "
          f"median {df['distance_from_center_km'].median():.2f} km")

    # NaN -> None so missing values serialize as proper JSON null (matching
    # the existing file's convention), not the invalid "NaN" token
    # json.dump would otherwise emit.
    records = df.astype(object).where(pd.notna(df), None).to_dict(orient="records")
    with open(JSON_OUT, "w") as f:
        json.dump(records, f, separators=(",", ":"))
    print(f"[2] Regenerated {JSON_OUT}: {len(records)} rows (full re-export, stays 1:1 with the CSV)")


if __name__ == "__main__":
    main()
