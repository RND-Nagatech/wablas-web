const mongoose = require('mongoose');

const waAuthKeySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, index: true },
    keyId: { type: String, required: true, index: true },
    value: { type: Object, default: null }
  },
  { timestamps: true }
);

waAuthKeySchema.index({ userId: 1, type: 1, keyId: 1 }, { unique: true });

module.exports = mongoose.model('WaAuthKey', waAuthKeySchema);

