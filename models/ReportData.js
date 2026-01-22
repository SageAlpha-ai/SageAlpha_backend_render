const mongoose = require('mongoose');

/**
 * ReportData Schema
 * Stores structured numerical data extracted from LLM-generated equity research reports.
 * This allows reuse of parsed data without re-parsing report text.
 */
const ReportDataSchema = new mongoose.Schema({
  // Reference to the reports collection
  report_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Report',
    required: true,
    index: true,
    unique: true // Ensure ONE report_id maps to ONE reportData document
  },
  
  // Company information
  company_name: {
    type: String,
    required: true,
    index: true
  },
  
  // REQUIRED FIELDS
  rating: {
    type: String,
    required: true,
    enum: ['OVERWEIGHT', 'BUY', 'NEUTRAL', 'UNDERWEIGHT', 'SELL', 'HOLD'],
    default: 'NEUTRAL'
  },
  target_price: {
    type: Number,
    required: true
  },
  current_price: {
    type: Number,
    required: true
  },
  upside_percent: {
    type: Number,
    required: true
  },
  
  // VALUATION METRICS
  market_cap: {
    type: Number,
    default: null
  },
  enterprise_value: {
    type: Number,
    default: null
  },
  valuation: {
    type: mongoose.Schema.Types.Mixed, // Can be String (e.g., "N/A") or Number
    default: null
  },
  
  // FINANCIAL SUMMARY (YEARLY)
  revenue_2024: {
    type: Number,
    default: null
  },
  revenue_2025: {
    type: Number,
    default: null
  },
  revenue_2026: {
    type: Number,
    default: null
  },
  ebitda_2024: {
    type: Number,
    default: null
  },
  ebitda_2025: {
    type: Number,
    default: null
  },
  ebitda_2026: {
    type: Number,
    default: null
  },
  eps_2024: {
    type: Number,
    default: null
  },
  eps_2025: {
    type: Number,
    default: null
  },
  eps_2026: {
    type: Number,
    default: null
  },
  
  // METADATA
  created_at: {
    type: Date,
    default: () => new Date()
  },
  updated_at: {
    type: Date,
    default: () => new Date()
  }
}, {
  timestamps: false // We're handling timestamps manually
});

// Update updated_at before saving
ReportDataSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Indexes are defined in the schema fields above (report_id, company_name)

module.exports = mongoose.models.ReportData || mongoose.model('ReportData', ReportDataSchema);

