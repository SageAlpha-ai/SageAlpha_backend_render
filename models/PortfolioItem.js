const mongoose = require('mongoose');

const PortfolioItemSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  company_name: { type: String, required: true },
  ticker: String,
  source_type: { type: String, default: 'chat' },
  item_date: { type: Date, default: () => new Date() }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.models.PortfolioItem || mongoose.model('PortfolioItem', PortfolioItemSchema);
