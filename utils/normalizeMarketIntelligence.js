/**
 * Normalize the raw agentic AI response into a frontend-friendly structure
 * @param {Object} rawResponse - Raw response from the agentic AI service
 * @returns {Object} Normalized intelligence object
 */
function normalizeMarketIntelligence(rawResponse) {
  if (!rawResponse || !rawResponse.data) {
    throw new Error("Invalid response format from agentic AI service");
  }

  const data = rawResponse.data;

  // Parse bull_case and bear_case JSON strings safely
  let bullCase = null;
  let bearCase = null;

  try {
    if (data.bull_case && typeof data.bull_case === 'string') {
      bullCase = JSON.parse(data.bull_case);
    } else if (data.bull_case && typeof data.bull_case === 'object') {
      bullCase = data.bull_case;
    }
  } catch (e) {
    console.warn("[Normalize] Failed to parse bull_case:", e.message);
    bullCase = {
      summary: data.bull_case || "No bull case data available",
      key_signals: [],
      data_quality: {}
    };
  }

  try {
    if (data.bear_case && typeof data.bear_case === 'string') {
      bearCase = JSON.parse(data.bear_case);
    } else if (data.bear_case && typeof data.bear_case === 'object') {
      bearCase = data.bear_case;
    }
  } catch (e) {
    console.warn("[Normalize] Failed to parse bear_case:", e.message);
    bearCase = {
      summary: data.bear_case || "No bear case data available",
      key_risks: [],
      data_quality: {}
    };
  }

  // Extract risk assessment for the user's risk profile
  // Default to moderate_risk_subscriber_view if available, otherwise use overall_risk
  const riskAssessment = data.risk_assessment || {};
  const overallRisk = riskAssessment.overall_risk || "UNKNOWN";
  
  // Determine suitability based on risk profile (will be matched in the route handler)
  let suitability = {
    isMatch: true,
    explanation: "Risk assessment completed",
    warning: null
  };

  // If we have risk profile views, we'll use the appropriate one (matched in route handler)
  // For now, use the overall risk
  if (riskAssessment.moderate_risk_subscriber_view) {
    suitability = {
      isMatch: riskAssessment.moderate_risk_subscriber_view.is_match !== false,
      explanation: riskAssessment.moderate_risk_subscriber_view.explanation || "",
      warning: riskAssessment.moderate_risk_subscriber_view.warning || null
    };
  }

  // Normalize data quality information
  const financialMetrics = data.latest_financial_metrics || {};
  const dataQuality = {
    financialsAvailable: financialMetrics.available === true,
    reason: financialMetrics.reason || "Financial data status unknown",
    details: financialMetrics.details || "",
    suggestions: financialMetrics.suggestions || []
  };

  // Build normalized structure
  const normalized = {
    ticker: data.ticker || "",
    analysisDate: data.analysis_date || new Date().toISOString().split('T')[0],
    sentiment: {
      score: data.sentiment_score !== undefined ? data.sentiment_score : 0.0,
      label: data.sentiment_label || "neutral",
      summary: data.market_chatter_summary || "No market chatter summary available"
    },
    bullCase: {
      summary: bullCase?.summary || "No bull case data available",
      signals: bullCase?.key_signals || [],
      dataQuality: bullCase?.data_quality || {}
    },
    bearCase: {
      summary: bearCase?.summary || "No bear case data available",
      risks: bearCase?.key_risks || [],
      dataQuality: bearCase?.data_quality || ""
    },
    riskAssessment: {
      overallRisk: overallRisk,
      suitability: suitability,
      // Keep full risk assessment object for future use
      fullAssessment: riskAssessment
    },
    dataQuality: dataQuality,
    metadata: {
      processingTimeMs: data.processing_time_ms || 0,
      ingestionTriggered: data.ingestion_triggered === true
    }
  };

  return normalized;
}

module.exports = {
  normalizeMarketIntelligence
};

