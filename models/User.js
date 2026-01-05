const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  display_name: String,
  password_hash: { type: String, required: true },
  email: { type: String, index: true, unique: true },
  is_active: { type: Boolean, default: true },
  is_waitlist: { type: Boolean, default: false },
  otp_code: { type: String, default: null },
otp_expires: { type: Date, default: null }

}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
