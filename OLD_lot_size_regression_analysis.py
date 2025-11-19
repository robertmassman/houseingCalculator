"""
Lot Size Premium Regression Analysis
Crown Heights Comparable Properties

This script analyzes the relationship between lot size and property value
to determine the dollar-per-SQFT premium for lot size in Crown Heights.
"""

import numpy as np
import pandas as pd
from scipy import stats
import matplotlib.pyplot as plt

# Comparable properties data (from compsData.js)
# Only including properties with valid sale prices and dates
data = [
    {"address": "104 Brooklyn Ave", "building_sqft": 16*40*4, "lot_sqft": 16*72.5, "price": 2285000, "renovated": True, "sale_date": "7/25/2025"},
    {"address": "843 Prospect Pl", "building_sqft": 18.75*50*4, "lot_sqft": 18.75*91, "price": 2530000, "renovated": True, "sale_date": "11/4/2025"},
    {"address": "674 Saint Marks Ave", "building_sqft": 20*50*5, "lot_sqft": 20*125.29, "price": 2875000, "renovated": True, "sale_date": "3/21/2025"},
    {"address": "1323 Dean St", "building_sqft": 20*38*5, "lot_sqft": 20*107.21, "price": 2700000, "renovated": True, "sale_date": "1/7/2025"},
    {"address": "854 Prospect Place", "building_sqft": 20*45*4, "lot_sqft": 20*140.58, "price": 2050000, "renovated": False, "sale_date": "11/19/2024"},
    {"address": "845 Prospect Place", "building_sqft": 18.75*50*4, "lot_sqft": 18.75*91, "price": 2650000, "renovated": True, "sale_date": "4/18/2024"},
    {"address": "1113 Bergen St", "building_sqft": 20*40*4, "lot_sqft": 20*100, "price": 2700000, "renovated": True, "sale_date": "1/9/2024"},
    {"address": "1290 Pacific St", "building_sqft": 30*45*4, "lot_sqft": 50*114, "price": 3300000, "renovated": True, "sale_date": "8/26/2024"},
    {"address": "1354 Pacific St", "building_sqft": 20*40*5, "lot_sqft": 20*100, "price": 2450000, "renovated": True, "sale_date": "4/10/2024"},
    {"address": "1352 Pacific St", "building_sqft": 20*50*4.5, "lot_sqft": 20*100, "price": 2622500, "renovated": True, "sale_date": "7/16/2025"},
    {"address": "1306 Dean St", "building_sqft": 20*50*4, "lot_sqft": 20*114.42, "price": 1980000, "renovated": False, "sale_date": "4/5/2024"},
]

df = pd.DataFrame(data)

print("=" * 80)
print("LOT SIZE PREMIUM REGRESSION ANALYSIS")
print("Crown Heights Comparable Properties")
print("=" * 80)
print()

# Basic statistics
print("DATASET SUMMARY")
print("-" * 80)
print(f"Number of properties: {len(df)}")
print(f"Building SQFT range: {df['building_sqft'].min():.0f} - {df['building_sqft'].max():.0f}")
print(f"Lot SQFT range: {df['lot_sqft'].min():.0f} - {df['lot_sqft'].max():.0f}")
print(f"Price range: ${df['price'].min():,.0f} - ${df['price'].max():,.0f}")
print(f"Median building SQFT: {df['building_sqft'].median():.0f}")
print(f"Median lot SQFT: {df['lot_sqft'].median():.0f}")
print()

# =============================================================================
# MODEL 1: Simple Linear Regression (Lot Size Only)
# =============================================================================
print("=" * 80)
print("MODEL 1: SIMPLE LINEAR REGRESSION (LOT SIZE ONLY)")
print("=" * 80)
print("Formula: Price = α + β × Lot_SQFT")
print()

X_lot = df['lot_sqft'].values
y = df['price'].values

# Simple linear regression
slope, intercept, r_value, p_value, std_err = stats.linregress(X_lot, y)

print(f"Intercept (α): ${intercept:,.0f}")
print(f"Slope (β): ${slope:.2f} per SQFT")
print(f"R-squared: {r_value**2:.4f}")
print(f"P-value: {p_value:.6f}")
print(f"Standard Error: ${std_err:.2f}")
print()

if p_value < 0.05:
    print("✅ Result is statistically significant (p < 0.05)")
else:
    print("⚠️ Result is NOT statistically significant (p >= 0.05)")
print()

print("INTERPRETATION:")
print(f"  Every additional SQFT of lot size adds approximately ${slope:.2f} to property value")
print(f"  However, R² = {r_value**2:.3f} means lot size alone explains only {r_value**2*100:.1f}% of price variance")
print()

# =============================================================================
# MODEL 2: Multiple Regression (Building SQFT + Lot Size)
# =============================================================================
print("=" * 80)
print("MODEL 2: MULTIPLE REGRESSION (BUILDING SQFT + LOT SIZE)")
print("=" * 80)
print("Formula: Price = α + β₁ × Building_SQFT + β₂ × Lot_SQFT")
print()

# Prepare data for multiple regression
X_multi = np.column_stack([df['building_sqft'].values, df['lot_sqft'].values])

# Add intercept column
X_multi_with_intercept = np.column_stack([np.ones(len(df)), X_multi])

# Perform multiple linear regression using least squares
coefficients, residuals, rank, s = np.linalg.lstsq(X_multi_with_intercept, y, rcond=None)

intercept_multi = coefficients[0]
building_coef = coefficients[1]
lot_coef = coefficients[2]

# Calculate R-squared
y_pred = X_multi_with_intercept @ coefficients
ss_res = np.sum((y - y_pred) ** 2)
ss_tot = np.sum((y - np.mean(y)) ** 2)
r_squared = 1 - (ss_res / ss_tot)

print(f"Intercept (α): ${intercept_multi:,.0f}")
print(f"Building SQFT coefficient (β₁): ${building_coef:.2f} per SQFT")
print(f"Lot SQFT coefficient (β₂): ${lot_coef:.2f} per SQFT")
print(f"R-squared: {r_squared:.4f}")
print()

print("INTERPRETATION:")
print(f"  Holding lot size constant, each additional SQFT of building adds ${building_coef:.2f}")
print(f"  Holding building size constant, each additional SQFT of lot adds ${lot_coef:.2f}")
print(f"  This model explains {r_squared*100:.1f}% of price variance")
print()

# =============================================================================
# MODEL 3: Multiple Regression with Renovation Indicator
# =============================================================================
print("=" * 80)
print("MODEL 3: MULTIPLE REGRESSION (BUILDING + LOT + RENOVATION)")
print("=" * 80)
print("Formula: Price = α + β₁ × Building_SQFT + β₂ × Lot_SQFT + β₃ × Renovated")
print()

# Add renovation indicator (1 = renovated, 0 = not renovated)
X_with_reno = np.column_stack([
    df['building_sqft'].values,
    df['lot_sqft'].values,
    df['renovated'].astype(int).values
])

# Add intercept column
X_with_reno_intercept = np.column_stack([np.ones(len(df)), X_with_reno])

# Perform regression
coefficients_reno, residuals_reno, rank_reno, s_reno = np.linalg.lstsq(X_with_reno_intercept, y, rcond=None)

intercept_reno = coefficients_reno[0]
building_coef_reno = coefficients_reno[1]
lot_coef_reno = coefficients_reno[2]
reno_coef = coefficients_reno[3]

# Calculate R-squared
y_pred_reno = X_with_reno_intercept @ coefficients_reno
ss_res_reno = np.sum((y - y_pred_reno) ** 2)
ss_tot_reno = np.sum((y - np.mean(y)) ** 2)
r_squared_reno = 1 - (ss_res_reno / ss_tot_reno)

print(f"Intercept (α): ${intercept_reno:,.0f}")
print(f"Building SQFT coefficient (β₁): ${building_coef_reno:.2f} per SQFT")
print(f"Lot SQFT coefficient (β₂): ${lot_coef_reno:.2f} per SQFT")
print(f"Renovation premium (β₃): ${reno_coef:,.0f}")
print(f"R-squared: {r_squared_reno:.4f}")
print()

print("INTERPRETATION:")
print(f"  Each additional SQFT of building adds ${building_coef_reno:.2f}")
print(f"  Each additional SQFT of lot adds ${lot_coef_reno:.2f}")
print(f"  Renovated properties command a premium of ${reno_coef:,.0f}")
print(f"  This model explains {r_squared_reno*100:.1f}% of price variance")
print()

# =============================================================================
# RESIDUAL ANALYSIS
# =============================================================================
print("=" * 80)
print("RESIDUAL ANALYSIS (MODEL 3)")
print("=" * 80)
print()

residuals_values = y - y_pred_reno
rmse = np.sqrt(np.mean(residuals_values ** 2))

print(f"Root Mean Squared Error: ${rmse:,.0f}")
print(f"Mean Absolute Error: ${np.mean(np.abs(residuals_values)):,.0f}")
print()

print("RESIDUALS BY PROPERTY:")
print("-" * 80)
for i, row in df.iterrows():
    predicted = y_pred_reno[i]
    actual = y[i]
    residual = residuals_values[i]
    pct_error = (residual / actual) * 100
    print(f"{row['address'][:25]:<25} Actual: ${actual:>9,.0f}  Predicted: ${predicted:>9,.0f}  Error: ${residual:>8,.0f} ({pct_error:>+5.1f}%)")
print()

# =============================================================================
# COMPARISON WITH INDUSTRY STANDARDS
# =============================================================================
print("=" * 80)
print("COMPARISON WITH INDUSTRY STANDARDS")
print("=" * 80)
print()

print("PERCENTAGE-BASED METHOD (Industry Standard: ±1% per 500 SQFT)")
print("-" * 80)
print("Formula: Adjustment = (Lot_Difference / 500) × 1% × Base_Value")
print()

# Using median lot size as baseline
median_lot = df['lot_sqft'].median()
median_building = df['building_sqft'].median()
median_price_per_sqft = (df['price'] / df['building_sqft']).median()
typical_base_value = median_building * median_price_per_sqft

print(f"Typical property: {median_building:.0f} SQFT building × ${median_price_per_sqft:.2f}/SQFT = ${typical_base_value:,.0f}")
print(f"Typical lot size: {median_lot:.0f} SQFT")
print()

print("EXAMPLE ADJUSTMENTS:")
print("-" * 80)
lot_differences = [-500, -200, 0, 200, 500, 1000]
for diff in lot_differences:
    # Percentage method
    pct_adjustment = (diff / 500) * 0.01 * typical_base_value
    
    # Regression method (from Model 3)
    reg_adjustment = diff * lot_coef_reno
    
    lot_size = median_lot + diff
    print(f"Lot size: {lot_size:>6.0f} SQFT (Δ {diff:>+5.0f} SQFT)")
    print(f"  Percentage method: {pct_adjustment:>+10,.0f}")
    print(f"  Regression method:  {reg_adjustment:>+10,.0f}")
    print()

# =============================================================================
# RECOMMENDATIONS
# =============================================================================
print("=" * 80)
print("RECOMMENDATIONS")
print("=" * 80)
print()

print(f"✅ RECOMMENDED LOT SIZE ADJUSTMENT: ${lot_coef_reno:.2f} per SQFT")
print()
print("RATIONALE:")
print(f"  • Derived from actual Crown Heights sales data (n={len(df)})")
print(f"  • Accounts for building size and renovation status")
print(f"  • Model explains {r_squared_reno*100:.1f}% of price variance")
print(f"  • Root mean squared error: ${rmse:,.0f} ({rmse/df['price'].mean()*100:.1f}% of mean price)")
print()

print("COMPARISON WITH YOUR HYPOTHESIS ($100-$200 per SQFT):")
if 100 <= lot_coef_reno <= 200:
    print(f"  ✅ Your hypothesis is CONFIRMED! ${lot_coef_reno:.2f} falls within the $100-$200 range")
elif lot_coef_reno < 100:
    print(f"  ⚠️ Actual value (${lot_coef_reno:.2f}) is LOWER than your hypothesis ($100-$200)")
else:
    print(f"  ⚠️ Actual value (${lot_coef_reno:.2f}) is HIGHER than your hypothesis ($100-$200)")
print()

print("ALTERNATIVE: PERCENTAGE-BASED METHOD")
print(f"  • Industry standard: ±1% per 500 SQFT difference")
print(f"  • For a typical ${typical_base_value:,.0f} property:")
print(f"    - 500 SQFT larger lot: +${0.01 * typical_base_value:,.0f}")
print(f"    - 500 SQFT smaller lot: -${0.01 * typical_base_value:,.0f}")
print(f"  • Equivalent to ${0.01 * typical_base_value / 500:.2f} per SQFT (scales with property value)")
print()

print("=" * 80)
print("END OF ANALYSIS")
print("=" * 80)
