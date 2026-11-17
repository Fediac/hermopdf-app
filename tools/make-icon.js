// HermesPDF uygulama ikonunu üretir: altın varaklı PDF kâğıdı + kanatlı Hermes amblemi.
// SVG -> PNG (çeşitli boyutlar) -> build/icon.ico; ayrıca design/icon/ kopyaları ve önizleme.
// Çalıştır: npx electron tools/make-icon.js   (npm run icons de aynısını yapar)
// Palet: antik altın #C9A44C, açık altın #FFF1B8/#E6C56E, koyu altın #8A6A1F, kömür #181923, papirüs #F2E4C8
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'build');
const DESIGN = path.join(__dirname, '..', 'design', 'icon');

const DEFS = `
    <linearGradient id="gA" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFF1B8"/><stop offset=".32" stop-color="#E6C56E"/>
      <stop offset=".68" stop-color="#C9A44C"/><stop offset="1" stop-color="#8A6A1F"/>
    </linearGradient>
    <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6E5115"/><stop offset="1" stop-color="#3F2E09"/>
    </linearGradient>
    <linearGradient id="gW" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFF1B8"/><stop offset=".5" stop-color="#E6C56E"/><stop offset="1" stop-color="#C9A44C"/>
    </linearGradient>
    <linearGradient id="gS" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>`;

// Tam sürüm (>= 64 px). Site (#pdfWrap) ile aynı sayfa dili; 124x160 koordinatı, kare tuvale ortalı.
function fullSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -2 164 164">
  <defs>${DEFS}
    <clipPath id="pg"><path d="M10 4H84L118 38V148a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8V12a8 8 0 0 1 8-8Z"/></clipPath>
    <filter id="sh" x="-20%" y="-10%" width="140%" height="130%">
      <feDropShadow dx="0" dy="2.2" stdDeviation="2.6" flood-color="#181923" flood-opacity=".45"/>
    </filter>
  </defs>
  <g filter="url(#sh)"><path d="M10 4H84L118 38V148a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8V12a8 8 0 0 1 8-8Z" fill="#C9A44C"/></g>
  <g clip-path="url(#pg)">
    <rect x="0" y="0" width="124" height="160" fill="url(#gA)"/>
    <rect x="0" y="0" width="124" height="160" fill="url(#gS)" transform="skewX(-14) translate(26 0)" opacity=".55"/>
    <path d="M10 10H80L112 42V146H10Z" fill="none" stroke="#FFF4C2" stroke-width="1.4" opacity=".9"/>
    <path d="M15 15H77L107 45V141H15Z" fill="none" stroke="#7A5A17" stroke-width=".9" opacity=".7"/>
  </g>
  <path d="M84 4L118 38H94a10 10 0 0 1-10-10Z" fill="#8A6A1F" opacity=".78"/>
  <path d="M84 4L118 38" stroke="#FFF1B8" stroke-width=".9" opacity=".6"/>
  <g fill="none" stroke="url(#gB)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="61" cy="62" r="4.6" fill="#7A5A17" stroke="none"/>
    <path d="M56 62C48 52 36 52 27 58C36 58 43 62 48 70"/>
    <path d="M66 62C74 52 86 52 95 58C86 58 79 62 74 70"/>
    <path d="M54 66C47 60 40 61 34 65"/><path d="M68 66C75 60 82 61 88 65"/>
  </g>
  <text x="61" y="117.2" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="36" letter-spacing="2" fill="#FFF1B8" opacity=".85">PDF</text>
  <text x="61" y="116" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="36" letter-spacing="2" fill="url(#gB)" stroke="#FFF4C2" stroke-width=".6" paint-order="stroke">PDF</text>
  <path d="M26 129H96" stroke="#6E5115" stroke-width="1.5" opacity=".8"/>
  <path d="M34 135H88" stroke="#6E5115" stroke-width="1.1" opacity=".6"/>
</svg>`;
}

// Orta sürüm (32-48 px): sade kanat + kalın PDF; ince detaylar yok.
function midSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>${DEFS}</defs>
  <path d="M10 2H40L56 18V57a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z" fill="url(#gA)" stroke="#6E5115" stroke-width="2" stroke-linejoin="round"/>
  <path d="M40 2L56 18H45a5 5 0 0 1-5-5Z" fill="#8A6A1F" stroke="#6E5115" stroke-width="1.6" stroke-linejoin="round"/>
  <g fill="none" stroke="#3F2E09" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M29 20C24 15 17 15 12 19C18 19 23 21 25 25"/>
    <path d="M35 20C40 15 47 15 52 19C46 19 41 21 39 25"/>
  </g>
  <circle cx="32" cy="21" r="2.6" fill="#3F2E09"/>
  <text x="31" y="49" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="19" fill="#3F2E09" stroke="#3F2E09" stroke-width=".8">PDF</text>
</svg>`;
}

// Mini sürüm (16-24 px): kanat yok; altın silüet + büyük, koyu PDF.
function tinySvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>${DEFS}</defs>
  <path d="M8 1H41L58 18V59a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4Z" fill="url(#gA)" stroke="#6E5115" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M41 1L58 18H46a5 5 0 0 1-5-5Z" fill="#8A6A1F"/>
  <text x="31" y="48" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="25" letter-spacing="-1.5" fill="#2A1E05" stroke="#2A1E05" stroke-width="1.4" stroke-linejoin="round">PDF</text>
</svg>`;
}

// Yalnızca sembol: kanatlar + daire (şeffaf zemin).
function markSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 72">
  <defs>${DEFS}</defs>
  <g fill="none" stroke="url(#gW)" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M52 34C40 18 20 18 6 28C20 28 31 33 40 48"/>
    <path d="M68 34C80 18 100 18 114 28C100 28 89 33 80 48"/>
    <path d="M47 41C37 31 26 32 17 38"/><path d="M73 41C83 31 94 32 103 38"/>
  </g>
  <circle cx="60" cy="34" r="7.5" fill="url(#gW)"/>
  <circle cx="60" cy="34" r="7.5" fill="none" stroke="#8A6A1F" stroke-width="1.2" opacity=".7"/>
</svg>`;
}

function pickSvg(size) {
  if (size <= 24) return tinySvg();
  if (size <= 48) return midSvg();
  return fullSvg();
}
async function render(win, svg, size) {
  const js = `(async () => {
    const svg = ${JSON.stringify(svg)};
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = ${size}; c.height = ${size};
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, ${size}, ${size});
    return c.toDataURL('image/png');
  })()`;
  const url = await win.webContents.executeJavaScript(js);
  return Buffer.from(url.split(',')[1], 'base64');
}

// Açık/koyu zemin üzerinde önizleme: 512, 128, 64, 32, 16 (küçükler 4x büyütülmüş de gösterilir)
async function preview(win) {
  const sizes = [512, 128, 64, 32, 16];
  const urls = {};
  for (const s of sizes) urls[s] = 'data:image/png;base64,' + (await render(win, pickSvg(s), s)).toString('base64');
  const js = `(async () => {
    const urls = ${JSON.stringify(urls)};
    const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
    const im = {}; for (const k in urls) im[k] = await load(urls[k]);
    const W = 1100, H = 1300, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const rows = [{ y: 0, bg: '#181923' }, { y: 650, bg: '#F2E4C8' }];
    for (const r of rows) {
      x.fillStyle = r.bg; x.fillRect(0, r.y, W, 650);
      x.drawImage(im[512], 40, r.y + 40, 512, 512);
      x.drawImage(im[128], 600, r.y + 40, 128, 128);
      x.drawImage(im[64], 760, r.y + 40, 64, 64);
      x.drawImage(im[32], 860, r.y + 40, 32, 32);
      x.drawImage(im[16], 920, r.y + 40, 16, 16);
      x.imageSmoothingEnabled = false;
      x.drawImage(im[32], 600, r.y + 220, 128, 128);
      x.drawImage(im[16], 760, r.y + 220, 128, 128);
      x.imageSmoothingEnabled = true;
      x.fillStyle = r.bg === '#181923' ? '#C9A44C' : '#3F2E09'; x.font = '14px Segoe UI, Arial';
      x.fillText('128 / 64 / 32 / 16 px', 600, r.y + 200);
      x.fillText('32 px ve 16 px (4x piksel buyutme)', 600, r.y + 380);
    }
    return c.toDataURL('image/png');
  })()`;
  return Buffer.from((await win.webContents.executeJavaScript(js)).split(',')[1], 'base64');
}

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DESIGN, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const entries = [];
  for (const s of sizes) entries.push({ size: s, png: await render(win, pickSvg(s), s) });
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(entries));
  fs.writeFileSync(path.join(OUT, 'icon-64.png'), entries.find((e) => e.size === 64).png);
  fs.writeFileSync(path.join(OUT, 'icon-256.png'), entries.find((e) => e.size === 256).png);
  fs.writeFileSync(path.join(OUT, 'icon-512.png'), await render(win, fullSvg(), 512));
  fs.writeFileSync(path.join(OUT, 'icon-32.png'), entries.find((e) => e.size === 32).png);
  fs.writeFileSync(path.join(OUT, 'icon.svg'), fullSvg());
  fs.writeFileSync(path.join(DESIGN, 'hermes-icon.svg'), fullSvg());
  fs.writeFileSync(path.join(DESIGN, 'hermes-icon-small.svg'), midSvg());
  fs.writeFileSync(path.join(DESIGN, 'hermes-icon-mark.svg'), markSvg());
  fs.writeFileSync(path.join(DESIGN, 'onizleme.png'), await preview(win));
  console.log('ikonlar hazır:', OUT, DESIGN);
  app.quit();
});
