import { comparableProperties as importedComps } from './compsData.js';
import { targetProperty as importedTarget } from './targetPropertyData.js';

// Global data storage
let targetProperty = null;
let comparableProperties = [];
let weightingMethod = 'simple'; // 'simple', 'price', 'size', 'total-size', or 'date'

// Map-related globals
let map = null;
let markersLayer = null;
let heatmapLayer = null;
let amenitiesOverlayLayer = null;
let mapMode = 'markers'; // 'markers' or 'heatmap'
let geocodingInProgress = false;
let showAmenitiesOverlay = false;

// Patch HTMLCanvasElement.prototype.getContext globally to set willReadFrequently for all 2D contexts
(function() {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
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
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Utility function to format number
function formatNumber(value, decimals = 2) {
    if (!value) return '0';
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Calculate median from array of numbers
function calculateMedian(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Calculate standard deviation
function calculateStdDev(values, mean) {
    if (!values || values.length === 0) return 0;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(variance);
}

// Calculate Property SQFT
function calculatePropertySQFT(widthFeet, depthFeet) {
    return widthFeet * depthFeet;
}

// Calculate Building SQFT
function calculateBuildingSQFT(widthFeet, depthFeet, stories) {
    return (widthFeet * depthFeet) * stories;
}

// Calculate Building $ SQFT
function calculateBuildingPriceSQFT(price, buildingWidthFeet, buildingDepthFeet, floors) {
    const sqft = floors * (buildingWidthFeet * buildingDepthFeet);
    if (!sqft || sqft === 0) return 0;
    return price / sqft;
}

// Calculate Total $ SQFT
function calculateTotalPriceSQFT(price, propertySQFT, buildingSQFT) {
    const total = propertySQFT + buildingSQFT;
    if (!total || total === 0) return 0;
    return price / total;
}

// Process imported property data with calculations
function processImportedProperty(prop) {
    const processed = { ...prop };
    
    // Recalculate SQFT from dimensions
    processed.propertySQFT = calculatePropertySQFT(prop.propertyWidthFeet, prop.propertyDepthFeet);
    processed.buildingSQFT = calculateBuildingSQFT(prop.buildingWidthFeet, prop.buildingDepthFeet, prop.buildingStories);
    
    // Use sale price for comps
    if (prop.priceOnACRIS !== undefined) {
        processed.salePrice = prop.priceOnACRIS;
        
        // Recalculate price per SQFT
        processed.buildingPriceSQFT = calculateBuildingPriceSQFT(processed.salePrice, prop.buildingWidthFeet, prop.buildingDepthFeet, prop.floors);
        processed.totalPriceSQFT = calculateTotalPriceSQFT(processed.salePrice, processed.propertySQFT, processed.buildingSQFT);
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
        
        // Process target property
        targetProperty = processImportedProperty(importedTarget);
        targetProperty.estimatedSale = importedTarget.estimatedSale || 0;
        targetProperty.developerPrice = importedTarget.referenceValues?.developerPrice || 0;
        targetProperty.fairMarketValue = importedTarget.referenceValues?.fairMarketValue || 0;
        
        // Render everything
        renderTargetProperty();
        renderComparables();
        calculateAndRenderEstimates();
        
        // Initialize map
        setTimeout(() => {
            initializeMap();
        }, 100);
        
    } catch (error) {
        console.error('Error loading data:', error);
        alert('Error loading imported data. Please check the console for details.');
    }
}

// Render target property
function renderTargetProperty() {
    if (!targetProperty) return;
    
    document.getElementById('target-address').textContent = targetProperty.address;
    
    const fields = [
        { label: 'Property Width (feet)', key: 'propertyWidthFeet', value: formatNumber(targetProperty.propertyWidthFeet, 2) },
        { label: 'Property Depth (feet)', key: 'propertyDepthFeet', value: formatNumber(targetProperty.propertyDepthFeet, 2) },
        { label: 'Property SQFT', key: 'propertySQFT', value: formatNumber(targetProperty.propertySQFT, 2) },
        { label: 'Building Width (feet)', key: 'buildingWidthFeet', value: formatNumber(targetProperty.buildingWidthFeet, 2) },
        { label: 'Building Depth (feet)', key: 'buildingDepthFeet', value: formatNumber(targetProperty.buildingDepthFeet, 2) },
        { label: 'Building Stories', key: 'buildingStories', value: targetProperty.buildingStories },
        { label: 'Building SQFT', key: 'buildingSQFT', value: formatNumber(targetProperty.buildingSQFT, 2) },
        { label: 'Floors', key: 'floors', value: targetProperty.floors },
        { label: 'Renovated', value: targetProperty.renovated },
        { label: 'Tax Class', value: targetProperty.taxClass },
        { label: 'Occupancy', value: targetProperty.occupancy },
        { label: 'Annual Taxes', value: formatCurrency(parseCurrency(targetProperty.taxes)) }
    ];
    
    const container = document.getElementById('target-property-fields');
    container.innerHTML = '';
    
    fields.forEach(field => {
        const div = document.createElement('div');
        div.className = 'property-field';
        
        const label = document.createElement('label');
        label.textContent = field.label;
        div.appendChild(label);
        
        const staticDiv = document.createElement('div');
        staticDiv.className = 'static-value';
        staticDiv.textContent = field.value;
        div.appendChild(staticDiv);
        
        container.appendChild(div);
    });
}

// Recalculate target property
function recalculateTarget() {
    targetProperty.propertySQFT = calculatePropertySQFT(targetProperty.propertyWidthFeet, targetProperty.propertyDepthFeet);
    targetProperty.buildingSQFT = calculateBuildingSQFT(targetProperty.buildingWidthFeet, targetProperty.buildingDepthFeet, targetProperty.buildingStories);
    
    renderTargetProperty();
    calculateAndRenderEstimates();
}

// Render comparable properties table
function renderComparables() {
    const tbody = document.getElementById('comps-tbody');
    tbody.innerHTML = '';
    
    // Update weight header visibility
    const weightHeader = document.getElementById('weight-header');
    if (weightHeader) {
        weightHeader.style.display = weightingMethod !== 'simple' ? '' : 'none';
    }
    
    // Calculate weights for all included properties
    const included = comparableProperties.filter(p => p.included && p.salePrice > 0);
    const totalPrice = included.reduce((sum, p) => sum + p.salePrice, 0);
    const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
    
    // Calculate size-based weights for all included properties
    const sizeWeights = included.map(p => {
        const compSize = p.floors * (p.buildingWidthFeet * p.buildingDepthFeet);
        const sizeDiff = Math.abs(compSize - targetSize);
        return 1 / (1 + sizeDiff / targetSize);
    });
    const totalSizeWeight = sizeWeights.reduce((sum, w) => sum + w, 0);
    
    // Calculate total property size weights (property SQFT + building SQFT)
    const targetTotalSize = targetProperty.propertySQFT + targetProperty.buildingSQFT;
    const totalSizeWeights = included.map(p => {
        const compTotalSize = p.propertySQFT + p.buildingSQFT;
        const totalSizeDiff = Math.abs(compTotalSize - targetTotalSize);
        return 1 / (1 + totalSizeDiff / targetTotalSize);
    });
    const totalPropertySizeWeight = totalSizeWeights.reduce((sum, w) => sum + w, 0);
    
    // Calculate date-based weights (more recent sales get higher weight)
    const dateWeights = included.map(p => {
        // Parse date (format: MM/DD/YYYY or MM/DD/YY)
        if (p.sellDate === 'N/A' || !p.sellDate) {
            // Penalize unconfirmed sales - give them 10% of base weight
            return 0.1;
        }
        const dateParts = p.sellDate.split('/');
        if (dateParts.length !== 3) return 0.1; // Also penalize invalid dates
        let year = parseInt(dateParts[2]);
        // Handle 2-digit years: 00-49 = 2000-2049, 50-99 = 1950-1999
        if (year < 100) {
            year += year < 50 ? 2000 : 1900;
        }
        const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
        const today = new Date();
        const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
        // Use exponential decay: more recent = higher weight
        // Half-life of ~365 days (sales from 1 year ago have half the weight)
        return Math.exp(-daysSinceSale / 525);
    });
    const totalDateWeight = dateWeights.reduce((sum, w) => sum + w, 0);
    
    comparableProperties.forEach(prop => {
        const row = document.createElement('tr');
        row.id = `comp-${prop.id}`;
        
        // Calculate weight percentage based on method
        let weightPercent = 0;
        if (prop.included) {
            if (weightingMethod === 'price' && totalPrice > 0) {
                weightPercent = (prop.salePrice / totalPrice) * 100;
            } else if (weightingMethod === 'size' && totalSizeWeight > 0) {
                const propIndex = included.findIndex(p => p.id === prop.id);
                if (propIndex >= 0) {
                    weightPercent = (sizeWeights[propIndex] / totalSizeWeight) * 100;
                }
            } else if (weightingMethod === 'total-size' && totalPropertySizeWeight > 0) {
                const propIndex = included.findIndex(p => p.id === prop.id);
                if (propIndex >= 0) {
                    weightPercent = (totalSizeWeights[propIndex] / totalPropertySizeWeight) * 100;
                }
            } else if (weightingMethod === 'date' && totalDateWeight > 0) {
                const propIndex = included.findIndex(p => p.id === prop.id);
                if (propIndex >= 0) {
                    weightPercent = (dateWeights[propIndex] / totalDateWeight) * 100;
                }
            }
        }
        const isHighInfluence = weightPercent > (100 / included.length) * 1.5; // 50% above average
        
        // Check if this is the direct comp
        if (prop.isDirectComp) {
            row.classList.add('highlighted');
        }
        
        if (!prop.included) {
            row.classList.add('inactive');
        }
        
        // Add high-influence class if applicable
        if (weightingMethod !== 'simple' && prop.included && isHighInfluence) {
            row.classList.add('high-influence');
        }
        
        const weightCell = weightingMethod !== 'simple' ? 
            `<td class="weight-cell">${prop.included ? formatNumber(weightPercent, 1) + '%' : '-'}</td>` : 
            '<td class="weight-cell" style="display: none;">-</td>';
        
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
                        ${weightingMethod !== 'simple' && prop.included && isHighInfluence ? '<span class="badge badge-high-influence">High Influence</span>' : ''}
                    </td>
                    <td>${prop.renovated}</td>
                    <td>${formatNumber(prop.propertySQFT, 2)}</td>
                    <td>${formatNumber(prop.buildingSQFT, 2)}</td>
                    <td>${formatCurrency(prop.buildingPriceSQFT)}</td>
                    <td>${formatCurrency(prop.totalPriceSQFT)}</td>
                    <td>${formatCurrency(prop.salePrice)}</td>
                    ${weightCell}
                    <td>${prop.sellDate}</td>
                    <td>${prop.taxClass}</td>
                    <td>${prop.occupancy}</td>
                `;
        tbody.appendChild(row);
    });
    
    calculateAndRenderAverages();
}

// Toggle comparable property
function toggleComp(id) {
    const prop = comparableProperties.find(p => p.id === id);
    if (prop) {
        prop.included = !prop.included;
        renderComparables();
        calculateAndRenderEstimates();
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
    
    renderComparables();
    calculateAndRenderEstimates();
    updateMap(); // Update map when toggling
}

// Expose functions to global scope for inline event handlers
window.toggleComp = toggleComp;
window.toggleDirectComp = toggleDirectComp;

// Calculate and render market averages
function calculateAndRenderAverages() {
    const included = comparableProperties.filter(p => p.included && p.salePrice > 0);
    
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
        
        if (weightingMethod === 'price') {
            // Price-weighted average
            const totalPrice = included.reduce((sum, p) => sum + p.salePrice, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p) => sum + (p.buildingPriceSQFT * p.salePrice), 0) / totalPrice;
            avgTotalPriceSQFT = included.reduce((sum, p) => sum + (p.totalPriceSQFT * p.salePrice), 0) / totalPrice;
        } else if (weightingMethod === 'size') {
            // Size-similarity weighted average
            const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
            const weights = included.map(p => {
                const compSize = p.floors * (p.buildingWidthFeet * p.buildingDepthFeet);
                const sizeDiff = Math.abs(compSize - targetSize);
                // Use inverse distance weighting - closer sizes get higher weight
                return 1 / (1 + sizeDiff / targetSize);
            });
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        } else if (weightingMethod === 'date') {
            // Date-based weighted average (more recent sales weighted higher)
            const weights = included.map(p => {
                if (p.sellDate === 'N/A' || !p.sellDate) {
                    return 0.1; // Penalize unconfirmed sales
                }
                const dateParts = p.sellDate.split('/');
                if (dateParts.length !== 3) return 0.1;
                let year = parseInt(dateParts[2]);
                if (year < 100) {
                    year += year < 50 ? 2000 : 1900;
                }
                const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
                const today = new Date();
                const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
                return Math.exp(-daysSinceSale / 525);
            });
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        } else {
            // Simple average
            avgBuildingPriceSQFT = included.reduce((sum, p) => sum + p.buildingPriceSQFT, 0) / included.length;
            avgTotalPriceSQFT = included.reduce((sum, p) => sum + p.totalPriceSQFT, 0) / included.length;
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
    const avgTypeMap = {
        'simple': 'Simple Average',
        'price': 'Price-Weighted Average',
        'size': 'Building Size-Weighted Average',
        'total-size': 'Total Property Size-Weighted Average',
        'date': 'Date-Weighted Average (Recent Sales)'
    };
    const avgType = avgTypeMap[weightingMethod];
    container.innerHTML = `
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
        <div class="average-box">
            <h4>Total $ SQFT</h4>
            <div class="average-value">${formatCurrency(avgTotalPriceSQFT)}</div>
            <div class="average-count">${avgType} from ${included.length} of ${comparableProperties.length} properties</div>
            <div class="stats-details">
                <div class="stat-row"><span class="stat-label">Median:</span> <span class="stat-value">${formatCurrency(medianTotalPriceSQFT)}</span></div>
                <div class="stat-row"><span class="stat-label">Std Dev:</span> <span class="stat-value">±${formatCurrency(stdDevTotalPriceSQFT)}</span></div>
                <div class="stat-row"><span class="stat-label">Range:</span> <span class="stat-value">${rangeTotalPriceSQFT}</span></div>
            </div>
        </div>
    `;
}

// Calculate and render estimates
function calculateAndRenderEstimates() {
    const included = comparableProperties.filter(p => p.included && p.salePrice > 0);
    
    let avgBuildingPriceSQFT = 0;
    let avgTotalPriceSQFT = 0;
    
    let medianBuildingPriceSQFT = 0;
    let medianTotalPriceSQFT = 0;
    let stdDevBuildingPriceSQFT = 0;
    let stdDevTotalPriceSQFT = 0;
    
    if (included.length > 0) {
        // Extract values for median and std dev calculations
        const buildingPrices = included.map(p => p.buildingPriceSQFT);
        const totalPrices = included.map(p => p.totalPriceSQFT);
        
        if (weightingMethod === 'price') {
            // Price-weighted average
            const totalPrice = included.reduce((sum, p) => sum + p.salePrice, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p) => sum + (p.buildingPriceSQFT * p.salePrice), 0) / totalPrice;
            avgTotalPriceSQFT = included.reduce((sum, p) => sum + (p.totalPriceSQFT * p.salePrice), 0) / totalPrice;
        } else if (weightingMethod === 'size') {
            // Size-similarity weighted average
            const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
            const weights = included.map(p => {
                const compSize = p.floors * (p.buildingWidthFeet * p.buildingDepthFeet);
                const sizeDiff = Math.abs(compSize - targetSize);
                // Use inverse distance weighting - closer sizes get higher weight
                return 1 / (1 + sizeDiff / targetSize);
            });
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        } else if (weightingMethod === 'total-size') {
            // Total property size weighted average (property SQFT + building SQFT)
            const targetTotalSize = targetProperty.propertySQFT + targetProperty.buildingSQFT;
            const weights = included.map(p => {
                const compTotalSize = p.propertySQFT + p.buildingSQFT;
                const totalSizeDiff = Math.abs(compTotalSize - targetTotalSize);
                return 1 / (1 + totalSizeDiff / targetTotalSize);
            });
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        } else if (weightingMethod === 'date') {
            // Date-based weighted average (more recent sales weighted higher)
            const weights = included.map(p => {
                if (p.sellDate === 'N/A' || !p.sellDate) {
                    return 0.1; // Penalize unconfirmed sales
                }
                const dateParts = p.sellDate.split('/');
                if (dateParts.length !== 3) return 0.1;
                let year = parseInt(dateParts[2]);
                if (year < 100) {
                    year += year < 50 ? 2000 : 1900;
                }
                const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
                const today = new Date();
                const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
                return Math.exp(-daysSinceSale / 525);
            });
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        } else {
            // Simple average
            avgBuildingPriceSQFT = included.reduce((sum, p) => sum + p.buildingPriceSQFT, 0) / included.length;
            avgTotalPriceSQFT = included.reduce((sum, p) => sum + p.totalPriceSQFT, 0) / included.length;
        }
        
        // Calculate median and standard deviation
        medianBuildingPriceSQFT = calculateMedian(buildingPrices);
        medianTotalPriceSQFT = calculateMedian(totalPrices);
        stdDevBuildingPriceSQFT = calculateStdDev(buildingPrices, avgBuildingPriceSQFT);
        stdDevTotalPriceSQFT = calculateStdDev(totalPrices, avgTotalPriceSQFT);
    }
    
    // Calculate target's building SQFT using Floors (for Method A)
    const targetBuildingSQFTWithFloors = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
    
    // Method A: Building SQFT (with Floors) × Average Building $ SQFT (PRIMARY)
    const estimateA = targetBuildingSQFTWithFloors * avgBuildingPriceSQFT;
    const estimateAMedian = targetBuildingSQFTWithFloors * medianBuildingPriceSQFT;
    const estimateALow = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT - stdDevBuildingPriceSQFT);
    const estimateAHigh = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT + stdDevBuildingPriceSQFT);
    
    // Method B: (Property SQFT + Building SQFT) × Average Total $ SQFT
    const estimateB = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * avgTotalPriceSQFT;
    const estimateBMedian = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * medianTotalPriceSQFT;
    const estimateBLow = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (avgTotalPriceSQFT - stdDevTotalPriceSQFT);
    const estimateBHigh = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (avgTotalPriceSQFT + stdDevTotalPriceSQFT);
    
    const container = document.getElementById('estimates-container');
    container.innerHTML = `
        <div class="estimate-box primary">
            <h4>Method A: Building-Based Estimate (Primary)</h4>
            <div class="estimate-value">${formatCurrency(estimateA)}</div>
            <div class="estimate-formula">${formatNumber(targetBuildingSQFTWithFloors, 2)} SQFT × ${formatCurrency(avgBuildingPriceSQFT)}</div>
            <div class="confidence-interval">
                <div class="ci-row"><span class="ci-label">Median-Based:</span> <span class="ci-value">${formatCurrency(estimateAMedian)}</span></div>
                <div class="ci-row"><span class="ci-label">Confidence Range:</span> <span class="ci-value">${formatCurrency(estimateALow)} - ${formatCurrency(estimateAHigh)}</span></div>
            </div>
        </div>
        <div class="estimate-box">
            <h4>Method B: Total Property-Based Estimate</h4>
            <div class="estimate-value">${formatCurrency(estimateB)}</div>
            <div class="estimate-formula">(${formatNumber(targetProperty.propertySQFT, 2)} + ${formatNumber(targetProperty.buildingSQFT, 2)}) SQFT × ${formatCurrency(avgTotalPriceSQFT)}</div>
            <div class="confidence-interval">
                <div class="ci-row"><span class="ci-label">Median-Based:</span> <span class="ci-value">${formatCurrency(estimateBMedian)}</span></div>
                <div class="ci-row"><span class="ci-label">Confidence Range:</span> <span class="ci-value">${formatCurrency(estimateBLow)} - ${formatCurrency(estimateBHigh)}</span></div>
            </div>
        </div>
    `;
    
    // Get selected direct comp
    const directCompProp = comparableProperties.find(p => p.isDirectComp);
    const directCompValue = directCompProp ? directCompProp.salePrice : 0;
    const directCompAddress = directCompProp ? directCompProp.address : 'None selected';
    
    // Calculate estimate based on direct comp's Building $ SQFT
    // Formula: Direct Comp's Building $ SQFT × (Target's Floors × (Target's Building width × Target's Building depth))
    let directCompEstimate = 0;
    if (directCompProp) {
        directCompEstimate = directCompProp.buildingPriceSQFT * targetBuildingSQFTWithFloors;
    }
    
    // Calculate estimate based on direct comp's Total $ SQFT
    // Formula: Direct Comp's Total $ SQFT × (Target's Property SQFT + Target's Building SQFT)
    let directCompTotalEstimate = 0;
    if (directCompProp) {
        const targetTotalSQFT = targetProperty.propertySQFT + targetProperty.buildingSQFT;
        directCompTotalEstimate = directCompProp.totalPriceSQFT * targetTotalSQFT;
    }
    
    // Reference values
    const refContainer = document.getElementById('reference-values');
    refContainer.innerHTML = `
        <div class="reference-box">
            <h4>Direct Comp Sale Price</h4>
            <div class="reference-value">${formatCurrency(directCompValue)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompAddress}</div>
        </div>
        <div class="reference-box">
            <h4>Direct Comp Building-Based</h4>
            <div class="reference-value">${formatCurrency(directCompEstimate)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompProp ? formatCurrency(directCompProp.buildingPriceSQFT) + ' × (' + targetProperty.floors + ' floors × ' + formatNumber(targetProperty.buildingWidthFeet, 2) + ' × ' + formatNumber(targetProperty.buildingDepthFeet, 2) + ')' : 'No comp selected'}</div>
        </div>
        <div class="reference-box">
            <h4>Direct Comp Total-Based</h4>
            <div class="reference-value">${formatCurrency(directCompTotalEstimate)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompProp ? formatCurrency(directCompProp.totalPriceSQFT) + ' × (' + formatNumber(targetProperty.propertySQFT, 2) + ' + ' + formatNumber(targetProperty.buildingSQFT, 2) + ')' : 'No comp selected'}</div>
        </div>
    `;
    
    calculateAndRenderAverages();
}

// Quick filter functions
function selectAllComps() {
    comparableProperties.forEach(p => p.included = true);
    renderComparables();
    calculateAndRenderEstimates();
    updateMap();
}

function deselectAllComps() {
    comparableProperties.forEach(p => p.included = false);
    renderComparables();
    calculateAndRenderEstimates();
    updateMap();
}

function filterRenovated() {
    comparableProperties.forEach(p => {
        p.included = p.renovated === 'Yes';
    });
    renderComparables();
    calculateAndRenderEstimates();
    updateMap();
}

function filterTaxClass1() {
    comparableProperties.forEach(p => {
        p.included = String(p.taxClass).trim() === '1';
    });
    renderComparables();
    calculateAndRenderEstimates();
    updateMap();
}

// Cycle through weighting methods
function cycleWeightingMethod() {
    const methods = ['simple', 'price', 'size', 'total-size', 'date'];
    const currentIndex = methods.indexOf(weightingMethod);
    weightingMethod = methods[(currentIndex + 1) % methods.length];
    
    const button = document.getElementById('weighted-toggle');
    const buttonStates = {
        'simple': { bg: '#6c757d', text: 'Simple Average (Click for Price-Weighted)' },
        'price': { bg: '#28a745', text: 'Price-Weighted ✓ (Click for Building Size)' },
        'size': { bg: '#3498db', text: 'Building Size ✓ (Click for Total Size)' },
        'total-size': { bg: '#9b59b6', text: 'Total Property Size ✓ (Click for Date)' },
        'date': { bg: '#e67e22', text: 'Date-Weighted ✓ (Click for Simple)' }
    };
    
    button.style.backgroundColor = buttonStates[weightingMethod].bg;
    button.textContent = buttonStates[weightingMethod].text;
    
    renderComparables();
    calculateAndRenderEstimates();
}

// Expose filter functions to global scope
window.selectAllComps = selectAllComps;
window.deselectAllComps = deselectAllComps;
window.filterRenovated = filterRenovated;
window.filterTaxClass1 = filterTaxClass1;
window.cycleWeightingMethod = cycleWeightingMethod;

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
    
    // Add minimal grayscale CartoDB tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors, © CARTO',
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(map);
    
    // Create layers
    markersLayer = L.layerGroup().addTo(map);
    
    // Add legend (will be updated dynamically based on mode)
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
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
    const included = comparableProperties.filter(p => p.included && p.salePrice > 0);
    if (included.length === 0) return '#3498db';
    
    let values = [];
    if (metric === 'salePrice') {
        values = included.map(p => p.salePrice);
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

// Create marker popup content
function createPopupContent(prop, isTarget = false) {
    const badge = isTarget ? '<span class="popup-badge badge-target">TARGET</span>' : 
                  prop.isDirectComp ? '<span class="popup-badge badge-direct">DIRECT COMP</span>' : '';
    
    const fields = [
        { label: 'Sale Price', value: formatCurrency(prop.salePrice || 0) },
        { label: 'Building $ SQFT', value: formatCurrency(prop.buildingPriceSQFT || 0) },
        { label: 'Total $ SQFT', value: formatCurrency(prop.totalPriceSQFT || 0) },
        { label: 'Property SQFT', value: formatNumber(prop.propertySQFT, 0) },
        { label: 'Building SQFT', value: formatNumber(prop.buildingSQFT, 0) },
        { label: 'Renovated', value: prop.renovated },
        { label: 'Tax Class', value: prop.taxClass }
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
    
    // Clear existing layers
    if (markersLayer) {
        markersLayer.clearLayers();
    }
    if (heatmapLayer) {
        map.removeLayer(heatmapLayer);
        heatmapLayer = null;
    }
    
    if (mapMode === 'markers') {
        updateMapMarkers();
    } else {
        updateMapHeatmap();
    }
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
            fillOpacity: 0.8
        }).bindPopup(createPopupContent(targetProperty, true));
        
        markersLayer.addLayer(marker);
        bounds.push([targetProperty.coordinates.lat, targetProperty.coordinates.lng]);
    }
    
    // Add comparable property markers
    comparableProperties.forEach(prop => {
        if (prop.coordinates && prop.included) {
            const color = prop.isDirectComp ? '#eb70e9ff' : getPriceColor(prop.salePrice);
            
            const marker = L.circleMarker([prop.coordinates.lat, prop.coordinates.lng], {
                radius: 8,
                fillColor: color,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.7
            }).bindPopup(createPopupContent(prop, false));
            
            markersLayer.addLayer(marker);
            bounds.push([prop.coordinates.lat, prop.coordinates.lng]);
        }
    });
    
    // Fit map to bounds
    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

// Update map with heatmap
function updateMapHeatmap() {
    const metric = document.getElementById('heatmap-metric').value;
    const heatData = [];
    
    // Collect all intensity values to determine max
    const intensities = [];
    
    // Add target property
    if (targetProperty && targetProperty.coordinates) {
        let intensity = 0;
        if (metric === 'buildingPriceSQFT') {
            intensity = targetProperty.buildingPriceSQFT || 0;
        } else if (metric === 'totalPriceSQFT') {
            intensity = targetProperty.totalPriceSQFT || 0;
        } else {
            intensity = targetProperty.estimatedSale || 0;
        }
        intensities.push(intensity);
        heatData.push([targetProperty.coordinates.lat, targetProperty.coordinates.lng, intensity / 1000]);
    }
    
    // Add comparable properties
    comparableProperties.forEach(prop => {
        if (prop.coordinates && prop.included) {
            let intensity = 0;
            if (metric === 'buildingPriceSQFT') {
                intensity = prop.buildingPriceSQFT || 0;
            } else if (metric === 'totalPriceSQFT') {
                intensity = prop.totalPriceSQFT || 0;
            } else {
                intensity = prop.salePrice || 0;
            }
            intensities.push(intensity);
            heatData.push([prop.coordinates.lat, prop.coordinates.lng, intensity / 1000]);
        }
    });
    
    if (heatData.length > 0) {
        // Calculate dynamic max based on data
        const maxIntensity = Math.max(...intensities);
        const dynamicMax = (maxIntensity / 1000) * 1.2; // 20% above max for better color distribution
        
        heatmapLayer = L.heatLayer(heatData, {
            radius: 35,        // Increased from 25 for smoother visualization
            blur: 25,          // Increased from 15 for more gradual transitions
            maxZoom: 17,
            max: dynamicMax,   // Dynamic based on actual data
            gradient: {
                0.0: '#4CAF50',
                0.5: '#FFC107',
                1.0: '#E74C3C'
            },
            minOpacity: 0.3    // Increased from 0.05 so lower values are more visible
        });
        
        // Patch before onAdd to intercept canvas creation at the earliest point
        const originalCreateCanvas = heatmapLayer._initCanvas;
        if (originalCreateCanvas) {
            heatmapLayer._initCanvas = function() {
                originalCreateCanvas.call(this);
                // Now patch the canvas's getContext after it's created but before it's used
                if (this._canvas) {
                    const canvas = this._canvas;
                    const originalGetContext = canvas.getContext.bind(canvas);
                    canvas.getContext = function(contextType, contextAttributes) {
                        if (contextType === '2d') {
                            return originalGetContext(contextType, { ...contextAttributes, willReadFrequently: true });
                        }
                        return originalGetContext(contextType, contextAttributes);
                    };
                }
            };
        }
        
        heatmapLayer.addTo(map);
        
        // Center map on data
        const bounds = heatData.map(d => [d[0], d[1]]);
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

// Show markers view
function showMapMarkers() {
    mapMode = 'markers';
    document.getElementById('map-markers-btn').classList.add('active');
    document.getElementById('map-heatmap-btn').classList.remove('active');
    document.getElementById('heatmap-metric').style.display = 'none';
    
    // Update legend for markers mode
    const legendContent = document.getElementById('map-legend-content');
    if (legendContent) {
        legendContent.innerHTML = `
            <h4>Price Range</h4>
            <div class="legend-item"><span class="legend-color" style="background: #4CAF50;"></span> Low</div>
            <div class="legend-item"><span class="legend-color" style="background: #F1C40F;"></span> Medium</div>
            <div class="legend-item"><span class="legend-color" style="background: #E74C3C;"></span> High</div>
            <div class="legend-item"><span class="legend-color" style="background: #5372cfff;"></span> Target</div>
            <div class="legend-item"><span class="legend-color" style="background: #eb70e9ff;"></span> Direct Comp</div>
        `;
    }
    
    updateMap();
}

// Show heatmap view
function showMapHeatmap() {
    mapMode = 'heatmap';
    document.getElementById('map-heatmap-btn').classList.add('active');
    document.getElementById('map-markers-btn').classList.remove('active');
    document.getElementById('heatmap-metric').style.display = 'inline-block';
    
    // Update legend for heatmap mode
    const legendContent = document.getElementById('map-legend-content');
    if (legendContent) {
        legendContent.innerHTML = `
            <h4>Price Heat Map</h4>
            <p style="font-size: 11px; margin: 5px 0; color: #666;">Intensity shows property value concentration</p>
            <div style="background: linear-gradient(to right, #4CAF50, #FFC107, #E74C3C); height: 20px; border-radius: 3px; margin: 8px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #666;">
                <span>Lower</span>
                <span>Higher</span>
            </div>
            <p style="font-size: 10px; margin-top: 8px; color: #888;">Brighter/warmer colors = higher prices in that area</p>
        `;
    }
    
    updateMap();
}

// Update heatmap when metric changes
function updateHeatmap() {
    if (mapMode === 'heatmap') {
        updateMap();
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
        { lat: 40.6695, lng: -73.9504, weight: 0.95, type: 'transit' },  // Nostrand Ave (A/C) - VERY CLOSE, ~6 blocks
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
        { lat: 40.6780, lng: -73.9559, weight: 0.95, type: 'commercial' }, // Franklin & Dean - grocery store area
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
            0.0: 'rgba(220, 50, 50, 0.4)',     // Red/pink for low desirability
            0.2: 'rgba(255, 120, 80, 0.4)',    // Red-orange
            0.35: 'rgba(255, 180, 60, 0.4)',   // Orange
            0.5: 'rgba(255, 220, 80, 0.4)',    // Yellow
            0.65: 'rgba(200, 240, 120, 0.4)',  // Yellow-green
            0.8: 'rgba(120, 210, 120, 0.45)',  // Light green
            1.0: 'rgba(60, 170, 90, 0.5)'      // Strong green
        },
        minOpacity: 0.2    // Higher minimum to cut off weak areas
    });
    
    // Set willReadFrequently on the canvas to suppress warning
    setTimeout(() => {
        const canvases = map.getPane('overlayPane').getElementsByTagName('canvas');
        for (let canvas of canvases) {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
        }
    }, 100);
}

// Toggle amenities overlay
function toggleAmenitiesOverlay() {
    showAmenitiesOverlay = !showAmenitiesOverlay;
    
    if (showAmenitiesOverlay && amenitiesOverlayLayer) {
        map.addLayer(amenitiesOverlayLayer);
    } else if (amenitiesOverlayLayer) {
        map.removeLayer(amenitiesOverlayLayer);
    }
}

// Expose map functions to global scope
window.showMapMarkers = showMapMarkers;
window.showMapHeatmap = showMapHeatmap;
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
