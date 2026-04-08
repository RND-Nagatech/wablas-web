const mongoose = require('mongoose');

const waAuthStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    creds: { type: Object, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('WaAuthState', waAuthStateSchema);
