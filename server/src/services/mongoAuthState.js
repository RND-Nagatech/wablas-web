const WaAuthState = require('../models/WaAuthState');
const WaAuthKey = require('../models/WaAuthKey');

let baileysModule = null;
const loadBaileys = async () => {
  if (!baileysModule) {
    baileysModule = await import('@whiskeysockets/baileys');
  }
  return baileysModule;
};

const useMongoAuthState = async (userId) => {
  const id = userId.toString();
  const { initAuthCreds, BufferJSON } = await loadBaileys();

  // IMPORTANT:
  // - `toDb` serializes Buffers/Uint8Arrays into JSON-safe values using BufferJSON.replacer.
  // - `fromDb` revives those JSON-safe values back into Buffers/Uint8Arrays using BufferJSON.reviver.
  // If we store revived values in Mongo, some fields can degrade into strings and break crypto keys
  // (e.g. "Invalid private key type: String").
  const toDb = (value) => {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
  };

  const fromDb = (value) => {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
  };

  let stateDoc = await WaAuthState.findOne({ userId: id });
  if (!stateDoc) {
    stateDoc = await WaAuthState.create({ userId: id, creds: toDb(initAuthCreds()) });
  }

  let creds = fromDb(stateDoc.creds);

  const getKeys = async (type, ids) => {
    const docs = await WaAuthKey.find({ userId: id, type, keyId: { $in: ids } });
    const map = {};
    for (const doc of docs) {
      if (doc.value != null) {
        map[doc.keyId] = fromDb(doc.value);
      }
    }
    return map;
  };

  const setKeys = async (data) => {
    const ops = [];
    for (const type of Object.keys(data || {})) {
      const entries = data[type] || {};
      for (const keyId of Object.keys(entries)) {
        const value = entries[keyId];
        if (value === null) {
          ops.push({ deleteOne: { filter: { userId: id, type, keyId } } });
        } else {
          ops.push({
            updateOne: {
              filter: { userId: id, type, keyId },
              update: { $set: { value: toDb(value) } },
              upsert: true
            }
          });
        }
      }
    }
    if (ops.length) await WaAuthKey.bulkWrite(ops, { ordered: false });
  };

  return {
    state: {
      creds,
      keys: { get: getKeys, set: setKeys }
    },
    saveCreds: async () => {
      await WaAuthState.updateOne({ userId: id }, { $set: { creds: toDb(creds) } });
    },
    clear: async () => {
      await WaAuthState.deleteOne({ userId: id });
      await WaAuthKey.deleteMany({ userId: id });
    }
  };
};

module.exports = { useMongoAuthState };
