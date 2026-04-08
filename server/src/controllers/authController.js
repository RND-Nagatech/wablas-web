const User = require('../models/User');
const { generateApiKey } = require('../utils/crypto');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');

const buildTokens = async (user) => {
  const payload = { userId: user._id.toString(), email: user.email };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  user.refreshToken = refreshToken;
  await user.save();
  return { accessToken, refreshToken };
};

exports.register = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(400).json({ success: false, message: 'Email sudah terdaftar' });
  }

  const user = await User.create({
    email,
    password,
    apiKey: generateApiKey()
  });

  const tokens = await buildTokens(user);

  return res.json({
    success: true,
    data: {
      user: { id: user._id, email: user.email, apiKey: user.apiKey },
      ...tokens
    }
  });
};

exports.login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(400).json({ success: false, message: 'Email atau password salah' });
  }

  const match = await user.comparePassword(password);
  if (!match) {
    return res.status(400).json({ success: false, message: 'Email atau password salah' });
  }

  const tokens = await buildTokens(user);

  return res.json({
    success: true,
    data: {
      user: { id: user._id, email: user.email, apiKey: user.apiKey },
      ...tokens
    }
  });
};

exports.refresh = async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'refreshToken wajib diisi' });
  }
  try {
    const payload = verifyRefreshToken(refreshToken);
    const user = await User.findById(payload.userId);
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ success: false, message: 'Refresh token tidak valid' });
    }
    const tokens = await buildTokens(user);
    return res.json({ success: true, data: tokens });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Refresh token tidak valid' });
  }
};

exports.me = async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  }
  return res.json({
    success: true,
    data: {
      id: user._id,
      email: user.email,
      apiKey: user.apiKey,
      waStatus: user.waStatus,
      waPhone: user.waPhone,
      waJid: user.waJid
    }
  });
};
