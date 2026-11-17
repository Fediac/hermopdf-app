'use strict';
// Claude bağlantısı (ana süreç tarafı).
// Claude Desktop'taki yerel MCP sunucusu (src/mcp/server.mjs) bu adlandırılmış boruya bağlanır, köprü dosyasındaki
// anahtarla kendini tanıtır ve istekleri satır satır JSON olarak gönderir. İstekler arayüze (claude.js) iletilir,
// yanıtlar aynı yoldan geri döner. Bağlantı varsayılan olarak KAPALI; yalnızca kullanıcı açınca dinlenir.
// HermoPDF hiçbir sunucuya bağlanmaz. Not: Windows adlandırılmış boruları SMB üzerinden (\\bilgisayar\pipe\...) de
// açılabilir; Node bunu engelleyemez. Bu yüzden boru adı her açılışta rastgeledir, ilk ileti anahtarlı "hello"
// olmak zorundadır ve tanıtılmamış bağlantılar ayrı, küçük bir sınıra takılır (Claude'un yerini kapatamazlar).
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { ipcMain } = require('electron');

const PROTOCOL = 1;
const BRIDGE_FILE = 'claude-bridge.json';
const MAX_LINE = 256 * 1024; // gelen tek satır (istek) sınırı
const MAX_CLIENTS = 4; // anahtarla tanıtılmış bağlantılar
const MAX_UNAUTHED = 4; // henüz "hello" göndermemiş bağlantılar (ayrı sınır)
const MAX_INFLIGHT = 8; // istemci başına aynı anda bekleyen istek
const HELLO_TIMEOUT = 5000;
const MIN = 60 * 1000;

// İzin verilen yöntemler ve zaman aşımları (ms). Listede olmayan yöntem arayüze hiç gitmez.
const METHODS = {
  ping: 10000,
  list_documents: MIN,
  read_text: 2 * MIN,
  search_text: 2 * MIN,
  render_page: MIN,
  goto_page: MIN,
  rotate_pages: 2 * MIN,
  delete_pages: 2 * MIN,
  move_pages: 2 * MIN,
  extract_pages: 2 * MIN,
  insert_blank_page: MIN,
  add_text: MIN,
  add_note: MIN,
  highlight_text: 2 * MIN,
  compress: 10 * MIN,
  ocr_pages: 15 * MIN,
  mark_redaction: 2 * MIN,
  undo: MIN,
  save_document: 10 * MIN, // kullanıcının kararını bekler
  open_pdf: 5 * MIN, // kullanıcının onayını bekler
};

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

// Boru adı her açılışta rastgele (köprü dosyasına yazılır): başka bir kullanıcı adı önceden alıp
// bağlantıyı engelleyemez, tahmin edip bağlanmayı deneyemez.
function pipeName() {
  const name = `hermopdf-claude-${crypto.randomBytes(12).toString('hex')}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
}

// Yalnızca testte: yöntem başına daha kısa zaman aşımı ({"save_document":3000} gibi)
function sanitizeOverrides(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o)) if (Object.prototype.hasOwnProperty.call(METHODS, k) && Number.isFinite(v) && v > 0) out[k] = Math.min(v, METHODS[k]);
  return out;
}

function createBridge({ app, getWindow, isRendererReady, log, timeoutOverrides = null }) {
  let server = null;
  let listening = false;
  let token = null;
  let lastError = null;
  let seq = 0;
  let pipe = null;
  const sockets = new Set();
  const pending = new Map(); // callId -> { sock, id, timer, method }
  const bridgeFile = () => path.join(app.getPath('userData'), BRIDGE_FILE);
  const overrides = sanitizeOverrides(timeoutOverrides);
  const timeoutFor = (m) => overrides[m] || METHODS[m];

  function clientCount() {
    let n = 0;
    for (const s of sockets) if (s.__authed) n++;
    return n;
  }
  // Zaman aşımı / kapatma: arayüz henüz başlamamış işi atlasın, açık onay penceresini kapatsın
  function cancelInRenderer(callId) {
    const w = getWindow();
    if (!w || w.isDestroyed()) return;
    try { w.webContents.send('claude:cancel', { callId }); } catch (e) { /* yoksay */ }
  }
  function status() {
    return { running: listening, clients: clientCount(), pipe, error: lastError, bridgeFile: bridgeFile() };
  }
  function emit() {
    const w = getWindow();
    if (!w || w.isDestroyed()) return;
    try { w.webContents.send('claude:clients', status()); } catch (e) { /* yoksay */ }
  }

  function send(sock, obj) {
    if (!sock || sock.destroyed || !sock.writable) return;
    try { sock.write(`${JSON.stringify(obj)}\n`); } catch (e) { /* yoksay */ }
  }
  function sendError(sock, id, code, message) {
    send(sock, { id: id ?? null, error: { code, message } });
  }

  function writeBridgeFile() {
    const f = bridgeFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ pipe, token, pid: process.pid, version: app.getVersion(), protocol: PROTOCOL }, null, 1));
    fs.renameSync(tmp, f);
  }
  function deleteBridgeFile() {
    try { fs.rmSync(bridgeFile(), { force: true }); } catch (e) { log('köprü dosyası silinemedi:', e.message); }
  }

  // ---------------- istemci ----------------
  function onConnection(sock) {
    // Tanıtılmamış bağlantılar ayrı sayılır ve tanıtılmış Claude bağlantılarının yerini dolduramaz.
    // Sınır doluysa yeni geleni değil EN ESKİ tanıtılmamış bağlantıyı kapat: boşta bekleyen bağlantılar
    // Claude'un (bağlanır bağlanmaz anahtarını gönderen) yeni bağlantısını engelleyemesin.
    if (sockets.size - clientCount() >= MAX_UNAUTHED) {
      for (const s of sockets) if (!s.__authed) { s.destroy(); sockets.delete(s); break; }
    }
    sockets.add(sock);
    sock.__authed = false;
    sock.__inflight = 0;
    sock.setEncoding('utf8');
    let buf = '';
    const helloTimer = setTimeout(() => { if (!sock.__authed) sock.destroy(); }, HELLO_TIMEOUT);
    sock.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.length > MAX_LINE) { sendError(sock, null, 'too_large', 'Request too large.'); sock.destroy(); return; }
        if (line.trim()) handleLine(sock, line);
        if (sock.destroyed) return;
      }
      if (buf.length > MAX_LINE) { sendError(sock, null, 'too_large', 'Request too large.'); sock.destroy(); }
    });
    sock.on('error', () => { /* close takip eder */ });
    sock.on('close', () => {
      clearTimeout(helloTimer);
      const wasAuthed = sock.__authed;
      sockets.delete(sock);
      for (const [callId, p] of pending) if (p.sock === sock) { clearTimeout(p.timer); pending.delete(callId); }
      if (wasAuthed) { log('Claude istemcisi ayrıldı'); emit(); }
    });
  }

  function handleLine(sock, line) {
    let msg;
    try { msg = JSON.parse(line); } catch (e) {
      sendError(sock, null, 'bad_json', 'Invalid JSON.');
      if (!sock.__authed) sock.destroy();
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { sendError(sock, null, 'bad_request', 'Invalid message.'); if (!sock.__authed) sock.destroy(); return; }
    if (!sock.__authed) {
      // İlk ileti mutlaka anahtarlı "hello" olmalı; değilse bağlantı kapanır.
      const ok = msg.type === 'hello' && typeof msg.token === 'string' && msg.token.length <= 512 && token != null
        && crypto.timingSafeEqual(hash(msg.token), hash(token));
      if (!ok) {
        log('Claude bağlantısı reddedildi (anahtar uyuşmadı)');
        send(sock, { type: 'hello', ok: false, error: { code: 'auth', message: 'Authentication failed.' } });
        sock.end();
        setTimeout(() => sock.destroy(), 200);
        return;
      }
      if (clientCount() >= MAX_CLIENTS) {
        send(sock, { type: 'hello', ok: false, error: { code: 'too_many_clients', message: 'Too many Claude connections to HermoPDF.' } });
        sock.end();
        setTimeout(() => sock.destroy(), 200);
        return;
      }
      sock.__authed = true;
      send(sock, { type: 'hello', ok: true, protocol: PROTOCOL, version: app.getVersion() });
      log('Claude istemcisi bağlandı');
      emit();
      return;
    }
    const { id, method, params } = msg;
    const idOk = (typeof id === 'string' && id.length <= 64) || (Number.isSafeInteger(id));
    if (!idOk) { sendError(sock, null, 'bad_request', 'Missing or invalid request id.'); return; }
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(METHODS, method)) { sendError(sock, id, 'unknown_method', `Unknown method: ${String(method).slice(0, 60)}`); return; }
    if (params != null && (typeof params !== 'object' || Array.isArray(params))) { sendError(sock, id, 'bad_params', 'params must be an object.'); return; }
    if (sock.__inflight >= MAX_INFLIGHT) { sendError(sock, id, 'too_many_requests', 'Too many requests in flight; wait for earlier ones to finish.'); return; }
    const w = getWindow();
    if (!w || w.isDestroyed() || !isRendererReady()) { sendError(sock, id, 'not_ready', 'HermoPDF is still starting. Try again in a few seconds.'); return; }
    const callId = ++seq;
    sock.__inflight++;
    const timer = setTimeout(() => {
      if (!pending.has(callId)) return;
      pending.delete(callId);
      sock.__inflight = Math.max(0, sock.__inflight - 1);
      cancelInRenderer(callId);
      sendError(sock, id, 'timeout', method === 'save_document'
        ? 'The user did not answer the save request in HermoPDF in time, so the request was withdrawn and its dialog closed. Call list_documents to check whether the document still has unsaved changes before asking again.'
        : 'HermoPDF did not finish in time. If the request had not started yet it was cancelled; if it was already running it may still complete. Call list_documents (or read the document) to check the current state before retrying.');
    }, timeoutFor(method));
    pending.set(callId, { sock, id, timer, method });
    try {
      w.webContents.send('claude:call', { callId, method, params: params || {} });
    } catch (e) {
      clearTimeout(timer);
      pending.delete(callId);
      sock.__inflight = Math.max(0, sock.__inflight - 1);
      sendError(sock, id, 'not_ready', 'HermoPDF window is not available.');
    }
  }

  // Arayüzden gelen yanıt
  ipcMain.removeHandler('claude:reply');
  ipcMain.handle('claude:reply', (e, callId, payload) => {
    const w = getWindow();
    if (!w || e.sender !== w.webContents) return false;
    const p = pending.get(callId);
    if (!p) return false;
    pending.delete(callId);
    clearTimeout(p.timer);
    p.sock.__inflight = Math.max(0, p.sock.__inflight - 1);
    if (payload && payload.error) {
      const er = payload.error;
      sendError(p.sock, p.id, String(er.code || 'error').slice(0, 40), String(er.message || 'Error').slice(0, 4000));
    } else {
      send(p.sock, { id: p.id, result: payload ? payload.result : null });
    }
    return true;
  });

  // Arayüz yeniden yüklendi / çöktü: bekleyen istekler yanıtsız kalmasın
  function failPending(code, message) {
    for (const [callId, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(callId);
      p.sock.__inflight = Math.max(0, p.sock.__inflight - 1);
      cancelInRenderer(callId);
      sendError(p.sock, p.id, code, message);
    }
  }

  // ---------------- aç / kapat ----------------
  function start() {
    if (server) return Promise.resolve(status());
    token = crypto.randomBytes(32).toString('hex');
    pipe = pipeName();
    lastError = null;
    return new Promise((resolve) => {
      const srv = net.createServer(onConnection);
      server = srv;
      srv.maxConnections = MAX_CLIENTS + MAX_UNAUTHED + 2;
      srv.on('error', (e) => {
        log('Claude köprüsü hatası:', e.code || e.message);
        lastError = e.code === 'EADDRINUSE' ? 'in_use' : (e.code || e.message);
        if (!listening) {
          server = null;
          token = null;
          deleteBridgeFile();
          emit();
          resolve(status());
        }
      });
      srv.listen(pipe, () => {
        listening = true;
        try {
          writeBridgeFile();
        } catch (e) {
          log('köprü dosyası yazılamadı:', e.message);
          lastError = 'bridge_file';
        }
        log('Claude köprüsü açıldı:', pipe);
        emit();
        resolve(status());
      });
    });
  }

  function stop() {
    deleteBridgeFile();
    token = null;
    failPending('disabled', 'The Claude connection was turned off in HermoPDF.');
    for (const s of sockets) s.destroy();
    sockets.clear();
    const srv = server;
    server = null;
    const was = listening;
    listening = false;
    if (srv) { try { srv.close(); } catch (e) { /* yoksay */ } }
    if (was) log('Claude köprüsü kapatıldı');
    emit();
    return status();
  }

  return { start, stop, status, failPending, deleteBridgeFile };
}

module.exports = { createBridge, pipeName, METHODS, PROTOCOL, BRIDGE_FILE, MAX_CLIENTS, MAX_UNAUTHED };
