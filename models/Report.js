const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  portfolio_item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PortfolioItem', index: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  title: { type: String, required: true },
  status: { type: String, default: 'pending' },
  report_data: String,
  report_path: String,
  report_type: { type: String, default: 'general' },
  report_date: { type: Date, default: () => new Date() },
  approved_at: { type: Date },
  // Price data extracted from report at creation time
  current_price: { type: Number },
  target_price: { type: Number },
  // Prices at the time of approval (captured when report is approved)
  approved_current_price: { type: Number },
  approved_target_price: { type: Number }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.models.Report || mongoose.model('Report', ReportSchema);
