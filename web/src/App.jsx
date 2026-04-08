import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  apiUrl,
  authLogin,
  authMe,
  authRefresh,
  authRegister,
  chatHistory,
  listChats,
  listIds,
  sendMedia,
  sendText,
  setChatDisplayName,
  uploadMedia,
  waConnect,
  waDisconnect,
  waQr,
  waReset,
  waStatus
} from './api.js';

const saveSession = (session) => {
  localStorage.setItem('wablas.session', JSON.stringify(session));
};

const loadSession = () => {
  try {
    return JSON.parse(localStorage.getItem('wablas.session') || '{}');
  } catch {
    return {};
  }
};

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [user, setUser] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [sessionEmail, setSessionEmail] = useState('');
  const [authError, setAuthError] = useState('');

  const [waInfo, setWaInfo] = useState({ waStatus: 'disconnected', waPhone: null, waJid: null });
  const [qr, setQr] = useState('');
  const [qrCreatedAt, setQrCreatedAt] = useState(null);

  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [attachments, setAttachments] = useState([]); // File[]
  const [showAdvancedUrl, setShowAdvancedUrl] = useState(false);
  const [sendResult, setSendResult] = useState('');
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef(null);

  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState('');
  const [messages, setMessages] = useState([]);
  const [mediaFetchError, setMediaFetchError] = useState({}); // { [messageId]: string }
  const [mediaLoading, setMediaLoading] = useState({}); // { [messageId]: boolean }
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewContentType, setPreviewContentType] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');
  const [theme, setTheme] = useState('light');
  const [copyNotice, setCopyNotice] = useState('');
  const [editingChatId, setEditingChatId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountRef = useRef(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isResettingWa, setIsResettingWa] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState(null); // 'disconnect' | 'reset'
  const [connectNotice, setConnectNotice] = useState('');
  const connectTimerRef = useRef(null);
  const autoRefreshRef = useRef({ windowStart: 0, count: 0, lastAt: 0 });

  const isAuthed = useMemo(() => !!accessToken, [accessToken]);
  const qrAgeSeconds = useMemo(() => {
    if (!qrCreatedAt) return null;
    const ms = Date.now() - new Date(qrCreatedAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.floor(ms / 1000);
  }, [qrCreatedAt, waInfo?.waStatus]);

  const statusAgeSeconds = useMemo(() => {
    const ts = waInfo?.waLastStatusAt;
    if (!ts) return null;
    const ms = Date.now() - new Date(ts).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.floor(ms / 1000);
  }, [waInfo?.waLastStatusAt, waInfo?.waStatus]);

  useEffect(() => {
    const saved = localStorage.getItem('wablas.theme');
    if (saved) setTheme(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('theme-dark');
    } else {
      root.classList.remove('theme-dark');
    }
    localStorage.setItem('wablas.theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (accountRef.current && !accountRef.current.contains(event.target)) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const hydrate = async (session) => {
    if (!session?.accessToken) return;
    setAccessToken(session.accessToken);
    setRefreshToken(session.refreshToken || '');
    setApiKey(session.apiKey || '');
    setSessionEmail(session.email || '');

    const meRes = await authMe(session.accessToken);
    if (meRes.success) {
      setUser(meRes.data);
      if (meRes.data?.apiKey && !session.apiKey) {
        setApiKey(meRes.data.apiKey);
      }
      if (!session.email && meRes.data?.email) {
        const newSession = { ...session, email: meRes.data.email };
        if (meRes.data?.apiKey) newSession.apiKey = meRes.data.apiKey;
        saveSession(newSession);
        setSessionEmail(meRes.data.email);
      }
      if (session.apiKey && meRes.data?.apiKey && session.apiKey !== meRes.data.apiKey) {
        const newSession = { ...session, apiKey: meRes.data.apiKey };
        saveSession(newSession);
        setApiKey(meRes.data.apiKey);
      }
      return;
    }

    if (session.refreshToken) {
      const refreshRes = await authRefresh(session.refreshToken);
      if (refreshRes.success) {
        const newSession = {
          ...session,
          accessToken: refreshRes.data.accessToken,
          refreshToken: refreshRes.data.refreshToken
        };
        setAccessToken(newSession.accessToken);
        setRefreshToken(newSession.refreshToken);
        saveSession(newSession);
        const meRes2 = await authMe(newSession.accessToken);
        if (meRes2.success) {
          setUser(meRes2.data);
          if (meRes2.data?.email) {
            const newest = { ...newSession, email: meRes2.data.email };
            saveSession(newest);
            setSessionEmail(meRes2.data.email);
          }
        }
      }
    }
  };

  useEffect(() => {
    const session = loadSession();
    if (session?.accessToken) hydrate(session);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('wablas.session');
    setAccessToken('');
    setRefreshToken('');
    setApiKey('');
    setUser(null);
    setSessionEmail('');
    setWaInfo({ waStatus: 'disconnected', waPhone: null, waJid: null });
    setQr('');
    setQrCreatedAt(null);
    setChats([]);
    setSelectedChat('');
    setMessages([]);
    setIsConnecting(false);
  };

  useEffect(() => {
    if (!accessToken) return;
    const fetchStatus = async () => {
      const res = await waStatus(accessToken);
      if (res && res.success === false && /unauthorized|invalid token/i.test(res.message || '')) {
        setConnectNotice('Session expired. Silakan login ulang.');
        handleLogout();
        return;
      }
      if (res.success) {
        setWaInfo(res.data);
        if (res.data?.waStatus && res.data.waStatus !== 'connecting') {
          setIsConnecting(false);
          setConnectNotice('');
        }
        if (res.data?.waQrCreatedAt) {
          setQrCreatedAt(res.data.waQrCreatedAt);
        }
      }
      // Only poll QR in Settings to avoid noisy 404s and unnecessary requests.
      if (activeTab !== 'settings') return;
      const qrRes = await waQr(accessToken);
      if (qrRes && qrRes.success === false && /unauthorized|invalid token/i.test(qrRes.message || '')) {
        setConnectNotice('Session expired. Silakan login ulang.');
        handleLogout();
        return;
      }
      if (qrRes.success) {
        setQr(qrRes.data.qr);
        setQrCreatedAt(qrRes.data.waQrCreatedAt || null);
        setIsConnecting(false);
        setConnectNotice('');
      }
    };
    fetchStatus();

    const interval = setInterval(fetchStatus, activeTab === 'settings' ? 2000 : 5000);
    return () => clearInterval(interval);
  }, [accessToken, activeTab]);

  // Frontend QR auto-refresh (avoids manual clicking when QR expires).
  useEffect(() => {
    if (!isAuthed) return;
    if (activeTab !== 'settings') return;
    if (isConnecting) return;

    const status = waInfo?.waStatus;
    if (status !== 'connecting' && status !== 'qr_ready') return;

    const now = Date.now();
    const state = autoRefreshRef.current;
    if (now - state.lastAt < 12_000) return; // cooldown

    // Reset rolling window every 2 minutes.
    if (!state.windowStart || now - state.windowStart > 120_000) {
      state.windowStart = now;
      state.count = 0;
    }
    if (state.count >= 6) return;

    const shouldRefresh =
      (status === 'connecting' && !qr && (statusAgeSeconds ?? 0) >= 10) ||
      (status === 'qr_ready' && (qrAgeSeconds ?? 0) >= 26);

    if (!shouldRefresh) return;

    state.lastAt = now;
    state.count += 1;
    setConnectNotice('Auto-refresh QR…');
    void handleRefreshQr();
  }, [activeTab, isAuthed, isConnecting, qr, qrAgeSeconds, statusAgeSeconds, waInfo?.waStatus]);

  useEffect(() => {
    if (!apiKey || !['history', 'list_ids', 'overview'].includes(activeTab)) return;

    let disposed = false;
    let controller = null;

    const tick = async () => {
      if (disposed) return;
      if (controller) controller.abort();
      controller = new AbortController();
      try {
        const res =
          activeTab === 'list_ids' ? await listIds(apiKey, controller.signal) : await listChats(apiKey, controller.signal);
        if (!res?.success || disposed) return;
        const next = res.data || [];
        setChats((prev) => {
          const prevTop = prev?.[0]?.waChatId || null;
          const nextTop = next?.[0]?.waChatId || null;
          if (prev.length === next.length && prevTop === nextTop) return prev;
          return next;
        });
      } catch (err) {
        // ignore aborts & transient network errors
      }
    };

    void tick();
    const interval = setInterval(tick, 5000);
    return () => {
      disposed = true;
      clearInterval(interval);
      if (controller) controller.abort();
    };
  }, [apiKey, activeTab]);

  useEffect(() => {
    if (!apiKey || !selectedChat || activeTab !== 'history') return;

    let disposed = false;
    let controller = null;

    const tick = async () => {
      if (disposed) return;
      if (controller) controller.abort();
      controller = new AbortController();
      try {
        const res = await chatHistory(apiKey, selectedChat, controller.signal);
        if (!res?.success || disposed) return;
        const next = res.data || [];
        setMessages((prev) => {
          const prevTop = (prev?.[prev.length - 1]?.waMessageId || prev?.[prev.length - 1]?._id) ?? null;
          const nextTop = (next?.[next.length - 1]?.waMessageId || next?.[next.length - 1]?._id) ?? null;
          if (prev.length === next.length && prevTop === nextTop) return prev;

          // Dedupe by waMessageId first (if present), fallback to _id.
          const seen = new Set();
          const deduped = [];
          for (const item of next) {
            const key = item?.waMessageId || item?._id;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
          }

          // Ensure chronological order (oldest -> newest)
          deduped.sort((a, b) => {
            const ta = Number(a?.timestamp || 0);
            const tb = Number(b?.timestamp || 0);
            if (ta !== tb) return ta - tb;
            return new Date(a?.createdAt || 0).getTime() - new Date(b?.createdAt || 0).getTime();
          });

          return deduped;
        });
      } catch (err) {
        // ignore aborts & transient network errors
      }
    };

    void tick();
    const interval = setInterval(tick, 2000);
    return () => {
      disposed = true;
      clearInterval(interval);
      if (controller) controller.abort();
    };
  }, [apiKey, selectedChat, activeTab]);

  const handleAuth = async (type) => {
    setAuthError('');
    const call = type === 'register' ? authRegister : authLogin;
    const res = await call(email, password);
    if (!res.success) {
      setAuthError(res.message || 'Gagal login');
      return;
    }
    const session = {
      accessToken: res.data.accessToken,
      refreshToken: res.data.refreshToken,
      apiKey: res.data.user.apiKey,
      email: res.data.user.email
    };
    saveSession(session);
    setAccessToken(session.accessToken);
    setRefreshToken(session.refreshToken);
    setApiKey(session.apiKey);
    setSessionEmail(session.email);
    setUser(res.data.user);
  };

  const handleConnect = async () => {
    if (!isAuthed) {
      setConnectNotice('Login dulu untuk menautkan WhatsApp.');
      return;
    }
    setQr('');
    setQrCreatedAt(null);
    setIsConnecting(true);
    setConnectNotice('Menunggu QR code muncul...');
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    connectTimerRef.current = setTimeout(() => {
      setIsConnecting(false);
      setConnectNotice('QR belum muncul. Coba klik Refresh QR atau tunggu beberapa detik.');
    }, 20000);
    await waConnect(accessToken);
  };

  const handleRefreshQr = async () => {
    if (!isAuthed) {
      setConnectNotice('Login dulu untuk menautkan WhatsApp.');
      return;
    }
    setQr('');
    setQrCreatedAt(null);
    setIsConnecting(true);
    setConnectNotice('Meminta QR baru...');
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    connectTimerRef.current = setTimeout(() => {
      setIsConnecting(false);
      setConnectNotice('QR belum muncul. Silakan ulangi Refresh QR.');
    }, 20000);
    await waConnect(accessToken, true);
  };

  const handleDisconnect = async () => {
    if (!isAuthed) return;
    setIsDisconnecting(true);
    setConnectNotice('Disconnecting…');
    try {
      await waDisconnect(accessToken);
    } finally {
      setIsDisconnecting(false);
      setConnectNotice('');
    }
  };

  const handleResetWa = async () => {
    if (!isAuthed) return;
    setIsResettingWa(true);
    setConnectNotice('Resetting session…');
    setQr('');
    setQrCreatedAt(null);
    setIsConnecting(false);
    try {
      await waReset(accessToken);
    } finally {
      setIsResettingWa(false);
      setConnectNotice('');
    }
  };

  const openConfirm = (kind) => {
    setConfirmKind(kind);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    if (isDisconnecting || isResettingWa) return;
    setConfirmOpen(false);
    setConfirmKind(null);
  };

  const confirmProceed = async () => {
    if (confirmKind === 'disconnect') {
      await handleDisconnect();
    } else if (confirmKind === 'reset') {
      await handleResetWa();
    }
    closeConfirm();
  };

  const addAttachments = (fileList) => {
    const incoming = Array.from(fileList || []).filter(Boolean);
    if (incoming.length === 0) return;
    setAttachments((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}:${f.size}:${f.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      // Safety: keep it simple for MVP
      return merged.slice(0, 5);
    });
  };

  const removeAttachmentAt = (idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
    // Allow re-picking the same file name
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async () => {
    setSendResult('');
    if (!to) return;
    setIsSending(true);
    try {
      let customError = '';
      let res;
      const hasAnyContent = !!(text?.trim() || mediaUrl || attachments.length > 0);
      if (!hasAnyContent) {
        setSendResult('Isi pesan atau lampirkan media dulu.');
        return;
      }

      if (attachments.length > 0) {
        // Upload + send sequentially (WhatsApp will receive as multiple messages if >1 file)
        let ok = 0;
        for (const f of attachments) {
          const up = await uploadMedia(apiKey, f);
          if (!up?.success || !up?.data?.media_url) {
            customError = up?.message || 'Gagal upload media';
            res = { success: false };
            break;
          }
          const sent = await sendMedia(apiKey, to, text, up.data.media_url);
          if (!sent?.success) {
            customError = sent?.message || 'Gagal kirim media';
            res = { success: false };
            break;
          }
          ok += 1;
          res = sent;
        }
        if (res?.success) {
          setSendResult(ok > 1 ? `Terkirim (${ok} file)` : 'Pesan terkirim');
        }
      } else if (mediaUrl) {
        res = await sendMedia(apiKey, to, text, mediaUrl);
      } else {
        res = await sendText(apiKey, to, text);
      }
      if (res?.success) {
        if (!attachments.length) setSendResult('Pesan terkirim');
        setTo('');
        setText('');
        setMediaUrl('');
        setAttachments([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setSendResult(customError || res?.message || 'Gagal kirim');
      }
    } catch (err) {
      setSendResult('Gagal kirim (server tidak bisa dihubungi)');
    } finally {
      setIsSending(false);
    }
  };

  const handleExitHistoryChat = () => {
    setSelectedChat('');
    setMessages([]);
    setMediaFetchError({});
    setMediaLoading({});
  };

  const selectedChatInfo = useMemo(() => {
    if (!selectedChat) return null;
    return chats.find((c) => c.waChatId === selectedChat) || null;
  }, [selectedChat, chats]);

  const displayLabelForChat = (chat) => {
    if (!chat) return '';
    const label = chat.displayName || chat.name || '';
    return label.trim();
  };

  const formatChatTitle = (chat) => {
    if (!chat) return '';
    return displayLabelForChat(chat) || chat.waChatId;
  };

  const copyToClipboard = async (value) => {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      setCopyNotice('Copied');
      setTimeout(() => setCopyNotice(''), 1200);
    } catch {
      setCopyNotice('Copy failed');
      setTimeout(() => setCopyNotice(''), 1200);
    }
  };

  const beginEditChatName = (chat) => {
    setEditingChatId(chat.waChatId);
    setEditingName((chat.displayName || '').trim());
  };

  const cancelEditChatName = () => {
    if (isSavingName) return;
    setEditingChatId('');
    setEditingName('');
  };

  const saveEditChatName = async (waChatId) => {
    if (!apiKey) return;
    setIsSavingName(true);
    try {
      const res = await setChatDisplayName(apiKey, waChatId, editingName);
      if (!res?.success) {
        setCopyNotice(res?.message || 'Gagal simpan nama');
        setTimeout(() => setCopyNotice(''), 1500);
        return;
      }
      const updated = res.data;
      setChats((prev) =>
        prev.map((c) => (c.waChatId === waChatId ? { ...c, displayName: updated?.displayName || null } : c))
      );
      setEditingChatId('');
      setEditingName('');
      setCopyNotice('Saved');
      setTimeout(() => setCopyNotice(''), 1200);
    } catch {
      setCopyNotice('Gagal simpan nama');
      setTimeout(() => setCopyNotice(''), 1500);
    } finally {
      setIsSavingName(false);
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewTitle('');
    setPreviewContentType('');
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch {}
    }
    setPreviewUrl('');
  };

  const getMediaIdFromUrl = (url) => {
    const s = String(url || '');
    const idx = s.lastIndexOf('/media/');
    if (idx === -1) return null;
    const tail = s.slice(idx + '/media/'.length);
    const id = tail.split(/[?#/]/)[0];
    return id || null;
  };

  const fetchMediaBlob = async (mediaId) => {
    const res = await fetch(`${apiUrl}/media/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      const msg = res.status === 401 ? 'Unauthorized' : res.status === 403 ? 'Forbidden' : 'Not found';
      throw new Error(msg);
    }
    const contentType = res.headers.get('content-type') || '';
    const blob = await res.blob();
    return { blob, contentType };
  };

  const previewMedia = async (msg) => {
    setMediaFetchError((prev) => ({ ...prev, [msg._id]: '' }));
    if (mediaLoading[msg._id]) return;
    const mediaId = getMediaIdFromUrl(msg?.media?.url);
    if (!mediaId) {
      setMediaFetchError((prev) => ({ ...prev, [msg._id]: 'Media id tidak valid' }));
      return;
    }
    try {
      setMediaLoading((prev) => ({ ...prev, [msg._id]: true }));
      // Show an in-app preview modal first; only render media when blob is ready.
      setPreviewOpen(true);
      setPreviewTitle(`Media ${msg.media?.type || ''}`.trim());
      setPreviewContentType('');
      if (previewUrl) {
        try {
          URL.revokeObjectURL(previewUrl);
        } catch {}
        setPreviewUrl('');
      }

      const { blob, contentType } = await fetchMediaBlob(mediaId);
      const objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl);
      setPreviewContentType(contentType || '');
    } catch (err) {
      setMediaFetchError((prev) => ({ ...prev, [msg._id]: err?.message || 'Gagal ambil media' }));
      setPreviewOpen(true);
    } finally {
      setMediaLoading((prev) => ({ ...prev, [msg._id]: false }));
    }
  };

  const downloadMedia = async (msg) => {
    setMediaFetchError((prev) => ({ ...prev, [msg._id]: '' }));
    if (mediaLoading[msg._id]) return;
    const mediaId = getMediaIdFromUrl(msg?.media?.url);
    if (!mediaId) {
      setMediaFetchError((prev) => ({ ...prev, [msg._id]: 'Media id tidak valid' }));
      return;
    }
    try {
      setMediaLoading((prev) => ({ ...prev, [msg._id]: true }));
      const { blob, contentType } = await fetchMediaBlob(mediaId);
      const objectUrl = URL.createObjectURL(blob);
      const ext = contentType.includes('video') ? 'mp4' : contentType.includes('image') ? 'jpg' : 'bin';
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `media-${mediaId}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      setMediaFetchError((prev) => ({ ...prev, [msg._id]: err?.message || 'Gagal download media' }));
    } finally {
      setMediaLoading((prev) => ({ ...prev, [msg._id]: false }));
    }
  };

  const formatTimeHHmm = (isoOrDate) => {
    try {
      const d = new Date(isoOrDate);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  if (!isAuthed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="card p-8 w-full max-w-lg space-y-6">
          <div className="flex items-center gap-3">
            <div className="logo">W</div>
            <div>
              <p className="label text-lg">Nagatech Wablas</p>
              <p className="muted text-sm">Silakan login untuk melanjutkan</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm muted">Email</label>
              <input
                className="mt-1 w-full rounded-xl border px-4 py-2"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-elevated)' }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="text-sm muted">Password</label>
              <input
                type="password"
                className="mt-1 w-full rounded-xl border px-4 py-2"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-elevated)' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {authError && <p className="text-red-500 text-sm">{authError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => handleAuth('login')}
                className="px-4 py-2 rounded-xl btn-primary font-semibold"
              >
                Login
              </button>
              <button
                onClick={() => handleAuth('register')}
                className="px-4 py-2 rounded-xl btn-outline"
              >
                Register
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo">N</div>
          <div>
            <p className="label">Nagatech Wablas</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`nav-item ${activeTab === 'messages' ? 'active' : ''}`}
            onClick={() => setActiveTab('messages')}
          >
            Messages
          </button>
          <button
            className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
          <button
            className={`nav-item ${activeTab === 'list_ids' ? 'active' : ''}`}
            onClick={() => setActiveTab('list_ids')}
          >
            List Nomor &amp; ID
          </button>
          <button
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </nav>
        <div className="sidebar-footer">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="btn-outline w-full"
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      <div className="content">
        {copyNotice ? <div className="toast">{copyNotice}</div> : null}
        {previewOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal">
              <div className="modal-header">
                <p className="modal-title">{previewTitle || 'Preview Media'}</p>
                <button className="modal-x" onClick={closePreview} type="button" aria-label="Close">
                  ×
                </button>
              </div>
              <div className="modal-body">
                {!previewUrl ? (
                  <div className="preview-loading">
                    <span className="spinner" />
                    <span className="muted text-sm">Loading media…</span>
                  </div>
                ) : previewContentType.startsWith('image/') ? (
                  <img className="preview-media" src={previewUrl} alt="Preview" />
                ) : previewContentType.startsWith('video/') ? (
                  <video className="preview-media" src={previewUrl} controls />
                ) : (
                  <div className="muted text-sm">Format media tidak didukung untuk preview. Silakan download.</div>
                )}
              </div>
              <div className="modal-actions">
                <button className="px-4 py-2 rounded-xl btn-outline" onClick={closePreview} type="button">
                  Close
                </button>
                {previewUrl ? (
                  <button
                    className="px-4 py-2 rounded-xl btn-primary font-semibold"
                    type="button"
                    onClick={() => {
                      // Only open when we already have content, so no blank tabs.
                      window.open(previewUrl, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    Open New Tab
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}
        {confirmOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal">
              <div className="modal-header">
                <p className="modal-title">
                  {confirmKind === 'reset' ? 'Reset WhatsApp Session' : 'Disconnect WhatsApp'}
                </p>
                <button className="modal-x" onClick={closeConfirm} type="button" aria-label="Close">
                  ×
                </button>
              </div>
              <div className="modal-body">
                {confirmKind === 'reset' ? (
                  <p className="muted text-sm">
                    Ini akan menghapus auth state WhatsApp di server. Kamu perlu scan QR lagi. (History chat user juga akan
                    dibersihkan.)
                  </p>
                ) : (
                  <p className="muted text-sm">
                    Ini hanya memutus koneksi WhatsApp di server. Linked device di HP mungkin tetap muncul sampai kamu
                    logout dari HP.
                  </p>
                )}
              </div>
              <div className="modal-actions">
                <button className="px-4 py-2 rounded-xl btn-outline" onClick={closeConfirm} type="button">
                  Cancel
                </button>
                <button
                  className="px-4 py-2 rounded-xl btn-primary font-semibold"
                  onClick={confirmProceed}
                  type="button"
                  disabled={isDisconnecting || isResettingWa}
                >
                  {isDisconnecting || isResettingWa ? (
                    <span className="btn-inline">
                      <span className="spinner" /> Processing…
                    </span>
                  ) : confirmKind === 'reset' ? (
                    'Reset'
                  ) : (
                    'Disconnect'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        <header className="topbar">
          <div>
            <h1>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
            <p className="muted">API Server: {apiUrl}</p>
          </div>
          {accessToken ? (
            <div className="account" ref={accountRef}>
              <button
                className="account-trigger"
                onClick={() => setShowAccountMenu((prev) => !prev)}
              >
                <span className="account-avatar">
                  {(user?.email || sessionEmail || 'A').slice(0, 1).toUpperCase()}
                </span>
                <span className="account-email">{user?.email || sessionEmail || 'Account'}</span>
                <span className="account-caret">▾</span>
              </button>
              {showAccountMenu && (
                <div className="account-menu">
                  <button className="account-item logout" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </header>

        {activeTab === 'overview' && (
          <section className="stats">
            <div className="stat-card">
              <p className="muted text-xs">WhatsApp Status</p>
              <p className="text-lg font-semibold">{waInfo.waStatus}</p>
              <p className="muted text-xs">{waInfo.waPhone || 'No device'}</p>
            </div>
            <div className="stat-card">
              <p className="muted text-xs">Total Chats</p>
              <p className="text-lg font-semibold">{chats.length}</p>
              <p className="muted text-xs">Synced from WA</p>
            </div>
            <div className="stat-card">
              <p className="muted text-xs">Messages Loaded</p>
              <p className="text-lg font-semibold">{messages.length}</p>
              <p className="muted text-xs">Latest activity</p>
            </div>
          </section>
        )}

        {activeTab === 'messages' && (
          <section className="grid-two">
            <div className="card p-6 space-y-4">
              <h2 className="text-xl font-semibold">Send Message</h2>
              <div>
                <label className="text-sm muted">To (phone or group id)</label>
                <input
                  className="mt-1 w-full rounded-xl border px-4 py-2"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-elevated)' }}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="6281234567890 or 12345-67890@g.us"
                />
              </div>
              <div>
                <label className="text-sm muted">Text</label>
                <textarea
                  className="mt-1 w-full rounded-xl border px-4 py-2 min-h-[90px]"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-elevated)' }}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm muted">Attachment</label>
                <div className="attach-row mt-2">
                  <button
                    type="button"
                    className="attach-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!apiKey || isSending}
                    title="Attach photo/video"
                    aria-label="Attach"
                  >
                    +
                  </button>
                  <div className="attach-hint muted text-sm">
                    Pilih foto/video dari laptop. (Jika pilih lebih dari 1 file, akan terkirim sebagai beberapa pesan.)
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => addAttachments(e.target.files)}
                  />
                </div>

                {attachments.length > 0 && (
                  <div className="attach-chips mt-3">
                    {attachments.map((f, idx) => (
                      <div key={`${f.name}:${f.size}:${f.lastModified}`} className="file-chip">
                        <span className="file-chip-name" title={f.name}>
                          {f.name}
                        </span>
                        <button
                          type="button"
                          className="file-chip-x"
                          onClick={() => removeAttachmentAt(idx)}
                          aria-label="Remove attachment"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="link-btn mt-3"
                  onClick={() => setShowAdvancedUrl((prev) => !prev)}
                >
                  {showAdvancedUrl ? 'Hide media URL' : 'Use media URL (advanced)'}
                </button>
                {showAdvancedUrl && (
                  <div className="mt-2">
                    <label className="text-xs muted">Media URL</label>
                    <input
                      className="mt-1 w-full rounded-xl border px-4 py-2"
                      style={{ borderColor: 'var(--border)', background: 'var(--surface-elevated)' }}
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      placeholder="http://..."
                    />
                  </div>
                )}
              </div>
              <button
                onClick={handleSend}
                className="px-4 py-2 rounded-xl btn-primary font-semibold"
                disabled={!apiKey || isSending || !to || !(text?.trim() || mediaUrl || attachments.length > 0)}
              >
                {isSending ? (
                  <span className="btn-inline">
                    <span className="spinner" /> Sending…
                  </span>
                ) : (
                  'Send'
                )}
              </button>
              {sendResult && <p className="text-sm muted">{sendResult}</p>}
            </div>
          </section>
        )}

        {activeTab === 'history' && (
          <section className="grid-two">
            <div className="card p-6 space-y-4">
              <h2 className="text-xl font-semibold">History</h2>
              <div className="history-split">
                <div className="history-panel">
                  <div className="history-panel-header">
                    <div>
                      <p className="text-sm font-semibold">Chat list</p>
                      <p className="text-xs muted">{chats.length} chat(s)</p>
                    </div>
                  </div>
                  <div className="history-panel-body">
                    {chats.length === 0 ? (
                      <div className="history-empty muted text-sm">Belum ada chat.</div>
                    ) : (
                      <div className="space-y-2">
                        {chats.map((chat) => (
                          <button
                            key={chat.waChatId}
                            onClick={() => setSelectedChat(chat.waChatId)}
                            className="w-full text-left p-3 rounded-xl border history-item"
                            style={{
                              borderColor: selectedChat === chat.waChatId ? 'var(--accent)' : 'var(--border)',
                              background: selectedChat === chat.waChatId ? 'var(--accent-soft)' : 'transparent'
                            }}
                          >
                            <div className="history-item-top">
                              <p className="text-sm font-semibold truncate">
                                {displayLabelForChat(chat) || chat.waChatId}
                              </p>
                              <span className="history-pill">
                                {chat.isGroup ? 'Group' : 'Contact'}
                              </span>
                            </div>
                            <p className="text-xs muted truncate">{chat.waChatId}</p>
                            <p className="text-xs muted truncate">{chat.lastMessage || '-'}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="history-divider" />

                <div className="history-panel">
                  <div className="history-panel-header">
                    <div className="history-panel-title">
                      <p className="text-sm font-semibold">Messages</p>
                      <p className="text-xs muted">
                        {selectedChat
                          ? `${selectedChat}${displayLabelForChat(selectedChatInfo) ? ` (${displayLabelForChat(selectedChatInfo)})` : ''}`
                          : 'Pilih chat untuk melihat pesan'}
                      </p>
                    </div>
                    {selectedChat && (
                      <button
                        className="history-close"
                        onClick={handleExitHistoryChat}
                        title="Exit chat"
                        type="button"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="history-panel-body">
                    {!selectedChat ? (
                      <div className="history-empty muted text-sm">
                        Pilih salah satu chat di sebelah kiri.
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="history-empty muted text-sm">Belum ada pesan.</div>
                    ) : (
                      <div className="space-y-2">
                        {messages.map((msg) => (
                          <div
                            key={msg._id}
                            className={`msg-row ${msg.direction === 'outbound' ? 'msg-right' : 'msg-left'}`}
                          >
                            <div
                              className={`msg-bubble ${msg.direction === 'outbound' ? 'msg-out' : 'msg-in'}`}
                            >
                              <p className="text-sm msg-text">{msg.text || '-'}</p>
                              {msg.media?.url && (
                                <div className="msg-media">
                                  <div className="msg-media-row">
                                    <span className="msg-media-label text-xs muted">
                                      {msg.media?.type ? `Media: ${msg.media.type}` : 'Media'}
                                    </span>
                                    <div className="msg-media-actions">
                                      <button
                                        type="button"
                                        className="msg-media-btn btn-soft"
                                        onClick={() => previewMedia(msg)}
                                        disabled={!!mediaLoading[msg._id]}
                                      >
                                        {mediaLoading[msg._id] ? (
                                          <span className="btn-inline">
                                            <span className="spinner" /> Loading…
                                          </span>
                                        ) : (
                                          'Preview'
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        className="msg-media-btn btn-outline"
                                        onClick={() => downloadMedia(msg)}
                                        disabled={!!mediaLoading[msg._id]}
                                      >
                                        Download
                                      </button>
                                    </div>
                                  </div>
                                  {mediaFetchError[msg._id] ? (
                                    <div className="text-xs muted msg-media-error">
                                      Error: {mediaFetchError[msg._id]}
                                    </div>
                                  ) : null}
                                </div>
                              )}
                              <div className="msg-meta">
                                <span>{formatTimeHHmm(msg.createdAt)}</span>
                                {msg.direction === 'outbound' && <span className="msg-check">✓✓</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'list_ids' && (
          <section className="grid-two">
            <div className="card p-6 space-y-4">
              <h2 className="text-xl font-semibold">List Nomor &amp; ID</h2>
              <p className="muted text-sm">
                Ini adalah daftar chat ID yang bisa kamu pakai untuk kirim pesan. Nama contact memakai nama profil WhatsApp (jika ada),
                dan nama grup memakai subject grup.
              </p>
              {chats.length === 0 ? (
                <div className="history-empty muted text-sm">Belum ada chat.</div>
              ) : (
                <div className="space-y-2">
                  {chats.map((chat) => (
                    <div key={chat.waChatId} className="list-row">
                      <div className="list-row-main">
                        <div className="list-row-top">
                          <p className="text-sm font-semibold truncate">
                            {displayLabelForChat(chat) || '-'}
                          </p>
                          <span className="history-pill">{chat.isGroup ? 'Group' : 'Contact'}</span>
                        </div>
                        <p className="text-xs muted truncate">{chat.waChatId}</p>
                      </div>
                      <div className="list-actions">
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl btn-outline list-copy"
                          onClick={() => copyToClipboard(chat.waChatId)}
                        >
                          Copy ID
                        </button>
                        {editingChatId === chat.waChatId ? (
                          <div className="list-edit">
                            <input
                              className="rounded-xl border px-3 py-2 list-edit-input"
                              style={{ borderColor: 'var(--border)', background: 'var(--surface-elevated)' }}
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              placeholder="Nama (override)"
                              disabled={isSavingName}
                            />
                            <button
                              type="button"
                              className="px-3 py-2 rounded-xl btn-primary font-semibold"
                              onClick={() => saveEditChatName(chat.waChatId)}
                              disabled={isSavingName}
                            >
                              {isSavingName ? (
                                <span className="btn-inline">
                                  <span className="spinner" /> Saving…
                                </span>
                              ) : (
                                'Save'
                              )}
                            </button>
                            <button
                              type="button"
                              className="px-3 py-2 rounded-xl btn-outline"
                              onClick={cancelEditChatName}
                              disabled={isSavingName}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="px-3 py-2 rounded-xl btn-outline"
                            onClick={() => beginEditChatName(chat)}
                          >
                            Edit Nama
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'settings' && (
          <section className="grid-two">
            <div className="card p-6 space-y-6">
              <h2 className="text-xl font-semibold">Profile</h2>
              <div className="space-y-3">
                <p className="text-sm">Email: {user?.email || sessionEmail}</p>
                <p className="muted text-sm">Status: {waInfo.waStatus}</p>
              </div>
            </div>

            <div className="card p-6 space-y-5">
              <h2 className="text-xl font-semibold">WhatsApp Connection</h2>
              <div className="flex items-center gap-4">
                <span className="pill">{waInfo.waStatus}</span>
                {waInfo.waPhone && <span className="muted">{waInfo.waPhone}</span>}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleConnect}
                  className="px-4 py-2 rounded-xl btn-primary font-semibold"
                  disabled={!isAuthed || isConnecting}
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
                <button
                  onClick={handleRefreshQr}
                  className="px-4 py-2 rounded-xl btn-outline"
                  disabled={!isAuthed || isConnecting}
                >
                  {isConnecting ? 'Refreshing...' : 'Refresh QR'}
                </button>
                <button
                  onClick={() => openConfirm('disconnect')}
                  className="px-4 py-2 rounded-xl btn-outline"
                  disabled={!isAuthed || isDisconnecting || isResettingWa}
                >
                  {isDisconnecting ? (
                    <span className="btn-inline">
                      <span className="spinner" /> Disconnecting…
                    </span>
                  ) : (
                    'Disconnect'
                  )}
                </button>
                <button
                  onClick={() => openConfirm('reset')}
                  className="px-4 py-2 rounded-xl btn-outline"
                  disabled={!isAuthed || isResettingWa || isDisconnecting}
                >
                  {isResettingWa ? (
                    <span className="btn-inline">
                      <span className="spinner" /> Resetting…
                    </span>
                  ) : (
                    'Reset Session'
                  )}
                </button>
              </div>
              {connectNotice && <p className="text-sm muted">{connectNotice}</p>}
              {waInfo?.waLastError && (
                <p className="text-sm" style={{ color: '#b91c1c' }}>
                  Last error: {waInfo.waLastError}
                </p>
              )}
              {qrAgeSeconds !== null && (
                <p className="text-sm muted">QR age: {qrAgeSeconds}s</p>
              )}
              {qr && (
                <div className="bg-white p-4 rounded-xl inline-block">
                  <img src={qr} alt="QR Code" className="w-48 h-48" />
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
