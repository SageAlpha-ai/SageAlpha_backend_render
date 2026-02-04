const mongoose = require('mongoose');

/**e
 * PortfolioItem
 *
 * IMPORTANT:
 * - `symbol` (NSE trading symbol, uppercase) is the SINGLE SOURCE OF TRUTH for stocks.
 * - Alert / AI agents downstream only understand NSE symbols, not free-form company names.
 * - Always resolve and persist the canonical NSE symbol at WRITE TIME.
 *   Never try to infer or "re-derive" the symbol from company_name later.
 */
const PortfolioItemSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    company_name: {
      type: String,
      required: true,
    },
    symbol: {
      type: String,
      required: true,   // Canonical NSE symbol used by Alert AI Agent
      uppercase: true,  // Always store as uppercase for consistent lookups
      index: true,
    },
    source_type: {
      type: String,
      default: 'chat',
    },
    item_date: {
      type: Date,
      default: () => new Date(),
    },
    approved: {
      type: Boolean,
      default: false,
      index: true, // Index for efficient filtering in Performance Dashboard
    },
    approved_at: {
      type: Date,
      default: null,
    },
  },
  {
    // Use snake_case timestamps to match existing schema conventions
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports =
  mongoose.models.PortfolioItem ||
  mongoose.model('PortfolioItem', PortfolioItemSchema);
