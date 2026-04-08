const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  type: { type: String, default: null },
  url: { type: String, default: null },
  path: { type: String, default: null }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  text: { type: String, default: null },
  media: { type: mediaSchema, default: () => ({}) },
  waMessageId: { type: String, default: null },
  waChatId: { type: String, default: null },
  waFromMe: { type: Boolean, default: null },
  timestamp: { type: Number, default: null }
}, {
  timestamps: true
});

messageSchema.index({ userId: 1, waChatId: 1, createdAt: -1 });
messageSchema.index({ userId: 1, createdAt: -1 });
// Prevent duplicates when a sent message is recorded both from API send + Baileys upsert.
messageSchema.index({ userId: 1, waMessageId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Message', messageSchema);
