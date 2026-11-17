// Tüm arayüz modüllerinin sözdizimi / içe aktarma hatası olmadan yüklendiğini doğrular.
const { launch } = require('./harness');

(async () => {
  const { app, win, logs } = await launch();
  const mods = ['organizer', 'pageops', 'images', 'insert', 'signature', 'raster', 'compress', 'ocr', 'protect', 'zip', 'convert', 'print', 'reader', 'batch', 'assist'];
  const res = await win.evaluate(async (mods) => {
    const out = {};
    for (const m of mods) {
      try { const x = await import(`./js/${m}.js`); out[m] = Object.keys(x).length; } catch (e) { out[m] = `HATA: ${e.message}`; }
    }
    return out;
  }, mods);
  console.log(res);
  const pl = await win.evaluate(() => ({ decode: typeof PDFLib.decodePDFRawStream, squeeze: typeof PDFLib.setCharacterSqueeze, fk: typeof (window.fontkit?.create || window.fontkit?.default?.create) }));
  console.log(pl);
  console.log(logs.join('\n'));
  await app.close();
})();
