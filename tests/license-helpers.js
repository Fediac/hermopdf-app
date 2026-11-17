// Lisans testleri için yardımcılar: YALNIZCA atılık (bellekte üretilen) anahtar çiftleri kullanılır.
// Gerçek özel anahtarlar (~/.ultronix-keys/*.private.pem) testlerde asla okunmaz.
const crypto = require('crypto');

const b64u = (x) => Buffer.from(x).toString('base64url');

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pem: publicKey.export({ type: 'spki', format: 'pem' }), privateKey };
}

const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function makeLid() {
  let s = 'L';
  const b = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) s += CROCK[b[i] % 32];
  return s;
}

function signKey(payload, privateKey, { prefix = 'UPRO1.' } = {}) {
  const p = b64u(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(prefix + p, 'ascii'), privateKey);
  return `UPRO1.${p}.${b64u(sig)}`;
}

function makeLicense(kid, privateKey, over = {}) {
  const payload = {
    v: 1, kid, lid: makeLid(), plan: 'pro_lifetime', email: 'deneme@example.com',
    iat: Math.floor(Date.now() / 1000), env: 'live', txn: 'txn_test_0001', ...over,
  };
  return { key: signKey(payload, privateKey), payload };
}

function signDoc(obj, prefix, privateKey) {
  const payload = b64u(JSON.stringify(obj));
  const sig = b64u(crypto.sign(null, Buffer.from(prefix + payload, 'ascii'), privateKey));
  return { payload, sig };
}

// OCR / toplu işlem gibi Pro özelliklerini kullanan uygulama testleri için atılık Pro lisansı.
// launch()'tan ÖNCE çağırın: ana süreç ULTRONIX_TEST_KEYS'i yalnızca paketlenmemiş + PDFUSTA_TEST=1 iken kabul eder.
// Varolan test anahtarlarını silmez, yalnızca kendi kid'ini ekler.
function enableTestPro({ kid = 'test-pro-auto', email = 'pro-test@example.com' } = {}) {
  const kp = keyPair();
  let keys = {};
  try { keys = JSON.parse(process.env.ULTRONIX_TEST_KEYS || '{}') || {}; } catch (e) { keys = {}; }
  keys[kid] = { env: 'live', pem: kp.pem };
  process.env.ULTRONIX_TEST_KEYS = JSON.stringify(keys);
  const lic = makeLicense(kid, kp.privateKey, { email });
  const isPro = (win) => win.evaluate(() => import('app://pu/src/renderer/js/pro.js').then((m) => m.isPro()));
  const waitPro = async (win, want) => {
    for (let i = 0; i < 40; i++) { if ((await isPro(win)) === want) return; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error(want ? 'Pro etkinleşmedi' : 'Pro kapanmadı');
  };
  return {
    key: lic.key,
    isPro,
    async activate(win) {
      const r = await win.evaluate((k) => window.pu.license.activate(k), lic.key);
      if (!r || !r.ok) throw new Error(`test Pro lisansı etkinleşmedi: ${JSON.stringify(r)}`);
      await waitPro(win, true);
    },
    async deactivate(win) {
      await win.evaluate(() => window.pu.license.remove());
      await waitPro(win, false);
    },
  };
}

module.exports = { b64u, keyPair, makeLid, signKey, makeLicense, signDoc, enableTestPro };
