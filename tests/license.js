// Lisans / Pro ve isteğe bağlı güncelleme denetimi — uygulama içinden uçtan uca test.
// Yalnızca atılık anahtarlar (ULTRONIX_TEST_KEYS; ana süreç bunu yalnızca paketlenmemiş + PDFUSTA_TEST=1 iken kabul eder)
// ve 127.0.0.1 üzerinde sahte bir site/API sunucusu kullanılır. Gerçek anahtarlara, gerçek uygulama verisine dokunulmaz.
// Kullanım: node tests/license.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { launch, shot, sleep } = require('./harness');
const { keyPair, makeLicense, signDoc } = require('./license-helpers');

const results = [];
let curWin = null;
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}: ${String(e.message).split('\n')[0]}`);
    if (curWin) await shot(curWin, `FAILl-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };
async function waitFor(fn, ms = 6000, what = 'koşul') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`zaman aşımı: ${what}`);
    await sleep(100);
  }
}

// ---------------- atılık anahtarlar ----------------
const live = keyPair();
const sbx = keyPair();
const rel = keyPair();
const stranger = keyPair();
process.env.ULTRONIX_TEST_KEYS = JSON.stringify({
  'test-live-1': { env: 'live', pem: live.pem },
  'test-sbx-1': { env: 'sandbox', pem: sbx.pem },
  'test-rel-1': { env: 'release', pem: rel.pem },
});
process.env.ULTRONIX_UPDATE_DELAY_MS = '800';

// ---------------- sahte site + API ----------------
const srv = { manifest: null, revocations: null, hits: [] };
const server = http.createServer((req, res) => {
  srv.hits.push({ url: req.url, ua: req.headers['user-agent'] || '', cookie: req.headers.cookie || '' });
  const body = req.url === '/updates/latest.json' ? srv.manifest : req.url === '/v1/revocations' ? srv.revocations : null;
  if (!body) { res.writeHead(404); res.end('yok'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(body);
});
const hits = (p) => srv.hits.filter((h) => !p || h.url === p).length;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const SITE = `http://127.0.0.1:${server.address().port}`;
  process.env.ULTRONIX_SITE_URL = SITE;
  process.env.ULTRONIX_API_URL = SITE;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-lic-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-licfx-'));

  const good = makeLicense('test-live-1', live.privateKey, { email: 'ayse@example.com', name: 'Ayşe Deneme' });
  const fileLic = makeLicense('test-live-1', live.privateKey, { email: 'dosya@example.com' });
  // Geriye dönük uyumluluk: eski adlı sürümlerin verdiği .ultronpdflicense / .ultronixlicense dosyaları da açılmalı
  const legacyFile = path.join(work, 'HermoPDF-Pro-ESKI.ultronpdflicense');
  fs.writeFileSync(legacyFile, makeLicense('test-live-1', live.privateKey, { email: 'eski@example.com' }).key + '\n');
  const legacyFile2 = path.join(work, 'Pro-ESKI2.ultronixlicense');
  fs.writeFileSync(legacyFile2, makeLicense('test-live-1', live.privateKey, { email: 'eski2@example.com' }).key + '\n');
  const licFile = path.join(work, 'HermoPDF-Pro.hermopdflicense');
  fs.writeFileSync(licFile, `HermoPDF Pro lisansı\r\nLisans sahibi: dosya@example.com\r\n\r\n${fileLic.key.match(/.{1,64}/g).join('\r\n')}\r\n\r\nTeşekkürler!\r\n`);
  const manifest = (version, priv = rel.privateKey, url = `${SITE}/indir`) => JSON.stringify(signDoc({ v: 1, version, date: '2026-11-08', url, sha256: 'b'.repeat(64), notes: { tr: `Sürüm ${version}: daha hızlı OCR.`, en: 'Faster OCR.' } }, 'UUPD1.', priv));
  const revList = (iat, lids) => JSON.stringify(signDoc({ v: 1, kid: 'test-live-1', iat, lids }, 'UREV1.', live.privateKey));

  let app;
  let win;
  let logs = [];
  const start = async () => {
    ({ app, win, logs } = await launch({ userData: ud }));
    curWin = win;
  };
  const pro = (fn, ...a) => win.evaluate(([f, args]) => import('app://pu/src/renderer/js/pro.js').then((m) => m[f](...args)), [fn, a]);
  const isPro = () => pro('isPro');
  const closeModals = () => win.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()));
  const externals = () => app.evaluate(() => global.__ultronixExternal || []);
  const text = (sel) => win.evaluate((s) => document.querySelector(s)?.textContent || '', sel);
  const activateText = async (key) => {
    await win.fill('.pro-activate-modal textarea', key);
    await win.click('.pro-activate-modal button[data-id="activate"]');
    await sleep(250);
  };

  try {
    await start();

    await step('açılışta Pro penceresi yok; güncelleme sorusu kart olarak bir kez görünür', async () => {
      await sleep(1500);
      assert(!(await win.$('.modal-backdrop')), 'açılışta pencere açıldı');
      assert(!(await win.$('.pro-modal')), 'açılışta Pro penceresi');
      assert(await win.$('#pro-btn'), 'Pro düğmesi yok');
      assert(await win.$('#start #update-card'), 'güncelleme kartı yok');
      assert(/haber verelim mi/.test(await text('#update-card')) && /IP adres/.test(await text('#update-card')), 'kart metni eksik');
      assert(!(await win.$('#notices .notice')), 'açılışta bildirim');
    });

    await step('izin verilmeden hiçbir ağ isteği yapılmaz', async () => {
      await sleep(1200); // test gecikmesi 800 ms
      const r = await win.evaluate(() => window.pu.update.checkNow());
      assert(r.status === 'off', `checkNow: ${JSON.stringify(r)}`);
      assert(hits() === 0, `istek sayısı ${hits()}`);
    });

    await step('Pro düğmesi yükseltme penceresini açar; satın alma sitede', async () => {
      await win.click('#pro-btn');
      await win.waitForSelector('.pro-modal', { timeout: 3000 });
      const t = await text('.pro-modal');
      for (const s of ['HermoPDF Pro', 'Tek seferlik ödeme, abonelik yok', 'Okuma, düzenleme, hedef boyuta küçültme, birleştirme, bölme, imza ve temel dönüşümler ücretsiz kalır.', 'Kayıtlı iş akışları', 'Lisansım var', 'Web sitesinde satın al']) assert(t.includes(s), `eksik: ${s}`);
      // İş akışları artık bu sürümde var: "planlanan" etiketiyle gösterilmemeli
      assert(!(await win.$('.pro-modal .pro-feat:has-text("Kayıtlı iş akışları") .pro-tag')), 'iş akışları hâlâ planlanan');
      await win.click('.pro-modal button[data-id="buy"]');
      await sleep(300);
      const ex = await externals();
      assert(ex[ex.length - 1] === `${SITE}/tr/fiyat/?from=app`, `açılan adres: ${ex[ex.length - 1]}`);
      assert(!(await win.$('.pro-modal')), 'pencere kapanmadı');
    });

    await step('requirePro ücretsiz kullanıcıda false döner ve özelliği anar', async () => {
      assert((await pro('requirePro', 'workflows')) === false);
      await win.waitForSelector('.pro-modal .pro-asked', { timeout: 3000 });
      assert(/Kayıtlı iş akışları/.test(await text('.pro-modal .pro-asked')));
      await closeModals();
    });

    await step('geçersiz anahtarlar dostça hata gösterir', async () => {
      await win.click('#pro-btn');
      await win.click('.pro-modal button[data-id="have"]');
      await win.waitForSelector('.pro-activate-modal textarea', { timeout: 3000 });
      await win.click('.pro-activate-modal button[data-id="activate"]');
      assert(/yapıştırın/.test(await text('.pro-err')), 'boş anahtar');
      await activateText('merhaba dünya');
      assert(/UPRO1\./.test(await text('.pro-err')), `biçim: ${await text('.pro-err')}`);
      const [, p, s] = good.key.split('.');
      await activateText(`UPRO1.${p}.${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`);
      assert(/doğrulanamadı/.test(await text('.pro-err')), `imza: ${await text('.pro-err')}`);
      await activateText(makeLicense('yabanci-kid', stranger.privateKey).key);
      assert(/tanımadığı bir anahtarla/.test(await text('.pro-err')), `anahtar: ${await text('.pro-err')}`);
      await activateText(makeLicense('test-live-1', live.privateKey, { plan: 'pro_monthly' }).key);
      assert(/tanımadığı bir plana/.test(await text('.pro-err')), `plan: ${await text('.pro-err')}`);
      assert((await isPro()) === false, 'geçersiz anahtarla Pro oldu');
    });

    await step('yapıştırarak etkinleştirme', async () => {
      await activateText(`\n  ${good.key}  \n`);
      await win.waitForSelector('.pro-success', { timeout: 3000 });
      assert((await text('.pro-success-title')).includes('👑 Pro etkin — lisans sahibi: ayse@example.com'), await text('.pro-success-title'));
      assert(await isPro(), 'isPro false');
      assert(await win.$('#pro-btn.on'), 'Pro düğmesi etkin görünmüyor');
      await win.click('.pro-activate-modal .modal-foot button');
      await sleep(200);
      assert(!(await win.$('.pro-activate-modal')));
    });

    await step('Hakkında: lisans bölümü ve onaylı kaldırma', async () => {
      await win.evaluate(() => window.__pu.runAction('app.about'));
      await win.waitForSelector('.about-license', { timeout: 3000 });
      assert(/Pro etkin — lisans sahibi: ayse@example.com/.test(await text('.about-license')));
      await win.click('#about-remove');
      await win.waitForSelector('.modal-backdrop:last-child .modal-foot button:has-text("Kaldır")', { timeout: 3000 });
      await win.click('.modal-backdrop:last-child .modal-foot button:has-text("Kaldır")');
      await waitFor(async () => /Ücretsiz sürüm/.test(await text('.about-license')), 3000, 'ücretsiz görünüm');
      assert((await isPro()) === false);
      assert(!fs.existsSync(path.join(ud, 'license.json')), 'license.json silinmedi');
      await closeModals();
    });

    await step('dosyadan etkinleştirme (gecikmeli sistem penceresi, meşgul katmanı çıkmaz)', async () => {
      await app.evaluate(({ dialog }, f) => {
        dialog.showOpenDialog = async () => { await new Promise((r) => setTimeout(r, 2500)); return { canceled: false, filePaths: [f] }; };
      }, licFile);
      await win.evaluate(() => { import('app://pu/src/renderer/js/pro.js').then((m) => m.openActivation()); });
      await win.waitForSelector('.pro-activate-modal button[data-id="file"]', { timeout: 3000 });
      await win.click('.pro-activate-modal button[data-id="file"]');
      await sleep(1200);
      assert(!(await win.$('.busy-overlay')), 'sistem penceresi açıkken meşgul katmanı çıktı');
      assert(await win.$('.pro-activate-modal'), 'pencere kapandı');
      await win.waitForSelector('.pro-success', { timeout: 6000 });
      assert((await text('.pro-success-title')).includes('dosya@example.com'));
      assert(await isPro());
      await closeModals();
    });

    await step('eski .ultronpdflicense / .ultronixlicense dosyaları hâlâ açılır; seçici yeni uzantıyı da listeler', async () => {
      for (const [f, who] of [[legacyFile, 'eski@example.com'], [legacyFile2, 'eski2@example.com']]) {
        await win.evaluate(() => window.pu.license.remove());
        await waitFor(async () => (await isPro()) === false, 3000, 'Pro kapanışı');
        await app.evaluate(({ dialog }, p) => {
          global.__licDlgOpts = null;
          dialog.showOpenDialog = async (...a) => { global.__licDlgOpts = a[a.length - 1]; return { canceled: false, filePaths: [p] }; };
        }, f);
        const r = await win.evaluate(() => window.pu.license.importFile());
        assert(r && r.ok, `içe aktarma: ${JSON.stringify(r)}`);
        assert(await isPro(), 'Pro açılmadı');
        const st = await win.evaluate(() => window.pu.license.status());
        assert(JSON.stringify(st).includes(who), `sahip: ${JSON.stringify(st)}`);
        const o = await app.evaluate(() => global.__licDlgOpts);
        const exts = (o.filters[0] || {}).extensions || [];
        for (const e of ['hermopdflicense', 'ultronpdflicense', 'ultronixlicense']) assert(exts.includes(e), `seçici ${e} uzantısını içermiyor: ${exts}`);
      }
      // sonraki adımlar dosya@example.com lisansını bekler: yeni uzantılı dosyayı geri yükle
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, licFile);
      const back = await win.evaluate(() => window.pu.license.importFile());
      assert(back && back.ok, `geri yükleme: ${JSON.stringify(back)}`);
      await closeModals();
    });

    await step('güncelleme kartı: "Hayır" seçimi kaydedilir', async () => {
      await win.click('#uc-no');
      await sleep(300);
      assert(!(await win.$('#update-card')), 'kart kalktı mı');
      const p = await win.evaluate(() => window.pu.update.getPrefs());
      assert(p.updateCheck === false, JSON.stringify(p));
      assert(hits() === 0, `istek sayısı ${hits()}`);
    });

    await app.close();
    await start();

    await step('yeniden açılış: lisans etkin, kart yok, istek yok', async () => {
      await sleep(1800);
      assert(await isPro(), 'lisans kalıcı değil');
      assert((await pro('licenseStatus')).email === 'dosya@example.com');
      assert(await win.$('#pro-btn.on'));
      assert(!(await win.$('#update-card')), 'kart yeniden çıktı');
      assert(!(await win.$('.modal-backdrop')));
      assert(hits() === 0, `istek sayısı ${hits()}`);
    });

    await step('izin açılınca: imzalı yeni sürüm → sakin bildirim', async () => {
      srv.manifest = manifest('9.9.9');
      srv.revocations = revList(1000, []);
      await win.evaluate(() => window.__pu.runAction('app.about'));
      await win.waitForSelector('#about-update-chk', { timeout: 3000 });
      await win.click('#about-update-chk');
      await win.waitForSelector('#update-banner', { timeout: 8000 });
      assert(/HermoPDF 9\.9\.9 çıktı/.test(await text('#update-banner')), await text('#update-banner'));
      assert(hits('/updates/latest.json') === 1, `manifest isteği ${hits('/updates/latest.json')}`);
      await waitFor(async () => hits('/v1/revocations') === 1, 3000, 'iptal listesi isteği');
      assert(srv.hits.every((h) => /^HermoPDF\/\d/.test(h.ua) && !h.cookie), 'istek başlıkları');
      await closeModals();
      await win.click('#update-banner button:has-text("Neler yeni?")');
      await win.waitForSelector('.update-notes', { timeout: 3000 });
      assert(/daha hızlı OCR/.test(await text('.update-notes')));
      await closeModals();
      await win.click('#update-banner button:has-text("İndir")');
      await sleep(300);
      const ex = await externals();
      assert(ex[ex.length - 1] === `${SITE}/indir`, `indir adresi: ${ex[ex.length - 1]}`);
      assert(await isPro(), 'boş iptal listesi lisansı bozdu');
    });

    await step('imzası bozuk güncelleme dosyası yok sayılır', async () => {
      await win.evaluate(() => document.querySelector('#update-banner')?.remove());
      srv.manifest = manifest('9.9.10', stranger.privateKey);
      const r = await win.evaluate(() => window.pu.update.checkNow());
      assert(r.status === 'error', JSON.stringify(r));
      await sleep(300);
      assert(!/9\.9\.10/.test(await text('#notices')), 'sahte sürüm bildirildi');
      const p = await win.evaluate(() => window.pu.update.getPrefs());
      assert(p.available && p.available.version === '9.9.9', JSON.stringify(p.available));
    });

    await step('iptal listesinde lisans → iptal edildi + tek sakin açıklama', async () => {
      const lid = (await pro('licenseStatus')).lid;
      srv.revocations = revList(2000, [lid]);
      await win.evaluate(() => window.pu.update.checkNow());
      await waitFor(async () => (await pro('licenseStatus')).state === 'revoked', 4000, 'iptal durumu');
      assert((await isPro()) === false);
      await win.waitForSelector('#pro-revoked-notice', { timeout: 3000 });
      assert(/iade/.test(await text('#pro-revoked-notice')) && /ters ibraz/.test(await text('#pro-revoked-notice')));
      assert(!(await win.$('#pro-btn.on')));
      assert(!(await win.$('.modal-backdrop')), 'iptal bir pencere açtı');
      await win.click('#pro-revoked-notice button:has-text("Destek")');
      await sleep(300);
      const ex = await externals();
      assert(ex[ex.length - 1] === `${SITE}/tr/destek/`, `destek adresi: ${ex[ex.length - 1]}`);
    });

    await step('daha eski tarihli iptal listesi yok sayılır', async () => {
      srv.revocations = revList(1500, []);
      await win.evaluate(() => window.pu.update.checkNow());
      await sleep(400);
      assert((await pro('licenseStatus')).state === 'revoked', 'eski liste iptali kaldırdı');
      // Yeni tarihli düzeltilmiş liste kabul edilir
      srv.revocations = revList(3000, []);
      await win.evaluate(() => window.pu.update.checkNow());
      await waitFor(async () => (await isPro()) === true, 3000, 'yeni listeyle yeniden etkin');
    });

    await step('sunucu kapalı: lisans etkin kalır, hata gösterilmez', async () => {
      await win.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
      await new Promise((r) => { server.close(r); server.closeAllConnections(); });
      const r = await win.evaluate(() => window.pu.update.checkNow());
      assert(r.status === 'error', JSON.stringify(r));
      await sleep(300);
      assert(await isPro(), 'çevrimdışıyken lisans düştü');
      assert(!(await win.$('.toast.error')), 'hata bildirimi gösterildi');
    });

    await app.close();
    await start();

    await step('sunucu kapalıyken yeniden açılış: lisans etkin, sessiz', async () => {
      await sleep(2500);
      assert(await isPro(), 'lisans etkin değil');
      assert(!(await win.$('.toast.error')), 'hata bildirimi');
      assert(!(await win.$('.modal-backdrop')), 'pencere açıldı');
      const p = await win.evaluate(() => window.pu.update.getPrefs());
      assert(p.updateCheck === true);
    });
  } catch (e) {
    console.log('BEKLENMEYEN:', e.message);
    results.push({ name: 'beklenmeyen', ok: false });
  }

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} adım başarılı`);
  const errs = logs.filter((l) => !/Electron Security Warning/.test(l));
  if (errs.length) console.log('Konsol:\n' + errs.slice(0, 15).join('\n'));
  try { await app.close(); } catch (e) { /* yoksay */ }
  try { server.close(); } catch (e) { /* yoksay */ }
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(bad.length ? 1 : 0);
})();
