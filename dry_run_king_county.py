import pandas as pd
import numpy as np
import time

t_start = time.time()
def lap(label):
    print(f"\n[{time.time()-t_start:5.1f}s elapsed] {label}")
    print("-"*70)

df = pd.read_csv('/Users/annaesakova/aipm/EDA_project/data/kc_houses.csv')

# ============ PHASE 1 — TRIAGE ============
lap("PHASE 1 — TRIAGE")
print("Tables: 1 (single flat file)")
print("Grain: 1 row = 1 house sale transaction")
print("Subject: flats/houses (closest analogue to Berlin listings data)")
print("Shape:", df.shape)
print("Schema check: 3 id-like columns found ->", [c for c in df.columns if 'id' in c.lower()])
print("  -> anomaly flagged: need to check if these agree or diverge")
print((df['id'] == df['house_id']).mean(), "fraction id==house_id")
print((df['id'] == df['id.1']).mean(), "fraction id==id.1")

# ============ PHASE 2 — CLEANING ============
lap("PHASE 2.1 — Structural checks")
print("Full-row duplicates:", df.duplicated().sum())
print("Duplicate 'id' values:", df['id'].duplicated().sum())
dup_ids = df[df['id'].duplicated(keep=False)].sort_values('id')
print("Sample of duplicated ids (first 6 rows):")
print(dup_ids[['id','date','price']].head(6).to_string(index=False))

lap("PHASE 2.1b — dtype checks")
print("date dtype:", df['date'].dtype, "-> needs datetime conversion")
print("waterfront dtype:", df['waterfront'].dtype, "-> should be boolean/category, is float (has NaNs?)")
print("waterfront unique:", df['waterfront'].unique())

lap("PHASE 2.2 — Missing data")
miss = df.isnull().mean().sort_values(ascending=False)
print(miss[miss > 0])

lap("PHASE 2.3 — Outliers (price, sqft_living)")
for col in ['price', 'sqft_living', 'bedrooms']:
    q01, q99 = df[col].quantile([0.01, 0.99])
    print(f"{col}: 1st pct={q01:.1f}, 99th pct={q99:.1f}, max={df[col].max()}")
print("bedrooms max is suspicious ->", df['bedrooms'].max(), "bedrooms row:")
print(df.loc[df['bedrooms'].idxmax(), ['bedrooms','bathrooms','sqft_living','price']])

lap("PHASE 2.4 — Branch: flats/houses normalization")
df['price_sqft'] = df['price'] / df['sqft_living']
print(df['price_sqft'].describe())
print("Geo fields valid range check: lat", df['lat'].min(), '-', df['lat'].max(),
      "| long", df['long'].min(), '-', df['long'].max())

# ============ PHASE 3 — EDA ============
lap("PHASE 3.1 — Hypothesis table (filled)")
hyps = [
    ("Does location affect price?", "If closer to water, price is higher", "waterfront, price"),
    ("Does size affect price?", "The larger sqft_living, the higher price", "sqft_living, price"),
    ("Does zipcode explain price beyond size?", "price_sqft varies significantly by zipcode even controlling for size", "zipcode, price_sqft"),
]
for q,h,i in hyps:
    print(f"Q: {q}\n  H: {h}\n  Indicators: {i}\n")

lap("PHASE 3.3 — Relationship exploration")
print("Correlation with price:")
num_cols = ['bedrooms','bathrooms','sqft_living','sqft_lot','floors','condition','grade','price']
print(df[num_cols].corr()['price'].sort_values(ascending=False))

print("\nWaterfront vs price (mean):")
print(df.groupby('waterfront')['price'].mean())

print("\nTop 5 zipcodes by price_sqft:")
zip_stats = df.groupby('zipcode')['price_sqft'].agg(['mean','count']).sort_values('mean', ascending=False)
print(zip_stats.head(5))
print("\nBottom 5 zipcodes by price_sqft:")
print(zip_stats.tail(5))

lap("PHASE 3.4 — Hypothesis verdicts")
corr_size = df[['sqft_living','price']].corr().iloc[0,1]
print(f"H2 (size->price): corr={corr_size:.2f} -> {'SUPPORTED' if corr_size>0.4 else 'weak'}")
wf_ratio = df.groupby('waterfront')['price'].mean()
print(f"H1 (waterfront->price): ratio={wf_ratio[1]/wf_ratio[0]:.2f}x -> {'SUPPORTED' if wf_ratio[1]/wf_ratio[0]>1.3 else 'weak'}")
zip_spread = zip_stats['mean'].max() / zip_stats['mean'].min()
print(f"H3 (zipcode->price_sqft): max/min ratio={zip_spread:.2f}x -> {'SUPPORTED' if zip_spread>1.5 else 'weak'}")

# ============ PHASE 4 — METRIC LOCK ============
lap("PHASE 4 — Metric lock candidate")
print("Strongest hypothesis: H3 (zipcode/location explains price_sqft beyond size)")
print("Candidate metric: '$ premium per sqft a buyer pays for zipcode X vs. citywide median, at equivalent size band'")
citywide_median = df['price_sqft'].median()
print(f"Citywide median price_sqft: {citywide_median:.1f}")

lap("DONE")
print(f"Total wall-clock (compute only): {time.time()-t_start:.1f}s")
