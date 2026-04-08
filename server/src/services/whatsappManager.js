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
const { useMongoAuthState } = require('./mongoAuthState');

class WhatsAppManager {
  constructor() {
    this.sessions = new Map();
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
      autoRefreshTimer: null
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
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    session.socket = sock;
    this.sessions.set(id, session);

    sock.ev.on('creds.update', saveCreds);

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
        const waMessageId = msg.key?.id || null;
        const waFromMe = !!msg.key?.fromMe;
        const timestamp = msg.messageTimestamp ? Number(msg.messageTimestamp) : null;
        const text = this.extractText(msg.message);

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
