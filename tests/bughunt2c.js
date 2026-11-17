// Hata avı 2 (içerik / dönüştürme) regresyon testleri: satır kırma, UTF-16 metin, EXIF yönlü JPEG,
// toplu filigran/numara, eksik glif, Word/TXT'de örtülen yazı, Word'de maske ve döndürülmüş görseller,
// OCR iptali ve büyük sayfa ölçeği, yatay sayfa yazdırma.
// Yalnızca geçici dosyalar kullanılır; sistem pencereleri kısa gecikmeyle taklit edilir.
// Kullanım: node tests/bughunt2c.js [adım-süzgeci]
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { PDFDocument, StandardFonts, PDFName, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = require('@cantoo/pdf-lib');
const { launch, shot, sleep } = require('./harness');

const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const results = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-bug2c-'));
const J = 'app://pu/src/renderer/js/';

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
    await shot(global.__win, `FAILb2c-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };

// DOCX (zip) içeriğini oku: { ad: Buffer }
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = {};
  for (let k = 0; k < count; k++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const lo = buf.readUInt32LE(p + 42);
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const data = buf.slice(start, start + size);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nl + xl + cl;
  }
  return out;
}
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

async function makeTextPdf(file, lines, size = [300, 400]) {
  const lib = await PDFDocument.create();
  const font = await lib.embedFont(StandardFonts.Helvetica);
  const p = lib.addPage(size);
  for (const [t, x, y, s] of lines) p.drawText(t, { x, y, size: s, font });
  fs.writeFileSync(file, await lib.save());
  return file;
}

// 1. sayfa: yalnız 1 bitlik /ImageMask (siyah-beyaz tarama); 2. sayfa: /Rotate 90, 40×20 RGB görsel 200×100 kutuda
async function makeMaskPdf(file) {
  const lib = await PDFDocument.create();
  const p1 = lib.addPage([300, 400]);
  const mask = Buffer.alloc(8 * 64);
  for (let r = 0; r < 64; r++) mask.fill(r % 8 < 4 ? 0x00 : 0xFF, r * 8, r * 8 + 8);
  const m = lib.context.register(lib.context.stream(mask, { Type: 'XObject', Subtype: 'Image', Width: 64, Height: 64, ImageMask: true, BitsPerComponent: 1 }));
  p1.node.setXObject(PDFName.of('Im1'), m);
  p1.pushOperators(pushGraphicsState(), concatTransformationMatrix(150, 0, 0, 150, 50, 150), drawObject('Im1'), popGraphicsState());
  const p2 = lib.addPage([300, 400]);
  p2.setRotation(degrees(90));
  const rgb = Buffer.alloc(40 * 20 * 3);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) { const q = (y * 40 + x) * 3; if (x < 20) rgb[q] = 255; else rgb[q + 2] = 255; }
  const im = lib.context.register(lib.context.stream(rgb, { Type: 'XObject', Subtype: 'Image', Width: 40, Height: 20, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
  p2.node.setXObject(PDFName.of('Im2'), im);
  p2.pushOperators(pushGraphicsState(), concatTransformationMatrix(200, 0, 0, 100, 50, 150), drawObject('Im2'), popGraphicsState());
  fs.writeFileSync(file, await lib.save());
  return file;
}

(async () => {
  const aliPdf = await makeTextPdf(path.join(work, 'ali.pdf'), [['Ali Yilmaz', 40, 340, 24], ['Sabit satir burada duruyor', 40, 200, 14]]);
  const maskPdf = await makeMaskPdf(path.join(work, 'maske.pdf'));
  const bigPdf = await makeTextPdf(path.join(work, 'buyuk.pdf'), [['USTA', 1200, 1200, 220]], [3508, 2480]);
  const { app, win } = await launch();
  global.__win = win;
  await app.evaluate(({ dialog }, w) => {
    const wait = () => new Promise((r) => setTimeout(r, 300));
    dialog.showSaveDialog = async (x, o) => { await wait(); return { canceled: false, filePath: w + '\\' + String((o || x).defaultPath || 'x.pdf').split(/[\\/]/).pop() }; };
  }, work);
  const closeAll = () => win.evaluate(async () => { for (const d of [...window.__pu.App.docs]) await window.__pu.closeDoc(d, { force: true }); });
  const openOne = async (p) => {
    await win.evaluate((f) => window.__pu.openPaths([f]), p);
    await win.waitForFunction((f) => window.__pu.App.docs.some((d) => d.path === f && d.pdf), p, { timeout: 15000 });
    await win.evaluate((f) => window.__pu.activate(window.__pu.App.docs.find((d) => d.path === f)), p).catch(() => {});
  };
  // modal başlığı görünene kadar bekle, sonra adı verilen düğmeye bas
  const clickIn = async (title, label, prep) => {
    await win.waitForFunction((t) => [...document.querySelectorAll('.modal-backdrop:not(.out) h3')].some((h) => h.textContent.includes(t)), title, { timeout: 15000 });
    await win.evaluate(([t, l, pr]) => {
      const bd = [...document.querySelectorAll('.modal-backdrop:not(.out)')].find((b) => b.querySelector('h3')?.textContent.includes(t));
      if (pr === 'ocr') {
        const dpi = [...bd.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === '200'));
        dpi.value = '200'; dpi.dispatchEvent(new Event('change'));
        const cb = bd.querySelector('.checkline input'); cb.checked = false;
      }
      [...bd.querySelectorAll('button')].find((b) => b.textContent.trim() === l).click();
    }, [title, label, prep || null]);
  };

  try {
    await step('Satır kırma: kelimelerden sonra gelen çok uzun kelime de bölünür', async () => {
      const r = await win.evaluate(async (j) => {
        const { wrapText } = await import(`${j}shapes.js`);
        const m = (s) => s.length * 5;
        const input = `hello ${'A'.repeat(100)} son`;
        const lines = wrapText(input, 100, m);
        return { n: lines.length, max: Math.max(...lines.map(m)), joined: lines.join('').replace(/\s/g, ''), want: input.replace(/\s/g, '') };
      }, J);
      assert(r.max <= 100, `satır genişliği ${r.max} > 100`);
      assert(r.joined === r.want, 'metin kayboldu/değişti');
    });

    await step('Metin → PDF: UTF-16 (BOM\'lu LE/BE ve BOM\'suz LE) dosyalar doğru okunur', async () => {
      const s = 'Merhaba Şişli\r\nİkinci satır ğüöç';
      const le = [...Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(s, 'utf16le')])];
      const be = [...Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(s, 'utf16le').swap16()])];
      const raw = [...Buffer.from(s, 'utf16le')];
      const u8 = [...Buffer.from(`﻿${s}`, 'utf8')];
      const r = await win.evaluate(async ([j, arrs]) => {
        const { decodeText } = await import(`${j}convert.js`);
        return arrs.map((a) => decodeText(new Uint8Array(a)));
      }, [J, [le, be, raw, u8]]);
      r.forEach((t, k) => assert(t === s, `${['LE', 'BE', 'BOM\'suz', 'UTF-8'][k]}: ${JSON.stringify(t)}`));
    });

    await step('EXIF yönlü JPEG: yön piksellere işlenir, kayıtlı boyut görünen boyutla aynı', async () => {
      const r = await win.evaluate(async (j) => {
        const { prepareImage, jpegInfo } = await import(`${j}insert.js`);
        const { dataURLToBytes } = await import(`${j}util.js`);
        const c = document.createElement('canvas'); c.width = 200; c.height = 100;
        const x = c.getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0, 0, 100, 100); x.fillStyle = '#00f'; x.fillRect(100, 0, 100, 100);
        const raw = dataURLToBytes(c.toDataURL('image/jpeg', 0.9));
        const tiff = [0x49, 0x49, 0x2A, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
        const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
        const len = payload.length + 2;
        const app1 = [0xFF, 0xE1, len >> 8, len & 255, ...payload];
        const out = new Uint8Array(raw.length + app1.length);
        out.set(raw.subarray(0, 2)); out.set(app1, 2); out.set(raw.subarray(2), 2 + app1.length);
        let bin = ''; for (const b of out) bin += String.fromCharCode(b);
        const url = `data:image/jpeg;base64,${btoa(bin)}`;
        const before = jpegInfo(out);
        const prep = await prepareImage(url);
        const after = prep.dataURL.startsWith('data:image/jpeg') ? jpegInfo(dataURLToBytes(prep.dataURL)) : { png: true };
        return { before, w: prep.w, h: prep.h, after };
      }, J);
      assert(r.before.orientation === 6 && r.before.w === 200, `kaynak EXIF okunamadı: ${JSON.stringify(r.before)}`);
      assert(r.w === 100 && r.h === 200, `görünen boyut ${r.w}×${r.h}`);
      assert(r.after.w === 100 && r.after.h === 200 && r.after.orientation === 1, `gömülecek JPEG ${JSON.stringify(r.after)}`);
    });

    await step('Toplu filigran/numara: Türkçe harfler korunur, döndürülmüş + kırpılmış sayfada numara altta ortada', async () => {
      const lib = await PDFDocument.create();
      lib.addPage([300, 400]);
      const p2 = lib.addPage([300, 400]);
      p2.setRotation(degrees(90));
      p2.setCropBox(20, 30, 260, 340);
      const bytes = [...await lib.save()];
      const r = await win.evaluate(async ([j, arr]) => {
        const { batchWatermark, batchNumbers } = await import(`${j}batch.js`);
        const { openPdfjs, getPdfjs } = await import(`${j}pdfcore.js`);
        let b = await batchWatermark(new Uint8Array(arr), '', '#cc0000');
        b = await batchNumbers(b, 'Sayfa {n} / {t} ş');
        const src = await openPdfjs(b);
        const { Util } = getPdfjs();
        const out = [];
        try {
          for (let i = 1; i <= src.doc.numPages; i++) {
            const p = await src.doc.getPage(i);
            const vp = p.getViewport({ scale: 1 });
            const tc = await p.getTextContent();
            out.push({ w: vp.width, h: vp.height, items: tc.items.filter((it) => it.str.trim()).map((it) => { const t = Util.transform(vp.transform, it.transform); return { s: it.str, x: t[4], y: t[5], w: it.width, b: t[1] }; }) });
          }
        } finally { src.destroy(); }
        return out;
      }, [J, bytes]);
      for (const [k, pg] of r.entries()) {
        assert(pg.items.some((it) => it.s.includes('GİZLİ')), `s${k + 1} filigran: ${JSON.stringify(pg.items.map((t) => t.s))}`);
        const num = pg.items.find((it) => it.s.startsWith('Sayfa'));
        assert(num && num.s.includes('ş'), `s${k + 1} numara: ${JSON.stringify(pg.items.map((t) => t.s))}`);
        const cx = num.x + num.w / 2;
        assert(Math.abs(cx - pg.w / 2) < 30 && Math.abs(num.y - (pg.h - 22)) < 12 && Math.abs(num.b) < 0.01, `s${k + 1} numara konumu (${Math.round(cx)},${Math.round(num.y)}) sayfa ${Math.round(pg.w)}×${Math.round(pg.h)}`);
      }
    });

    await step('Eksik glif: Lucida Handwriting + Türkçe harfler kaydedilince \'?\' olmaz', async () => {
      await openOne(aliPdf);
      const r = await win.evaluate(async (j) => {
        const { hasFamily } = await import(`${j}fonts.js`);
        if (!hasFamily('Lucida Handwriting')) return { skip: true };
        const { openPdfjs } = await import(`${j}pdfcore.js`);
        const d = window.__pu.App.active;
        d.addObj(0, { type: 'text', ...window.__pu.App.defaults.text, font: 'Lucida Handwriting', size: 16, x: 30, y: 100, w: 250, text: 'Ayşe Doğan İmza' });
        const src = await openPdfjs(await d.buildBytes({ encrypt: false }));
        try {
          const tc = await (await src.doc.getPage(1)).getTextContent();
          return { text: tc.items.map((t) => t.str).join('') };
        } finally { src.destroy(); }
      }, J);
      assert(!r.skip, 'Lucida Handwriting yazı tipi bulunamadı');
      assert(r.text.replace(/\s/g, '').includes('AyşeDoğanİmza'), `çıkan metin: ${JSON.stringify(r.text)}`);
      await closeAll();
    });

    await step('Word/TXT dışa aktarma: "Metni düzenle" ile örtülen eski yazı çıkmaz, yeni yazı (kaydedilmemiş) çıkar', async () => {
      await openOne(aliPdf);
      await win.evaluate(() => {
        const d = window.__pu.App.active;
        d.addObj(0, { type: 'text', ...window.__pu.App.defaults.text, size: 20, x: 40, y: 38, w: 200, text: 'Veli Kaya', cover: { x: 36, y: 30, w: 160, h: 36, color: '#ffffff' } });
      });
      await win.evaluate(async (j) => { const { exportText } = await import(`${j}convert.js`); await exportText(window.__pu.App.active); }, J);
      const txt = fs.readFileSync(path.join(work, 'ali.txt'), 'utf8');
      assert(txt.includes('Veli Kaya') && txt.includes('Sabit satir'), `TXT: ${JSON.stringify(txt)}`);
      assert(!txt.includes('Ali Yilmaz'), 'TXT\'de örtülen eski yazı var');
      const pr = win.evaluate(async (j) => { const { exportDocx } = await import(`${j}convert.js`); await exportDocx(window.__pu.App.active); }, J);
      await clickIn('PDF → Word', 'Dönüştür');
      await pr;
      const xml = unzip(fs.readFileSync(path.join(work, 'ali.docx')))['word/document.xml'].toString('utf8');
      assert(xml.includes('Veli Kaya') && xml.includes('Sabit satir'), 'DOCX\'te yeni yazı yok');
      assert(!xml.includes('Ali Yilmaz'), 'DOCX\'te örtülen eski yazı var');
      await closeAll();
    });

    await step('PDF → Word: maske görseli aktarılır, döndürülmüş sayfadaki görsel dik ve oranı doğru', async () => {
      await openOne(maskPdf);
      const pr = win.evaluate(async (j) => { const { exportDocx } = await import(`${j}convert.js`); await exportDocx(window.__pu.App.active); }, J);
      await clickIn('PDF → Word', 'Dönüştür');
      await pr;
      const z = unzip(fs.readFileSync(path.join(work, 'maske.docx')));
      const xml = z['word/document.xml'].toString('utf8');
      const media = Object.keys(z).filter((n) => n.startsWith('word/media/')).sort();
      assert(media.length === 2, `görsel sayısı ${media.length} (2 bekleniyor)`);
      const ext = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => [+m[1], +m[2]]);
      const s2 = pngSize(z[media[1]]);
      assert(ext[1][1] > ext[1][0] * 1.5 && s2.h > s2.w * 1.5, `döndürülmüş görsel: kutu ${ext[1]}, piksel ${s2.w}×${s2.h}`);
      const dark = await win.evaluate(async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] < 80 && d[k + 3] > 200) n++;
        return n / (d.length / 4);
      }, z[media[0]].toString('base64'));
      assert(dark > 0.3 && dark < 0.7, `maske görselinde koyu piksel oranı ${dark.toFixed(2)}`);
      await closeAll();
    });

    await step('OCR iptali sayfa ortasında durdurur, sonraki OCR yeni işçiyle çalışır', async () => {
      const page = await makeTextPdf(path.join(work, 'ocr.pdf'), Array.from({ length: 40 }, (_, k) => [`Satir ${k + 1}: Merhaba dunya bu bir OCR deneme metnidir`, 30, 800 - k * 19, 13]), [595, 842]);
      const small = await makeTextPdf(path.join(work, 'ocr2.pdf'), [['MERHABA DUNYA', 20, 60, 28]], [300, 120]);
      const r = await win.evaluate(async ([j, a, b]) => {
        const { ocrBytes } = await import(`${j}ocr.js`);
        let cancelAt = 0;
        const check = () => { if (cancelAt && performance.now() > cancelAt) { const e = new Error('İptal edildi'); e.cancelled = true; throw e; } };
        const onProgress = (v, msg) => { if (/%/.test(msg) && !cancelAt) cancelAt = performance.now() + 300; };
        let err = null;
        try { await ocrBytes(new Uint8Array(a), { skipWithText: false, dpi: 300, onProgress, check }); } catch (e) { err = e.message; }
        const lag = cancelAt ? performance.now() - cancelAt : -1;
        const src = new Uint8Array(b);
        const out = await ocrBytes(src, { skipWithText: false, dpi: 200 });
        return { err, lag, grew: out.length !== src.length };
      }, [J, [...fs.readFileSync(page)], [...fs.readFileSync(small)]]);
      assert(r.err && /İptal/.test(r.err), `iptal hatası yok: ${JSON.stringify(r)}`);
      assert(r.lag >= 0 && r.lag < 1500, `iptal gecikmesi ${Math.round(r.lag)} ms`);
      assert(r.grew, 'ikinci OCR metin katmanı eklemedi');
    });

    await step('OCR: çok büyük sayfada metin katmanı doğru yerde (ölçek sınırı)', async () => {
      await openOne(bigPdf);
      const pr = win.evaluate(async (j) => { const { ocrDialog } = await import(`${j}ocr.js`); await ocrDialog(window.__pu.App.active, null); }, J);
      await clickIn('OCR — yazı tanıma', 'Başlat', 'ocr');
      await pr;
      await win.waitForFunction(() => window.__pu.App.active?.pdf, null, { timeout: 30000 });
      const xs = await win.evaluate(async () => {
        const { getPdfjs } = await import('app://pu/src/renderer/js/pdfcore.js');
        const p = await window.__pu.App.active.pdf.getPage(1);
        const vp = p.getViewport({ scale: 1 });
        const tc = await p.getTextContent();
        return tc.items.filter((it) => /USTA/i.test(it.str)).map((it) => Math.round(getPdfjs().Util.transform(vp.transform, it.transform)[4]));
      });
      assert(xs.length >= 2, `OCR katmanı bulunamadı: ${JSON.stringify(xs)}`);
      assert(xs.every((x) => Math.abs(x - 1200) < 100), `x konumları ${JSON.stringify(xs)} (1200 bekleniyor)`);
      await closeAll();
    });

    await step('Yazdırma: yatay sayfa dikey kâğıda 90° döndürülür', async () => {
      const r = await win.evaluate(async (j) => {
        const { portraitCanvas } = await import(`${j}print.js`);
        const c = document.createElement('canvas'); c.width = 300; c.height = 200;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#f00'; x.fillRect(0, 0, 20, 20);
        const p = portraitCanvas(c);
        const px = (cv, a, b) => [...cv.getContext('2d').getImageData(a, b, 1, 1).data.slice(0, 3)];
        const same = portraitCanvas(p) === p;
        return { w: p.width, h: p.height, tr: px(p, 190, 10), tl: px(p, 10, 10), same };
      }, J);
      assert(r.w === 200 && r.h === 300, `boyut ${r.w}×${r.h}`);
      assert(r.tr[0] > 200 && r.tr[1] < 60 && r.tl[1] > 200, `döndürme yönü: sağ üst ${r.tr}, sol üst ${r.tl}`);
      assert(r.same, 'dikey görüntü değişmemeli');
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
void sleep;
