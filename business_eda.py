import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import matplotlib.dates as mdates
from matplotlib.colors import LinearSegmentedColormap

BLUE = "#2a78d6"; BLUE_LIGHT = "#6da7ec"; BLUE_DARK = "#184f95"
ORANGE = "#eb6834"; AQUA = "#1baf7a"
TEXT_PRIMARY = "#0b0b0b"; TEXT_SECONDARY = "#52514e"; MUTED = "#898781"
GRID = "#e1e0d9"; BASELINE = "#c3c2b7"; SURFACE = "#fcfcfb"

plt.rcParams.update({
    "font.family": "sans-serif", "font.sans-serif": ["Helvetica", "Arial", "DejaVu Sans"],
    "axes.edgecolor": BASELINE, "axes.labelcolor": TEXT_SECONDARY, "text.color": TEXT_PRIMARY,
    "xtick.color": MUTED, "ytick.color": MUTED, "axes.facecolor": SURFACE,
    "figure.facecolor": SURFACE, "savefig.facecolor": SURFACE, "grid.color": GRID,
    "grid.linewidth": 0.7, "axes.grid": True, "axes.axisbelow": True,
    "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
    "font.size": 9.5,
})

SRC1 = 'DATA  SOURCES/Berlin Real Estate Sales Rentals 2020-2026'
SRC2 = 'DATA  SOURCES/Real Estate Listings Berlin (DE) April 2023'

sec = pd.read_csv(f'{SRC1}/secondary_sales.csv', parse_dates=['date_listed'])
newc = pd.read_csv(f'{SRC1}/new_construction.csv', parse_dates=['date_listed'])
rent = pd.read_csv(f'{SRC1}/rentals.csv', parse_dates=['date_listed'])
kiez = pd.read_csv(f'{SRC1}/kiez_prices_monthly.csv')
kiez['ym'] = pd.to_datetime(kiez['year_month'])
transit = pd.read_csv(f'{SRC1}/transit_stations.csv')
ext = pd.read_csv(f'{SRC2}/real_estate_listings_clean.csv')
out = 'charts'

print("kiez_premium unique:", sec.kiez_premium.unique())
print("energy_class unique:", sorted(sec.energy_class.dropna().unique()))
print("condition unique:", sec.condition.unique())
print("building_era unique:", sec.building_era.unique())
ext_berlin = ext[(ext.zipcode >= 10115) & (ext.zipcode <= 14199)].copy()
print("ext total rows:", len(ext), "| Berlin-only rows:", len(ext_berlin))

# =================================================================
# b01 — citywide monthly purchase price trend: secondary vs new construction
# =================================================================
city_month = kiez.groupby('ym').agg(
    secondary=('secondary_price_per_m2_eur', 'mean'),
    new_constr=('new_construction_price_per_m2_eur', 'mean'),
).reset_index()

fig, ax = plt.subplots(figsize=(8, 4.3), dpi=200)
ax.plot(city_month['ym'], city_month['secondary'], color=BLUE, linewidth=2, label='Secondary market')
ax.plot(city_month['ym'], city_month['new_constr'], color=ORANGE, linewidth=2, label='New construction')
ax.set_ylabel('€ / m²')
ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
ax.set_title('Citywide purchase price/m² — secondary vs. new construction (2020–2026)', loc='left', fontsize=12, pad=10)
leg = ax.legend(frameon=False, loc='upper left')
for t in leg.get_texts(): t.set_color(TEXT_SECONDARY)
fig.tight_layout(); fig.savefig(f'{out}/b01_price_trend.png'); plt.close(fig)

# =================================================================
# b02 — gross rental yield by bezirk (latest month)
# =================================================================
latest_ym = kiez['ym'].max()
latest = kiez[kiez['ym'] == latest_ym].copy()
latest['gross_yield_pct'] = (latest['kaltmiete_per_m2_monthly_eur'] * 12 / latest['secondary_price_per_m2_eur']) * 100
bezirk_yield = latest.groupby('bezirk')['gross_yield_pct'].mean().sort_values()

fig, ax = plt.subplots(figsize=(7, 5), dpi=200)
ax.barh(bezirk_yield.index, bezirk_yield.values, color=BLUE, height=0.6)
ax.set_xlabel('Gross rental yield (%)')
ax.set_title(f'Gross rental yield by Bezirk — {latest_ym.strftime("%b %Y")}', loc='left', fontsize=12, pad=10)
ax.grid(axis='y', visible=False)
fig.tight_layout(); fig.savefig(f'{out}/b02_yield_by_bezirk.png'); plt.close(fig)

# =================================================================
# b03 — citywide yield trend vs mortgage rate (small multiples, not dual axis)
# =================================================================
city_yield = kiez.groupby('ym').apply(
    lambda d: (d['kaltmiete_per_m2_monthly_eur'] * 12 / d['secondary_price_per_m2_eur']).mean() * 100,
    include_groups=False
).reset_index(name='yield_pct')
city_rate = kiez.groupby('ym')['avg_mortgage_rate_pct'].mean().reset_index()

fig, axes = plt.subplots(1, 2, figsize=(11, 3.8), dpi=200)
axes[0].plot(city_yield['ym'], city_yield['yield_pct'], color=BLUE, linewidth=2)
axes[0].set_title('Gross rental yield (%) over time', loc='left', fontsize=11)
axes[0].xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
axes[1].plot(city_rate['ym'], city_rate['avg_mortgage_rate_pct'], color=ORANGE, linewidth=2)
axes[1].set_title('Avg. mortgage rate (%) over time', loc='left', fontsize=11)
axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
fig.suptitle('Yield vs. financing cost — same time axis, separate scales', fontsize=12.5, x=0.01, ha='left', y=1.04)
fig.tight_layout(); fig.savefig(f'{out}/b03_yield_vs_rate.png'); plt.close(fig)

# =================================================================
# b04 — new construction premium over secondary, by bezirk
# =================================================================
gap = latest.groupby('bezirk').apply(
    lambda d: pd.Series({
        'secondary': d['secondary_price_per_m2_eur'].mean(),
        'new_constr': d['new_construction_price_per_m2_eur'].mean(),
    }), include_groups=False
).reset_index()
gap['premium_pct'] = (gap['new_constr'] / gap['secondary'] - 1) * 100
gap = gap.sort_values('premium_pct')

fig, ax = plt.subplots(figsize=(7, 5), dpi=200)
y = np.arange(len(gap))
ax.barh(y - 0.2, gap['secondary'], height=0.38, color=BLUE, label='Secondary')
ax.barh(y + 0.2, gap['new_constr'], height=0.38, color=ORANGE, label='New construction')
ax.set_yticks(y); ax.set_yticklabels(gap['bezirk'])
ax.set_xlabel('€ / m²')
ax.set_title(f'New-build premium over secondary market by Bezirk — {latest_ym.strftime("%b %Y")}', loc='left', fontsize=11.5, pad=10)
leg = ax.legend(frameon=False, loc='lower right')
for t in leg.get_texts(): t.set_color(TEXT_SECONDARY)
ax.grid(axis='y', visible=False)
fig.tight_layout(); fig.savefig(f'{out}/b04_new_vs_secondary_gap.png'); plt.close(fig)

# =================================================================
# b05 — transit distance premium
# =================================================================
bins = [0, 5, 10, 15, 20, 100]
labels = ['<5 min', '5-10 min', '10-15 min', '15-20 min', '20+ min']
sec['transit_band'] = pd.cut(sec['transit_distance_min'], bins=bins, labels=labels)
band_price = sec.groupby('transit_band', observed=True)['price_per_m2_eur'].mean()

fig, ax = plt.subplots(figsize=(6.5, 4), dpi=200)
ax.bar(band_price.index.astype(str), band_price.values, color=BLUE, width=0.6)
ax.set_ylabel('Avg. price / m² (€)')
ax.set_title('Price/m² by walking distance to nearest transit station', loc='left', fontsize=12, pad=10)
ax.grid(axis='x', visible=False)
fig.tight_layout(); fig.savefig(f'{out}/b05_transit_premium.png'); plt.close(fig)

# =================================================================
# b06 — kiez_premium ordinal effect on price
# =================================================================
order = ['low', 'medium', 'high']
kp_price = sec.groupby('kiez_premium', observed=True)['price_per_m2_eur'].mean().reindex(order)
colors_ord = [BLUE_LIGHT, BLUE, BLUE_DARK]
fig, ax = plt.subplots(figsize=(5, 4), dpi=200)
ax.bar(kp_price.index, kp_price.values, color=colors_ord, width=0.55)
ax.set_ylabel('Avg. price / m² (€)')
ax.set_title('Price/m² by kiez_premium rating', loc='left', fontsize=12, pad=10)
ax.grid(axis='x', visible=False)
fig.tight_layout(); fig.savefig(f'{out}/b06_kiez_premium_effect.png'); plt.close(fig)

# =================================================================
# b07 — correlation heatmap, secondary_sales
# =================================================================
num_cols = ['rooms', 'area_m2', 'floor', 'total_floors', 'year_built', 'transit_distance_min',
            'to_brandenburg_gate_km', 'price_per_m2_eur', 'mortgage_rate_at_listing']
corr = sec[num_cols].corr()
diverging = LinearSegmentedColormap.from_list('cw_div', ['#104281', '#2a78d6', '#9ec5f4', '#f0efec', '#f2a6a5', '#e34948', '#8a2020'])
fig, ax = plt.subplots(figsize=(7, 6.3), dpi=200)
im = ax.imshow(corr.values, cmap=diverging, vmin=-1, vmax=1)
ax.set_xticks(range(len(num_cols))); ax.set_yticks(range(len(num_cols)))
ax.set_xticklabels(num_cols, rotation=45, ha='right', fontsize=8.5)
ax.set_yticklabels(num_cols, fontsize=8.5)
ax.grid(False)
for i in range(len(num_cols)):
    for j in range(len(num_cols)):
        v = corr.values[i, j]
        ax.text(j, i, f"{v:.2f}", ha='center', va='center', fontsize=7,
                color='white' if abs(v) > 0.6 else TEXT_PRIMARY)
cbar = fig.colorbar(im, ax=ax, fraction=0.045, pad=0.03)
ax.set_title('Correlation matrix — secondary_sales', fontsize=12.5, loc='left', pad=10)
fig.tight_layout(); fig.savefig(f'{out}/b07_correlation_heatmap.png'); plt.close(fig)

# =================================================================
# b08 — histogram grid, secondary_sales
# =================================================================
hist_cols = ['area_m2', 'price_per_m2_eur', 'rooms', 'floor', 'transit_distance_min',
             'to_brandenburg_gate_km', 'year_built', 'mortgage_rate_at_listing']
fig, axes = plt.subplots(2, 4, figsize=(15, 6), dpi=200)
for ax, col in zip(axes.flat, hist_cols):
    lo, hi = sec[col].quantile([0.01, 0.99])
    ax.hist(sec[col].clip(lo, hi), bins=30, color=BLUE, edgecolor=SURFACE, linewidth=0.2)
    ax.set_title(f"{col}  (skew={sec[col].skew():.1f})", fontsize=10, loc='left')
    ax.tick_params(labelsize=7)
fig.suptitle('Distribution of key numeric fields — secondary_sales', fontsize=13, x=0.01, ha='left', y=1.02)
fig.tight_layout(); fig.savefig(f'{out}/b08_histogram_grid.png', bbox_inches='tight'); plt.close(fig)

# =================================================================
# b09 — outlier scan, secondary_sales
# =================================================================
fig, axes = plt.subplots(2, 4, figsize=(15, 6), dpi=200)
print("\nOUTLIER SUMMARY secondary_sales (IQR):")
for ax, col in zip(axes.flat, hist_cols):
    ax.boxplot(sec[col].dropna(), vert=True, widths=0.5, patch_artist=True,
               boxprops=dict(facecolor=BLUE, edgecolor=BASELINE, alpha=0.85),
               medianprops=dict(color=ORANGE, linewidth=1.6),
               whiskerprops=dict(color=MUTED), capprops=dict(color=MUTED),
               flierprops=dict(marker='o', markersize=2, markerfacecolor=MUTED, markeredgecolor='none', alpha=0.3))
    q1, q3 = sec[col].quantile([0.25, 0.75]); iqr = q3 - q1
    n_out = ((sec[col] < q1-1.5*iqr) | (sec[col] > q3+1.5*iqr)).sum()
    pct = 100*n_out/len(sec)
    print(f"  {col:25s} n={n_out:5d} ({pct:.2f}%)")
    ax.set_title(f"{col}\n{n_out} outliers ({pct:.1f}%)", fontsize=9, loc='left')
    ax.set_xticks([]); ax.tick_params(labelsize=7)
fig.suptitle('Outlier scan (IQR) — secondary_sales', fontsize=13, x=0.01, ha='left', y=1.02)
fig.tight_layout(); fig.savefig(f'{out}/b09_boxplot_grid.png', bbox_inches='tight'); plt.close(fig)

# =================================================================
# b10 — rentals distributions
# =================================================================
fig, axes = plt.subplots(1, 3, figsize=(12, 3.6), dpi=200)
for ax, col, ttl in zip(axes, ['rent_per_m2_kalt_eur', 'kaltmiete_eur_monthly', 'kaution_months'],
                          ['rent €/m² (kalt)', 'kaltmiete €/month', 'kaution (months)']):
    lo, hi = rent[col].quantile([0.01, 0.99])
    ax.hist(rent[col].clip(lo, hi), bins=30, color=BLUE, edgecolor=SURFACE, linewidth=0.2)
    ax.set_title(ttl, fontsize=10.5, loc='left')
fig.suptitle('Rentals — key field distributions', fontsize=13, x=0.01, ha='left', y=1.06)
fig.tight_layout(); fig.savefig(f'{out}/b10_rentals_distributions.png', bbox_inches='tight'); plt.close(fig)

# =================================================================
# b11 — geo map: secondary_sales price/m2 + transit stations overlay
# =================================================================
seq_cmap = LinearSegmentedColormap.from_list('cw_seq', ['#cde2fb', '#6da7ec', '#2a78d6', '#184f95', '#0d366b'])
fig, ax = plt.subplots(figsize=(7, 7.5), dpi=200)
lo, hi = sec['price_per_m2_eur'].quantile([0.02, 0.98])
sc = ax.scatter(sec['lon'], sec['lat'], c=sec['price_per_m2_eur'].clip(lo, hi), cmap=seq_cmap,
                 s=4, alpha=0.35, linewidths=0, vmin=lo, vmax=hi)
ax.scatter(transit['lon'], transit['lat'], marker='^', s=28, color=ORANGE, edgecolors='white', linewidths=0.4, label='Transit station', zorder=5)
cbar = fig.colorbar(sc, ax=ax, fraction=0.045, pad=0.03)
cbar.set_label('€ / m²', fontsize=9, color=TEXT_SECONDARY)
ax.set_xlabel('Longitude'); ax.set_ylabel('Latitude')
ax.set_title('Secondary sales price/m² + transit network', loc='left', fontsize=12.5, pad=10)
ax.set_aspect('equal')
leg = ax.legend(frameon=False, loc='upper left')
for t in leg.get_texts(): t.set_color(TEXT_SECONDARY)
fig.tight_layout(); fig.savefig(f'{out}/b11_geo_map.png', bbox_inches='tight'); plt.close(fig)

# =================================================================
# b12 — external validation: synthetic vs real listings (Berlin only)
# =================================================================
ext_berlin_clean = ext_berlin[ext_berlin['construction_year'] > 1800]
fig, ax = plt.subplots(figsize=(7, 4.3), dpi=200)
lo1, hi1 = sec['price_per_m2_eur'].quantile([0.02, 0.98])
lo2, hi2 = ext_berlin_clean['price_per_area'].quantile([0.02, 0.98])
ax.hist(sec['price_per_m2_eur'].clip(lo1, hi1), bins=40, color=BLUE, alpha=0.55, density=True, label=f'Synthetic secondary_sales (n={len(sec):,})')
ax.hist(ext_berlin_clean['price_per_area'].clip(lo2, hi2), bins=40, color=ORANGE, alpha=0.55, density=True, label=f'Real immowelt.de listings, Berlin only (n={len(ext_berlin_clean):,})')
ax.set_xlabel('€ / m²'); ax.set_ylabel('Density')
ax.set_title('Sanity check: synthetic data vs. real Berlin listings', loc='left', fontsize=12, pad=10)
leg = ax.legend(frameon=False, loc='upper right', fontsize=8.5)
for t in leg.get_texts(): t.set_color(TEXT_SECONDARY)
fig.tight_layout(); fig.savefig(f'{out}/b12_external_validation.png'); plt.close(fig)
print(f"\nSynthetic median price/m2: {sec['price_per_m2_eur'].median():.0f}")
print(f"Real Berlin listings median price/m2: {ext_berlin_clean['price_per_area'].median():.0f}")

# =================================================================
# b14 — energy class effect
# =================================================================
ec_order = sorted(sec.energy_class.dropna().unique())
ec_price = sec.groupby('energy_class', observed=True)['price_per_m2_eur'].mean().reindex(ec_order)
n = len(ec_order)
ramp = LinearSegmentedColormap.from_list('ord', ['#9ec5f4', '#2a78d6', '#0d366b'])
colors_ec = [ramp(i/(n-1)) for i in range(n)]
fig, ax = plt.subplots(figsize=(7, 4), dpi=200)
ax.bar(ec_price.index.astype(str), ec_price.values, color=colors_ec, width=0.6)
ax.set_ylabel('Avg. price / m² (€)')
ax.set_title('Price/m² by energy efficiency class', loc='left', fontsize=12, pad=10)
ax.grid(axis='x', visible=False)
fig.tight_layout(); fig.savefig(f'{out}/b14_energy_class.png'); plt.close(fig)

print("\nAll business-EDA charts written.")
