const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: function() { return !this.googleId; }, unique: true, sparse: true, index: true },
  display_name: String,
  password_hash: { type: String, required: function() { return !this.googleId; }, default: null },
  email: { type: String, index: true, unique: true },
  googleId: { type: String, unique: true, sparse: true, index: true },
  avatar: { type: String, default: null },
  authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
  is_active: { type: Boolean, default: true },
  is_waitlist: { type: Boolean, default: false },
  otp_code: { type: String, default: null },
  otp_expires: { type: Date, default: null },
  subscription: { type: String, enum: ['FREE', 'PLUS', 'PRO'], default: 'FREE' },
  subscriptionStatus: { type: String, enum: ['active', 'inactive', 'expired'], default: 'active' },
  reportsLimit: { type: Number, default: 5 }

}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
