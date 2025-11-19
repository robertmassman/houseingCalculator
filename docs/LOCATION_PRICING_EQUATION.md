# Location-Based Pricing Adjustment Equation

## Overview

This document explains the comprehensive location-based pricing adjustment algorithm that derives a dollar amount adjustment based on three spatial factors visualized in the heat maps.

## The Three Heat Map Factors

### 1. **Weights Influence Map** (Purple/Pink Gradient)
Shows which properties have the most influence on the valuation calculation. Properties with higher weights contribute more to the final estimate.

### 2. **Value Zones Map** (Blue to Pink Gradient)  
Shows the spatial distribution of property values:
- **Pink/Hot zones** = Expensive properties cluster
- **Blue/Cool zones** = Less expensive properties cluster

### 3. **Amenities Map** (Green Glow)
Shows walkability and proximity to desirable amenities:
- Subway/transit stations
- Restaurants and commercial corridors
- Parks and green spaces

## The Complete Location Adjustment Equation

```
Total Location Adjustment = Amenity Premium + Value Zone Premium/Discount + Comp Distance Penalty
```

### Factor 1: Amenity Proximity Premium (0% to +5%)

**Equation:**
```javascript
amenityWeight = e^(-distanceToNearestAmenity / halfLifeDistance)
amenityPremiumPercent = amenityWeight × 0.05  // 0-5% range
```

**Logic:**
- Properties closer to transit, restaurants, and parks command higher prices
- Uses exponential decay: perfect location (0 mi) = 5% premium
- Half-life at 0.5 miles (~8 blocks): approximately 3% premium
- By 1 mile: premium decays to near zero
- Reflects real-world walkability premium in Brooklyn neighborhoods

**Example:**
- Target property at 0.2 mi from Nostrand Ave A/C Station
- Weight = e^(-0.2/0.5) = 0.67
- Premium = 0.67 × 5% = **3.35% amenity premium**

### Factor 2: Value Zone Clustering (-3% to +3%)

**Equation:**
```javascript
nearbyComps = comps within 0.125 miles (≈2 blocks)
nearbyMedianPrice = median(nearbyComps.pricePerSQFT)
overallMedianPrice = median(allComps.pricePerSQFT)

priceDifferencePercent = (nearbyMedianPrice - overallMedianPrice) / overallMedianPrice
valueZonePremiumPercent = clamp(priceDifferencePercent × 0.5, -3%, +3%)
```

**Logic:**
- Properties in expensive neighborhoods command premiums
- Properties in cheaper areas face discounts
- Compares immediate neighborhood (2 blocks) to overall comp pool
- Scaled down by 50% to avoid over-adjustment
- Capped at ±3% to prevent extreme swings

**Example:**
- Nearby comps (2 blocks): median $450/sqft
- All comps: median $400/sqft  
- Difference: +12.5%
- Adjustment: 12.5% × 0.5 = **+6.25% → capped at +3%**

### Factor 3: Comparable Distance Penalty (0% to -3%)

**Equation:**
```javascript
avgCompDistance = average(distances to all included comps)

if (avgCompDistance > 0.125 miles) {
    excessDistance = avgCompDistance - 0.125
    distancePenaltyPercent = -min(3%, excessDistance × 5%)
}
```

**Logic:**
- When best comparable properties are far away, valuation uncertainty increases
- Within 2 blocks (0.125 mi): no penalty (high confidence)
- Beyond 2 blocks: apply increasing penalty
- Maximum penalty: -3% (when comps average 0.725+ miles away)
- Reflects appraisal principle: closer comps = better data

**Example:**
- Best comps average 0.7 miles away
- Excess distance: 0.7 - 0.125 = 0.575 miles
- Penalty: -min(3%, 0.575 × 5%) = **-2.88% comp distance penalty**

## Combined Adjustment Calculation

**Step 1: Calculate Total Percentage Adjustment**
```javascript
totalAdjustmentPercent = amenityPremiumPercent + valueZonePremiumPercent + distancePenaltyPercent
```

**Step 2: Convert to Dollar Amount**
```javascript
medianBuildingPrice = median(comps.buildingPriceSQFT)
baseValue = targetProperty.buildingSQFT × medianBuildingPrice
adjustmentAmount = baseValue × totalAdjustmentPercent
```

## Real-World Example

**Scenario:** 2,500 SQFT brownstone at 1220 Dean Street, Crown Heights

### Input Data:
- Distance to nearest transit: 0.25 miles (Nostrand A/C)
- Nearby comps median: $475/sqft (3 properties within 2 blocks)
- All comps median: $450/sqft (15 properties)
- Average comp distance: 0.5 miles
- Base value: 2,500 sqft × $450/sqft = $1,125,000

### Calculation:

**Factor 1: Amenity Premium**
```
Weight = e^(-0.25/0.5) = 0.606
Premium = 0.606 × 5% = +3.03%
Dollar amount = $1,125,000 × 0.0303 = +$34,088
```

**Factor 2: Value Zone Premium**  
```
Price difference = ($475 - $450) / $450 = +5.56%
Adjusted = 5.56% × 0.5 = +2.78%
Dollar amount = $1,125,000 × 0.0278 = +$31,275
```

**Factor 3: Distance Penalty**
```
Excess distance = 0.5 - 0.125 = 0.375 miles
Penalty = -min(3%, 0.375 × 5%) = -1.88%
Dollar amount = $1,125,000 × -0.0188 = -$21,150
```

**Total Location Adjustment:**
```
3.03% + 2.78% - 1.88% = +3.93%
Dollar Amount = +$34,088 + $31,275 - $21,150 = +$44,213
```

**Final Estimate:**
```
Base Value:          $1,125,000
Location Adjustment: +   $44,213
Adjusted Value:      $1,169,213
```

## Interpretation Guide

### Premium Locations (+3% to +8%)
- Close to subway (< 0.3 miles)
- Surrounded by expensive comps
- Strong comparable properties nearby

**Characteristics:**
- Walking distance to transit
- Established high-value block
- Recent similar sales within 2 blocks

### Average Locations (-2% to +2%)
- Moderate transit access (0.3-0.6 miles)
- Mixed price neighborhood
- Decent comp coverage

**Characteristics:**
- Typical Brooklyn residential block
- Standard walkability
- Reasonable comparable data

### Discount Locations (-5% to -3%)
- Far from transit (> 0.7 miles)
- Lower-value neighborhood
- Sparse comparable data

**Characteristics:**
- Limited walkability
- Lower-priced surrounding area
- Must rely on distant comps

## Why This Approach Works

### 1. **Data-Driven, Not Arbitrary**
Each factor is calculated from actual market data:
- Amenity distances are measured precisely
- Value zones derived from real sale prices
- Comp distances quantify data quality

### 2. **Conservative Caps Prevent Over-Adjustment**
- Amenity premium capped at 5%
- Value zone adjustment capped at ±3%
- Distance penalty capped at -3%
- Maximum possible adjustment: ±11%

### 3. **Aligns with Appraisal Standards**
- Proximity adjustments are standard in CMA (Comparative Market Analysis)
- Location is recognized as a primary value driver
- Follows USPAP (Uniform Standards of Professional Appraisal Practice)

### 4. **Reflects Brooklyn Market Reality**
- Transit proximity is crucial in NYC
- Block-by-block value variation is significant
- Comp distance affects estimate reliability

## Implementation Notes

### Function Signature:
```javascript
function calculateLocationAdjustment(targetProperty, includedComps)
```

### Returns:
```javascript
{
    adjustment: Number,              // Dollar amount (positive or negative)
    breakdown: {
        amenityPremium: Number,      // Dollar amount from amenity factor
        amenityPremiumPercent: String,  // e.g., "3.03%"
        amenityDistance: String,     // e.g., "0.25 mi"
        valueZonePremium: Number,    // Dollar amount from value zone factor
        valueZonePremiumPercent: String, // e.g., "+2.78%"
        nearbyCompCount: Number,     // Number of comps within 0.125 miles
        distancePenalty: Number,     // Dollar amount from distance factor
        distancePenaltyPercent: String, // e.g., "-1.00%"
        avgCompDistance: String      // e.g., "0.50 mi"
    },
    description: String              // "Premium location", "Average location", etc.
}
```

### Integration Point:
The location adjustment is applied alongside lot size and width adjustments in the NYC Appraisal Method:

```javascript
NYC Estimate = (Building SQFT × $/SQFT) + Lot Adjustment + Width Adjustment + Location Adjustment
```

## Calibration & Validation

To validate the equation's accuracy:

1. **Compare estimates to actual sales** - Track prediction accuracy
2. **A/B test with and without adjustment** - Measure improvement
3. **Review outliers** - Identify edge cases needing refinement
4. **Gather appraiser feedback** - Validate against professional opinions

## Future Enhancements

Potential improvements to consider:

1. **Dynamic amenity weights** - Weight transit higher than parks
2. **Time-based value zone trends** - Track appreciation rates by area  
3. **School district premiums** - Add education quality factor
4. **Crime/safety adjustments** - Incorporate neighborhood safety data
5. **Machine learning calibration** - Let model learn optimal weights

## Conclusion

This location-based pricing equation provides a systematic, data-driven approach to answering: **"How much should location affect the price when close to amenities and expensive homes, while similar properties are many blocks away?"**

The answer: **Between -5% and +8% of base value**, broken down into three quantifiable factors that reflect real market dynamics visualized in your heat maps.
