import { comparableProperties as importedComps } from './compsData.js';
import { targetProperty as importedTarget } from './targetPropertyData.js';

// Global data storage
let targetProperty = null;
let comparableProperties = [];
let weightingMethod = 'all-weighted'; // 'simple', 'price', 'size', 'total-size', 'date', 'renovated', 'combined', 'all-weighted'
let annualAppreciationRate = 0.05; // 5% annual appreciation (adjustable)

// Map-related globals
let map = null;
let markersLayer = null;
let heatmapLayer = null;
let amenitiesOverlayLayer = null;
let mapMode = 'none'; // 'none', 'heatmap', or 'value-zones' (markers always shown)
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

// Apply time-based appreciation adjustment to a sale price
function applyAppreciationAdjustment(salePrice, sellDate) {
    if (!sellDate || sellDate === 'N/A' || !salePrice || salePrice === 0) {
        return { adjustedPrice: salePrice, yearsAgo: 0, appreciationAmount: 0 };
    }
    
    // Parse date (format: MM/DD/YYYY or MM/DD/YY)
    const dateParts = sellDate.split('/');
    if (dateParts.length !== 3) {
        return { adjustedPrice: salePrice, yearsAgo: 0, appreciationAmount: 0 };
    }
    
    let year = parseInt(dateParts[2]);
    // Handle 2-digit years: 00-49 = 2000-2049, 50-99 = 1950-1999
    if (year < 100) {
        year += year < 50 ? 2000 : 1900;
    }
    
    const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
    const today = new Date();
    const yearsAgo = (today - saleDate) / (1000 * 60 * 60 * 24 * 365.25);
    
    // Apply compound appreciation: adjustedPrice = salePrice × (1 + rate)^years
    const adjustedPrice = salePrice * Math.pow(1 + annualAppreciationRate, yearsAgo);
    const appreciationAmount = adjustedPrice - salePrice;
    
    return { adjustedPrice, yearsAgo, appreciationAmount };
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
        processed.originalSalePrice = prop.priceOnACRIS; // Store original for reference
        
        // Apply time-based appreciation adjustment
        const adjustment = applyAppreciationAdjustment(processed.salePrice, prop.sellDate);
        processed.adjustedSalePrice = adjustment.adjustedPrice;
        processed.appreciationYears = adjustment.yearsAgo;
        processed.appreciationAmount = adjustment.appreciationAmount;
        
        // Recalculate price per SQFT using adjusted price
        processed.buildingPriceSQFT = calculateBuildingPriceSQFT(processed.adjustedSalePrice, prop.buildingWidthFeet, prop.buildingDepthFeet, prop.floors);
        processed.totalPriceSQFT = calculateTotalPriceSQFT(processed.adjustedSalePrice, processed.propertySQFT, processed.buildingSQFT);
        
        // Also store original price per SQFT for comparison
        processed.originalBuildingPriceSQFT = calculateBuildingPriceSQFT(processed.salePrice, prop.buildingWidthFeet, prop.buildingDepthFeet, prop.floors);
        processed.originalTotalPriceSQFT = calculateTotalPriceSQFT(processed.salePrice, processed.propertySQFT, processed.buildingSQFT);
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
        { label: 'Building SQFT', key: 'buildingSQFT', value: formatNumber(targetProperty.buildingSQFT, 2) },
        { label: 'Building Stories', key: 'buildingStories', value: targetProperty.buildingStories },
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
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0);
    const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
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
    
    // Calculate renovated-based weights (renovated properties get higher weight)
    const renovatedWeights = included.map(p => {
        // Give renovated properties 3x weight compared to non-renovated
        return p.renovated === 'Yes' ? 3.0 : 1.0;
    });
    const totalRenovatedWeight = renovatedWeights.reduce((sum, w) => sum + w, 0);
    
    // Calculate combined weights (renovated + originalDetails matching)
    const combinedWeights = included.map(p => {
        let weight = 1.0;
        // Match renovation status (3x multiplier if matches target)
        if (targetProperty.renovated === p.renovated) {
            weight *= 3.0;
        }
        // Match original details status (2x multiplier if matches target)
        if (targetProperty.originalDetails === p.originalDetails) {
            weight *= 2.0;
        }
        return weight;
    });
    const totalCombinedWeight = combinedWeights.reduce((sum, w) => sum + w, 0);
    
    // Calculate all-weighted blend (combines all weighting factors)
    const allWeights = included.map((p, index) => {
        let weight = 1.0;
        
        // Price component (normalized 0-1)
        if (totalPrice > 0) {
            weight *= (p.adjustedSalePrice / totalPrice) * included.length;
        }
        
        // Size similarity component
        if (totalSizeWeight > 0 && sizeWeights[index]) {
            weight *= (sizeWeights[index] / totalSizeWeight) * included.length;
        }
        
        // Date recency component
        if (totalDateWeight > 0 && dateWeights[index]) {
            weight *= (dateWeights[index] / totalDateWeight) * included.length;
        }
        
        // Renovated match component
        if (p.renovated === targetProperty.renovated) {
            weight *= 1.5;
        }
        
        // Original details match component
        if (p.originalDetails === targetProperty.originalDetails) {
            weight *= 1.3;
        }
        
        return weight;
    });
    const totalAllWeight = allWeights.reduce((sum, w) => sum + w, 0);
    
    comparableProperties.forEach(prop => {
        const row = document.createElement('tr');
        row.id = `comp-${prop.id}`;
        
        // Calculate weight percentage based on method
        let weightPercent = 0;
        if (prop.included) {
            if (weightingMethod === 'price' && totalPrice > 0) {
                weightPercent = (prop.adjustedSalePrice / totalPrice) * 100;
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
            } else if (weightingMethod === 'renovated' && totalRenovatedWeight > 0) {
                const propIndex = included.findIndex(p => p.id === prop.id);
                if (propIndex >= 0) {
                    weightPercent = (renovatedWeights[propIndex] / totalRenovatedWeight) * 100;
                }
            } else if (weightingMethod === 'combined' && totalCombinedWeight > 0) {
                const propIndex = included.findIndex(p => p.id === prop.id);
                if (propIndex >= 0) {
                    weightPercent = (combinedWeights[propIndex] / totalCombinedWeight) * 100;
                }
            } else if (weightingMethod === 'all-weighted' && totalAllWeight > 0) {
                const propIndex = included.findIndex(p => p.id === prop.id);
                if (propIndex >= 0) {
                    weightPercent = (allWeights[propIndex] / totalAllWeight) * 100;
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
                    <td>${prop.originalDetails || 'N/A'}</td>
                    <td>${formatNumber(prop.propertySQFT, 2)}</td>
                    <td>${formatNumber(prop.buildingSQFT, 2)}</td>
                    <td>${formatCurrency(prop.buildingPriceSQFT)}</td>
                    <td>${formatCurrency(prop.totalPriceSQFT)}</td>
                    <td>
                        ${formatCurrency(prop.adjustedSalePrice)}
                        ${prop.appreciationAmount > 1000 ? '<br><span style="font-size: 11px; color: #27ae60;">+' + formatCurrency(prop.appreciationAmount) + ' adj.</span>' : ''}
                    </td>
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

// Weighting method labels map (shared between functions)
const avgTypeMap = {
    'simple': 'Simple Average',
    'price': 'Price-Weighted Average',
    'size': 'Building Size-Weighted Average',
    'total-size': 'Total Property Size-Weighted Average',
    'date': 'Date-Weighted Average (Recent Sales)',
    'renovated': 'Renovated-Weighted Average',
    'combined': 'Combined (Renovated + Original Details) Weighted Average',
    'all-weighted': 'All-Weighted Blend (All Factors Combined)'
};

// Calculate and render market averages
function calculateAndRenderAverages() {
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0);
    
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
            const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p) => sum + (p.buildingPriceSQFT * p.adjustedSalePrice), 0) / totalPrice;
            avgTotalPriceSQFT = included.reduce((sum, p) => sum + (p.totalPriceSQFT * p.adjustedSalePrice), 0) / totalPrice;
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
        } else if (weightingMethod === 'renovated') {
            // Renovated-based weighted average (renovated properties weighted higher)
            const weights = included.map(p => p.renovated === 'Yes' ? 3.0 : 1.0);
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        } else if (weightingMethod === 'combined') {
            // Combined weighted average (renovated + originalDetails matching)
            const weights = included.map(p => {
                let weight = 1.0;
                if (targetProperty.renovated === p.renovated) weight *= 3.0;
                if (targetProperty.originalDetails === p.originalDetails) weight *= 2.0;
                return weight;
            });
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        } else if (weightingMethod === 'all-weighted') {
            // All-weighted blend (combines all factors)
            const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
            const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
            
            const weights = included.map(p => {
                let weight = 1.0;
                
                // Price factor
                if (totalPrice > 0) weight *= (p.adjustedSalePrice / totalPrice) * included.length;
                
                // Size similarity factor
                const compSize = p.floors * (p.buildingWidthFeet * p.buildingDepthFeet);
                const sizeDiff = Math.abs(compSize - targetSize);
                const sizeWeight = 1 / (1 + sizeDiff / targetSize);
                weight *= sizeWeight * included.length;
                
                // Date recency factor
                if (p.sellDate !== 'N/A' && p.sellDate) {
                    const dateParts = p.sellDate.split('/');
                    if (dateParts.length === 3) {
                        let year = parseInt(dateParts[2]);
                        if (year < 100) year += year < 50 ? 2000 : 1900;
                        const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
                        const today = new Date();
                        const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
                        const dateWeight = Math.exp(-daysSinceSale / 525);
                        weight *= dateWeight * included.length;
                    }
                }
                
                // Qualitative matches
                if (p.renovated === targetProperty.renovated) weight *= 1.5;
                if (p.originalDetails === targetProperty.originalDetails) weight *= 1.3;
                
                return weight;
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

// Change appreciation rate
function setAppreciationRate(rate) {
    annualAppreciationRate = rate / 100; // Convert percentage to decimal
    
    // Reprocess all properties with new rate
    comparableProperties.forEach(prop => {
        if (prop.originalSalePrice) {
            const adjustment = applyAppreciationAdjustment(prop.originalSalePrice, prop.sellDate);
            prop.adjustedSalePrice = adjustment.adjustedPrice;
            prop.appreciationAmount = adjustment.appreciationAmount;
            
            // Recalculate price per SQFT
            prop.buildingPriceSQFT = calculateBuildingPriceSQFT(prop.adjustedSalePrice, prop.buildingWidthFeet, prop.buildingDepthFeet, prop.floors);
            prop.totalPriceSQFT = calculateTotalPriceSQFT(prop.adjustedSalePrice, prop.propertySQFT, prop.buildingSQFT);
        }
    });
    
    // Update display
    renderComparables();
    calculateAndRenderEstimates();
}

// Expose to global scope
window.setAppreciationRate = setAppreciationRate;

// Calculate and render estimates
function calculateAndRenderEstimates() {
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0);
    
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
            const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p) => sum + (p.buildingPriceSQFT * p.adjustedSalePrice), 0) / totalPrice;
            avgTotalPriceSQFT = included.reduce((sum, p) => sum + (p.totalPriceSQFT * p.adjustedSalePrice), 0) / totalPrice;
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
        } else if (weightingMethod === 'renovated') {
            // Renovated-based weighted average (renovated properties weighted higher)
            const weights = included.map(p => p.renovated === 'Yes' ? 3.0 : 1.0);
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        } else if (weightingMethod === 'combined') {
            // Combined weighted average (renovated + originalDetails matching)
            const weights = included.map(p => {
                let weight = 1.0;
                if (targetProperty.renovated === p.renovated) weight *= 3.0;
                if (targetProperty.originalDetails === p.originalDetails) weight *= 2.0;
                return weight;
            });
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            avgBuildingPriceSQFT = included.reduce((sum, p, i) => sum + (p.buildingPriceSQFT * weights[i]), 0) / totalWeight;
            avgTotalPriceSQFT = included.reduce((sum, p, i) => sum + (p.totalPriceSQFT * weights[i]), 0) / totalWeight;
        } else if (weightingMethod === 'all-weighted') {
            // All-weighted blend (combines all factors)
            const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
            const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
            
            const weights = included.map(p => {
                let weight = 1.0;
                
                // Price factor
                if (totalPrice > 0) weight *= (p.adjustedSalePrice / totalPrice) * included.length;
                
                // Size similarity factor
                const compSize = p.floors * (p.buildingWidthFeet * p.buildingDepthFeet);
                const sizeDiff = Math.abs(compSize - targetSize);
                const sizeWeight = 1 / (1 + sizeDiff / targetSize);
                weight *= sizeWeight * included.length;
                
                // Date recency factor
                if (p.sellDate !== 'N/A' && p.sellDate) {
                    const dateParts = p.sellDate.split('/');
                    if (dateParts.length === 3) {
                        let year = parseInt(dateParts[2]);
                        if (year < 100) year += year < 50 ? 2000 : 1900;
                        const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
                        const today = new Date();
                        const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
                        const dateWeight = Math.exp(-daysSinceSale / 525);
                        weight *= dateWeight * included.length;
                    }
                }
                
                // Qualitative matches
                if (p.renovated === targetProperty.renovated) weight *= 1.5;
                if (p.originalDetails === targetProperty.originalDetails) weight *= 1.3;
                
                return weight;
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
    // 68% Confidence Interval (±1 std dev)
    const estimateALow68 = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT - stdDevBuildingPriceSQFT);
    const estimateAHigh68 = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT + stdDevBuildingPriceSQFT);
    // 95% Confidence Interval (±2 std dev)
    const estimateALow95 = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT - (2 * stdDevBuildingPriceSQFT));
    const estimateAHigh95 = targetBuildingSQFTWithFloors * (avgBuildingPriceSQFT + (2 * stdDevBuildingPriceSQFT));
    
    // Method B: (Property SQFT + Building SQFT) × Average Total $ SQFT
    const estimateB = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * avgTotalPriceSQFT;
    const estimateBMedian = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * medianTotalPriceSQFT;
    // 68% Confidence Interval (±1 std dev)
    const estimateBLow68 = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (avgTotalPriceSQFT - stdDevTotalPriceSQFT);
    const estimateBHigh68 = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (avgTotalPriceSQFT + stdDevTotalPriceSQFT);
    // 95% Confidence Interval (±2 std dev)
    const estimateBLow95 = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (avgTotalPriceSQFT - (2 * stdDevTotalPriceSQFT));
    const estimateBHigh95 = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (avgTotalPriceSQFT + (2 * stdDevTotalPriceSQFT));
    
    // Blended Estimate: 60% Method A + 40% Method B
    const blendedEstimate = (estimateA * 0.6) + (estimateB * 0.4);
    const blendedMedian = (estimateAMedian * 0.6) + (estimateBMedian * 0.4);
    const blendedLow68 = (estimateALow68 * 0.6) + (estimateBLow68 * 0.4);
    const blendedHigh68 = (estimateAHigh68 * 0.6) + (estimateBHigh68 * 0.4);
    const blendedLow95 = (estimateALow95 * 0.6) + (estimateBLow95 * 0.4);
    const blendedHigh95 = (estimateAHigh95 * 0.6) + (estimateBHigh95 * 0.4);
    
    // Calculate High Influence Properties Estimate (only if weighted method and high influence props exist)
    let highInfluenceEstimateHTML = '';
    if (weightingMethod !== 'simple' && included.length > 0) {
        // Recalculate weights to identify high influence properties
        const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
        const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
        const targetTotalSize = targetProperty.propertySQFT + targetProperty.buildingSQFT;
        
        // Calculate all weight arrays
        const sizeWeights = included.map(p => {
            const compSize = p.floors * (p.buildingWidthFeet * p.buildingDepthFeet);
            const sizeDiff = Math.abs(compSize - targetSize);
            return 1 / (1 + sizeDiff / targetSize);
        });
        const totalSizeWeight = sizeWeights.reduce((sum, w) => sum + w, 0);
        
        const totalSizeWeights = included.map(p => {
            const compTotalSize = p.propertySQFT + p.buildingSQFT;
            const totalSizeDiff = Math.abs(compTotalSize - targetTotalSize);
            return 1 / (1 + totalSizeDiff / targetTotalSize);
        });
        const totalPropertySizeWeight = totalSizeWeights.reduce((sum, w) => sum + w, 0);
        
        const dateWeights = included.map(p => {
            if (p.sellDate === 'N/A' || !p.sellDate) return 0.1;
            const dateParts = p.sellDate.split('/');
            if (dateParts.length !== 3) return 0.1;
            let year = parseInt(dateParts[2]);
            if (year < 100) year += year < 50 ? 2000 : 1900;
            const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
            const today = new Date();
            const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
            return Math.exp(-daysSinceSale / 525);
        });
        const totalDateWeight = dateWeights.reduce((sum, w) => sum + w, 0);
        
        const renovatedWeights = included.map(p => p.renovated === 'Yes' ? 3.0 : 1.0);
        const totalRenovatedWeight = renovatedWeights.reduce((sum, w) => sum + w, 0);
        
        const combinedWeights = included.map(p => {
            let weight = 1.0;
            if (targetProperty.renovated === p.renovated) weight *= 3.0;
            if (targetProperty.originalDetails === p.originalDetails) weight *= 2.0;
            return weight;
        });
        const totalCombinedWeight = combinedWeights.reduce((sum, w) => sum + w, 0);
        
        const allWeights = included.map((p, index) => {
            let weight = 1.0;
            if (totalPrice > 0) weight *= (p.adjustedSalePrice / totalPrice) * included.length;
            if (totalSizeWeight > 0 && sizeWeights[index]) weight *= (sizeWeights[index] / totalSizeWeight) * included.length;
            if (totalDateWeight > 0 && dateWeights[index]) weight *= (dateWeights[index] / totalDateWeight) * included.length;
            if (p.renovated === targetProperty.renovated) weight *= 1.5;
            if (p.originalDetails === targetProperty.originalDetails) weight *= 1.3;
            return weight;
        });
        const totalAllWeight = allWeights.reduce((sum, w) => sum + w, 0);
        
        // Identify high influence properties (weight > 150% of average)
        const avgWeight = 100 / included.length;
        const highInfluenceThreshold = avgWeight * 1.5;
        
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
            
            const hiEstimateB = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * hiAvgTotalPriceSQFT;
            const hiEstimateBMedian = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * hiMedianTotalPriceSQFT;
            const hiEstimateBLow68 = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (hiAvgTotalPriceSQFT - hiStdDevTotalPriceSQFT);
            const hiEstimateBHigh68 = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (hiAvgTotalPriceSQFT + hiStdDevTotalPriceSQFT);
            const hiEstimateBLow95 = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (hiAvgTotalPriceSQFT - (2 * hiStdDevTotalPriceSQFT));
            const hiEstimateBHigh95 = (targetProperty.propertySQFT + targetProperty.buildingSQFT) * (hiAvgTotalPriceSQFT + (2 * hiStdDevTotalPriceSQFT));
            
            const hiBlendedEstimate = (hiEstimateA * 0.6) + (hiEstimateB * 0.4);
            const hiBlendedMedian = (hiEstimateAMedian * 0.6) + (hiEstimateBMedian * 0.4);
            const hiBlendedLow68 = (hiEstimateALow68 * 0.6) + (hiEstimateBLow68 * 0.4);
            const hiBlendedHigh68 = (hiEstimateAHigh68 * 0.6) + (hiEstimateBHigh68 * 0.4);
            const hiBlendedLow95 = (hiEstimateALow95 * 0.6) + (hiEstimateBLow95 * 0.4);
            const hiBlendedHigh95 = (hiEstimateAHigh95 * 0.6) + (hiEstimateBHigh95 * 0.4);
            
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
            <h4>Recommended Blended Estimate</h4>
            <div class="estimate-value">${formatCurrency(blendedMedian)}</div>
            <div class="estimate-formula">Median-Based (60% Method A + 40% Method B)</div>
            <div class="confidence-interval">
                <div class="ci-row"><span class="ci-label">Weighted Average:</span> <span class="ci-value">${formatCurrency(blendedEstimate)}</span></div>
                <div class="ci-row"><span class="ci-label">68% Confidence (±1σ):</span> <span class="ci-value">${formatCurrency(blendedLow68)} - ${formatCurrency(blendedHigh68)}</span></div>
                <div class="ci-row"><span class="ci-label">95% Confidence (±2σ):</span> <span class="ci-value">${formatCurrency(blendedLow95)} - ${formatCurrency(blendedHigh95)}</span></div>
            </div>
        </div>
        ${highInfluenceEstimateHTML}
        <div class="estimate-box">
            <h4>Method A: Building-Based Estimate</h4>
            <div class="estimate-value">${formatCurrency(estimateAMedian)}</div>
            <div class="estimate-formula">Median-Based: ${formatNumber(targetBuildingSQFTWithFloors, 2)} SQFT × ${formatCurrency(medianBuildingPriceSQFT)}</div>
            <div class="confidence-interval">
                <div class="ci-row"><span class="ci-label">Weighted Average:</span> <span class="ci-value">${formatCurrency(estimateA)}</span></div>
                <div class="ci-row"><span class="ci-label">68% Confidence (±1σ):</span> <span class="ci-value">${formatCurrency(estimateALow68)} - ${formatCurrency(estimateAHigh68)}</span></div>
                <div class="ci-row"><span class="ci-label">95% Confidence (±2σ):</span> <span class="ci-value">${formatCurrency(estimateALow95)} - ${formatCurrency(estimateAHigh95)}</span></div>
            </div>
        </div>
        <div class="estimate-box">
            <h4>Method B: Total Property-Based Estimate</h4>
            <div class="estimate-value">${formatCurrency(estimateBMedian)}</div>
            <div class="estimate-formula">Median-Based: (${formatNumber(targetProperty.propertySQFT, 2)} + ${formatNumber(targetProperty.buildingSQFT, 2)}) SQFT × ${formatCurrency(medianTotalPriceSQFT)}</div>
            <div class="confidence-interval">
                <div class="ci-row"><span class="ci-label">Weighted Average:</span> <span class="ci-value">${formatCurrency(estimateB)}</span></div>
                <div class="ci-row"><span class="ci-label">68% Confidence (±1σ):</span> <span class="ci-value">${formatCurrency(estimateBLow68)} - ${formatCurrency(estimateBHigh68)}</span></div>
                <div class="ci-row"><span class="ci-label">95% Confidence (±2σ):</span> <span class="ci-value">${formatCurrency(estimateBLow95)} - ${formatCurrency(estimateBHigh95)}</span></div>
            </div>
        </div>
    `;
    
    // Get selected direct comp
    const directCompProp = comparableProperties.find(p => p.isDirectComp);
    const directCompValue = directCompProp ? directCompProp.adjustedSalePrice : 0;
    const directCompAddress = directCompProp ? directCompProp.address : 'None selected';
    
    // Calculate weighted blend between direct comp and market average based on selected weighting method
    let directCompBuildingPriceSQFT = 0;
    let directCompTotalPriceSQFT = 0;
    let directCompEstimate = 0;
    let directCompTotalEstimate = 0;
    
    if (directCompProp && included.length > 0) {
        // Calculate weight factor for the direct comp based on selected weighting method
        let directCompWeight = 1.0;
        
        if (weightingMethod === 'price') {
            // Price weighting: higher prices get more weight
            const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
            directCompWeight = (directCompProp.adjustedSalePrice / totalPrice) * included.length;
        } else if (weightingMethod === 'size') {
            // Size similarity weighting: closer to target size = higher weight
            const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
            const compSize = directCompProp.floors * (directCompProp.buildingWidthFeet * directCompProp.buildingDepthFeet);
            const sizeDiff = Math.abs(compSize - targetSize);
            directCompWeight = 1 / (1 + sizeDiff / targetSize);
            // Normalize against average weight
            const avgSizeWeight = 1 / included.length;
            directCompWeight = (directCompWeight / avgSizeWeight);
        } else if (weightingMethod === 'total-size') {
            // Total property size weighting
            const targetTotalSize = targetProperty.propertySQFT + targetProperty.buildingSQFT;
            const compTotalSize = directCompProp.propertySQFT + directCompProp.buildingSQFT;
            const totalSizeDiff = Math.abs(compTotalSize - targetTotalSize);
            directCompWeight = 1 / (1 + totalSizeDiff / targetTotalSize);
            const avgSizeWeight = 1 / included.length;
            directCompWeight = (directCompWeight / avgSizeWeight);
        } else if (weightingMethod === 'date') {
            // Date recency weighting: more recent = higher weight
            if (directCompProp.sellDate !== 'N/A' && directCompProp.sellDate) {
                const dateParts = directCompProp.sellDate.split('/');
                if (dateParts.length === 3) {
                    let year = parseInt(dateParts[2]);
                    if (year < 100) year += year < 50 ? 2000 : 1900;
                    const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
                    const today = new Date();
                    const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
                    directCompWeight = Math.exp(-daysSinceSale / 525);
                    const avgDateWeight = 1 / included.length;
                    directCompWeight = (directCompWeight / avgDateWeight);
                } else {
                    directCompWeight = 0.1;
                }
            } else {
                directCompWeight = 0.1;
            }
        } else if (weightingMethod === 'renovated') {
            // Renovation status weighting
            directCompWeight = directCompProp.renovated === 'Yes' ? 3.0 : 1.0;
            const avgRenovatedWeight = 1 / included.length;
            directCompWeight = (directCompWeight / avgRenovatedWeight);
        } else if (weightingMethod === 'combined') {
            // Combined weighting (renovated + originalDetails)
            directCompWeight = 1.0;
            if (targetProperty.renovated === directCompProp.renovated) directCompWeight *= 3.0;
            if (targetProperty.originalDetails === directCompProp.originalDetails) directCompWeight *= 2.0;
            const avgCombinedWeight = 1 / included.length;
            directCompWeight = (directCompWeight / avgCombinedWeight);
        } else if (weightingMethod === 'all-weighted') {
            // All-weighted blend (combines all factors)
            directCompWeight = 1.0;
            
            // Price factor
            const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
            if (totalPrice > 0) directCompWeight *= (directCompProp.adjustedSalePrice / totalPrice) * included.length;
            
            // Size similarity factor
            const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
            const compSize = directCompProp.floors * (directCompProp.buildingWidthFeet * directCompProp.buildingDepthFeet);
            const sizeDiff = Math.abs(compSize - targetSize);
            const sizeWeight = 1 / (1 + sizeDiff / targetSize);
            directCompWeight *= sizeWeight * included.length;
            
            // Date recency factor
            if (directCompProp.sellDate !== 'N/A' && directCompProp.sellDate) {
                const dateParts = directCompProp.sellDate.split('/');
                if (dateParts.length === 3) {
                    let year = parseInt(dateParts[2]);
                    if (year < 100) year += year < 50 ? 2000 : 1900;
                    const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
                    const today = new Date();
                    const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
                    const dateWeight = Math.exp(-daysSinceSale / 525);
                    directCompWeight *= dateWeight * included.length;
                }
            }
            
            // Qualitative matches
            if (directCompProp.renovated === targetProperty.renovated) directCompWeight *= 1.5;
            if (directCompProp.originalDetails === targetProperty.originalDetails) directCompWeight *= 1.3;
        }
        
        // Blend between direct comp's $/SQFT and market average based on weight
        // Higher weight = more influence from direct comp
        // Lower weight = more influence from market average
        const blendRatio = Math.min(directCompWeight / 2, 0.85); // Cap at 85% direct comp influence
        
        directCompBuildingPriceSQFT = (directCompProp.buildingPriceSQFT * blendRatio) + (avgBuildingPriceSQFT * (1 - blendRatio));
        directCompTotalPriceSQFT = (directCompProp.totalPriceSQFT * blendRatio) + (avgTotalPriceSQFT * (1 - blendRatio));
        
        // Calculate estimates using the blended $/SQFT values
        directCompEstimate = directCompBuildingPriceSQFT * targetBuildingSQFTWithFloors;
        const targetTotalSQFT = targetProperty.propertySQFT + targetProperty.buildingSQFT;
        directCompTotalEstimate = directCompTotalPriceSQFT * targetTotalSQFT;
    }
    
    // Reference values
    const refContainer = document.getElementById('reference-values');
    const weightingMethodLabel = weightingMethod === 'simple' ? '' : avgTypeMap[weightingMethod];
    refContainer.innerHTML = `
        <div class="reference-box">
            <h4>Direct Comp Sale Price</h4>
            <div class="reference-value">${formatCurrency(directCompValue)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompAddress}</div>
        </div>
        <div class="reference-box">
            <h4>Direct Comp Building-Based</h4>
            ${weightingMethodLabel ? '<div class="average-count" style="margin-top: 5px; font-size: 12px; color: #7f8c8d;">' + weightingMethodLabel + '</div>' : ''}
            <div class="reference-value">${formatCurrency(directCompEstimate)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompProp ? formatCurrency(directCompBuildingPriceSQFT) + ' × (' + targetProperty.floors + ' floors × ' + formatNumber(targetProperty.buildingWidthFeet, 2) + ' × ' + formatNumber(targetProperty.buildingDepthFeet, 2) + ')' : 'No comp selected'}</div>
        </div>
        <div class="reference-box">
            <h4>Direct Comp Total-Based</h4>
            ${weightingMethodLabel ? '<div class="average-count" style="margin-top: 5px; font-size: 12px; color: #7f8c8d;">' + weightingMethodLabel + '</div>' : ''}
            <div class="reference-value">${formatCurrency(directCompTotalEstimate)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompProp ? formatCurrency(directCompTotalPriceSQFT) + ' × (' + formatNumber(targetProperty.propertySQFT, 2) + ' + ' + formatNumber(targetProperty.buildingSQFT, 2) + ')' : 'No comp selected'}</div>
        </div>
    `;
    
    calculateAndRenderAverages();
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
    updateMap();
}

// Expose to global scope
window.changeTargetProperty = changeTargetProperty;

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
    
    renderComparables();
    calculateAndRenderEstimates();
    updateMap(); // Update map to reflect new weights in heatmap
}

// Expose to global scope
window.setWeightingMethod = setWeightingMethod;

// Expose filter functions to global scope
window.selectAllComps = selectAllComps;
window.deselectAllComps = deselectAllComps;
window.filterRenovated = filterRenovated;
window.filterTaxClass1 = filterTaxClass1;

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
    
    const fields = [
        { label: 'Sale Price', value: formatCurrency(prop.adjustedSalePrice || prop.salePrice || 0) },
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
    
    // Clear existing heatmap layer
    if (heatmapLayer) {
        map.removeLayer(heatmapLayer);
        heatmapLayer = null;
    }
    
    // Update the selected visualization mode (only if not 'none')
    if (mapMode === 'heatmap') {
        updateMapHeatmap();
    } else if (mapMode === 'value-zones') {
        updateMapValueZones();
    }
    // If mapMode is 'none', no heatmap layer is shown
    
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
            fillOpacity: 0.8
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
    
    // Add comparable property markers
    comparableProperties.forEach(prop => {
        if (prop.coordinates && prop.included) {
            const color = prop.isDirectComp ? '#eb70e9ff' : getPriceColor(prop.adjustedSalePrice);
            
            const marker = L.circleMarker([prop.coordinates.lat, prop.coordinates.lng], {
                radius: 8,
                fillColor: color,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.7
            })
            .bindTooltip(createTooltipContent(prop, false), {
                permanent: false,
                direction: 'top',
                offset: [0, -10]
            })
            .bindPopup(createPopupContent(prop, false));
            
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
    const heatData = [];
    
    // Calculate weights for all included properties (same logic as renderComparables)
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0 && p.coordinates);
    
    if (included.length === 0) return; // No data to display
    
    const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
    const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
    const targetTotalSize = targetProperty.propertySQFT + targetProperty.buildingSQFT;
    
    // Calculate all weight arrays based on current weighting method
    let weights = [];
    
    if (weightingMethod === 'simple') {
        // Simple average - equal weights
        weights = included.map(() => 100 / included.length);
    } else if (weightingMethod === 'price') {
        // Price-weighted
        weights = included.map(p => (p.adjustedSalePrice / totalPrice) * 100);
    } else if (weightingMethod === 'size') {
        // Size-similarity weighted
        const sizeWeights = included.map(p => {
            const compSize = p.floors * (p.buildingWidthFeet * p.buildingDepthFeet);
            const sizeDiff = Math.abs(compSize - targetSize);
            return 1 / (1 + sizeDiff / targetSize);
        });
        const totalSizeWeight = sizeWeights.reduce((sum, w) => sum + w, 0);
        weights = sizeWeights.map(w => (w / totalSizeWeight) * 100);
    } else if (weightingMethod === 'total-size') {
        // Total property size weighted
        const totalSizeWeights = included.map(p => {
            const compTotalSize = p.propertySQFT + p.buildingSQFT;
            const totalSizeDiff = Math.abs(compTotalSize - targetTotalSize);
            return 1 / (1 + totalSizeDiff / targetTotalSize);
        });
        const totalPropertySizeWeight = totalSizeWeights.reduce((sum, w) => sum + w, 0);
        weights = totalSizeWeights.map(w => (w / totalPropertySizeWeight) * 100);
    } else if (weightingMethod === 'date') {
        // Date-based weighted
        const dateWeights = included.map(p => {
            if (p.sellDate === 'N/A' || !p.sellDate) return 0.1;
            const dateParts = p.sellDate.split('/');
            if (dateParts.length !== 3) return 0.1;
            let year = parseInt(dateParts[2]);
            if (year < 100) year += year < 50 ? 2000 : 1900;
            const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
            const today = new Date();
            const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
            return Math.exp(-daysSinceSale / 525);
        });
        const totalDateWeight = dateWeights.reduce((sum, w) => sum + w, 0);
        weights = dateWeights.map(w => (w / totalDateWeight) * 100);
    } else if (weightingMethod === 'renovated') {
        // Renovated-based weighted
        const renovatedWeights = included.map(p => p.renovated === 'Yes' ? 3.0 : 1.0);
        const totalRenovatedWeight = renovatedWeights.reduce((sum, w) => sum + w, 0);
        weights = renovatedWeights.map(w => (w / totalRenovatedWeight) * 100);
    } else if (weightingMethod === 'combined') {
        // Combined weighted (renovated + originalDetails)
        const combinedWeights = included.map(p => {
            let weight = 1.0;
            if (targetProperty.renovated === p.renovated) weight *= 3.0;
            if (targetProperty.originalDetails === p.originalDetails) weight *= 2.0;
            return weight;
        });
        const totalCombinedWeight = combinedWeights.reduce((sum, w) => sum + w, 0);
        weights = combinedWeights.map(w => (w / totalCombinedWeight) * 100);
    } else if (weightingMethod === 'all-weighted') {
        // All-weighted blend (combines all factors)
        const allWeights = included.map((p, index) => {
            let weight = 1.0;
            
            // Price component
            if (totalPrice > 0) weight *= (p.adjustedSalePrice / totalPrice) * included.length;
            
            // Size similarity component
            const compSize = p.floors * (p.buildingWidthFeet * p.buildingDepthFeet);
            const sizeDiff = Math.abs(compSize - targetSize);
            const sizeWeight = 1 / (1 + sizeDiff / targetSize);
            weight *= sizeWeight * included.length;
            
            // Date recency component
            if (p.sellDate !== 'N/A' && p.sellDate) {
                const dateParts = p.sellDate.split('/');
                if (dateParts.length === 3) {
                    let year = parseInt(dateParts[2]);
                    if (year < 100) year += year < 50 ? 2000 : 1900;
                    const saleDate = new Date(year, parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
                    const today = new Date();
                    const daysSinceSale = (today - saleDate) / (1000 * 60 * 60 * 24);
                    const dateWeight = Math.exp(-daysSinceSale / 525);
                    weight *= dateWeight * included.length;
                }
            }
            
            // Qualitative matches
            if (p.renovated === targetProperty.renovated) weight *= 1.5;
            if (p.originalDetails === targetProperty.originalDetails) weight *= 1.3;
            
            return weight;
        });
        const totalAllWeight = allWeights.reduce((sum, w) => sum + w, 0);
        weights = allWeights.map(w => (w / totalAllWeight) * 100);
    }
    
    // Use weights as heatmap intensity (weight percentage directly represents influence)
    included.forEach((prop, index) => {
        heatData.push([prop.coordinates.lat, prop.coordinates.lng, weights[index]]);
    });
    
    if (heatData.length > 0) {
        // Max intensity is 100% (highest weight percentage)
        const maxWeight = Math.max(...weights);
        const dynamicMax = maxWeight * 1.2; // 20% above max for better color distribution
        
        heatmapLayer = L.heatLayer(heatData, {
            radius: 40,        // Larger radius for better blob overlap
            blur: 30,          // More blur for smoother blending between properties
            maxZoom: 17,
            max: dynamicMax,   // Dynamic based on weight percentages
            gradient: {
                0.0: '#4CAF50',  // Green = low influence
                0.5: '#FFC107',  // Yellow = medium influence
                1.0: '#E74C3C'   // Red = high influence
            },
            minOpacity: 0.2,   // Lower opacity so overlapping areas become more visible
            pane: 'influencePane'  // Use custom pane for layer ordering
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
// Removed showMapMarkers function - markers are now always displayed

// Show heatmap view (toggleable)
function showMapHeatmap() {
    const btn = document.getElementById('map-heatmap-btn');
    
    // Toggle mode
    if (mapMode === 'heatmap') {
        // Turn off
        mapMode = 'none';
        btn.classList.remove('active');
    } else {
        // Turn on
        mapMode = 'heatmap';
        btn.classList.add('active');
        document.getElementById('map-value-zones-btn').classList.remove('active');
        
        // Update legend for heatmap mode
        const legendContent = document.getElementById('map-legend-content');
        if (legendContent) {
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
        }
    }
    
    updateMap();
}

// Show value zones view (toggleable)
function showMapValueZones() {
    const btn = document.getElementById('map-value-zones-btn');
    
    // Toggle mode
    if (mapMode === 'value-zones') {
        // Turn off
        mapMode = 'none';
        btn.classList.remove('active');
    } else {
        // Turn on
        mapMode = 'value-zones';
        btn.classList.add('active');
        document.getElementById('map-heatmap-btn').classList.remove('active');
        
        // Update legend for value zones mode
        const legendContent = document.getElementById('map-legend-content');
        if (legendContent) {
            legendContent.innerHTML = `
                <h4>Value Zones</h4>
                <p style="font-size: 11px; margin: 5px 0; color: #666;">Property value concentration</p>
                <div style="background: linear-gradient(to right, #E74C3C, #FFC107, #4CAF50); height: 20px; border-radius: 3px; margin: 8px 0;"></div>
                <div style="display: flex; justify-content: space-between; font-size: 10px; color: #666;">
                    <span>Lower Value</span>
                    <span>Higher Value</span>
                </div>
                <p style="font-size: 10px; margin-top: 8px; color: #888;">Green areas = expensive properties (hot zones)</p>
            `;
        }
    }
    
    updateMap();
}

// Update heatmap when metric changes
function updateHeatmap() {
    if (mapMode === 'heatmap') {
        updateMap();
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
        // Apply exponential transformation for sharper falloff
        const exponentialIntensity = Math.pow(normalizedIntensity, 2.0);
        const weight = exponentialIntensity;
        
        // Create multiple concentric rings of points for smooth falloff
        const rings = 8;  // More rings for smoother gradient
        const pointsPerRing = 24;  // More points around each ring
        const maxRadius = 0.0015;  // Radius for gradient spread
        
        // Add multiple center points with full weight to fill the core
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, weight]);
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, weight]);
        heatPoints.push([prop.coordinates.lat, prop.coordinates.lng, weight]);
        
        // Add very tight inner ring to fill any gap
        const innerRingPoints = 12;
        const innerRadius = maxRadius / 20; // Very small inner ring
        for (let i = 0; i < innerRingPoints; i++) {
            const angle = (Math.PI * 2 * i) / innerRingPoints;
            heatPoints.push([
                prop.coordinates.lat + Math.cos(angle) * innerRadius,
                prop.coordinates.lng + Math.sin(angle) * innerRadius,
                weight * 0.98
            ]);
        }
        
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
        heatmapLayer = L.heatLayer(heatPoints, {
            radius: 80,        // Larger radius to blend all ring points together
            blur: 50,          // High blur for smooth blending
            maxZoom: 17,
            max: 100,          // Lower max so center reaches full intensity in gradient
            gradient: {
                0.0: 'rgba(231, 76, 60, 0.0)',     // Red = cheap (transparent at edges)
                0.1: 'rgba(231, 76, 60, 0.3)',     // Red
                0.25: 'rgba(255, 107, 74, 0.4)',   // Red-orange
                0.4: 'rgba(255, 152, 0, 0.45)',    // Orange
                0.55: 'rgba(255, 193, 7, 0.5)',    // Amber
                0.7: 'rgba(255, 235, 59, 0.55)',   // Yellow
                0.82: 'rgba(205, 220, 57, 0.6)',   // Yellow-green
                0.9: 'rgba(139, 195, 74, 0.65)',   // Light green
                1.0: 'rgba(76, 175, 80, 0.7)'      // Bright green = expensive (center)
            },
            minOpacity: 0,     // No minimum opacity to show full gradient including center
            pane: 'valueZonesPane'  // Use custom pane for layer ordering
        });
        
        // Patch for canvas performance
        const originalCreateCanvas = heatmapLayer._initCanvas;
        if (originalCreateCanvas) {
            heatmapLayer._initCanvas = function() {
                originalCreateCanvas.call(this);
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
        const bounds = heatPoints.map(d => [d[0], d[1]]);
        map.fitBounds(bounds, { padding: [30, 30] });
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
        if (btn) btn.classList.add('active');
        if (amenitiesOverlayLayer) {
            map.addLayer(amenitiesOverlayLayer);
            
            // Set canvas opacity after layer is added
            // Use setTimeout to ensure canvas is created
            setTimeout(() => {
                // Access canvas directly from the layer object
                if (amenitiesOverlayLayer._canvas) {
                    const canvas = amenitiesOverlayLayer._canvas;
                    canvas.style.opacity = '0.7';
                    
                    // Set z-index directly on canvas to ensure it stays below other layers
                    canvas.style.zIndex = '1';
                    
                    console.log('Set canvas opacity to 0.7 and z-index to 1');
                }
            }, 100);
        }
    } else {
        if (btn) btn.classList.remove('active');
        if (amenitiesOverlayLayer) map.removeLayer(amenitiesOverlayLayer);
    }
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
