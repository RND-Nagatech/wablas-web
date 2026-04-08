const mongoose = require('mongoose');
const { getBucket } = require('../services/gridfs');

exports.getMedia = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).send('Bad request');

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).send('Bad request');
    }
    const objectId = new mongoose.Types.ObjectId(id);
    const bucket = getBucket();

    const files = await bucket.find({ _id: objectId }).toArray();
    if (!files.length) return res.status(404).send('Not found');

    const file = files[0];
    const ownerId = file?.metadata?.userId || null;
    if (!ownerId) return res.status(403).send('Forbidden');
    if (String(ownerId) !== String(req.user?.userId || '')) {
      return res.status(403).send('Forbidden');
    }

    if (file.contentType) {
      res.setHeader('Content-Type', file.contentType);
    }
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    const ct = String(file.contentType || '').toLowerCase();
    if (ct.startsWith('image/') || ct.startsWith('video/')) {
      res.setHeader('Content-Disposition', 'inline');
    }

    const stream = bucket.openDownloadStream(objectId);
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (err) {
    res.status(400).send('Bad request');
  }
};
