// Taranmış belgede "Görseli kopyala" testi: kopyalanan görselde yazı katmanı duruyor mu?
const fs = require('fs');
const path = require('path');
const { launch, shot, sleep } = require('./harness');

const FILE = process.argv[2];
if (!FILE) { console.error('Kullanım: node tests/copyimage.js <taranmış-belge.pdf>'); process.exit(2); }

(async () => {
  const { app, win, logs } = await launch({ args: [FILE] });
  try {
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 30000 });
    await sleep(1500);
    const res = await win.evaluate(async () => {
      const d = window.__pu.App.active;
      const m = await import('./js/images.js');
      const imgs = (await m.pageImages(d, 0)).filter((im) => !im.isMask);
      const layers = await m.pageImages(d, 0);
      const im = imgs.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
      const info = await m.layersOver(d, 0, im);
      const raw = await m.imageCanvas(d, 0, im);
      const comp = await m.compositeCanvas(d, 0, im, info.maxPx);
      // koyu piksel oranı: yazı katmanı varsa belirgin şekilde artar
      const darkRatio = (c) => {
        const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let dark = 0, n = 0;
        for (let k = 0; k < x.length; k += 16) { n++; if (0.299 * x[k] + 0.587 * x[k + 1] + 0.114 * x[k + 2] < 110) dark++; }
        return dark / n;
      };
      return {
        layers: layers.map((l) => `${l.isMask ? 'maske' : 'görsel'} ${l.width}x${l.height}`),
        others: info.others.length, textItems: info.textItems,
        raw: { w: raw.width, h: raw.height, dark: +darkRatio(raw).toFixed(4) },
        comp: { w: comp.width, h: comp.height, dark: +darkRatio(comp).toFixed(4) },
        rawURL: raw.toDataURL('image/png'),
        compURL: comp.toDataURL('image/png'),
      };
    });
    console.log('katmanlar:', res.layers.join(' | '));
    console.log('üstüste katman:', res.others, 'metin öğesi:', res.textItems);
    console.log('ham kopya   :', res.raw);
    console.log('bileşik kopya:', res.comp);
    const dir = path.join(__dirname, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'kopya-ham.png'), Buffer.from(res.rawURL.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(dir, 'kopya-bilesik.png'), Buffer.from(res.compURL.split(',')[1], 'base64'));
    console.log(res.comp.dark > res.raw.dark * 1.3 ? 'SONUÇ: bileşik kopyada yazı katmanı var (düzeldi)' : 'SONUÇ: fark yok — kontrol et');
  } catch (e) {
    console.log('HATA', e.message);
    await shot(win, 'kopya-hata').catch(() => {});
  }
  console.log(logs.slice(0, 5).join('\n'));
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; })).catch(() => {});
  await app.close();
})();
