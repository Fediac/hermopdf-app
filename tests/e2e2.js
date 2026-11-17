// İkinci tur uçtan uca testler: kullanıcı geri bildirimiyle gelen düzeltmeler.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launch, shot, copyFixture, sleep, FIX } = require('./harness');
const { enableTestPro } = require('./license-helpers');
// OCR ve toplu işlem Pro özelliği (12 Kas 2026): bu testler onları kullandığı için atılık bir Pro lisansı etkinleştirilir
const PRO = enableTestPro();

const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const results = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-e2e2-'));
const SCAN = process.env.PU_SCAN_PDF || path.join(FIX, 'scan-layers.pdf');

async function step(name, fn) {
  if (only && !only.test(name)) return;
  const t = Date.now();
  try {
    if (global.__win) await global.__win.evaluate(() => { document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); window.__pu.setTool('select'); });
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}: ${e.message}`);
    if (global.__win) await shot(global.__win, `FAIL2-${name.replace(/[^\w]+/g, '_')}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };
async function clickModalBtn(win, label) { await win.locator('.modal .modal-foot button', { hasText: label }).last().click(); }
async function waitToast(win, re, timeout = 25000) {
  await win.waitForFunction((src) => [...document.querySelectorAll('.toast span')].some((s) => new RegExp(src, 'i').test(s.textContent)), re.source, { timeout });
}
async function ping(win, ms = 6000) {
  await Promise.race([
    win.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(1)))),
    new Promise((_, rej) => setTimeout(() => rej(new Error('arayüz yanıt vermiyor (donma)')), ms)),
  ]);
}

(async () => {
  const testPdf = copyFixture('test.pdf', work);
  const { app, win, logs } = await launch({ args: [testPdf] });
  global.__win = win;
  await PRO.activate(win);
  await app.evaluate(({ dialog }, work) => {
    dialog.showSaveDialog = async (w, o) => ({ canceled: false, filePath: work + '\\' + String((o || w).defaultPath || 'x.pdf').split(/[\\/]/).pop() });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: global.__nextOpen || [] });
  }, work);
  const setNextOpen = (files) => app.evaluate((_, files) => { global.__nextOpen = files; }, files);
  await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 20000 });
  await sleep(600);

  await step('Arka arkaya 3 PDF açılır, arayüz donmaz', async () => {
    for (const f of ['a.pdf', 'b.pdf', 'scan.pdf']) {
      await setNextOpen([copyFixture(f, work)]);
      await win.evaluate(() => { window.__pu.runAction('file.open'); });
      await win.waitForFunction((n) => window.__pu.App.docs.length >= n, 2, { timeout: 20000 });
      await sleep(500);
      await ping(win);
    }
    const n = await win.evaluate(() => window.__pu.App.docs.length);
    assert(n === 4, `sekme sayısı ${n}`);
    await shot(win, 'n01-coklu-sekme');
  });

  await step('Sekmeler sürüklenerek sıralanır', async () => {
    const names0 = await win.evaluate(() => window.__pu.App.docs.map((d) => d.name));
    const tabs = await win.locator('.doctab').all();
    const a = await tabs[3].boundingBox();
    const b = await tabs[0].boundingBox();
    await win.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await win.mouse.down();
    await win.mouse.move(a.x + a.width / 2 - 30, a.y + a.height / 2, { steps: 6 });
    await sleep(120);
    await win.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2, { steps: 12 });
    await sleep(150);
    await win.mouse.up();
    await sleep(500);
    const names1 = await win.evaluate(() => window.__pu.App.docs.map((d) => d.name));
    assert(names1[0] === names0[3], `sıra değişmedi: ${names1.join(',')}`);
    await shot(win, 'n02-sekme-sira');
  });

  await step('Kapatma penceresi: kaydedilmemiş değişiklik uyarısı', async () => {
    // ilk belgeye geç, değişiklik yap, kapat
    await win.evaluate(() => {
      const a = window.__pu.App;
      const d = a.docs.find((x) => x.name === 'test.pdf');
      window.__pu.activate(d);
      d.addObj(0, { type: 'text', font: 'Arial', size: 12, color: '#000', x: 60, y: 60, w: 160, text: 'Kapatma testi' });
    });
    await sleep(400);
    await win.evaluate(() => { window.__pu.closeDoc(window.__pu.App.active); });
    await win.waitForSelector('.modal', { timeout: 8000 });
    const title = await win.textContent('.modal-head h3');
    assert(/Kapatmadan önce/.test(title), `başlık: ${title}`);
    await shot(win, 'n03-kapatma-uyarisi');
    await clickModalBtn(win, 'Kaydet');
    await waitToast(win, /Kaydedildi/);
    await ping(win);
  });

  await step('Taranmış belgede görsel kopyalama yazıları korur', async () => {
    if (!fs.existsSync(SCAN)) throw new Error('test taraması bulunamadı');
    const f = copyFixture(path.basename(SCAN), work, SCAN);
    await win.evaluate((p) => window.__pu.openPaths([p]), f);
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 20000 });
    await sleep(1200);
    const r = await win.evaluate(async () => {
      const d = window.__pu.App.active;
      const m = await import('./js/images.js');
      const imgs = (await m.pageImages(d, 0)).filter((im) => !im.isMask);
      const im = imgs.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
      const info = await m.layersOver(d, 0, im);
      const raw = await m.imageCanvas(d, 0, im);
      const comp = await m.compositeCanvas(d, 0, im, info.maxPx);
      const dark = (c) => {
        const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let dk = 0, n = 0;
        for (let k = 0; k < x.length; k += 16) { n++; if (0.299 * x[k] + 0.587 * x[k + 1] + 0.114 * x[k + 2] < 110) dk++; }
        return dk / n;
      };
      return { layers: info.others.length, rawDark: dark(raw), compDark: dark(comp), compW: comp.width };
    });
    assert(r.layers > 0, 'katman tespit edilmedi');
    assert(r.compDark > r.rawDark * 1.3, `yazı katmanı eklenmemiş (${r.rawDark} → ${r.compDark})`);
    assert(r.compW >= 1800, `çözünürlük düşük: ${r.compW}`);
  });

  await step('Karartma uyarı çubuğu çıkar ve uygulanır', async () => {
    await win.evaluate(() => {
      const d = window.__pu.App.active;
      d.addObj(0, { type: 'redact', x: 60, y: 120, w: 200, h: 40 });
    });
    await win.waitForSelector('.redact-bar', { timeout: 5000 });
    const txt = await win.textContent('.redact-bar');
    assert(/karartma için işaretlendi/.test(txt), txt);
    await shot(win, 'n04-karartma-cubugu');
    await win.locator('.redact-bar button', { hasText: 'Karartmayı uygula' }).click();
    await win.waitForSelector('.modal', { timeout: 8000 });
    await clickModalBtn(win, 'Uygula');
    await waitToast(win, /Karartma kalıcı olarak uygulandı/, 60000);
    const left = await win.evaluate(() => window.__pu.App.active.pageObjs[0].filter((o) => o.type === 'redact').length);
    assert(left === 0, 'karartma nesneleri kaldı');
  });

  await step('Otomatik kaydet açılıp kapanır ve kaydeder', async () => {
    await win.evaluate(() => { const a = window.__pu.App; window.__pu.activate(a.docs.find((d) => d.path) || a.docs[0]); });
    await win.click('#autosave-btn');
    const on = await win.evaluate(() => window.__pu.App.settings.autoSave);
    assert(on === true, 'otomatik kaydet açılmadı');
    await win.evaluate(() => {
      const d = window.__pu.App.active;
      d.addObj(0, { type: 'text', font: 'Arial', size: 11, color: '#111', x: 70, y: 200, w: 200, text: 'Oto kayıt' });
    });
    await waitToast(win, /Otomatik kaydedildi/, 15000);
    const dirty = await win.evaluate(() => window.__pu.App.active.dirty);
    assert(!dirty, 'otomatik kaydetten sonra hâlâ kirli');
    await shot(win, 'n05-otomatik-kaydet');
    await win.click('#autosave-btn');
  });

  await step('Böl penceresi doğru dosya sayısını söyler ve üretir', async () => {
    const big = path.join(work, 'onsayfa.pdf');
    await win.evaluate(async (p) => {
      const { PDFDocument } = window.PDFLib;
      const doc = await PDFDocument.create();
      for (let i = 0; i < 10; i++) doc.addPage([595, 842]);
      const bytes = await doc.save();
      await window.pu.writeFile(p, bytes);
    }, big);
    await win.evaluate((p) => window.__pu.openPaths([p]), big);
    await win.waitForFunction(() => window.__pu.App.active.numPages === 10, null, { timeout: 15000 });
    await win.evaluate(() => { window.__pu.runAction('page.split'); });
    await win.waitForSelector('.modal .radio-list', { timeout: 8000 });
    await win.fill('.modal input[type=number]', '5');
    await sleep(300);
    const info = await win.textContent('.modal .preview-line');
    assert(/2 dosya oluşacak/.test(info), `önizleme yanlış: ${info}`);
    await shot(win, 'n06-bol-onizleme');
    const outDir = path.join(work, 'bolunmus');
    fs.mkdirSync(outDir, { recursive: true });
    await app.evaluate(({ dialog }, outDir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [outDir] }); }, outDir);
    await clickModalBtn(win, 'Klasör seç ve böl');
    await waitToast(win, /parça kaydedildi/, 30000);
    const files = fs.readdirSync(outDir);
    assert(files.length === 2, `dosya sayısı ${files.length}: ${files.join(', ')}`);
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: global.__nextOpen || [] }); });
  });

  await step('Boş sayfa ekleme sayfaları silmez', async () => {
    const before = await win.evaluate(() => window.__pu.App.active.numPages);
    await win.evaluate(async () => {
      const ops = await import('./js/pageops.js');
      await ops.insertBlankQuick(window.__pu.App.active, 1, 'after');
    });
    await sleep(1200);
    const after = await win.evaluate(() => window.__pu.App.active.numPages);
    assert(after === before + 1, `${before} → ${after}`);
  });

  await step('Filigran penceresi gerçek sayfa önizlemesi gösterir', async () => {
    await win.evaluate(() => { window.__pu.runAction('doc.watermark'); });
    await win.waitForSelector('.wm-preview canvas', { timeout: 8000 });
    await sleep(900);
    const ok = await win.evaluate(() => {
      const c = document.querySelector('.wm-preview canvas');
      if (!c || !c.width) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let colored = 0;
      for (let i = 0; i < d.length; i += 40) if (Math.abs(d[i] - d[i + 1]) > 25) colored++;
      return colored > 5;
    });
    assert(ok, 'önizlemede filigran görünmüyor');
    await shot(win, 'n07-filigran-onizleme');
    await clickModalBtn(win, 'Vazgeç');
  });

  await step('Damga penceresi canlı özel damga önizlemesi yapar', async () => {
    await win.evaluate(() => { window.__pu.runAction('insert.stamp'); });
    await win.waitForSelector('.stamp-grid .stamp-item img', { timeout: 10000 });
    await win.fill('.stamp-custom input.input', 'ÇOK UZUN BİR ÖZEL DAMGA METNİ DENEMESİ');
    await win.waitForSelector('.stamp-custom-prev img', { timeout: 10000 }).catch(() => {});
    const has = await win.evaluate(() => !!document.querySelector('.stamp-custom-prev img'));
    assert(has, 'özel damga önizlemesi yok');
    const size = await win.evaluate(() => { const i = document.querySelector('.stamp-custom-prev img'); return { w: i.naturalWidth, h: i.naturalHeight }; });
    assert(size.w <= 1400, `damga taşıyor: ${size.w}`);
    await shot(win, 'n08-damga');
    await clickModalBtn(win, 'Vazgeç');
  });

  await step('Taranmış belgede vurgulama OCR önerir', async () => {
    await win.evaluate(() => { const a = window.__pu.App; window.__pu.activate(a.docs.find((d) => /scan/i.test(d.name))); });
    await sleep(800);
    await win.evaluate(() => window.__pu.setTool('highlight'));
    const b = await win.locator('.doc-view:not(.hidden) .page').first().boundingBox();
    await win.mouse.move(b.x + 100, b.y + 200);
    await win.mouse.down();
    await win.mouse.move(b.x + 300, b.y + 210, { steps: 8 });
    await win.mouse.up();
    await win.waitForSelector('.modal', { timeout: 15000 });
    const t = await win.textContent('.modal-head h3');
    assert(/yazı tanınmalı|yazı yok/i.test(t), `beklenen OCR önerisi değil: ${t}`);
    await shot(win, 'n09-ocr-onerisi');
    await clickModalBtn(win, 'Şimdi değil');
  });

  await step('Toplu işlem: iki dosyayı küçültür', async () => {
    const outDir = path.join(work, 'toplu');
    fs.mkdirSync(outDir, { recursive: true });
    await setNextOpen([copyFixture('test.pdf', path.join(work, 'toplu-giris')), copyFixture('scan.pdf', path.join(work, 'toplu-giris'))]);
    await win.evaluate(() => { window.__pu.runAction('tools.batch'); });
    await win.waitForSelector('.batch-list', { timeout: 8000 });
    await win.locator('.modal button', { hasText: 'PDF ekle' }).click();
    await win.waitForFunction(() => document.querySelectorAll('.batch-row').length === 2, null, { timeout: 10000 });
    await shot(win, 'n10-toplu-islem');
    await win.selectOption('.modal select >> nth=0', 'compress');
    await win.selectOption('.modal select >> nth=-1', 'folder');
    await app.evaluate(({ dialog }, outDir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [outDir] }); }, outDir);
    await clickModalBtn(win, 'Başlat');
    await win.waitForSelector('.modal-head h3:text("Toplu işlem bitti")', { timeout: 120000 });
    await shot(win, 'n11-toplu-sonuc');
    const files = fs.readdirSync(outDir);
    assert(files.length === 2, `çıktı sayısı ${files.length}`);
    await clickModalBtn(win, 'Kapat');
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: global.__nextOpen || [] }); });
  });

  await step('OCR sonrasi yazi duzenlenebilir', async () => {
    const scan = copyFixture('scan.pdf', path.join(work, 'ocr2'));
    await win.evaluate((p) => window.__pu.openPaths([p]), scan);
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 20000 });
    await sleep(900);
    const before = await win.evaluate(async () => {
      const d = window.__pu.App.active;
      const tc = await d.textContent(0);
      return { name: d.name, chars: tc.items.reduce((a, it) => a + (it.str || '').trim().length, 0) };
    });
    assert(before.chars < 20, `belge zaten metinli: ${JSON.stringify(before)}`);
    await win.evaluate(() => { window.__pu.runAction('tools.ocr'); });
    await win.waitForSelector('.modal .preview-line', { timeout: 10000 });
    await clickModalBtn(win, 'Başlat');
    await waitToast(win, /OCR tamamlandı/, 180000);
    await sleep(1800);
    // OCR metni gerçekten eklendi mi + konumunu bul
    await win.evaluate(() => { window.__pu.App.active.container.scrollTop = 0; });
    await sleep(600);
    await win.evaluate(() => window.__pu.setTool('edittext'));
    const pos = await win.evaluate(async () => {
      const d = window.__pu.App.active;
      d.textCache.clear();
      const tc = await d.textContent(0);
      const it = tc.items.find((x) => /Sipariş|Sipari/i.test(x.str));
      if (!it) return { found: false, sample: tc.items.slice(0, 6).map((x) => x.str) };
      const { Util } = window.pdfjsLib;
      const page = await d.pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const tx = Util.transform(vp.transform, it.transform);
      const layer = d.layers[0];
      const r = layer.getBoundingClientRect();
      const k = r.width / vp.width;
      const fh = Math.hypot(tx[2], tx[3]);
      return { found: true, str: it.str, x: r.left + (tx[4] + (it.width || 20) * 0.3) * k, y: r.top + (tx[5] - fh * 0.35) * k };
    });
    assert(pos.found, `OCR metni bulunamadı: ${JSON.stringify(pos.sample)}`);
    await win.mouse.click(pos.x, pos.y);
    await win.waitForSelector('.pu-obj.editing .pu-text', { timeout: 8000 });
    const info = await win.evaluate(() => {
      const d = window.__pu.App.active;
      const o = d.pageObjs[0].find((x) => x.type === 'text');
      return { text: o.text, size: o.size };
    });
    console.log('   duzenleme:', JSON.stringify(info));
    assert(/Sipari/i.test(info.text), `yanlış metin: ${info.text}`);
    assert(info.size > 7 && info.size < 30, `yazı boyutu mantıksız: ${info.size}`);
    await shot(win, 'n12-ocr-duzenleme');
    await win.keyboard.press('Escape');
  });

  await step('Pencere kapatma akisi', async () => {
    await win.evaluate(() => {
      const d = window.__pu.App.active;
      d.addObj(0, { type: 'text', font: 'Arial', size: 12, color: '#000', x: 40, y: 40, w: 120, text: 'x' });
    });
    await sleep(300);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await win.waitForSelector('.modal', { timeout: 10000 });
    const t = await win.textContent('.modal-head h3');
    assert(/Kapatmadan önce/.test(t), `başlık: ${t}`);
    await shot(win, 'n13-pencere-kapat');
    await win.locator('.modal .modal-foot button', { hasText: 'Vazgeç' }).first().click();
    await sleep(900);
    await ping(win);
    const stillOpen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    assert(stillOpen === 1, 'Vazgeç sonrası pencere kapandı');
  });

  console.log('\n--- konsol hataları ---');
  console.log(logs.filter((l) => !/Autofill|Security Warning|TT: undefined/.test(l)).slice(0, 15).join('\n'));
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; })).catch(() => {});
  await app.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} adım başarılı`);
  if (failed.length) { console.log(failed.map((f) => ` - ${f.name}: ${f.err}`).join('\n')); process.exitCode = 1; }
})().catch((e) => { console.error(e); process.exit(1); });
