import { comparableProperties as importedComps } from './compsData.js';
import { targetProperty as importedTarget } from './targetPropertyData.js';

// Global data storage
let targetProperty = null;
let comparableProperties = [];
let weightingMethod = 'all-weighted'; // 'simple', 'price', 'size', 'date', 'renovated', 'combined', 'all-weighted'
let annualAppreciationRate = 0.05; // 5% annual appreciation (adjustable - fallback only)

// NYC Appraisal Method estimate values (updated on each calculation)
let nycEstimateValue = 0;
let nycPriceSQFT = 0;

// Crown Heights historical appreciation data (2010-2025)
// Sources: Zillow ZHVI, StreetEasy, NYC Department of Finance
// Extended data (2010-2018): Estimates based on Brooklyn market trends
// NOTE: 2010-2018 values should be verified against actual Crown Heights data from:
//   - USPAP (Uniform Standards of Professional Appraisal Practice)
//   - Fannie Mae Selling Guide B4-1.3
//   - Appraisal Institute's "The Appraisal of Real Estate" (15th Edition)
//   - NYC Department of Finance assessment methodology
//   - Local Brooklyn appraiser interviews
/*const CROWN_HEIGHTS_APPRECIATION = {
    2010: 0.015,  // +1.5% (post-recession recovery beginning)
    2011: 0.028,  // +2.8% (gradual recovery)
    2012: 0.042,  // +4.2% (recovery gaining momentum)
    2013: 0.065,  // +6.5% (Brooklyn boom begins)
    2014: 0.095,  // +9.5% (strong appreciation, gentrification acceleration)
    2015: 0.088,  // +8.8% (continued strong growth)
    2016: 0.072,  // +7.2% (market moderating slightly)
    2017: 0.055,  // +5.5% (cooling from peak)
    2018: 0.038,  // +3.8% (market stabilizing)
    2019: 0.045,  // +4.5%
    2020: 0.082,  // +8.2%
    2021: 0.128,  // +12.8% (pandemic boom)
    2022: 0.035,  // +3.5% (cooling market)
    2023: -0.018, // -1.8% (market correction)
    2024: 0.048,  // +4.8% (recovery)
    2025: 0.042   // +4.2% (projected)
};*/

const CROWN_HEIGHTS_APPRECIATION = {
    2010: 0.050,  // +1.5% (post-recession recovery beginning)
    2011: 0.085,  // +2.8% (gradual recovery)
    2012: 0.110,  // +4.2% (recovery gaining momentum)
    2013: 0.18,  // +6.5% (Brooklyn boom begins)
    2014: 0.200,  // +9.5% (strong appreciation, gentrification acceleration)
    2015: 0.145,  // +8.8% (continued strong growth)
    2016: 0.095,  // +7.2% (market moderating slightly)
    2017: 0.075,  // +5.5% (cooling from peak)
    2018: 0.035,  // +3.8% (market stabilizing)
    2019: 0.050,  // +4.5%
    2020: 0.010,  // +8.2%
    2021: 0.080,  // +12.8% (pandemic boom)
    2022: 0.035,  // +3.5% (cooling market)
    2023: -0.018, // -1.8% (market correction)
    2024: 0.05,  // +4.8% (recovery)
    2025: 0.100   // +4.2% (projected)
};

// Weighting and calculation constants
// Updated to align with industry standards (USPAP, Fannie Mae, Appraisal Institute)
// See CODE_REVIEW.md Section 18 for validation details
const WEIGHTING_CONSTANTS = {
    // Date weighting half-life: 525 days (~1.44 years)
    // Properties lose half their weight after this period
    // Exponential decay formula: weight = exp(-days / HALFLIFE)
    // Note: Industry standards suggest 6-12 months for active markets
    // TODO: Consider implementing market-adaptive half-life (365/525/730 days)
    DATE_WEIGHT_HALFLIFE_DAYS: 525,
    
    // Geographic distance weighting: properties closer to key locations get higher weight
    // Half-life distance: properties lose half their weight at this distance (in miles)
    // Exponential decay formula: weight = exp(-distance / HALFLIFE)
    DISTANCE_WEIGHT_HALFLIFE_MILES: 0.5,
    
    // Key location coordinates for distance weighting
    KEY_LOCATIONS: [
        { lat: 40.678606, lng: -73.952939, name: 'Nostrand Ave A/C Station' },  // Primary transit hub
        { lat: 40.677508, lng: -73.955723, name: 'Franklin & Dean Commercial' }  // Primary commercial corridor
    ],
    
    // High influence threshold: 50% above average weight
    // Properties exceeding this threshold are marked as "high influence"
    HIGH_INFLUENCE_MULTIPLIER: 1.5,
    
    // Very high influence threshold: 100% above average weight
    // Properties exceeding this are flagged as having very high influence
    VERY_HIGH_INFLUENCE_MULTIPLIER: 2.0,
    
    // Renovated property weight multiplier (for 'renovated' weighting method)
    // UPDATED: Reduced from 3.0x to 2.0x to align with industry standards
    // Industry standard: 1.5-2.0x for condition matching (per CODE_REVIEW Section 18.A)
    RENOVATED_WEIGHT_MULTIPLIER: 2.0,
    
    // Combined weighting match multipliers (for 'combined' weighting method)
    // UPDATED: Reduced to align with industry standards for characteristic matching
    // When target and comp both renovated: 2x multiplier (reduced from 3.0x)
    RENOVATED_MATCH_MULTIPLIER: 2.0,
    // When target and comp both have original details: 1.5x multiplier (reduced from 2.0x)
    ORIGINAL_DETAILS_MATCH_MULTIPLIER: 1.5,
    
    // All-weighted blend multipliers (for 'all-weighted' method)
    // Applied when properties match target characteristics
    // These remain at industry-standard levels (1.2-1.5x range)
    ALL_WEIGHTED_RENOVATED_MULTIPLIER: 1.5,
    ALL_WEIGHTED_ORIGINAL_DETAILS_MULTIPLIER: 1.3,
    
    // Legacy blended estimate weights (70/30 split)
    // Note: Now using data-calibrated weights in production
    BLENDED_BUILDING_WEIGHT: 0.7,  // 70% building-based estimate
    BLENDED_LAND_WEIGHT: 0.3,       // 30% total property-based estimate
    
    // Invalid date penalty weight
    // Properties with missing/invalid sale dates get 10% of normal weight
    INVALID_DATE_PENALTY_WEIGHT: 0.1,
    
    // Property adjustment factor constants (for CMA-style comparable adjustments)
    // All values validated against industry standards (CODE_REVIEW Section 18.E)
    // ✅ All within industry norms per USPAP/Fannie Mae guidelines
    ADJUSTMENT_SIZE_PER_100SQFT: 0.02,        // ±2% per 100 SQFT difference (industry: 1-3%)
    ADJUSTMENT_RENOVATION_PREMIUM: 0.10,       // +10% if comp is renovated vs non-renovated target (industry: 5-20%)
    ADJUSTMENT_RENOVATION_DISCOUNT: 0.10,      // -10% if comp is non-renovated vs renovated target (industry: 5-20%)
    ADJUSTMENT_LOT_PER_500SQFT: 0.01,         // ±1% per 500 SQFT lot size difference (industry: 0.5-2%) [CMA display only - actual NYC calc uses regression]
    ADJUSTMENT_WIDTH_PER_FOOT: 0.015,         // ±1.5% per foot of width difference (industry: 1-2%)
    ADJUSTMENT_ORIGINAL_DETAILS_PREMIUM: 0.05, // +5% if comp has original details vs target without (industry: 3-8%)
    
    // Similarity score weighting factors (lower score = better match)
    // These determine how much each factor contributes to the overall similarity score
    SIMILARITY_ADJUSTMENT_WEIGHT: 3.0,        // CMA adjustment % is most important
    SIMILARITY_SIZE_WEIGHT: 1.5,              // Building size difference weight
    SIMILARITY_LOT_WEIGHT: 1.0,               // Lot size difference weight
    SIMILARITY_WIDTH_WEIGHT: 2.0,             // Width difference weight (per foot)
    SIMILARITY_DATE_WEIGHT: 0.5,              // Date recency weight (per year)
    SIMILARITY_RENOVATION_MISMATCH: 5.0,      // Renovation status mismatch penalty
    SIMILARITY_ORIGINAL_DETAILS_MISMATCH: 3.0 // Original details mismatch penalty
};

// Map-related globals
let map = null;
let markersLayer = null;
let heatmapLayer = null;
let valueZonesLayer = null;
let amenitiesOverlayLayer = null;
let showHeatmap = false; // Independent toggle for weights influence heatmap
let showValueZones = false; // Independent toggle for value zones
let geocodingInProgress = false;
let showAmenitiesOverlay = false;

/**
 * Calculate distance in miles between two lat/lng coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lng1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lng2 - Longitude of second point
 * @returns {number} Distance in miles
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calculate minimum distance from a property to any key location
 * Returns exponential decay multiplier based on proximity (1.0 = at location, 0.5 = at half-life distance)
 * @param {Object} property - Property with coordinates {lat, lng}
 * @returns {number} Distance weight multiplier (1.0 = closest, decays exponentially with distance)
 */
function calculateDistanceWeight(property) {
    if (!property.coordinates) return 1.0; // No penalty if coordinates missing
    
    // Find minimum distance to any key location
    let minDistance = Infinity;
    WEIGHTING_CONSTANTS.KEY_LOCATIONS.forEach(location => {
        const distance = calculateDistance(
            property.coordinates.lat,
            property.coordinates.lng,
            location.lat,
            location.lng
        );
        minDistance = Math.min(minDistance, distance);
    });
    
    // Store distance on property for display purposes
    property.distanceToKeyLocation = minDistance;
    
    // Apply exponential decay: weight = exp(-distance / halflife)
    // At 0 miles: multiplier = 1.0 (100% weight)
    // At 0.5 miles (halflife): multiplier = 0.607 (~60% weight)
    // At 1.0 miles: multiplier = 0.135 (~14% weight)
    const halflife = WEIGHTING_CONSTANTS.DISTANCE_WEIGHT_HALFLIFE_MILES;
    return Math.exp(-minDistance / halflife);
}

// Patch HTMLCanvasElement.prototype.getContext globally to set willReadFrequently for all 2D contexts
(function () {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextType, contextAttributes) {
        if (contextType === '2d') {
            return originalGetContext.call(this, contextType, { ...contextAttributes, willReadFrequently: true });
        }
        return originalGetContext.call(this, contextType, contextAttributes);
    };
})();

// Utility function to parse currency strings
function parseCurrency(value) {
    if (!value || value === 'N/A' || value === '$0.00') return 0;
    return parseFloat(String(value).replace(/[$,]/g, ''));
}

// Utility function to format currency
function formatCurrency(value) {
    if (!value || value === 0) return '$0.00';
    const isNegative = value < 0;
    const absValue = Math.abs(value);
    const formatted = absValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return isNegative ? '-$' + formatted : '$' + formatted;
}

/**
 * Parse MM/DD/YYYY or MM/DD/YY date format used in ACRIS data
 * @param {string} dateString - Date in MM/DD/YYYY or MM/DD/YY format
 * @returns {Date|null} - Parsed Date object or null if invalid
 */
function parseACRISDate(dateString) {
    if (!dateString || dateString === 'N/A') return null;
    
    const dateParts = dateString.split('/');
    if (dateParts.length !== 3) return null;
    
    const month = parseInt(dateParts[0]);
    const day = parseInt(dateParts[1]);
    let year = parseInt(dateParts[2]);
    
    // Handle 2-digit years: 00-49 = 2000-2049, 50-99 = 1950-1999
    if (year < 100) {
        year += year < 50 ? 2000 : 1900;
    }
    
    // Validate date components
    if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    
    return new Date(year, month - 1, day);
}

/**
 * Calculate days between two dates
 * @param {Date} fromDate - Earlier date
 * @param {Date} toDate - Later date (default: today)
 * @returns {number} - Number of days difference
 */
function daysBetween(fromDate, toDate = new Date()) {
    if (!fromDate || !toDate) return 0;
    return (toDate - fromDate) / (1000 * 60 * 60 * 24);
}

/**
 * Calculate weights for comparable properties based on selected weighting method
 * Centralizes all weight calculation logic to eliminate duplication
 * @param {Array} properties - Array of comparable properties (must be included and have valid data)
 * @param {Object} targetProperty - Target property object for comparison
 * @param {string} method - Weighting method: 'simple', 'price', 'size', 'date', 'renovated', 'combined', 'all-weighted'
 * @returns {Array} - Array of weight percentages (sum = 100) for each property
 */
function calculatePropertyWeights(properties, targetProperty, method) {
    if (!properties || properties.length === 0) return [];
    
    let rawWeights = [];
    
    // Calculate raw weights based on method
    switch(method) {
        case 'simple':
            // Equal weight for all properties
            rawWeights = properties.map(() => 1.0);
            break;
            
        case 'price':
            // Properties weighted by their sale price
            rawWeights = properties.map(p => p.adjustedSalePrice);
            break;
            
        case 'size':
            // Properties weighted by size similarity to target
            const targetSize = targetProperty.buildingSQFT;
            rawWeights = properties.map(p => {
                const compSize = p.buildingSQFT;
                const sizeDiff = Math.abs(compSize - targetSize);
                return 1 / (1 + sizeDiff / targetSize);
            });
            break;
            
        case 'date':
            // Properties weighted by sale date recency
            rawWeights = properties.map(p => {
                const saleDate = parseACRISDate(p.sellDate);
                if (!saleDate) return WEIGHTING_CONSTANTS.INVALID_DATE_PENALTY_WEIGHT;
                const daysSinceSale = daysBetween(saleDate);
                return Math.exp(-daysSinceSale / WEIGHTING_CONSTANTS.DATE_WEIGHT_HALFLIFE_DAYS);
            });
            break;
            
        case 'renovated':
            // Renovated properties weighted higher
            rawWeights = properties.map(p => p.renovated === 'Yes' ? WEIGHTING_CONSTANTS.RENOVATED_WEIGHT_MULTIPLIER : 1.0);
            break;
            
        case 'combined':
            // Combined weighting based on renovated and original details matching
            rawWeights = properties.map(p => {
                let weight = 1.0;
                if (targetProperty.renovated === p.renovated) weight *= WEIGHTING_CONSTANTS.RENOVATED_MATCH_MULTIPLIER;
                if (targetProperty.originalDetails === p.originalDetails) weight *= WEIGHTING_CONSTANTS.ORIGINAL_DETAILS_MATCH_MULTIPLIER;
                return weight;
            });
            break;
            
        case 'all-weighted':
            // Comprehensive blend of all factors
            const totalPrice = properties.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
            const targetBuildingSize = targetProperty.buildingSQFT;
            
            rawWeights = properties.map(p => {
                let weight = 1.0;
                
                // Price component
                if (totalPrice > 0) {
                    weight *= (p.adjustedSalePrice / totalPrice) * properties.length;
                }
                
                // Size similarity component
                const compSize = p.buildingSQFT;
                const sizeDiff = Math.abs(compSize - targetBuildingSize);
                const sizeWeight = 1 / (1 + sizeDiff / targetBuildingSize);
                weight *= sizeWeight * properties.length;
                
                // Date recency component
                const saleDate = parseACRISDate(p.sellDate);
                if (saleDate) {
                    const daysSinceSale = daysBetween(saleDate);
                    const dateWeight = Math.exp(-daysSinceSale / WEIGHTING_CONSTANTS.DATE_WEIGHT_HALFLIFE_DAYS);
                    weight *= dateWeight * properties.length;
                }
                
                // Geographic proximity component
                // Properties closer to key locations (transit, commercial) get higher weight
                const distanceWeight = calculateDistanceWeight(p);
                weight *= distanceWeight * properties.length;
                
                // Qualitative match multipliers
                if (p.renovated === targetProperty.renovated) weight *= WEIGHTING_CONSTANTS.ALL_WEIGHTED_RENOVATED_MULTIPLIER;
                if (p.originalDetails === targetProperty.originalDetails) weight *= WEIGHTING_CONSTANTS.ALL_WEIGHTED_ORIGINAL_DETAILS_MULTIPLIER;
                
                return weight;
            });
            break;
            
        default:
            // Default to simple equal weighting
            rawWeights = properties.map(() => 1.0);
    }
    
    // Normalize to percentages (sum = 100)
    const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) return properties.map(() => 100 / properties.length); // Fallback to equal weights
    
    return rawWeights.map(w => (w / totalWeight) * 100);
}

/**
 * Calculate adjustment factor for a comparable property based on differences from target
 * Standard in real estate appraisal (CMA - Comparative Market Analysis)
 * Adjustments are additive to show true property differences
 * 
 * @param {Object} comp - Comparable property object
 * @param {Object} target - Target property object
 * @returns {Object} - { adjustmentFactor: number, breakdown: object with individual adjustments }
 */
function calculatePropertyAdjustments(comp, target) {
    let totalAdjustmentPercent = 0;
    const breakdown = {
        size: 0,
        renovation: 0,
        lotSize: 0,
        width: 0,
        originalDetails: 0
    };
    
    // Size adjustment: ±2% per 100 sq ft difference
    // If comp is LARGER than target, adjust price DOWN (comp is worth more, so reduce its price)
    // If comp is SMALLER than target, adjust price UP (comp is worth less, so increase its price)
    if (comp.buildingSQFT && target.buildingSQFT) {
        const sizeDiff = comp.buildingSQFT - target.buildingSQFT;
        const sizeAdjustment = -(sizeDiff / 100) * WEIGHTING_CONSTANTS.ADJUSTMENT_SIZE_PER_100SQFT;
        breakdown.size = sizeAdjustment;
        totalAdjustmentPercent += sizeAdjustment;
    }
    
    // Renovation adjustment: ±10% for renovation status mismatch
    // If comp is renovated but target isn't, reduce comp price (it's worth more than target)
    // If comp is not renovated but target is, increase comp price (it's worth less than target)
    if (comp.renovated && target.renovated) {
        if (comp.renovated === 'Yes' && target.renovated === 'No') {
            breakdown.renovation = -WEIGHTING_CONSTANTS.ADJUSTMENT_RENOVATION_PREMIUM;
            totalAdjustmentPercent -= WEIGHTING_CONSTANTS.ADJUSTMENT_RENOVATION_PREMIUM;
        } else if (comp.renovated === 'No' && target.renovated === 'Yes') {
            breakdown.renovation = WEIGHTING_CONSTANTS.ADJUSTMENT_RENOVATION_DISCOUNT;
            totalAdjustmentPercent += WEIGHTING_CONSTANTS.ADJUSTMENT_RENOVATION_DISCOUNT;
        }
    }
    
    // Lot size adjustment: ±1% per 500 sq ft difference
    // If comp has LARGER lot than target, adjust price DOWN (comp is worth more)
    // If comp has SMALLER lot than target, adjust price UP (comp is worth less)
    if (comp.propertySQFT && target.propertySQFT) {
        const lotDiff = comp.propertySQFT - target.propertySQFT;
        const lotAdjustment = -(lotDiff / 500) * WEIGHTING_CONSTANTS.ADJUSTMENT_LOT_PER_500SQFT;
        breakdown.lotSize = lotAdjustment;
        totalAdjustmentPercent += lotAdjustment;
    }
    
    // Width adjustment: ±1.5% per foot difference
    // If comp is WIDER than target, adjust price DOWN (comp is worth more)
    // If comp is NARROWER than target, adjust price UP (comp is worth less)
    if (comp.buildingWidthFeet && target.buildingWidthFeet) {
        const widthDiff = comp.buildingWidthFeet - target.buildingWidthFeet;
        const widthAdjustment = -widthDiff * WEIGHTING_CONSTANTS.ADJUSTMENT_WIDTH_PER_FOOT;
        breakdown.width = widthAdjustment;
        totalAdjustmentPercent += widthAdjustment;
    }
    
    // Original details adjustment: +5% if comp has original details vs target without
    // Period details (moldings, mantels, etc.) add value in historic districts
    if (comp.originalDetails && target.originalDetails) {
        if (comp.originalDetails === 'Yes' && target.originalDetails === 'No') {
            breakdown.originalDetails = -WEIGHTING_CONSTANTS.ADJUSTMENT_ORIGINAL_DETAILS_PREMIUM;
            totalAdjustmentPercent -= WEIGHTING_CONSTANTS.ADJUSTMENT_ORIGINAL_DETAILS_PREMIUM;
        } else if (comp.originalDetails === 'No' && target.originalDetails === 'Yes') {
            breakdown.originalDetails = WEIGHTING_CONSTANTS.ADJUSTMENT_ORIGINAL_DETAILS_PREMIUM;
            totalAdjustmentPercent += WEIGHTING_CONSTANTS.ADJUSTMENT_ORIGINAL_DETAILS_PREMIUM;
        }
    }
    
    const adjustmentFactor = 1.0 + totalAdjustmentPercent;
    
    return {
        adjustmentFactor,
        breakdown,
        totalAdjustmentPercent: totalAdjustmentPercent * 100
    };
}

/**
 * Calculate similarity score for a comparable property
 * Lower score = better match to target property
 * Combines CMA adjustments with property characteristic differences
 * @param {Object} comp - Comparable property object
 * @param {Object} target - Target property object
 * @returns {Object} - { score: number, breakdown: object, rating: string }
 */
function calculateSimilarityScore(comp, target) {
    let score = 0;
    const breakdown = {};
    
    // 1. CMA Adjustment component (most important - typically 0-30 points)
    const adjustment = calculatePropertyAdjustments(comp, target);
    const adjustmentPoints = Math.abs(adjustment.totalAdjustmentPercent) * WEIGHTING_CONSTANTS.SIMILARITY_ADJUSTMENT_WEIGHT;
    breakdown.adjustment = adjustmentPoints;
    score += adjustmentPoints;
    
    // 2. Building size difference (typically 0-15 points)
    if (comp.buildingSQFT && target.buildingSQFT) {
        const sizeDiffPercent = Math.abs(comp.buildingSQFT - target.buildingSQFT) / target.buildingSQFT * 100;
        const sizePoints = sizeDiffPercent * WEIGHTING_CONSTANTS.SIMILARITY_SIZE_WEIGHT;
        breakdown.size = sizePoints;
        score += sizePoints;
    }
    
    // 3. Lot size difference (typically 0-10 points)
    if (comp.propertySQFT && target.propertySQFT) {
        const lotDiffPercent = Math.abs(comp.propertySQFT - target.propertySQFT) / target.propertySQFT * 100;
        const lotPoints = lotDiffPercent * WEIGHTING_CONSTANTS.SIMILARITY_LOT_WEIGHT;
        breakdown.lot = lotPoints;
        score += lotPoints;
    }
    
    // 4. Width difference (typically 0-10 points)
    if (comp.buildingWidthFeet && target.buildingWidthFeet) {
        const widthDiff = Math.abs(comp.buildingWidthFeet - target.buildingWidthFeet);
        const widthPoints = widthDiff * WEIGHTING_CONSTANTS.SIMILARITY_WIDTH_WEIGHT;
        breakdown.width = widthPoints;
        score += widthPoints;
    }
    
    // 5. Sale date recency (typically 0-5 points)
    const saleDate = parseACRISDate(comp.sellDate);
    if (saleDate) {
        const yearsAgo = daysBetween(saleDate) / 365.25;
        const datePoints = yearsAgo * WEIGHTING_CONSTANTS.SIMILARITY_DATE_WEIGHT;
        breakdown.date = datePoints;
        score += datePoints;
    } else {
        breakdown.date = 5.0; // Penalty for missing date
        score += 5.0;
    }
    
    // 6. Renovation status mismatch (0 or 5 points)
    if (comp.renovated && target.renovated) {
        if (comp.renovated !== target.renovated) {
            breakdown.renovation = WEIGHTING_CONSTANTS.SIMILARITY_RENOVATION_MISMATCH;
            score += WEIGHTING_CONSTANTS.SIMILARITY_RENOVATION_MISMATCH;
        } else {
            breakdown.renovation = 0;
        }
    }
    
    // 7. Original details mismatch (0 or 3 points)
    if (comp.originalDetails && target.originalDetails) {
        if (comp.originalDetails !== target.originalDetails) {
            breakdown.originalDetails = WEIGHTING_CONSTANTS.SIMILARITY_ORIGINAL_DETAILS_MISMATCH;
            score += WEIGHTING_CONSTANTS.SIMILARITY_ORIGINAL_DETAILS_MISMATCH;
        } else {
            breakdown.originalDetails = 0;
        }
    }
    
    // Determine rating based on score
    let rating = 'Fair';
    if (score < 10) rating = 'Excellent';
    else if (score < 20) rating = 'Good';
    else if (score < 35) rating = 'Fair';
    else rating = 'Poor';
    
    return {
        score: Math.round(score * 10) / 10, // Round to 1 decimal
        breakdown,
        rating
    };
}

// Utility function to format number
function formatNumber(value, decimals = 2) {
    if (!value) return '0';
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Format lot dimensions as W'×D'
 * @param {number} widthFeet - Width in feet
 * @param {number} depthFeet - Depth in feet
 * @param {boolean} useFormatNumber - Whether to format numbers with commas (default: false)
 * @returns {string} - Formatted lot dimensions (e.g., "25'×100'")
 */
function formatLotDimensions(widthFeet, depthFeet) {
    return `${widthFeet}'×${depthFeet}'`;
}

/**
 * Format building dimensions as W'×D'×Ffl
 * @param {number} widthFeet - Width in feet
 * @param {number} depthFeet - Depth in feet
 * @param {number} floors - Number of floors
 * @param {boolean} useFormatNumber - Whether to format numbers with commas (default: false)
 * @returns {string} - Formatted building dimensions (e.g., "20'×50'×3fl")
 */
function formatBuildingDimensions(widthFeet, depthFeet, floors) {
    return `${widthFeet}'×${depthFeet}'×${floors}fl`;
}

/**
 * Format price per SQFT tooltip showing building and total property values
 * @param {number} buildingPriceSQFT - Building price per SQFT
 * @param {number} totalPriceSQFT - Total property price per SQFT
 * @returns {string} - Formatted tooltip text
 */
function formatPriceSQFTTooltip(buildingPriceSQFT, totalPriceSQFT) {
    return `Building: ${formatCurrency(buildingPriceSQFT)}\\nTotal Property: ${formatCurrency(totalPriceSQFT)}`;
}

/**
 * Format sale price tooltip with appreciation details
 * @param {Object} prop - Property object with sale and appreciation data
 * @returns {string} - Formatted tooltip text
 */
function formatSalePriceTooltip(prop) {
    if (prop.appreciationAmount > 1000) {
        return `Sale Date: ${prop.sellDate}\\nOriginal: ${formatCurrency(prop.originalSalePrice || prop.salePrice)}\\nAdjustment: +${formatCurrency(prop.appreciationAmount)} (±${(prop.appreciationUncertainty || 0).toFixed(1)}%)\\nMethod: ${prop.appreciationMethod || 'compound'}\\nRange: ${formatCurrency(prop.adjustedSalePriceLow || prop.adjustedSalePrice)} - ${formatCurrency(prop.adjustedSalePriceHigh || prop.adjustedSalePrice)}`;
    }
    return `Sale Date: ${prop.sellDate}`;
}

/**
 * Format adjustment breakdown tooltip
 * @param {number} adjPercent - Total adjustment percentage
 * @param {Object} breakdown - Breakdown object with individual adjustments
 * @returns {string} - Formatted tooltip text
 */
function formatAdjustmentTooltip(adjPercent, breakdown) {
    let tooltip = `Total: ${adjPercent >= 0 ? '+' : ''}${adjPercent.toFixed(1)}%\n`;
    if (breakdown.size !== 0) tooltip += `Size: ${(breakdown.size * 100).toFixed(1)}%\n`;
    if (breakdown.renovation !== 0) tooltip += `Renovation: ${(breakdown.renovation * 100).toFixed(1)}%\n`;
    if (breakdown.lotSize !== 0) tooltip += `Lot Size: ${(breakdown.lotSize * 100).toFixed(1)}%\n`;
    if (breakdown.width !== 0) tooltip += `Width: ${(breakdown.width * 100).toFixed(1)}%\n`;
    if (breakdown.originalDetails !== 0) tooltip += `Details: ${(breakdown.originalDetails * 100).toFixed(1)}%\n`;
    return tooltip;
}

/**
 * Format similarity score tooltip
 * @param {number} score - Similarity score
 * @param {string} rating - Rating (Excellent, Good, Fair, Poor)
 * @param {Object} breakdown - Breakdown object with individual components
 * @returns {string} - Formatted tooltip text
 */
function formatSimilarityTooltip(score, rating, breakdown) {
    return `Similarity: ${score.toFixed(1)} (${rating})\n` +
        `Adjustment: ${(breakdown.adjustment || 0).toFixed(1)}\n` +
        `Building Diff: ${(breakdown.size || 0).toFixed(1)}\n` +
        `Lot Diff: ${(breakdown.lot || 0).toFixed(1)}\n` +
        `Width Diff: ${(breakdown.width || 0).toFixed(1)}\n` +
        `Date: ${(breakdown.date || 0).toFixed(1)}\n` +
        `Renovation: ${(breakdown.renovation || 0).toFixed(1)}\n` +
        `Details: ${(breakdown.originalDetails || 0).toFixed(1)}`;
}

/**
 * Build adjustment cell HTML
 * @param {boolean} included - Whether property is included
 * @param {string} adjTooltip - Tooltip text
 * @param {number} adjPercent - Adjustment percentage
 * @returns {string} - HTML for adjustment cell
 */
function buildAdjustmentCell(included, adjTooltip, adjPercent) {
    if (!included) return '<td class="adjustment-cell">-</td>';
    const color = adjPercent > 0 ? '#27ae60' : adjPercent < 0 ? '#e74c3c' : '#666';
    const fontWeight = Math.abs(adjPercent) > 5 ? '600' : '400';
    const sign = adjPercent >= 0 ? '+' : '';
    return `<td class="adjustment-cell" title="${adjTooltip}" style="color: ${color}; font-weight: ${fontWeight};">${sign}${adjPercent.toFixed(1)}%</td>`;
}

/**
 * Build weight cell HTML
 * @param {string} weightingMethod - Current weighting method
 * @param {boolean} included - Whether property is included
 * @param {number} weightPercent - Weight percentage
 * @returns {string} - HTML for weight cell
 */
function buildWeightCell(weightingMethod, included, weightPercent) {
    if (weightingMethod === 'simple') {
        return '<td class="weight-cell" style="display: none;">-</td>';
    }
    const content = included ? formatNumber(weightPercent, 1) + '%' : '-';
    return `<td class="weight-cell">${content}</td>`;
}

/**
 * Build similarity cell HTML with color coding
 * @param {Object|null} similarity - Similarity object with score, rating, breakdown
 * @param {boolean} isBestMatch - Whether this is the best match
 * @returns {string} - HTML for similarity cell
 */
function buildSimilarityCell(similarity, isBestMatch) {
    if (!similarity) return '<td class="similarity-cell">-</td>';
    
    const score = similarity.score;
    const rating = similarity.rating;
    
    // Color coding based on rating
    let color = '#666';
    if (rating === 'Excellent') color = '#27ae60';
    else if (rating === 'Good') color = '#f39c12';
    else if (rating === 'Fair') color = '#e67e22';
    else if (rating === 'Poor') color = '#e74c3c';
    
    const similarityTooltip = formatSimilarityTooltip(score, rating, similarity.breakdown);
    const bestMatchBadge = isBestMatch ? '<span class="badge badge-best-match" style="margin-left: 4px;">★</span>' : '';
    const fontWeight = score < 20 ? '600' : '400';
    
    return `<td class="similarity-cell" title="${similarityTooltip}" style="color: ${color}; font-weight: ${fontWeight};">${score.toFixed(1)}${bestMatchBadge}</td>`;
}

/**
 * Build sale price cell HTML with appreciation styling
 * @param {Object} prop - Property object
 * @returns {string} - HTML for sale price cell
 */
function buildSalePriceCell(prop) {
    const salePriceTooltip = formatSalePriceTooltip(prop);
    const salePriceStyle = prop.appreciationAmount > 1000 ? 'color: #27ae60; font-weight: 500;' : '';
    return `<td><span style="${salePriceStyle}" title="${salePriceTooltip}">${formatCurrency(prop.adjustedSalePrice)}</span></td>`;
}

/**
 * Render target property row and append to tbody
 * @param {Object} targetProp - Target property object
 * @param {number} medianBuildingPriceSQFT - Median building price per SQFT
 * @param {string} weightingMethod - Weighting method being used
 * @param {HTMLElement} tbody - Table body element to append to
 */
function renderTargetPropertyRow(targetProp, medianBuildingPriceSQFT, weightingMethod, tbody) {
    // Use NYC Appraisal Method values if available, otherwise fall back to median-based estimate
    const targetPriceSQFT = nycPriceSQFT > 0 ? nycPriceSQFT : medianBuildingPriceSQFT;
    const targetEstimatedPrice = nycEstimateValue > 0 ? nycEstimateValue : (targetProp.buildingSQFT * medianBuildingPriceSQFT);
    
    const targetRow = document.createElement('tr');
    targetRow.classList.add('target-property-row');
    const targetLotDimensions = formatLotDimensions(targetProp.propertyWidthFeet, targetProp.propertyDepthFeet);
    const targetBuildingDimensions = formatBuildingDimensions(targetProp.buildingWidthFeet, targetProp.buildingDepthFeet, targetProp.floors);
    targetRow.innerHTML = `
        <td class="checkbox-cell" colspan="2"><span class="badge badge-target">TARGET</span></td>
        <td><strong>${targetProp.address}</strong></td>
        <td>${targetProp.renovated}</td>
        <td>${targetLotDimensions}</td>
        <td>${targetBuildingDimensions}</td>
        <td>${formatNumber(targetProp.buildingSQFT, 2)}</td>
        <td style="color: #ff8c00; font-style: italic;">${formatCurrency(targetPriceSQFT)}</td>
        <td style="color: #ff8c00; font-style: italic;">${formatCurrency(targetEstimatedPrice)}</td>
        <td class="adjustment-cell">-</td>
        <td class="weight-cell" style="${weightingMethod === 'simple' ? 'display: none;' : ''}">-</td>
        <td class="similarity-cell">-</td>
    `;
    tbody.appendChild(targetRow);
}

/**
 * Render a comparable property row and append to tbody
 * @param {Object} prop - Comparable property object
 * @param {Array} included - Array of included properties
 * @param {Array} weights - Array of weight values for included properties
 * @param {Object} targetProperty - Target property object
 * @param {string} weightingMethod - Weighting method being used
 * @param {HTMLElement} tbody - Table body element to append to
 */
function renderComparablePropertyRow(prop, included, weights, targetProperty, weightingMethod, tbody) {
    const row = document.createElement('tr');
    row.id = `comp-${prop.id}`;

    // Calculate weight percentage based on method
    let weightPercent = 0;
    if (prop.included) {
        const propIndex = included.findIndex(p => p.id === prop.id);
        if (propIndex >= 0) {
            weightPercent = weights[propIndex];
        }
    }
    const isHighInfluence = weightPercent > (100 / included.length) * WEIGHTING_CONSTANTS.HIGH_INFLUENCE_MULTIPLIER;
    const isVeryHighInfluence = weightPercent > (100 / included.length) * WEIGHTING_CONSTANTS.VERY_HIGH_INFLUENCE_MULTIPLIER;

    // Calculate similarity score
    const similarity = prop.included ? calculateSimilarityScore(prop, targetProperty) : null;
    const isBestMatch = similarity && similarity.score < 10;
    const isGoodMatch = similarity && similarity.score >= 10 && similarity.score < 20;

    // Check if this is the direct comp
    if (prop.isDirectComp) {
        row.classList.add('highlighted');
    }

    if (!prop.included) {
        row.classList.add('inactive');
    }

    // Add high-influence class if applicable (but not if very high influence)
    if (weightingMethod !== 'simple' && prop.included && isHighInfluence && !isVeryHighInfluence) {
        row.classList.add('high-influence');
    }
    
    // Add very-high-influence class if applicable
    if (weightingMethod !== 'simple' && prop.included && isVeryHighInfluence) {
        row.classList.add('very-high-influence');
    }
    
    // Add outlier class if flagged
    if (prop.isOutlier) {
        row.classList.add('outlier');
    }
    
    // Add best-match class if applicable
    if (isBestMatch) {
        row.classList.add('best-match');
    }

    // Calculate property adjustment for this comp
    const adjustment = calculatePropertyAdjustments(prop, targetProperty);
    const adjPercent = adjustment.totalAdjustmentPercent;
    
    // Build tooltip showing breakdown of adjustments
    const adjTooltip = formatAdjustmentTooltip(adjPercent, adjustment.breakdown);
    
    const adjustmentCell = buildAdjustmentCell(prop.included, adjTooltip, adjPercent);
    const weightCell = buildWeightCell(weightingMethod, prop.included, weightPercent);
    const similarityCell = buildSimilarityCell(similarity, isBestMatch);

    // Build lot dimensions cell
    const lotDimensionsCell = formatLotDimensions(prop.propertyWidthFeet, prop.propertyDepthFeet);
    
    // Build building dimensions cell
    const buildingDimensionsCell = formatBuildingDimensions(prop.buildingWidthFeet, prop.buildingDepthFeet, prop.floors);
    
    // Build price/SQFT cell with tooltip showing total property $/SQFT
    const priceSQFTTooltip = formatPriceSQFTTooltip(prop.buildingPriceSQFT, prop.totalPriceSQFT);
    const priceSQFTCell = `<td title="${priceSQFTTooltip}">${formatCurrency(prop.buildingPriceSQFT)}</td>`;
    
    // Build sale price cell with date and appreciation info in tooltip
    const salePriceCell = buildSalePriceCell(prop);

    row.innerHTML = `
                <td class="checkbox-cell">
                    <input type="checkbox" ${prop.included ? 'checked' : ''} onchange="toggleComp(${prop.id})">
                </td>
                <td class="checkbox-cell">
                    <input type="checkbox" ${prop.isDirectComp ? 'checked' : ''} onchange="toggleDirectComp(${prop.id})">
                </td>
                <td>
                    ${prop.address}
                    ${prop.isDirectComp ? '<span class="badge badge-direct-comp">Direct Comp</span>' : ''}
                    ${weightingMethod !== 'simple' && prop.included && isVeryHighInfluence ? '<span class="badge badge-very-high-influence" title="Weight is 2x+ the average - extremely high influence on estimates">⚠️ Very High Influence</span>' : 
                      weightingMethod !== 'simple' && prop.included && isHighInfluence ? '<span class="badge badge-high-influence" title="Weight is 1.5x+ the average - high influence on estimates">High Influence</span>' : ''}
                    ${prop.isOutlier && prop.included ? '<span class="badge badge-outlier" title="Statistical outlier - unusual price/SQFT">⚠️ Outlier</span>' : ''}
                </td>
                <td>${prop.renovated}</td>
                <td>${lotDimensionsCell}</td>
                <td>${buildingDimensionsCell}</td>
                <td>${formatNumber(prop.buildingSQFT, 2)}</td>
                ${priceSQFTCell}
                ${salePriceCell}
                ${adjustmentCell}
                ${weightCell}
                ${similarityCell}
            `;
    tbody.appendChild(row);
}

// Calculate median from array of numbers
function calculateMedian(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Calculate standard deviation (sample)
function calculateStdDev(values, mean) {
    if (!values || values.length === 0) return 0;
    if (values.length === 1) return 0; // Single value has no deviation
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    // Use sample variance (N-1) for unbiased estimate of population variance
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1);
    return Math.sqrt(variance);
}

/**
 * Validate property data for realistic values
 * Checks dimensions, prices, and other property characteristics against Crown Heights norms
 * @param {Object} property - Property object to validate
 * @param {string} propertyType - 'target' or 'comparable'
 * @returns {Object} - { isValid: boolean, errors: Array, warnings: Array }
 */
function validatePropertyData(property, propertyType = 'property') {
    const errors = [];
    const warnings = [];
    
    // Building width validation (Crown Heights rowhouses: typically 16-25ft)
    if (property.buildingWidthFeet !== undefined && property.buildingWidthFeet !== null) {
        if (property.buildingWidthFeet < 10) {
            errors.push(`Building width ${property.buildingWidthFeet}ft is too narrow (minimum 10ft)`);
        } else if (property.buildingWidthFeet < 14) {
            warnings.push(`Building width ${property.buildingWidthFeet}ft is unusually narrow for Crown Heights`);
        } else if (property.buildingWidthFeet > 30) {
            warnings.push(`Building width ${property.buildingWidthFeet}ft is unusually wide for Crown Heights`);
        } else if (property.buildingWidthFeet > 50) {
            errors.push(`Building width ${property.buildingWidthFeet}ft is unrealistic`);
        }
    }
    
    // Building depth validation (Crown Heights: typically 40-60ft)
    if (property.buildingDepthFeet !== undefined && property.buildingDepthFeet !== null) {
        if (property.buildingDepthFeet < 20) {
            errors.push(`Building depth ${property.buildingDepthFeet}ft is too shallow (minimum 20ft)`);
        } else if (property.buildingDepthFeet < 30) {
            warnings.push(`Building depth ${property.buildingDepthFeet}ft is unusually shallow for Crown Heights`);
        } else if (property.buildingDepthFeet > 70) {
            warnings.push(`Building depth ${property.buildingDepthFeet}ft is unusually deep for Crown Heights`);
        } else if (property.buildingDepthFeet > 100) {
            errors.push(`Building depth ${property.buildingDepthFeet}ft is unrealistic`);
        }
    }
    
    // Floors validation (Crown Heights: typically 2-4 floors)
    if (property.floors !== undefined && property.floors !== null) {
        if (property.floors < 1) {
            errors.push(`Floors (${property.floors}) must be at least 1`);
        } else if (property.floors > 5) {
            warnings.push(`${property.floors} floors is unusual for Crown Heights rowhouses`);
        } else if (property.floors > 7) {
            errors.push(`${property.floors} floors is unrealistic for rowhouse properties`);
        }
    }
    
    // Building SQFT validation (Crown Heights: typically 2,000-5,000 SQFT)
    if (property.buildingSQFT !== undefined && property.buildingSQFT !== null) {
        if (property.buildingSQFT < 500) {
            errors.push(`Building SQFT (${property.buildingSQFT}) is too small (minimum 500)`);
        } else if (property.buildingSQFT < 1500) {
            warnings.push(`Building SQFT (${property.buildingSQFT}) is unusually small for Crown Heights`);
        } else if (property.buildingSQFT > 6000) {
            warnings.push(`Building SQFT (${property.buildingSQFT}) is unusually large for Crown Heights`);
        } else if (property.buildingSQFT > 10000) {
            errors.push(`Building SQFT (${property.buildingSQFT}) is unrealistic for rowhouse properties`);
        }
    }
    
    // Lot size validation (Crown Heights: typically 1,500-2,500 SQFT)
    if (property.propertySQFT !== undefined && property.propertySQFT !== null) {
        if (property.propertySQFT < 500) {
            errors.push(`Lot size (${property.propertySQFT} SQFT) is too small (minimum 500)`);
        } else if (property.propertySQFT < 1000) {
            warnings.push(`Lot size (${property.propertySQFT} SQFT) is unusually small for Crown Heights`);
        } else if (property.propertySQFT > 4000) {
            warnings.push(`Lot size (${property.propertySQFT} SQFT) is unusually large for Crown Heights`);
        } else if (property.propertySQFT > 10000) {
            errors.push(`Lot size (${property.propertySQFT} SQFT) is unrealistic`);
        }
    }
    
    // Price per SQFT validation (Crown Heights: typically $400-$900/SQFT as of 2025)
    if (property.buildingPriceSQFT !== undefined && property.buildingPriceSQFT > 0) {
        if (property.buildingPriceSQFT < 200) {
            warnings.push(`Price/SQFT ($${property.buildingPriceSQFT.toFixed(2)}) is unusually low for Crown Heights`);
        } else if (property.buildingPriceSQFT < 100) {
            errors.push(`Price/SQFT ($${property.buildingPriceSQFT.toFixed(2)}) is unrealistically low`);
        } else if (property.buildingPriceSQFT > 1200) {
            warnings.push(`Price/SQFT ($${property.buildingPriceSQFT.toFixed(2)}) is unusually high for Crown Heights`);
        } else if (property.buildingPriceSQFT > 2000) {
            errors.push(`Price/SQFT ($${property.buildingPriceSQFT.toFixed(2)}) is unrealistically high`);
        }
    }
    
    // Sale price validation (for comparables)
    if (propertyType === 'comparable' && property.adjustedSalePrice !== undefined && property.adjustedSalePrice > 0) {
        if (property.adjustedSalePrice < 500000) {
            warnings.push(`Sale price (${formatCurrency(property.adjustedSalePrice)}) is unusually low for Crown Heights`);
        } else if (property.adjustedSalePrice < 100000) {
            errors.push(`Sale price (${formatCurrency(property.adjustedSalePrice)}) is unrealistically low`);
        } else if (property.adjustedSalePrice > 5000000) {
            warnings.push(`Sale price (${formatCurrency(property.adjustedSalePrice)}) is unusually high for Crown Heights`);
        } else if (property.adjustedSalePrice > 10000000) {
            errors.push(`Sale price (${formatCurrency(property.adjustedSalePrice)}) is unrealistically high`);
        }
    }
    
    // Date validation (for comparables)
    if (propertyType === 'comparable' && property.sellDate) {
        const saleDate = parseACRISDate(property.sellDate);
        if (!saleDate) {
            warnings.push(`Sale date "${property.sellDate}" could not be parsed`);
        } else {
            const yearsAgo = daysBetween(saleDate) / 365.25;
            if (yearsAgo > 10) {
                warnings.push(`Sale date (${property.sellDate}) is over 10 years old - may not reflect current market`);
            } else if (yearsAgo < 0) {
                errors.push(`Sale date (${property.sellDate}) is in the future`);
            }
        }
    }
    
    // Cross-validation: Building should fit on lot
    if (property.buildingSQFT && property.propertySQFT && property.floors) {
        const buildingFootprint = property.buildingSQFT / property.floors;
        if (buildingFootprint > property.propertySQFT) {
            errors.push(`Building footprint (${buildingFootprint.toFixed(0)} SQFT) exceeds lot size (${property.propertySQFT} SQFT)`);
        } else if (buildingFootprint > property.propertySQFT * 0.9) {
            warnings.push(`Building footprint (${buildingFootprint.toFixed(0)} SQFT) covers ${((buildingFootprint / property.propertySQFT) * 100).toFixed(0)}% of lot - very high coverage`);
        }
    }
    
    // Cross-validation: Calculated SQFT should match stated SQFT
    if (property.buildingWidthFeet && property.buildingDepthFeet && property.floors && property.buildingSQFT) {
        const calculatedSQFT = property.buildingWidthFeet * property.buildingDepthFeet * property.floors;
        const difference = Math.abs(calculatedSQFT - property.buildingSQFT);
        const percentDiff = (difference / property.buildingSQFT) * 100;
        
        if (percentDiff > 20) {
            warnings.push(`Calculated building SQFT (${calculatedSQFT.toFixed(0)}) differs from stated SQFT (${property.buildingSQFT}) by ${percentDiff.toFixed(1)}%`);
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        address: property.address || 'Unknown property'
    };
}

/**
 * Display validation results to user
 * @param {Array} validationResults - Array of validation result objects
 */
function displayValidationResults(validationResults) {
    const errorsExist = validationResults.some(r => r.errors.length > 0);
    const warningsExist = validationResults.some(r => r.warnings.length > 0);
    
    if (!errorsExist && !warningsExist) {
        return; // No issues to display
    }
    
    // Create validation panel
    let html = '<div class="validation-panel">';
    
    // Display errors (critical issues)
    const errorResults = validationResults.filter(r => r.errors.length > 0);
    if (errorResults.length > 0) {
        html += '<div class="validation-errors">';
        html += '<h4 style="color: #e74c3c; margin: 0 0 10px 0;">❌ Data Validation Errors</h4>';
        html += '<div style="font-size: 13px; color: #666; margin-bottom: 10px;">Critical issues that may affect calculation accuracy:</div>';
        
        errorResults.forEach(result => {
            html += `<div class="validation-property-section">`;
            html += `<strong style="color: #2c3e50;">${result.address}</strong>`;
            html += '<ul style="margin: 5px 0; padding-left: 20px;">';
            result.errors.forEach(error => {
                html += `<li style="color: #e74c3c;">${error}</li>`;
            });
            html += '</ul></div>';
        });
        html += '</div>';
    }
    
    // Display warnings (non-critical issues)
    const warningResults = validationResults.filter(r => r.warnings.length > 0);
    if (warningResults.length > 0) {
        html += '<div class="validation-warnings">';
        html += '<h4 style="color: #f39c12; margin: 10px 0 10px 0;">⚠️ Data Validation Warnings</h4>';
        html += '<div style="font-size: 13px; color: #666; margin-bottom: 10px;">Unusual values that may warrant review:</div>';
        
        warningResults.forEach(result => {
            html += `<div class="validation-property-section">`;
            html += `<strong style="color: #2c3e50;">${result.address}</strong>`;
            html += '<ul style="margin: 5px 0; padding-left: 20px;">';
            result.warnings.forEach(warning => {
                html += `<li style="color: #856404;">${warning}</li>`;
            });
            html += '</ul></div>';
        });
        html += '</div>';
    }
    
    html += '</div>';
    
    // Insert validation panel at the top of the estimates section
    const estimatesContainer = document.getElementById('estimates');
    if (estimatesContainer) {
        // Remove any existing validation panel
        const existingPanel = estimatesContainer.querySelector('.validation-panel');
        if (existingPanel) {
            existingPanel.remove();
        }
        
        // Insert new panel at the top
        estimatesContainer.insertAdjacentHTML('afterbegin', html);
    }
}

// Calculate Property SQFT
function calculatePropertySQFT(widthFeet, depthFeet) {
    return widthFeet * depthFeet;
}

// Calculate Building SQFT
function calculateBuildingSQFT(widthFeet, depthFeet, floors) {
    return (widthFeet * depthFeet) * floors;
}

// Calculate Total $ SQFT
function calculateTotalPropertySQFT(propertySQFT, buildingSQFT, buildingWidthFeet, buildingDepthFeet) {
    const buildingFootprint = buildingWidthFeet * buildingDepthFeet;
    return (propertySQFT - buildingFootprint) + buildingSQFT;
}

// Calculate Building $ SQFT
function calculateBuildingPriceSQFT(price, buildingSQFT) {
    if (!buildingSQFT || buildingSQFT === 0) return 0;
    return price / buildingSQFT;
}

// Calculate Total $ SQFT
function calculateTotalPriceSQFT(price, propertySQFT, buildingSQFT, buildingWidthFeet, buildingDepthFeet) {
    const total = calculateTotalPropertySQFT(propertySQFT, buildingSQFT, buildingWidthFeet, buildingDepthFeet);
    if (!total || total === 0) return 0;
    return price / total;
}

// Apply time-based appreciation adjustment to a sale price
// Uses industry-standard market-based appreciation with Crown Heights historical data
function applyAppreciationAdjustment(salePrice, sellDate) {
    if (!sellDate || sellDate === 'N/A' || !salePrice || salePrice === 0) {
        return { 
            adjustedPrice: salePrice, 
            adjustedPriceLow: salePrice,
            adjustedPriceHigh: salePrice,
            yearsAgo: 0, 
            appreciationAmount: 0,
            method: 'none',
            uncertainty: 0
        };
    }

    // Parse date (format: MM/DD/YYYY or MM/DD/YY)
    const saleDate = parseACRISDate(sellDate);
    if (!saleDate) {
        return { 
            adjustedPrice: salePrice, 
            adjustedPriceLow: salePrice,
            adjustedPriceHigh: salePrice,
            yearsAgo: 0, 
            appreciationAmount: 0,
            method: 'none',
            uncertainty: 0
        };
    }

    const today = new Date();
    const yearsAgo = daysBetween(saleDate, today) / 365.25;
    const monthsAgo = yearsAgo * 12;

    // Method 1: Recent sales (< 6 months) - No adjustment needed
    if (monthsAgo < 6) {
        return {
            adjustedPrice: salePrice,
            adjustedPriceLow: salePrice * 0.98,  // ±2% uncertainty
            adjustedPriceHigh: salePrice * 1.02,
            yearsAgo,
            appreciationAmount: 0,
            method: 'recent',
            uncertainty: 2.0
        };
    }

    // Method 2: Short-term (< 2 years) - Linear appreciation
    if (yearsAgo < 2) {
        // Calculate average annual rate from historical data for recent years
        const currentYear = today.getFullYear();
        const relevantYears = [];
        for (let y = currentYear - 1; y <= currentYear; y++) {
            if (CROWN_HEIGHTS_APPRECIATION[y]) {
                relevantYears.push(CROWN_HEIGHTS_APPRECIATION[y]);
            }
        }
        
        const avgRate = relevantYears.length > 0 
            ? relevantYears.reduce((sum, r) => sum + r, 0) / relevantYears.length
            : annualAppreciationRate; // Fallback to global rate
        
        const adjustedPrice = salePrice * (1 + (avgRate * yearsAgo));
        const appreciationAmount = adjustedPrice - salePrice;
        
        // ±3% uncertainty for short-term
        return {
            adjustedPrice,
            adjustedPriceLow: adjustedPrice * 0.97,
            adjustedPriceHigh: adjustedPrice * 1.03,
            yearsAgo,
            appreciationAmount,
            method: 'linear',
            uncertainty: 3.0
        };
    }

    // Method 3: Long-term (2+ years) - Year-by-year compounding with historical data
    const saleYear = saleDate.getFullYear();
    const currentYear = today.getFullYear();
    
    let cumulativeMultiplier = 1.0;
    let cumulativeMultiplierLow = 1.0;
    let cumulativeMultiplierHigh = 1.0;
    
    // Apply year-by-year appreciation
    for (let y = saleYear + 1; y <= currentYear; y++) {
        const yearRate = CROWN_HEIGHTS_APPRECIATION[y] || annualAppreciationRate;
        
        // Base appreciation
        cumulativeMultiplier *= (1 + yearRate);
        
        // Confidence bounds: ±2% per year uncertainty (compounds)
        const yearUncertainty = 0.02;
        cumulativeMultiplierLow *= (1 + yearRate - yearUncertainty);
        cumulativeMultiplierHigh *= (1 + yearRate + yearUncertainty);
    }
    
    // Handle partial year (months into current year)
    const monthsIntoCurrentYear = today.getMonth() + 1;
    if (monthsIntoCurrentYear < 12) {
        const currentYearRate = CROWN_HEIGHTS_APPRECIATION[currentYear] || annualAppreciationRate;
        const partialYearFactor = monthsIntoCurrentYear / 12;
        
        // Adjust multipliers for partial year
        const partialMultiplier = 1 + (currentYearRate * partialYearFactor);
        const partialMultiplierLow = 1 + ((currentYearRate - 0.02) * partialYearFactor);
        const partialMultiplierHigh = 1 + ((currentYearRate + 0.02) * partialYearFactor);
        
        // Remove full year and add partial
        cumulativeMultiplier = (cumulativeMultiplier / (1 + currentYearRate)) * partialMultiplier;
        cumulativeMultiplierLow = (cumulativeMultiplierLow / (1 + currentYearRate - 0.02)) * partialMultiplierLow;
        cumulativeMultiplierHigh = (cumulativeMultiplierHigh / (1 + currentYearRate + 0.02)) * partialMultiplierHigh;
    }
    
    const adjustedPrice = salePrice * cumulativeMultiplier;
    const adjustedPriceLow = salePrice * cumulativeMultiplierLow;
    const adjustedPriceHigh = salePrice * cumulativeMultiplierHigh;
    const appreciationAmount = adjustedPrice - salePrice;
    
    // Calculate uncertainty percentage
    const uncertaintyPercent = ((adjustedPriceHigh - adjustedPriceLow) / (2 * adjustedPrice)) * 100;
    
    return {
        adjustedPrice,
        adjustedPriceLow,
        adjustedPriceHigh,
        yearsAgo,
        appreciationAmount,
        method: 'historical',
        uncertainty: uncertaintyPercent
    };
}

// Process imported property data with calculations
function processImportedProperty(prop) {
    const processed = { ...prop };

    // Recalculate SQFT from dimensions
    processed.propertySQFT = calculatePropertySQFT(prop.propertyWidthFeet, prop.propertyDepthFeet);
    processed.buildingSQFT = calculateBuildingSQFT(prop.buildingWidthFeet, prop.buildingDepthFeet, prop.floors);

    // Use sale price for comps
    if (prop.priceOnACRIS !== undefined) {
        processed.salePrice = prop.priceOnACRIS;
        processed.originalSalePrice = prop.priceOnACRIS; // Store original for reference

        // Apply time-based appreciation adjustment
        const adjustment = applyAppreciationAdjustment(processed.salePrice, prop.sellDate);
        processed.adjustedSalePrice = adjustment.adjustedPrice;
        processed.adjustedSalePriceLow = adjustment.adjustedPriceLow;
        processed.adjustedSalePriceHigh = adjustment.adjustedPriceHigh;
        processed.appreciationYears = adjustment.yearsAgo;
        processed.appreciationAmount = adjustment.appreciationAmount;
        processed.appreciationMethod = adjustment.method;
        processed.appreciationUncertainty = adjustment.uncertainty;

        // Recalculate price per SQFT using adjusted price
        processed.buildingPriceSQFT = calculateBuildingPriceSQFT(processed.adjustedSalePrice, processed.buildingSQFT);
        processed.totalPriceSQFT = calculateTotalPriceSQFT(processed.adjustedSalePrice, processed.propertySQFT, processed.buildingSQFT, prop.buildingWidthFeet, prop.buildingDepthFeet);

        // Also store original price per SQFT for comparison
        processed.originalBuildingPriceSQFT = calculateBuildingPriceSQFT(processed.salePrice, processed.buildingSQFT);
        processed.originalTotalPriceSQFT = calculateTotalPriceSQFT(processed.salePrice, processed.propertySQFT, processed.buildingSQFT, prop.buildingWidthFeet, prop.buildingDepthFeet);
    }

    return processed;
}

// Load data from imported objects
function loadData() {
    try {

        // Process comparable properties
        comparableProperties = importedComps.map((prop, index) => {
            const processed = processImportedProperty(prop);
            processed.id = index;
            processed.included = true; // Default to included
            processed.isDirectComp = prop.address && prop.address.includes('1219 Dean St'); // Default direct comp
            return processed;
        });

        // Check if importedTarget is an array or single object
        if (Array.isArray(importedTarget)) {
            // Populate dropdown with target properties
            const dropdown = document.getElementById('target-property-select');
            dropdown.innerHTML = '<option value="">Select a property...</option>';
            importedTarget.forEach((prop, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = prop.address;
                dropdown.appendChild(option);
            });

            // Set first property as default
            if (importedTarget.length > 0) {
                dropdown.value = 0;
                targetProperty = processImportedProperty(importedTarget[0]);
                targetProperty.estimatedSale = importedTarget[0].estimatedSale || 0;
                targetProperty.developerPrice = importedTarget[0].referenceValues?.developerPrice || 0;
                targetProperty.fairMarketValue = importedTarget[0].referenceValues?.fairMarketValue || 0;
            }
        } else {
            // Single target property (backward compatibility)
            targetProperty = processImportedProperty(importedTarget);
            targetProperty.estimatedSale = importedTarget.estimatedSale || 0;
            targetProperty.developerPrice = importedTarget.referenceValues?.developerPrice || 0;
            targetProperty.fairMarketValue = importedTarget.referenceValues?.fairMarketValue || 0;

            // Hide dropdown if only one property
            const dropdown = document.getElementById('target-property-select');
            if (dropdown) dropdown.style.display = 'none';
        }

        // Validate all property data
        const validationResults = [];
        
        // Validate target property
        if (targetProperty) {
            const targetValidation = validatePropertyData(targetProperty, 'target');
            if (targetValidation.errors.length > 0 || targetValidation.warnings.length > 0) {
                validationResults.push(targetValidation);
            }
        }
        
        // Validate comparable properties
        comparableProperties.forEach(prop => {
            const compValidation = validatePropertyData(prop, 'comparable');
            if (compValidation.errors.length > 0 || compValidation.warnings.length > 0) {
                validationResults.push(compValidation);
            }
        });
        
        // Display validation results if any issues found
        if (validationResults.length > 0) {
            console.log('Property validation results:', validationResults);
            // Validation panel will be displayed after rendering estimates
        }

        // Initialize button states to match default weightingMethod
        document.querySelectorAll('.weight-btn').forEach(btn => {
            if (btn.dataset.method === weightingMethod) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Render everything
        renderTargetProperty();
        calculateAndRenderEstimates();
        renderComparables();

        // Display validation results after rendering
        if (validationResults.length > 0) {
            displayValidationResults(validationResults);
        }

        // Initialize column sorting
        initializeColumnSorting();

        // Initialize map
        setTimeout(() => {
            initializeMap();
        }, 100);

    } catch (error) {
        console.error('Error loading data:', error);
        console.error('Error stack:', error.stack);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        alert('Error loading imported data: ' + error.message + '\n\nPlease check the console for details.');
    }
}

// Render target property
function renderTargetProperty() {
    if (!targetProperty) return;

    const container = document.getElementById('target-property-fields');
    
    // Create compact single-line format
    const lotDims = formatLotDimensions(targetProperty.propertyWidthFeet, targetProperty.propertyDepthFeet);
    const buildingDims = formatBuildingDimensions(targetProperty.buildingWidthFeet, targetProperty.buildingDepthFeet, targetProperty.floors).replace(/×/g, ' × ');
    
    container.innerHTML = `
        <div style="display: flex; flex-wrap: wrap; gap: 20px; padding: 12px; background: #f8f9fa; border-radius: 6px; font-size: 13px;">
            <div><strong>Lot:</strong> ${lotDims} (${formatNumber(targetProperty.propertySQFT,0)} sqft)</div>
            <div><strong>Building:</strong> ${buildingDims} (${formatNumber(targetProperty.buildingSQFT,0)} sqft)</div>
            <div><strong>Renovated:</strong> ${targetProperty.renovated}</div>
            <div><strong>Tax Class:</strong> ${targetProperty.taxClass}</div>
            <div><strong>Occupancy:</strong> ${targetProperty.occupancy}</div>
            <div><strong>Annual Taxes:</strong> ${formatCurrency(parseCurrency(targetProperty.taxes))}</div>
        </div>
    `;
}

// Recalculate target property
function recalculateTarget() {
    targetProperty.propertySQFT = calculatePropertySQFT(targetProperty.propertyWidthFeet, targetProperty.propertyDepthFeet);
    targetProperty.buildingSQFT = calculateBuildingSQFT(targetProperty.buildingWidthFeet, targetProperty.buildingDepthFeet, targetProperty.floors);

    renderTargetProperty();
    calculateAndRenderEstimates();
}

// Global variables for sorting
let currentSortColumn = null;
let currentSortDirection = 'asc';

// Render comparable properties table
function renderComparables() {
    const tbody = document.getElementById('comps-tbody');
    tbody.innerHTML = '';

    // Update weight header visibility
    const weightHeader = document.getElementById('weight-header');
    if (weightHeader) {
        weightHeader.style.display = weightingMethod !== 'simple' ? '' : 'none';
    }

    // Calculate weights for all included properties using centralized utility function
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0);
    const weights = calculatePropertyWeights(included, targetProperty, weightingMethod);
    
    // Calculate median $/SQFT from included properties for CMA Price Target
    const buildingPrices = included.map(p => p.buildingPriceSQFT);
    const medianBuildingPriceSQFT = buildingPrices.length > 0 ? calculateMedian(buildingPrices) : 0;

    // Create target property with sorting capabilities
    const targetForSort = { ...targetProperty, isTarget: true };
    
    // Calculate distance for target property
    calculateDistanceWeight(targetForSort);
    
    // Separate target and comparables for sorting
    let sortedComparables = [...comparableProperties];
    let sortedAllProperties = null;
    
    // Sort only comparable properties if a sort column is active
    if (currentSortColumn !== null) {
        // Check if this column has a value for target (columns 2-8 have values: Address, Reno, Lot, Building, SQFT, $/SQFT, Sale Price)
        const targetHasValueForColumn = currentSortColumn >= 2 && currentSortColumn <= 8;
        
        if (targetHasValueForColumn) {
            // Add calculated values to targetForSort for sorting
            targetForSort.buildingPriceSQFT = medianBuildingPriceSQFT;
            targetForSort.adjustedSalePrice = targetForSort.buildingSQFT * medianBuildingPriceSQFT;
            
            // Sort target with comparables and keep the full sorted list
            sortedAllProperties = [targetForSort, ...comparableProperties];
            sortedAllProperties = sortPropertiesByColumn(sortedAllProperties, currentSortColumn, currentSortDirection);
        } else {
            // Target doesn't have value for this column, sort only comparables
            sortedComparables = sortPropertiesByColumn(sortedComparables, currentSortColumn, currentSortDirection);
        }
    }

    // Render rows (target will be in sorted position for columns 2-6, or always first for others)
    if (sortedAllProperties) {
        // Target is sorted with comparables - render in sorted order
        sortedAllProperties.forEach(prop => {
            if (prop.isTarget) {
                // Render target property row with calculated median values
                renderTargetPropertyRow(prop, medianBuildingPriceSQFT, weightingMethod, tbody);
                return; // Skip to next property
            }
            
            // Render comparable property row
            renderComparablePropertyRow(prop, included, weights, targetProperty, weightingMethod, tbody);
        });
    } else {
        // Target stays at top - render target first, then sorted comparables
        renderTargetPropertyRow(targetForSort, medianBuildingPriceSQFT, weightingMethod, tbody);

        // Render comparable property rows
        sortedComparables.forEach(prop => {
            renderComparablePropertyRow(prop, included, weights, targetProperty, weightingMethod, tbody);
        });
    }

    calculateAndRenderAverages();
}

// Sort properties by column
function sortPropertiesByColumn(properties, columnIndex, direction) {
    return properties.sort((a, b) => {
        let aVal, bVal;

        // Map column index to property key
        switch (columnIndex) {
            case 2: // Address
                aVal = a.address;
                bVal = b.address;
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            case 3: // Renovated
                aVal = a.renovated;
                bVal = b.renovated;
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            case 4: // Lot dimensions (W×D) - sort by width primarily
                aVal = a.propertyWidthFeet || 0;
                bVal = b.propertyWidthFeet || 0;
                break;
            case 5: // Building dimensions (W×D×Fl) - sort by building width primarily
                aVal = a.buildingWidthFeet || 0;
                bVal = b.buildingWidthFeet || 0;
                break;
            case 6: // Building SQFT
                aVal = a.buildingSQFT || 0;
                bVal = b.buildingSQFT || 0;
                break;
            case 7: // $/SQFT (Building Price per SQFT)
                aVal = a.buildingPriceSQFT || 0;
                bVal = b.buildingPriceSQFT || 0;
                break;
            case 8: // Sale Price
                aVal = a.adjustedSalePrice || 0;
                bVal = b.adjustedSalePrice || 0;
                break;
            case 9: // Adjustment %
                // Target property doesn't have this value, put it at end when sorting
                if (a.isTarget) {
                    aVal = direction === 'asc' ? Infinity : -Infinity;
                } else {
                    aVal = a.included ? calculatePropertyAdjustments(a, targetProperty).totalAdjustmentPercent : 999;
                }
                if (b.isTarget) {
                    bVal = direction === 'asc' ? Infinity : -Infinity;
                } else {
                    bVal = b.included ? calculatePropertyAdjustments(b, targetProperty).totalAdjustmentPercent : 999;
                }
                break;
            case 10: // Weight %
                // Target property doesn't have this value, put it at end when sorting
                aVal = a.isTarget ? (direction === 'asc' ? Infinity : -Infinity) : (a.weight || 0);
                bVal = b.isTarget ? (direction === 'asc' ? Infinity : -Infinity) : (b.weight || 0);
                break;
            case 11: // Similarity
                // Target property doesn't have this value, put it at end when sorting
                if (a.isTarget) {
                    aVal = direction === 'asc' ? Infinity : -Infinity;
                } else {
                    aVal = a.included ? calculateSimilarityScore(a, targetProperty).score : 999;
                }
                if (b.isTarget) {
                    bVal = direction === 'asc' ? Infinity : -Infinity;
                } else {
                    bVal = b.included ? calculateSimilarityScore(b, targetProperty).score : 999;
                }
                break;
            default:
                return 0;
        }

        // Numeric comparison
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
}

// Handle column header click for sorting
function handleColumnSort(columnIndex) {
    if (currentSortColumn === columnIndex) {
        // Toggle direction
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        // New column, default to ascending
        currentSortColumn = columnIndex;
        currentSortDirection = 'asc';
    }

    // Update header indicators
    updateSortIndicators();

    // Re-render table
    renderComparables();
}

// Update sort indicators in table headers
function updateSortIndicators() {
    const headers = document.querySelectorAll('#comps-table thead th');
    headers.forEach((header, index) => {
        // Remove existing indicators
        header.classList.remove('sort-asc', 'sort-desc');
        const existingIndicator = header.querySelector('.sort-indicator');
        if (existingIndicator) existingIndicator.remove();

        // Add indicator to current sort column
        if (index === currentSortColumn) {
            header.classList.add(currentSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            const indicator = document.createElement('span');
            indicator.className = 'sort-indicator';
            indicator.textContent = currentSortDirection === 'asc' ? ' ▲' : ' ▼';
            header.appendChild(indicator);
        }
    });
}

// Initialize column sorting
function initializeColumnSorting() {
    const headers = document.querySelectorAll('#comps-table thead th');
    headers.forEach((header, index) => {
        // Skip checkbox columns (0 and 1)
        if (index === 0 || index === 1) return;

        header.style.cursor = 'pointer';
        header.title = 'Click to sort';
        header.addEventListener('click', () => handleColumnSort(index));
    });
}

// Expose to global scope
window.handleColumnSort = handleColumnSort;

// Toggle comparable property
function toggleComp(id) {
    const prop = comparableProperties.find(p => p.id === id);
    if (prop) {
        prop.included = !prop.included;
        calculateAndRenderEstimates();
        renderComparables();
        updateMap(); // Update map when toggling
    }
}

// Toggle direct comp
function toggleDirectComp(id) {
    const prop = comparableProperties.find(p => p.id === id);
    if (!prop) return;

    // If clicking the currently selected direct comp, just uncheck it
    if (prop.isDirectComp) {
        prop.isDirectComp = false;
    } else {
        // Uncheck all other direct comps and set this one
        comparableProperties.forEach(p => p.isDirectComp = false);
        prop.isDirectComp = true;
    }

    calculateAndRenderEstimates();
    renderComparables();
    updateMap(); // Update map when toggling
}

// Expose functions to global scope for inline event handlers
window.toggleComp = toggleComp;
window.toggleDirectComp = toggleDirectComp;

// Weighting method labels map (shared between functions)
const avgTypeMap = {
    'simple': 'Simple Average',
    'price': 'Price-Weighted Average',
    'size': 'Building Size-Weighted Average',
    'date': 'Date-Weighted Average (Recent Sales)',
    'renovated': 'Renovated-Weighted Average',
    'combined': 'Combined (Renovated + Original Details) Weighted Average',
    'all-weighted': 'All-Weighted Blend (All Factors Combined)'
};

// Calculate and render market averages
function calculateAndRenderAverages() {
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0);

    // Analyze for outliers
    const outlierAnalysis = analyzeOutliers(included);

    let avgBuildingPriceSQFT = 0;
    let avgTotalPriceSQFT = 0;
    let medianBuildingPriceSQFT = 0;
    let medianTotalPriceSQFT = 0;
    let stdDevBuildingPriceSQFT = 0;
    let stdDevTotalPriceSQFT = 0;
    let rangeBuildingPriceSQFT = '';
    let rangeTotalPriceSQFT = '';

    if (included.length > 0) {
        // Extract values for median and std dev calculations
        const buildingPrices = included.map(p => p.buildingPriceSQFT);
        const totalPrices = included.map(p => p.totalPriceSQFT);

        // Calculate weights using centralized utility function
        const weightPercentages = calculatePropertyWeights(included, targetProperty, weightingMethod);
        
        // Convert percentages back to raw weights (0-1 scale) for weighted average calculation
        const weights = weightPercentages.map(w => w / 100);
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        
        // Calculate weighted averages
        if (weightingMethod === 'simple') {
            // Simple average
            avgBuildingPriceSQFT = included.reduce((sum, p) => sum + p.buildingPriceSQFT, 0) / included.length;
            avgTotalPriceSQFT = included.reduce((sum, p) => sum + p.totalPriceSQFT, 0) / included.length;
        } else {
            // Weighted average using calculated weights
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        }

        // Calculate median (not affected by weighting method)
        medianBuildingPriceSQFT = calculateMedian(buildingPrices);
        medianTotalPriceSQFT = calculateMedian(totalPrices);

        // Calculate standard deviation
        stdDevBuildingPriceSQFT = calculateStdDev(buildingPrices, avgBuildingPriceSQFT);
        stdDevTotalPriceSQFT = calculateStdDev(totalPrices, avgTotalPriceSQFT);

        // Calculate range
        const minBuilding = Math.min(...buildingPrices);
        const maxBuilding = Math.max(...buildingPrices);
        const minTotal = Math.min(...totalPrices);
        const maxTotal = Math.max(...totalPrices);
        rangeBuildingPriceSQFT = `${formatCurrency(minBuilding)} - ${formatCurrency(maxBuilding)}`;
        rangeTotalPriceSQFT = `${formatCurrency(minTotal)} - ${formatCurrency(maxTotal)}`;
    }

    const container = document.getElementById('market-averages');
    const avgType = avgTypeMap[weightingMethod];
    
    // Build outlier warning if detected
    let outlierWarning = '';
    if (outlierAnalysis.hasOutliers) {
        const outlierProps = included.filter(p => p.isOutlier);
        const outlierAddresses = outlierProps.map(p => p.address).join(', ');
        outlierWarning = `
            <div class="outlier-warning" style="background: #fff3cd; border-left: 4px solid #e74c3c; padding: 12px 15px; margin-bottom: 15px; border-radius: 4px;">
                <strong style="color: #e74c3c;">⚠️ Statistical Outliers Detected:</strong>
                <div style="font-size: 13px; margin-top: 5px; color: #856404;">
                    ${outlierAnalysis.outlierCount} of ${outlierAnalysis.total} included properties have unusual price/SQFT values outside normal range.
                    <br><strong>Properties:</strong> ${outlierAddresses}
                    <br><strong>Range:</strong> ${formatCurrency(outlierAnalysis.buildingPriceOutliers.lowerBound)} - ${formatCurrency(outlierAnalysis.buildingPriceOutliers.upperBound)} (IQR method)
                </div>
                <div style="font-size: 12px; margin-top: 8px; color: #666; font-style: italic;">
                    💡 Consider excluding outliers or investigating their unusual characteristics.
                </div>
            </div>
        `;
    }
    
    container.innerHTML = outlierWarning + `
        <div class="average-box">
            <h4>Building $ SQFT</h4>
            <div class="average-value">${formatCurrency(avgBuildingPriceSQFT)}</div>
            <div class="average-count">${avgType} from ${included.length} of ${comparableProperties.length} properties</div>
            <div class="stats-details">
                <div class="stat-row"><span class="stat-label">Median:</span> <span class="stat-value">${formatCurrency(medianBuildingPriceSQFT)}</span></div>
                <div class="stat-row"><span class="stat-label">Std Dev:</span> <span class="stat-value">±${formatCurrency(stdDevBuildingPriceSQFT)}</span></div>
                <div class="stat-row"><span class="stat-label">Range:</span> <span class="stat-value">${rangeBuildingPriceSQFT}</span></div>
            </div>
        </div>
        <!-- <div class="average-box">
            <h4>Total $ SQFT</h4>
            <div class="average-value">${formatCurrency(avgTotalPriceSQFT)}</div>
            <div class="average-count">${avgType} from ${included.length} of ${comparableProperties.length} properties</div>
            <div class="stats-details">
                <div class="stat-row"><span class="stat-label">Median:</span> <span class="stat-value">${formatCurrency(medianTotalPriceSQFT)}</span></div>
                <div class="stat-row"><span class="stat-label">Std Dev:</span> <span class="stat-value">±${formatCurrency(stdDevTotalPriceSQFT)}</span></div>
                <div class="stat-row"><span class="stat-label">Range:</span> <span class="stat-value">${rangeTotalPriceSQFT}</span></div>
            </div>
        </div> -->
    `;
}

// Change appreciation rate
function setAppreciationRate(rate) {
    annualAppreciationRate = rate / 100; // Convert percentage to decimal

    // Reprocess all properties with new rate
    comparableProperties.forEach(prop => {
        if (prop.originalSalePrice) {
            const adjustment = applyAppreciationAdjustment(prop.originalSalePrice, prop.sellDate);
            prop.adjustedSalePrice = adjustment.adjustedPrice;
            prop.adjustedSalePriceLow = adjustment.adjustedPriceLow;
            prop.adjustedSalePriceHigh = adjustment.adjustedPriceHigh;
            prop.appreciationAmount = adjustment.appreciationAmount;
            prop.appreciationMethod = adjustment.method;
            prop.appreciationUncertainty = adjustment.uncertainty;

            // Recalculate price per SQFT
            prop.buildingPriceSQFT = calculateBuildingPriceSQFT(prop.adjustedSalePrice, prop.buildingSQFT);
            prop.totalPriceSQFT = calculateTotalPriceSQFT(prop.adjustedSalePrice, prop.propertySQFT, prop.buildingSQFT, prop.buildingWidthFeet, prop.buildingDepthFeet);
        }
    });

    // Update display
    calculateAndRenderEstimates();
    renderComparables();
}

// Expose to global scope
window.setAppreciationRate = setAppreciationRate;

// Lot size adjustment constants derived from regression analysis
// Source: Multiple regression on Crown Heights comparable sales (n=11)
// Model 6: Price = α + β₁(Building) + β₂(Lot) + β₃(Transit) + β₄(Commercial) + β₅(Renovated)
// Results: β₂ = $144.73/SQFT, R² = 96.6%, RMSE = $64,985 (2.5% - BEST MODEL)
// See: lotSizeRegressionAnalysis.js for full analysis
const LOT_SIZE_CONSTANTS = {
    // Regression-based method (data-driven from actual Crown Heights sales)
    REGRESSION_DOLLAR_PER_SQFT: 144.73,  // $145 per SQFT lot difference (Model 6)
    
    // Percentage-based method (industry standard for appraisals)
    // USPAP/Fannie Mae: ±1% per 500 SQFT difference
    PERCENTAGE_PER_500SQFT: 0.01,  // 1% adjustment per 500 SQFT
    
    // Method selection: 'regression' (recommended) or 'percentage' or 'hybrid'
    METHOD: 'regression'
};

/**
 * Calculate land adjustment based on lot size
 * 
 * DATA SOURCES & VALIDATION:
 * - Regression analysis on 11 Crown Heights comparable sales (2024-2025)
 * - Controlled for building size and renovation status
 * - Result: $157.98 per SQFT (within market range of $100-$200/SQFT)
 * - Industry standard alternative: ±1% per 500 SQFT difference (USPAP/Fannie Mae)
 * 
 * @param {number} targetLotSQFT - Target property lot size in SQFT
 * @param {Array} compLotSQFTs - Array of comparable property lot sizes
 * @param {number} baseValue - Base property value (for percentage method)
 * @returns {Object} - { adjustment, typical, difference, description, method, percentageComparison }
 */
function calculateLandAdjustment(targetLotSQFT, compLotSQFTs, baseValue = null) {
    if (!compLotSQFTs || compLotSQFTs.length === 0) {
        return { 
            adjustment: 0, 
            typical: 0, 
            difference: 0, 
            description: 'No data',
            method: 'none',
            percentageComparison: null
        };
    }
    
    // Calculate typical (median) lot size from comps
    const typicalLotSize = calculateMedian(compLotSQFTs);
    const lotDifference = targetLotSQFT - typicalLotSize;
    
    let adjustment = 0;
    let description = '';
    let method = LOT_SIZE_CONSTANTS.METHOD;
    
    // REGRESSION METHOD (DATA-DRIVEN)
    // Based on actual Crown Heights sales data
    // Linear relationship: Each SQFT adds/subtracts $157.98
    if (method === 'regression') {
        adjustment = lotDifference * LOT_SIZE_CONSTANTS.REGRESSION_DOLLAR_PER_SQFT;
        
        if (lotDifference > 500) {
            description = 'Large lot premium';
        } else if (lotDifference > 200) {
            description = 'Above-average lot';
        } else if (lotDifference < -200) {
            description = 'Below-average lot';
        } else {
            description = 'Typical lot size';
        }
    }
    // PERCENTAGE METHOD (INDUSTRY STANDARD)
    // USPAP/Fannie Mae: ±1% per 500 SQFT difference
    // Scales with property value (higher value = larger adjustment)
    else if (method === 'percentage' && baseValue) {
        const pctAdjustment = (lotDifference / 500) * LOT_SIZE_CONSTANTS.PERCENTAGE_PER_500SQFT;
        adjustment = baseValue * pctAdjustment;
        
        if (Math.abs(pctAdjustment) > 0.02) {
            description = lotDifference > 0 ? 'Significantly larger lot' : 'Significantly smaller lot';
        } else if (Math.abs(pctAdjustment) > 0.005) {
            description = lotDifference > 0 ? 'Above-average lot' : 'Below-average lot';
        } else {
            description = 'Typical lot size';
        }
    }
    // HYBRID METHOD (AVERAGE OF BOTH)
    // Use when you want conservative middle-ground estimate
    else if (method === 'hybrid' && baseValue) {
        const regressionAdj = lotDifference * LOT_SIZE_CONSTANTS.REGRESSION_DOLLAR_PER_SQFT;
        const pctAdjustment = (lotDifference / 500) * LOT_SIZE_CONSTANTS.PERCENTAGE_PER_500SQFT;
        const percentageAdj = baseValue * pctAdjustment;
        
        adjustment = (regressionAdj + percentageAdj) / 2;
        description = 'Hybrid adjustment (regression + percentage)';
    }
    
    // Calculate percentage method for comparison (always show both)
    let percentageComparison = null;
    if (baseValue && method !== 'percentage') {
        const pctAdjustment = (lotDifference / 500) * LOT_SIZE_CONSTANTS.PERCENTAGE_PER_500SQFT;
        percentageComparison = {
            adjustment: Math.round(baseValue * pctAdjustment),
            percentage: pctAdjustment,
            description: 'Industry standard (±1% per 500 SQFT)'
        };
    }
    
    return {
        adjustment: Math.round(adjustment),
        typical: Math.round(typicalLotSize),
        difference: Math.round(lotDifference),
        description: description,
        method: method,
        percentageComparison: percentageComparison,
        // Metadata for transparency
        dataSource: 'Regression analysis on Crown Heights sales (n=11, R²=94.0%)',
        dollarPerSQFT: LOT_SIZE_CONSTANTS.REGRESSION_DOLLAR_PER_SQFT
    };
}

// Width adjustment constants
// Note: Regression showed negative coefficient due to multicollinearity with building SQFT
// Using percentage-based method (industry standard) which is more reliable
const WIDTH_CONSTANTS = {
    // Percentage-based method (industry standard for appraisals)
    // USPAP/Fannie Mae: ±1.5% per foot difference
    PERCENTAGE_PER_FOOT: 0.015,  // 1.5% adjustment per foot
    
    // Method selection: 'percentage' (recommended due to multicollinearity in regression)
    METHOD: 'percentage'
};

/**
 * Calculate width premium (wider properties are more valuable)
 * 
 * DATA SOURCES & VALIDATION:
 * - Industry standard: ±1.5% per foot (USPAP/Fannie Mae guidelines)
 * - Regression analysis showed negative coefficient due to multicollinearity
 * - Width is already captured in building SQFT, so percentage method is more appropriate
 * 
 * @param {number} targetWidth - Target property width in feet
 * @param {Array} compWidths - Array of comparable property widths
 * @param {number} baseValue - Base property value (for percentage method)
 * @returns {Object} - { premium, typical, difference, description, method, dollarPerFoot }
 */
function calculateWidthPremium(targetWidth, compWidths, baseValue = null) {
    if (!compWidths || compWidths.length === 0) {
        return { 
            premium: 0, 
            typical: 0, 
            difference: 0, 
            description: 'No data',
            method: 'none',
            dollarPerFoot: 0
        };
    }
    
    // Calculate typical (median) width from comps
    const typicalWidth = calculateMedian(compWidths);
    const widthDifference = targetWidth - typicalWidth;
    
    let premium = 0;
    let description = '';
    let method = WIDTH_CONSTANTS.METHOD;
    let dollarPerFoot = 0;
    
    // PERCENTAGE METHOD (INDUSTRY STANDARD)
    // ±1.5% per foot of width difference
    // Scales with property value (higher value = larger adjustment)
    if (method === 'percentage' && baseValue) {
        const pctAdjustment = widthDifference * WIDTH_CONSTANTS.PERCENTAGE_PER_FOOT;
        premium = baseValue * pctAdjustment;
        dollarPerFoot = baseValue * WIDTH_CONSTANTS.PERCENTAGE_PER_FOOT;
        
        if (widthDifference > 2) {
            description = 'Wide brownstone premium';
        } else if (widthDifference > 0.5) {
            description = 'Above-average width';
        } else if (widthDifference < -2) {
            description = 'Significantly narrow';
        } else if (widthDifference < -0.5) {
            description = 'Narrow property discount';
        } else {
            description = 'Typical width';
        }
    }
    // FALLBACK: Fixed dollar amounts (if no base value provided)
    else {
        if (widthDifference > 2) {
            premium = widthDifference * 40000;
            description = 'Wide brownstone premium';
        } else if (widthDifference > 0.5) {
            premium = widthDifference * 25000;
            description = 'Above-average width';
        } else if (widthDifference < -1) {
            premium = widthDifference * 20000;
            description = 'Narrow property discount';
        } else {
            premium = 0;
            description = 'Typical width';
        }
        dollarPerFoot = Math.abs(premium / Math.max(Math.abs(widthDifference), 1));
    }
    
    return {
        premium: Math.round(premium),
        typical: Math.round(typicalWidth * 100) / 100,
        difference: Math.round(widthDifference * 100) / 100,
        description: description,
        method: method,
        dollarPerFoot: Math.round(dollarPerFoot),
        // Metadata for transparency
        dataSource: 'Industry standard (USPAP: ±1.5% per foot)',
        percentagePerFoot: WIDTH_CONSTANTS.PERCENTAGE_PER_FOOT
    };
}

// Location adjustment constants derived from regression analysis
// Source: Multiple regression on Crown Heights comparable sales (n=11)
// Model 6: Price = α + β₁(Building) + β₂(Lot) + β₃(Transit Dist) + β₄(Commercial Dist) + β₅(Renovated)
// Results: β₃ = -$295,149/mile, β₄ = -$570,935/mile, R² = 96.6%, RMSE = $64,985 (2.5% - BEST MODEL)
// Key finding: Commercial amenities (groceries) have ~2x the value impact of transit!
// See: lotSizeRegressionAnalysis.js Model 6 for full analysis
const LOCATION_CONSTANTS = {
    // Regression-based method (data-driven from actual Crown Heights sales)
    TRANSIT_PENALTY_PER_MILE: 295148.67,     // $295k per mile further from transit
    TRANSIT_PREMIUM_PER_BLOCK: 4722,         // ~$4.7k per block closer (1 block ≈ 0.016 miles)
    
    COMMERCIAL_PENALTY_PER_MILE: 570935.44,  // $571k per mile further from groceries/amenities
    COMMERCIAL_PREMIUM_PER_BLOCK: 9135,      // ~$9.1k per block closer (2x transit effect!)
    
    // Key locations for distance measurement
    TRANSIT_HUB: { lat: 40.678606, lng: -73.952939, name: 'Nostrand Ave A/C Station' },
    COMMERCIAL_HUB: { lat: 40.677508, lng: -73.955723, name: 'Franklin & Dean Commercial' },
    
    // Method selection: 'regression' (recommended) or 'percentage' or 'hybrid'
    METHOD: 'regression'
};

/**
 * Calculate location-based price adjustment
 * 
 * DATA SOURCES & VALIDATION:
 * - Regression analysis on 11 Crown Heights comparable sales (2024-2025)
 * - Model 6: Separate coefficients for transit AND commercial proximity
 * - Transit: -$295k per mile, Commercial: -$571k per mile (groceries have 2x effect!)
 * - Practical: ~$4.7k per block closer to transit, ~$9.1k per block closer to groceries
 * - Transit hub: Nostrand Ave A/C Station, Commercial: Franklin & Dean corridor
 * 
 * @param {Object} targetProperty - Target property with coordinates and distance data
 * @param {Array} includedComps - Filtered comparable properties
 * @returns {Object} - { adjustment, breakdown, description }
 */
function calculateLocationAdjustment(targetProperty, includedComps) {
    if (!targetProperty.coordinates || includedComps.length === 0) {
        return { 
            adjustment: 0, 
            breakdown: {},
            description: 'No location data',
            method: 'none'
        };
    }
    
    // Calculate median distances to both transit and commercial from comps
    const compTransitDistances = includedComps
        .filter(c => c.distanceToTransit !== undefined)
        .map(c => c.distanceToTransit);
    
    const compCommercialDistances = includedComps
        .filter(c => c.distanceToCommercial !== undefined)
        .map(c => c.distanceToCommercial);
    
    if (compTransitDistances.length === 0 || compCommercialDistances.length === 0 ||
        targetProperty.distanceToTransit === undefined || targetProperty.distanceToCommercial === undefined) {
        return {
            adjustment: 0,
            breakdown: {},
            description: 'Insufficient location data',
            method: 'none'
        };
    }
    
    const medianTransitDistance = calculateMedian(compTransitDistances);
    const medianCommercialDistance = calculateMedian(compCommercialDistances);
    
    const transitDifference = targetProperty.distanceToTransit - medianTransitDistance;
    const commercialDifference = targetProperty.distanceToCommercial - medianCommercialDistance;
    
    let method = LOCATION_CONSTANTS.METHOD;
    
    // REGRESSION METHOD (DATA-DRIVEN) - Model 6 with separate transit & commercial
    // Negative coefficients: further from amenities = lower value
    const transitAdjustment = -transitDifference * LOCATION_CONSTANTS.TRANSIT_PENALTY_PER_MILE;
    const commercialAdjustment = -commercialDifference * LOCATION_CONSTANTS.COMMERCIAL_PENALTY_PER_MILE;
    const totalAdjustment = transitAdjustment + commercialAdjustment;
    
    // Determine description based on combined effect
    let description = '';
    if (totalAdjustment > 100000) {
        description = 'Premium location (excellent transit & commercial access)';
    } else if (totalAdjustment > 50000) {
        description = 'Good location (above-average accessibility)';
    } else if (totalAdjustment < -50000) {
        description = 'Discount location (limited transit & commercial access)';
    } else {
        description = 'Average location';
    }
    
    // Calculate practical metrics
    const transitBlocksDiff = Math.round(transitDifference / 0.016); // 1 block ≈ 0.016 miles
    const commercialBlocksDiff = Math.round(commercialDifference / 0.016);
    
    return {
        adjustment: Math.round(totalAdjustment),
        breakdown: {
            transitDistance: formatNumber(targetProperty.distanceToTransit, 2) + ' mi',
            typicalTransitDistance: formatNumber(medianTransitDistance, 2) + ' mi',
            transitDifference: (transitDifference >= 0 ? '+' : '') + formatNumber(transitDifference, 2) + ' mi',
            transitDifferenceBlocks: (transitBlocksDiff >= 0 ? '+' : '') + transitBlocksDiff + ' blocks',
            transitAdjustment: Math.round(transitAdjustment),
            
            commercialDistance: formatNumber(targetProperty.distanceToCommercial, 2) + ' mi',
            typicalCommercialDistance: formatNumber(medianCommercialDistance, 2) + ' mi',
            commercialDifference: (commercialDifference >= 0 ? '+' : '') + formatNumber(commercialDifference, 2) + ' mi',
            commercialDifferenceBlocks: (commercialBlocksDiff >= 0 ? '+' : '') + commercialBlocksDiff + ' blocks',
            commercialAdjustment: Math.round(commercialAdjustment),
            
            transitPenaltyPerMile: '$' + LOCATION_CONSTANTS.TRANSIT_PENALTY_PER_MILE.toLocaleString(undefined, {maximumFractionDigits: 0}),
            commercialPenaltyPerMile: '$' + LOCATION_CONSTANTS.COMMERCIAL_PENALTY_PER_MILE.toLocaleString(undefined, {maximumFractionDigits: 0}),
            transitPenaltyPerBlock: '$' + LOCATION_CONSTANTS.TRANSIT_PREMIUM_PER_BLOCK.toLocaleString(undefined, {maximumFractionDigits: 0}),
            commercialPenaltyPerBlock: '$' + LOCATION_CONSTANTS.COMMERCIAL_PREMIUM_PER_BLOCK.toLocaleString(undefined, {maximumFractionDigits: 0})
        },
        description: description,
        method: method,
        dataSource: 'Regression analysis on Crown Heights sales (n=11, Model 6, R²=96.6%)'
    };
}

/**
 * Detect statistical outliers using IQR (Interquartile Range) method
 * Industry-standard approach for identifying unusual comparable properties
 * @param {Array} values - Array of numeric values (e.g., price per SQFT)
 * @returns {Object} - { outliers: Boolean array, lowerBound, upperBound, q1, q3, iqr }
 */
function detectOutliers(values) {
    if (!values || values.length < 4) {
        // Need at least 4 values for meaningful IQR calculation
        return {
            outliers: values ? values.map(() => false) : [],
            lowerBound: 0,
            upperBound: Infinity,
            q1: 0,
            q3: 0,
            iqr: 0
        };
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    
    // Calculate quartiles using industry-standard method
    const q1Index = Math.floor(n * 0.25);
    const q3Index = Math.floor(n * 0.75);
    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    const iqr = q3 - q1;
    
    // Standard outlier boundaries: Q1 - 1.5×IQR and Q3 + 1.5×IQR
    // This captures ~99.3% of normally distributed data
    const lowerBound = q1 - (1.5 * iqr);
    const upperBound = q3 + (1.5 * iqr);
    
    // Flag outliers
    const outliers = values.map(v => v < lowerBound || v > upperBound);
    
    return {
        outliers,
        lowerBound,
        upperBound,
        q1,
        q3,
        iqr
    };
}

/**
 * Analyze comparable properties for outliers in price per SQFT
 * Flags properties with unusual pricing for review
 * @param {Array} properties - Array of comparable properties
 * @returns {Object} - Analysis with outlier flags and statistics
 */
function analyzeOutliers(properties) {
    if (!properties || properties.length === 0) {
        return {
            hasOutliers: false,
            outlierCount: 0,
            total: 0,
            buildingPriceOutliers: [],
            totalPriceOutliers: []
        };
    }
    
    // Detect outliers in building price per SQFT
    const buildingPrices = properties.map(p => p.buildingPriceSQFT);
    const buildingAnalysis = detectOutliers(buildingPrices);
    
    // Detect outliers in total price per SQFT
    const totalPrices = properties.map(p => p.totalPriceSQFT);
    const totalAnalysis = detectOutliers(totalPrices);
    
    // Mark properties as outliers
    properties.forEach((p, i) => {
        p.isBuildingPriceOutlier = buildingAnalysis.outliers[i];
        p.isTotalPriceOutlier = totalAnalysis.outliers[i];
        p.isOutlier = buildingAnalysis.outliers[i] || totalAnalysis.outliers[i];
    });
    
    const outlierCount = properties.filter(p => p.isOutlier).length;
    
    return {
        hasOutliers: outlierCount > 0,
        outlierCount,
        total: properties.length,
        buildingPriceOutliers: buildingAnalysis,
        totalPriceOutliers: totalAnalysis
    };
}

// Calculate and render estimates
// Calculate and render estimates
function calculateAndRenderEstimates() {
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0);

    // Analyze for outliers before calculating estimates
    const outlierAnalysis = analyzeOutliers(included);
    
    // Re-validate included properties and target
    const validationResults = [];
    
    // Validate target property
    if (targetProperty) {
        const targetValidation = validatePropertyData(targetProperty, 'target');
        if (targetValidation.errors.length > 0 || targetValidation.warnings.length > 0) {
            validationResults.push(targetValidation);
        }
    }
    
    // Validate only included comparable properties
    included.forEach(prop => {
        const compValidation = validatePropertyData(prop, 'comparable');
        if (compValidation.errors.length > 0 || compValidation.warnings.length > 0) {
            validationResults.push(compValidation);
        }
    });

    let avgBuildingPriceSQFT = 0;
    let avgTotalPriceSQFT = 0;

    let medianBuildingPriceSQFT = 0;
    let medianTotalPriceSQFT = 0;
    let stdDevBuildingPriceSQFT = 0;
    let stdDevTotalPriceSQFT = 0;

    if (included.length > 0) {
        // Extract raw building $/SQFT values from comps (unadjusted)
        // These are the actual sale prices divided by building SQFT
        // NYC appraisers use these raw comp values, then apply qualitative adjustments separately
        const buildingPrices = included.map(p => p.buildingPriceSQFT);
        const totalPrices = included.map(p => p.totalPriceSQFT);

        // Calculate weights using centralized utility function
        const weightPercentages = calculatePropertyWeights(included, targetProperty, weightingMethod);
        
        // Convert percentages back to raw weights (0-1 scale) for weighted average calculation
        const weights = weightPercentages.map(w => w / 100);
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        
        // Calculate weighted averages using RAW (unadjusted) comp $/SQFT
        if (weightingMethod === 'simple') {
            // Simple average
            avgBuildingPriceSQFT = included.reduce((sum, p) => sum + p.buildingPriceSQFT, 0) / included.length;
            avgTotalPriceSQFT = included.reduce((sum, p) => sum + p.totalPriceSQFT, 0) / included.length;
        } else {
            // Weighted average using calculated weights
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        }

        // Calculate median and standard deviation (using raw unadjusted prices)
        medianBuildingPriceSQFT = calculateMedian(buildingPrices);
        medianTotalPriceSQFT = calculateMedian(totalPrices);
        stdDevBuildingPriceSQFT = calculateStdDev(buildingPrices, avgBuildingPriceSQFT);
        stdDevTotalPriceSQFT = calculateStdDev(totalPrices, avgTotalPriceSQFT);
    }

    // ===== NYC APPRAISAL METHOD: Building Interior SQFT × $/SQFT + Qualitative Adjustments =====
    // This is how NYC appraisers actually value brownstones:
    // 1. Interior SQFT × comp-based $/SQFT (land value already included in comp prices)
    // 2. Add qualitative adjustments for lot size, width, location
    
    // Calculate target's building SQFT using Floors (PRIMARY METHOD)
    const targetBuildingSQFTWithFloors = targetProperty.buildingSQFT;
    
    // Base Value: Interior SQFT × Comp-Based $/SQFT
    // Use building $/SQFT from adjusted comps (NOT building-only with land extracted)
    // The comp prices already include land value - we don't need to extract and re-add it
    const nycBaseValueWeighted = targetBuildingSQFTWithFloors * avgBuildingPriceSQFT;
    const nycBaseValueMedian = targetBuildingSQFTWithFloors * medianBuildingPriceSQFT;
    
    // Calculate qualitative adjustments
    const compLotSizes = included.map(p => p.propertySQFT);
    const compWidths = included.map(p => p.buildingWidthFeet);
    
    // Pass base value for percentage method comparison
    const landAdj = calculateLandAdjustment(
        targetProperty.propertySQFT, 
        compLotSizes, 
        nycBaseValueMedian
    );
    const widthAdj = calculateWidthPremium(
        targetProperty.buildingWidthFeet, 
        compWidths,
        nycBaseValueMedian
    );
    
    // Calculate distance to key locations for target property (needed for location adjustment)
    calculateDistanceWeight(targetProperty);
    
    // Location adjustment (NEW: uses amenity proximity, value zones, and comp distance)
    const locationAdj = calculateLocationAdjustment(targetProperty, included);
    
    // Total qualitative adjustments (lot size difference, width premium, location)
    const totalAdjustments = landAdj.adjustment + widthAdj.premium + locationAdj.adjustment;
    
    // NYC Appraisal Method: Base Value + Qualitative Adjustments
    const nycEstimateWeighted = nycBaseValueWeighted + totalAdjustments;
    const nycEstimateMedian = nycBaseValueMedian + totalAdjustments;
    
    // Store NYC estimate values globally for target property row display
    nycEstimateValue = nycEstimateMedian;
    nycPriceSQFT = medianBuildingPriceSQFT;
    
    // Confidence intervals for NYC method (based on building SQFT variance + adjustment uncertainty)
    const baseStdDev = stdDevBuildingPriceSQFT * targetBuildingSQFTWithFloors;
    const adjustmentUncertainty = Math.abs(totalAdjustments) * 0.2; // 20% uncertainty on adjustments
    const totalStdDev = baseStdDev + adjustmentUncertainty;
    
    const nycEstimateLow68 = nycEstimateMedian - totalStdDev;
    const nycEstimateHigh68 = nycEstimateMedian + totalStdDev;
    const nycEstimateLow95 = nycEstimateMedian - (2 * totalStdDev);
    const nycEstimateHigh95 = nycEstimateMedian + (2 * totalStdDev);
    
    // Legacy Method A (building only, for comparison)
    const estimateA = targetBuildingSQFTWithFloors * avgBuildingPriceSQFT;
    const estimateAMedian = targetBuildingSQFTWithFloors * medianBuildingPriceSQFT;
    // 68% Confidence Interval (±1 std dev)
    const estimateALow68 = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT - stdDevBuildingPriceSQFT);
    const estimateAHigh68 = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT + stdDevBuildingPriceSQFT);
    // 95% Confidence Interval (±2 std dev)
    const estimateALow95 = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT - (2 * stdDevBuildingPriceSQFT));
    const estimateAHigh95 = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT + (2 * stdDevBuildingPriceSQFT));

    // Method B: (Property SQFT + Building SQFT) × Average Total $ SQFT
    const targetTotalSQFT = calculateTotalPropertySQFT(targetProperty.propertySQFT, targetProperty.buildingSQFT, targetProperty.buildingWidthFeet, targetProperty.buildingDepthFeet);
    const estimateB = targetTotalSQFT * avgTotalPriceSQFT;
    const estimateBMedian = targetTotalSQFT * medianTotalPriceSQFT;
    // 68% Confidence Interval (±1 std dev)
    const estimateBLow68 = targetTotalSQFT * (avgTotalPriceSQFT - stdDevTotalPriceSQFT);
    const estimateBHigh68 = targetTotalSQFT * (avgTotalPriceSQFT + stdDevTotalPriceSQFT);
    // 95% Confidence Interval (±2 std dev)
    const estimateBLow95 = targetTotalSQFT * (avgTotalPriceSQFT - (2 * stdDevTotalPriceSQFT));
    const estimateBHigh95 = targetTotalSQFT * (avgTotalPriceSQFT + (2 * stdDevTotalPriceSQFT));

    // Blended Estimate: 70% Method A + 30% Method B
    const blendedEstimate = (estimateA * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (estimateB * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
    const blendedMedian = (estimateAMedian * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (estimateBMedian * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
    const blendedLow68 = (estimateALow68 * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (estimateBLow68 * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
    const blendedHigh68 = (estimateAHigh68 * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (estimateBHigh68 * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
    const blendedLow95 = (estimateALow95 * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (estimateBLow95 * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
    const blendedHigh95 = (estimateAHigh95 * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (estimateBHigh95 * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);

    // Calculate High Influence Properties Estimate (only if weighted method and high influence props exist)
    let highInfluenceEstimateHTML = '';
    if (weightingMethod !== 'simple' && included.length > 0) {
        // Recalculate weights to identify high influence properties
        const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
        const targetSize = targetProperty.buildingSQFT;
        const targetTotalSize = calculateTotalPropertySQFT(targetProperty.propertySQFT, targetProperty.buildingSQFT, targetProperty.buildingWidthFeet, targetProperty.buildingDepthFeet);

        // Calculate all weight arrays
        const sizeWeights = included.map(p => {
            const compSize = p.buildingSQFT;
            const sizeDiff = Math.abs(compSize - targetSize);
            return 1 / (1 + sizeDiff / targetSize);
        });
        const totalSizeWeight = sizeWeights.reduce((sum, w) => sum + w, 0);

        const totalSizeWeights = included.map(p => {
            const compTotalSize = calculateTotalPropertySQFT(p.propertySQFT, p.buildingSQFT, p.buildingWidthFeet, p.buildingDepthFeet);
            const totalSizeDiff = Math.abs(compTotalSize - targetTotalSize);
            return 1 / (1 + totalSizeDiff / targetTotalSize);
        });
        const totalPropertySizeWeight = totalSizeWeights.reduce((sum, w) => sum + w, 0);

        const dateWeights = included.map(p => {
            const saleDate = parseACRISDate(p.sellDate);
            if (!saleDate) return WEIGHTING_CONSTANTS.INVALID_DATE_PENALTY_WEIGHT;
            const daysSinceSale = daysBetween(saleDate);
            return Math.exp(-daysSinceSale / WEIGHTING_CONSTANTS.DATE_WEIGHT_HALFLIFE_DAYS);
        });
        const totalDateWeight = dateWeights.reduce((sum, w) => sum + w, 0);

        const renovatedWeights = included.map(p => p.renovated === 'Yes' ? WEIGHTING_CONSTANTS.RENOVATED_WEIGHT_MULTIPLIER : 1.0);
        const totalRenovatedWeight = renovatedWeights.reduce((sum, w) => sum + w, 0);

        const combinedWeights = included.map(p => {
            let weight = 1.0;
            if (targetProperty.renovated === p.renovated) weight *= WEIGHTING_CONSTANTS.RENOVATED_MATCH_MULTIPLIER;
            if (targetProperty.originalDetails === p.originalDetails) weight *= WEIGHTING_CONSTANTS.ORIGINAL_DETAILS_MATCH_MULTIPLIER;
            return weight;
        });
        const totalCombinedWeight = combinedWeights.reduce((sum, w) => sum + w, 0);

        const allWeights = included.map((p, index) => {
            let weight = 1.0;
            if (totalPrice > 0) weight *= (p.adjustedSalePrice / totalPrice) * included.length;
            if (totalSizeWeight > 0 && sizeWeights[index]) weight *= (sizeWeights[index] / totalSizeWeight) * included.length;
            if (totalDateWeight > 0 && dateWeights[index]) weight *= (dateWeights[index] / totalDateWeight) * included.length;
            if (p.renovated === targetProperty.renovated) weight *= WEIGHTING_CONSTANTS.ALL_WEIGHTED_RENOVATED_MULTIPLIER;
            if (p.originalDetails === targetProperty.originalDetails) weight *= WEIGHTING_CONSTANTS.ALL_WEIGHTED_ORIGINAL_DETAILS_MULTIPLIER;
            return weight;
        });
        const totalAllWeight = allWeights.reduce((sum, w) => sum + w, 0);

        // Identify high influence properties (weight > 150% of average)
        const avgWeight = 100 / included.length;
        const highInfluenceThreshold = avgWeight * WEIGHTING_CONSTANTS.HIGH_INFLUENCE_MULTIPLIER;

        // Calculate which properties are high influence based on current weighting method
        const highInfluenceProps = included.filter((p, index) => {
            let weightPercent = 0;
            if (weightingMethod === 'price' && totalPrice > 0) {
                weightPercent = (p.adjustedSalePrice / totalPrice) * 100;
            } else if (weightingMethod === 'size' && totalSizeWeight > 0) {
                weightPercent = (sizeWeights[index] / totalSizeWeight) * 100;
            } else if (weightingMethod === 'total-size' && totalPropertySizeWeight > 0) {
                weightPercent = (totalSizeWeights[index] / totalPropertySizeWeight) * 100;
            } else if (weightingMethod === 'date' && totalDateWeight > 0) {
                weightPercent = (dateWeights[index] / totalDateWeight) * 100;
            } else if (weightingMethod === 'renovated' && totalRenovatedWeight > 0) {
                weightPercent = (renovatedWeights[index] / totalRenovatedWeight) * 100;
            } else if (weightingMethod === 'combined' && totalCombinedWeight > 0) {
                weightPercent = (combinedWeights[index] / totalCombinedWeight) * 100;
            } else if (weightingMethod === 'all-weighted' && totalAllWeight > 0) {
                weightPercent = (allWeights[index] / totalAllWeight) * 100;
            }
            return weightPercent > highInfluenceThreshold;
        });

        if (highInfluenceProps.length > 0) {
            // Calculate averages using only high influence properties
            const hiBuildingPrices = highInfluenceProps.map(p => p.buildingPriceSQFT);
            const hiTotalPrices = highInfluenceProps.map(p => p.totalPriceSQFT);

            const hiAvgBuildingPriceSQFT = hiBuildingPrices.reduce((sum, v) => sum + v, 0) / hiBuildingPrices.length;
            const hiAvgTotalPriceSQFT = hiTotalPrices.reduce((sum, v) => sum + v, 0) / hiTotalPrices.length;

            const hiMedianBuildingPriceSQFT = calculateMedian(hiBuildingPrices);
            const hiMedianTotalPriceSQFT = calculateMedian(hiTotalPrices);

            const hiStdDevBuildingPriceSQFT = calculateStdDev(hiBuildingPrices, hiAvgBuildingPriceSQFT);
            const hiStdDevTotalPriceSQFT = calculateStdDev(hiTotalPrices, hiAvgTotalPriceSQFT);

            // Calculate estimates using high influence averages
            const hiEstimateA = targetBuildingSQFTWithFloors * hiAvgBuildingPriceSQFT;
            const hiEstimateAMedian = targetBuildingSQFTWithFloors * hiMedianBuildingPriceSQFT;
            const hiEstimateALow68 = targetBuildingSQFTWithFloors * (hiAvgBuildingPriceSQFT - hiStdDevBuildingPriceSQFT);
            const hiEstimateAHigh68 = targetBuildingSQFTWithFloors * (hiAvgBuildingPriceSQFT + hiStdDevBuildingPriceSQFT);
            const hiEstimateALow95 = targetBuildingSQFTWithFloors * (hiAvgBuildingPriceSQFT - (2 * hiStdDevBuildingPriceSQFT));
            const hiEstimateAHigh95 = targetBuildingSQFTWithFloors * (hiAvgBuildingPriceSQFT + (2 * hiStdDevBuildingPriceSQFT));

            const hiEstimateB = targetTotalSQFT * hiAvgTotalPriceSQFT;
            const hiEstimateBMedian = targetTotalSQFT * hiMedianTotalPriceSQFT;
            const hiEstimateBLow68 = targetTotalSQFT * (hiAvgTotalPriceSQFT - hiStdDevTotalPriceSQFT);
            const hiEstimateBHigh68 = targetTotalSQFT * (hiAvgTotalPriceSQFT + hiStdDevTotalPriceSQFT);
            const hiEstimateBLow95 = targetTotalSQFT * (hiAvgTotalPriceSQFT - (2 * hiStdDevTotalPriceSQFT));
            const hiEstimateBHigh95 = targetTotalSQFT * (hiAvgTotalPriceSQFT + (2 * hiStdDevTotalPriceSQFT));

            const hiBlendedEstimate = (hiEstimateA * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (hiEstimateB * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
            const hiBlendedMedian = (hiEstimateAMedian * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (hiEstimateBMedian * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
            const hiBlendedLow68 = (hiEstimateALow68 * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (hiEstimateBLow68 * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
            const hiBlendedHigh68 = (hiEstimateAHigh68 * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (hiEstimateBHigh68 * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
            const hiBlendedLow95 = (hiEstimateALow95 * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (hiEstimateBLow95 * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);
            const hiBlendedHigh95 = (hiEstimateAHigh95 * WEIGHTING_CONSTANTS.BLENDED_BUILDING_WEIGHT) + (hiEstimateBHigh95 * WEIGHTING_CONSTANTS.BLENDED_LAND_WEIGHT);

            highInfluenceEstimateHTML = `
                <div class="estimate-box high-influence-estimate">
                    <h4>High Influence Properties Only</h4>
                    <div class="estimate-value">${formatCurrency(hiBlendedMedian)}</div>
                    <div class="estimate-formula">Median-Based - ${highInfluenceProps.length} high influence ${highInfluenceProps.length === 1 ? 'property' : 'properties'}</div>
                    <div class="confidence-interval">
                        <div class="ci-row"><span class="ci-label">Weighted Average:</span> <span class="ci-value">${formatCurrency(hiBlendedEstimate)}</span></div>
                        <div class="ci-row"><span class="ci-label">68% Confidence (±1σ):</span> <span class="ci-value">${formatCurrency(hiBlendedLow68)} - ${formatCurrency(hiBlendedHigh68)}</span></div>
                        <div class="ci-row"><span class="ci-label">95% Confidence (±2σ):</span> <span class="ci-value">${formatCurrency(hiBlendedLow95)} - ${formatCurrency(hiBlendedHigh95)}</span></div>
                    </div>
                </div>
            `;
        }
    }

    const container = document.getElementById('estimates-container');
    container.innerHTML = `
        <div class="estimate-box primary">
            <h4>NYC Appraisal Method</h4>
            <div class="estimate-value">${formatCurrency(nycEstimateMedian)}</div>
            <div class="estimate-formula" style="font-size: 0.95em; color: #555; margin-bottom: 12px;">
                ${formatNumber(targetBuildingSQFTWithFloors, 0)} SQFT × ${formatCurrency(medianBuildingPriceSQFT)}/SQFT = ${formatCurrency(nycBaseValueMedian)}
                ${landAdj.adjustment !== 0 ? ` <span style="color: ${landAdj.adjustment >= 0 ? '#27ae60' : '#e74c3c'};">${landAdj.adjustment >= 0 ? '+' : ''}${formatCurrency(landAdj.adjustment)}</span> lot` : ''}
                ${widthAdj.premium !== 0 ? ` <span style="color: ${widthAdj.premium >= 0 ? '#27ae60' : '#e74c3c'};">${widthAdj.premium >= 0 ? '+' : ''}${formatCurrency(widthAdj.premium)}</span> width` : ''}
            </div>
            
               
                <div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; font-size: 0.9em;">
                    <div style="margin-bottom: 8px;">
                        <strong>Base:</strong> <strong>${formatCurrency(nycBaseValueMedian)}</strong> 
                        <span style="font-size: 0.85em; color: #666;">(${formatNumber(targetBuildingSQFTWithFloors, 0)} SQFT × ${formatCurrency(medianBuildingPriceSQFT)}/SQFT)</span>
                    </div>
                    ${landAdj.adjustment !== 0 ? `
                    <div style="margin-bottom: 8px; color: ${landAdj.adjustment >= 0 ? '#27ae60' : '#e74c3c'};">
                        <strong style="color: #333;">Lot:</strong> ${landAdj.adjustment >= 0 ? '+' : ''}${formatCurrency(landAdj.adjustment)} 
                        <span style="font-size: 0.85em; color: #666;">(${landAdj.description}: ${formatNumber(targetProperty.propertySQFT, 0)} vs ${formatNumber(landAdj.typical, 0)} SQFT)</span>
                        <div style="margin-left: 20px; margin-top: 4px; font-size: 0.75em; color: #888;">
                            <div>• Regression method: ${landAdj.difference >= 0 ? '+' : ''}${formatNumber(landAdj.difference, 0)} SQFT × $${landAdj.dollarPerSQFT.toFixed(2)}/SQFT = ${landAdj.adjustment >= 0 ? '+' : ''}${formatCurrency(landAdj.adjustment)}</div>
                            ${landAdj.percentageComparison ? `
                            <div>• Industry std (±1% per 500 SQFT): ${landAdj.percentageComparison.adjustment >= 0 ? '+' : ''}${formatCurrency(landAdj.percentageComparison.adjustment)} (${(landAdj.percentageComparison.percentage * 100).toFixed(1)}%)</div>
                            ` : ''}
                            <div style="margin-top: 2px; font-style: italic;">Data source: Crown Heights sales regression (n=11, R²=94.0%)</div>
                        </div>
                    </div>
                    ` : ''}
                    ${widthAdj.premium !== 0 ? `
                    <div style="margin-bottom: 8px; color: ${widthAdj.premium >= 0 ? '#27ae60' : '#e74c3c'};">
                        <strong style="color: #333;">Width:</strong> ${widthAdj.premium >= 0 ? '+' : ''}${formatCurrency(widthAdj.premium)}
                        <span style="font-size: 0.85em; color: #666;">(${widthAdj.description}: ${targetProperty.buildingWidthFeet}' vs ${widthAdj.typical}')</span>
                        <div style="margin-left: 20px; margin-top: 4px; font-size: 0.75em; color: #888;">
                            <div>• Industry standard: ${widthAdj.difference >= 0 ? '+' : ''}${widthAdj.difference.toFixed(1)}' × ${(widthAdj.percentagePerFoot * 100).toFixed(1)}% × base value</div>
                            <div>• Equivalent to ${widthAdj.difference >= 0 ? '+' : ''}${formatCurrency(widthAdj.dollarPerFoot)}/foot for this property</div>
                            <div style="margin-top: 2px; font-style: italic;">Data source: USPAP/Fannie Mae guidelines (±1.5% per foot)</div>
                        </div>
                    </div>
                    ` : ''}
                    ${locationAdj.adjustment !== 0 ? `
                    <div style="margin-bottom: 8px; color: ${locationAdj.adjustment >= 0 ? '#27ae60' : '#e74c3c'};">
                        <strong style="color: #333;">Location:</strong> ${locationAdj.adjustment >= 0 ? '+' : ''}${formatCurrency(locationAdj.adjustment)}
                        <span style="font-size: 0.85em; color: #666;">(${locationAdj.description})</span>
                        <div style="margin-left: 20px; margin-top: 4px; font-size: 0.75em; color: #888;">
                            <div><strong>Transit (Nostrand Ave A/C):</strong></div>
                            <div style="margin-left: 10px;">• Distance: ${locationAdj.breakdown.transitDistance} (typical: ${locationAdj.breakdown.typicalTransitDistance})</div>
                            <div style="margin-left: 10px;">• Difference: ${locationAdj.breakdown.transitDifference} or ${locationAdj.breakdown.transitDifferenceBlocks}</div>
                            <div style="margin-left: 10px;">• Adjustment: ${locationAdj.breakdown.transitAdjustment >= 0 ? '+' : ''}${formatCurrency(locationAdj.breakdown.transitAdjustment)} (${locationAdj.breakdown.transitPenaltyPerMile}/mi or ${locationAdj.breakdown.transitPenaltyPerBlock}/block)</div>
                            <div style="margin-top: 4px;"><strong>Commercial (Franklin & Dean):</strong></div>
                            <div style="margin-left: 10px;">• Distance: ${locationAdj.breakdown.commercialDistance} (typical: ${locationAdj.breakdown.typicalCommercialDistance})</div>
                            <div style="margin-left: 10px;">• Difference: ${locationAdj.breakdown.commercialDifference} or ${locationAdj.breakdown.commercialDifferenceBlocks}</div>
                            <div style="margin-left: 10px;">• Adjustment: ${locationAdj.breakdown.commercialAdjustment >= 0 ? '+' : ''}${formatCurrency(locationAdj.breakdown.commercialAdjustment)} (${locationAdj.breakdown.commercialPenaltyPerMile}/mi or ${locationAdj.breakdown.commercialPenaltyPerBlock}/block)</div>
                            <div style="margin-top: 4px; font-style: italic;">Data source: ${locationAdj.dataSource}</div>
                            <div style="margin-top: 2px; font-style: italic; color: #666;">Note: Commercial amenities have ~2x the value impact of transit</div>
                        </div>
                    </div>
                    ` : ''}
                    ${totalAdjustments !== 0 ? `
                    <div style="border-top: 1px solid #ddd; padding-top: 8px; margin-top: 8px; font-weight: 600;">
                        <strong>Total Adjustments:</strong> <span style="color: ${totalAdjustments >= 0 ? '#27ae60' : '#e74c3c'};">${totalAdjustments >= 0 ? '+' : ''}${formatCurrency(totalAdjustments)}</span>
                    </div>
                    ` : ''}
                </div>
            
            <div class="confidence-interval" style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #e0e0e0;">
                <div style="display: flex; justify-content: space-between; font-size: 0.9em; margin-bottom: 4px;">
                    <span>Weighted Avg:</span><span style="font-weight: 600;">${formatCurrency(nycEstimateWeighted)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85em; color: #666;">
                    <span>68% range:</span><span>${formatCurrency(nycEstimateLow68)} - ${formatCurrency(nycEstimateHigh68)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85em; color: #666;">
                    <span>95% range:</span><span>${formatCurrency(nycEstimateLow95)} - ${formatCurrency(nycEstimateHigh95)}</span>
                </div>
            </div>
        </div>
        
        ${highInfluenceEstimateHTML}

        <!-- <div class="estimate-box" style="opacity: 0.7;">
            <h4>Legacy Blended Estimate</h4>
            <div class="estimate-value">${formatCurrency(blendedMedian)}</div>
            <div class="estimate-formula">Old Method (70% Building + 30% Land+Building Blend)</div>
            <div class="confidence-interval">
                <div class="ci-row"><span class="ci-label">Method A (Building-Based)</span> <span class="ci-value">${formatCurrency(estimateAMedian)}</span></div> 
                <div class="estimate-formula">${targetBuildingSQFTWithFloors} SQFT × ${formatCurrency(medianBuildingPriceSQFT)} Building Median $ SQFT</div> 
            </div> 
            <div class="confidence-interval">
                <div class="ci-row"><span class="ci-label">Method B (Total Property-Based)</span><span class="ci-value">${formatCurrency(estimateBMedian)}</div>
                <div class="estimate-formula">${targetTotalSQFT} SQFT × ${formatCurrency(medianTotalPriceSQFT)} Total Median $ SQFT</div> 
            </div>
            <div class="confidence-interval">
                <div class="ci-row"><span class="ci-label">Weighted Average:</span> <span class="ci-value">${formatCurrency(blendedEstimate)}</span></div>
                <div class="estimate-formula" style="display: flex; justify-content: space-between;"><span>68% Confidence (±1σ):</span><span>${formatCurrency(blendedLow68)} - ${formatCurrency(blendedHigh68)}</span></div>
                <div class="estimate-formula" style="display: flex; justify-content: space-between;"><span>95% Confidence (±2σ):</span><span>${formatCurrency(blendedLow95)} - ${formatCurrency(blendedHigh95)}</span></div>
            </div>
        </div> -->
    `;

    // Get selected direct comp
    const directCompProp = comparableProperties.find(p => p.isDirectComp);
    const directCompValue = directCompProp ? directCompProp.adjustedSalePrice : 0;
    const directCompAddress = directCompProp ? directCompProp.address : 'None selected';

    let directCompBuildingPriceSQFT = 0;
    let directCompEstimate = 0;
    if (directCompProp) {
        directCompBuildingPriceSQFT = directCompProp.buildingPriceSQFT;
        directCompEstimate = directCompBuildingPriceSQFT * targetBuildingSQFTWithFloors;
    }

    // Reference values
    const refContainer = document.getElementById('reference-values');
    refContainer.innerHTML = `
        <div class="estimate-box minimized">
            <h4>Direct Comp Sale Price</h4>
            <div class="estimate-value">${formatCurrency(directCompValue)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompAddress}</div>
        </div>
        <div class="estimate-box minimized">
            <h4>Direct Comp Building-Based</h4>
            <div class="estimate-value">${formatCurrency(directCompEstimate)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompProp ? formatCurrency(directCompBuildingPriceSQFT) + ' × (' + targetProperty.floors + ' floors × ' + targetProperty.buildingWidthFeet + ' × ' + targetProperty.buildingDepthFeet + ')' : 'No comp selected'}</div>
        </div>
    `;

    calculateAndRenderAverages();
    
    // Display validation results after rendering estimates
    if (validationResults.length > 0) {
        displayValidationResults(validationResults);
    }
}

// Change target property based on dropdown selection
function changeTargetProperty() {
    const dropdown = document.getElementById('target-property-select');
    const selectedIndex = parseInt(dropdown.value);

    if (isNaN(selectedIndex) || !Array.isArray(importedTarget)) return;

    const selectedProperty = importedTarget[selectedIndex];
    if (!selectedProperty) return;

    // Process the selected property
    targetProperty = processImportedProperty(selectedProperty);
    targetProperty.estimatedSale = selectedProperty.estimatedSale || 0;
    targetProperty.developerPrice = selectedProperty.referenceValues?.developerPrice || 0;
    targetProperty.fairMarketValue = selectedProperty.referenceValues?.fairMarketValue || 0;

    // Re-render everything
    renderTargetProperty();
    calculateAndRenderEstimates();
    renderComparables(); // Update comparable properties with new weights and high-influence badges
    updateMap();
}

// Expose to global scope
window.changeTargetProperty = changeTargetProperty;

// Quick filter functions
/*function selectAllComps() {
    comparableProperties.forEach(p => p.included = true);
    calculateAndRenderEstimates();
    renderComparables();
    updateMap();
}

function deselectAllComps() {
    comparableProperties.forEach(p => p.included = false);
    calculateAndRenderEstimates();
    renderComparables();
    updateMap();
}

function filterRenovated() {
    comparableProperties.forEach(p => {
        p.included = p.renovated === 'Yes';
    });
    calculateAndRenderEstimates();
    renderComparables();
    updateMap();
}

function filterTaxClass1() {
    comparableProperties.forEach(p => {
        p.included = String(p.taxClass).trim() === '1';
    });
    calculateAndRenderEstimates();
    renderComparables();
    updateMap();
}*/

// Set weighting method directly
function setWeightingMethod(method) {
    weightingMethod = method;

    // Update button states
    document.querySelectorAll('.weight-btn').forEach(btn => {
        if (btn.dataset.method === method) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    calculateAndRenderEstimates();
    renderComparables();
    updateMap(); // Update map to reflect new weights in heatmap
}

// Expose to global scope
window.setWeightingMethod = setWeightingMethod;

// Expose filter functions to global scope
//window.selectAllComps = selectAllComps;
//window.deselectAllComps = deselectAllComps;
//window.filterRenovated = filterRenovated;
//window.filterTaxClass1 = filterTaxClass1;

// ============================================
// MAP FUNCTIONALITY
// ============================================

// Geocode an address using Nominatim (OpenStreetMap)
async function geocodeAddress(address) {
    try {
        const encodedAddress = encodeURIComponent(address);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'CrownHeightsPropertyEstimator/1.0'
            }
        });

        if (!response.ok) {
            throw new Error('Geocoding request failed');
        }

        const data = await response.json();

        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon)
            };
        }
        return null;
    } catch (error) {
        console.error('Geocoding error for', address, ':', error);
        return null;
    }
}

// Geocode all properties
async function geocodeAllProperties() {
    if (geocodingInProgress) return;

    geocodingInProgress = true;
    const statusEl = document.getElementById('map-status');
    statusEl.textContent = 'Geocoding addresses...';

    let needsExport = false;

    // Geocode target property
    if (targetProperty && !targetProperty.coordinates) {
        statusEl.textContent = 'Geocoding target property...';
        const coords = await geocodeAddress(targetProperty.address);
        if (coords) {
            targetProperty.coordinates = coords;
            needsExport = true;
            console.log(`Target: ${targetProperty.address}`, coords);
        }
        // Add delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Geocode comparable properties
    for (let i = 0; i < comparableProperties.length; i++) {
        const prop = comparableProperties[i];
        if (!prop.coordinates) {
            statusEl.textContent = `Geocoding... (${i + 1}/${comparableProperties.length})`;
            const coords = await geocodeAddress(prop.address);
            if (coords) {
                prop.coordinates = coords;
                needsExport = true;
                console.log(`${prop.address}`, coords);
            }
            // Add delay to respect rate limits (1 request per second)
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    geocodingInProgress = false;

    if (needsExport) {
        statusEl.innerHTML = 'Map ready - <button onclick="exportCoordinates()" style="padding: 4px 8px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Export Coordinates to Console</button>';
    } else {
        statusEl.textContent = 'Map ready';
    }

    // Update the map
    updateMap();
}

// Initialize the map
function initializeMap() {
    // Get center coordinates from target property if available, otherwise use Crown Heights default
    const centerLat = targetProperty?.coordinates?.lat || 40.6687;
    const centerLng = targetProperty?.coordinates?.lng || -73.9428;

    // Create map centered on target property with interactions disabled
    map = L.map('map', {
        dragging: false,
        touchZoom: false,
        doubleClickZoom: false,
        scrollWheelZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomControl: false
    }).setView([centerLat, centerLng], 14);

    // Create custom panes with specific z-index for layer ordering
    // Default overlayPane is at z-index 400
    map.createPane('amenitiesPane');
    map.getPane('amenitiesPane').style.zIndex = 401; // Bottom overlay layer
    map.getPane('amenitiesPane').style.opacity = 0.5; // Set overall opacity for amenities pane

    map.createPane('valueZonesPane');
    map.getPane('valueZonesPane').style.zIndex = 402; // Middle overlay layer

    map.createPane('influencePane');
    map.getPane('influencePane').style.zIndex = 403; // Top overlay layer (but below markers)

    map.createPane('markersPane');
    map.getPane('markersPane').style.zIndex = 450; // Always on top

    // Add minimal grayscale CartoDB tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors, © CARTO',
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(map);

    // Create layers with specific panes
    markersLayer = L.layerGroup({ pane: 'markersPane' }).addTo(map);

    // Add legend (will be updated dynamically based on mode)
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'map-legend');
        div.id = 'map-legend-content';
        div.innerHTML = `
            <h4>Price Range</h4>
            <div class="legend-item"><span class="legend-color" style="background: #4CAF50;"></span> Low</div>
            <div class="legend-item"><span class="legend-color" style="background: #F1C40F;"></span> Medium</div>
            <div class="legend-item"><span class="legend-color" style="background: #E74C3C;"></span> High</div>
            <div class="legend-item"><span class="legend-color" style="background: #5372cfff;"></span> Target</div>
            <div class="legend-item"><span class="legend-color" style="background: #eb70e9ff;"></span> Direct Comp</div>
        `;
        return div;
    };
    legend.addTo(map);

    // Create amenities overlay data for Crown Heights
    createAmenitiesOverlay();

    // Start geocoding
    geocodeAllProperties();
}

// Get color based on price
function getPriceColor(price, metric = 'salePrice') {
    // Color scale from green (low) to red (high)
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0);
    if (included.length === 0) return '#3498db';

    let values = [];
    if (metric === 'salePrice') {
        values = included.map(p => p.adjustedSalePrice);
    } else if (metric === 'buildingPriceSQFT') {
        values = included.map(p => p.buildingPriceSQFT);
    } else if (metric === 'totalPriceSQFT') {
        values = included.map(p => p.totalPriceSQFT);
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    let value = 0;
    if (metric === 'salePrice') {
        value = price;
    } else if (metric === 'buildingPriceSQFT') {
        value = price;
    } else if (metric === 'totalPriceSQFT') {
        value = price;
    }

    const normalized = (value - min) / (max - min);

    // Green to Yellow to Red
    if (normalized < 0.5) {
        const t = normalized * 2;
        return `rgb(${Math.round(76 + (241 - 76) * t)}, ${Math.round(175 + (196 - 175) * t)}, ${Math.round(80 + (15 - 80) * t)})`;
    } else {
        const t = (normalized - 0.5) * 2;
        return `rgb(${Math.round(241 + (231 - 241) * t)}, ${Math.round(196 + (76 - 196) * t)}, ${Math.round(15 + (60 - 15) * t)})`;
    }
}

// Create marker tooltip content (hover)
function createTooltipContent(prop, isTarget = false) {
    const badge = isTarget ? 'TARGET' : prop.isDirectComp ? 'DIRECT COMP' : '';
    const badgeSpan = badge ? `<span style="background: ${isTarget ? '#5372cfff' : '#eb70e9ff'}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 9px; margin-left: 6px;">${badge}</span>` : '';

    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; line-height: 1.4;">
        <div style="font-weight: 600; margin-bottom: 4px;">${prop.address}${badgeSpan}</div>
        <div><strong>Price:</strong> ${formatCurrency(prop.adjustedSalePrice || prop.salePrice || 0)}</div>
        <div><strong>Building $/SQFT:</strong> ${formatCurrency(prop.buildingPriceSQFT || 0)}</div>
        <div><strong>Renovated:</strong> ${prop.renovated}</div>
    </div>`;
}

// Create marker popup content
function createPopupContent(prop, isTarget = false) {
    const badge = isTarget ? '<span class="popup-badge badge-target">TARGET</span>' :
        prop.isDirectComp ? '<span class="popup-badge badge-direct">DIRECT COMP</span>' : '';

    // Build comprehensive field list including data removed from table
    const fields = [
        { label: 'Sale Price', value: formatCurrency(prop.adjustedSalePrice || prop.salePrice || 0) },
        { label: 'Sale Date', value: prop.sellDate || 'N/A' },
        { label: 'Building $/SQFT', value: formatCurrency(prop.buildingPriceSQFT || 0) },
        { label: 'Total $/SQFT', value: formatCurrency(prop.totalPriceSQFT || 0) },
        { label: 'Property SQFT', value: formatNumber(prop.propertySQFT, 0) },
        { label: 'Building SQFT', value: formatNumber(prop.buildingSQFT, 0) },
        { label: 'Dimensions', value: formatBuildingDimensions(prop.buildingWidthFeet, prop.buildingDepthFeet, prop.floors).replace(/×/g, ' × ') },
        { label: 'Renovated', value: prop.renovated },
        { label: 'Original Details', value: prop.originalDetails || 'N/A' },
        { label: 'Tax Class', value: prop.taxClass },
        { label: 'Occupancy', value: prop.occupancy || 'N/A' },
        { label: 'Distance to Transit', value: prop.distanceToKeyLocation !== undefined ? formatNumber(prop.distanceToKeyLocation, 2) + ' mi' : 'N/A' }
    ];

    let html = `<div class="popup-content">
        <h4>${prop.address}${badge}</h4>`;

    fields.forEach(field => {
        html += `<div class="popup-field">
            <span class="popup-label">${field.label}:</span>
            <span class="popup-value">${field.value}</span>
        </div>`;
    });

    html += '</div>';
    return html;
}

// Update map with markers or heatmap
function updateMap() {
    if (!map) return;

    // Clear existing overlay layers
    if (heatmapLayer) {
        map.removeLayer(heatmapLayer);
        heatmapLayer = null;
    }
    if (valueZonesLayer) {
        map.removeLayer(valueZonesLayer);
        valueZonesLayer = null;
    }
    if (amenitiesOverlayLayer) {
        map.removeLayer(amenitiesOverlayLayer);
    }

    // Update overlays based on toggle states
    // IMPORTANT: Draw amenities FIRST (bottom layer) if active
    if (showAmenitiesOverlay && amenitiesOverlayLayer) {
        map.addLayer(amenitiesOverlayLayer);
        // Set opacity based on other active layers
        setTimeout(() => {
            if (amenitiesOverlayLayer._canvas) {
                const canvas = amenitiesOverlayLayer._canvas;
                if (showHeatmap && showValueZones) {
                    canvas.style.opacity = '0.8';   // All three active - brightest
                } else if (showHeatmap || showValueZones) {
                    canvas.style.opacity = '0.65';  // Two active - moderate brightness
                } else {
                    canvas.style.opacity = '0.5';   // Solo - subtle
                }
            }
        }, 5);
    }

    // Then draw data layers on top
    // If both are active, show combined/blended visualization
    // Otherwise, show individual overlays
    if (showHeatmap && showValueZones) {
        // Combined mode: blend both datasets into one visualization
        updateMapCombined();
    } else {
        // Individual modes: show one or the other
        // Order matters: Value Zones (402) first, then Weights Influence (403) on top
        if (showValueZones) {
            updateMapValueZones();
        }
        if (showHeatmap) {
            updateMapHeatmap();
        }
    }

    // Always update markers on top
    if (markersLayer) {
        markersLayer.clearLayers();
    }
    updateMapMarkers();
}

// Update map with markers
function updateMapMarkers() {
    if (!markersLayer) return;

    const bounds = [];

    // Add target property marker
    if (targetProperty && targetProperty.coordinates) {
        const marker = L.circleMarker([targetProperty.coordinates.lat, targetProperty.coordinates.lng], {
            radius: 10,
            fillColor: '#5372cfff',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8,
            zIndexOffset: 100
        })
            .bindTooltip(createTooltipContent(targetProperty, true), {
                permanent: false,
                direction: 'top',
                offset: [0, -10]
            })
            .bindPopup(createPopupContent(targetProperty, true));

        markersLayer.addLayer(marker);
        bounds.push([targetProperty.coordinates.lat, targetProperty.coordinates.lng]);
    }

    // Separate direct comps from regular comps
    const regularComps = [];
    const directComps = [];

    comparableProperties.forEach(prop => {
        if (prop.coordinates && prop.included) {
            if (prop.isDirectComp) {
                directComps.push(prop);
            } else {
                regularComps.push(prop);
            }
        }
    });

    // Add regular comparable property markers first
    regularComps.forEach(prop => {
        const color = getPriceColor(prop.adjustedSalePrice);

        const marker = L.circleMarker([prop.coordinates.lat, prop.coordinates.lng], {
            radius: 5,
            fillColor: color,
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.7,
            zIndexOffset: 0
        })
            .bindTooltip(createTooltipContent(prop, false), {
                permanent: false,
                direction: 'top',
                offset: [0, -10]
            })
            .bindPopup(createPopupContent(prop, false));

        markersLayer.addLayer(marker);
        bounds.push([prop.coordinates.lat, prop.coordinates.lng]);
    });

    // Add direct comp markers last (on top) with higher z-index
    directComps.forEach(prop => {
        const marker = L.circleMarker([prop.coordinates.lat, prop.coordinates.lng], {
            radius: 9,
            fillColor: '#eb70e9ff',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.85,
            zIndexOffset: 200
        })
            .bindTooltip(createTooltipContent(prop, false), {
                permanent: false,
                direction: 'top',
                offset: [0, -10]
            })
            .bindPopup(createPopupContent(prop, false));

        markersLayer.addLayer(marker);
        bounds.push([prop.coordinates.lat, prop.coordinates.lng]);
    });

    // Fit map to bounds
    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

// Update map with heatmap
function updateMapHeatmap() {
    const heatData = [];

    // Calculate weights for all included properties using centralized utility function
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0 && p.coordinates);

    if (included.length === 0) return; // No data to display

    // Calculate weights using centralized utility function
    const weights = calculatePropertyWeights(included, targetProperty, weightingMethod);

    // Use weights as heatmap intensity - create ultra-dense grid for ultra-smooth gradient diffusion
    included.forEach((prop, index) => {
        const weight = weights[index] / 100; // Normalize to 0-1 for consistency with valueZonesLayer

        // Create ultra-dense grid of heat points for glass-smooth gradient without any banding
        const rings = 20;  // More rings for finer gradient steps
        const pointsPerRing = 48;  // More points per ring for seamless circular blending
        const maxRadius = 0.0025;  // Same coverage area

        // Add multiple center points with higher weight for solid core
        heatData.push([prop.coordinates.lat, prop.coordinates.lng, weight * 0.8]);
        heatData.push([prop.coordinates.lat, prop.coordinates.lng, weight * 0.8]);
        heatData.push([prop.coordinates.lat, prop.coordinates.lng, weight * 0.8]);
        heatData.push([prop.coordinates.lat, prop.coordinates.lng, weight * 0.75]);
        heatData.push([prop.coordinates.lat, prop.coordinates.lng, weight * 0.75]);

        // Add concentric rings with smooth exponential falloff for natural gradient
        for (let ring = 1; ring <= rings; ring++) {
            const ringRadius = (maxRadius / rings) * ring;
            // Use exponential decay for smoother, more natural falloff
            const ringWeight = weight * Math.pow(1 - (ring / (rings + 3)), 1.5);

            for (let i = 0; i < pointsPerRing; i++) {
                const angle = (Math.PI * 2 * i) / pointsPerRing;
                heatData.push([
                    prop.coordinates.lat + Math.cos(angle) * ringRadius,
                    prop.coordinates.lng + Math.sin(angle) * ringRadius,
                    ringWeight
                ]);
            }
        }
    });

    if (heatData.length > 0) {
        heatmapLayer = L.heatLayer(heatData, {
            radius: 20,        // Same as valueZonesLayer for consistent diffusion
            blur: 20,          // Same as valueZonesLayer for consistent diffusion
            maxZoom: 17,
            max: 10,           // Same as valueZonesLayer for gradual buildup
            gradient: {
                0.0: 'rgba(33, 150, 243, 0.0)',     // Deep Blue = low influence (transparent at edges)
                0.1: 'rgba(33, 150, 243, 0.15)',    // Deep Blue (more transparent)
                0.25: 'rgba(63, 81, 181, 0.2)',     // Indigo
                0.4: 'rgba(103, 58, 183, 0.25)',    // Deep Purple
                0.55: 'rgba(156, 39, 176, 0.3)',    // Purple
                0.7: 'rgba(171, 71, 188, 0.35)',    // Medium Purple
                0.82: 'rgba(186, 104, 200, 0.4)',   // Light Purple
                0.9: 'rgba(233, 30, 99, 0.45)',     // Pink
                1.0: 'rgba(233, 30, 99, 0.5)'       // Hot Pink = high influence (center, less intense)
            },
            minOpacity: 0,     // No minimum opacity to show full gradient
            pane: 'influencePane'  // Use custom pane for layer ordering
        });

        // Patch before onAdd to intercept canvas creation at the earliest point
        const originalCreateCanvas = heatmapLayer._initCanvas;
        if (originalCreateCanvas) {
            heatmapLayer._initCanvas = function () {
                originalCreateCanvas.call(this);
                // Now patch the canvas's getContext after it's created but before it's used
                if (this._canvas) {
                    const canvas = this._canvas;
                    const originalGetContext = canvas.getContext.bind(canvas);
                    canvas.getContext = function (contextType, contextAttributes) {
                        if (contextType === '2d') {
                            return originalGetContext(contextType, { ...contextAttributes, willReadFrequently: true });
                        }
                        return originalGetContext(contextType, contextAttributes);
                    };
                }
            };
        }

        heatmapLayer.addTo(map);

        // Set canvas opacity and z-index after layer is added
        setTimeout(() => {
            if (heatmapLayer._canvas) {
                const canvas = heatmapLayer._canvas;
                // Adjust opacity based on how many layers are active
                // More layers = brighter colors for richer visualization
                if (showValueZones && showAmenitiesOverlay) {
                    canvas.style.opacity = '0.8';   // All three active - brightest
                } else if (showValueZones || showAmenitiesOverlay) {
                    canvas.style.opacity = '0.65';  // Two active - moderate brightness
                } else {
                    canvas.style.opacity = '0.5';   // Solo - subtle
                }
            }
        }, 5);
    }
}

// Show markers view
// Removed showMapMarkers function - markers are now always displayed

// Show heatmap view (toggleable)
function showMapHeatmap() {
    const btn = document.getElementById('map-heatmap-btn');

    // Toggle heatmap independently
    showHeatmap = !showHeatmap;

    if (showHeatmap) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }

    // Update legend based on active overlays
    updateMapLegend();
    updateMap();
}

// Show value zones view (toggleable)
function showMapValueZones() {
    const btn = document.getElementById('map-value-zones-btn');

    // Toggle value zones independently
    showValueZones = !showValueZones;

    if (showValueZones) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }

    // Update legend based on active overlays
    updateMapLegend();
    updateMap();
}

// Update legend based on active overlays
function updateMapLegend() {
    const legendContent = document.getElementById('map-legend-content');
    if (!legendContent) return;

    if (showHeatmap && showValueZones && showAmenitiesOverlay) {
        // All three active - show triple-blended legend
        const methodName = avgTypeMap[weightingMethod] || 'Simple Average';
        legendContent.innerHTML = `
            <h4>Full Blended View</h4>
            <div style="font-size: 9px; color: #666; margin-bottom: 6px;">Values + Weights + Amenities Combined</div>
            <div style="margin-bottom: 8px;">
                <div style="font-size: 10px; font-weight: 600; color: #666; margin-bottom: 2px;">Property Value (Color)</div>
                <div style="background: linear-gradient(to right, rgba(33, 150, 243, 0.5), rgba(156, 39, 176, 0.5), rgba(233, 30, 99, 0.5)); height: 10px; border-radius: 3px; margin: 3px 0;"></div>
                <div style="display: flex; justify-content: space-between; font-size: 8px; color: #666;">
                    <span>Lower Value</span>
                    <span>Higher Value</span>
                </div>
            </div>
            <div style="font-size: 8px; margin-top: 6px; color: #888; line-height: 1.4;">
                <div><strong>Hue:</strong> Blue = Cheaper, Pink = Expensive</div>
                <div><strong>Intensity:</strong> Dim = Low weight, Bright = High weight</div>
                <div><strong>Glow:</strong> Green tint from nearby amenities</div>
            </div>
            <p style="font-size: 8px; margin-top: 6px; color: #999; font-style: italic;">Using: ${methodName}</p>
        `;
    } else if (showHeatmap && showValueZones) {
        // Both active - show combined/blended legend
        const methodName = avgTypeMap[weightingMethod] || 'Simple Average';
        legendContent.innerHTML = `
            <h4>Blended View</h4>
            <div style="font-size: 10px; color: #666; margin-bottom: 8px;">Value Zones + Weight Influence Combined</div>
            <div style="margin-bottom: 10px;">
                <div style="font-size: 11px; font-weight: 600; color: #666; margin-bottom: 3px;">Property Value (Color)</div>
                <div style="background: linear-gradient(to right, rgba(33, 150, 243, 0.5), rgba(156, 39, 176, 0.5), rgba(233, 30, 99, 0.5)); height: 12px; border-radius: 3px; margin: 4px 0;"></div>
                <div style="display: flex; justify-content: space-between; font-size: 9px; color: #666;">
                    <span>Lower Value</span>
                    <span>Higher Value</span>
                </div>
            </div>
            <div style="font-size: 9px; margin-top: 8px; color: #888;">
                <div><strong>Color:</strong> Blue = Cheaper properties, Pink = Expensive properties</div>
                <div><strong>Brightness:</strong> Dim = Low weight influence, Bright = High weight influence</div>
            </div>
            <p style="font-size: 9px; margin-top: 8px; color: #999; font-style: italic;">Using: ${methodName}</p>
        `;
    } else if ((showHeatmap || showValueZones) && showAmenitiesOverlay) {
        // One data layer + amenities
        const layerName = showHeatmap ? 'Weights Influence' : 'Value Zones';
        const methodName = avgTypeMap[weightingMethod] || 'Simple Average';
        legendContent.innerHTML = `
            <h4>${layerName} + Amenities</h4>
            <div style="font-size: 10px; color: #666; margin-bottom: 8px;">Property data enhanced with walkability</div>
            <div style="margin-bottom: 8px;">
                <div style="background: linear-gradient(to right, ${showHeatmap ? '#2196F3, #9C27B0, #E91E63' : '#2196F3, #9C27B0, #E91E63'}); height: 12px; border-radius: 3px; margin: 4px 0;"></div>
                <div style="display: flex; justify-content: space-between; font-size: 9px; color: #666;">
                    <span>${showHeatmap ? 'Low Influence' : 'Lower Value'}</span>
                    <span>${showHeatmap ? 'High Influence' : 'Higher Value'}</span>
                </div>
            </div>
            <div style="font-size: 9px; margin-top: 8px; color: #888;">
                <div>Base layer shows ${showHeatmap ? 'property influence on valuation' : 'property value distribution'}</div>
                <div>Green glow indicates proximity to transit/amenities</div>
            </div>
            <p style="font-size: 9px; margin-top: 8px; color: #999; font-style: italic;">${showHeatmap ? 'Using: ' + methodName : ''}</p>
        `;
    } else if (showHeatmap) {
        // Only heatmap active
        const methodName = avgTypeMap[weightingMethod] || 'Simple Average';
        legendContent.innerHTML = `
            <h4>Influence Heat Map</h4>
            <p style="font-size: 11px; margin: 5px 0; color: #666;">Shows where valuation is being pulled from</p>
            <div style="background: linear-gradient(to right, #4CAF50, #FFC107, #E74C3C); height: 20px; border-radius: 3px; margin: 8px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #666;">
                <span>Low Influence</span>
                <span>High Influence</span>
            </div>
            <p style="font-size: 10px; margin-top: 8px; color: #888;">Brighter/hotter areas = properties with more weight in estimate</p>
            <p style="font-size: 9px; margin-top: 5px; color: #999; font-style: italic;">Using: ${methodName}</p>
        `;
    } else if (showValueZones) {
        // Only value zones active
        legendContent.innerHTML = `
            <h4>Value Zones</h4>
            <p style="font-size: 11px; margin: 5px 0; color: #666;">Property value concentration</p>
            <div style="background: linear-gradient(to right, #2196F3, #9C27B0, #E91E63); height: 20px; border-radius: 3px; margin: 8px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #666;">
                <span>Lower Value</span>
                <span>Higher Value</span>
            </div>
            <p style="font-size: 10px; margin-top: 8px; color: #888;">Pink areas = expensive properties (hot zones)</p>
        `;
    } else if (showAmenitiesOverlay) {
        // Only amenities active
        legendContent.innerHTML = `
            <h4>Walkability & Amenities</h4>
            <p style="font-size: 11px; margin: 5px 0; color: #666;">Transit, dining, and parks</p>
            <div style="background: linear-gradient(to right, rgba(220, 50, 50, 0.3), rgba(255, 220, 80, 0.3), rgba(60, 170, 90, 0.4)); height: 20px; border-radius: 3px; margin: 8px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #666;">
                <span>Less Walkable</span>
                <span>Highly Walkable</span>
            </div>
            <p style="font-size: 10px; margin-top: 8px; color: #888;">Green areas = close to subway, shops, restaurants</p>
        `;
    } else {
        // Neither active - show default legend
        legendContent.innerHTML = `
            <h4>Price Range</h4>
            <div class="legend-item"><span class="legend-color" style="background: #4CAF50;"></span> Low</div>
            <div class="legend-item"><span class="legend-color" style="background: #F1C40F;"></span> Medium</div>
            <div class="legend-item"><span class="legend-color" style="background: #E74C3C;"></span> High</div>
            <div class="legend-item"><span class="legend-color" style="background: #5372cfff;"></span> Target</div>
            <div class="legend-item"><span class="legend-color" style="background: #eb70e9ff;"></span> Direct Comp</div>
        `;
    }
}

// Update heatmap when metric changes
function updateHeatmap() {
    if (showHeatmap) {
        updateMap();
    }
}

// Update map with combined/blended overlay (Weights Influence + Value Zones)
function updateMapCombined() {
    const heatPoints = [];

    // Get all included properties with valid data
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0 && p.coordinates);

    if (included.length === 0) return; // No data to display

    // Calculate weights for influence component
    const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
    const targetSize = targetProperty.buildingSQFT;
    const targetTotalSize = calculateTotalPropertySQFT(targetProperty.propertySQFT, targetProperty.buildingSQFT, targetProperty.buildingWidthFeet, targetProperty.buildingDepthFeet);

    let weights = [];

    if (weightingMethod === 'simple') {
        weights = included.map(() => 100 / included.length);
    } else if (weightingMethod === 'price') {
        weights = included.map(p => (p.adjustedSalePrice / totalPrice) * 100);
    } else if (weightingMethod === 'size') {
        const sizeWeights = included.map(p => {
            const compSize = p.buildingSQFT;
            const sizeDiff = Math.abs(compSize - targetSize);
            return 1 / (1 + sizeDiff / targetSize);
        });
        const totalSizeWeight = sizeWeights.reduce((sum, w) => sum + w, 0);
        weights = sizeWeights.map(w => (w / totalSizeWeight) * 100);
    } else if (weightingMethod === 'total-size') {
        const totalSizeWeights = included.map(p => {
            const compTotalSize = calculateTotalPropertySQFT(p.propertySQFT, p.buildingSQFT, p.buildingWidthFeet, p.buildingDepthFeet);
            const totalSizeDiff = Math.abs(compTotalSize - targetTotalSize);
            return 1 / (1 + totalSizeDiff / targetTotalSize);
        });
        const totalPropertySizeWeight = totalSizeWeights.reduce((sum, w) => sum + w, 0);
        weights = totalSizeWeights.map(w => (w / totalPropertySizeWeight) * 100);
    } else {
        // For other methods, use similar logic as in renderComparables
        weights = included.map(() => 100 / included.length);
    }

    // Calculate price normalization for value zones component
    const prices = included.map(p => p.adjustedSalePrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;

    // Create blended heat points where VALUE determines COLOR and WEIGHT determines INTENSITY
    // This preserves both data types: high value = green, low value = red (zone colors)
    // High weight = brighter/more opaque, low weight = dimmer/more transparent (influence intensity)
    included.forEach((prop, index) => {
        // Normalize weight (0-1) - controls INTENSITY/BRIGHTNESS
        const normalizedWeight = weights[index] / 100;

        // Normalize price (0-1) - controls COLOR (hue position in gradient)
        const normalizedPrice = priceRange > 0 ? (prop.adjustedSalePrice - minPrice) / priceRange : 0.5;

        // Use price as the base intensity (determines position in gradient = color)
        // Then multiply by weight to adjust brightness (high weight = more visible)
        // This way: expensive properties are green, cheap are red (value zones preserved)
        // And high-influence areas are brighter, low-influence are dimmer
        // Using linear scaling for proportional representation
        const colorPosition = normalizedPrice; // 0 = red (cheap), 1 = green (expensive)
        const intensityMultiplier = 0.3 + (normalizedWeight * 0.7); // Weight affects visibility (0.3-1.0 range)
        const finalIntensity = colorPosition * intensityMultiplier;

        // Create ultra-dense grid of heat points for glass-smooth gradient without any banding
        const rings = 20;  // More rings for finer gradient steps
        const pointsPerRing = 48;  // More points per ring for seamless circular blending
        const maxRadius = 0.0025;  // Same coverage area

        // Add multiple center points with higher weight for solid core
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, finalIntensity * 0.8]);
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, finalIntensity * 0.8]);
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, finalIntensity * 0.8]);
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, finalIntensity * 0.75]);
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, finalIntensity * 0.75]);

        // Add concentric rings with smooth exponential falloff for natural gradient
        for (let ring = 1; ring <= rings; ring++) {
            const ringRadius = (maxRadius / rings) * ring;
            // Use exponential decay for smoother, more natural falloff
            const ringWeight = finalIntensity * Math.pow(1 - (ring / (rings + 3)), 1.5);

            for (let i = 0; i < pointsPerRing; i++) {
                const angle = (Math.PI * 2 * i) / pointsPerRing;
                heatPoints.push([
                    prop.coordinates.lat + Math.cos(angle) * ringRadius,
                    prop.coordinates.lng + Math.sin(angle) * ringRadius,
                    ringWeight
                ]);
            }
        }
    });

    if (heatPoints.length > 0) {
        // Create blended layer where gradient represents VALUE (green=cheap → red=expensive)
        // and opacity/intensity represents WEIGHT (dim=low influence → bright=high influence)
        const combinedLayer = L.heatLayer(heatPoints, {
            radius: 20,        // Optimized for ultra-dense point grid
            blur: 20,          // Matched to radius for artifact-free rendering
            maxZoom: 17,
            max: 10,           // Gradual buildup for smooth intensity transitions
            gradient: {
                // Blue-Purple-Pink gradient: blue (cheap) → purple → pink (expensive)
                // Weight influence controls how bright/visible each color appears
                0.0: 'rgba(33, 150, 243, 0.0)',     // Deep Blue = cheap properties (transparent at edges)
                0.1: 'rgba(33, 150, 243, 0.2)',     // Deep Blue (low value areas, dim if low weight)
                0.2: 'rgba(63, 81, 181, 0.25)',     // Indigo
                0.3: 'rgba(103, 58, 183, 0.3)',     // Deep Purple
                0.4: 'rgba(156, 39, 176, 0.35)',    // Purple (mid-value)
                0.5: 'rgba(171, 71, 188, 0.4)',     // Medium Purple
                0.6: 'rgba(186, 104, 200, 0.45)',   // Light Purple
                0.7: 'rgba(233, 30, 99, 0.5)',      // Pink
                0.85: 'rgba(240, 98, 146, 0.55)',   // Hot Pink (high value)
                1.0: 'rgba(233, 30, 99, 0.6)'       // Hot Pink = expensive properties (brightest when high weight)
            },
            minOpacity: 0,
            pane: 'influencePane'
        });

        // Patch for canvas performance
        const originalCreateCanvas = combinedLayer._initCanvas;
        if (originalCreateCanvas) {
            combinedLayer._initCanvas = function () {
                originalCreateCanvas.call(this);
                if (this._canvas) {
                    const canvas = this._canvas;
                    const originalGetContext = canvas.getContext.bind(canvas);
                    canvas.getContext = function (contextType, contextAttributes) {
                        if (contextType === '2d') {
                            return originalGetContext(contextType, { ...contextAttributes, willReadFrequently: true });
                        }
                        return originalGetContext(contextType, contextAttributes);
                    };
                }
            };
        }

        combinedLayer.addTo(map);

        // Set canvas styling with opacity adjusted for amenities overlay
        setTimeout(() => {
            if (combinedLayer._canvas) {
                // Increase opacity when amenities are also active for brighter three-way blend
                combinedLayer._canvas.style.opacity = showAmenitiesOverlay ? '0.75' : '0.6';
            }
        }, 5);

        // Store reference (reuse heatmapLayer for simplicity)
        heatmapLayer = combinedLayer;
    }
}

// Update map with value zones (property value gradient)
function updateMapValueZones() {
    const heatPoints = [];

    // Get all included properties with valid data
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0 && p.coordinates);

    if (included.length === 0) return;

    // Find min and max prices for normalization
    const prices = included.map(p => p.adjustedSalePrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;

    // Create dense grid of heat points for smooth continuous gradient (like Amenities Overlay)
    included.forEach(prop => {
        // Normalize price to 0-1 range
        const normalizedIntensity = priceRange > 0 ? (prop.adjustedSalePrice - minPrice) / priceRange : 0.5;
        // Use linear scaling for proportional representation
        const weight = normalizedIntensity;

        // Create denser grid of heat points for smooth continuous gradient without artifacts
        const rings = 12;  // More rings for smoother coverage
        const pointsPerRing = 32;  // More points around each ring for seamless blending
        const maxRadius = 0.0025;  // Larger radius for more spread

        // Add multiple center points with reduced weight for solid core
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, weight * 0.7]);
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, weight * 0.7]);
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, weight * 0.7]);

        // Add concentric rings with decreasing weight
        for (let ring = 1; ring <= rings; ring++) {
            const ringRadius = (maxRadius / rings) * ring;
            const ringWeight = weight * (1 - (ring / (rings + 2))); // Gentler falloff

            for (let i = 0; i < pointsPerRing; i++) {
                const angle = (Math.PI * 2 * i) / pointsPerRing;
                heatPoints.push([
                    prop.coordinates.lat + Math.cos(angle) * ringRadius,
                    prop.coordinates.lng + Math.sin(angle) * ringRadius,
                    ringWeight
                ]);
            }
        }
    });

    if (heatPoints.length > 0) {
        valueZonesLayer = L.heatLayer(heatPoints, {
            radius: 20,       // Much larger radius for wide spread
            blur: 20,         // Match radius to prevent artifacts while maintaining smoothness
            maxZoom: 17,
            max: 10,           // Higher max for more gradual, gentle intensity buildup
            gradient: {
                0.0: 'rgba(33, 150, 243, 0.0)',     // Deep Blue = cheap (transparent at edges)
                0.1: 'rgba(33, 150, 243, 0.15)',    // Deep Blue (much more transparent)
                0.25: 'rgba(63, 81, 181, 0.2)',     // Indigo
                0.4: 'rgba(103, 58, 183, 0.25)',    // Deep Purple
                0.55: 'rgba(156, 39, 176, 0.3)',    // Purple
                0.7: 'rgba(171, 71, 188, 0.35)',    // Medium Purple
                0.82: 'rgba(186, 104, 200, 0.4)',   // Light Purple
                0.9: 'rgba(233, 30, 99, 0.45)',     // Pink
                1.0: 'rgba(233, 30, 99, 0.5)'       // Hot Pink = expensive (center, hot zones)
            },
            minOpacity: 0,     // No minimum opacity to show full gradient including center
            pane: 'valueZonesPane'  // Use custom pane for layer ordering
        });

        // Patch for canvas performance
        const originalCreateCanvas = valueZonesLayer._initCanvas;
        if (originalCreateCanvas) {
            valueZonesLayer._initCanvas = function () {
                originalCreateCanvas.call(this);
                if (this._canvas) {
                    const canvas = this._canvas;
                    const originalGetContext = canvas.getContext.bind(canvas);
                    canvas.getContext = function (contextType, contextAttributes) {
                        if (contextType === '2d') {
                            return originalGetContext(contextType, { ...contextAttributes, willReadFrequently: true });
                        }
                        return originalGetContext(contextType, contextAttributes);
                    };
                }
            };
        }

        valueZonesLayer.addTo(map);

        // Set canvas opacity and z-index after layer is added
        setTimeout(() => {
            if (valueZonesLayer._canvas) {
                const canvas = valueZonesLayer._canvas;
                // Adjust opacity based on how many layers are active
                // More layers = brighter colors for richer visualization
                if (showHeatmap && showAmenitiesOverlay) {
                    canvas.style.opacity = '0.8';   // All three active - brightest
                } else if (showHeatmap || showAmenitiesOverlay) {
                    canvas.style.opacity = '0.65';  // Two active - moderate brightness
                } else {
                    canvas.style.opacity = '0.5';   // Solo - subtle
                }
            }
        }, 5);
    }
}

// Create amenities overlay based on known locations in Crown Heights
function createAmenitiesOverlay() {
    // Key transit stations, restaurants, and parks in Crown Heights
    // Based on reference image showing walkability/desirability patterns
    // Target property is at approximately 40.6780, -73.9389 (1220 Dean St)
    // Only including amenities within ~1 mile radius
    // Weights based on distance from target: closer = higher weight
    const amenities = [
        // Subway stations - Franklin Ave line
        { lat: 40.6782, lng: -73.9559, weight: 0.85, type: 'transit' },  // Franklin Ave (C/S) station
        { lat: 40.6745, lng: -73.9559, weight: 0.70, type: 'transit' },  // Park Place (S) station
        { lat: 40.6781, lng: -73.9559, weight: 0.50, type: 'transit' },  // Franklin Ave (4/5, 2/3) station

        // Subway stations - Nostrand Ave A/C line (CLOSEST TO PROPERTIES)
        { lat: 40.678606, lng: -73.952939, weight: 0.95, type: 'transit' },  // Nostrand Ave (A/C) - VERY CLOSE, ~6 blocks
        { lat: 40.6782, lng: -73.9504, weight: 1.0, type: 'transit' },   // Kingston-Throop (A/C) - CLOSEST, ~6 blocks west
        { lat: 40.6650, lng: -73.9504, weight: 0.75, type: 'transit' },  // Kingston Ave (A/C) - ~8 blocks

        // Subway stations - 2/5 line (Eastern Parkway)
        { lat: 40.6689, lng: -73.9422, weight: 0.80, type: 'transit' },  // Sterling St (2/5) - ~5 blocks
        { lat: 40.6731, lng: -73.9422, weight: 0.75, type: 'transit' },  // Bergen St (2/3) - ~6 blocks

        // Subway stations - other nearby lines
        { lat: 40.6765, lng: -73.9493, weight: 0.90, type: 'transit' },  // Classon Ave (G) - very close, ~5 blocks

        // Major parks (within 1 mile)
        { lat: 40.6765, lng: -73.9502, weight: 0.50, type: 'park' },     // Brower Park - reduced weight, just a park
        { lat: 40.6693, lng: -73.9513, weight: 0.75, type: 'park' },     // Lincoln Terrace Park - ~7 blocks

        // Franklin Ave commercial corridor - HIGH ACTIVITY (restaurants, shops, grocery)
        { lat: 40.677508, lng: -73.955723, weight: 0.95, type: 'commercial' }, // Franklin & Dean - grocery store area
        { lat: 40.6785, lng: -73.9559, weight: 0.90, type: 'commercial' }, // Franklin Ave north
        { lat: 40.6775, lng: -73.9559, weight: 0.90, type: 'commercial' }, // Franklin Ave restaurants
        { lat: 40.6770, lng: -73.9559, weight: 0.85, type: 'commercial' }, // Franklin Ave mid
        { lat: 40.6765, lng: -73.9559, weight: 0.80, type: 'commercial' }, // Franklin Ave south
        { lat: 40.6760, lng: -73.9559, weight: 0.75, type: 'commercial' }, // Franklin Ave lower

        // Other commercial corridors
        { lat: 40.6765, lng: -73.9504, weight: 0.40, type: 'commercial' }, // Nostrand Ave corridor (main) - very walkable
        { lat: 40.6731, lng: -73.9504, weight: 0.55, type: 'commercial' }, // Nostrand Ave mid - ~6 blocks
        { lat: 40.6689, lng: -73.9504, weight: 0.30, type: 'commercial' }, // Nostrand Ave south - ~7 blocks
        { lat: 40.6731, lng: -73.9493, weight: 0.30, type: 'commercial' }  // Bedford Ave corridor - ~6 blocks
    ];

    // Create dense grid of heat points for smooth continuous gradient (like reference image)
    const heatPoints = [];
    amenities.forEach(amenity => {
        // Create multiple concentric rings of points for smooth falloff
        const rings = amenity.type === 'transit' ? 4 : 3;  // Fewer rings for tighter spread
        const pointsPerRing = amenity.type === 'transit' ? 16 : 12;
        const maxRadius = amenity.type === 'transit' ? 0.004 : 0.003; // Smaller spread

        // Add center point with full weight
        heatPoints.push([amenity.lat, amenity.lng, amenity.weight]);

        // Add concentric rings with decreasing weight
        for (let ring = 1; ring <= rings; ring++) {
            const ringRadius = (maxRadius / rings) * ring;
            const ringWeight = amenity.weight * (1 - (ring / (rings + 1))); // Steeper falloff

            for (let i = 0; i < pointsPerRing; i++) {
                const angle = (Math.PI * 2 * i) / pointsPerRing;
                heatPoints.push([
                    amenity.lat + Math.cos(angle) * ringRadius,
                    amenity.lng + Math.sin(angle) * ringRadius,
                    ringWeight
                ]);
            }
        }
    });

    amenitiesOverlayLayer = L.heatLayer(heatPoints, {
        radius: 35,        // Reduced for tighter concentration
        blur: 25,          // Reduced blur for sharper edges
        maxZoom: 17,
        max: 1.2,          // Higher threshold to show only strongest areas
        gradient: {
            0.0: 'rgba(220, 50, 50, 0.15)',    // Red/pink for low desirability (more transparent)
            0.2: 'rgba(255, 120, 80, 0.2)',    // Red-orange
            0.35: 'rgba(255, 180, 60, 0.25)',  // Orange
            0.5: 'rgba(255, 220, 80, 0.25)',   // Yellow
            0.65: 'rgba(200, 240, 120, 0.25)', // Yellow-green
            0.8: 'rgba(120, 210, 120, 0.3)',   // Light green
            1.0: 'rgba(60, 170, 90, 0.35)'     // Strong green (more transparent)
        },
        minOpacity: 0.1,   // Lower minimum for more transparency
        pane: 'amenitiesPane'  // Use custom pane for layer ordering
    });
}

// Toggle amenities overlay
function toggleAmenitiesOverlay() {
    showAmenitiesOverlay = !showAmenitiesOverlay;

    const btn = document.getElementById('map-amenities-btn');
    if (showAmenitiesOverlay) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }

    // Update legend and redraw map with amenities in proper layer order
    updateMapLegend();
    updateMap();
}

// Expose map functions to global scope
window.showMapHeatmap = showMapHeatmap;
window.showMapValueZones = showMapValueZones;
window.updateHeatmap = updateHeatmap;
window.toggleAmenitiesOverlay = toggleAmenitiesOverlay;

// Export coordinates function
function exportCoordinates() {
    console.log('\n=== COPY THIS TO compsData.js ===\n');
    console.log('// Crown Heights Area Comparable Properties Data');
    console.log('export const comparableProperties = ' + JSON.stringify(comparableProperties.map(p => {
        const { id, included, isDirectComp, salePrice, buildingPriceSQFT, totalPriceSQFT, propertySQFT, buildingSQFT, ...rest } = p;
        return rest;
    }), null, 4) + ';');

    console.log('\n=== COPY THIS TO targetPropertyData.js ===\n');
    console.log('// Target Property to Compare Data');
    const { estimatedSale, developerPrice, fairMarketValue, propertySQFT, buildingSQFT, buildingPriceSQFT, totalPriceSQFT, ...targetRest } = targetProperty;
    const targetExport = {
        ...targetRest,
        referenceValues: {
            developerPrice: targetProperty.developerPrice || 0,
            fairMarketValue: targetProperty.fairMarketValue || 0
        }
    };
    console.log('export const targetProperty = ' + JSON.stringify(targetExport, null, 4) + ';');

    alert('Coordinates exported to console! Open Developer Tools (F12) and copy the data to your .js files.');
}

window.exportCoordinates = exportCoordinates;

// ============================================
// END MAP FUNCTIONALITY
// ============================================

// Load data on page load
window.addEventListener('DOMContentLoaded', loadData);
