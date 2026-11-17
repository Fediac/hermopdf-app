// "Taranmış belgede görsel kopyalama" testi için sahte, katmanlı tarama üretir: tests/fixtures/scan-layers.pdf
// Tam sayfa tarama görseli + üstünde iki küçük görsel katman (damga/logo). Çalıştır: node tests/make-scan-layers.js
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, PDFRawStream } = require('@cantoo/pdf-lib');

const FX = path.join(__dirname, 'fixtures');

(async () => {
  // scan.pdf içindeki JPEG akışını çıkar
  const src = await PDFDocument.load(fs.readFileSync(path.join(FX, 'scan.pdf')));
  let jpeg = null;
  for (const [, obj] of src.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) { jpeg = obj.contents; break; }
  }
  if (!jpeg) throw new Error('scan.pdf içinde görsel bulunamadı');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  page.drawImage(await doc.embedJpg(jpeg), { x: 0, y: 0, width: 595.28, height: 841.89 });
  page.drawImage(await doc.embedPng(fs.readFileSync(path.join(FX, 'logo.png'))), { x: 330, y: 560, width: 220, height: 220 });
  page.drawImage(await doc.embedJpg(fs.readFileSync(path.join(FX, 'photo.jpg'))), { x: 60, y: 90, width: 150, height: 100 });
  fs.writeFileSync(path.join(FX, 'scan-layers.pdf'), await doc.save());
  console.log('scan-layers.pdf yazıldı');
})();
