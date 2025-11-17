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
let valueZonesLayer = null;
let amenitiesOverlayLayer = null;
let showHeatmap = false; // Independent toggle for weights influence heatmap
let showValueZones = false; // Independent toggle for value zones
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
function calculateBuildingSQFT(widthFeet, depthFeet, floors) {
    return (widthFeet * depthFeet) * floors;
}

// Calculate Building $ SQFT
function calculateBuildingPriceSQFT(price, buildingSQFT) {
    if (!buildingSQFT || buildingSQFT === 0) return 0;
    return price / buildingSQFT;
}

// Calculate Total $ SQFT
function calculateTotalPriceSQFT(price, propertySQFT, buildingSQFT, buildingWidthFeet, buildingDepthFeet) {
    const buildingFootprint = buildingWidthFeet * buildingDepthFeet;
    const total = (propertySQFT - buildingFootprint) + buildingSQFT;
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
    processed.buildingSQFT = calculateBuildingSQFT(prop.buildingWidthFeet, prop.buildingDepthFeet, prop.floors);
    
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
        
        // Initialize column sorting
        initializeColumnSorting();
        
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
    
    const fieldGroups = [
        {
            title: 'Property (feet)',
            fields: [
                { label: 'Width', value: formatNumber(targetProperty.propertyWidthFeet, 2) },
                { label: 'Depth', value: formatNumber(targetProperty.propertyDepthFeet, 2) },
                { label: 'SQFT', value: formatNumber(targetProperty.propertySQFT, 2) }
            ]
        },
        {
            title: 'Building (feet)',
            fields: [
                { label: 'Width', value: formatNumber(targetProperty.buildingWidthFeet, 2) },
                { label: 'Depth', value: formatNumber(targetProperty.buildingDepthFeet, 2) },
                { label: 'Floors', value: targetProperty.floors },
                { label: 'SQFT', value: formatNumber(targetProperty.buildingSQFT, 2) },
                
            ]
        },
        {
            title: 'Property Details',
            fields: [
                { label: 'Renovated', value: targetProperty.renovated },
                { label: 'Tax Class', value: targetProperty.taxClass },
                { label: 'Occupancy', value: targetProperty.occupancy },
                { label: 'Annual Taxes', value: formatCurrency(parseCurrency(targetProperty.taxes)) }
            ]
        }
    ];
    
    const container = document.getElementById('target-property-fields');
    container.innerHTML = '';
    
    fieldGroups.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'property-field-group';
        
        const groupTitle = document.createElement('div');
        groupTitle.className = 'field-group-title';
        groupTitle.textContent = group.title;
        groupDiv.appendChild(groupTitle);
        
        group.fields.forEach(field => {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'property-field-item';
            
            const label = document.createElement('span');
            label.className = 'field-label';
            label.textContent = field.label + ':';
            fieldDiv.appendChild(label);
            
            const value = document.createElement('span');
            value.className = 'field-value';
            value.textContent = field.value;
            fieldDiv.appendChild(value);
            
            groupDiv.appendChild(fieldDiv);
        });
        
        container.appendChild(groupDiv);
    });
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
    
    // Calculate weights for all included properties
    const included = comparableProperties.filter(p => p.included && p.adjustedSalePrice > 0);
    const totalPrice = included.reduce((sum, p) => sum + p.adjustedSalePrice, 0);
    const targetSize = targetProperty.buildingSQFT;
    
    // Calculate size-based weights for all included properties
    const sizeWeights = included.map(p => {
        const compSize = p.buildingSQFT;
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
    
    // Combine target property with comparables for sorting
    const targetForSort = { ...targetProperty, isTarget: true };
    let allProperties = [targetForSort, ...comparableProperties];
    
    // Sort all properties (including target) if a sort column is active
    if (currentSortColumn !== null) {
        allProperties = sortPropertiesByColumn(allProperties, currentSortColumn, currentSortDirection);
    }
    
    allProperties.forEach(prop => {
        // Handle target property row
        if (prop.isTarget) {
            const targetRow = document.createElement('tr');
            targetRow.classList.add('target-property-row');
            targetRow.innerHTML = `
                <td class="checkbox-cell" colspan="2"><span class="badge badge-target">TARGET</span></td>
                <td><strong>${prop.address}</strong></td>
                <td>${prop.renovated}</td>
                <td>${prop.originalDetails || 'N/A'}</td>
                <td>${formatNumber(prop.propertySQFT, 2)}</td>
                <td>${formatNumber(prop.buildingWidthFeet, 2)}</td>
                <td>${formatNumber(prop.buildingDepthFeet, 2)}</td>
                <td>${formatNumber(prop.buildingSQFT, 2)}</td>
                <td>${prop.floors}</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td class="weight-cell" style="${weightingMethod === 'simple' ? 'display: none;' : ''}">-</td>
                <td>-</td>
                <td>${prop.taxClass}</td>
                <td>${prop.occupancy}</td>
            `;
            tbody.appendChild(targetRow);
            return;
        }
        
        // Handle comparable property rows
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
                    <td>${formatNumber(prop.buildingWidthFeet, 2)}</td>
                    <td>${formatNumber(prop.buildingDepthFeet, 2)}</td>
                    <td>${formatNumber(prop.buildingSQFT, 2)}</td>
                    <td>${prop.floors}</td>
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

// Sort properties by column
function sortPropertiesByColumn(properties, columnIndex, direction) {
    return properties.sort((a, b) => {
        let aVal, bVal;
        
        // Map column index to property key
        switch(columnIndex) {
            case 2: // Address
                aVal = a.address;
                bVal = b.address;
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            case 3: // Renovated
                aVal = a.renovated;
                bVal = b.renovated;
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            case 4: // Original Details
                aVal = a.originalDetails || '';
                bVal = b.originalDetails || '';
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            case 5: // Property SQFT
                aVal = a.propertySQFT;
                bVal = b.propertySQFT;
                break;
            case 6: // Building Width
                aVal = a.buildingWidthFeet;
                bVal = b.buildingWidthFeet;
                break;
            case 7: // Building Depth
                aVal = a.buildingDepthFeet;
                bVal = b.buildingDepthFeet;
                break;
            case 8: // Building SQFT
                aVal = a.buildingSQFT;
                bVal = b.buildingSQFT;
                break;
            case 9: // Floors
                aVal = a.floors;
                bVal = b.floors;
                break;
            case 10: // Building $ SQFT
                aVal = a.buildingPriceSQFT;
                bVal = b.buildingPriceSQFT;
                break;
            case 11: // Total $ SQFT
                aVal = a.totalPriceSQFT;
                bVal = b.totalPriceSQFT;
                break;
            case 12: // Sale Price
                aVal = a.adjustedSalePrice || 0;
                bVal = b.adjustedSalePrice || 0;
                break;
            case 14: // Sale Date
                aVal = a.sellDate;
                bVal = b.sellDate;
                // Parse dates for comparison
                if (aVal === 'N/A') aVal = new Date(0);
                else {
                    const aParts = aVal.split('/');
                    let aYear = parseInt(aParts[2]);
                    if (aYear < 100) aYear += aYear < 50 ? 2000 : 1900;
                    aVal = new Date(aYear, parseInt(aParts[0]) - 1, parseInt(aParts[1]));
                }
                if (bVal === 'N/A') bVal = new Date(0);
                else {
                    const bParts = bVal.split('/');
                    let bYear = parseInt(bParts[2]);
                    if (bYear < 100) bYear += bYear < 50 ? 2000 : 1900;
                    bVal = new Date(bYear, parseInt(bParts[0]) - 1, parseInt(bParts[1]));
                }
                return direction === 'asc' ? aVal - bVal : bVal - aVal;
            case 15: // Tax Class
                aVal = String(a.taxClass);
                bVal = String(b.taxClass);
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            case 16: // Occupancy
                aVal = a.occupancy;
                bVal = b.occupancy;
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
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
        // Skip checkbox columns (0 and 1) and weight column (13)
        if (index === 0 || index === 1 || index === 13) return;
        
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
            const targetSize = targetProperty.buildingSQFT;
            const weights = included.map(p => {
                const compSize = p.buildingSQFT;
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
            const targetSize = targetProperty.buildingSQFT;
            
            const weights = included.map(p => {
                let weight = 1.0;
                
                // Price factor
                if (totalPrice > 0) weight *= (p.adjustedSalePrice / totalPrice) * included.length;
                
                // Size similarity factor
                const compSize = p.buildingSQFT;
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
            prop.buildingPriceSQFT = calculateBuildingPriceSQFT(prop.adjustedSalePrice, prop.buildingSQFT);
            prop.totalPriceSQFT = calculateTotalPriceSQFT(prop.adjustedSalePrice, prop.propertySQFT, prop.buildingSQFT, prop.buildingWidthFeet, prop.buildingDepthFeet);
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
            const targetSize = targetProperty.buildingSQFT;
            const weights = included.map(p => {
                const compSize = p.buildingSQFT;
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
            const targetSize = targetProperty.buildingSQFT;
            
            const weights = included.map(p => {
                let weight = 1.0;
                
                // Price factor
                if (totalPrice > 0) weight *= (p.adjustedSalePrice / totalPrice) * included.length;
                
                // Size similarity factor
                const compSize = p.buildingSQFT;
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
    const targetBuildingSQFTWithFloors = targetProperty.buildingSQFT;
    
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
        const targetSize = targetProperty.buildingSQFT;
        const targetTotalSize = targetProperty.propertySQFT + targetProperty.buildingSQFT;
        
        // Calculate all weight arrays
        const sizeWeights = included.map(p => {
            const compSize = p.buildingSQFT;
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
        <div class="estimate-box minimized">
            <h4>Method A: Building-Based</h4>
            <div class="estimate-value">${formatCurrency(estimateAMedian)}</div>
            <div class="average-count" style="margin-top: 5px;">${formatNumber(targetBuildingSQFTWithFloors, 2)} SQFT × ${formatCurrency(medianBuildingPriceSQFT)}</div>
        </div>
        <div class="estimate-box minimized">
            <h4>Method B: Total Property-Based</h4>
            <div class="estimate-value">${formatCurrency(estimateBMedian)}</div>
            <div class="average-count" style="margin-top: 5px;">(${formatNumber(targetProperty.propertySQFT, 2)} + ${formatNumber(targetProperty.buildingSQFT, 2)}) SQFT × ${formatCurrency(medianTotalPriceSQFT)}</div>
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
            const targetSize = targetProperty.buildingSQFT;
            const compSize = directCompProp.buildingSQFT;
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
        <div class="estimate-box minimized">
            <h4>Direct Comp Sale Price</h4>
            <div class="estimate-value">${formatCurrency(directCompValue)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompAddress}</div>
        </div>
        <div class="estimate-box minimized">
            <h4>Direct Comp Building-Based</h4>
            <div class="estimate-value">${formatCurrency(directCompEstimate)}</div>
            <div class="average-count" style="margin-top: 5px;">${directCompProp ? formatCurrency(directCompBuildingPriceSQFT) + ' × (' + targetProperty.floors + ' floors × ' + formatNumber(targetProperty.buildingWidthFeet, 2) + ' × ' + formatNumber(targetProperty.buildingDepthFeet, 2) + ')' : 'No comp selected'}</div>
        </div>
        <div class="estimate-box minimized">
            <h4>Direct Comp Total-Based</h4>
            <div class="estimate-value">${formatCurrency(directCompTotalEstimate)}</div>
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
    renderComparables(); // Update comparable properties with new weights and high-influence badges
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
    const targetSize = targetProperty.floors * (targetProperty.buildingWidthFeet * targetProperty.buildingDepthFeet);
    const targetTotalSize = targetProperty.propertySQFT + targetProperty.buildingSQFT;
    
    let weights = [];
    
    if (weightingMethod === 'simple') {
        weights = included.map(() => 100 / included.length);
    } else if (weightingMethod === 'price') {
        weights = included.map(p => (p.adjustedSalePrice / totalPrice) * 100);
    } else if (weightingMethod === 'size') {
        const sizeWeights = included.map(p => {
            const compSize = p.floors * (p.buildingWidthFeet * p.buildingDepthFeet);
            const sizeDiff = Math.abs(compSize - targetSize);
            return 1 / (1 + sizeDiff / targetSize);
        });
        const totalSizeWeight = sizeWeights.reduce((sum, w) => sum + w, 0);
        weights = sizeWeights.map(w => (w / totalSizeWeight) * 100);
    } else if (weightingMethod === 'total-size') {
        const totalSizeWeights = included.map(p => {
            const compTotalSize = p.propertySQFT + p.buildingSQFT;
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
        const exponentialPrice = Math.pow(normalizedPrice, 2.0);
        
        // Use price as the base intensity (determines position in gradient = color)
        // Then multiply by weight to adjust brightness (high weight = more visible)
        // This way: expensive properties are green, cheap are red (value zones preserved)
        // And high-influence areas are brighter, low-influence are dimmer
        const colorPosition = exponentialPrice; // 0 = red (cheap), 1 = green (expensive)
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
            combinedLayer._initCanvas = function() {
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
        // Apply exponential transformation for sharper falloff
        const exponentialIntensity = Math.pow(normalizedIntensity, 2.0);
        const weight = exponentialIntensity;
        
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
            valueZonesLayer._initCanvas = function() {
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
