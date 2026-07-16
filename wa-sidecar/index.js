// WA Baileys Sidecar - internal service that manages WhatsApp connections
// Talks only to the FastAPI backend on localhost.

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const PORT = parseInt(process.env.PORT || '3002', 10);
const SIDECAR_TOKEN = process.env.SIDECAR_TOKEN || '';
const BACKEND_CALLBACK_URL = process.env.BACKEND_CALLBACK_URL || 'http://localhost:8001/api/internal/incoming';
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, 'sessions');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const logger = pino({ level: 'warn' });

// In-memory registry of active sockets
// sessionId -> { sock, status, qr, pairingCode, lastError, meta, ready }
const sessions = new Map();

function toJid(input) {
  if (!input) return null;
  if (input.includes('@')) return input;
  const digits = String(input).replace(/[^0-9]/g, '');
  if (!digits) return null;
  // Group JIDs already have @g.us; individual JIDs are @s.whatsapp.net
  return `${digits}@s.whatsapp.net`;
}

async function forwardToBackend(payload) {
  try {
    await axios.post(BACKEND_CALLBACK_URL, payload, {
      headers: { 'X-Sidecar-Token': SIDECAR_TOKEN },
      timeout: 5000,
    });
  } catch (err) {
    // Log but never throw - backend may be temporarily down
    console.error('[sidecar] backend callback failed:', err.message);
  }
}

async function startSession(sessionId, opts = {}) {
  if (sessions.has(sessionId) && sessions.get(sessionId).sock) {
    return sessions.get(sessionId);
  }

  const sessionPath = path.join(SESSIONS_DIR, sessionId);
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: ['UnofficialAPI', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  const entry = {
    sock,
    status: 'connecting',
    qr: null,
    qrDataUrl: null,
    pairingCode: null,
    lastError: null,
    meta: {},
    ready: false,
  };
  sessions.set(sessionId, entry);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      entry.qr = qr;
      try {
        entry.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      } catch (_) { entry.qrDataUrl = null; }
      entry.status = 'qr';
      forwardToBackend({ type: 'connection', sessionId, status: 'qr' });
    }
    if (connection === 'open') {
      entry.status = 'connected';
      entry.ready = true;
      entry.qr = null;
      entry.qrDataUrl = null;
      entry.pairingCode = null;
      entry.meta = {
        me: sock.user || null,
      };
      forwardToBackend({ type: 'connection', sessionId, status: 'connected', me: sock.user || null });
    }
    if (connection === 'close') {
      entry.ready = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      entry.status = shouldReconnect ? 'reconnecting' : 'logged_out';
      entry.lastError = lastDisconnect?.error?.message || null;
      forwardToBackend({ type: 'connection', sessionId, status: entry.status, error: entry.lastError });

      if (shouldReconnect) {
        setTimeout(() => {
          sessions.delete(sessionId);
          startSession(sessionId).catch((e) => console.error('[sidecar] restart failed', e.message));
        }, 2000);
      } else {
        // Purge session dir on logout so a fresh QR can be generated next time
        try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (_) {}
        sessions.delete(sessionId);
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;
    for (const msg of m.messages) {
      if (!msg.message) continue;
      // Skip status broadcasts
      if (msg.key?.remoteJid === 'status@broadcast') continue;

      const fromMe = !!msg.key.fromMe;
      const remoteJid = msg.key.remoteJid;
      const messageId = msg.key.id;
      const timestamp = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);
      const pushName = msg.pushName || null;

      // Extract text
      let text = '';
      let mediaType = null;
      const content = msg.message;
      if (content.conversation) text = content.conversation;
      else if (content.extendedTextMessage?.text) text = content.extendedTextMessage.text;
      else if (content.imageMessage) { text = content.imageMessage.caption || ''; mediaType = 'image'; }
      else if (content.videoMessage) { text = content.videoMessage.caption || ''; mediaType = 'video'; }
      else if (content.audioMessage) { mediaType = 'audio'; }
      else if (content.documentMessage) { text = content.documentMessage.caption || content.documentMessage.fileName || ''; mediaType = 'document'; }
      else if (content.stickerMessage) { mediaType = 'sticker'; }

      forwardToBackend({
        type: 'message',
        sessionId,
        direction: fromMe ? 'outgoing' : 'incoming',
        remoteJid,
        messageId,
        timestamp,
        pushName,
        text,
        mediaType,
      });
    }
  });

  // Message status updates (sent -> delivered -> read)
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates || []) {
      const status = u.update?.status;
      const messageId = u.key?.id;
      if (!messageId || status === undefined || status === null) continue;
      forwardToBackend({
        type: 'status',
        sessionId,
        messageId,
        remoteJid: u.key?.remoteJid || null,
        fromMe: !!u.key?.fromMe,
        status,
      });
    }
  });

  // Message receipt updates (also carries read receipts on some paths)
  sock.ev.on('message-receipt.update', async (updates) => {
    for (const u of updates || []) {
      const rtype = u.receipt?.receiptTimestamp ? (u.receipt?.readTimestamp ? 4 : 3) : null;
      const messageId = u.key?.id;
      if (!messageId || !rtype) continue;
      forwardToBackend({
        type: 'status',
        sessionId,
        messageId,
        remoteJid: u.key?.remoteJid || null,
        fromMe: !!u.key?.fromMe,
        status: rtype,
      });
    }
  });

  // Optional: pairing code request
  if (opts.usePairingCode && opts.phoneNumber && !sock.authState.creds.registered) {
    // Baileys requires a short delay before requesting code
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(String(opts.phoneNumber).replace(/[^0-9]/g, ''));
        entry.pairingCode = code;
        entry.status = 'pairing';
        forwardToBackend({ type: 'connection', sessionId, status: 'pairing', pairingCode: code });
      } catch (e) {
        entry.lastError = e.message;
      }
    }, 3000);
  }

  return entry;
}

// Restore existing sessions on boot
function restoreSessions() {
  const dirs = fs.readdirSync(SESSIONS_DIR).filter((d) => {
    const p = path.join(SESSIONS_DIR, d);
    return fs.statSync(p).isDirectory();
  });
  for (const sid of dirs) {
    startSession(sid).catch((e) => console.error('[sidecar] restore failed', sid, e.message));
  }
}

// ---------------- HTTP API ----------------
const app = express();
app.use(express.json({ limit: '25mb' }));

// Auth middleware
app.use((req, res, next) => {
  const token = req.headers['x-sidecar-token'];
  if (!SIDECAR_TOKEN || token !== SIDECAR_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/sessions', (_req, res) => {
  const list = Array.from(sessions.entries()).map(([id, s]) => ({
    id,
    status: s.status,
    ready: s.ready,
    hasQr: !!s.qr,
    pairingCode: s.pairingCode,
    me: s.meta?.me || null,
    lastError: s.lastError,
  }));
  res.json({ sessions: list });
});

app.post('/sessions', async (req, res) => {
  const { sessionId, usePairingCode, phoneNumber } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  try {
    const s = await startSession(sessionId, { usePairingCode, phoneNumber });
    res.json({ ok: true, id: sessionId, status: s.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json({
    id: req.params.id,
    status: s.status,
    ready: s.ready,
    qr: s.qr,
    qrDataUrl: s.qrDataUrl,
    pairingCode: s.pairingCode,
    me: s.meta?.me || null,
    lastError: s.lastError,
  });
});

app.delete('/sessions/:id', async (req, res) => {
  const sid = req.params.id;
  const s = sessions.get(sid);
  if (s && s.sock) {
    try { await s.sock.logout(); } catch (_) {}
    try { s.sock.end(); } catch (_) {}
  }
  sessions.delete(sid);
  const p = path.join(SESSIONS_DIR, sid);
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
  res.json({ ok: true });
});

app.post('/sessions/:id/pair', async (req, res) => {
  const sid = req.params.id;
  const { phoneNumber } = req.body || {};
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });
  let s = sessions.get(sid);
  if (!s) {
    s = await startSession(sid, { usePairingCode: true, phoneNumber });
    return res.json({ ok: true, message: 'pairing_pending' });
  }
  if (s.ready) return res.status(400).json({ error: 'already connected' });
  try {
    const code = await s.sock.requestPairingCode(String(phoneNumber).replace(/[^0-9]/g, ''));
    s.pairingCode = code;
    s.status = 'pairing';
    res.json({ ok: true, pairingCode: code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function ensureReady(sid, res) {
  const s = sessions.get(sid);
  if (!s || !s.ready) {
    res.status(409).json({ error: 'session not connected' });
    return null;
  }
  return s;
}

app.post('/sessions/:id/send-text', async (req, res) => {
  const s = ensureReady(req.params.id, res);
  if (!s) return;
  const { to, text } = req.body || {};
  const jid = toJid(to);
  if (!jid || !text) return res.status(400).json({ error: 'to and text required' });
  try {
    const result = await s.sock.sendMessage(jid, { text });
    res.json({ ok: true, messageId: result.key.id, jid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/sessions/:id/send-media', upload.single('file'), async (req, res) => {
  const s = ensureReady(req.params.id, res);
  if (!s) return;
  const { to, caption, mediaType, filename, mimetype } = req.body || {};
  const jid = toJid(to);
  if (!jid || !req.file) return res.status(400).json({ error: 'to and file required' });
  const buf = req.file.buffer;
  const mtype = (mediaType || 'image').toLowerCase();
  const mime = mimetype || req.file.mimetype;
  let payload = {};
  if (mtype === 'image') payload = { image: buf, caption: caption || '', mimetype: mime };
  else if (mtype === 'video') payload = { video: buf, caption: caption || '', mimetype: mime };
  else if (mtype === 'audio') payload = { audio: buf, mimetype: mime || 'audio/mp4', ptt: false };
  else if (mtype === 'document') payload = { document: buf, mimetype: mime, fileName: filename || req.file.originalname || 'file' };
  else return res.status(400).json({ error: 'invalid mediaType' });
  try {
    const result = await s.sock.sendMessage(jid, payload);
    res.json({ ok: true, messageId: result.key.id, jid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/sessions/:id/broadcast', async (req, res) => {
  const s = ensureReady(req.params.id, res);
  if (!s) return;
  const { recipients, text } = req.body || {};
  if (!Array.isArray(recipients) || !text) return res.status(400).json({ error: 'recipients[] and text required' });
  const results = [];
  for (const r of recipients) {
    const jid = toJid(r);
    if (!jid) { results.push({ to: r, ok: false, error: 'invalid' }); continue; }
    try {
      const out = await s.sock.sendMessage(jid, { text });
      results.push({ to: r, ok: true, messageId: out.key.id });
      // Simple throttle to avoid ban
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      results.push({ to: r, ok: false, error: e.message });
    }
  }
  res.json({ ok: true, results });
});

app.get('/sessions/:id/groups', async (req, res) => {
  const s = ensureReady(req.params.id, res);
  if (!s) return;
  try {
    const groups = await s.sock.groupFetchAllParticipating();
    const list = Object.values(groups).map((g) => ({
      id: g.id,
      subject: g.subject,
      size: g.participants?.length || 0,
      owner: g.owner || null,
    }));
    res.json({ groups: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/sessions/:id/groups', async (req, res) => {
  const s = ensureReady(req.params.id, res);
  if (!s) return;
  const { subject, participants } = req.body || {};
  if (!subject || !Array.isArray(participants)) return res.status(400).json({ error: 'subject and participants[] required' });
  try {
    const jids = participants.map(toJid).filter(Boolean);
    const result = await s.sock.groupCreate(subject, jids);
    res.json({ ok: true, id: result.id, subject: result.subject });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/sessions/:id/groups/:gid/participants', async (req, res) => {
  const s = ensureReady(req.params.id, res);
  if (!s) return;
  const { action, participants } = req.body || {};
  if (!['add', 'remove', 'promote', 'demote'].includes(action)) return res.status(400).json({ error: 'invalid action' });
  try {
    const jids = participants.map(toJid).filter(Boolean);
    const gid = req.params.gid.includes('@g.us') ? req.params.gid : `${req.params.gid}@g.us`;
    const result = await s.sock.groupParticipantsUpdate(gid, jids, action);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[sidecar] listening on 127.0.0.1:${PORT}`);
  restoreSessions();
});
