const mongoose = require('mongoose');

const ChatSessionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  title: { type: String, default: 'New chat' },
  current_topic: { type: String, default: '' }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.models.ChatSession || mongoose.model('ChatSession', ChatSessionSchema);
