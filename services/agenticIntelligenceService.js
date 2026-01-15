const axios = require("axios");

const AGENTIC_BASE_URL = process.env.AGENTIC_AI_BASE_URL || "https://postgres-host-localhost.onrender.com";

/**
 * Fetch market intelligence from the external agentic AI service
 * @param {Object} params - Parameters for the intelligence query
 * @param {string} params.ticker - Stock ticker symbol (e.g., "AAPL")
 * @param {string} params.riskProfile - Risk profile: "LOW", "MODERATE", or "HIGH"
 * @returns {Promise<Object>} Raw response from the agentic AI service
 */
async function fetchMarketIntelligence({ ticker, riskProfile }) {
  if (!ticker) {
    throw new Error("Ticker is required");
  }

  if (!riskProfile) {
    throw new Error("Risk profile is required");
  }

  // Normalize risk profile to uppercase for the API
  const normalizedRiskProfile = riskProfile.toUpperCase();

  try {
    const response = await axios.post(
      `${AGENTIC_BASE_URL}/api/v1/query`,
      {
        ticker: ticker.toUpperCase(),
        subscriber_risk_profile: normalizedRiskProfile
      },
      {
        timeout: 120000, // 2 minutes timeout
        headers: { 
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error("[AgenticAI] Error fetching market intelligence:", error.message);
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      throw new Error(`Agentic AI service error: ${error.response.status} - ${error.response.data?.message || error.message}`);
    } else if (error.request) {
      // The request was made but no response was received
      throw new Error("No response from agentic AI service. Please try again later.");
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new Error(`Failed to fetch market intelligence: ${error.message}`);
    }
  }
}

module.exports = {
  fetchMarketIntelligence
};

