// OCR ve toplu işlem Pro kapısı (ürün kararı, 12 Kas 2026) — uygulama içinden uçtan uca test.
// Ücretsiz kullanıcı OCR / toplu işleme basınca yükseltme penceresi açılır ve işlem ÇALIŞMAZ;
// açılışta ya da kendiliğinden yükseltme penceresi açılmaz; atılık Pro lisansıyla aynı girişler çalışır.
// Yalnızca sentetik PDF'ler (tests/fixtures) ve atılık lisans anahtarı kullanılır. Kullanım: node tests/pro-gates.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launch, shot, copyFixture, sleep } = require('./harness');
const { enableTestPro } = require('./license-helpers');

const PRO = enableTestPro({ email: 'kapi-testi@example.com' });
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
    if (curWin) await shot(curWin, `FAILpro-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-pro-'));
  const scan = copyFixture('scan.pdf', work);
  const { app, win, logs } = await launch({ args: [scan] });
  curWin = win;
  // Dosya seçme penceresi açılırsa işaretlenir (ücretsizde OCR için dosya bile sorulmamalı)
  await app.evaluate(({ dialog }) => {
    global.__opened = 0;
    dialog.showOpenDialog = async () => { global.__opened++; return { canceled: true, filePaths: [] }; };
  });
  const opened = () => app.evaluate(() => global.__opened);
  const count = (sel) => win.evaluate((s) => document.querySelectorAll(s).length, sel);
  const text = (sel) => win.evaluate((s) => document.querySelector(s)?.textContent || '', sel);
  const esc = async () => { await win.keyboard.press('Escape'); await sleep(200); };
  const closeAll = async () => { for (let i = 0; i < 6 && (await count('.modal-backdrop')); i++) await esc(); };
  const tab = async (id) => { await win.click(`.ribbon-tab[data-tab="${id}"]`); await sleep(150); };
  const expectUpgrade = async (re) => {
    await win.waitForSelector('.pro-modal .pro-asked', { timeout: 4000 });
    if (re) assert(re.test(await text('.pro-modal .pro-asked')), `özellik adı yok: ${await text('.pro-modal .pro-asked')}`);
  };
  const pageChars = () => win.evaluate(async () => {
    const d = window.__pu.App.active;
    d.textCache?.clear?.();
    const tc = await d.textContent(0);
    return tc.items.reduce((a, it) => a + (it.str || '').trim().length, 0);
  });

  try {
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 20000 });
    await sleep(800);

    await step('açılışta yükseltme penceresi açılmaz; lisans ücretsiz', async () => {
      await sleep(1200);
      assert(!(await count('.modal-backdrop')), 'açılışta pencere açıldı');
      assert((await PRO.isPro(win)) === false, 'Pro açık başladı');
    });

    const before = await pageChars();

    await step('şeritte OCR, Toplu ve Alan OCR düğmelerinde Pro rozeti var', async () => {
      await tab('home');
      assert(await win.$('#ribbon [data-action="tools.ocr"] .rpro .ic'), 'Giriş: OCR rozeti yok');
      assert(await win.$('#ribbon [data-action="tools.batch"] .rpro .ic'), 'Giriş: Toplu rozeti yok');
      assert(!(await win.$('#ribbon [data-action="tools.compress"] .rpro')), 'Küçült Pro işaretli olmamalı');
      await tab('tools');
      assert(await win.$('#ribbon [data-action="tools.ocr"] .rpro .ic'), 'Araçlar: OCR rozeti yok');
      assert(await win.$('#ribbon [data-action="tools.batch"] .rpro .ic'), 'Araçlar: Toplu rozeti yok');
      assert(await win.$('#ribbon [data-tool="ocrregion"] .rpro .ic'), 'Alan OCR rozeti yok');
    });

    await step('ücretsiz: OCR düğmesi yükseltme penceresini açar, OCR penceresi açılmaz', async () => {
      await win.click('#ribbon [data-action="tools.ocr"]');
      await expectUpgrade(/OCR/);
      const feats = await text('.pro-modal .pro-feats');
      for (const s of ['OCR (yazı tanıma)', 'Toplu işlemler', 'Kayıtlı iş akışları']) assert(feats.includes(s), `Pro listesinde eksik: ${s}`);
      assert(!/hiçbir özellik kilitlenmez|sonraki Pro özellikleri/i.test(await text('.pro-modal')), 'eski "kilitlenmez / sonraki dahil" metni duruyor');
      assert(!(await win.$('.modal .preview-line')), 'OCR penceresi açıldı');
      await closeAll();
    });

    await step('ücretsiz: Toplu işlem düğmesi yükseltme penceresini açar, toplu işlem penceresi açılmaz', async () => {
      await win.click('#ribbon [data-action="tools.batch"]');
      await expectUpgrade(/Toplu işlemler/);
      assert(!(await win.$('.batch-list')), 'toplu işlem penceresi açıldı');
      await closeAll();
    });

    await step('ücretsiz: "Dosyaya OCR" önce dosya sormaz, yükseltme penceresi açar', async () => {
      const n0 = await opened();
      await win.evaluate(() => { window.__pu.runAction('tools.ocrFile'); });
      await expectUpgrade(/OCR/);
      assert((await opened()) === n0, 'dosya seçme penceresi açıldı');
      await closeAll();
    });

    await step('ücretsiz: Alan OCR aracı seçilmez, bölge olayı çalışmaz', async () => {
      await win.click('#ribbon [data-tool="ocrregion"]');
      await expectUpgrade(/OCR/);
      assert((await win.evaluate(() => window.__pu.App.tool)) !== 'ocrregion', 'araç seçildi');
      await closeAll();
      await win.evaluate(() => { const a = window.__pu.App; a.emit('region:ocr', a.active, 0, { x: 40, y: 40, w: 300, h: 120 }); });
      await expectUpgrade(/OCR/);
      await sleep(500);
      assert(!(await win.$('.modal textarea')), 'tanınan metin penceresi açıldı');
      await closeAll();
    });

    await step('ücretsiz: modülü doğrudan çağırmak da işe yaramaz (ocrDialog / batchDialog)', async () => {
      await win.evaluate(() => { import('app://pu/src/renderer/js/ocr.js').then((m) => m.ocrDialog(window.__pu.App.active)); });
      await expectUpgrade(/OCR/);
      assert(!(await win.$('.modal .preview-line')), 'OCR penceresi açıldı');
      await closeAll();
      await win.evaluate(() => { import('app://pu/src/renderer/js/batch.js').then((m) => m.batchDialog()); });
      await expectUpgrade(/Toplu/);
      assert(!(await win.$('.batch-list')), 'toplu işlem penceresi açıldı');
      await closeAll();
    });

    await step('ücretsiz: OCR önerisi yalnızca bilgi + "Pro hakkında" gösterir; yükseltme kendiliğinden açılmaz', async () => {
      await win.evaluate(() => { import('app://pu/src/renderer/js/assist.js').then((m) => { window.__offer = m.offerOcr(window.__pu.App.active, { reason: 'deneme' }); }); });
      await win.waitForSelector('.modal .ocr-pro-note', { timeout: 4000 });
      assert(!(await win.$('.pro-modal')), 'yükseltme penceresi kendiliğinden açıldı');
      const btns = await win.evaluate(() => [...document.querySelectorAll('.modal .modal-foot button')].map((b) => b.textContent));
      assert(!btns.includes('OCR yap'), `"OCR yap" düğmesi var: ${btns}`);
      assert(btns.includes('Şimdi değil') && btns.includes('Pro hakkında'), `düğmeler: ${btns}`);
      await win.click('.modal .modal-foot button[data-id="pro"]');
      await expectUpgrade(/OCR/);
      assert((await win.evaluate(() => window.__offer)) === false, 'öneri OCR yapıldı dedi');
      await closeAll();
    });

    await step('ücretsiz: hiçbir yolla OCR yapılmadı (metin katmanı aynı)', async () => {
      const now = await pageChars();
      assert(now === before && now < 20, `metin değişti: ${before} → ${now}`);
    });

    await step('Pro lisansı (atılık anahtar) etkinleşir; yükseltme penceresi açılmaz', async () => {
      await PRO.activate(win);
      await sleep(300);
      assert(!(await count('.modal-backdrop')), 'pencere açıldı');
    });

    await step('Pro: OCR, Toplu işlem ve Alan OCR açılır', async () => {
      await tab('tools');
      await win.click('#ribbon [data-action="tools.ocr"]');
      await win.waitForSelector('.modal .preview-line', { timeout: 6000 });
      assert(!(await win.$('.pro-modal')), 'Pro iken yükseltme penceresi');
      await closeAll();
      await win.click('#ribbon [data-action="tools.batch"]');
      await win.waitForSelector('.batch-list', { timeout: 6000 });
      assert(!(await win.$('.pro-modal')), 'Pro iken yükseltme penceresi');
      await closeAll();
      await win.click('#ribbon [data-tool="ocrregion"]');
      await sleep(200);
      assert((await win.evaluate(() => window.__pu.App.tool)) === 'ocrregion', 'Alan OCR aracı seçilmedi');
      assert(!(await win.$('.pro-modal')), 'Pro iken yükseltme penceresi');
      await win.evaluate(() => window.__pu.setTool('select'));
    });

    await step('Pro: OCR önerisinde "OCR yap" düğmesi var, Pro notu yok', async () => {
      await win.evaluate(() => { import('app://pu/src/renderer/js/assist.js').then((m) => { m.offerOcr(window.__pu.App.active, { reason: 'deneme' }); }); });
      await win.waitForSelector('.modal .modal-foot button:has-text("OCR yap")', { timeout: 4000 });
      assert(!(await win.$('.modal .ocr-pro-note')), 'Pro iken Pro notu var');
      await closeAll();
    });

    await step('Pro: OCR gerçekten çalışır (taranmış sayfa aranabilir olur)', async () => {
      await win.evaluate(() => { window.__pu.runAction('tools.ocr'); });
      await win.waitForSelector('.modal .preview-line', { timeout: 6000 });
      await win.locator('.modal .modal-foot button', { hasText: 'Başlat' }).last().click();
      await win.waitForFunction(() => [...document.querySelectorAll('.toast span')].some((s) => /OCR tamamlandı/i.test(s.textContent)), null, { timeout: 180000 });
      await sleep(800);
      const after = await pageChars();
      assert(after > before + 20, `OCR metni eklenmedi: ${before} → ${after}`);
    });

    await step('lisans kaldırılınca OCR yeniden Pro kapısına takılır', async () => {
      await PRO.deactivate(win);
      await closeAll();
      await win.click('#ribbon [data-action="tools.ocr"]');
      await expectUpgrade(/OCR/);
      await closeAll();
    });

    await step('konsolda sayfa hatası yok', async () => {
      const bad = logs.filter((l) => /pageerror|Uncaught/i.test(l));
      assert(!bad.length, bad.join('\n').slice(0, 600));
    });
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
  }
  const fail = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} adım geçti`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
