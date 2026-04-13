const fs = require('fs');
const axios = require('axios');
const mime = require('mime-types');
const mongoose = require('mongoose');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const WhatsAppManager = require('../services/whatsappManager');
const { getBucket } = require('../services/gridfs');

const looksLikePhoneNumber = (digits) => {
  // MVP heuristic: Indonesian numbers typically start with 0 or 62.
  // Group IDs in Baileys often look like long numeric IDs not starting with 0/62.
  return digits.startsWith('0') || digits.startsWith('62');
};

const looksLikeBaileysGroupJidId = (digits) => {
  // Common Baileys group JIDs look like "1203...@g.us" or "<phone>-<id>@g.us".
  // If user only gives digits, accept the "120..." shape, otherwise ask for full waChatId.
  return digits.startsWith('120');
};

const toWaJid = (rawTo) => {
  const to = String(rawTo || '').trim();
  if (!to) return '';

  if (to.endsWith('@g.us') || to.endsWith('@s.whatsapp.net')) return to;

  // Legacy/alternate group IDs sometimes contain a dash.
  if (to.includes('-')) return `${to}@g.us`;

  // Normalize a bit for phone inputs like +62xxx or "62 xxx"
  const digits = to.replace(/[^\d]/g, '');
  if (!digits) return `${to}@s.whatsapp.net`;

  // If it doesn't look like a phone number, treat as group id.
  if (!looksLikePhoneNumber(digits)) {
    if (!looksLikeBaileysGroupJidId(digits)) return '';
    return `${digits}@g.us`;
  }

  // Normalize local format (08xx...) -> international (628xx...)
  const normalizedPhone = digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
  return `${normalizedPhone}@s.whatsapp.net`;
};

const resolveMedia = async (mediaUrl) => {
  const baseUrl = process.env.BASE_URL || '';
  if (mediaUrl.startsWith(baseUrl)) {
    mediaUrl = mediaUrl.replace(baseUrl, '');
  }

  if (mediaUrl.startsWith('/api/media/')) {
    mediaUrl = mediaUrl.replace('/api/media/', '/media/');
  }

  if (mediaUrl.startsWith('/media/')) {
    const id = mediaUrl.replace('/media/', '').trim();
    const objectId = new mongoose.Types.ObjectId(id);
    const bucket = getBucket();
    const files = await bucket.find({ _id: objectId }).toArray();
    if (!files.length) throw new Error('media tidak ditemukan');
    const file = files[0];
    const chunks = [];
    await new Promise((resolve, reject) => {
      const stream = bucket.openDownloadStream(objectId);
      stream.on('data', (d) => chunks.push(d));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const buffer = Buffer.concat(chunks);
    const contentType = file.contentType || file.metadata?.contentType || 'application/octet-stream';
    return { buffer, mimetype: contentType, filePath: null };
  }

  if (mediaUrl.startsWith('http')) {
    const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'] || mime.lookup(mediaUrl) || 'application/octet-stream';
    return { buffer: Buffer.from(response.data), mimetype: contentType, filePath: null };
  }

  throw new Error('media_url tidak valid');
};

exports.sendText = async (req, res) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) {
      return res.status(400).json({ success: false, message: 'to dan text wajib diisi' });
    }
    const socket = WhatsAppManager.getSocket(req.apiUser._id);
    if (!socket) {
      return res.status(400).json({ success: false, message: 'WhatsApp belum terhubung' });
    }

    const jid = toWaJid(String(to));
    if (!jid) {
      return res.status(400).json({
        success: false,
        message: 'Tujuan tidak valid. Untuk grup, gunakan waChatId dari menu History (contoh: 1203...@g.us).'
      });
    }

    const sent = await socket.sendMessage(jid, { text });

    const waMessageId = sent?.key?.id || null;
    const timestamp = sent?.messageTimestamp ? Number(sent.messageTimestamp) : null;
    const filter = waMessageId ? { userId: req.apiUser._id, waMessageId } : { userId: req.apiUser._id, waChatId: jid, timestamp, text };
    await Message.updateOne(
      filter,
      {
        $set: {
          direction: 'outbound',
          text,
          waChatId: jid,
          waFromMe: true,
          timestamp
        },
        $setOnInsert: {
          userId: req.apiUser._id,
          media: {},
          waMessageId
        }
      },
      { upsert: true }
    ).catch(() => {});

    await Chat.updateOne(
      { userId: req.apiUser._id, waChatId: jid },
      {
        $set: {
          isGroup: jid.endsWith('@g.us'),
          lastMessage: text || null,
          lastAt: timestamp ? new Date(timestamp * 1000) : new Date()
        },
        $setOnInsert: { userId: req.apiUser._id, waChatId: jid }
      },
      { upsert: true }
    ).catch(() => {});

    return res.json({
      success: true,
      data: {
        to: jid,
      waMessageId: waMessageId
    }
  });
  } catch (err) {
    const msg = err?.message || 'Gagal kirim pesan';
    // Group ID issues often surface while fetching group metadata
    if (/groupMetadata|not in group|forbidden|401|403|404|jid/i.test(msg)) {
      return res.status(400).json({
        success: false,
        message: 'Gagal kirim. Jika ini grup, pastikan kamu memakai waChatId grup dari History (akhiran @g.us) dan akun WA kamu adalah member grup itu.'
      });
    }
    return res.status(500).json({ success: false, message: msg });
  }
};

exports.sendMedia = async (req, res) => {
  try {
    const { to, text, media_url: mediaUrl } = req.body || {};
    if (!to || !mediaUrl) {
      return res.status(400).json({ success: false, message: 'to dan media_url wajib diisi' });
    }
    const socket = WhatsAppManager.getSocket(req.apiUser._id);
    if (!socket) {
      return res.status(400).json({ success: false, message: 'WhatsApp belum terhubung' });
    }

    const jid = toWaJid(String(to));
    if (!jid) {
      return res.status(400).json({
        success: false,
        message: 'Tujuan tidak valid. Untuk grup, gunakan waChatId dari menu History (contoh: 1203...@g.us).'
      });
    }

    const { buffer, mimetype, filePath } = await resolveMedia(mediaUrl);
    const type = mimetype.startsWith('video') ? 'video' : 'image';

    const payload = type === 'video'
      ? { video: buffer, caption: text || '' }
      : { image: buffer, caption: text || '' };

    const sent = await socket.sendMessage(jid, payload);

    const waMessageId = sent?.key?.id || null;
    const timestamp = sent?.messageTimestamp ? Number(sent.messageTimestamp) : null;
    const filter = waMessageId ? { userId: req.apiUser._id, waMessageId } : { userId: req.apiUser._id, waChatId: jid, timestamp, text: text || null };
    await Message.updateOne(
      filter,
      {
        $set: {
          direction: 'outbound',
          text: text || null,
          media: { type, url: mediaUrl, path: filePath },
          waChatId: jid,
          waFromMe: true,
          timestamp
        },
        $setOnInsert: {
          userId: req.apiUser._id,
          waMessageId
        }
      },
      { upsert: true }
    ).catch(() => {});

    await Chat.updateOne(
      { userId: req.apiUser._id, waChatId: jid },
      {
        $set: {
          isGroup: jid.endsWith('@g.us'),
          lastMessage: text || null,
          lastAt: timestamp ? new Date(timestamp * 1000) : new Date()
        },
        $setOnInsert: { userId: req.apiUser._id, waChatId: jid }
      },
      { upsert: true }
    ).catch(() => {});

    return res.json({
      success: true,
      data: {
        to: jid,
      waMessageId: waMessageId
    }
  });
  } catch (err) {
    const msg = err?.message || 'Gagal kirim media';
    if (/groupMetadata|not in group|forbidden|401|403|404|jid/i.test(msg)) {
      return res.status(400).json({
        success: false,
        message: 'Gagal kirim. Jika ini grup, pastikan kamu memakai waChatId grup dari History (akhiran @g.us) dan akun WA kamu adalah member grup itu.'
      });
    }
    return res.status(500).json({ success: false, message: msg });
  }
};

exports.listChats = async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.apiUser._id);

  // Prefer cached chat list (contains name + isGroup), but backfill from messages if needed.
  let rows = await Chat.find({ userId }).sort({ lastAt: -1, updatedAt: -1 }).lean();

  if (!rows.length) {
    const chats = await Message.aggregate([
      { $match: { userId } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$waChatId',
          lastMessage: { $first: '$text' },
          lastAt: { $first: '$createdAt' }
        }
      },
      { $sort: { lastAt: -1 } }
    ]);

    await Promise.all(
      chats.map((c) =>
        Chat.updateOne(
          { userId, waChatId: c._id },
          {
            $set: {
              isGroup: String(c._id || '').endsWith('@g.us'),
              lastMessage: c.lastMessage || null,
              lastAt: c.lastAt || null
            },
            $setOnInsert: { userId, waChatId: c._id }
          },
          { upsert: true }
        ).catch(() => {})
      )
    );

    rows = await Chat.find({ userId }).sort({ lastAt: -1, updatedAt: -1 }).lean();
  }

  // Defensive dedupe: older DBs might contain duplicates if indexes weren't built.
  const data = rows.reduce((acc, c) => {
    const id = String(c?.waChatId || '');
    if (!id) return acc;
    if (acc._seen.has(id)) return acc;
    acc._seen.add(id);
    acc.items.push({
      waChatId: c.waChatId,
      name: c.name || null,
      displayName: c.displayName || null,
      isGroup: !!c.isGroup,
      lastMessage: c.lastMessage || null,
      lastAt: c.lastAt || null
    });
    return acc;
  }, { _seen: new Set(), items: [] }).items;

  return res.json({ success: true, data });
};

exports.listChatIds = async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.apiUser._id);
  // Build an integration-friendly list:
  // - expose only sendable IDs (phone JIDs + group JIDs)
  // - if we only have a LID record, expose its resolvedJid when present
  // - dedupe and prefer rows with displayName/name filled
  const rows = await Chat.find({ userId })
    .select({ waChatId: 1, name: 1, displayName: 1, isGroup: 1, resolvedJid: 1, lastAt: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .lean();
  const bestById = new Map();

  const score = (c) => {
    const dn = String(c?.displayName || '').trim();
    const n = String(c?.name || '').trim();
    let s = 0;
    if (dn) s += 4;
    if (n) s += 2;
    if (c?.lastAt) s += 1;
    return s;
  };

  for (const c of rows) {
    const rawId = String(c?.waChatId || '');
    if (!rawId) continue;

    let exposedId = rawId;
    if (rawId.endsWith('@lid')) {
      const resolved = String(c?.resolvedJid || '').trim();
      if (!resolved) continue; // hide unresolved lid
      exposedId = resolved;
    }

    // Only return "sendable" IDs for integrations: phone JIDs + group JIDs.
    if (!(exposedId.endsWith('@s.whatsapp.net') || exposedId.endsWith('@g.us'))) continue;

    const prev = bestById.get(exposedId);
    if (!prev || score(c) > score(prev._src)) {
      bestById.set(exposedId, { _src: c });
    }
  }

  const data = Array.from(bestById.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([waChatId, wrap]) => ({
      waChatId,
      name: wrap._src?.name || null,
      displayName: wrap._src?.displayName || null,
      isGroup: waChatId.endsWith('@g.us')
    }));
  return res.json({ success: true, data });
};

exports.setChatDisplayName = async (req, res) => {
  try {
    const waChatId = decodeURIComponent(String(req.params.waChatId || '').trim());
    const displayNameRaw = req.body?.displayName;

    if (!waChatId) {
      return res.status(400).json({ success: false, message: 'waChatId wajib diisi' });
    }
    if (typeof displayNameRaw !== 'string') {
      return res.status(400).json({ success: false, message: 'displayName wajib string' });
    }

    const displayName = displayNameRaw.trim();
    if (displayName.length > 80) {
      return res.status(400).json({ success: false, message: 'displayName terlalu panjang (maks 80)' });
    }

    await Chat.updateOne(
      { userId: req.apiUser._id, waChatId },
      {
        $set: { displayName: displayName ? displayName : null },
        $setOnInsert: { userId: req.apiUser._id, waChatId, isGroup: waChatId.endsWith('@g.us') }
      },
      { upsert: true }
    );

    const updated = await Chat.findOne({ userId: req.apiUser._id, waChatId }).lean();
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal update displayName' });
  }
};

exports.stats = async (req, res) => {
  try {
    const userId = req.apiUser._id;
    const [totalChats, totalMessages] = await Promise.all([
      Chat.countDocuments({ userId }),
      Message.countDocuments({ userId })
    ]);
    return res.json({ success: true, data: { totalChats, totalMessages } });
  } catch {
    return res.status(500).json({ success: false, message: 'Gagal mengambil statistik' });
  }
};

exports.chatHistory = async (req, res) => {
  const { waChatId } = req.params;
  const limit = Number(req.query.limit || 50);
  // Fetch latest N, then return in chronological order (oldest -> newest)
  const latest = await Message.find({
    userId: req.apiUser._id,
    waChatId
  }).sort({ timestamp: -1, createdAt: -1 }).limit(limit).lean();

  latest.reverse();
  return res.json({ success: true, data: latest });
};

exports.upload = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'File wajib diupload' });
  }

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const bucket = getBucket();
  const contentType = req.file.mimetype || mime.lookup(req.file.originalname) || 'application/octet-stream';

  const uploadStream = bucket.openUploadStream(req.file.originalname || 'upload', {
    contentType,
    metadata: { contentType, userId: req.apiUser?._id?.toString() || null }
  });

  fs.createReadStream(req.file.path)
    .pipe(uploadStream)
    .on('error', async () => {
      try {
        fs.rmSync(req.file.path, { force: true });
      } catch {}
      return res.status(500).json({ success: false, message: 'Gagal upload media' });
    })
    .on('finish', async () => {
      try {
        fs.rmSync(req.file.path, { force: true });
      } catch {}
      // Use /api/media/* so it works behind nginx when only /api is proxied.
      const url = `${baseUrl}/api/media/${uploadStream.id.toString()}`;
      return res.json({ success: true, data: { media_url: url, media_id: uploadStream.id.toString() } });
    });
};
