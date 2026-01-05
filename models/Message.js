const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  session_id: { type: String, required: true, index: true },
  role: { type: String, required: true },
  content: { type: String, required: true },
  meta_json: { type: String }
}, { timestamps: { createdAt: 'timestamp' } });

module.exports = mongoose.models.Message || mongoose.model('Message', MessageSchema);
