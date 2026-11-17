// Donma testi: arka arkaya birkaç PDF açıp arayüzün yanıt verip vermediğini ölçer.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launch, shot, sleep } = require('./harness');

const SRC = process.argv[2];
if (!SRC) { console.error('Kullanım: node tests/freeze.js <pdf-klasörü>'); process.exit(2); }

async function ping(win, label, ms = 8000) {
  const t = Date.now();
  await Promise.race([
    win.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(1)))),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`DONDU: ${label} (${ms}ms yanıt yok)`)), ms)),
  ]);
  return Date.now() - t;
}

(async () => {
  const files = fs.readdirSync(SRC).filter((f) => /\.pdf$/i.test(f)).slice(0, 5).map((f) => path.join(SRC, f));
  console.log('dosyalar:', files.length, files.map((f) => path.basename(f)).join(' | '));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-freeze-'));
  const { app, win, logs } = await launch({ args: [files[0]] });
  await app.evaluate(({ dialog }, work) => {
    dialog.showSaveDialog = async (w, o) => ({ canceled: false, filePath: work + '\\' + String((o || w).defaultPath || 'x.pdf').split(/[\\/]/).pop() });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: global.__nextOpen || [] });
  }, work);
  try {
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 30000 });
    console.log('1. dosya açıldı, ping:', await ping(win, 'ilk dosya'), 'ms');
    for (let k = 1; k < files.length; k++) {
      await app.evaluate((_, f) => { global.__nextOpen = [f]; }, files[k]);
      const t0 = Date.now();
      await win.evaluate(() => { window.__pu.runAction('file.open'); });
      // yeni sekme gelene kadar bekle
      await win.waitForFunction((n) => window.__pu.App.docs.length === n, k + 1, { timeout: 30000 });
      await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 30000 });
      await sleep(400);
      const p = await ping(win, `${k + 1}. dosya`);
      console.log(`${k + 1}. dosya açıldı (${Date.now() - t0} ms), ping: ${p} ms, sekme: ${await win.evaluate(() => window.__pu.App.docs.length)}`);
      // sekmeler arasında geçiş de dene
      await win.evaluate(() => { const a = window.__pu.App; window.__pu.activate(a.docs[0]); });
      await sleep(300);
      console.log('   sekme 1\'e geçiş pingi:', await ping(win, 'sekme geçişi'), 'ms');
      await win.evaluate(() => { const a = window.__pu.App; window.__pu.activate(a.docs[a.docs.length - 1]); });
      await sleep(300);
    }
    await shot(win, 'freeze-ok');
    console.log('SONUÇ: donma yok');
  } catch (e) {
    console.log('SONUÇ:', e.message);
    await shot(win, 'freeze-fail').catch(() => {});
  }
  console.log(logs.slice(0, 20).join('\n'));
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; })).catch(() => {});
  await app.close();
})();
