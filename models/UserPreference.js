const mongoose = require('mongoose');

const UserPreferenceSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  communication_style: String,
  language: { type: String, default: 'en' },
  plan: { type: String, default: 'free' },
  preferred_model: String,
  preference_mode: { type: String, default: 'accuracy' }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.models.UserPreference || mongoose.model('UserPreference', UserPreferenceSchema);
