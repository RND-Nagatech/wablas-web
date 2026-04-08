const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const apiUrl = API_URL;

const jsonHeaders = (token) => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {})
});

export const authRegister = async (email, password) => {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password })
  });
  return res.json();
};

export const authLogin = async (email, password) => {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password })
  });
  return res.json();
};

export const authRefresh = async (refreshToken) => {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ refreshToken })
  });
  return res.json();
};

export const authMe = async (accessToken) => {
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: jsonHeaders(accessToken)
  });
  return res.json();
};

export const waStatus = async (accessToken) => {
  const res = await fetch(`${API_URL}/wa/status`, {
    headers: jsonHeaders(accessToken)
  });
  return res.json();
};

export const waConnect = async (accessToken, force = false) => {
  const url = force ? `${API_URL}/wa/connect?force=1` : `${API_URL}/wa/connect`;
  const res = await fetch(url, {
    method: 'POST',
    headers: jsonHeaders(accessToken)
  });
  return res.json();
};

export const waQr = async (accessToken) => {
  const res = await fetch(`${API_URL}/wa/qr`, {
    headers: jsonHeaders(accessToken)
  });
  return res.json();
};

export const waDisconnect = async (accessToken) => {
  const res = await fetch(`${API_URL}/wa/disconnect`, {
    method: 'POST',
    headers: jsonHeaders(accessToken)
  });
  return res.json();
};

export const waReset = async (accessToken) => {
  const res = await fetch(`${API_URL}/wa/reset`, {
    method: 'POST',
    headers: jsonHeaders(accessToken)
  });
  return res.json();
};

export const sendText = async (apiKey, to, text) => {
  const res = await fetch(`${API_URL}/api/send-text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ to, text })
  });
  return res.json();
};

export const sendMedia = async (apiKey, to, text, mediaUrl) => {
  const res = await fetch(`${API_URL}/api/send-media`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ to, text, media_url: mediaUrl })
  });
  return res.json();
};

export const listChats = async (apiKey, signal) => {
  const res = await fetch(`${API_URL}/api/history/chats`, {
    headers: { 'X-API-KEY': apiKey },
    signal
  });
  return res.json();
};

export const listIds = async (apiKey, signal) => {
  const res = await fetch(`${API_URL}/api/list-ids`, {
    headers: { 'X-API-KEY': apiKey },
    signal
  });
  return res.json();
};

export const chatHistory = async (apiKey, waChatId, signal) => {
  const res = await fetch(`${API_URL}/api/history/chats/${encodeURIComponent(waChatId)}`, {
    headers: { 'X-API-KEY': apiKey },
    signal
  });
  return res.json();
};

export const uploadMedia = async (apiKey, file) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey },
    body: form
  });
  return res.json();
};

export const setChatDisplayName = async (apiKey, waChatId, displayName) => {
  const res = await fetch(`${API_URL}/api/chats/${encodeURIComponent(waChatId)}/display-name`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ displayName })
  });
  return res.json();
};
