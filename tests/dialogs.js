// Tüm iletişim kutularının görsel kontrolü: her birini açar, ekran görüntüsünü alır.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch, shot, copyFixture, sleep } = require('./harness');
const { enableTestPro } = require('./license-helpers');
// OCR ve toplu işlem Pro özelliği (12 Kas 2026): bu testler onları kullandığı için atılık bir Pro lisansı etkinleştirilir
const PRO = enableTestPro();

const DIALOGS = [
  ['doc.watermark', 'dlg-filigran', '.wm-preview canvas'],
  ['doc.headerFooter', 'dlg-ustalt', '.hf-img-row'],
  ['doc.pageNumbers', 'dlg-sayfano', '.range-quick'],
  ['page.extract', 'dlg-cikar', '.range-quick'],
  ['page.split', 'dlg-bol', '.radio-list'],
  ['page.insertBlank', 'dlg-bossayfa', '.preview-line'],
  ['page.resize', 'dlg-boyut', '.modal'],
  ['tools.ocr', 'dlg-ocr', '.preview-line'],
  ['tools.compress', 'dlg-kucult', '.radio-list'],
  ['convert.docx', 'dlg-word', '.range-quick'],
  ['protect.metadata', 'dlg-metaveri', '.info-table'],
  ['form.flatten', 'dlg-duzlestir', '.info-box'],
  ['protect.password', 'dlg-parola', '.modal'],
  ['insert.stamp', 'dlg-damga', '.stamp-grid img'],
  ['insert.signature', 'dlg-imza', '.sig-tabs'],
  ['tools.batch', 'dlg-toplu', '.batch-list'],
];

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-dlg-'));
  const f = copyFixture('test.pdf', work);
  const { app, win, logs } = await launch({ args: [f] });
  await PRO.activate(win);
  await app.evaluate(({ dialog }, work) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  }, work);
  await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 20000 });
  await sleep(800);
  const dark = process.argv[2] === 'dark';
  if (dark) { await win.click('#theme-btn'); await sleep(400); }
  for (const [action, name, sel] of DIALOGS) {
    try {
      await win.evaluate((a) => { window.__pu.runAction(a); }, action);
      await win.waitForSelector('.modal', { timeout: 10000 });
      if (sel) await win.waitForSelector(sel, { timeout: 15000 }).catch(() => {});
      await sleep(900);
      const box = await win.locator('.modal').last().boundingBox();
      await win.screenshot({ path: path.join(__dirname, 'shots', `${name}${dark ? '-koyu' : ''}.png`), clip: box ? { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(box.width + 20, 1400), height: Math.min(box.height + 20, 900) } : undefined });
      console.log('✔', name);
    } catch (e) {
      console.log('✘', name, e.message);
      await shot(win, `${name}-HATA`).catch(() => {});
    }
    await win.evaluate(() => { document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); });
    await sleep(200);
  }
  console.log(logs.filter((l) => !/TT: undefined|Autofill|Security Warning/.test(l)).slice(0, 10).join('\n'));
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; })).catch(() => {});
  await app.close();
})();
