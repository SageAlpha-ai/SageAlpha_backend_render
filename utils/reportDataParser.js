/**
 * Report Data Parser Utility
 * 
 * Extracts and normalizes numeric values from LLM-generated equity research reports.
 * Handles currency symbols, percentages, and "N/A" values safely.
 */

/**
 * Normalize a numeric string by removing currency symbols, commas, and spaces
 * @param {string|number} value - The value to normalize
 * @returns {number|null} - Parsed number or null if invalid
 */
function normalizeNumeric(value) {
  if (value === null || value === undefined) return null;
  
  // If already a number, return it
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }
  
  // If not a string, return null
  if (typeof value !== 'string') return null;
  
  // Handle "N/A", "NA", "n/a", etc.
  const naPattern = /^(n\/a|na|not available|not applicable)$/i;
  if (naPattern.test(value.trim())) return null;
  
  // Remove currency symbols (INR, $, ₹, USD, etc.), commas, spaces, and any non-numeric characters except decimal point and minus sign
  const cleaned = value
    .replace(/[INR$₹USD,\s]/gi, '')
    .replace(/[^\d.-]/g, '')
    .trim();
  
  if (!cleaned) return null;
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Normalize percentage string to number
 * @param {string|number} value - Percentage value (e.g., "+25%", "25%", 25)
 * @returns {number|null} - Parsed percentage as number (e.g., 25) or null
 */
function normalizePercentage(value) {
  if (value === null || value === undefined) return null;
  
  // If already a number, return it
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }
  
  if (typeof value !== 'string') return null;
  
  // Handle "N/A", "NA", etc.
  const naPattern = /^(n\/a|na|not available|not applicable)$/i;
  if (naPattern.test(value.trim())) return null;
  
  // Remove +, %, spaces, and parse
  const cleaned = value.replace(/[+%\s]/g, '').trim();
  if (!cleaned) return null;
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Extract rating from reportData
 * @param {object} reportData - The report data object
 * @returns {string} - Normalized rating (default: 'NEUTRAL')
 */
function extractRating(reportData) {
  if (!reportData || !reportData.rating) return 'NEUTRAL';
  
  const rating = reportData.rating.toUpperCase().trim();
  const validRatings = ['OVERWEIGHT', 'BUY', 'NEUTRAL', 'UNDERWEIGHT', 'SELL', 'HOLD'];
  
  // Check for exact match
  if (validRatings.includes(rating)) return rating;
  
  // Handle variations
  if (rating.includes('OVERWEIGHT') || rating.includes('OVER')) return 'OVERWEIGHT';
  if (rating.includes('BUY')) return 'BUY';
  if (rating.includes('SELL')) return 'SELL';
  if (rating.includes('UNDERWEIGHT') || rating.includes('UNDER')) return 'UNDERWEIGHT';
  if (rating.includes('HOLD')) return 'HOLD';
  
  return 'NEUTRAL';
}

/**
 * Extract financial summary data for a specific year
 * @param {array} financialSummary - Array of financial summary objects
 * @param {string} yearSuffix - Year suffix (e.g., "2024A", "2025E", "2026E")
 * @returns {object} - Object with revenue, ebitda, eps
 */
function extractFinancialYearData(financialSummary, yearSuffix) {
  if (!Array.isArray(financialSummary) || financialSummary.length === 0) {
    return { revenue: null, ebitda: null, eps: null };
  }
  
  const yearData = financialSummary.find(item => item.year === yearSuffix);
  if (!yearData) return { revenue: null, ebitda: null, eps: null };
  
  return {
    revenue: normalizeNumeric(yearData.rev),
    ebitda: normalizeNumeric(yearData.ebitda),
    eps: normalizeNumeric(yearData.eps)
  };
}

/**
 * Calculate upside percentage from current and target price
 * @param {number|null} currentPrice - Current price
 * @param {number|null} targetPrice - Target price
 * @returns {number|null} - Upside percentage or null
 */
function calculateUpsidePercent(currentPrice, targetPrice) {
  if (!currentPrice || !targetPrice || currentPrice === 0) return null;
  
  const upside = ((targetPrice - currentPrice) / currentPrice) * 100;
  return Math.round(upside * 100) / 100; // Round to 2 decimal places
}

/**
 * Parse and extract structured data from LLM reportData
 * @param {object} reportData - The report data object from LLM
 * @param {string} companyName - Company name
 * @returns {object|null} - Parsed data object ready for database or null if parsing fails
 */
function parseReportData(reportData, companyName) {
  if (!reportData || typeof reportData !== 'object') {
    console.error('[ReportData] Invalid reportData provided for parsing');
    return null;
  }
  
  try {
    // Extract required fields
    const currentPrice = normalizeNumeric(reportData.currentPrice);
    const targetPrice = normalizeNumeric(reportData.targetPrice);
    
    // Validate required fields
    if (currentPrice === null || targetPrice === null) {
      console.warn('[ReportData] Missing required price data. Current:', currentPrice, 'Target:', targetPrice);
      // Still proceed but log warning
    }
    
    // Extract upside - prefer from reportData, otherwise calculate
    let upsidePercent = normalizePercentage(reportData.upside);
    if (upsidePercent === null && currentPrice !== null && targetPrice !== null) {
      upsidePercent = calculateUpsidePercent(currentPrice, targetPrice);
    }
    
    // Extract rating
    const rating = extractRating(reportData);
    
    // Extract valuation metrics
    const marketCap = normalizeNumeric(reportData.marketCap);
    const enterpriseValue = normalizeNumeric(reportData.entValue);
    
    // Handle valuation field (can be string "N/A" or number)
    let valuation = null;
    if (reportData.valuation !== undefined && reportData.valuation !== null) {
      if (typeof reportData.valuation === 'string' && /^(n\/a|na|not available)$/i.test(reportData.valuation.trim())) {
        valuation = 'N/A';
      } else {
        valuation = normalizeNumeric(reportData.valuation);
      }
    }
    
    // Extract financial summary data
    const financialSummary = reportData.financialSummary || [];
    const fy2024 = extractFinancialYearData(financialSummary, '2024A');
    const fy2025 = extractFinancialYearData(financialSummary, '2025E');
    const fy2026 = extractFinancialYearData(financialSummary, '2026E');
    
    // Build parsed data object
    const parsedData = {
      company_name: companyName || reportData.companyName || 'Unknown',
      rating: rating,
      target_price: targetPrice,
      current_price: currentPrice,
      upside_percent: upsidePercent,
      market_cap: marketCap,
      enterprise_value: enterpriseValue,
      valuation: valuation,
      revenue_2024: fy2024.revenue,
      revenue_2025: fy2025.revenue,
      revenue_2026: fy2026.revenue,
      ebitda_2024: fy2024.ebitda,
      ebitda_2025: fy2025.ebitda,
      ebitda_2026: fy2026.ebitda,
      eps_2024: fy2024.eps,
      eps_2025: fy2025.eps,
      eps_2026: fy2026.eps
    };
    
    return parsedData;
  } catch (error) {
    console.error('[ReportData] Error parsing reportData:', error);
    return null;
  }
}

module.exports = {
  parseReportData,
  normalizeNumeric,
  normalizePercentage,
  extractRating,
  extractFinancialYearData,
  calculateUpsidePercent
};

