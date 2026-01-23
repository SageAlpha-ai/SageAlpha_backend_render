const mongoose = require('mongoose');

const SharedChatSchema = new mongoose.Schema({
  shareId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true
  },
  originalChatId: { 
    type: String, 
    required: true, 
    index: true 
  },
  messages: [{
    role: { type: String, required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  model: { 
    type: String, 
    default: 'gpt-4' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  expiresAt: { 
    type: Date,
    default: () => {
      // Default expiration: 30 days from now
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      return expiry;
    }
  }
}, { timestamps: false });

// Index for expiration cleanup
SharedChatSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.SharedChat || mongoose.model('SharedChat', SharedChatSchema);

