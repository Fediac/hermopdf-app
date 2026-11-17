#!/usr/bin/env node
// Satın alma sonrası akışın (Freemius) uçtan uca yerel denemesi, wrangler GEREKMEDEN, gerçek tarayıcıda (Edge).
// Lisans sunucusunun kendi kodu (server/src/index.js) server/test/helpers.mjs'deki bellek içi D1 taklidiyle ve
// bu çalıştırma için ÜRETİLEN atılabilir Ed25519 anahtarıyla 127.0.0.1:8787'de çalışır. Freemius API'si ve Resend
// sahte fetch'e gider; webhook'lar atılabilir bir Secret Key ile imzalanır. Gerçek anahtar, gerçek ödeme, e-posta yok.
//
//   node build.mjs --dev && node serve.mjs   (ayrı pencerede)
//   node tools/qa-flow.mjs                   (ekran görüntüleri: qa/flow-*.png)
//
// Denenen (tr + en + İngilizce yedekli bir dil): (1) ödeme penceresi geri çağrısı (sessionStorage) ile satın alma
// tamamlandı sayfası anahtarı kendiliğinden gösterir, imza ve v1 yükü doğru, adres çubuğu temiz; (2) yanlış kanıtla
// anahtar yok, Freemius anahtarı formu çıkar; (3) Freemius anahtarını yapıştırınca anahtar gelir, yanlış anahtar tek tip
// mesaj; (4) kurtarma sayfası: Freemius anahtarıyla anahtar, iade edilmiş lisansa anahtar yok, e-posta kapalıyken
// e-posta yolu dürüstçe "henüz açık değil" der; (5) CORS; (6) iade sonrası iptal listesi.
import http from 'node:http';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.resolve(ROOT, '..', 'server');
const APP = process.env.ULTRONIX_APP_DIR || path.resolve(ROOT, '..', '..', 'PDFUsta');
const { chromium } = createRequire(path.join(APP, 'package.json'))('playwright-core');
const H = await import(pathToFileURL(path.join(SERVER, 'test', 'helpers.mjs')).href);
const { handle } = await import(pathToFileURL(path.join(SERVER, 'src', 'index.js')).href);
const SITE = process.env.QA_BASE || 'http://127.0.0.1:4173';
const API = 'http://127.0.0.1:8787';

// Sahte Freemius: lisanslar ve kullanıcı (public_key = ödeme penceresinin geri çağrısında gelen değer).
const fsLicenses = {};
const fsUsers = { 777001: { email: 'buyer@example.com', public_key: H.FS_USER_PK } };
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const addFsLicense = (over = {}) => {
  const id = H.fsId();
  fsLicenses[id] = { id, plugin_id: H.FS_PRODUCT, plan_id: H.FS_PLAN, pricing_id: H.FS_PRICING, user_id: '777001', environment: 1, is_cancelled: false, expiration: null, secret_key: H.fsLicenseKey(), created: now(), ...over };
  return fsLicenses[id];
};
const app = H.makeFsApp({
  fetch: H.makeFetch({ fsLicenses, fsUsers }),
  env: { ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173', FREEMIUS_API_KEY: 'fs_api_token_qa' }, // e-posta (Resend) KAPALI
});
app.deps.now = () => Date.now();

let clientIp = '198.51.100.1';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${name}${detail ? ` (${detail})` : ''}`); };

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  // Her dil turu ayrı bir "ziyaretçi IP'si" (hız sınırı birim testlerde denenir; burada turlar birbirini etkilemesin).
  const init = { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': clientIp } };
  if (body.length && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
  const pending = [];
  const r = await handle(new Request(`${API}${req.url}`, init), app.env, { waitUntil: (p) => pending.push(p) }, app.deps);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
  await Promise.allSettled(pending);
});
await new Promise((ok) => server.listen(8787, '127.0.0.1', ok));

const fsWebhook = async (event) => {
  const raw = JSON.stringify(event);
  const r = await fetch(`${API}/v1/freemius/webhook`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-signature': H.fsSign(raw) } });
  return r.status;
};
const checkKey = (key, email, licenseId) => {
  const [h, pl, sig] = String(key).split('.');
  let p = {};
  try { p = JSON.parse(Buffer.from(pl, 'base64url').toString('utf8')); } catch {}
  const okSig = !!sig && verify(null, Buffer.from(`${h}.${pl}`, 'ascii'), createPublicKey(app.keys.sbx.publicPem), Buffer.from(sig, 'base64url'));
  return okSig && h === 'UPRO1' && p.v === 1 && p.kid === 'license-sbx-2026a' && p.plan === 'pro_lifetime' && p.email === email && p.env === 'sandbox' && p.txn === `fs_lic_${licenseId}`;
};
const PAGES = {
  tr: { success: '/tr/satin-alma-tamamlandi/', recover: '/tr/lisansimi-kaybettim/' },
  en: { success: '/purchase-complete/', recover: '/recover-license/' },
  es: { success: '/es/purchase-complete/', recover: '/es/recover-license/' },
};
const shot = (page, name) => page.screenshot({ path: path.join(ROOT, 'qa', `flow-${name}.png`), fullPage: true });
const okShown = (page) => page.waitForSelector('#claim-ok:not([hidden])', { timeout: 20000 }).then(() => true, () => false);
const formShown = (page) => page.waitForFunction(() => !document.getElementById('claim-form').hidden && document.getElementById('claim-form-msg').textContent.trim().length > 0, null, { timeout: 20000 }).then(() => true, () => false);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const pre = await fetch(`${API}/v1/license/claim`, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:4173', 'access-control-request-method': 'POST' } });
  check('CORS: sitenin yerel kökenine izin var', pre.headers.get('access-control-allow-origin') === 'http://127.0.0.1:4173');
  const bad = await fetch(`${API}/v1/license/claim`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  check('CORS: başka kökene izin yok', bad.status === 403);

  for (const lang of ['tr', 'en', 'es']) {
    const P = PAGES[lang];
    clientIp = `198.51.100.${10 + Object.keys(PAGES).indexOf(lang)}`;
    const errors = [];
    const watch = (pg) => {
      pg.on('pageerror', (e) => errors.push(e.message));
      pg.on('console', (m) => { if (m.type() === 'error' && !/status of (404|503|429)/.test(m.text())) errors.push(m.text()); });
    };

    // (1) Overlay ödemesi: geri çağrı sessionStorage'a yazar (checkout.js ile aynı biçim), sayfa kendiliğinden ister.
    const lic = addFsLicense();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watch(page);
    await page.goto(`${SITE}${P.success}?demo=1`);
    await page.evaluate((s) => sessionStorage.setItem('ux-claim', JSON.stringify(s)), { v: 2, license_id: lic.id, user_id: '777001', email: 'buyer@example.com', user_public_key: H.FS_USER_PK, t: Date.now() });
    await page.reload();
    const auto = await okShown(page);
    const k1 = await page.evaluate(() => document.getElementById('claim-key').textContent);
    check(`[${lang}] ödeme geri çağrısıyla anahtar kendiliğinden gösterildi`, auto && k1.startsWith('UPRO1.'), `${k1.slice(0, 16)}…`);
    check(`[${lang}] anahtar imzası ve v1 yükü doğru (atılabilir sandbox anahtarı)`, checkKey(k1, 'buyer@example.com', lic.id));
    const ui = await page.evaluate(() => ({ dl: document.getElementById('claim-dl').getAttribute('download'), href: document.getElementById('claim-dl').href, warn: !!document.querySelector('#claim-ok .warn'), copy: !!document.querySelector('#claim-ok [data-copy=claim-key]'), storage: sessionStorage.getItem('ux-claim'), url: location.href }));
    check(`[${lang}] kopyala düğmesi, "kaydet" uyarısı, lisans dosyası`, ui.copy && ui.warn && /\.hermopdflicense$/.test(ui.dl || '') && ui.href.startsWith('blob:'), ui.dl);
    check(`[${lang}] adres çubuğu temiz, kanıt sessionStorage'dan silindi`, !/license_id|@|pk_/.test(ui.url) && ui.storage === null, ui.url.replace(SITE, ''));
    await shot(page, `${lang}-success-auto`);
    await page.close();

    // (2) Yanlış kanıt (tahmin edilen kimlik + rastgele public key): anahtar yok, Freemius anahtarı formu.
    const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    watch(p2);
    await p2.goto(`${SITE}${P.success}?demo=1`);
    await p2.evaluate((s) => sessionStorage.setItem('ux-claim', JSON.stringify(s)), { v: 2, license_id: lic.id, user_id: '777001', email: 'buyer@example.com', user_public_key: 'pk_' + '0'.repeat(30), t: Date.now() });
    await p2.reload();
    const f2 = await formShown(p2);
    check(`[${lang}] yanlış kanıtla anahtar yok, Freemius anahtarı isteniyor`, f2 && (await p2.evaluate(() => document.getElementById('claim-ok').hidden)));
    // (3) Freemius anahtarı: önce yanlış, sonra doğru (webhook'la gelmiş lisans: saklanan özetle, API'siz)
    const fsKey = H.fsLicenseKey();
    const licId = H.fsId();
    check(`[${lang}] imzalı sahte payment.created kabul edildi`, (await fsWebhook(H.fsPurchaseEvent({ licenseId: licId, fsKey, email: `deneme-${lang}@example.com` }))) === 200);
    await p2.fill('#claim-fskey', H.fsLicenseKey());
    await p2.click('#claim-form button[type=submit]');
    await p2.waitForFunction(() => /err/.test(document.getElementById('claim-form-msg').className), null, { timeout: 15000 }).catch(() => {});
    const wrongMsg = await p2.evaluate(() => document.getElementById('claim-form-msg').textContent);
    check(`[${lang}] yanlış Freemius anahtarı: tek tip "bulunamadı"`, wrongMsg.length > 20, wrongMsg.slice(0, 60));
    await shot(p2, `${lang}-success-wrong-key-mobile`);
    await p2.fill('#claim-fskey', `  ${fsKey}  `);
    await p2.click('#claim-form button[type=submit]');
    const ok2 = await okShown(p2);
    const k2 = await p2.evaluate(() => document.getElementById('claim-key').textContent);
    check(`[${lang}] doğru Freemius anahtarıyla HermoPDF anahtarı gösterildi`, ok2 && checkKey(k2, `deneme-${lang}@example.com`, licId));
    await shot(p2, `${lang}-success-by-key-mobile`);
    await p2.close();

    // (4) Kurtarma sayfası (hosted checkout ile alanların yolu): Freemius anahtarı + e-posta yolu
    const p3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watch(p3);
    await p3.goto(`${SITE}${P.recover}?demo=1`);
    await p3.fill('#claim-fskey', fsKey);
    await p3.click('#claim-form button[type=submit]');
    const ok3 = await okShown(p3);
    const k3 = await p3.evaluate(() => document.getElementById('claim-key').textContent);
    check(`[${lang}] kurtarma: Freemius anahtarıyla aynı anahtar (yeniden üretilmeden)`, ok3 && k3 === k2);
    await p3.fill('#recover-email', `deneme-${lang}@example.com`);
    await p3.click('#recover-form button[type=submit]');
    await p3.waitForFunction(() => document.getElementById('recover-status').textContent.trim().length > 0 && !/…/.test(document.getElementById('recover-status').textContent), null, { timeout: 15000 }).catch(() => {});
    const rmsg = await p3.evaluate(() => document.getElementById('recover-status').textContent.trim());
    check(`[${lang}] e-posta kapalıyken e-posta yolu "henüz açık değil" diyor (yalan "gönderdik" yok)`, /Freemius/.test(rmsg), rmsg.slice(0, 70));
    await shot(p3, `${lang}-recover`);
    await p3.close();

    // İade → anahtar verilmez, iptal listesinde
    const rs = await fsWebhook(H.fsAdjustmentEvent({ type: 'payment.refund', licenseId: licId, at: Date.now() }));
    const p4 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watch(p4);
    await p4.goto(`${SITE}${P.recover}?demo=1`);
    await p4.fill('#claim-fskey', fsKey);
    await p4.click('#claim-form button[type=submit]');
    await p4.waitForFunction(() => /err/.test(document.getElementById('claim-form-msg').className), null, { timeout: 15000 }).catch(() => {});
    check(`[${lang}] iade edilmiş lisansa anahtar verilmedi`, rs === 200 && (await p4.evaluate(() => document.getElementById('claim-ok').hidden)));
    await shot(p4, `${lang}-recover-refunded`);
    await p4.close();
    const rev = await (await fetch(`${API}/v1/revocations`)).json();
    const revPayload = JSON.parse(Buffer.from(rev.payload, 'base64url').toString('utf8'));
    const revOk = verify(null, Buffer.from(`UREV1.${rev.payload}`, 'ascii'), createPublicKey(app.keys.sbx.publicPem), Buffer.from(rev.sig, 'base64url'));
    const lid = JSON.parse(Buffer.from(k2.split('.')[1], 'base64url').toString('utf8')).lid;
    check(`[${lang}] iade sonrası lisans imzalı iptal listesinde`, revOk && revPayload.lids.includes(lid));
    check(`[${lang}] sayfalarda JS hatası yok`, errors.length === 0, errors.join(' | ').slice(0, 200));
  }
  const health = await (await fetch(`${API}/v1/health`)).json();
  check('GET /v1/health', health.ok === true && health.env === 'sandbox', JSON.stringify(health));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} denetim, ${failed} başarısız.`);
process.exit(failed ? 1 : 0);
