const mongoose = require('mongoose');

const ReportDeliverySchema = new mongoose.Schema({
  subscriber_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscriber', index: true },
  report_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', index: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }
}, { timestamps: { createdAt: 'sent_at' } });

module.exports = mongoose.models.ReportDelivery || mongoose.model('ReportDelivery', ReportDeliverySchema);
