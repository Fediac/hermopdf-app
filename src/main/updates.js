'use strict';
// İsteğe bağlı ağ: yeni sürüm bildirimi ve (Pro lisansı varsa) iptal listesi.
//
// Davranış (sitedeki gizlilik sayfası bunu anlatır):
//  - settings.updateCheck === true DEĞİLSE hiçbir şey indirilmez (varsayılan: sorulmadı → kapalı).
//  - Açıksa: açılıştan ~10 sn sonra, son denetimin üzerinden 24 saat geçtiyse SITE/updates/latest.json indirilir
//    (en fazla 64 KB, 10 sn zaman aşımı, çerez yok, kişisel bilgi yok). Dosya release anahtarıyla doğrulanır;
//    sürüm daha yeniyse arayüz sakin bir bildirim gösterir.
//  - Pro lisansı varsa en fazla 7 günde bir API/v1/revocations indirilir (aynı izinle); lisansın kendi anahtarıyla
//    doğrulanır, eski tarihli liste yok sayılır.
//  - Çevrimdışı / hata: sessizce mevcut durum korunur (geçerli lisans çevrimdışı da etkin kalır).
// Tüm istekler ANA süreçten yapılır; arayüz adres vermez.

const fs = require('fs');
const path = require('path');
const { verifySignedDoc, validateManifest, compareVersions, UPD_PREFIX } = require('./license');

const DAY = 24 * 60 * 60 * 1000;
const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 10000;

async function fetchSmall(url, { userAgent, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      credentials: 'omit',
      headers: { accept: 'application/json', 'user-agent': userAgent || 'HermoPDF' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > maxBytes) throw new Error('çok büyük');
    const chunks = [];
    let total = 0;
    if (res.body) {
      for await (const c of res.body) {
        total += c.length;
        if (total > maxBytes) { ac.abort(); throw new Error('çok büyük'); }
        chunks.push(Buffer.from(c));
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

function createUpdater({ dir, appVersion, keys, license, endpoints, isSiteUrl, getSettings, setSettings, flushSettings, send, openExternal, log = () => {}, delayMs = 10000 }) {
  const stateFile = path.join(dir, 'update-state.json');
  const releaseKeys = Object.fromEntries(Object.entries(keys).filter(([, k]) => k.env === 'release'));
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}; } catch (e) { st = {}; }
  let timer = null;
  let running = null;
  const ua = `HermoPDF/${appVersion}`;

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(st, null, 1));
      fs.renameSync(`${stateFile}.tmp`, stateFile);
    } catch (e) { log('güncelleme durumu yazılamadı:', e.message); }
  }
  const enabled = () => getSettings().updateCheck === true;

  function verifyManifest(doc) {
    const r = verifySignedDoc(doc, UPD_PREFIX, releaseKeys);
    if (!r.ok) return { ok: false, code: r.code };
    const m = validateManifest(r.payload);
    if (!m) return { ok: false, code: 'format' };
    if (!isSiteUrl(m.url)) return { ok: false, code: 'url' };
    return { ok: true, manifest: m, doc: r.doc };
  }

  // Kayıtlı (daha önce doğrulanmış) güncelleme dosyası: her seferinde yeniden doğrulanır
  function available() {
    if (!st.manifest) return null;
    const r = verifyManifest(st.manifest);
    if (!r.ok || !(compareVersions(r.manifest.version, appVersion) > 0)) return null;
    const { version, date, notes } = r.manifest;
    return { version, date, notes, current: appVersion };
  }

  async function checkManifest() {
    st.lastCheck = Date.now();
    save();
    let text;
    try {
      text = await fetchSmall(endpoints().updates, { userAgent: ua });
    } catch (e) {
      log('güncelleme denetlenemedi:', e.name === 'AbortError' ? 'zaman aşımı' : e.message);
      return { status: 'error' };
    }
    const r = verifyManifest(text);
    if (!r.ok) { log('güncelleme dosyası reddedildi:', r.code); return { status: 'error', code: r.code }; }
    // Geriye dönüş yok: daha eski bir dosya, kayıtlı daha yeni bir dosyanın yerini almaz
    const prev = st.manifest && verifyManifest(st.manifest);
    if (!prev || !prev.ok || compareVersions(r.manifest.version, prev.manifest.version) >= 0) {
      st.manifest = r.doc;
      save();
    }
    const a = available();
    if (a) send('update:available', a);
    return a ? { status: 'available', ...a } : { status: 'latest', current: appVersion };
  }

  async function checkRevocations() {
    st.lastRevCheck = Date.now();
    save();
    let text;
    try {
      text = await fetchSmall(endpoints().revocations, { userAgent: ua });
    } catch (e) {
      log('iptal listesi alınamadı:', e.name === 'AbortError' ? 'zaman aşımı' : e.message);
      return { ok: false, code: 'network' };
    }
    const r = license.applyRevocations(text);
    if (!r.ok) { if (r.code !== 'stale') log('iptal listesi yok sayıldı:', r.code); return r; }
    if (r.changed) send('license:changed', r.status);
    return r;
  }

  // force: "Şimdi denetle" — 24 saat / 7 gün sınırı uygulanmaz (izin yine şart)
  function run({ force = false } = {}) {
    if (!enabled()) return Promise.resolve({ status: 'off' });
    if (running) return running;
    running = (async () => {
      const now = Date.now();
      let result = { status: 'skipped' };
      if (force || !(now - (st.lastCheck || 0) < DAY)) result = await checkManifest();
      else { const a = available(); if (a) result = { status: 'available', ...a }; }
      const lic = license.status();
      if ((lic.state === 'active' || lic.state === 'revoked') && (force || !(now - (st.lastRevCheck || 0) < 7 * DAY))) {
        await checkRevocations();
      }
      return result;
    })().catch((e) => { log('denetim hatası:', e.message); return { status: 'error' }; }).finally(() => { running = null; });
    return running;
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!enabled()) return;
    timer = setTimeout(() => { timer = null; run(); }, delayMs);
  }

  function getPrefs() {
    const v = getSettings().updateCheck;
    return { updateCheck: v === true ? true : v === false ? false : null, lastCheck: st.lastCheck || 0, available: enabled() ? available() : null, current: appVersion };
  }

  function setPrefs(p) {
    if (!p || typeof p !== 'object' || typeof p.updateCheck !== 'boolean') throw new Error('Geçersiz ayar');
    setSettings({ updateCheck: p.updateCheck, updateCheckChangedAt: new Date().toISOString() });
    flushSettings();
    log('güncelleme bildirimi:', p.updateCheck ? 'açık' : 'kapalı');
    schedule();
    return getPrefs();
  }

  function openDownload() {
    const r = st.manifest && verifyManifest(st.manifest);
    if (!r || !r.ok || !isSiteUrl(r.manifest.url)) return false;
    return openExternal(r.manifest.url);
  }

  function stop() { clearTimeout(timer); timer = null; }

  return { schedule, run, getPrefs, setPrefs, openDownload, available, stop, verifyManifest };
}

module.exports = { createUpdater, fetchSmall };
