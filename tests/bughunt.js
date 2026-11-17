// Hata avı regresyon testleri: iç içe pencereler, geri al sırası, kaydederken düzenleme,
// arayüz çökmesi, salt okunur dosyaya kaydetme, açık sekmenin üzerine kaydetme.
// Yalnızca geçici kopyalar kullanılır; sistem pencereleri kısa gecikmeyle taklit edilir.
// Kullanım: node tests/bughunt.js [adım-süzgeci]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument, StandardFonts } = require('@cantoo/pdf-lib');
const { launch, shot, sleep } = require('./harness');

const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const results = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-bug-'));

async function step(name, fn) {
  if (only && !only.test(name)) return;
  const t = Date.now();
  try {
    await global.__win.evaluate(() => { document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); });
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}: ${e.message.split('\n')[0]}`);
    await shot(global.__win, `FAILb-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
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
  const ro = await makePdf(path.join(work, 'salt-okunur.pdf'), 1);
  const { app, win } = await launch();
  global.__win = win;
  const U = 'app://pu/src/renderer/js/util.js';
  const closeAll = () => win.evaluate(async () => { for (const d of [...window.__pu.App.docs]) await window.__pu.closeDoc(d, { force: true }); });
  const openOne = async (p) => {
    await win.evaluate((f) => window.__pu.openPaths([f]), p);
    await win.waitForFunction((f) => window.__pu.App.docs.some((d) => d.path === f && d.pdf), p, { timeout: 15000 });
  };

  try {
    await step('İç içe pencere: Escape yalnız üstteki pencereyi kapatır, Enter dıştakine dokunmaz', async () => {
      const r = await win.evaluate(async (u) => {
        const { modal, promptBox } = await import(u);
        let outerRan = 0;
        const outer = modal({ title: 'Dış', body: 'x', buttons: [{ label: 'Vazgeç' }, { label: 'Birleştir', primary: true, run: () => { outerRan++; } }] });
        const inner = promptBox('Parola', { title: 'İç', type: 'password' });
        await new Promise((r2) => setTimeout(r2, 80));
        const live = () => [...document.querySelectorAll('.modal-backdrop:not(.out) h3')].map((h) => h.textContent);
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const afterEsc = live();
        await inner;
        const inner2 = promptBox('Parola', { title: 'İç', type: 'password' });
        await new Promise((r2) => setTimeout(r2, 80));
        const inp = document.querySelector('.modal-backdrop:not(.out) input');
        inp.value = '1234';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        const val = await inner2;
        const afterEnter = live();
        document.querySelector('.modal-backdrop:not(.out) .modal-x').click();
        await outer;
        return { afterEsc, afterEnter, val, outerRan };
      }, U);
      assert(JSON.stringify(r.afterEsc) === '["Dış"]', `Escape sonrası: ${JSON.stringify(r.afterEsc)}`);
      assert(r.val === '1234' && r.outerRan === 0 && JSON.stringify(r.afterEnter) === '["Dış"]', `Enter: ${JSON.stringify(r)}`);
    });

    await step('Onay penceresinde Enter arkadaki odaklı düğmeyi yeniden tıklamaz', async () => {
      const r = await win.evaluate(async (u) => {
        const { confirmBox } = await import(u);
        const btn = document.createElement('button');
        let clicks = 0;
        btn.onclick = () => { clicks++; };
        document.body.append(btn);
        btn.focus();
        const p = confirmBox('Emin misiniz?');
        await new Promise((r2) => setTimeout(r2, 50));
        const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(ev);
        if (!ev.defaultPrevented && document.activeElement === btn) btn.click(); // tarayıcının varsayılan etkinleştirmesi
        if (document.activeElement && document.activeElement !== btn && document.activeElement.tagName === 'BUTTON' && !ev.defaultPrevented) document.activeElement.click();
        const v = await p;
        btn.remove();
        return { v, clicks };
      }, U);
      assert(r.v === true && r.clicks === 0, JSON.stringify(r));
    });

    await step('Geri al / yinele aynı anda çağrılınca sıra korunur', async () => {
      const wa = path.join(work, 'sira.pdf');
      fs.copyFileSync(a, wa);
      await openOne(wa);
      const r = await win.evaluate(async (f) => {
        const d = window.__pu.App.docs.find((x) => x.path === f);
        const del = () => d.structural('Sayfa sil', (lib) => { const n = lib.getPageCount(); lib.removePage(n - 1); return Array.from({ length: n - 1 }, (_, k) => k); });
        await del(); await del();
        const out = [d.numPages];
        await Promise.all([d.undo(), d.undo()]);
        out.push(d.numPages);
        await d.redo(); out.push(d.numPages);
        await d.redo(); out.push(d.numPages);
        return out;
      }, wa);
      assert(JSON.stringify(r) === '[2,4,3,2]', `sayfa sayıları: ${JSON.stringify(r)}`);
      await closeAll();
    });

    await step('Kaydetme sürerken yapılan düzenleme kirli kalır', async () => {
      const wa = path.join(work, 'kirli.pdf');
      fs.copyFileSync(b, wa);
      await openOne(wa);
      const r = await win.evaluate(async (f) => {
        const d = window.__pu.App.docs.find((x) => x.path === f);
        d.markDirty();
        const orig = d.buildBytes.bind(d);
        d.buildBytes = async (...args) => { const x = await orig(...args); d.markDirty(); return x; };
        await d.save({ quiet: true });
        const dirtyAfter = d.dirty;
        d.buildBytes = orig;
        await d.save({ quiet: true });
        return { dirtyAfter, dirtyFinal: d.dirty };
      }, wa);
      assert(r.dirtyAfter === true && r.dirtyFinal === false, JSON.stringify(r));
      await closeAll();
    });

    await step('Salt okunur dosyaya kaydetme geçici dosya bırakmaz, anlaşılır hata verir', async () => {
      const wr = path.join(work, 'ro.pdf');
      fs.copyFileSync(ro, wr);
      fs.chmodSync(wr, 0o444);
      const msg = await win.evaluate(async (f) => {
        try { await window.pu.writeFile(f, new Uint8Array([37, 80, 68, 70]), {}); return 'yazıldı'; } catch (e) { return e.message; }
      }, wr);
      fs.chmodSync(wr, 0o666);
      const left = fs.readdirSync(work).filter((n) => n.endsWith('.pdfusta-tmp'));
      assert(/salt okunur/.test(msg), `mesaj: ${msg}`);
      assert(!left.length, `kalan geçici dosyalar: ${left.join(', ')}`);
    });

    await step('Açık sekmenin üzerine "Farklı kaydet" tek sekme bırakır', async () => {
      const wa = path.join(work, 'hedef.pdf');
      const wb = path.join(work, 'kaynak.pdf');
      fs.copyFileSync(a, wa);
      fs.copyFileSync(b, wb);
      await openOne(wa);
      await openOne(wb);
      await app.evaluate(({ dialog }, p) => {
        dialog.showSaveDialog = async () => { await new Promise((r) => setTimeout(r, 200)); return { canceled: false, filePath: p }; };
      }, wa);
      const r = await win.evaluate(async ([pa, pb]) => {
        const d = window.__pu.App.docs.find((x) => x.path === pb);
        await d.save({ as: true, quiet: true });
        const same = window.__pu.App.docs.filter((x) => x.path && x.path.toLowerCase() === pa.toLowerCase());
        return { n: same.length, isB: same[0] === d, pages: same[0]?.numPages };
      }, [wa, wb]);
      assert(r.n === 1 && r.isB && r.pages === 2, JSON.stringify(r));
      await closeAll();
    });

    await step('Arayüz çökünce pencere yeniden yüklenir', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
      // Playwright sayfa tutamacı çökmeden sonra kullanılamaz; durumu ana süreçten yokla
      let ok = false;
      for (let k = 0; k < 40 && !ok; k++) {
        await sleep(500);
        ok = await app.evaluate(async ({ BrowserWindow }) => {
          const wc = BrowserWindow.getAllWindows()[0].webContents;
          if (wc.isCrashed()) return false;
          return wc.executeJavaScript("document.body.dataset.ready === '1' && !!window.__pu").catch(() => false);
        });
      }
      assert(ok, 'renderer yeniden yüklenmedi');
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
