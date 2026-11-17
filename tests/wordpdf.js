// Word → PDF hızlı kontrol: iki motorla dönüştürür, sayfaları tek bir önizleme görseline dizer.
// Kullanım: node tests/wordpdf.js <dosya.docx> [word|builtin|both]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launch, sleep, SHOTS, FIX } = require('./harness');

const file = process.argv[2] || path.join(FIX, 'rapor.docx');
const which = process.argv[3] || 'both';

// Sayfaları yan yana dizip PNG yap (pdf.js ile, uygulamanın içinde)
async function contactSheet(win, bytes, cols = 4, w = 330) {
  return win.evaluate(async ({ b64, cols, w }) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    const n = pdf.numPages;
    const shown = Math.min(n, 16);
    const imgs = [];
    const texts = [];
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      texts.push(tc.items.map((t) => t.str).join(' '));
      if (i > shown) continue;
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: w / vp0.width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvas: c, viewport: vp, background: '#fff' }).promise;
      imgs.push({ c, size: `${Math.round(vp0.width)}x${Math.round(vp0.height)}` });
    }
    const rows = Math.ceil(imgs.length / cols);
    const cellH = Math.max(...imgs.map((x) => x.c.height));
    const sheet = document.createElement('canvas');
    sheet.width = cols * (w + 12) + 12; sheet.height = rows * (cellH + 12) + 12;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#888'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    imgs.forEach((x, i) => ctx.drawImage(x.c, 12 + (i % cols) * (w + 12), 12 + Math.floor(i / cols) * (cellH + 12)));
    const url = sheet.toDataURL('image/png');
    return { n, sizes: [...new Set(imgs.map((x) => x.size))], png: url.split(',')[1], texts };
  }, { b64: Buffer.from(bytes).toString('base64'), cols, w });
}

(async () => {
  const { app, win, logs } = await launch();
  await sleep(600);
  const engines = which === 'both' ? ['word', 'builtin'] : [which];
  const info = await win.evaluate(() => window.pu.officeInfo());
  console.log('Word kurulu:', info.word);
  for (const engine of engines) {
    const t0 = Date.now();
    try {
      const r = await win.evaluate(({ file, engine }) => window.pu.officeToPdf({ path: file, engine }).then((x) => ({ ...x, bytes: Array.from(x.bytes) })), { file, engine });
      const ms = Date.now() - t0;
      const bytes = Uint8Array.from(r.bytes);
      const out = path.join(os.tmpdir(), `wordpdf-${engine}.pdf`);
      fs.writeFileSync(out, bytes);
      const sheet = await contactSheet(win, bytes, +process.env.COLS || 4, +process.env.SHEETW || 330);
      const shotFile = path.join(SHOTS, `word-${engine}-${path.basename(file).replace(/\W+/g, '_')}.png`);
      fs.writeFileSync(shotFile, Buffer.from(sheet.png, 'base64'));
      const all = sheet.texts.join(' ');
      console.log(`${engine}: ${ms} ms, motor=${r.engine}, ${sheet.n} sayfa, boyut ${sheet.sizes.join(',')}, ${Math.round(bytes.length / 1024)} KB, SON SATIR: ${/SON SATIR/.test(all)}, Türkçe: ${/Ğ Ü Ş İ Ö Ç/.test(all)} → ${shotFile}${r.warning ? ' UYARI: ' + r.warning : ''}`);
    } catch (e) {
      console.log(`${engine}: HATA (${Date.now() - t0} ms): ${e.message.split('\n')[0]}`);
    }
  }
  if (logs.length) console.log(logs.slice(0, 10).join('\n'));
  await app.close();
})();
