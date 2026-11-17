// Test PDF'leri üretir. Çalıştır: npx electron tests/make-fixtures.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, degrees, StandardFonts } = require('@cantoo/pdf-lib');
const fontkit = require('@cantoo/fontkit');

const OUT = path.join(__dirname, 'fixtures');
const FONT = fs.readFileSync(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf'));
const FONT_B = fs.readFileSync(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arialbd.ttf'));

async function canvasImages(win) {
  const js = `(async () => {
    const out = {};
    // fotoğraf benzeri büyük görsel (JPEG)
    let c = document.createElement('canvas'); c.width = 2400; c.height = 1600;
    let x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 2400, 1600); g.addColorStop(0, '#1e88e5'); g.addColorStop(1, '#ff7043');
    x.fillStyle = g; x.fillRect(0, 0, 2400, 1600);
    for (let i = 0; i < 900; i++) { x.fillStyle = 'hsla(' + (i * 37 % 360) + ',70%,' + (30 + i % 50) + '%,.35)'; x.beginPath(); x.arc(Math.random()*2400, Math.random()*1600, 10 + Math.random()*90, 0, 7); x.fill(); }
    x.fillStyle = '#fff'; x.font = 'bold 160px Arial'; x.fillText('Deneme Fotoğrafı', 360, 860);
    out.jpg = c.toDataURL('image/jpeg', 0.95);
    // logo (PNG, şeffaf)
    c = document.createElement('canvas'); c.width = 400; c.height = 400; x = c.getContext('2d');
    x.fillStyle = '#d62839'; x.beginPath(); x.arc(200, 200, 180, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 150px Arial'; x.textAlign = 'center'; x.fillText('PU', 200, 255);
    out.png = c.toDataURL('image/png');
    // taranmış belge görünümü (OCR testi)
    c = document.createElement('canvas'); c.width = 1654; c.height = 2339; x = c.getContext('2d');
    x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, 1654, 2339);
    x.fillStyle = '#1a1a1a'; x.font = 'bold 64px Times New Roman'; x.fillText('TARANMIŞ BELGE ÖRNEĞİ', 180, 260);
    x.font = '44px Times New Roman';
    const lines = ['Bu sayfa bir tarayıcıdan gelmiş gibi yalnızca görüntüdür.', 'Yazı tanıma (OCR) sonrası metin seçilebilir olmalıdır.', 'Sipariş numarası: 2026-4815', 'Tutar: 12.450,00 TL  Tarih: 15.09.2026', 'Şirket: Güneş Işık Çözümleri A.Ş.'];
    lines.forEach((l, i) => x.fillText(l, 180, 420 + i * 90));
    out.scan = c.toDataURL('image/jpeg', 0.85);
    return out;
  })()`;
  const r = await win.webContents.executeJavaScript(js);
  const dec = (u) => Buffer.from(u.split(',')[1], 'base64');
  return { jpg: dec(r.jpg), png: dec(r.png), scan: dec(r.scan) };
}

async function textPdf(imgs) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await doc.embedFont(FONT, { subset: true });
  const fb = await doc.embedFont(FONT_B, { subset: true });
  doc.setTitle('PDF Usta Test Belgesi');
  doc.setAuthor('Test Yazarı');
  const para = 'Çalışma kapsamında İstanbul, İzmir ve Şanlıurfa şubelerinden gelen ölçümler karşılaştırılmıştır. Öğrenciler ğüşıöç harflerini doğru görmelidir.';
  // Sayfa 1: metin
  let p = doc.addPage([595.28, 841.89]);
  p.drawText('Başlık: Türkçe Karakter Testi', { x: 60, y: 770, size: 22, font: fb, color: rgb(0.1, 0.1, 0.1) });
  p.drawText('Fatura No: TR-2026-0042', { x: 60, y: 735, size: 12, font: f });
  let y = 700;
  for (let i = 0; i < 12; i++) {
    p.drawText(`${i + 1}. ${para.slice(0, 80)}`, { x: 60, y, size: 11, font: f });
    y -= 22;
  }
  p.drawText('Toplam Tutar: 1.250,00 TL', { x: 60, y: y - 20, size: 14, font: fb, color: rgb(0.7, 0.1, 0.1) });
  p.drawText('İmza:', { x: 60, y: 140, size: 12, font: f });
  p.drawLine({ start: { x: 100, y: 138 }, end: { x: 300, y: 138 }, thickness: 0.8 });
  // Sayfa 2: görseller
  p = doc.addPage([595.28, 841.89]);
  p.drawText('Sayfa 2 — Görseller', { x: 60, y: 770, size: 20, font: fb });
  const jpg = await doc.embedJpg(imgs.jpg);
  p.drawImage(jpg, { x: 60, y: 420, width: 475, height: 316 });
  const png = await doc.embedPng(imgs.png);
  p.drawImage(png, { x: 60, y: 180, width: 180, height: 180 });
  p.drawText('Logo (PNG, şeffaf arka plan)', { x: 260, y: 260, size: 12, font: f });
  // Sayfa 3: döndürülmüş (yatay)
  p = doc.addPage([595.28, 841.89]);
  p.setRotation(degrees(90));
  p.drawText('Sayfa 3 — /Rotate 90 olan sayfa', { x: 60, y: 770, size: 18, font: fb });
  p.drawText('Bu sayfa görüntülenirken yatay görünür.', { x: 60, y: 740, size: 12, font: f });
  // Sayfa 4: yatay boyut
  p = doc.addPage([841.89, 595.28]);
  p.drawText('Sayfa 4 — Yatay A4', { x: 60, y: 520, size: 20, font: fb });
  p.drawRectangle({ x: 60, y: 300, width: 300, height: 150, color: rgb(0.9, 0.95, 1), borderColor: rgb(0.2, 0.4, 0.8), borderWidth: 2 });
  return doc.save();
}

async function formPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await doc.embedFont(FONT, { subset: false });
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Başvuru Formu', { x: 60, y: 770, size: 22, font: f });
  const form = doc.getForm();
  p.drawText('Ad Soyad:', { x: 60, y: 700, size: 12, font: f });
  const name = form.createTextField('adsoyad');
  name.addToPage(p, { x: 160, y: 690, width: 300, height: 24 });
  p.drawText('E-posta:', { x: 60, y: 650, size: 12, font: f });
  const mail = form.createTextField('eposta');
  mail.addToPage(p, { x: 160, y: 640, width: 300, height: 24 });
  p.drawText('Onaylıyorum:', { x: 60, y: 600, size: 12, font: f });
  const cb = form.createCheckBox('onay');
  cb.addToPage(p, { x: 160, y: 595, width: 18, height: 18 });
  form.updateFieldAppearances(f);
  return doc.save();
}

async function scanPdf(imgs) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([595.28, 841.89]);
  const img = await doc.embedJpg(imgs.scan);
  p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return doc.save();
}

async function encryptedPdf() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Gizli belge - parola 1234', { x: 60, y: 770, size: 20, font: f });
  doc.encrypt({ userPassword: '1234', ownerPassword: 'owner-1234' });
  return doc.save();
}

async function smallPdf(title, n) {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`${title} - page ${i + 1}`, { x: 60, y: 770, size: 28, font: f });
  }
  return doc.save();
}

process.on("unhandledRejection", (e) => { console.error("HATA", e); app.exit(1); });
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const imgs = await canvasImages(win);
  fs.writeFileSync(path.join(OUT, 'photo.jpg'), imgs.jpg);
  fs.writeFileSync(path.join(OUT, 'logo.png'), imgs.png);
  fs.writeFileSync(path.join(OUT, 'test.pdf'), await textPdf(imgs));
  fs.writeFileSync(path.join(OUT, 'form.pdf'), await formPdf());
  fs.writeFileSync(path.join(OUT, 'scan.pdf'), await scanPdf(imgs));
  fs.writeFileSync(path.join(OUT, 'encrypted.pdf'), await encryptedPdf());
  fs.writeFileSync(path.join(OUT, 'a.pdf'), await smallPdf('Document A', 2));
  fs.writeFileSync(path.join(OUT, 'b.pdf'), await smallPdf('Document B', 3));
  for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size);
  app.quit();
});
