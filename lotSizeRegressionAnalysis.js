/**
 * Lot Size Premium Regression Analysis
 * Crown Heights Comparable Properties
 * 
 * This script analyzes the relationship between lot size and property value
 * to determine the dollar-per-SQFT premium for lot size in Crown Heights.
 */

import { comparableProperties } from './compsData.js';

/**
 * Calculate mean of an array
 */
function mean(arr) {
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

/**
 * Calculate median of an array
 */
function median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 
        ? (sorted[mid - 1] + sorted[mid]) / 2 
        : sorted[mid];
}

/**
 * Simple linear regression
 * Returns: { slope, intercept, rSquared, predictions }
 */
function simpleLinearRegression(x, y) {
    const n = x.length;
    const xMean = mean(x);
    const yMean = mean(y);
    
    // Calculate slope (β)
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
        numerator += (x[i] - xMean) * (y[i] - yMean);
        denominator += (x[i] - xMean) ** 2;
    }
    const slope = numerator / denominator;
    
    // Calculate intercept (α)
    const intercept = yMean - slope * xMean;
    
    // Calculate predictions and R-squared
    const predictions = x.map(xi => intercept + slope * xi);
    const ssRes = y.reduce((sum, yi, i) => sum + (yi - predictions[i]) ** 2, 0);
    const ssTot = y.reduce((sum, yi) => sum + (yi - yMean) ** 2, 0);
    const rSquared = 1 - (ssRes / ssTot);
    
    return { slope, intercept, rSquared, predictions };
}

/**
 * Multiple linear regression using matrix operations
 * X is a 2D array (rows = observations, cols = features)
 * y is a 1D array of target values
 * Returns: { coefficients, rSquared, predictions }
 */
function multipleLinearRegression(X, y) {
    const n = X.length;
    const p = X[0].length;
    
    // Add intercept column (column of 1s) to X
    const XWithIntercept = X.map(row => [1, ...row]);
    
    // Calculate X^T * X
    const XTX = multiplyMatrices(transpose(XWithIntercept), XWithIntercept);
    
    // Calculate X^T * y
    const XTy = multiplyMatrixVector(transpose(XWithIntercept), y);
    
    // Solve for coefficients: (X^T * X)^(-1) * X^T * y
    const XTXInv = invertMatrix(XTX);
    const coefficients = multiplyMatrixVector(XTXInv, XTy);
    
    // Calculate predictions and R-squared
    const predictions = XWithIntercept.map(row => 
        row.reduce((sum, val, i) => sum + val * coefficients[i], 0)
    );
    
    const yMean = mean(y);
    const ssRes = y.reduce((sum, yi, i) => sum + (yi - predictions[i]) ** 2, 0);
    const ssTot = y.reduce((sum, yi) => sum + (yi - yMean) ** 2, 0);
    const rSquared = 1 - (ssRes / ssTot);
    
    return { coefficients, rSquared, predictions };
}

/**
 * Matrix multiplication (A * B)
 */
function multiplyMatrices(A, B) {
    const rowsA = A.length;
    const colsA = A[0].length;
    const colsB = B[0].length;
    
    const result = Array(rowsA).fill(0).map(() => Array(colsB).fill(0));
    
    for (let i = 0; i < rowsA; i++) {
        for (let j = 0; j < colsB; j++) {
            for (let k = 0; k < colsA; k++) {
                result[i][j] += A[i][k] * B[k][j];
            }
        }
    }
    
    return result;
}

/**
 * Matrix-vector multiplication
 */
function multiplyMatrixVector(A, v) {
    return A.map(row => 
        row.reduce((sum, val, i) => sum + val * v[i], 0)
    );
}

/**
 * Transpose a matrix
 */
function transpose(A) {
    const rows = A.length;
    const cols = A[0].length;
    const result = Array(cols).fill(0).map(() => Array(rows).fill(0));
    
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            result[j][i] = A[i][j];
        }
    }
    
    return result;
}

/**
 * Matrix inversion using Gauss-Jordan elimination
 */
function invertMatrix(A) {
    const n = A.length;
    
    // Create augmented matrix [A | I]
    const augmented = A.map((row, i) => [
        ...row,
        ...Array(n).fill(0).map((_, j) => i === j ? 1 : 0)
    ]);
    
    // Forward elimination
    for (let i = 0; i < n; i++) {
        // Find pivot
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
                maxRow = k;
            }
        }
        
        // Swap rows
        [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
        
        // Scale pivot row
        const pivot = augmented[i][i];
        for (let j = 0; j < 2 * n; j++) {
            augmented[i][j] /= pivot;
        }
        
        // Eliminate column
        for (let k = 0; k < n; k++) {
            if (k !== i) {
                const factor = augmented[k][i];
                for (let j = 0; j < 2 * n; j++) {
                    augmented[k][j] -= factor * augmented[i][j];
                }
            }
        }
    }
    
    // Extract inverse from augmented matrix
    return augmented.map(row => row.slice(n));
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Main analysis function
 */
export function runLotSizeRegressionAnalysis() {
    console.log("=".repeat(80));
    console.log("LOT SIZE PREMIUM REGRESSION ANALYSIS");
    console.log("Crown Heights Comparable Properties");
    console.log("=".repeat(80));
    console.log("");
    
    // Filter properties with valid sale prices and dates
    const validComps = comparableProperties.filter(p => 
        p.priceOnACRIS > 0 && 
        p.sellDate !== "N/A" &&
        p.coordinates
    );
    
    // Key locations for transit/amenity proximity
    const transitHub = { lat: 40.678606, lng: -73.952939, name: 'Nostrand Ave A/C Station' };
    const commercialHub = { lat: 40.677508, lng: -73.955723, name: 'Franklin & Dean Commercial' };
    
    // Prepare data - calculate building and lot SQFT, plus distances to key locations
    const data = validComps.map(p => {
        const buildingSQFT = p.buildingWidthFeet * p.buildingDepthFeet * p.floors;
        const lotSQFT = p.propertyWidthFeet * p.propertyDepthFeet;
        
        // Calculate distances to both transit and commercial hubs
        const distanceToTransit = calculateDistance(
            p.coordinates.lat, p.coordinates.lng, 
            transitHub.lat, transitHub.lng
        );
        const distanceToCommercial = calculateDistance(
            p.coordinates.lat, p.coordinates.lng,
            commercialHub.lat, commercialHub.lng
        );
        
        // Also calculate minimum distance (for Model 5 compatibility)
        const distanceToNearest = Math.min(distanceToTransit, distanceToCommercial);
        
        // Calculate weighted blend (60% transit, 40% commercial - can be tuned)
        const distanceWeightedBlend = 0.6 * distanceToTransit + 0.4 * distanceToCommercial;
        
        return {
            address: p.address,
            buildingSQFT: buildingSQFT,
            lotSQFT: lotSQFT,
            width: p.buildingWidthFeet,
            distanceToTransit: distanceToTransit,
            distanceToCommercial: distanceToCommercial,
            distanceToNearest: distanceToNearest,
            distanceWeightedBlend: distanceWeightedBlend,
            price: p.priceOnACRIS,
            renovated: p.renovated === "Yes",
            sellDate: p.sellDate
        };
    });
    
    console.log("DATASET SUMMARY");
    console.log("-".repeat(80));
    console.log(`Number of properties: ${data.length}`);
    
    const buildingSizes = data.map(d => d.buildingSQFT);
    const lotSizes = data.map(d => d.lotSQFT);
    const widths = data.map(d => d.width);
    const distancesToTransit = data.map(d => d.distanceToTransit);
    const distancesToCommercial = data.map(d => d.distanceToCommercial);
    const distancesToNearest = data.map(d => d.distanceToNearest);
    const prices = data.map(d => d.price);
    
    console.log(`Building SQFT range: ${Math.min(...buildingSizes).toFixed(0)} - ${Math.max(...buildingSizes).toFixed(0)}`);
    console.log(`Lot SQFT range: ${Math.min(...lotSizes).toFixed(0)} - ${Math.max(...lotSizes).toFixed(0)}`);
    console.log(`Width range: ${Math.min(...widths).toFixed(1)}' - ${Math.max(...widths).toFixed(1)}'`);
    console.log(`Distance to transit range: ${Math.min(...distancesToTransit).toFixed(2)} - ${Math.max(...distancesToTransit).toFixed(2)} miles`);
    console.log(`Distance to commercial range: ${Math.min(...distancesToCommercial).toFixed(2)} - ${Math.max(...distancesToCommercial).toFixed(2)} miles`);
    console.log(`Distance to nearest (min) range: ${Math.min(...distancesToNearest).toFixed(2)} - ${Math.max(...distancesToNearest).toFixed(2)} miles`);
    console.log(`Price range: $${Math.min(...prices).toLocaleString()} - $${Math.max(...prices).toLocaleString()}`);
    console.log(`Median building SQFT: ${median(buildingSizes).toFixed(0)}`);
    console.log(`Median lot SQFT: ${median(lotSizes).toFixed(0)}`);
    console.log(`Median width: ${median(widths).toFixed(1)}'`);
    console.log(`Median distance to transit: ${median(distancesToTransit).toFixed(2)} miles`);
    console.log(`Median distance to commercial: ${median(distancesToCommercial).toFixed(2)} miles`);
    console.log(`Median distance to nearest: ${median(distancesToNearest).toFixed(2)} miles`);
    console.log("");
    
    // =============================================================================
    // MODEL 1: Simple Linear Regression (Lot Size Only)
    // =============================================================================
    console.log("=".repeat(80));
    console.log("MODEL 1: SIMPLE LINEAR REGRESSION (LOT SIZE ONLY)");
    console.log("=".repeat(80));
    console.log("Formula: Price = α + β × Lot_SQFT");
    console.log("");
    
    const model1 = simpleLinearRegression(lotSizes, prices);
    
    console.log(`Intercept (α): $${model1.intercept.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Slope (β): $${model1.slope.toFixed(2)} per SQFT`);
    console.log(`R-squared: ${model1.rSquared.toFixed(4)}`);
    console.log("");
    console.log("INTERPRETATION:");
    console.log(`  Every additional SQFT of lot size adds approximately $${model1.slope.toFixed(2)} to property value`);
    console.log(`  However, R² = ${model1.rSquared.toFixed(3)} means lot size alone explains only ${(model1.rSquared * 100).toFixed(1)}% of price variance`);
    console.log("");
    
    // =============================================================================
    // MODEL 2: Multiple Regression (Building SQFT + Lot Size)
    // =============================================================================
    console.log("=".repeat(80));
    console.log("MODEL 2: MULTIPLE REGRESSION (BUILDING SQFT + LOT SIZE)");
    console.log("=".repeat(80));
    console.log("Formula: Price = α + β₁ × Building_SQFT + β₂ × Lot_SQFT");
    console.log("");
    
    const X2 = data.map(d => [d.buildingSQFT, d.lotSQFT]);
    const model2 = multipleLinearRegression(X2, prices);
    
    const [intercept2, buildingCoef2, lotCoef2] = model2.coefficients;
    
    console.log(`Intercept (α): $${intercept2.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Building SQFT coefficient (β₁): $${buildingCoef2.toFixed(2)} per SQFT`);
    console.log(`Lot SQFT coefficient (β₂): $${lotCoef2.toFixed(2)} per SQFT`);
    console.log(`R-squared: ${model2.rSquared.toFixed(4)}`);
    console.log("");
    console.log("INTERPRETATION:");
    console.log(`  Holding lot size constant, each additional SQFT of building adds $${buildingCoef2.toFixed(2)}`);
    console.log(`  Holding building size constant, each additional SQFT of lot adds $${lotCoef2.toFixed(2)}`);
    console.log(`  This model explains ${(model2.rSquared * 100).toFixed(1)}% of price variance`);
    console.log("");
    
    // =============================================================================
    // MODEL 3: Multiple Regression with Renovation Indicator
    // =============================================================================
    console.log("=".repeat(80));
    console.log("MODEL 3: MULTIPLE REGRESSION (BUILDING + LOT + RENOVATION)");
    console.log("=".repeat(80));
    console.log("Formula: Price = α + β₁ × Building_SQFT + β₂ × Lot_SQFT + β₃ × Renovated");
    console.log("");
    
    const X3 = data.map(d => [d.buildingSQFT, d.lotSQFT, d.renovated ? 1 : 0]);
    const model3 = multipleLinearRegression(X3, prices);
    
    const [intercept3, buildingCoef3, lotCoef3, renoCoef3] = model3.coefficients;
    
    console.log(`Intercept (α): $${intercept3.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Building SQFT coefficient (β₁): $${buildingCoef3.toFixed(2)} per SQFT`);
    console.log(`Lot SQFT coefficient (β₂): $${lotCoef3.toFixed(2)} per SQFT`);
    console.log(`Renovation premium (β₃): $${renoCoef3.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`R-squared: ${model3.rSquared.toFixed(4)}`);
    console.log("");
    console.log("INTERPRETATION:");
    console.log(`  Each additional SQFT of building adds $${buildingCoef3.toFixed(2)}`);
    console.log(`  Each additional SQFT of lot adds $${lotCoef3.toFixed(2)}`);
    console.log(`  Renovated properties command a premium of $${renoCoef3.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  This model explains ${(model3.rSquared * 100).toFixed(1)}% of price variance`);
    console.log("");
    
    // =============================================================================
    // MODEL 4: Multiple Regression with Width
    // =============================================================================
    console.log("=".repeat(80));
    console.log("MODEL 4: MULTIPLE REGRESSION (BUILDING + LOT + WIDTH + RENOVATION)");
    console.log("=".repeat(80));
    console.log("Formula: Price = α + β₁ × Building_SQFT + β₂ × Lot_SQFT + β₃ × Width + β₄ × Renovated");
    console.log("");
    
    const X4 = data.map(d => [d.buildingSQFT, d.lotSQFT, d.width, d.renovated ? 1 : 0]);
    const model4 = multipleLinearRegression(X4, prices);
    
    const [intercept4, buildingCoef4, lotCoef4, widthCoef4, renoCoef4] = model4.coefficients;
    
    console.log(`Intercept (α): $${intercept4.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Building SQFT coefficient (β₁): $${buildingCoef4.toFixed(2)} per SQFT`);
    console.log(`Lot SQFT coefficient (β₂): $${lotCoef4.toFixed(2)} per SQFT`);
    console.log(`Width coefficient (β₃): $${widthCoef4.toLocaleString(undefined, {maximumFractionDigits: 2})} per foot`);
    console.log(`Renovation premium (β₄): $${renoCoef4.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`R-squared: ${model4.rSquared.toFixed(4)}`);
    console.log("");
    console.log("INTERPRETATION:");
    console.log(`  Each additional SQFT of building adds $${buildingCoef4.toFixed(2)}`);
    console.log(`  Each additional SQFT of lot adds $${lotCoef4.toFixed(2)}`);
    console.log(`  Each additional FOOT of width adds $${widthCoef4.toLocaleString(undefined, {maximumFractionDigits: 2})}`);
    console.log(`  Renovated properties command a premium of $${renoCoef4.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  This model explains ${(model4.rSquared * 100).toFixed(1)}% of price variance`);
    console.log("");
    
    // =============================================================================
    // MODEL 5: Multiple Regression with Transit Distance
    // =============================================================================
    console.log("=".repeat(80));
    console.log("MODEL 5: FULL MODEL (BUILDING + LOT + TRANSIT + RENOVATION)");
    console.log("=".repeat(80));
    console.log("Formula: Price = α + β₁ × Building_SQFT + β₂ × Lot_SQFT + β₃ × Distance_to_Transit + β₄ × Renovated");
    console.log("");
    
    const X5 = data.map(d => [d.buildingSQFT, d.lotSQFT, d.distanceToTransit, d.renovated ? 1 : 0]);
    const model5 = multipleLinearRegression(X5, prices);
    
    const [intercept5, buildingCoef5, lotCoef5, transitCoef5, renoCoef5] = model5.coefficients;
    
    console.log(`Intercept (α): $${intercept5.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Building SQFT coefficient (β₁): $${buildingCoef5.toFixed(2)} per SQFT`);
    console.log(`Lot SQFT coefficient (β₂): $${lotCoef5.toFixed(2)} per SQFT`);
    console.log(`Transit distance coefficient (β₃): $${transitCoef5.toLocaleString(undefined, {maximumFractionDigits: 2})} per mile`);
    console.log(`Renovation premium (β₄): $${renoCoef5.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`R-squared: ${model5.rSquared.toFixed(4)}`);
    console.log("");
    console.log("INTERPRETATION:");
    console.log(`  Each additional SQFT of building adds $${buildingCoef5.toFixed(2)}`);
    console.log(`  Each additional SQFT of lot adds $${lotCoef5.toFixed(2)}`);
    console.log(`  Each additional MILE from transit ${transitCoef5 >= 0 ? 'adds' : 'subtracts'} $${Math.abs(transitCoef5).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
    console.log(`  Renovated properties command a premium of $${renoCoef5.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  This model explains ${(model5.rSquared * 100).toFixed(1)}% of price variance`);
    console.log("");
    
    // Calculate practical implications
    const medianTransitDistance = median(distancesToNearest);
    const transitPremiumPerBlock = transitCoef5 * 0.016; // ~1 block ≈ 0.016 miles
    console.log("PRACTICAL IMPLICATIONS:");
    console.log(`  Median distance to nearest amenity: ${medianTransitDistance.toFixed(2)} miles`);
    console.log(`  Moving 1 block (~265 feet) closer to transit: ${transitPremiumPerBlock >= 0 ? '+' : ''}${Math.abs(transitPremiumPerBlock).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  Moving 5 blocks closer to transit: ${(transitPremiumPerBlock * 5) >= 0 ? '+' : ''}${Math.abs(transitPremiumPerBlock * 5).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  Moving 0.25 miles closer to transit: ${(transitCoef5 * 0.25) >= 0 ? '+' : ''}${Math.abs(transitCoef5 * 0.25).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    // =============================================================================
    // RESIDUAL ANALYSIS (MODEL 5)
    // =============================================================================
    console.log("=".repeat(80));
    console.log("RESIDUAL ANALYSIS (MODEL 5 - WITH TRANSIT)");
    console.log("=".repeat(80));
    console.log("");
    
    const residuals5 = prices.map((actual, i) => actual - model5.predictions[i]);
    const rmse5 = Math.sqrt(mean(residuals5.map(r => r ** 2)));
    const mae5 = mean(residuals5.map(r => Math.abs(r)));
    
    console.log(`Root Mean Squared Error: $${rmse5.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Mean Absolute Error: $${mae5.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    console.log("RESIDUALS BY PROPERTY:");
    console.log("-".repeat(80));
    data.forEach((d, i) => {
        const actual = prices[i];
        const predicted = model5.predictions[i];
        const residual = residuals5[i];
        const pctError = (residual / actual) * 100;
        const addressShort = d.address.substring(0, 25).padEnd(25);
        const distStr = `${d.distanceToTransit.toFixed(2)}mi`.padStart(7);
        console.log(`${addressShort} ${distStr} Actual: $${actual.toLocaleString().padStart(9)}  Predicted: $${predicted.toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(9)}  Error: $${residual.toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(8)} (${pctError >= 0 ? '+' : ''}${pctError.toFixed(1)}%)`);
    });
    console.log("");
    
    // =============================================================================
    // RESIDUAL ANALYSIS (MODEL 4)
    // =============================================================================
    console.log("=".repeat(80));
    console.log("RESIDUAL ANALYSIS (MODEL 4 - WITH WIDTH)");
    console.log("=".repeat(80));
    console.log("");
    
    const residuals4 = prices.map((actual, i) => actual - model4.predictions[i]);
    const rmse4 = Math.sqrt(mean(residuals4.map(r => r ** 2)));
    const mae4 = mean(residuals4.map(r => Math.abs(r)));
    
    console.log(`Root Mean Squared Error: $${rmse4.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Mean Absolute Error: $${mae4.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    console.log("RESIDUALS BY PROPERTY:");
    console.log("-".repeat(80));
    data.forEach((d, i) => {
        const actual = prices[i];
        const predicted = model4.predictions[i];
        const residual = residuals4[i];
        const pctError = (residual / actual) * 100;
        const addressShort = d.address.substring(0, 25).padEnd(25);
        console.log(`${addressShort} Actual: $${actual.toLocaleString().padStart(9)}  Predicted: $${predicted.toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(9)}  Error: $${residual.toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(8)} (${pctError >= 0 ? '+' : ''}${pctError.toFixed(1)}%)`);
    });
    console.log("");
    
    // =============================================================================
    // RESIDUAL ANALYSIS
    // =============================================================================
    console.log("=".repeat(80));
    console.log("RESIDUAL ANALYSIS (MODEL 3)");
    console.log("=".repeat(80));
    console.log("");
    
    const residuals = prices.map((actual, i) => actual - model3.predictions[i]);
    const rmse = Math.sqrt(mean(residuals.map(r => r ** 2)));
    const mae = mean(residuals.map(r => Math.abs(r)));
    
    console.log(`Root Mean Squared Error: $${rmse.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Mean Absolute Error: $${mae.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    console.log("RESIDUALS BY PROPERTY:");
    console.log("-".repeat(80));
    data.forEach((d, i) => {
        const actual = prices[i];
        const predicted = model3.predictions[i];
        const residual = residuals[i];
        const pctError = (residual / actual) * 100;
        const addressShort = d.address.substring(0, 25).padEnd(25);
        console.log(`${addressShort} Actual: $${actual.toLocaleString().padStart(9)}  Predicted: $${predicted.toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(9)}  Error: $${residual.toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(8)} (${pctError >= 0 ? '+' : ''}${pctError.toFixed(1)}%)`);
    });
    console.log("");
    
    // =============================================================================
    // MODEL 6: Building + Lot + BOTH Transit AND Commercial + Renovation
    // =============================================================================
    console.log("=".repeat(80));
    console.log("MODEL 6: BUILDING + LOT + TRANSIT + COMMERCIAL + RENOVATION");
    console.log("=".repeat(80));
    console.log("Formula: Price = α + β₁(Building_SQFT) + β₂(Lot_SQFT) + β₃(Transit_Distance) + β₄(Commercial_Distance) + β₅(Renovation)");
    console.log("");
    console.log("Testing whether transit and commercial amenities have separate effects...");
    console.log("");
    
    const X6 = data.map(d => [
        d.buildingSQFT,
        d.lotSQFT,
        d.distanceToTransit,
        d.distanceToCommercial,
        d.renovated ? 1 : 0
    ]);
    
    const model6 = multipleLinearRegression(X6, prices);
    const [intercept6, buildingCoef6, lotCoef6, transitCoef6, commercialCoef6, renoCoef6] = model6.coefficients;
    
    console.log(`R-squared: ${model6.rSquared.toFixed(4)} (${(model6.rSquared * 100).toFixed(1)}% of variance explained)`);
    console.log("");
    console.log("COEFFICIENTS:");
    console.log(`  Intercept:            $${intercept6.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  Building SQFT:        $${buildingCoef6.toLocaleString(undefined, {maximumFractionDigits: 2})} per SQFT`);
    console.log(`  Lot SQFT:             $${lotCoef6.toLocaleString(undefined, {maximumFractionDigits: 2})} per SQFT`);
    console.log(`  Transit distance:     $${transitCoef6.toLocaleString(undefined, {maximumFractionDigits: 2})} per mile`);
    console.log(`  Commercial distance:  $${commercialCoef6.toLocaleString(undefined, {maximumFractionDigits: 2})} per mile`);
    console.log(`  Renovation premium:   $${renoCoef6.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    const residuals6 = prices.map((actual, i) => actual - model6.predictions[i]);
    const rmse6 = Math.sqrt(mean(residuals6.map(r => r ** 2)));
    const mae6 = mean(residuals6.map(r => Math.abs(r)));
    
    console.log(`Root Mean Squared Error: $${rmse6.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Mean Absolute Error: $${mae6.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    console.log("INTERPRETATION:");
    if (model6.rSquared > model5.rSquared) {
        const improvement = ((model6.rSquared - model5.rSquared) * 100).toFixed(2);
        console.log(`✅ Model 6 explains ${improvement}% MORE variance than Model 5!`);
        console.log(`   Both transit and commercial distance have independent effects.`);
    } else {
        const decline = ((model5.rSquared - model6.rSquared) * 100).toFixed(2);
        console.log(`⚠️  Model 6 explains ${decline}% LESS variance than Model 5.`);
        console.log(`   Separate coefficients may be overfitting or showing multicollinearity.`);
    }
    console.log("");
    
    // =============================================================================
    // MODEL 7: Building + Lot + WEIGHTED BLEND (60% Transit, 40% Commercial) + Renovation
    // =============================================================================
    console.log("=".repeat(80));
    console.log("MODEL 7: BUILDING + LOT + WEIGHTED DISTANCE (60% TRANSIT, 40% COMMERCIAL) + RENOVATION");
    console.log("=".repeat(80));
    console.log("Formula: Price = α + β₁(Building_SQFT) + β₂(Lot_SQFT) + β₃(0.6×Transit + 0.4×Commercial) + β₄(Renovation)");
    console.log("");
    console.log("Testing whether a weighted blend captures location quality better...");
    console.log("");
    
    const X7 = data.map(d => [
        d.buildingSQFT,
        d.lotSQFT,
        d.distanceWeightedBlend,
        d.renovated ? 1 : 0
    ]);
    
    const model7 = multipleLinearRegression(X7, prices);
    const [intercept7, buildingCoef7, lotCoef7, blendCoef7, renoCoef7] = model7.coefficients;
    
    console.log(`R-squared: ${model7.rSquared.toFixed(4)} (${(model7.rSquared * 100).toFixed(1)}% of variance explained)`);
    console.log("");
    console.log("COEFFICIENTS:");
    console.log(`  Intercept:            $${intercept7.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  Building SQFT:        $${buildingCoef7.toLocaleString(undefined, {maximumFractionDigits: 2})} per SQFT`);
    console.log(`  Lot SQFT:             $${lotCoef7.toLocaleString(undefined, {maximumFractionDigits: 2})} per SQFT`);
    console.log(`  Weighted distance:    $${blendCoef7.toLocaleString(undefined, {maximumFractionDigits: 2})} per mile`);
    console.log(`  Renovation premium:   $${renoCoef7.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    console.log("Practical interpretation (weighted distance penalty):");
    const blendPremiumPerBlock = Math.abs(blendCoef7) * 0.016;
    console.log(`  1 block closer (weighted):  ${blendCoef7 < 0 ? '+' : '-'}$${blendPremiumPerBlock.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  5 blocks closer (weighted): ${blendCoef7 < 0 ? '+' : '-'}$${(blendPremiumPerBlock * 5).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  0.25 miles closer:          ${blendCoef7 < 0 ? '+' : '-'}$${(Math.abs(blendCoef7) * 0.25).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    const residuals7 = prices.map((actual, i) => actual - model7.predictions[i]);
    const rmse7 = Math.sqrt(mean(residuals7.map(r => r ** 2)));
    const mae7 = mean(residuals7.map(r => Math.abs(r)));
    
    console.log(`Root Mean Squared Error: $${rmse7.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Mean Absolute Error: $${mae7.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    console.log("INTERPRETATION:");
    if (model7.rSquared > model5.rSquared) {
        const improvement = ((model7.rSquared - model5.rSquared) * 100).toFixed(2);
        console.log(`✅ Model 7 explains ${improvement}% MORE variance than Model 5!`);
        console.log(`   Weighted blend (60% transit, 40% commercial) captures location better.`);
    } else {
        const decline = ((model5.rSquared - model7.rSquared) * 100).toFixed(2);
        console.log(`⚠️  Model 7 explains ${decline}% LESS variance than Model 5.`);
        console.log(`   Simple "nearest distance" approach may be sufficient.`);
    }
    console.log("");
    
    // =============================================================================
    // MODEL 8: Add originalDetails categorical variable to Model 6
    // =============================================================================
    console.log("=".repeat(80));
    console.log("MODEL 8: BUILDING + LOT + TRANSIT + COMMERCIAL + RENOVATION + ORIGINAL DETAILS");
    console.log("=".repeat(80));
    console.log("Formula: Price = α + β₁(Building) + β₂(Lot) + β₃(Transit) + β₄(Commercial) + β₅(Renovation) + β₆(Details_Yes) + β₇(Details_Partial)");
    console.log("");
    console.log("Testing whether preservation of original architectural details adds value...");
    console.log("");
    
    // Filter out properties with N/A for originalDetails (they can't be categorized)
    const validForModel8 = data.map((d, i) => ({d, i})).filter(({d}) => d.originalDetails !== 'N/A');
    const data8 = validForModel8.map(({d}) => d);
    const prices8 = validForModel8.map(({i}) => prices[i]);
    
    console.log(`Note: Excluding ${data.length - data8.length} property(ies) with originalDetails='N/A'`);
    console.log(`Sample size for Model 8: n=${data8.length}`);
    console.log("");
    
    // Create categorical variables for originalDetails
    // Reference category: "No" (fully modern renovation)
    const originalDetailsYes = data8.map(d => d.originalDetails === 'Yes' ? 1 : 0);
    const originalDetailsPartial = data8.map(d => d.originalDetails === 'Partial' ? 1 : 0);
    
    const X8 = data8.map((d, i) => [
        d.buildingSQFT,
        d.lotSQFT,
        d.distanceToTransit,
        d.distanceToCommercial,
        d.renovated ? 1 : 0,
        originalDetailsYes[i],
        originalDetailsPartial[i]
    ]);
    
    const model8 = multipleLinearRegression(X8, prices8);
    const [intercept8, buildingCoef8, lotCoef8, transitCoef8, commercialCoef8, renoCoef8, detailsYesCoef8, detailsPartialCoef8] = model8.coefficients;
    
    console.log(`R-squared: ${model8.rSquared.toFixed(4)} (${(model8.rSquared * 100).toFixed(1)}% of variance explained)`);
    console.log("");
    console.log("COEFFICIENTS:");
    console.log(`  Intercept:                       $${intercept8.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  Building SQFT:                   $${buildingCoef8.toLocaleString(undefined, {maximumFractionDigits: 2})} per SQFT`);
    console.log(`  Lot SQFT:                        $${lotCoef8.toLocaleString(undefined, {maximumFractionDigits: 2})} per SQFT`);
    console.log(`  Transit distance:                $${transitCoef8.toLocaleString(undefined, {maximumFractionDigits: 2})} per mile`);
    console.log(`  Commercial distance:             $${commercialCoef8.toLocaleString(undefined, {maximumFractionDigits: 2})} per mile`);
    console.log(`  Renovation premium:              $${renoCoef8.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  Original Details (Yes vs No):    $${detailsYesCoef8.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  Original Details (Partial vs No):$${detailsPartialCoef8.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    const residuals8 = prices8.map((actual, i) => actual - model8.predictions[i]);
    const rmse8 = Math.sqrt(mean(residuals8.map(r => r ** 2)));
    const mae8 = mean(residuals8.map(r => Math.abs(r)));
    
    console.log(`Root Mean Squared Error: $${rmse8.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Mean Absolute Error: $${mae8.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    // Statistical significance test (F-test for added variables)
    const nObs = prices8.length;
    const k6Params = 6; // Model 6 has 6 predictors (including intercept)
    const k8Params = 8; // Model 8 has 8 predictors (including intercept)
    const SSR6 = residuals6.reduce((sum, r) => sum + r**2, 0);
    const SSR8 = residuals8.reduce((sum, r) => sum + r**2, 0);
    const fStatistic = ((SSR6 - SSR8) / (k8Params - k6Params)) / (SSR8 / (nObs - k8Params));
    
    console.log("F-TEST FOR ADDED VARIABLES (originalDetails):");
    console.log(`  F-statistic: ${fStatistic.toFixed(4)}`);
    console.log(`  Critical F(2, ${nObs - k8Params}) at α=0.05: ~4.46`);
    console.log(`  Result: ${fStatistic > 4.46 ? '✓ SIGNIFICANT' : '✗ NOT SIGNIFICANT'}`);
    console.log("");
    
    console.log("INTERPRETATION:");
    if (fStatistic > 4.46) {
        console.log(`✅ originalDetails IS statistically significant!`);
        console.log(`   R² improvement: ${((model8.rSquared - model6.rSquared) * 100).toFixed(2)}% points`);
        console.log(`   Original Details (Yes): Adds $${detailsYesCoef8.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
        console.log(`   Original Details (Partial): Adds $${detailsPartialCoef8.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
        console.log("");
        console.log(`   For target property 1220 Dean (originalDetails=No):`);
        console.log(`   Comps with "Yes" are worth $${detailsYesCoef8.toLocaleString(undefined, {maximumFractionDigits: 0})} MORE`);
        console.log(`   Comps with "Partial" are worth $${detailsPartialCoef8.toLocaleString(undefined, {maximumFractionDigits: 0})} MORE`);
        console.log("");
        console.log(`   ⚠️  Sample size caveat: Only ${nObs} properties`);
    } else {
        console.log(`✗ originalDetails is NOT statistically significant`);
        console.log(`   The observed effect may be real but sample size too small (n=${nObs})`);
        console.log(`   R² change: ${((model8.rSquared - model6.rSquared) * 100).toFixed(2)}% points`);
        console.log(`   Recommendation: Do not add to calculator until more data available`);
    }
    console.log("");
    
    // =============================================================================
    // COMPARISON WITH INDUSTRY STANDARDS
    // =============================================================================
    console.log("=".repeat(80));
    console.log("MODEL COMPARISON SUMMARY");
    console.log("=".repeat(80));
    console.log("");
    console.log("Which location measurement works best?");
    console.log("-".repeat(80));
    console.log(`Model 5 (Nearest distance):          R² = ${model5.rSquared.toFixed(4)}, RMSE = $${rmse5.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Model 6 (Both separate):             R² = ${model6.rSquared.toFixed(4)}, RMSE = $${rmse6.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Model 7 (60/40 weighted blend):      R² = ${model7.rSquared.toFixed(4)}, RMSE = $${rmse7.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log("");
    
    // Determine best model
    const models = [
        { name: "Model 5 (Nearest)", rSquared: model5.rSquared, rmse: rmse5 },
        { name: "Model 6 (Both)", rSquared: model6.rSquared, rmse: rmse6 },
        { name: "Model 7 (Weighted)", rSquared: model7.rSquared, rmse: rmse7 }
    ];
    const bestModel = models.reduce((best, current) => 
        current.rSquared > best.rSquared ? current : best
    );
    
    console.log(`🏆 BEST MODEL: ${bestModel.name}`);
    console.log(`   R² = ${bestModel.rSquared.toFixed(4)} (${(bestModel.rSquared * 100).toFixed(1)}% variance explained)`);
    console.log(`   RMSE = $${bestModel.rmse.toLocaleString(undefined, {maximumFractionDigits: 0})} (${(bestModel.rmse / mean(prices) * 100).toFixed(1)}% of mean price)`);
    console.log("");
    
    // =============================================================================
    // COMPARISON WITH INDUSTRY STANDARDS
    // =============================================================================
    console.log("=".repeat(80));
    console.log("COMPARISON WITH INDUSTRY STANDARDS");
    console.log("=".repeat(80));
    console.log("");
    
    const medianLot = median(lotSizes);
    const medianBuilding = median(buildingSizes);
    const medianWidth = median(widths);
    const medianDistanceToTransit = median(distancesToTransit);
    const medianDistanceToCommercial = median(distancesToCommercial);
    const medianDistanceToNearest = median(distancesToNearest);
    const medianPricePerSQFT = median(prices.map((p, i) => p / buildingSizes[i]));
    const typicalBaseValue = medianBuilding * medianPricePerSQFT;
    
    // LOT SIZE COMPARISONS
    console.log("LOT SIZE ADJUSTMENTS");
    console.log("-".repeat(80));
    console.log("PERCENTAGE-BASED METHOD (Industry Standard: ±1% per 500 SQFT)");
    console.log("Formula: Adjustment = (Lot_Difference / 500) × 1% × Base_Value");
    console.log("");
    console.log(`Typical property: ${medianBuilding.toFixed(0)} SQFT building × $${medianPricePerSQFT.toFixed(2)}/SQFT = $${typicalBaseValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Typical lot size: ${medianLot.toFixed(0)} SQFT`);
    console.log("");
    
    console.log("EXAMPLE LOT SIZE ADJUSTMENTS:");
    console.log("-".repeat(80));
    const lotDifferences = [-500, -200, 0, 200, 500, 1000];
    lotDifferences.forEach(diff => {
        const pctAdjustment = (diff / 500) * 0.01 * typicalBaseValue;
        const regAdjustment = diff * lotCoef4;
        const lotSize = medianLot + diff;
        
        console.log(`Lot size: ${lotSize.toFixed(0).padStart(6)} SQFT (Δ ${(diff >= 0 ? '+' : '')}${diff.toFixed(0).padStart(5)} SQFT)`);
        console.log(`  Percentage method: ${(pctAdjustment >= 0 ? '+' : '')}$${Math.abs(pctAdjustment).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(9)}`);
        console.log(`  Regression method:  ${(regAdjustment >= 0 ? '+' : '')}$${Math.abs(regAdjustment).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(9)}`);
        console.log("");
    });
    
    // WIDTH COMPARISONS
    console.log("=".repeat(80));
    console.log("WIDTH ADJUSTMENTS");
    console.log("-".repeat(80));
    console.log("PERCENTAGE-BASED METHOD (Industry Standard: ±1.5% per foot)");
    console.log("Formula: Adjustment = Width_Difference × 1.5% × Base_Value");
    console.log("");
    console.log(`Typical width: ${medianWidth.toFixed(1)} feet`);
    console.log("");
    
    console.log("EXAMPLE WIDTH ADJUSTMENTS:");
    console.log("-".repeat(80));
    const widthDifferences = [-4, -2, -1, 0, 1, 2, 4];
    widthDifferences.forEach(diff => {
        const pctAdjustment = diff * 0.015 * typicalBaseValue;
        const regAdjustment = diff * widthCoef4;
        const width = medianWidth + diff;
        
        console.log(`Width: ${width.toFixed(1).padStart(5)}' (Δ ${(diff >= 0 ? '+' : '')}${diff.toFixed(1).padStart(4)}')`);
        console.log(`  Percentage method: ${(pctAdjustment >= 0 ? '+' : '')}$${Math.abs(pctAdjustment).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(9)}`);
        console.log(`  Regression method:  ${(regAdjustment >= 0 ? '+' : '')}$${Math.abs(regAdjustment).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(9)}`);
        console.log("");
    });
    
    // TRANSIT DISTANCE COMPARISONS
    console.log("=".repeat(80));
    console.log("TRANSIT PROXIMITY ADJUSTMENTS");
    console.log("-".repeat(80));
    console.log("REGRESSION-BASED METHOD (Data-driven from Crown Heights sales)");
    console.log(`Formula: Adjustment = Distance_Difference × $${Math.abs(transitCoef5).toLocaleString(undefined, {maximumFractionDigits: 2})}/mile`);
    console.log("");
    console.log(`Typical distance to nearest amenity: ${medianDistanceToNearest.toFixed(2)} miles`);
    console.log(`Typical distance to transit: ${medianDistanceToTransit.toFixed(2)} miles`);
    console.log(`Typical distance to commercial: ${medianDistanceToCommercial.toFixed(2)} miles`);
    console.log("");
    
    console.log("EXAMPLE TRANSIT PROXIMITY ADJUSTMENTS:");
    console.log("-".repeat(80));
    const distanceDifferences = [-0.25, -0.1, -0.05, 0, 0.05, 0.1, 0.25];
    distanceDifferences.forEach(diff => {
        const regAdjustment = diff * transitCoef5;
        const distance = medianDistanceToNearest + diff;
        const blocks = Math.round(diff / 0.016); // Convert miles to blocks
        
        console.log(`Distance: ${distance.toFixed(2)} miles (${blocks >= 0 ? '+' : ''}${blocks} blocks from typical)`);
        console.log(`  Regression method:  ${(regAdjustment >= 0 ? '+' : '')}$${Math.abs(regAdjustment).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(9)}`);
        console.log("");
    });
    
    // =============================================================================
    // RECOMMENDATIONS
    // =============================================================================
    console.log("=".repeat(80));
    console.log("RECOMMENDATIONS");
    console.log("=".repeat(80));
    console.log("");
    
    console.log(`✅ RECOMMENDED LOT SIZE ADJUSTMENT: $${lotCoef5.toFixed(2)} per SQFT`);
    console.log(`✅ RECOMMENDED TRANSIT DISTANCE PENALTY: $${Math.abs(transitCoef5).toLocaleString(undefined, {maximumFractionDigits: 2})} per mile`);
    console.log("");
    console.log("RATIONALE:");
    console.log(`  • Derived from actual Crown Heights sales data (n=${data.length})`);
    console.log(`  • Accounts for building size, lot size, transit proximity, and renovation status`);
    console.log(`  • Model explains ${(model5.rSquared * 100).toFixed(1)}% of price variance`);
    console.log(`  • Root mean squared error: $${rmse5.toLocaleString(undefined, {maximumFractionDigits: 0})} (${(rmse5 / mean(prices) * 100).toFixed(1)}% of mean price)`);
    console.log("");
    
    console.log("LOT SIZE - COMPARISON WITH YOUR HYPOTHESIS ($100-$200 per SQFT):");
    if (lotCoef5 >= 100 && lotCoef5 <= 200) {
        console.log(`  ✅ Your hypothesis is CONFIRMED! $${lotCoef5.toFixed(2)} falls within the $100-$200 range`);
    } else if (lotCoef5 < 100) {
        console.log(`  ⚠️ Actual value ($${lotCoef5.toFixed(2)}) is LOWER than your hypothesis ($100-$200)`);
    } else {
        console.log(`  ⚠️ Actual value ($${lotCoef5.toFixed(2)}) is HIGHER than your hypothesis ($100-$200)`);
    }
    console.log("");
    
    console.log("TRANSIT PROXIMITY - EFFECT ON VALUE:");
    console.log(`  • Coefficient: $${Math.abs(transitCoef5).toLocaleString(undefined, {maximumFractionDigits: 2})} per mile ${transitCoef5 < 0 ? '(closer = more valuable)' : '(further = more valuable)'}`);
    console.log(`  • 1 block closer (~0.016 miles): ${transitPremiumPerBlock >= 0 ? '+' : ''}$${Math.abs(transitPremiumPerBlock).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  • 5 blocks closer (~0.08 miles): ${(transitPremiumPerBlock * 5) >= 0 ? '+' : ''}$${Math.abs(transitPremiumPerBlock * 5).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  • Quarter mile closer: ${(transitCoef5 * 0.25) >= 0 ? '+' : ''}$${Math.abs(transitCoef5 * 0.25).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    if (transitCoef5 < 0) {
        console.log(`  ✅ Transit proximity adds measurable value (as expected)`);
    } else {
        console.log(`  ⚠️ Unexpected: Model shows further from transit is more valuable`);
        console.log(`     This may indicate other factors (e.g., lot size, quieter streets) correlate with distance`);
    }
    console.log("");
    
    console.log("ALTERNATIVE: PERCENTAGE-BASED METHOD (Lot Size Only)");
    console.log(`  • Industry standard: ±1% per 500 SQFT difference`);
    console.log(`  • For a typical $${typicalBaseValue.toLocaleString(undefined, {maximumFractionDigits: 0})} property:`);
    console.log(`    - 500 SQFT larger lot: +$${(0.01 * typicalBaseValue).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`    - 500 SQFT smaller lot: -$${(0.01 * typicalBaseValue).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  • Equivalent to $${(0.01 * typicalBaseValue / 500).toFixed(2)} per SQFT (scales with property value)`);
    console.log("");
    
    console.log("=".repeat(80));
    console.log("END OF ANALYSIS");
    console.log("=".repeat(80));
    
    // Return the results for programmatic use
    return {
        model1: {
            name: "Lot Size Only",
            slope: model1.slope,
            intercept: model1.intercept,
            rSquared: model1.rSquared
        },
        model2: {
            name: "Building + Lot",
            intercept: intercept2,
            buildingCoef: buildingCoef2,
            lotCoef: lotCoef2,
            rSquared: model2.rSquared
        },
        model3: {
            name: "Building + Lot + Renovation",
            intercept: intercept3,
            buildingCoef: buildingCoef3,
            lotCoef: lotCoef3,
            renovationPremium: renoCoef3,
            rSquared: model3.rSquared
        },
        model4: {
            name: "Building + Lot + Width + Renovation",
            intercept: intercept4,
            buildingCoef: buildingCoef4,
            lotCoef: lotCoef4,
            widthCoef: widthCoef4,
            renovationPremium: renoCoef4,
            rSquared: model4.rSquared
        },
        model5: {
            name: "Building + Lot + Transit + Renovation",
            intercept: intercept5,
            buildingCoef: buildingCoef5,
            lotCoef: lotCoef5,
            transitCoef: transitCoef5,
            renovationPremium: renoCoef5,
            rSquared: model5.rSquared,
            rmse: rmse5
        },
        model6: {
            name: "Building + Lot + Transit + Commercial + Renovation",
            intercept: intercept6,
            buildingCoef: buildingCoef6,
            lotCoef: lotCoef6,
            transitCoef: transitCoef6,
            commercialCoef: commercialCoef6,
            renovationPremium: renoCoef6,
            rSquared: model6.rSquared,
            rmse: rmse6
        },
        model7: {
            name: "Building + Lot + Weighted Blend (60/40) + Renovation",
            intercept: intercept7,
            buildingCoef: buildingCoef7,
            lotCoef: lotCoef7,
            weightedBlendCoef: blendCoef7,
            renovationPremium: renoCoef7,
            rSquared: model7.rSquared,
            rmse: rmse7
        },
        bestLocationModel: bestModel.name,
        recommendations: {
            regressionBasedLotValue: lotCoef5,
            regressionBasedTransitPenalty: transitCoef5,
            percentageBasedLotEquivalent: (0.01 * typicalBaseValue / 500),
            lotWithinHypothesis: lotCoef5 >= 100 && lotCoef5 <= 200,
            transitPremiumPerBlock: transitPremiumPerBlock,
            bestModelRSquared: bestModel.rSquared,
            bestModelRMSE: bestModel.rmse
        }
    };

    // Return the results for programmatic use
    return {
        summary: summaryStats,
        model1: {
            name: "Lot Size Only",
            intercept: intercept1,
            lotCoef: lotCoef1,
            rSquared: model1.rSquared
        },
        model2: {
            name: "Building + Lot",
            intercept: intercept2,
            buildingCoef: buildingCoef2,
            lotCoef: lotCoef2,
            rSquared: model2.rSquared
        },
        model3: {
            name: "Building + Lot + Renovation",
            intercept: intercept3,
            buildingCoef: buildingCoef3,
            lotCoef: lotCoef3,
            renovationPremium: renoCoef3,
            rSquared: model3.rSquared
        },
        model4: {
            name: "Building + Lot + Width + Renovation",
            intercept: intercept4,
            buildingCoef: buildingCoef4,
            lotCoef: lotCoef4,
            widthCoef: widthCoef4,
            renovationPremium: renoCoef4,
            rSquared: model4.rSquared
        },
        model5: {
            name: "Building + Lot + Transit + Renovation",
            intercept: intercept5,
            buildingCoef: buildingCoef5,
            lotCoef: lotCoef5,
            transitCoef: transitCoef5,
            renovationPremium: renoCoef5,
            rSquared: model5.rSquared,
            rmse: rmse5
        },
        model6: {
            name: "Building + Lot + Transit + Commercial + Renovation",
            intercept: intercept6,
            buildingCoef: buildingCoef6,
            lotCoef: lotCoef6,
            transitCoef: transitCoef6,
            commercialCoef: commercialCoef6,
            renovationPremium: renoCoef6,
            rSquared: model6.rSquared,
            rmse: rmse6
        },
        model7: {
            name: "Building + Lot + Weighted Blend (60/40) + Renovation",
            intercept: intercept7,
            buildingCoef: buildingCoef7,
            lotCoef: lotCoef7,
            weightedBlendCoef: blendCoef7,
            renovationPremium: renoCoef7,
            rSquared: model7.rSquared,
            rmse: rmse7
        },
        model8: {
            name: "Building + Lot + Transit + Commercial + Renovation + OriginalDetails",
            intercept: intercept8,
            buildingCoef: buildingCoef8,
            lotCoef: lotCoef8,
            transitCoef: transitCoef8,
            commercialCoef: commercialCoef8,
            renovationPremium: renoCoef8,
            detailsYesPremium: detailsYesCoef8,
            detailsPartialPremium: detailsPartialCoef8,
            rSquared: model8.rSquared,
            rmse: rmse8,
            fStatistic: fStatistic,
            significant: fStatistic > 4.46
        },
        bestLocationModel: bestModel.name,
        bestOverallModel: model8.rSquared > bestModel.rSquared ? "Model 8" : bestModel.name,
        recommendations: {
            regressionBasedLotValue: lotCoef5,
            regressionBasedTransitPenalty: transitCoef5,
            percentageBasedLotEquivalent: (0.01 * typicalBaseValue / 500),
            lotWithinHypothesis: lotCoef5 >= 100 && lotCoef5 <= 200,
            transitPremiumPerBlock: transitPremiumPerBlock,
            bestModelRSquared: Math.max(bestModel.rSquared, model8.rSquared),
            bestModelRMSE: model8.rSquared > bestModel.rSquared ? rmse8 : bestModel.rmse,
            useOriginalDetailsAdjustment: model8.rSquared > bestModel.rSquared && fStatistic > 4.46
        }
    };
}

// If running in Node.js directly
if (typeof window === 'undefined') {
    runLotSizeRegressionAnalysis();
}
