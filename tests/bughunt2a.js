// Hata avı 2 (A) regresyon testleri: silinen/karartılan sayfaların form alanları, sayfa kopyalarken
// bağlantılarla sürüklenen gizli sayfalar, şifreli belgenin yeniden kaydında korumanın kalması,
// birleştirmede parolanın bir kez sorulması.
// Yalnızca geçici kopyalar kullanılır; sistem pencereleri kısa gecikmeyle taklit edilir.
// Kullanım: node tests/bughunt2a.js [adım-süzgeci]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument, StandardFonts, PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString, PDFRawStream, decodePDFRawStream } = require('@cantoo/pdf-lib');
const { launch, shot, sleep } = require('./harness');

const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const results = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-bug2a-'));

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
    await shot(global.__win, `FAILb2a-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };

// Dosyanın herhangi bir yerinde (dize ya da çözülmüş akış, düz veya hex) metin var mı?
function containsText(lib, s) {
  const hex = Buffer.from(s, 'latin1').toString('hex').toUpperCase();
  const seen = new Set();
  const visit = (o) => {
    if (!o || seen.has(o)) return false;
    seen.add(o);
    if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText().includes(s);
    if (o instanceof PDFDict) return o.entries().some(([, v]) => visit(v));
    if (o instanceof PDFArray) return o.asArray().some(visit);
    if (o instanceof PDFRawStream) {
      let txt = '';
      try { txt = Buffer.from(decodePDFRawStream(o).decode()).toString('latin1'); } catch (e) { txt = Buffer.from(o.contents).toString('latin1'); }
      return txt.includes(s) || txt.toUpperCase().includes(hex) || visit(o.dict);
    }
    return false;
  };
  for (const [, obj] of lib.context.enumerateIndirectObjects()) if (visit(obj)) return true;
  return false;
}

async function makePages(lib, n) {
  const font = await lib.embedFont(StandardFonts.Helvetica);
  const pages = [];
  for (let i = 0; i < n; i++) { const p = lib.addPage([300, 400]); p.drawText(`Sayfa ${i + 1}`, { x: 40, y: 340, size: 24, font }); pages.push(p); }
  return pages;
}

// 2 sayfa; 1. sayfada dolu 'tc' alanı + yer imi, 2. sayfada 'ad' alanı
async function makeForm(file) {
  const lib = await PDFDocument.create();
  const [p1, p2] = await makePages(lib, 2);
  p1.node.set(PDFName.of('Gizli'), PDFString.of('SAYFA1GIZLI'));
  const form = lib.getForm();
  const tc = form.createTextField('tc'); tc.setText('TC12345678901'); tc.addToPage(p1, { x: 40, y: 200, width: 200, height: 24 });
  const ad = form.createTextField('ad'); ad.setText('KALANDEGER'); ad.addToPage(p2, { x: 40, y: 200, width: 200, height: 24 });
  const ctx = lib.context;
  const outl = ctx.nextRef();
  const item = ctx.nextRef();
  ctx.assign(item, ctx.obj({ Title: PDFHexString.fromText('Bir'), Parent: outl, Dest: [p1.ref, 'Fit'] }));
  ctx.assign(outl, ctx.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
  lib.catalog.set(PDFName.of('Outlines'), outl);
  fs.writeFileSync(file, await lib.save());
  return file;
}

// 3 sayfa; 1. sayfada 2. sayfaya /Dest bağlantısı ve 3. sayfaya /A GoTo bağlantısı; 3. sayfada gizli işaret
async function makeLinked(file) {
  const lib = await PDFDocument.create();
  const [p1, p2, p3] = await makePages(lib, 3);
  p2.node.set(PDFName.of('Gizli'), PDFString.of('IKINCI222'));
  p3.node.set(PDFName.of('Gizli'), PDFString.of('SECRET123'));
  const ctx = lib.context;
  const l1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 40], P: p1.ref, Dest: [p2.ref, 'Fit'] }));
  const l2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 50, 100, 80], P: p1.ref, A: { S: 'GoTo', D: [p3.ref, 'Fit'] } }));
  p1.node.set(PDFName.of('Annots'), ctx.obj([l1, l2]));
  fs.writeFileSync(file, await lib.save());
  return file;
}

async function makeEnc(file, { user, owner, permissions, pages = 2 }) {
  const lib = await PDFDocument.create();
  await makePages(lib, pages);
  lib.encrypt({ userPassword: user, ownerPassword: owner, permissions });
  fs.writeFileSync(file, await lib.save());
  return file;
}

const PERMS = { printing: 'lowResolution', copying: false, modifying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true };

(async () => {
  const formF = await makeForm(path.join(work, 'form-sil.pdf'));
  const formR = await makeForm(path.join(work, 'form-karart.pdf'));
  const linked = await makeLinked(path.join(work, 'bagli.pdf'));
  const enc = await makeEnc(path.join(work, 'sifreli.pdf'), { user: '1234', owner: 'abcd', permissions: PERMS });
  const ownerOnly = await makeEnc(path.join(work, 'sahip.pdf'), { user: '', owner: 'abcd', permissions: PERMS });
  const encMerge = await makeEnc(path.join(work, 'birlestir-sifreli.pdf'), { user: '1234', owner: 'abcd', permissions: PERMS });
  const plain = path.join(work, 'duz.pdf');
  { const l = await PDFDocument.create(); await makePages(l, 4); fs.writeFileSync(plain, await l.save()); }

  const { app, win } = await launch();
  global.__win = win;
  const PO = 'app://pu/src/renderer/js/pageops.js';
  const PC = 'app://pu/src/renderer/js/pdfcore.js';
  const PR = 'app://pu/src/renderer/js/protect.js';
  const closeAll = () => win.evaluate(async () => { for (const d of [...window.__pu.App.docs]) await window.__pu.closeDoc(d, { force: true }); });
  const openOne = async (p) => {
    await win.evaluate((f) => window.__pu.openPaths([f]), p);
    await win.waitForFunction((f) => window.__pu.App.docs.some((d) => d.path === f && d.pdf), p, { timeout: 15000 });
  };
  const clickModalBtn = (label) => win.locator('.modal .modal-foot button', { hasText: label }).last().click();
  const activeBytes = async () => Buffer.from(await win.evaluate(async () => Array.from(await window.__pu.App.active.buildBytes())));
  const openEncrypted = async (p, pw) => {
    const pr = win.evaluate((f) => window.__pu.openPaths([f]), p);
    await win.waitForSelector('.modal input[type=password]', { timeout: 15000 });
    await win.fill('.modal input[type=password]', pw);
    await clickModalBtn('Aç');
    await pr;
    await win.waitForFunction((f) => window.__pu.App.docs.some((d) => d.path === f && d.pdf), p, { timeout: 15000 });
  };
  // pdf.js ile izinleri oku; parolasız açılabiliyor mu?
  const permsOf = (file, pw) => win.evaluate(async ([f, pw2, pc]) => {
    const { openPdfjs } = await import(pc);
    const r = await window.pu.readPdf(f);
    let noPw = true;
    try { const t = await openPdfjs(r.bytes.slice()); t.destroy(); } catch (e) { noPw = false; }
    const o = await openPdfjs(r.bytes.slice(), pw2);
    const p0 = await o.doc.getPermissions();
    const perms = p0 ? [...p0] : null;
    o.destroy();
    return { perms, noPw };
  }, [file, pw, PC]);

  try {
    await step('Sayfa silinince o sayfanın form alanı, değeri ve sayfa içeriği dosyadan gider', async () => {
      await closeAll();
      await openOne(formF);
      await win.evaluate(async (po) => { const { deletePages } = await import(po); await deletePages(window.__pu.App.active, [0], { confirm: false }); }, PO);
      const lib = await PDFDocument.load(await activeBytes());
      const names = lib.getForm().getFields().map((f) => f.getName());
      assert(lib.getPageCount() === 1, `sayfa sayısı ${lib.getPageCount()}`);
      assert(!names.includes('tc') && names.includes('ad'), `alanlar: ${names}`);
      assert(!containsText(lib, 'TC12345678901'), 'silinen sayfanın form değeri dosyada duruyor');
      assert(!containsText(lib, 'SAYFA1GIZLI'), 'silinen sayfa (yer imi üzerinden) dosyada duruyor');
      assert(containsText(lib, 'KALANDEGER'), 'kalan alanın değeri kayboldu');
      const outl = lib.catalog.lookup(PDFName.of('Outlines'), PDFDict);
      const item = outl.lookup(PDFName.of('First'), PDFDict);
      const dest = item.lookup(PDFName.of('Dest'), PDFArray);
      assert(dest && dest.get(0) === lib.getPages()[0].ref, 'yer imi kalan sayfaya yönlenmedi');
    });

    await step('Karartma: karartılan sayfanın form alanı değeri dosyada kalmaz', async () => {
      await closeAll();
      await openOne(formR);
      const done = win.evaluate(async (pr) => {
        const { applyRedactions } = await import(pr);
        const d = window.__pu.App.active;
        d.pageObjs[0].push({ type: 'redact', x: 30, y: 30, w: 100, h: 40 });
        await applyRedactions(d);
      }, PR);
      await win.waitForSelector('.modal .modal-foot button:has-text("Uygula")', { timeout: 10000 });
      await clickModalBtn('Uygula');
      await done;
      const lib = await PDFDocument.load(await activeBytes());
      const names = lib.getForm().getFields().map((f) => f.getName());
      assert(lib.getPageCount() === 2, `sayfa sayısı ${lib.getPageCount()}`);
      assert(!names.includes('tc') && names.includes('ad'), `alanlar: ${names}`);
      assert(!containsText(lib, 'TC12345678901'), 'karartılan sayfanın form değeri dosyada duruyor');
      assert(!containsText(lib, 'SAYFA1GIZLI'), 'özgün sayfa dosyada duruyor');
    });

    await step('Sayfa çıkar/birleştir: bağlantı hedefi olan seçilmemiş sayfa çıktıya taşınmaz', async () => {
      await closeAll();
      const r = await win.evaluate(async ([f, pc]) => {
        const { loadPdfLib, copyPagesClean, savePdfLib } = await import(pc);
        const bytes = (await window.pu.readPdf(f)).bytes;
        const run = async (idx) => {
          const src = await loadPdfLib(bytes.slice());
          const out = await PDFLib.PDFDocument.create();
          const c = await copyPagesClean(out, src, idx);
          c.forEach((p) => out.addPage(p));
          const a0 = src.getPages()[0].node.Annots();
          const srcIntact = !!src.context.lookup(a0.get(0)).get(PDFLib.PDFName.of('Dest')) && !!src.context.lookup(src.context.lookup(a0.get(1)).get(PDFLib.PDFName.of('A'))).get(PDFLib.PDFName.of('D'));
          return { bytes: Array.from(await savePdfLib(out)), srcIntact };
        };
        return { one: await run([0]), two: await run([0, 1]) };
      }, [linked, PC]);
      const one = await PDFDocument.load(Buffer.from(r.one.bytes));
      assert(one.getPageCount() === 1, `tek sayfa: ${one.getPageCount()}`);
      assert(!containsText(one, 'SECRET123') && !containsText(one, 'IKINCI222'), 'bağlantılı gizli sayfa çıktıda');
      const two = await PDFDocument.load(Buffer.from(r.two.bytes));
      assert(!containsText(two, 'SECRET123'), '3. sayfa çıktıda');
      const ann = two.getPages()[0].node.Annots();
      const l1 = two.context.lookup(ann.get(0), PDFDict);
      const l2 = two.context.lookup(ann.get(1), PDFDict);
      const d1 = l1.lookup(PDFName.of('Dest'), PDFArray);
      assert(d1 && d1.get(0) === two.getPages()[1].ref, '2. sayfaya bağlantı yeni sayfaya bağlanmadı');
      assert(!l2.get(PDFName.of('A')), 'kopyalanmayan sayfaya giden bağlantı hedefi kaldı');
      assert(l1.get(PDFName.of('P')) === two.getPages()[0].ref, '/P yeni sayfayı göstermiyor');
      assert(r.one.srcIntact && r.two.srcIntact, 'kaynak belge değiştirildi');
    });

    await step('Şifreli PDF yeniden kaydedilince aynı parola ve izinlerle korunur', async () => {
      await closeAll();
      await openEncrypted(enc, '1234');
      const ok = await win.evaluate(async () => { const d = window.__pu.App.active; d.markDirty(); return d.save({ quiet: true }); });
      assert(ok !== false, 'kaydedilemedi');
      const { perms, noPw } = await permsOf(enc, '1234');
      assert(!noPw, 'parolasız açılabiliyor');
      assert(perms && perms.includes(0x04) && !perms.includes(0x10) && !perms.includes(0x800), `izinler: ${JSON.stringify(perms)}`);
    });

    await step('Yalnız sahip parolalı PDF yeniden kaydedilince kısıtlamalar korunur', async () => {
      await closeAll();
      await openOne(ownerOnly);
      const ok = await win.evaluate(async () => { const d = window.__pu.App.active; d.markDirty(); return d.save({ quiet: true }); });
      assert(ok !== false, 'kaydedilemedi');
      assert(fs.readFileSync(ownerOnly).toString('latin1').includes('/Encrypt'), 'şifreleme kaldırıldı');
      const { perms, noPw } = await permsOf(ownerOnly, '');
      assert(noPw, 'parolasız açılmalıydı');
      assert(perms && !perms.includes(0x10), `izinler: ${JSON.stringify(perms)}`);
    });

    await step('Birleştir: parolalı PDF için parola bir kez sorulur ve birleştirme tamamlanır', async () => {
      await closeAll();
      await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => { await new Promise((r) => setTimeout(r, 150)); return { canceled: false, filePaths: files }; }; }, [encMerge, plain]);
      await win.evaluate((po) => {
        window.__pwCount = 0;
        window.__pwObs?.disconnect();
        window.__pwObs = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && [...n.querySelectorAll('h3')].some((h) => /Parola gerekli/.test(h.textContent))) window.__pwCount++; })));
        window.__pwObs.observe(document.body, { childList: true, subtree: true });
        import(po).then((m) => m.mergeFilesDialog());
      }, PO);
      await win.locator('.modal button', { hasText: 'PDF ekle' }).click();
      await win.waitForSelector('.modal input[type=password]', { timeout: 10000 });
      await win.fill('.modal input[type=password]', '1234');
      await clickModalBtn('Tamam');
      await win.waitForFunction(() => document.querySelectorAll('.merge-list .recent-item').length === 2, null, { timeout: 10000 });
      await clickModalBtn('Birleştir');
      await win.waitForFunction(() => window.__pu.App.docs.some((d) => d.pdf && /birleştirilmiş/.test(d.name)) || document.querySelector('.modal input[type=password]'), null, { timeout: 20000 });
      const r = await win.evaluate(() => { window.__pwObs.disconnect(); const d = window.__pu.App.docs.find((x) => /birleştirilmiş/.test(x.name)); return { count: window.__pwCount, pages: d?.numPages }; });
      assert(r.count === 1, `parola ${r.count} kez soruldu`);
      assert(r.pages === 6, `birleşik sayfa sayısı ${r.pages}`);
    });
  } finally {
    // kirli sekme (birleşik belge) kapanışta "kaydedilsin mi?" sorup uygulamayı açık bırakmasın
    await closeAll().catch(() => {});
    await app.close().catch(() => {});
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} adım başarılı`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  ✘ ${r.name}: ${r.err}`);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* yoksay */ }
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
