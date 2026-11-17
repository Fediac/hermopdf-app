// Görsel → PDF hız/donma ölçümü: gerçek görsellerle dönüştürür, arayüz donmasını (en uzun kare boşluğu) ölçer.
// Kullanım: node tests/convperf.js [görsel1 görsel2 ...]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launch, shot, sleep, FIX } = require('./harness');

const defaults = [path.join(FIX, 'photo.jpg'), path.join(FIX, 'logo.png')].filter((f) => fs.existsSync(f));
const files = process.argv.slice(2).length ? process.argv.slice(2) : defaults;

// Arayüz donmasını ölç: her karede zaman damgası, en büyük boşluk = en uzun donma
const startJank = () => {
  window.__jank = { max: 0, last: performance.now(), on: true };
  const tick = () => {
    const j = window.__jank;
    if (!j.on) return;
    const now = performance.now();
    j.max = Math.max(j.max, now - j.last);
    j.last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const stopJank = () => { window.__jank.on = false; return Math.round(window.__jank.max); };

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-perf-'));
  const { app, win, logs } = await launch();
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: global.__nextOpen || [] }); });
  const run = async (list, label, quality) => {
    await app.evaluate((_, f) => { global.__nextOpen = f; }, list);
    const n0 = await win.evaluate(() => window.__pu.App.docs.length);
    const t0 = Date.now();
    await win.evaluate(startJank);
    await win.evaluate(() => { window.__pu.runAction('convert.imagesToPdf'); });
    await win.waitForSelector('.modal .modal-foot button:has-text("PDF oluştur")', { timeout: 60000 });
    const tDialog = Date.now() - t0;
    const jankDialog = await win.evaluate(() => window.__jank.max);
    if (quality) await win.locator('.modal select').nth(2).selectOption(quality);
    await win.evaluate(() => { window.__jank.max = 0; });
    const t1 = Date.now();
    await win.locator('.modal .modal-foot button', { hasText: 'PDF oluştur' }).click();
    await win.waitForFunction((n) => window.__pu.App.docs.length > n, n0, { timeout: 180000 });
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 60000 });
    const tBuild = Date.now() - t1;
    const jankBuild = await win.evaluate(stopJank);
    const info = await win.evaluate(async () => { const d = window.__pu.App.active; const b = await d.buildBytes({ encrypt: false }); return { pages: d.numPages, kb: Math.round(b.length / 1024) }; });
    console.log(`${label}: pencere ${tDialog} ms (en uzun donma ${Math.round(jankDialog)} ms) | PDF ${tBuild} ms (en uzun donma ${jankBuild} ms) | ${info.pages} sayfa, ${info.kb} KB`);
    return { tDialog, tBuild, jankDialog, jankBuild, ...info };
  };
  try {
    await sleep(800);
    const out = {};
    for (const f of files) {
      const kb = Math.round(fs.statSync(f).size / 1024);
      out[path.basename(f)] = await run([f], `${path.basename(f)} (${kb} KB)`);
    }
    out.all = await run(files, `Hepsi birden (${files.length} görsel)`);
    out.small = await run(files, 'Hepsi birden, küçük dosya', 'small');
    await shot(win, 'perf-gorsel-pdf');
    fs.writeFileSync(path.join(work, 'perf.json'), JSON.stringify(out, null, 2));
  } catch (e) {
    console.log('HATA:', e.message);
    await shot(win, 'perf-fail').catch(() => {});
  }
  if (logs.length) console.log(logs.slice(0, 10).join('\n'));
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; })).catch(() => {});
  await app.close();
})();
