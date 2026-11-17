// Gerçek pencerede Pro girişi: GERÇEK sandbox lisans anahtarıyla (geliştirme çalıştırması sandbox'ı kabul eder; paketlenmiş sürüm reddeder).
// Anahtar depoda tutulmaz: PRO_KEY_JSON ortam değişkeniyle verilen dosyadaki JSON'un "license_key" alanından okunur
// (dosyanın başında "HTTP 200" gibi bir satır olabilir). Kullanım: PRO_KEY_JSON=<dosya> node tests/pro-gercek-anahtar.js
// Ekran görüntüleri: design/ekran/pro-testi-*.png
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launch, sleep, ROOT } = require('./harness');

const OUT = path.join(ROOT, 'design', 'ekran');
const results = [];
let win = null;
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };
const text = (sel) => win.evaluate((s) => document.querySelector(s)?.textContent || '', sel);
const pro = (fn, ...a) => win.evaluate(([f, args]) => import('app://pu/src/renderer/js/pro.js').then((m) => m[f](...args)), [fn, a]);
const closeModals = () => win.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()));
const shot = (name) => win.screenshot({ path: path.join(OUT, `pro-testi-${name}.png`) });
async function waitFor(fn, ms = 6000, what = 'koşul') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`zaman aşımı: ${what}`);
    await sleep(100);
  }
}
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`✔ ${name}`); } catch (e) {
    results.push({ name, ok: false }); console.log(`✘ ${name}: ${String(e.message).split('\n')[0]}`);
    if (win) await shot('HATA').catch(() => {});
  }
}

function readKey() {
  const raw = fs.readFileSync(process.env.PRO_KEY_JSON, 'utf8');
  const i = raw.indexOf('{');
  const j = JSON.parse(raw.slice(i, raw.lastIndexOf('}') + 1));
  assert(/^UPRO1\./.test(j.license_key || ''), 'anahtar UPRO1. ile başlamıyor');
  return j.license_key;
}

(async () => {
  const KEY = readKey();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-prokey-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-prokeyfx-'));
  const newFile = path.join(work, 'HermoPDF-Pro-GERCEK.hermopdflicense');
  const oldFile = path.join(work, 'HermoPDF-Pro-GERCEK.ultronpdflicense');
  const oldFile2 = path.join(work, 'HermoPDF-Pro-GERCEK.ultronixlicense');
  for (const f of [newFile, oldFile, oldFile2]) fs.writeFileSync(f, KEY + '\n');
  const seeFree = async () => { await closeModals(); await win.evaluate(() => window.pu.license.remove()); await waitFor(async () => (await pro('isPro')) === false, 4000, 'Pro kapanışı'); };
  const importFrom = async (f) => {
    await win.evaluate(() => { document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); });
    await win.app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, f);
    await win.evaluate(() => { import('app://pu/src/renderer/js/pro.js').then((m) => m.openActivation()); });
    await win.waitForSelector('.pro-activate-modal button[data-id="file"]', { timeout: 4000 });
    await win.click('.pro-activate-modal button[data-id="file"]');
    await win.waitForSelector('.pro-success', { timeout: 6000 });
  };

  let r = await launch({ userData: ud });
  let app = r.app;
  win = r.win;
  win.app = app;
  fs.mkdirSync(OUT, { recursive: true });

  try {
    await step('başlangıç: ücretsiz, Pro düğmesi var, kilitli özellik (toplu işlem) yükseltme penceresini açar', async () => {
      await sleep(1200);
      assert((await pro('isPro')) === false, 'ücretsiz başlamadı');
      assert(await win.$('#pro-btn'), 'Pro düğmesi yok');
      await shot('01-ucretsiz-ana');
      assert((await pro('requirePro', 'batch')) === false, 'kilitli özellik açıldı');
      await win.waitForSelector('.pro-modal', { timeout: 3000 });
      await shot('02-kilitli-ozellik-yukseltme');
      await closeModals();
    });

    await step('anahtarı yapıştır → etkinleştir → "Pro etkin" + Pro düğmesi etkin', async () => {
      await win.click('#pro-btn');
      await win.click('.pro-modal button[data-id="have"]');
      await win.waitForSelector('.pro-activate-modal textarea', { timeout: 3000 });
      await win.fill('.pro-activate-modal textarea', KEY);
      await shot('03-anahtar-yapistirildi');
      await win.click('.pro-activate-modal button[data-id="activate"]');
      await win.waitForSelector('.pro-success', { timeout: 5000 });
      const title = await text('.pro-success-title');
      assert(/Pro etkin/.test(title), `başlık: ${title}`);
      assert(await pro('isPro'), 'isPro false');
      assert(await win.$('#pro-btn.on'), 'Pro düğmesi etkin görünmüyor');
      await shot('04-pro-etkin-basari');
      await win.click('.pro-activate-modal .modal-foot button');
      await sleep(300);
      await closeModals();
      await shot('05-pro-etkin-ana');
      const st = await pro('licenseStatus');
      console.log('  durum:', JSON.stringify({ pro: st.pro, state: st.state, env: st.env, kid: st.kid, planVar: !!st.plan }));
    });

    await step('kilitli özellikler açıldı: requirePro true; Toplu işlem penceresi gerçekten açılır', async () => {
      for (const f of ['ocr', 'batch', 'workflows']) assert((await pro('requirePro', f)) === true, `${f} hâlâ kilitli`);
      assert(!(await win.$('.pro-modal')), 'yükseltme penceresi çıktı');
      await win.evaluate(() => { import('app://pu/src/renderer/js/batch.js').then((m) => m.batchDialog()); });
      await win.waitForSelector('.batch-list', { timeout: 4000 });
      assert(!(await win.$('.pro-modal')), 'Pro penceresi çıktı');
      await sleep(600);
      await shot('06-toplu-islem-acildi');
      await closeModals();
    });

    await step('Hakkında: "Pro etkin — lisans sahibi" bölümü', async () => {
      await win.evaluate(() => window.__pu.runAction('app.about'));
      await win.waitForSelector('.about-license', { timeout: 3000 });
      assert(/Pro etkin/.test(await text('.about-license')), await text('.about-license'));
      await shot('07-hakkinda-pro');
      await closeModals();
    });

    await step('kapat/yeniden aç: lisans kalıcı, Pro hâlâ etkin', async () => {
      await app.close();
      r = await launch({ userData: ud });
      app = r.app; win = r.win; win.app = app;
      await sleep(1200);
      assert(await pro('isPro'), 'yeniden açılışta Pro yok');
      assert(await win.$('#pro-btn.on'), 'Pro düğmesi etkin değil');
      await shot('08-yeniden-acilis-pro');
    });

    await step('dosyadan içe aktar: yeni .hermopdflicense', async () => {
      await seeFree();
      await importFrom(newFile);
      assert(await pro('isPro'), 'Pro açılmadı');
      await shot('09-dosya-hermopdflicense');
    });

    await step('eski .ultronpdflicense dosyası hâlâ açılır', async () => {
      await seeFree();
      await importFrom(oldFile);
      assert(await pro('isPro'), 'Pro açılmadı');
      await shot('10-dosya-eski-ultronpdflicense');
    });

    await step('eski .ultronixlicense dosyası hâlâ açılır', async () => {
      await seeFree();
      await importFrom(oldFile2);
      assert(await pro('isPro'), 'Pro açılmadı');
      await shot('11-dosya-eski-ultronixlicense');
    });
  } finally {
    await app.close().catch(() => {});
    for (const f of [newFile, oldFile, oldFile2]) fs.rmSync(f, { force: true }); // gerçek anahtar disk üzerinde kalmasın
    fs.rmSync(ud, { recursive: true, force: true });
  }
  const bad = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - bad}/${results.length} adım başarılı`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
