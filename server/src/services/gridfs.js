const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

let bucket = null;

const getBucket = () => {
  if (!mongoose.connection?.db) {
    throw new Error('MongoDB not connected');
  }
  if (!bucket) {
    bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'media' });
  }
  return bucket;
};

module.exports = { getBucket };

