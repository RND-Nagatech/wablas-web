const WhatsAppManager = require('../services/whatsappManager');
const User = require('../models/User');

exports.status = async (req, res) => {
  const user = await User.findById(req.user.userId);
  return res.json({
    success: true,
    data: {
      waStatus: user?.waStatus || 'disconnected',
      waPhone: user?.waPhone || null,
      waJid: user?.waJid || null,
      waLastError: user?.waLastError || null,
      waLastStatusAt: user?.waLastStatusAt || null,
      waQrCreatedAt: user?.waQrCreatedAt || null
    }
  });
};

exports.connect = async (req, res) => {
  const forceReconnect = req.query.force === '1' || req.query.force === 'true';
  await WhatsAppManager.connect(req.user.userId, { forceReconnect });
  return res.json({ success: true, message: 'Connecting WhatsApp' });
};

exports.qr = async (req, res) => {
  const user = await User.findById(req.user.userId);
  const qr = WhatsAppManager.getQr(req.user.userId) || user?.waQr || null;
  if (!qr) {
    return res.status(404).json({ success: false, message: 'QR belum tersedia' });
  }
  return res.json({
    success: true,
    data: {
      qr,
      waQrCreatedAt: user?.waQrCreatedAt || null
    }
  });
};

exports.disconnect = async (req, res) => {
  await WhatsAppManager.disconnect(req.user.userId);
  return res.json({ success: true, message: 'Disconnected' });
};

exports.reset = async (req, res) => {
  await WhatsAppManager.reset(req.user.userId);
  return res.json({ success: true, message: 'WhatsApp session reset' });
};
