# Heat Map to Equation Mapping Guide

## Visual Reference: How Each Heat Map Affects Pricing

```
┌─────────────────────────────────────────────────────────────────┐
│                    YOUR THREE HEAT MAPS                         │
└─────────────────────────────────────────────────────────────────┘

[WEIGHTS INFLUENCE]         [VALUE ZONES]           [AMENITIES]
   (Purple/Pink)            (Blue→Pink)             (Green Glow)
     
    🟣 🟣 🟣                 💙 💙 💙                🟢 🟢 🟢
    🟪 🟪 🟪       →         💜 💜 💜       →        🟢 🟢 🟢
    💗 💗 💗                 💗 💗 💗                🟢 🟢 🟢

                                ⬇
                   
┌─────────────────────────────────────────────────────────────────┐
│                    LOCATION ADJUSTMENT                          │
└─────────────────────────────────────────────────────────────────┘

        Factor 3              Factor 2              Factor 1
    (Comp Distance)      (Value Clustering)   (Amenity Proximity)
```

---

## Map 1: Weights Influence → Factor 3 (Comp Distance Penalty)

### What the Map Shows:
Purple/pink intensity indicates which properties have the most influence on your valuation.

### How It Affects Pricing:
```
If most purple/pink dots are FAR from target property:
  ⚠️  Comp Distance Penalty: -1% to -3%
  
If most purple/pink dots are NEAR target property:
  ✅ No penalty (0%)
```

### The Logic:
When your best comparable properties (high weights) are many blocks away, the valuation has higher uncertainty. Apply a modest penalty.

**Equation Component:**
```javascript
avgCompDistance = average distance to all purple/pink (included) comps

if (avgCompDistance > 0.125 miles) {
    penalty = -min(3%, (avgCompDistance - 0.125) × 5%)
}
```

**Example:**
- Target property: 1220 Dean St
- High-weight comps average: 0.7 miles away (10 blocks)
- Penalty: -min(3%, 0.575 × 5%) = **-2.88%**

---

## Map 2: Value Zones → Factor 2 (Value Clustering)

### What the Map Shows:
- **Pink/Hot zones** = Expensive properties cluster together
- **Blue/Cool zones** = Less expensive properties cluster
- Gradient shows price distribution across the neighborhood

### How It Affects Pricing:
```
If target is in PINK ZONE (surrounded by expensive homes):
  ✨ Value Zone Premium: +1% to +3%
  
If target is in BLUE ZONE (surrounded by cheaper homes):
  ⚠️  Value Zone Discount: -1% to -3%
  
If target is in MIXED/PURPLE ZONE:
  ➡️  Neutral (±0.5%)
```

### The Logic:
Properties in established expensive neighborhoods command premiums. Properties in cheaper areas face discounts. This is the "neighborhood effect."

**Equation Component:**
```javascript
nearbyComps = properties within 2 blocks (0.125 miles)
nearbyMedianPrice = median price of nearby properties
overallMedianPrice = median price of ALL comps

priceDiff = (nearbyMedianPrice - overallMedianPrice) / overallMedianPrice
adjustment = clamp(priceDiff × 0.5, -3%, +3%)
```

**Example:**
- Target property: surrounded by pink zone (hot zone)
- Nearby (2 blocks): $475/sqft median
- Overall market: $450/sqft median
- Difference: +5.6%
- Adjustment: 5.6% × 0.5 = **+2.8%** (value zone premium)

---

## Map 3: Amenities → Factor 1 (Amenity Proximity Premium)

### What the Map Shows:
Green glow around:
- 🚇 Subway stations (brightest green)
- 🍴 Restaurant corridors
- 🌳 Parks
- 🏪 Commercial areas

### How It Affects Pricing:
```
If target has BRIGHT GREEN GLOW (very walkable):
  ✨ Amenity Premium: +3% to +5%
  
If target has DIM GREEN GLOW (moderately walkable):
  ✅ Amenity Premium: +1% to +3%
  
If target has NO GREEN GLOW (not walkable):
  ⚠️  No premium (0%)
```

### The Logic:
Proximity to transit, restaurants, and amenities is highly valued in Brooklyn. The closer you are, the higher the premium. This follows exponential decay.

**Equation Component:**
```javascript
distanceToNearestAmenity = measured in miles

amenityWeight = e^(-distance / 0.5)  // Exponential decay, half-life = 0.5 miles
premium = amenityWeight × 5%  // Scale to 0-5% range
```

**Example:**
- Target property: 0.2 miles from Nostrand A/C station (bright green)
- Weight: e^(-0.2/0.5) = 0.67
- Premium: 0.67 × 5% = **+3.4%** (amenity premium)

---

## Combined Effect: All Three Maps Together

### Visual Interpretation:

```
TARGET PROPERTY LOCATION PROFILE:

┌────────────────────────────────────────────────────────────┐
│ Map 1 (Weights):  Purple dots 8 blocks away → -2.88%      │
│ Map 2 (Values):   Pink hot zone nearby    → +2.8%         │  
│ Map 3 (Amenities): Bright green glow      → +3.4%         │
├────────────────────────────────────────────────────────────┤
│ TOTAL LOCATION ADJUSTMENT:                   +3.32%       │
└────────────────────────────────────────────────────────────┘
```

### Dollar Amount Calculation:

```
Base Value: 2,500 sqft × $450/sqft = $1,125,000

Factor 1 (Amenities):   $1,125,000 × +3.4% = +$38,250
Factor 2 (Value Zone):  $1,125,000 × +2.8% = +$31,500
Factor 3 (Comp Dist):   $1,125,000 × -2.88% = -$32,400
                                              ─────────
TOTAL LOCATION ADJUSTMENT:                    +$37,350

FINAL ESTIMATE: $1,125,000 + $37,350 = $1,162,350
```

---

## How to Use This Guide

### Step 1: Look at the Amenities Map (Green)
- **Bright green around target?** → Expect +3-5% amenity premium
- **Dim green?** → Expect +1-3% amenity premium  
- **No green?** → No amenity premium

### Step 2: Look at the Value Zones Map (Blue→Pink)
- **Target in pink zone?** → Expect +1-3% neighborhood premium
- **Target in blue zone?** → Expect -1-3% neighborhood discount
- **Target in purple (mixed)?** → Expect ±0.5% (neutral)

### Step 3: Look at the Weights Influence Map (Purple/Pink dots)
- **Purple dots clustered near target?** → No penalty (good data)
- **Purple dots scattered 8+ blocks away?** → Expect -1-3% data penalty

### Step 4: Add Them Up
```
Total = Amenity Premium + Value Zone Effect + Comp Distance Penalty
Typical range: -5% to +8%
```

---

## Real Examples from Your Maps

### Example A: Premium Location (1220 Dean St)
```
🗺️ Amenities Map:    Bright green (close to Nostrand A/C) → +3.4%
🗺️ Value Zones Map:  Pink zone (expensive neighbors)      → +2.8%
🗺️ Weights Map:      Purple dots 8 blocks away            → -2.88%
                                                 TOTAL:     +3.32%
```
**On $1.1M base value = +$36,520 location adjustment**

### Example B: Average Location
```
🗺️ Amenities Map:    Dim green (0.5 mi to transit)       → +1.5%
🗺️ Value Zones Map:  Purple zone (mixed prices)          → +0.2%
🗺️ Weights Map:      Purple dots 5-6 blocks away         → -0.5%
                                                 TOTAL:     +1.2%
```
**On $1.1M base value = +$13,200 location adjustment**

### Example C: Discount Location
```
🗺️ Amenities Map:    No green (0.9 mi to transit)        → +0.3%
🗺️ Value Zones Map:  Blue zone (cheaper neighbors)       → -2.5%
🗺️ Weights Map:      Purple dots 12+ blocks away         → -3.0%
                                                 TOTAL:     -5.2%
```
**On $1.1M base value = -$57,200 location adjustment**

---

## Quick Reference Table

| Your Target Property Is... | Amenities Map | Value Zones Map | Weights Map | Expected Adjustment |
|----------------------------|---------------|-----------------|-------------|---------------------|
| Perfect location           | Bright green  | Pink zone       | Dots nearby | +6% to +8%         |
| Great location             | Bright green  | Pink zone       | Dots far    | +3% to +5%         |
| Good location              | Dim green     | Pink zone       | Dots nearby | +2% to +4%         |
| Average location           | Dim green     | Purple zone     | Dots medium | -1% to +2%         |
| Below average              | No green      | Blue zone       | Dots nearby | -3% to -1%         |
| Poor location              | No green      | Blue zone       | Dots far    | -5% to -8%         |

---

## Color Legend Quick Reference

### Weights Influence Map:
- 🟣 **Deep Purple** = Low weight comps (less influence)
- 🟪 **Medium Purple** = Medium weight comps
- 💗 **Hot Pink** = High weight comps (most influence)

### Value Zones Map:
- 💙 **Blue** = Cheaper properties ($350-400/sqft)
- 💜 **Purple** = Medium properties ($400-450/sqft)
- 💗 **Pink** = Expensive properties ($450-550/sqft)

### Amenities Map:
- 🔴 **Red/No Glow** = Poor walkability (0.7+ mi to amenities)
- 🟡 **Yellow Glow** = Moderate walkability (0.4-0.7 mi)
- 🟢 **Green Glow** = Excellent walkability (0-0.4 mi)

---

## The Bottom Line

**Your three heat maps directly answer your question:**

> "How much should location affect price when close to amenities (Map 3: green) 
> and close to expensive homes (Map 2: pink) while similar properties are 
> many blocks away (Map 1: purple dots scattered)?"

**Answer from the equation:**
```
Amenity proximity (Map 3):    +3% to +5%  (green glow)
Expensive neighbors (Map 2):  +1% to +3%  (pink zone, 2 blocks)
Distant comps (Map 1):        -2% to -3%  (scattered beyond 2 blocks)
                              ───────────
NET EFFECT:                   +2% to +5%

Typical dollar amount: +$22,000 to +$56,000 on a $1.1M property
```

The equation automatically calculates this from your geocoded data and displays it with a full breakdown in the NYC Appraisal Method estimate box.
