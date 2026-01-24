const axios = require("axios");

const MARKET_CHATTER_AI_BASE_URL = process.env.MARKET_CHATTER_AI_BASE_URL || "https://market-chatter-ai-ebg9bnfjcte9f6ds.centralus-01.azurewebsites.net";
const REQUEST_TIMEOUT = 20000; // 20 seconds

/**
 * Fetches market chatter analysis from the external Market Chatter AI service.
 * 
 * @param {Object} params - Parameters for the market chatter query
 * @param {string} params.query - Search query (required) - e.g., "Wipro", "AAPL", etc.
 * @param {number} [params.lookbackHours=24] - Hours to look back (optional, default: 24)
 * @param {number} [params.maxResults=20] - Maximum number of results (optional, default: 20)
 * @returns {Promise<Object>} Raw JSON response from the Market Chatter AI service
 * @throws {Error} If query is missing or service call fails
 */
async function fetchMarketChatter({ query, lookbackHours = 24, maxResults = 20 }) {
  // Validate required input
  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new Error("Query is required and must be a non-empty string");
  }

  // Validate optional parameters
  if (lookbackHours !== undefined && (typeof lookbackHours !== 'number' || lookbackHours < 0)) {
    throw new Error("lookbackHours must be a non-negative number");
  }

  if (maxResults !== undefined && (typeof maxResults !== 'number' || maxResults < 1)) {
    throw new Error("maxResults must be a positive number");
  }

  const startTime = Date.now();

  try {
    console.log(`[MarketChatter] Request started for query: ${query.trim()}`);

    const response = await axios.post(
      `${MARKET_CHATTER_AI_BASE_URL}/api/v1/market-chatter`,
      {
        query: query.trim(),
        lookback_hours: lookbackHours,
        max_results: maxResults
      },
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    const latency = Date.now() - startTime;
    console.log(`[MarketChatter] Request success for query: ${query.trim()} (latency: ${latency}ms)`);

    // Return raw response data without transformation
    return response.data;
  } catch (error) {
    const latency = Date.now() - startTime;
    
    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const errorMessage = error.response.data?.message || error.response.data?.error || error.message;
      console.error(`[MarketChatter] Request failed for query: ${query.trim()} (latency: ${latency}ms) - Status: ${status}, Error: ${errorMessage}`);
      throw new Error(`Market Chatter AI service error: ${status} - ${errorMessage}`);
    } else if (error.request) {
      // Request made but no response received (network/timeout)
      console.error(`[MarketChatter] Request failed for query: ${query.trim()} (latency: ${latency}ms) - No response received`);
      throw new Error("No response from Market Chatter AI service. The service may be unavailable or timed out.");
    } else if (error.code === 'ECONNABORTED') {
      // Timeout error
      console.error(`[MarketChatter] Request failed for query: ${query.trim()} (latency: ${latency}ms) - Timeout`);
      throw new Error("Request to Market Chatter AI service timed out. Please try again.");
    } else {
      // Other errors (setup, etc.)
      console.error(`[MarketChatter] Request failed for query: ${query.trim()} (latency: ${latency}ms) - ${error.message}`);
      throw new Error(`Failed to fetch market chatter: ${error.message}`);
    }
  }
}

module.exports = {
  fetchMarketChatter
};

