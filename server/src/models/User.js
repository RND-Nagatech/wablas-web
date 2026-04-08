const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  apiKey: {
    type: String,
    required: true,
    unique: true
  },
  refreshToken: {
    type: String,
    default: null
  },
  waStatus: {
    type: String,
    enum: ['disconnected', 'connecting', 'qr_ready', 'authorizing', 'connected'],
    default: 'disconnected'
  },
  waLastError: {
    type: String,
    default: null
  },
  waLastStatusAt: {
    type: Date,
    default: null
  },
  waPhone: {
    type: String,
    default: null
  },
  waJid: {
    type: String,
    default: null
  },
  waAuthPath: {
    type: String,
    default: null
  },
  waQr: {
    type: String,
    default: null
  },
  waQrCreatedAt: {
    type: Date,
    default: null
  },
  connectedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
