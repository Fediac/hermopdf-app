// Uygulamanın İngilizce arayüz ekran görüntülerini üretir (site için): design/ekran/app-en-<tema>-N-<ad>.png
// Çalıştır: node tools/app-screens.js [dil=en]   (pencere ekran dışında açılır, hiçbir ayara dokunmaz)
// Örnek belge İngilizce olarak burada üretilir (tests/fixtures içindeki örnekler Türkçe).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const { launch, sleep, FIX, ROOT } = require('../tests/harness');

const LANG = process.argv[2] || 'en';
const OUT = path.join(ROOT, 'design', 'ekran');

async function samplePdf(file) {
  const doc = await PDFDocument.create();
  doc.setTitle('Quarterly Report');
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const gold = rgb(0.48, 0.36, 0.07);
  const ink = rgb(0.1, 0.1, 0.12);
  // Sayfa 1: rapor + fatura tablosu
  let p = doc.addPage([595, 842]);
  p.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: rgb(0.95, 0.89, 0.78) });
  p.drawText('NORTHWIND STUDIO', { x: 50, y: 810, size: 13, font: fb, color: gold });
  p.drawText('Quarterly Report — Q3 2026', { x: 50, y: 740, size: 24, font: fb, color: ink });
  p.drawText('Invoice No: INV-2026-0042      Date: 12 November 2026', { x: 50, y: 712, size: 11, font: f, color: ink });
  const para = [
    'This quarter we shipped the new client portal, reduced support response times',
    'by 38% and onboarded fourteen new customers across three regions.',
    'Revenue grew steadily while operating costs stayed flat, giving the team room',
    'to invest in design and research for the coming year.',
  ];
  para.forEach((l, i) => p.drawText(l, { x: 50, y: 672 - i * 18, size: 11.5, font: f, color: ink }));
  p.drawText('Summary', { x: 50, y: 580, size: 15, font: fb, color: ink });
  const rows = [['Item', 'Qty', 'Price', 'Total'], ['Design sprint', '2', '$1,800.00', '$3,600.00'], ['Client portal', '1', '$4,250.00', '$4,250.00'], ['Support plan (3 months)', '3', '$320.00', '$960.00'], ['Hosting', '3', '$45.00', '$135.00']];
  rows.forEach((r, i) => {
    const y = 548 - i * 26;
    if (i === 0) p.drawRectangle({ x: 48, y: y - 8, width: 500, height: 24, color: rgb(0.93, 0.87, 0.72) });
    else p.drawLine({ start: { x: 48, y: y - 8 }, end: { x: 548, y: y - 8 }, thickness: 0.5, color: rgb(0.8, 0.74, 0.6) });
    [50, 300, 370, 460].forEach((x, k) => p.drawText(r[k], { x, y, size: 11, font: i === 0 ? fb : f, color: ink }));
  });
  p.drawText('Total due: $8,945.00', { x: 360, y: 400, size: 15, font: fb, color: rgb(0.62, 0.22, 0.12) });
  p.drawText('Signature:', { x: 50, y: 140, size: 12, font: f, color: ink });
  p.drawLine({ start: { x: 120, y: 138 }, end: { x: 300, y: 138 }, thickness: 0.8, color: ink });
  // Sayfa 2: fotoğraf
  p = doc.addPage([595, 842]);
  p.drawText('Page 2 — Project photos', { x: 50, y: 770, size: 20, font: fb, color: ink });
  const jpg = await doc.embedJpg(fs.readFileSync(path.join(FIX, 'photo.jpg')));
  const s = Math.min(495 / jpg.width, 420 / jpg.height);
  p.drawImage(jpg, { x: 50, y: 300, width: jpg.width * s, height: jpg.height * s });
  p.drawText('Workshop, October 2026', { x: 50, y: 280, size: 11, font: f, color: rgb(0.35, 0.33, 0.28) });
  // Sayfa 3-4: metin
  for (const n of [3, 4]) {
    p = doc.addPage([595, 842]);
    p.drawText(`Page ${n} — Notes`, { x: 50, y: 770, size: 20, font: fb, color: ink });
    for (let i = 0; i < 26; i++) p.drawText(`${i + 1}. Follow-up item for the next planning meeting, owner and due date to be confirmed.`, { x: 50, y: 730 - i * 22, size: 10.5, font: f, color: ink });
  }
  fs.writeFileSync(file, await doc.save());
}

async function run(theme, pdf) {
  process.env.PDFUSTA_LANG = LANG;
  const { app, win } = await launch();
  const shot = async (n, name) => {
    await win.evaluate(() => document.querySelectorAll('#toasts').forEach((t) => t.remove()));
    await sleep(350);
    const f = path.join(OUT, `app-${LANG}-${theme}-${n}-${name}.png`);
    await win.screenshot({ path: f });
    console.log('  ', path.relative(ROOT, f));
  };
  const esc = async () => { await win.keyboard.press('Escape'); await sleep(250); };
  await win.evaluate((th) => import('app://pu/src/renderer/js/app.js').then((m) => m.setTheme(th)), theme);
  await sleep(400);
  await shot(1, 'welcome');
  // Tanıtım turu: PDF küçült adımı
  await win.evaluate(() => import('app://pu/src/renderer/js/tour.js').then((m) => m.startTour()));
  await win.waitForSelector('.tour-pop');
  for (let i = 0; i < 3; i++) await win.click('.tour-pop [data-act="next"]');
  await sleep(450);
  await shot(2, 'tour-compress');
  await win.click('.tour-pop [data-act="skip"]');
  // Belge
  await win.evaluate((p) => window.__pu.openPaths([p]), pdf);
  await win.waitForSelector('.pdfViewer .page[data-page-number="1"] canvas', { timeout: 20000 });
  await sleep(1200);
  await shot(3, 'document');
  await win.evaluate(() => window.__pu.setTool('edittext'));
  await sleep(300);
  await shot(4, 'edit-text');
  await win.evaluate(() => window.__pu.setTool('select'));
  await win.click('.ribbon-tab[data-tab="convert"]');
  await shot(5, 'convert');
  await win.click('.ribbon-tab[data-tab="tools"]');
  await shot(6, 'tools');
  await win.click('.ribbon-tab[data-tab="home"]');
  win.evaluate(() => window.__pu.runAction('tools.compress'));
  await win.waitForSelector('.modal', { timeout: 15000 });
  await sleep(1500);
  await shot(7, 'compress');
  await esc();
  await win.click('.ribbon-tab[data-tab="page"]');
  await sleep(1500);
  await shot(8, 'page-layout');
  await win.click('.ribbon-tab[data-tab="home"]');
  win.evaluate(() => window.__pu.runAction('app.settings'));
  await win.waitForSelector('.settings-modal');
  await shot(9, 'settings');
  await esc();
  await app.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pu-screens-'));
  const pdf = path.join(dir, 'Quarterly Report.pdf');
  await samplePdf(pdf);
  for (const theme of ['light', 'dark']) {
    console.log(`${LANG} / ${theme}`);
    await run(theme, pdf);
  }
})().catch((e) => { console.error(e); process.exit(1); });
