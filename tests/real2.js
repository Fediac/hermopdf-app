// Kurulu uygulamada gerçek gümrük beyannamesiyle son kontrol.
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const path = require('path'); const os = require('os');
(async () => {
  const src = process.argv[2];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-real2-'));
  const f = path.join(dir, path.basename(src));
  fs.copyFileSync(src, f);
  const exe = require('./harness').installedExe();
  const app = await electron.launch({ executablePath: exe, args: [f], env: { ...process.env, PDFUSTA_USERDATA: fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-ud2-')), PDFUSTA_TEST: '1' } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await win.waitForSelector('.page canvas', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));
  const shots = path.join(__dirname, 'shots');
  // sağ tık menüsü
  const b = await win.locator('.doc-view:not(.hidden) .page').first().boundingBox();
  await win.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.35, { button: 'right' });
  await win.waitForSelector('.ctx-menu', { timeout: 8000 });
  await win.screenshot({ path: path.join(shots, 'son-01-sagtik.png') });
  await win.locator('.ctx-item', { hasText: 'Görseli kopyala' }).first().click();
  await win.waitForFunction(() => [...document.querySelectorAll('.toast span')].some((s) => /panoya kopyaland/i.test(s.textContent)), null, { timeout: 30000 });
  await win.screenshot({ path: path.join(shots, 'son-02-kopyalandi.png') });
  const size = await app.evaluate(async ({ clipboard }) => { const items = await clipboard.read(); const it = items.find((x) => x.types.includes('image/png')); const bb = await it.getType('image/png'); return bb.size; });
  console.log('pano görsel boyutu:', size);
  // OCR penceresi
  await win.evaluate(() => { window.__pu.runAction('tools.ocr'); });
  await win.waitForSelector('.modal .preview-line', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await win.screenshot({ path: path.join(shots, 'son-03-ocr.png') });
  await win.locator('.modal .modal-foot button', { hasText: 'Vazgeç' }).click();
  // toplu işlem
  await win.evaluate(() => { window.__pu.runAction('tools.batch'); });
  await win.waitForSelector('.batch-list', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));
  await win.screenshot({ path: path.join(shots, 'son-04-toplu.png') });
  await win.locator('.modal .modal-foot button', { hasText: 'Vazgeç' }).click();
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; }));
  await app.close();
  console.log('bitti');
})();
