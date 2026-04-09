let baileysModule = null;
let cachedWaWebVersion = null;
const QR_STALE_MS = 28_000;
const RECONNECT_MIN_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 8_000;

const loadBaileys = async () => {
  if (!baileysModule) {
    baileysModule = await import('@whiskeysockets/baileys');
  }
  return baileysModule;
};
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const { useMongoAuthState } = require('./mongoAuthState');

class WhatsAppManager {
  constructor() {
    this.sessions = new Map();
  }

  normalizeLidId(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    if (s.includes('@')) return s;
    // Some events provide bare numeric LIDs
    return `${s}@lid`;
  }

  normalizePhoneJid(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    if (s.includes('@')) return s;
    // Some events provide bare numeric phone IDs
    const digits = s.replace(/[^\d]/g, '');
    if (!digits) return null;
    return `${digits}@s.whatsapp.net`;
  }

  toUnixSeconds(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof value === 'object' && typeof value.toNumber === 'function') {
      const n = value.toNumber();
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  hasDisplayNameOverride(displayName) {
    const v = typeof displayName === 'string' ? displayName.trim() : displayName;
    return !!v;
  }

  async setChatNameIfNoOverride(userId, waChatId, patch) {
    // Only set name if user has not set displayName override.
    const id = String(userId);
    await Chat.updateOne(
      {
        userId: id,
        waChatId,
        $or: [{ displayName: { $exists: false } }, { displayName: null }, { displayName: '' }]
      },
      { $set: patch, $setOnInsert: { userId: id, waChatId } },
      { upsert: true }
    ).catch(() => {});
  }

  async syncChatListFromHistorySet(userId, payload) {
    try {
      const id = String(userId);
      const chats = Array.isArray(payload?.chats) ? payload.chats : [];
      const contacts = Array.isArray(payload?.contacts) ? payload.contacts : [];

      // Build quick lookups for:
      // - contact names by phone JID
      // - lid -> phone JID mapping
      const contactNameByJid = new Map(); // key: <phone>@s.whatsapp.net
      const contactNameByLid = new Map(); // key: <lid>@lid
      const lidToJid = new Map(); // key: <lid>@lid -> <phone>@s.whatsapp.net
      for (const c of contacts) {
        const idOrLid = c?.id;
        if (!idOrLid || typeof idOrLid !== 'string') continue;
        const lidRaw =
          typeof c?.lid === 'string'
            ? c.lid
            : (idOrLid.endsWith('@lid') || !idOrLid.includes('@') ? idOrLid : null);
        const jidRaw =
          typeof c?.jid === 'string'
            ? c.jid
            : (idOrLid.endsWith('@s.whatsapp.net') || !idOrLid.includes('@') ? idOrLid : null);

        const lid = lidRaw ? this.normalizeLidId(lidRaw) : null;
        const jid = jidRaw ? this.normalizePhoneJid(jidRaw) : null;
        const name = String(c?.name || c?.notify || c?.verifiedName || '').trim();
        if (lid && jid) lidToJid.set(lid, jid);
        if (jid && name) contactNameByJid.set(jid, name);
        if (lid && name) contactNameByLid.set(lid, name);
      }

      const baseOps = [];
      const nameOps = [];

      for (const chat of chats) {
        const rawId0 = chat?.id;
        if (!rawId0 || typeof rawId0 !== 'string') continue;
        // Normalize bare ids to phone JIDs to keep list-ids usable.
        const rawId = rawId0.includes('@') ? rawId0 : (this.normalizePhoneJid(rawId0) || rawId0);

        // Normalize LID chats to phone JIDs when possible so users get sendable IDs.
        const resolved = rawId.endsWith('@lid') ? (lidToJid.get(this.normalizeLidId(rawId) || rawId) || null) : null;
        const jid = resolved || rawId;

        const isGroup = jid.endsWith('@g.us');
        const ts = this.toUnixSeconds(chat?.conversationTimestamp || chat?.lastMessageRecvTimestamp);
        const lastAt = ts ? new Date(ts * 1000) : null;

        const baseSet = { isGroup };
        if (lastAt) baseSet.lastAt = lastAt;
        if (resolved) baseSet.resolvedJid = resolved;

        baseOps.push({
          updateOne: {
            filter: { userId: id, waChatId: jid },
            update: { $set: baseSet, $setOnInsert: { userId: id, waChatId: jid } },
            upsert: true
          }
        });

        // If it was a LID, also keep/update the LID record so we can preserve names until resolved.
        if (rawId.endsWith('@lid')) {
          const lidSet = { isGroup: false };
          if (lastAt) lidSet.lastAt = lastAt;
          if (resolved) lidSet.resolvedJid = resolved;
          baseOps.push({
            updateOne: {
              filter: { userId: id, waChatId: rawId },
              update: { $set: lidSet, $setOnInsert: { userId: id, waChatId: rawId } },
              upsert: true
            }
          });
        }

        // Best-effort name:
        // - groups: subject/name (if present)
        // - contacts: contact display name from the contacts list (if present)
        let name = '';
        if (isGroup) {
          name = String(chat?.name || chat?.subject || '').trim();
        } else {
          if (rawId.endsWith('@lid') && !resolved) {
            name = String(contactNameByLid.get(rawId) || chat?.name || '').trim();
          } else {
            name = String(contactNameByJid.get(jid) || chat?.name || '').trim();
          }
        }

        if (name) {
          nameOps.push({
            updateOne: {
              filter: {
                userId: id,
                waChatId: rawId.endsWith('@lid') && !resolved ? rawId : jid,
                $or: [{ displayName: { $exists: false } }, { displayName: null }, { displayName: '' }]
              },
              update: { $set: { name, isGroup }, $setOnInsert: { userId: id, waChatId: rawId.endsWith('@lid') && !resolved ? rawId : jid } },
              upsert: true
            }
          });
        }

        // If the chat came as a LID, preserve the name on the LID record too.
        if (rawId.endsWith('@lid')) {
          const lidKey = this.normalizeLidId(rawId) || rawId;
          const lidName = String(contactNameByLid.get(lidKey) || '').trim();
          if (lidName) {
            nameOps.push({
              updateOne: {
                filter: {
                  userId: id,
                  waChatId: lidKey,
                  $or: [{ displayName: { $exists: false } }, { displayName: null }, { displayName: '' }]
                },
                update: { $set: { name: lidName, isGroup: false }, $setOnInsert: { userId: id, waChatId: lidKey } },
                upsert: true
              }
            });
          }
        }
      }

      if (baseOps.length) {
        await Chat.bulkWrite(baseOps, { ordered: false }).catch(() => {});
      }
      if (nameOps.length) {
        await Chat.bulkWrite(nameOps, { ordered: false }).catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  pickBestUserJid(msg) {
    const candidates = [
      msg?.key?.senderPn,
      msg?.key?.participantPn,
      msg?.key?.senderLid,
      msg?.key?.participantLid,
      msg?.key?.participant,
      msg?.participant,
      msg?.senderPn,
      msg?.participantPn,
      msg?.sender,
      msg?.from
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const value = candidate.trim();
      if (!value) continue;

      if (value.includes('@')) return value;
      if (/^\d+$/.test(value)) return `${value}@s.whatsapp.net`;
    }

    return null;
  }

  normalizeChatId(msg) {
    const remoteJid = msg?.key?.remoteJid || null;
    if (!remoteJid) return null;

    // For some accounts/devices, incoming DMs can show up as LID JIDs.
    // Normalize them back to a phone JID if we can, so inbound/outbound stay in the same room.
    if (remoteJid.endsWith('@lid')) {
      const best = this.pickBestUserJid(msg);
      if (best && best.endsWith('@s.whatsapp.net')) return best;
    }

    return remoteJid;
  }

  getBaileysLogger() {
    const adapt = {
      trace: (...args) => console.debug(...args),
      debug: (...args) => console.debug(...args),
      info: (...args) => console.info(...args),
      warn: (...args) => console.warn(...args),
      error: (...args) => console.error(...args),
      fatal: (...args) => console.error(...args),
      child: () => adapt
    };
    return adapt;
  }

  getAuthPath(userId) {
    return path.join(process.cwd(), 'auth_info', String(userId));
  }

  async ensureAuthPath(userId) {
    const authPath = this.getAuthPath(userId);
    if (!fs.existsSync(authPath)) {
      fs.mkdirSync(authPath, { recursive: true });
    }
    return authPath;
  }

  async resetAuthState(userId) {
    // Clear any legacy on-disk auth state (if it exists)
    const authPath = this.getAuthPath(userId);
    try {
      fs.rmSync(authPath, { recursive: true, force: true });
      fs.mkdirSync(authPath, { recursive: true });
    } catch (err) {
      console.error('Failed to reset auth state', err);
    }

    // Clear MongoDB-backed auth state used in production
    try {
      const auth = await useMongoAuthState(userId);
      await auth.clear();
    } catch (err) {
      console.error('Failed to clear mongo auth state', err);
    }
  }

  async reset(userId) {
    const id = String(userId);
    const existing = this.sessions.get(id);
    if (existing?.socket) {
      try {
        existing.manualDisconnect = true;
        existing.socket.end();
      } catch (err) {
        // ignore
      }
    }
    if (existing?.autoRefreshTimer) {
      clearInterval(existing.autoRefreshTimer);
      existing.autoRefreshTimer = null;
    }
    this.sessions.delete(id);
    await this.resetAuthState(id);
    // Option A: reset WA session also clears message history for this user
    await Message.deleteMany({ userId: id });
    await Chat.deleteMany({ userId: id });
    await User.findByIdAndUpdate(id, {
      waStatus: 'disconnected',
      waLastError: null,
      waLastStatusAt: new Date(),
      waQr: null,
      waQrCreatedAt: null,
      waJid: null,
      waPhone: null,
      connectedAt: null
    });
  }

  getSession(userId) {
    return this.sessions.get(String(userId)) || null;
  }

  async connect(userId, options = {}) {
    const id = String(userId);
    const existing = this.sessions.get(id);
    if (!options.forceReconnect && ['connected', 'authorizing', 'qr_ready', 'connecting'].includes(existing?.status)) {
      return existing;
    }

    if (options.forceReconnect && existing?.socket) {
      try {
        existing.refreshInProgress = true;
        existing.socket.end();
      } catch (err) {
        // ignore
      }
    }
    if (options.forceReconnect && existing?.autoRefreshTimer) {
      clearInterval(existing.autoRefreshTimer);
      existing.autoRefreshTimer = null;
    }
    if (options.forceReconnect && existing) {
      this.sessions.delete(id);
    }

    const {
      default: makeWASocket,
      DisconnectReason,
      fetchLatestWaWebVersion,
      makeCacheableSignalKeyStore,
      addTransactionCapability,
      Browsers
    } = await loadBaileys();

    const { state, saveCreds } = await useMongoAuthState(id);
    if (!cachedWaWebVersion) {
      const { version } = await fetchLatestWaWebVersion({});
      cachedWaWebVersion = version;
    }

    // Always do full history sync on connect for this MVP.
    // This keeps behavior simple and ensures chat list (DM + groups) is populated after reconnect.
    const needFullHistory = true;

    const session = {
      status: 'connecting',
      qr: null,
      socket: null,
      lastError: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      refreshInProgress: false,
      manualDisconnect: false,
      qrCreatedAt: null,
      nextReconnectAt: 0,
      autoRefreshTimer: null,
      groupMetaPending: new Set(),
      groupSyncInProgress: false
    };

    await User.findByIdAndUpdate(id, {
      waStatus: 'connecting',
      waLastError: null,
      waLastStatusAt: new Date(),
      waQr: null,
      waQrCreatedAt: null,
      waAuthPath: null
    });

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          addTransactionCapability(state.keys, this.getBaileysLogger(), {
            maxCommitRetries: 5,
            delayBetweenTriesMs: 50
          }),
          this.getBaileysLogger()
        )
      },
      browser: Browsers.macOS('Desktop'),
      version: cachedWaWebVersion,
      printQRInTerminal: false,
      // Needed to reliably receive the full chat list (DMs + groups) for first-time sync.
      // We still do NOT persist full message history; we only consume chats/contacts from events.
      syncFullHistory: needFullHistory,
      fireInitQueries: true,
      markOnlineOnConnect: false
    });

    session.socket = sock;
    this.sessions.set(id, session);

    sock.ev.on('creds.update', saveCreds);

    // Initial sync: chats/contacts list from WhatsApp (no message details needed for MVP list-ids).
    sock.ev.on('messaging-history.set', (data) => {
      // Run in background so we never block the event loop or connection flow.
      setTimeout(() => {
        void this.syncChatListFromHistorySet(id, data);
      }, 0);
    });

    // Some accounts deliver chat list in incremental events rather than messaging-history.set.
    // We'll upsert chat IDs here too (names can be filled by contacts/groups sync later).
    sock.ev.on('chats.upsert', (chats) => {
      const list = Array.isArray(chats) ? chats : [];
      if (!list.length) return;
      setTimeout(() => {
        void this.syncChatListFromHistorySet(id, { chats: list, contacts: [] });
      }, 0);
    });

    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      // If we previously stored a LID chat id, normalize it to phone JID.
      if (!lid || !jid) return;
      setTimeout(async () => {
        try {
          const lidNorm = this.normalizeLidId(lid) || String(lid);
          const jidNorm = this.normalizePhoneJid(jid) || String(jid);

          const existing = await Chat.findOne({ userId: id, waChatId: { $in: [lidNorm, String(lid)] } }).lean();
          if (!existing) return;

          // Mark the LID record as resolved (we keep it, but it will be hidden from list-ids).
          await Chat.updateOne(
            { userId: id, waChatId: existing.waChatId },
            { $set: { resolvedJid: jidNorm } }
          ).catch(() => {});

          // Ensure phone JID exists and carry over fields from the LID doc (name/override).
          await Chat.updateOne(
            { userId: id, waChatId: jidNorm },
            {
              $setOnInsert: { userId: id, waChatId: jidNorm },
              $set: {
                isGroup: false,
                lastAt: existing.lastAt || null,
                lastMessage: existing.lastMessage || null
              }
            },
            { upsert: true }
          ).catch(() => {});

          // Carry over name/displayName if present.
          if (existing.name) {
            await this.setChatNameIfNoOverride(id, jidNorm, { name: existing.name, isGroup: false });
          }
          if (existing.displayName) {
            await Chat.updateOne(
              {
                userId: id,
                waChatId: jidNorm,
                $or: [{ displayName: { $exists: false } }, { displayName: null }, { displayName: '' }]
              },
              { $set: { displayName: String(existing.displayName).trim() } }
            ).catch(() => {});
          }

        } catch {
          // ignore
        }
      }, 0);
    });

    // Server-side QR lifecycle: auto-refresh if QR is stale but still not connected.
    session.autoRefreshTimer = setInterval(() => {
      if (session.status !== 'qr_ready') return;
      if (!session.qrCreatedAt) return;
      if (Date.now() - session.qrCreatedAt.getTime() < QR_STALE_MS) return;
      // Avoid spamming reconnects.
      if (Date.now() < session.nextReconnectAt) return;
      session.nextReconnectAt = Date.now() + RECONNECT_MAX_DELAY_MS;
      void this.connect(id, { forceReconnect: true });
    }, 1_000);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        const qrData = await QRCode.toDataURL(qr);
        session.status = 'qr_ready';
        session.qr = qrData;
        session.qrCreatedAt = new Date();
        session.lastError = null;
        await User.findByIdAndUpdate(id, {
          waStatus: 'qr_ready',
          waLastError: null,
          waLastStatusAt: new Date(),
          waQr: qrData,
          waQrCreatedAt: session.qrCreatedAt,
          waAuthPath: null
        });
      }

      if (connection === 'connecting' && !qr && session.status === 'qr_ready') {
        session.status = 'authorizing';
        session.qr = null;
        session.qrCreatedAt = null;
        session.lastError = null;
        await User.findByIdAndUpdate(id, {
          waStatus: 'authorizing',
          waLastError: null,
          waLastStatusAt: new Date(),
          waQr: null
        });
      }

      if (connection === 'open') {
        const jid = sock.user?.id || null;
        const phone = jid ? jid.split(':')[0] : null;
        session.status = 'connected';
        session.qr = null;
        session.qrCreatedAt = null;
        session.lastError = null;
        session.reconnectAttempts = 0;
        await User.findByIdAndUpdate(id, {
          waStatus: 'connected',
          waLastError: null,
          waLastStatusAt: new Date(),
          waQr: null,
          waQrCreatedAt: null,
          waJid: jid,
          waPhone: phone,
          waAuthPath: null,
          connectedAt: new Date()
        });

        // Background: sync group subjects so group names show up without waiting for new messages.
        // This should never block the connect flow.
        setTimeout(() => {
          void this.syncAllGroups(sock, session, id);
        }, 250);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
        const needsRestart = statusCode === 515 || /restart required/i.test(errorMessage);
        session.status = 'disconnected';
        session.qr = null;
        session.qrCreatedAt = null;
        session.lastError = errorMessage;
        await User.findByIdAndUpdate(id, {
          waStatus: 'disconnected',
          waLastError: errorMessage,
          waLastStatusAt: new Date(),
          waQr: null,
          waQrCreatedAt: null,
          waJid: null,
          waPhone: null
        });

        if (session.manualDisconnect) {
          session.manualDisconnect = false;
          session.reconnectAttempts = 0;
          session.refreshInProgress = false;
          return;
        }

        if (session.refreshInProgress || needsRestart) {
          session.refreshInProgress = false;
          session.reconnectAttempts = 0;
          session.status = 'connecting';
          session.nextReconnectAt = Date.now() + RECONNECT_MIN_DELAY_MS;
          setTimeout(() => {
            void this.connect(id, { forceReconnect: true });
          }, 500);
          return;
        }

        if (isLoggedOut) {
          await this.resetAuthState(id);
        }

        const shouldReconnect = session.reconnectAttempts < session.maxReconnectAttempts;
        if (shouldReconnect) {
          session.reconnectAttempts += 1;
          session.status = 'connecting';
          const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_MIN_DELAY_MS * session.reconnectAttempts);
          session.nextReconnectAt = Date.now() + delay;
          setTimeout(() => {
            void this.connect(id);
          }, delay);
        } else {
          session.reconnectAttempts = 0;
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        const waChatId = this.normalizeChatId(msg);
        if (!waChatId) continue;
        const waMessageId = msg.key?.id || null;
        const waFromMe = !!msg.key?.fromMe;
        const timestamp = msg.messageTimestamp ? Number(msg.messageTimestamp) : null;
        const text = this.extractText(msg.message);
        const isGroup = waChatId.endsWith('@g.us');
        const pushName = typeof msg.pushName === 'string' ? msg.pushName.trim() : '';

        // Upsert to avoid duplicates (API send + upsert event)
        const filter = waMessageId ? { userId: id, waMessageId } : { userId: id, waChatId, timestamp, text };
        await Message.updateOne(
          filter,
          {
            $set: {
              direction: waFromMe ? 'outbound' : 'inbound',
              text,
              waChatId,
              waFromMe,
              timestamp
            },
            $setOnInsert: {
              userId: id,
              media: {},
              waMessageId
            }
          },
          { upsert: true }
        ).catch(() => {
          // ignore duplicate-key races
        });

        // Maintain a chat list for History/List pages.
        const lastAt = timestamp ? new Date(timestamp * 1000) : new Date();
        const chatUpdate = {
          isGroup,
          lastMessage: text || null,
          lastAt
        };
        // Best-effort naming:
        // - For contacts: use pushName (WhatsApp profile name), not phone address book name.
        await Chat.updateOne(
          { userId: id, waChatId },
          { $set: chatUpdate, $setOnInsert: { userId: id, waChatId } },
          { upsert: true }
        ).catch(() => {});

        if (!isGroup && pushName && !waFromMe) {
          await this.setChatNameIfNoOverride(id, waChatId, { name: pushName, isGroup: false });
        }

        if (isGroup) {
          void this.ensureGroupName(sock, session, id, waChatId);
        }
      }
    });

    // Update contact names when Baileys provides them
    sock.ev.on('contacts.upsert', async (contacts) => {
      const list = Array.isArray(contacts) ? contacts : [];
      for (const c of list) {
        const jid = c?.id;
        if (!jid || typeof jid !== 'string') continue;
        // Prefer phone JID if present; otherwise accept id if it's already phone JID.
        const phoneJidRaw = typeof c?.jid === 'string' ? c.jid : (jid.endsWith('@s.whatsapp.net') ? jid : null);
        const phoneJid = phoneJidRaw ? (this.normalizePhoneJid(phoneJidRaw) || phoneJidRaw) : null;
        if (!phoneJid) continue;
        const name = String(c?.name || c?.notify || c?.verifiedName || '').trim();
        if (!name) continue;
        await this.setChatNameIfNoOverride(id, phoneJid, { name, isGroup: false });

        // If this contact also has a LID id, store the mapping to help list-ids expose phone JIDs.
        const lidRaw = typeof c?.lid === 'string' ? c.lid : (jid.endsWith('@lid') ? jid : null);
        const lidNorm = lidRaw ? this.normalizeLidId(lidRaw) : null;
        if (lidNorm && lidNorm.endsWith('@lid')) {
          await Chat.updateOne(
            { userId: id, waChatId: lidNorm },
            { $set: { resolvedJid: phoneJid, isGroup: false }, $setOnInsert: { userId: id, waChatId: lidNorm } },
            { upsert: true }
          ).catch(() => {});
          // If the LID doc had a name earlier, keep it there too.
          await this.setChatNameIfNoOverride(id, lidNorm, { name, isGroup: false });
        }
      }
    });

    sock.ev.on('groups.update', async (updates) => {
      const list = Array.isArray(updates) ? updates : [];
      for (const u of list) {
        const jid = u?.id;
        const subject = typeof u?.subject === 'string' ? u.subject.trim() : '';
        if (!jid || !subject) continue;
        await this.setChatNameIfNoOverride(id, jid, { name: subject, isGroup: true });
      }
    });

    return session;
  }

  extractText(message) {
    if (!message) return null;
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    return null;
  }

  async ensureGroupName(sock, session, userId, waChatId) {
    try {
      if (!waChatId || !waChatId.endsWith('@g.us')) return;
      // Avoid repeated metadata queries for the same group while connected.
      if (session?.groupMetaPending?.has(waChatId)) return;
      session?.groupMetaPending?.add(waChatId);

      const meta = await sock.groupMetadata(waChatId);
      const subject = typeof meta?.subject === 'string' ? meta.subject.trim() : '';
      if (subject) {
        await this.setChatNameIfNoOverride(String(userId), waChatId, { name: subject, isGroup: true });
      }
    } catch {
      // ignore
    } finally {
      try {
        session?.groupMetaPending?.delete(waChatId);
      } catch {}
    }
  }

  async syncAllGroups(sock, session, userId) {
    try {
      if (session?.groupSyncInProgress) return;
      session.groupSyncInProgress = true;
      if (typeof sock?.groupFetchAllParticipating !== 'function') return;
      const groups = await sock.groupFetchAllParticipating();
      const entries = Object.entries(groups || {});
      for (const [jid, meta] of entries) {
        const subject = typeof meta?.subject === 'string' ? meta.subject.trim() : '';
        if (!jid || !subject) continue;
        await this.setChatNameIfNoOverride(String(userId), jid, { name: subject, isGroup: true });
      }
    } catch {
      // ignore
    } finally {
      try {
        session.groupSyncInProgress = false;
      } catch {}
    }
  }

  async disconnect(userId) {
    const id = String(userId);
    const session = this.sessions.get(id);
    if (!session?.socket) return;
    try {
      session.manualDisconnect = true;
      // IMPORTANT: disconnect should only stop the live connection.
      // Do NOT call logout() here because that revokes the pairing and forces a QR scan next time.
      session.socket.end();
    } catch (err) {
      // ignore
    }
    if (session.autoRefreshTimer) {
      clearInterval(session.autoRefreshTimer);
      session.autoRefreshTimer = null;
    }
    this.sessions.delete(id);
    await User.findByIdAndUpdate(id, {
      waStatus: 'disconnected',
      waLastError: null,
      waLastStatusAt: new Date(),
      waQr: null,
      waQrCreatedAt: null,
      waJid: null,
      waPhone: null
    });
  }

  getStatus(userId) {
    const id = String(userId);
    return this.sessions.get(id)?.status || 'disconnected';
  }

  getQr(userId) {
    const id = String(userId);
    return this.sessions.get(id)?.qr || null;
  }

  getSocket(userId) {
    const id = String(userId);
    return this.sessions.get(id)?.socket || null;
  }
}

module.exports = new WhatsAppManager();
