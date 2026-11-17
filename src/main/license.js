'use strict';
// HermoPDF Pro lisansı — biçim v1 (lisans sunucusuyla ortak sözleşme).
//
//   Anahtar : "UPRO1." + b64url(payloadJSON) + "." + b64url(imza)
//   İmza    : Ed25519, "UPRO1." + b64url(payloadJSON) ASCII baytları üzerinde
//   payload : {"v":1,"kid":..,"lid":"L"+16 Crockford base32,"plan":"pro_lifetime","email":..,"iat":..,"env":"live"|"sandbox","txn":..}
//             (+ isteğe bağlı "name"; bilinmeyen ek alanlar yok sayılır, bilinmeyen plan Pro değildir)
//   İptal listesi   : {"payload":b64url(JSON {"v":1,"kid","iat","lids":[..]}),"sig":b64url(Ed25519 "UREV1."+payload)}
//   Güncelleme dos. : {"payload":b64url(JSON {"v":1,"version","date","url","sha256","notes"}),"sig":b64url(Ed25519 "UUPD1."+payload)}
//
// Üst kısım SAF işlevlerdir (Electron gerektirmez, tests/license-unit.js ile sınanır).
// Alttaki küçük durum parçası userData/license.json'ı okur/yazar; "pro" bayrağı asla saklanmaz,
// anahtar her açılışta yeniden doğrulanır.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_PREFIX = 'UPRO1.';
const REV_PREFIX = 'UREV1.';
const UPD_PREFIX = 'UUPD1.';
const PRO_PLANS = ['pro_lifetime'];
const LID_RE = /^L[0-9A-HJKMNP-TV-Z]{16}$/;
const B64URL_RE = /^[A-Za-z0-9_-]*$/;
const MAX_DOC = 64 * 1024;
const SIG_B64_LEN = 86; // 64 bayt Ed25519 imzası, dolgusuz base64url
const LICENSE_ENVS = ['live', 'sandbox'];

// ---------------- yardımcılar ----------------
function b64urlDecode(s) {
  if (typeof s !== 'string' || !B64URL_RE.test(s) || s.length % 4 === 1) return null;
  return Buffer.from(s, 'base64url');
}
const b64urlEncode = (buf) => Buffer.from(buf).toString('base64url');

function parseJsonObject(buf) {
  try {
    const v = JSON.parse(buf.toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

const keyObjects = new Map();
function publicKeyOf(pem) {
  let k = keyObjects.get(pem);
  if (!k) {
    k = crypto.createPublicKey(pem);
    keyObjects.set(pem, k);
  }
  return k;
}
function ed25519Verify(text, sig, pem) {
  try {
    const k = publicKeyOf(pem);
    if (k.asymmetricKeyType !== 'ed25519' || !Buffer.isBuffer(sig) || sig.length !== 64) return false;
    return crypto.verify(null, Buffer.from(text, 'ascii'), k, sig);
  } catch (e) {
    return false;
  }
}

// ---------------- lisans anahtarı ----------------
class LicenseError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Ham anahtarı ya da dosya içeriğini kabul eder: önünde/arkasında yazı, satır kırılmaları, boşluklar,
// '=' dolgusu olabilir. İmza sabit uzunlukta olduğundan anahtarın nerede bittiği kesindir.
function parseKey(text) {
  if (typeof text !== 'string' || text.length > MAX_DOC) throw new LicenseError('format');
  const start = text.indexOf(KEY_PREFIX);
  if (start < 0) throw new LicenseError('format');
  let joined = '';
  for (const tok of text.slice(start).split(/\s+/)) {
    if (!tok) continue;
    if (!/^[A-Za-z0-9_.=-]+$/.test(tok)) break;
    joined += tok;
    if (/^UPRO1\.[A-Za-z0-9_-]+=*\.[A-Za-z0-9_-]{86}/.test(joined)) break;
  }
  const m = /^UPRO1\.([A-Za-z0-9_-]+)={0,2}\.([A-Za-z0-9_-]{86})/.exec(joined);
  if (!m) throw new LicenseError('format');
  const payloadB64 = m[1];
  const sigB64 = m[2];
  const raw = b64urlDecode(payloadB64);
  const sig = b64urlDecode(sigB64);
  if (!raw || !sig || sig.length !== 64) throw new LicenseError('format');
  const payload = parseJsonObject(raw);
  if (!payload) throw new LicenseError('format');
  return { payload, payloadB64, sig, signed: KEY_PREFIX + payloadB64, canonical: `${KEY_PREFIX}${payloadB64}.${sigB64}` };
}

// keys: {kid: {pem, env}}. Sonuç asla fırlatmaz: {ok:true, ...} ya da {ok:false, code}.
// İmzası doğrulanmış ama kabul edilmeyen anahtarlarda (iptal, sandbox, plan) payload da döner.
function verifyKey(key, { keys = {}, allowSandbox = false, revoked = null } = {}) {
  let p;
  try {
    p = typeof key === 'object' && key && key.payload ? key : parseKey(key);
  } catch (e) {
    return { ok: false, code: e.code || 'format' };
  }
  const pl = p.payload;
  if (pl.v !== 1) return { ok: false, code: 'format' };
  if (typeof pl.kid !== 'string') return { ok: false, code: 'format' };
  const k = Object.prototype.hasOwnProperty.call(keys, pl.kid) ? keys[pl.kid] : null;
  if (!k || !LICENSE_ENVS.includes(k.env)) return { ok: false, code: 'unknown_key' };
  if (!ed25519Verify(p.signed, p.sig, k.pem)) return { ok: false, code: 'signature' };
  const base = { payload: pl, kid: pl.kid, env: k.env, canonical: p.canonical };
  // İmzalı ama bozuk içerik (sunucu hatası): kabul etme
  if (pl.env !== k.env || typeof pl.lid !== 'string' || !LID_RE.test(pl.lid) || typeof pl.email !== 'string'
    || !pl.email.includes('@') || !Number.isFinite(pl.iat)) return { ok: false, code: 'format', ...base };
  if (k.env === 'sandbox' && !allowSandbox) return { ok: false, code: 'sandbox_not_allowed', ...base };
  if (!PRO_PLANS.includes(pl.plan)) return { ok: false, code: 'plan', ...base };
  if (revoked && typeof revoked.has === 'function' && revoked.has(pl.lid)) return { ok: false, code: 'revoked', ...base };
  return { ok: true, ...base };
}

// ---------------- imzalı belgeler (iptal listesi, güncelleme dosyası) ----------------
// doc: JSON metni ya da {payload, sig}. keys: {kid: {pem, env}}; envs verilirse yalnız o türdeki anahtarlar.
// payload içinde "kid" varsa yalnız o anahtar denenir.
function verifySignedDoc(doc, prefix, keys = {}, { envs = null } = {}) {
  let d = doc;
  if (typeof d === 'string') {
    if (d.length > MAX_DOC) return { ok: false, code: 'format' };
    try { d = JSON.parse(d); } catch (e) { return { ok: false, code: 'format' }; }
  }
  if (!d || typeof d !== 'object' || typeof d.payload !== 'string' || typeof d.sig !== 'string' || d.payload.length > MAX_DOC) return { ok: false, code: 'format' };
  const raw = b64urlDecode(d.payload);
  const sig = b64urlDecode(d.sig);
  if (!raw || !sig || sig.length !== 64) return { ok: false, code: 'format' };
  const payload = parseJsonObject(raw);
  if (!payload || payload.v !== 1) return { ok: false, code: 'format' };
  let cands = Object.entries(keys).filter(([, k]) => k && typeof k.pem === 'string' && (!envs || envs.includes(k.env)));
  if (payload.kid !== undefined) cands = cands.filter(([kid]) => kid === payload.kid);
  if (!cands.length) return { ok: false, code: 'unknown_key' };
  const text = prefix + d.payload;
  for (const [kid, k] of cands) {
    if (ed25519Verify(text, sig, k.pem)) return { ok: true, payload, kid, doc: { payload: d.payload, sig: d.sig } };
  }
  return { ok: false, code: 'signature' };
}

// ---------------- sürümler ----------------
function parseVersion(v) {
  const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] };
}
// -1 / 0 / 1; geçersiz sürümde NaN (her karşılaştırma yanlış çıkar)
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  // Ön sürüm (1.3.0-beta) asıl sürümden (1.3.0) küçüktür
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : (x.pre.length ? -1 : 1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p > +q ? 1 : -1; } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

function validateManifest(pl) {
  if (!pl || pl.v !== 1) return null;
  if (typeof pl.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pl.version)) return null;
  if (typeof pl.url !== 'string' || pl.url.length > 2048) return null;
  if (typeof pl.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(pl.sha256)) return null;
  const notes = pl.notes && typeof pl.notes === 'object' ? pl.notes : {};
  const str = (s) => (typeof s === 'string' ? s.slice(0, 4000) : '');
  return {
    version: pl.version,
    date: typeof pl.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pl.date) ? pl.date : '',
    url: pl.url,
    sha256: pl.sha256.toLowerCase(),
    notes: { tr: str(notes.tr), en: str(notes.en) },
  };
}

function validateRevocations(pl) {
  if (!pl || pl.v !== 1 || typeof pl.kid !== 'string' || !Number.isFinite(pl.iat) || !Array.isArray(pl.lids)) return null;
  return { kid: pl.kid, iat: pl.iat, lids: new Set(pl.lids.filter((x) => typeof x === 'string')) };
}

// ---------------- durum (userData/license.json) ----------------
function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}
function writeJsonAtomic(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, f);
}

function createLicenseStore({ dir, keys, allowSandbox = false, log = () => {} }) {
  const licFile = path.join(dir, 'license.json');
  const revFile = path.join(dir, 'license-revocations.json');
  let current = null;
  let revs = new Map(); // kid → {iat, lids:Set, doc}

  // Kayıtlı iptal listeleri de her açılışta yeniden doğrulanır
  function loadRevocations() {
    revs = new Map();
    const all = readJson(revFile);
    if (!all || typeof all !== 'object') return;
    for (const [kid, doc] of Object.entries(all)) {
      const k = keys[kid];
      if (!k || !LICENSE_ENVS.includes(k.env)) continue;
      const r = verifySignedDoc(doc, REV_PREFIX, { [kid]: k });
      const v = r.ok && validateRevocations(r.payload);
      if (v && v.kid === kid) revs.set(kid, { iat: v.iat, lids: v.lids, doc: r.doc });
    }
  }
  function saveRevocations() {
    const out = {};
    for (const [kid, r] of revs) out[kid] = r.doc;
    writeJsonAtomic(revFile, out);
  }

  function compute() {
    const stored = readJson(licFile);
    if (!stored || typeof stored.key !== 'string') { current = { pro: false, state: 'free' }; return current; }
    let kid = null;
    try { kid = parseKey(stored.key).payload.kid; } catch (e) { /* aşağıda geçersiz çıkar */ }
    const r = verifyKey(stored.key, { keys, allowSandbox, revoked: kid && revs.get(kid)?.lids });
    const pl = r.payload || {};
    const info = {
      email: typeof pl.email === 'string' ? pl.email : '',
      name: typeof pl.name === 'string' ? pl.name : '',
      lid: typeof pl.lid === 'string' ? pl.lid : '',
      env: r.env || '',
      kid: r.kid || '',
      plan: typeof pl.plan === 'string' ? pl.plan : '',
      activatedAt: typeof stored.activatedAt === 'string' ? stored.activatedAt : '',
    };
    if (r.ok) current = { pro: true, state: 'active', ...info };
    else if (r.code === 'revoked') current = { pro: false, state: 'revoked', ...info };
    else current = { pro: false, state: 'invalid', code: r.code, ...info };
    return current;
  }

  function status() { return { ...(current || compute()) }; }

  function load() {
    loadRevocations();
    compute();
    return status();
  }

  function activate(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, code: 'empty' };
    let kid = null;
    try { kid = parseKey(text).payload.kid; } catch (e) { /* verifyKey hata kodunu verir */ }
    const r = verifyKey(text, { keys, allowSandbox, revoked: kid && revs.get(kid)?.lids });
    if (!r.ok) return { ok: false, code: r.code };
    const prev = readJson(licFile);
    const same = prev && prev.key === r.canonical;
    writeJsonAtomic(licFile, { key: r.canonical, activatedAt: same && prev.activatedAt ? prev.activatedAt : new Date().toISOString() });
    log('lisans etkinleştirildi:', r.payload.lid, r.env);
    compute();
    return { ok: true, status: status() };
  }

  function remove() {
    try { fs.rmSync(licFile, { force: true }); } catch (e) { log('lisans silinemedi:', e.message); }
    log('lisans kaldırıldı');
    compute();
    return status();
  }

  // İptal listesi: yalnız etkin lisansın anahtarıyla imzalanmışsa ve öncekinden yeniyse kabul edilir
  function applyRevocations(doc) {
    const st = status();
    if (!st.kid || !keys[st.kid]) return { ok: false, code: 'no_license' };
    const r = verifySignedDoc(doc, REV_PREFIX, { [st.kid]: keys[st.kid] });
    if (!r.ok) return { ok: false, code: r.code };
    const v = validateRevocations(r.payload);
    if (!v || v.kid !== st.kid) return { ok: false, code: 'format' };
    const prev = revs.get(st.kid);
    if (prev && v.iat <= prev.iat) return { ok: false, code: 'stale' };
    revs.set(st.kid, { iat: v.iat, lids: v.lids, doc: r.doc });
    saveRevocations();
    const before = st.state;
    const after = compute().state;
    if (before !== after) log('lisans durumu değişti:', before, '→', after);
    return { ok: true, changed: before !== after, status: status() };
  }

  return { load, status, activate, remove, applyRevocations, files: { licFile, revFile } };
}

module.exports = {
  KEY_PREFIX, REV_PREFIX, UPD_PREFIX, PRO_PLANS, LID_RE, MAX_DOC,
  b64urlDecode, b64urlEncode, parseKey, verifyKey, verifySignedDoc,
  parseVersion, compareVersions, validateManifest, validateRevocations,
  createLicenseStore, LicenseError,
};
