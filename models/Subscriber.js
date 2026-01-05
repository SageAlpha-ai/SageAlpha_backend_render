const mongoose = require('mongoose');

const SubscriberSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true },
  mobile: String,
  email: { type: String, required: true },
  risk_profile: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  is_active: { type: Boolean, default: true }
}, { timestamps: { createdAt: 'created_at' } });

module.exports = mongoose.models.Subscriber || mongoose.model('Subscriber', SubscriberSchema);
