const mongoose = require('mongoose');

const UsageLimitSchema = new mongoose.Schema({
  // User identifier: userId (ObjectId) for authenticated users, or IP/demoId (String) for demo users
  identifier: {
    type: String,
    required: true,
    index: true
  },
  // Type of identifier: 'user' for authenticated users, 'demo' for demo users
  identifierType: {
    type: String,
    enum: ['user', 'demo'],
    required: true,
    index: true
  },
  // AI tool type: 'chat', 'compliance', 'market', 'defender'
  aiType: {
    type: String,
    enum: ['chat', 'compliance', 'market', 'defender'],
    required: true,
    index: true
  },
  // Current usage count
  usageCount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Last used timestamp
  lastUsedAt: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Compound index for efficient lookups
UsageLimitSchema.index({ identifier: 1, identifierType: 1, aiType: 1 }, { unique: true });

module.exports = mongoose.models.UsageLimit || mongoose.model('UsageLimit', UsageLimitSchema);
