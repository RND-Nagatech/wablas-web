const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    waChatId: { type: String, required: true },
    isGroup: { type: Boolean, default: false },
    name: { type: String, default: null },
    // Manual override set by the user in the dashboard.
    // When set, UI should prefer displayName over WA-provided name.
    displayName: { type: String, default: null },
    lastMessage: { type: String, default: null },
    lastAt: { type: Date, default: null }
  },
  { timestamps: true }
);

ChatSchema.index({ userId: 1, waChatId: 1 }, { unique: true });

module.exports = mongoose.model('Chat', ChatSchema);
