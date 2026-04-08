const User = require('../models/User');

module.exports = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ success: false, message: 'X-API-KEY header required' });
  }
  const user = await User.findOne({ apiKey });
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }
  req.apiUser = user;
  return next();
};
