// Hata avı (2. tur, arayüz etkileşimi) regresyon testleri: yüklenirken aynı dosya, sayfa düzenleyici kısayolları,
// yazı düzenlerken Ctrl+S, pencere açıkken sürükle-bırak, sekme değişince yerleştirme modu, küçük resim kuyruğu,
// Ctrl+tekerlek yakınlaştırma, çift kapatma isteği, son açılanlar, sunum modu kısayolları.
// Yalnızca geçici kopyalar kullanılır. Kullanım: node tests/bughunt2b.js [adım-süzgeci]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument, StandardFonts } = require('@cantoo/pdf-lib');
const { launch, shot, sleep, copyFixture } = require('./harness');

const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const results = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-bug2b-'));

async function step(name, fn) {
  if (only && !only.test(name)) return;
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}: ${e.message.split('\n')[0]}`);
    await shot(global.__win, `FAILb2b-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
  }
  // Açık kalan pencereleri düğmeyle kapat (sayaçlar bozulmasın)
  for (let k = 0; k < 5; k++) {
    const n = await global.__win.evaluate(() => {
      const live = [...document.querySelectorAll('.modal-backdrop:not(.out):not(.progress-backdrop)')];
      const m = live[live.length - 1];
      if (!m) return 0;
      m.querySelector('.modal-x')?.click();
      return live.length;
    }).catch(() => 0);
    if (!n) break;
    await sleep(250);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };

async function makePdf(file, pages) {
  const lib = await PDFDocument.create();
  const font = await lib.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) lib.addPage([300, 400]).drawText(`Sayfa ${i + 1}`, { x: 40, y: 340, size: 24, font });
  fs.writeFileSync(file, await lib.save());
  return file;
}

(async () => {
  const a = await makePdf(path.join(work, 'a.pdf'), 4);
  const b = await makePdf(path.join(work, 'b.pdf'), 2);
  const c = await makePdf(path.join(work, 'c-birlestirme-girdisi.pdf'), 1);
  const big = await makePdf(path.join(work, 'buyuk-300.pdf'), 300);
  const enc = copyFixture('encrypted.pdf', work);
  const { app, win } = await launch();
  global.__win = win;
  await win.evaluate(() => {
    window.__rej = [];
    window.addEventListener('unhandledrejection', (e) => window.__rej.push(String(e.reason?.message || e.reason)));
  });
  const M = (f) => `app://pu/src/renderer/js/${f}`;
  const closeAll = () => win.evaluate(async () => { for (const d of [...window.__pu.App.docs]) await window.__pu.closeDoc(d, { force: true }); });
  const openOne = async (p) => {
    await win.evaluate((f) => window.__pu.openPaths([f]), p);
    await win.waitForFunction((f) => window.__pu.App.docs.some((d) => d.path === f && d.pdf && d.numPages), p, { timeout: 20000 });
  };
  const liveModals = () => win.evaluate(() => document.querySelectorAll('.modal-backdrop:not(.out)').length);
  const clickBtn = (label) => win.locator('.modal-backdrop:not(.out) button', { hasText: new RegExp(`^${label}$`) }).last().click();

  try {
    await step('Yüklenirken/parola sorulurken aynı dosya yeniden açılınca tek sekme olur', async () => {
      const p = win.evaluate((f) => Promise.all([window.__pu.openPaths([f]), window.__pu.openPaths([f])]), enc);
      await win.waitForSelector('.modal input[type=password]');
      await sleep(400);
      const pw = await win.evaluate(() => document.querySelectorAll('.modal-backdrop:not(.out) input[type=password]').length);
      await win.fill('.modal-backdrop:not(.out) input[type=password]', '1234');
      await clickBtn('Aç');
      await p;
      const n1 = await win.evaluate((f) => window.__pu.App.docs.filter((d) => d.path === f).length, enc);
      assert(pw === 1, `parola penceresi sayısı ${pw}`);
      assert(n1 === 1, `parolalı dosya sekme sayısı ${n1}`);
      await win.evaluate((f) => Promise.all([window.__pu.openPaths([f]), window.__pu.openPaths([f]), window.__pu.openPaths([f])]), a);
      const n2 = await win.evaluate((f) => window.__pu.App.docs.filter((d) => d.path === f).length, a);
      assert(n2 === 1, `normal dosya sekme sayısı ${n2}`);
      await closeAll();
    });

    await step('Sayfa düzenleyicide Delete seçili sayfaları siler, gizli nesneye dokunmaz', async () => {
      await openOne(a);
      await win.evaluate(() => { const d = window.__pu.App.active; d.addObj(0, { type: 'rect', x: 20, y: 20, w: 60, h: 40, color: '#ff0000', stroke: 2 }); });
      await win.evaluate((u) => import(u).then((m) => m.selectTab('page')), M('ribbon.js'));
      await win.waitForSelector('#organizer:not([hidden]) .org-page');
      const sel0 = await win.evaluate(() => window.__pu.App.active.selection.size);
      assert(sel0 === 0, `düzenleyici açılınca nesne seçimi temizlenmedi (${sel0})`);
      // Seçim yine de oluşursa (ör. nesne listesinden) Delete nesneyi silmemeli
      await win.evaluate(() => { const d = window.__pu.App.active; d.setSelection([d.pageObjs[0][0].id]); d.pageSel = new Set([1]); });
      await win.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })));
      // Tek sayfa onaysız silinir (birden çok sayfada onay sorulur)
      await win.waitForFunction(() => window.__pu.App.active.numPages === 3, null, { timeout: 15000 });
      const objs = await win.evaluate(() => window.__pu.App.active.pageObjs[0].length);
      assert(objs === 1, `1. sayfadaki nesne sayısı ${objs}`);
      await win.evaluate((u) => import(u).then((m) => m.selectTab('home')), M('ribbon.js'));
      await closeAll();
    });

    await step('Yazı kutusu düzenlenirken Ctrl+S kaydeder ve yazılan metni korur', async () => {
      const ac = path.join(work, 'yazi-kaydet.pdf');
      fs.copyFileSync(a, ac);
      await openOne(ac);
      const id = await win.evaluate(() => {
        const d = window.__pu.App.active;
        d.addObj(0, { type: 'text', ...window.__pu.App.defaults.text, x: 40, y: 80, w: 200, text: '' });
        window.__saves = 0;
        const orig = d.save.bind(d);
        d.save = (...args) => { window.__saves++; return orig(...args); };
        return [...d.selection][0];
      });
      await win.evaluate(([u, oid]) => import(u).then((m) => m.startTextEdit(window.__pu.App.active, oid)), [M('overlay.js'), id]);
      await win.waitForSelector('.pu-obj.editing .pu-text');
      await win.keyboard.type('abc');
      await win.keyboard.press('Control+s');
      await win.waitForFunction(() => window.__saves >= 1 && !window.__pu.App.active.dirty, null, { timeout: 15000 });
      const r = await win.evaluate((oid) => {
        const d = window.__pu.App.active;
        return { saves: window.__saves, text: d.findObj(oid)?.obj.text, editing: !!document.querySelector('.pu-obj.editing') };
      }, id);
      assert(r.saves === 1 && r.text === 'abc' && !r.editing, JSON.stringify(r));
      await closeAll();
    });

    await step('Pencere açıkken sürükle-bırak işlenmez', async () => {
      await openOne(a);
      const r = await win.evaluate(async (u) => {
        const { confirmBox } = await import(u);
        const docs0 = window.__pu.App.docs.length;
        const objs0 = window.__pu.App.active.pageObjs.flat().length;
        confirmBox('Sürükle-bırak deneme', { title: 'Deneme' });
        await new Promise((r2) => setTimeout(r2, 100));
        const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([png], 'a.png', { type: 'image/png' }));
        const target = document.querySelector('.modal-backdrop:not(.out)');
        target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
        const overlay = !!document.querySelector('.drop-overlay');
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        await new Promise((r2) => setTimeout(r2, 600));
        return {
          modals: document.querySelectorAll('.modal-backdrop:not(.out)').length,
          docs: window.__pu.App.docs.length - docs0,
          objs: window.__pu.App.active.pageObjs.flat().length - objs0,
          overlay,
        };
      }, M('util.js'));
      assert(r.modals === 1 && r.docs === 0 && r.objs === 0 && !r.overlay, JSON.stringify(r));
      await clickBtn('Vazgeç');
      await closeAll();
    });

    await step('Sekme değişince yerleştirme modu kapanır; başka belgenin görseli hata vermez', async () => {
      await openOne(a);
      await openOne(b);
      const r1 = await win.evaluate(() => {
        const { App, activate, setTool } = window.__pu;
        const A = App.docs.find((d) => d.numPages === 4);
        const B = App.docs.find((d) => d.numPages === 2);
        activate(A);
        const assetId = A.addAsset('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 1, 1);
        setTool('place', { place: { assetId, w: 1, h: 1, label: 'İmza' } });
        const before = App.tool;
        activate(B);
        const after = App.tool;
        // Elle yeniden A'nın görseliyle B'de yerleştirme modu kur (eski hata yolu)
        setTool('place', { place: { assetId, w: 1, h: 1, label: 'İmza' } });
        return { before, after };
      });
      assert(r1.before === 'place' && r1.after === 'select', JSON.stringify(r1));
      await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 15000 });
      const box = await win.locator('.doc-view:not(.hidden) .page').first().boundingBox();
      await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(400);
      const r2 = await win.evaluate(() => ({
        tool: window.__pu.App.tool,
        objs: window.__pu.App.active.pageObjs.flat().length,
        previews: document.querySelectorAll('.doc-view:not(.hidden) .pu-preview, .doc-view:not(.hidden) .place').length,
        rej: window.__rej.slice(),
      }));
      assert(r2.tool === 'select' && r2.objs === 0 && r2.previews === 0 && !r2.rej.length, JSON.stringify(r2));
      await closeAll();
    });

    await step('Küçük resimler sınırlı kuyrukla çizilir; sona kaydırınca son sayfalar gelir', async () => {
      await openOne(big);
      await win.evaluate((u) => import(u).then((m) => m.selectTab('page')), M('ribbon.js'));
      await win.waitForSelector('#organizer:not([hidden]) .org-page');
      const r = await win.evaluate(async () => {
        const host = document.querySelector('#organizer');
        let maxRun = 0;
        const t0 = Date.now();
        const tick = setInterval(() => { maxRun = Math.max(maxRun, window.__pu.App.thumbStats.organizer().running); }, 5);
        for (let k = 0; k < 10; k++) { host.scrollTop += host.scrollHeight / 10; await new Promise((r2) => setTimeout(r2, 30)); }
        host.scrollTop = host.scrollHeight;
        const last = () => document.querySelector('.org-page[data-i="299"] canvas');
        while (!last() && Date.now() - t0 < 15000) await new Promise((r2) => setTimeout(r2, 50));
        clearInterval(tick);
        const drawn = document.querySelectorAll('.org-page canvas').length;
        return { maxRun, last: !!last(), drawn, ms: Date.now() - t0 };
      });
      assert(r.maxRun <= 2 && r.last && r.drawn < 150, JSON.stringify(r));
      await win.evaluate((u) => import(u).then((m) => m.selectTab('home')), M('ribbon.js'));
      // Kenar çubuğu küçük resimleri de aynı kuyrukla çizilir
      await win.evaluate((u) => import(u).then((m) => { document.querySelector('#sidebar').hidden = false; m.refreshSidebar(); }), M('sidebar.js'));
      await win.waitForSelector('#sidebar-body .thumb canvas', { timeout: 10000 });
      const sb = await win.evaluate(() => window.__pu.App.thumbStats.sidebar());
      await win.evaluate(() => { document.querySelector('#sidebar').hidden = true; });
      assert(sb.running <= 2, JSON.stringify(sb));
      await closeAll();
    });

    await step('Ctrl+tekerlek/kıstırma küçük adımları toplar (zoom fırtınası yok)', async () => {
      await openOne(a);
      await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 15000 });
      const r = await win.evaluate(async () => {
        const d = window.__pu.App.active;
        d.viewer.currentScaleValue = '1';
        await new Promise((r2) => setTimeout(r2, 200));
        const vc = document.querySelector('.doc-view:not(.hidden) .viewer-container');
        const rc = vc.getBoundingClientRect();
        const fire = (dy) => vc.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true, clientX: rc.left + 100, clientY: rc.top + 100 }));
        for (let k = 0; k < 30; k++) { fire(-2); await new Promise((r2) => setTimeout(r2, 6)); }
        await new Promise((r2) => setTimeout(r2, 400));
        const pinch = d.viewer.currentScale;
        d.viewer.currentScaleValue = '1';
        await new Promise((r2) => setTimeout(r2, 200));
        fire(-100);
        await new Promise((r2) => setTimeout(r2, 400));
        return { pinch, notch: d.viewer.currentScale };
      });
      assert(r.pinch > 1 && r.pinch < 1.5, `kıstırma sonrası ölçek ${r.pinch}`);
      assert(r.notch > 1.05 && r.notch < 1.2, `tek tık sonrası ölçek ${r.notch}`);
      await closeAll();
    });

    await step('Kapatma isteği iki kez gelince tek soru açılır; kapanmış belge yeniden kapatılınca son sekme düşmez', async () => {
      await openOne(a);
      await openOne(b);
      await win.evaluate(() => { for (const d of window.__pu.App.docs) d.addObj(0, { type: 'rect', x: 10, y: 10, w: 20, h: 20, color: '#000000', stroke: 1 }); });
      await app.evaluate(({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.send('close-request'); wc.send('close-request'); });
      await sleep(600);
      const n = await liveModals();
      assert(n === 1, `açık soru sayısı ${n}`);
      await clickBtn('Vazgeç');
      await sleep(300);
      const r = await win.evaluate(async () => {
        const { App, closeDoc } = window.__pu;
        const [A, B] = App.docs;
        await closeDoc(A, { force: true });
        const again = await closeDoc(A);
        return { again, n: App.docs.length, hasB: App.docs.includes(B), modals: document.querySelectorAll('.modal-backdrop:not(.out)').length };
      });
      assert(r.again === true && r.n === 1 && r.hasB && r.modals === 0, JSON.stringify(r));
      await closeAll();
    });

    await step('Son açılanlar oturumda güncellenir; birleştirme girdisi eklenmez; olmayan dosya listeden düşer', async () => {
      await openOne(b);
      await win.waitForFunction((f) => (window.__pu.App.settings.recent || []).includes(f), b, { timeout: 5000 });
      await closeAll();
      const r = await win.evaluate(async (f) => {
        await window.pu.readPdf(f); // birleştirme/ekleme girdisi gibi yalnızca okunur
        return (await window.pu.addRecent('')).includes(f);
      }, c);
      assert(!r, 'yalnızca okunan dosya son açılanlara eklendi');
      const ghost = path.join(work, 'silinmis.pdf');
      await win.evaluate(async ([u, g]) => {
        window.__pu.App.settings.recent = await window.pu.addRecent(g);
        (await import(u)).renderStart();
      }, [M('app.js'), ghost]);
      const items = await win.evaluate(() => [...document.querySelectorAll('#start .recent-item')].map((x) => x.title));
      assert(items.includes(b) && items.includes(ghost), `başlangıç listesi: ${JSON.stringify(items)}`);
      await win.locator('#start .recent-item', { hasText: 'silinmis.pdf' }).first().click();
      await win.waitForFunction((g) => !(window.__pu.App.settings.recent || []).includes(g), ghost, { timeout: 5000 });
      const main = await win.evaluate(() => window.pu.addRecent(''));
      assert(!main.includes(ghost), 'ana süreçte olmayan dosya kaldı');
    });

    await step('Sunum modunda Delete/Ctrl+W/Ctrl+Tab gizli belgelere dokunmaz', async () => {
      await openOne(b);
      await openOne(a);
      await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 15000 });
      const before = await win.evaluate(() => {
        const d = window.__pu.App.active;
        d.addObj(0, { type: 'rect', x: 10, y: 10, w: 20, h: 20, color: '#000000', stroke: 1 });
        window.__pu.runAction('tools.present');
        return { objs: d.pageObjs[0].length, docs: window.__pu.App.docs.length, name: d.name };
      });
      await win.waitForFunction(() => document.body.classList.contains('presenting') && window.__pu.App.exitPresentation, null, { timeout: 5000 });
      await sleep(400);
      await win.keyboard.press('Delete');
      await win.keyboard.press('Control+w');
      await win.keyboard.press('Control+Tab');
      await sleep(300);
      const mid = await win.evaluate(() => ({
        objs: window.__pu.App.active.pageObjs[0].length,
        docs: window.__pu.App.docs.length,
        name: window.__pu.App.active.name,
        presenting: document.body.classList.contains('presenting'),
        modals: document.querySelectorAll('.modal-backdrop:not(.out)').length,
      }));
      assert(mid.objs === before.objs && mid.docs === before.docs && mid.name === before.name && mid.presenting && !mid.modals, JSON.stringify({ before, mid }));
      await win.keyboard.press('Escape');
      await win.waitForFunction(() => !document.body.classList.contains('presenting'), null, { timeout: 5000 });
      await sleep(300);
      await closeAll();
    });
  } finally {
    await app.close().catch(() => {});
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} adım başarılı`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  ✘ ${r.name}: ${r.err}`);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* yoksay */ }
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
