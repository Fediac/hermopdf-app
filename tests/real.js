// Kurulu uygulamayı gerçek bir PDF ile açıp ekran görüntüsü alır.
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const path = require('path'); const os = require('os');
(async () => {
  const src = process.argv[2];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-real-'));
  const f = path.join(dir, path.basename(src));
  fs.copyFileSync(src, f);
  const exe = require('./harness').installedExe();
  const app = await electron.launch({ executablePath: exe, args: [f], env: { ...process.env, PDFUSTA_USERDATA: fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-ud-')), PDFUSTA_TEST: '1' } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await win.waitForSelector('.page canvas', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await win.screenshot({ path: path.join(__dirname, 'shots', 'real-1.png') });
  await win.locator('.ribbon-tab', { hasText: 'Sayfa' }).click();
  await new Promise((r) => setTimeout(r, 2000));
  await win.screenshot({ path: path.join(__dirname, 'shots', 'real-2.png') });
  await win.locator('.ribbon-tab', { hasText: 'Giriş' }).click();
  await app.close();
})();
