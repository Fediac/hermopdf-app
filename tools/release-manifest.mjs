// Güncelleme bildirim dosyasını (latest.json) üretir ve imzalar — biçim v1:
//   {"payload": b64url(JSON {"v":1,"version","date","url","sha256","notes":{"tr","en"}}),
//    "sig": b64url(Ed25519 "UUPD1." + payload)}   (anahtar: release-2026a)
// Yazdıktan sonra dosyayı uygulamanın kendi doğrulayıcısıyla ve gömülü açık anahtarla yeniden doğrular.
//
// Kullanım:
//   node tools/release-manifest.mjs --version 1.3.0 --installer dist/HermoPDF-Setup-1.3.0.exe \
//     --url https://hermopdf.com/indir --notes-tr "..." --notes-en "..." --out site/updates/latest.json
//   [--key <özel anahtar, varsayılan ~/.ultronix-keys/release-2026a.private.pem>] [--date YYYY-MM-DD]
//   [--pub <açık anahtar PEM> — yalnızca deneme anahtarlarıyla test için; varsayılan gömülü release-2026a]
// Özel anahtar hiçbir yere kopyalanmaz, yazdırılmaz.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KEYS } = require('../src/main/keys.js');
const { verifySignedDoc, validateManifest, UPD_PREFIX } = require('../src/main/license.js');
const { isSiteUrl } = require('../src/main/endpoints.js');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Beklenmeyen argüman: ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} için değer eksik`);
    out[a.slice(2)] = v;
    i++;
  }
  return out;
}

function fail(msg) {
  console.error(`HATA: ${msg}`);
  process.exit(1);
}

async function sha256File(f) {
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(f).on('data', (c) => h.update(c)).on('end', resolve).on('error', reject);
  });
  return h.digest('hex');
}

let a;
try { a = args(process.argv.slice(2)); } catch (e) { fail(e.message); }
for (const k of ['version', 'installer', 'url', 'out']) if (!a[k]) fail(`--${k} gerekli`);
if (!/^\d+\.\d+\.\d+$/.test(a.version)) fail('--version x.y.z biçiminde olmalı');
let u;
try { u = new URL(a.url); } catch (e) { fail('--url geçerli bir adres değil'); }
if (u.protocol !== 'https:') fail('--url https olmalı');
if (!isSiteUrl(u.href)) fail('--url sitemizin adresinde olmalı (uygulama başka adresleri açmaz)');
const date = a.date || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date YYYY-MM-DD olmalı');
if (!fs.existsSync(a.installer) || !fs.statSync(a.installer).isFile()) fail(`kurulum dosyası yok: ${a.installer}`);

const keyFile = a.key || path.join(os.homedir(), '.ultronix-keys', 'release-2026a.private.pem');
let priv;
try { priv = crypto.createPrivateKey(fs.readFileSync(keyFile)); } catch (e) { fail(`özel anahtar okunamadı (${path.basename(keyFile)})`); }
if (priv.asymmetricKeyType !== 'ed25519') fail('anahtar Ed25519 değil');

const payloadObj = {
  v: 1,
  version: a.version,
  date,
  url: u.href,
  sha256: await sha256File(a.installer),
  notes: { tr: a['notes-tr'] || '', en: a['notes-en'] || '' },
};
const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
const sig = crypto.sign(null, Buffer.from(UPD_PREFIX + payload, 'ascii'), priv).toString('base64url');
const doc = { payload, sig };

// Yeniden doğrula: uygulamanın kendi kodu + gömülü (ya da --pub ile verilen) açık anahtar
const verifyKeys = a.pub ? { 'release-test': { env: 'release', pem: fs.readFileSync(a.pub, 'utf8') } } : { 'release-2026a': KEYS['release-2026a'] };
const r = verifySignedDoc(JSON.stringify(doc), UPD_PREFIX, verifyKeys, { envs: ['release'] });
if (!r.ok || !validateManifest(r.payload)) fail(`imzalı dosya doğrulanamadı (${r.code || 'biçim'}): yanlış anahtar mı? Dosya yazılmadı.`);

fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
fs.writeFileSync(a.out, `${JSON.stringify(doc, null, 1)}\n`);
console.log(`latest.json yazıldı: ${a.out}`);
console.log(`  sürüm ${payloadObj.version} · ${payloadObj.date} · sha256 ${payloadObj.sha256.slice(0, 16)}… · doğrulandı (${a.pub ? '--pub' : 'release-2026a'})`);
