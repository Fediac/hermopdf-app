// Tek bir senaryoyu ayrıntılı günlükle çalıştırmak için hata ayıklama betiği.
const fs = require('fs');
const path = require('path');
const { launch, shot, copyFixture, sleep } = require('./harness');

(async () => {
  const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pdfusta-dbg-'));
  const scenario = process.argv[2];
  const { app, win, logs } = await launch();
  win.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
  await app.evaluate(({ dialog }, work) => {
    dialog.showSaveDialog = async (w, o) => ({ canceled: false, filePath: work + '\\' + String((o || w).defaultPath || 'x.pdf').split(/[\\/]/).pop() });
  }, work);
  try {
    if (scenario === 'pw') {
      const enc = copyFixture('encrypted.pdf', work);
      win.evaluate((f) => { window.__pu.openPaths([f]); }, enc);
      await win.waitForSelector('.modal input[type=password]');
      await win.fill('.modal input[type=password]', '1234');
      await win.locator('.modal .modal-foot button', { hasText: 'Aç' }).click();
      await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 15000 });
      const st = await win.evaluate(() => { const d = window.__pu.App.active; return { dirty: d.dirty, enc: d.encryption, pw: d.openedPassword, ro: d.readOnlyReason }; });
      console.log('state', st);
      await win.evaluate(() => { window.__pu.runAction('protect.removePassword'); });
      await sleep(500);
      await shot(win, 'dbg-pw1');
      await win.locator('.modal .modal-foot button', { hasText: 'Kaldır' }).click();
      await sleep(2500);
      await shot(win, 'dbg-pw2');
      console.log('toasts', await win.evaluate(() => [...document.querySelectorAll('.toast span')].map((s) => s.textContent)));
    }
    if (scenario === 'snap' || scenario === 'drag') {
      const f = copyFixture('test.pdf', work);
      await win.evaluate((p) => window.__pu.openPaths([p]), f);
      await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 15000 });
      await sleep(800);
      if (scenario === 'snap') {
        await win.evaluate(() => window.__pu.setTool('snapshot'));
        const b = await win.locator('.page[data-page-number="1"]').boundingBox();
        await win.mouse.move(b.x + 40, b.y + 40);
        await win.mouse.down();
        await win.mouse.move(b.x + 300, b.y + 250, { steps: 5 });
        await win.mouse.up();
        await sleep(2500);
        console.log('toasts', await win.evaluate(() => [...document.querySelectorAll('.toast span')].map((s) => s.textContent)));
        console.log('tool', await win.evaluate(() => window.__pu.App.tool));
      } else {
        await win.locator('.ribbon-tab', { hasText: 'Sayfa' }).click();
        await win.waitForSelector('.org-page canvas', { timeout: 10000 });
        if (process.argv[3] === 'pre') {
          await win.evaluate(async () => {
            const d = window.__pu.App.active;
            d.addObj(0, { type: 'rect', x: 50, y: 50, w: 100, h: 60, color: '#f00', sw: 2 });
            const m = await import('./js/pageops.js');
            await m.rotatePages(d, [3], 90);
            await m.deletePages(d, [2], { confirm: false });
            await d.undo();
          });
          await sleep(1500);
        }
        const sb = await win.locator('.org-page[data-i="3"] .cv').boundingBox();
        const db = await win.locator('.org-page[data-i="0"]').boundingBox();
        await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
        await win.mouse.down();
        await win.mouse.move(db.x + db.width * 0.5, db.y + 80, { steps: 12 });
        await win.mouse.move(db.x + 12, db.y + 80, { steps: 6 });
        await win.mouse.up();
        await sleep(2500);
        console.log('toasts', await win.evaluate(() => [...document.querySelectorAll('.toast span')].map((s) => s.textContent)));
        const first = await win.evaluate(async () => { const p = await window.__pu.App.active.pdf.getPage(1); return (await p.getTextContent()).items.map((i) => i.str).join(' ').slice(0, 60); });
        console.log('first page:', first);
        await shot(win, 'dbg-drag');
      }
    }
  } catch (e) {
    console.log('HATA', e.message);
  }
  console.log(logs.join('\n'));
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; }));
  await app.close();
})();
