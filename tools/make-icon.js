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

// Küçük boyutlar (< 128 px): tam tasarımın AYNI geometrisi/paleti, parametreleri boyuta göre sürekli değişir.
// t: 16 px -> 0, 128 px -> 1 (log ölçek). t=1'de tüm değerler fullSvg() ile aynıdır.
// İnce çizgiler "mürekkep korumalı" çizilir: en az minPx kalınlık, opaklık kalınlaşma oranında düşer
// (görünen koyuluk sabit kalır, alt-piksel çizgiler kırpılıp aniden yok olmaz).
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ramp = (t, a, b) => { const k = clamp01((t - a) / (b - a)); return k * k * (3 - 2 * k); };
const f = (v) => +v.toFixed(3);

function iconSvg(size) {
  if (size >= 128) return fullSvg();
  const t = clamp01((Math.log2(size) - 4) / 3);
  // Sayfa kutusu (tasarım birimi: x 2..118, y 4..156), küçükte hafifçe büyür, kenarlar tam piksele oturur.
  const z = lerp(1.07, 1, t);
  const ux = (u) => ((u + 22) / 164) * size, uy = (u) => ((u + 2) / 164) * size;
  const L = Math.round(ux(60 - 58 * z)), R = Math.round(ux(60 + 58 * z));
  const T = Math.round(uy(80 - 76 * z)), B = Math.min(size - (size <= 24 ? 1 : 1), Math.round(uy(80 + 76 * z)));
  const sx = (R - L) / 116, sy = (B - T) / 152;
  const tx = L - 2 * sx, ty = T - 4 * sy;
  const upx = 2 / (sx + sy); // 1 piksel = upx tasarım birimi
  const thin = (w, op, minPx) => { const w2 = Math.max(w, minPx * upx); return { w: f(w2), op: f((op * w) / w2) }; };

  // Çift çerçeve çizgileri: 40 px civarında sönmeye başlar, ~24 px'te biter.
  const fr1 = thin(1.4, 0.9 * ramp(t, 0.2, 0.75), 0.5);
  const fr2 = thin(0.9, 0.7 * ramp(t, 0.3, 0.8), 0.5);
  const foldLine = thin(0.9, 0.6 * ramp(t, 0.25, 0.7), 0.5);
  // Kanatlar: ana kıvrımlar her boyutta (en az ~0.85 px), iç tüyler 64->32 px arasında yavaşça söner.
  const wingW = f(Math.max(2.6, lerp(1.15, 0.85, t) * upx));
  const featherOp = f(ramp(t, 0.3, 0.75));
  const dotR = f(Math.max(4.6, lerp(1.0, 0.7, t) * upx));
  const wingDy = f(lerp(-4, 0, t));
  // Yazı: küçükte biraz büyür, harf aralığı daralır, aynı koyu altın degrade; çok hafif optik kalınlaştırma.
  // Piksel ızgarası: taban çizgisi ve büyük harf yüksekliği (Georgia ~0.692 em) tam piksele oturtulur -> yatay serifler net.
  // (yalnızca sapma <= %3 ise; aksi halde boyutlar arası yazı büyüklüğü sıçramasın diye dokunulmaz)
  const fs0 = lerp(47, 36, t), capPx = Math.round(fs0 * 0.692 * sy), fsSnap = capPx / (0.692 * sy);
  const fs = f(Math.abs(fsSnap / fs0 - 1) <= 0.03 ? fsSnap : fs0);
  const ls = f(lerp(-0.5, 2, t));
  const base = f((Math.round(ty + lerp(123, 116, t) * sy) - ty) / sy);
  const boldPx = lerp(0.4, 0, ramp(t, 0, 0.85));
  const textStroke = f(boldPx * upx);
  const hiOp = f(0.85 * ramp(t, 0.35, 0.85));
  // Alt çift çizgi: aşağıya kayar ve söner.
  const ul1 = thin(1.5, 0.8 * ramp(t, 0.15, 0.6), 0.5);
  const ul2 = thin(1.1, 0.6 * ramp(t, 0.3, 0.75), 0.5);
  const ulDy = f(lerp(4, 0, t));
  // Kenar tanımı: küçükte sayfanın İÇİNE ince koyu altın kenar (silüet büyümez), 96 px'e doğru söner.
  const edgeOp = f(0.9 * (1 - ramp(t, 0.35, 0.95)));
  const edgeW = f(2 * 0.6 * upx);
  // Gölge: en az ~0.5 px yumuşaklık.
  const shStd = f(Math.max(2.6, 0.45 * upx)), shDy = f(Math.max(2.2, 0.35 * upx));
  const PAGE = 'M10 4H84L118 38V148a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8V12a8 8 0 0 1 8-8Z';
  const font = `font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${fs}" letter-spacing="${ls}"`;
  // letter-spacing son harften sonra da boşluk bırakır; ortalamayı düzelt.
  const tx0 = f(61 + ls / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <defs>${DEFS}
    <clipPath id="pg"><path d="${PAGE}"/></clipPath>
    <filter id="sh" x="-20%" y="-10%" width="140%" height="130%">
      <feDropShadow dx="0" dy="${shDy}" stdDeviation="${shStd}" flood-color="#181923" flood-opacity=".45"/>
    </filter>
  </defs>
  <g transform="matrix(${f(sx)} 0 0 ${f(sy)} ${f(tx)} ${f(ty)})">
  <g filter="url(#sh)"><path d="${PAGE}" fill="#C9A44C"/></g>
  <g clip-path="url(#pg)">
    <rect x="0" y="0" width="124" height="160" fill="url(#gA)"/>
    <rect x="0" y="0" width="124" height="160" fill="url(#gS)" transform="skewX(-14) translate(26 0)" opacity=".55"/>
    ${fr1.op > 0.003 ? `<path d="M10 10H80L112 42V146H10Z" fill="none" stroke="#FFF4C2" stroke-width="${fr1.w}" opacity="${fr1.op}"/>` : ''}
    ${fr2.op > 0.003 ? `<path d="M15 15H77L107 45V141H15Z" fill="none" stroke="#7A5A17" stroke-width="${fr2.w}" opacity="${fr2.op}"/>` : ''}
    ${edgeOp > 0.003 ? `<path d="${PAGE}" fill="none" stroke="#7A5A17" stroke-width="${edgeW}" opacity="${edgeOp}"/>` : ''}
  </g>
  <path d="M84 4L118 38H94a10 10 0 0 1-10-10Z" fill="#8A6A1F" opacity=".78"/>
  ${foldLine.op > 0.003 ? `<path d="M84 4L118 38" stroke="#FFF1B8" stroke-width="${foldLine.w}" opacity="${foldLine.op}"/>` : ''}
  <g transform="translate(0 ${wingDy})" fill="none" stroke="url(#gB)" stroke-width="${wingW}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="61" cy="62" r="${dotR}" fill="#7A5A17" stroke="none"/>
    <path d="M56 62C48 52 36 52 27 58C36 58 43 62 48 70"/>
    <path d="M66 62C74 52 86 52 95 58C86 58 79 62 74 70"/>
    ${featherOp > 0.003 ? `<g opacity="${featherOp}"><path d="M54 66C47 60 40 61 34 65"/><path d="M68 66C75 60 82 61 88 65"/></g>` : ''}
  </g>
  ${hiOp > 0.003 ? `<text x="${tx0}" y="${f(base + 1.2)}" text-anchor="middle" ${font} fill="#FFF1B8" opacity="${hiOp}">PDF</text>` : ''}
  <text x="${tx0}" y="${base}" text-anchor="middle" ${font} fill="url(#gB)" stroke="#FFF4C2" stroke-width=".6" paint-order="stroke">PDF</text>
  ${textStroke > 0.01 ? `<text x="${tx0}" y="${base}" text-anchor="middle" ${font} fill="url(#gB)" stroke="#4A370C" stroke-width="${textStroke}" stroke-linejoin="round">PDF</text>` : ''}
  ${ul1.op > 0.003 ? `<path d="M26 ${f(129 + ulDy)}H96" stroke="#6E5115" stroke-width="${ul1.w}" opacity="${ul1.op}"/>` : ''}
  ${ul2.op > 0.003 ? `<path d="M34 ${f(135 + ulDy)}H88" stroke="#6E5115" stroke-width="${ul2.w}" opacity="${ul2.op}"/>` : ''}
  </g>
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
  return iconSvg(size);
}
// 4x süper-örnekleme: SVG 4 kat büyük çizilir, sonra premultiplied alfa ile kutu filtresiyle (alan ortalaması) küçültülür.
async function render(win, svg, size, ss = 4) {
  const js = `(async () => {
    const svg = ${JSON.stringify(svg)};
    const S = ${size}, K = ${ss}, BIG = S * K;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const b = document.createElement('canvas');
    b.width = BIG; b.height = BIG;
    b.getContext('2d').drawImage(img, 0, 0, BIG, BIG);
    const src = b.getContext('2d').getImageData(0, 0, BIG, BIG).data;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    const out = ctx.createImageData(S, S), d = out.data, n = K * K;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let r = 0, g = 0, bl = 0, a = 0;
      for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
        const p = ((y * K + j) * BIG + (x * K + i)) * 4, al = src[p + 3];
        r += src[p] * al; g += src[p + 1] * al; bl += src[p + 2] * al; a += al;
      }
      const o = (y * S + x) * 4;
      if (a > 0) { d[o] = Math.round(r / a); d[o + 1] = Math.round(g / a); d[o + 2] = Math.round(bl / a); }
      d[o + 3] = Math.round(a / n);
    }
    ctx.putImageData(out, 0, 0);
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
  fs.writeFileSync(path.join(DESIGN, 'hermes-icon-small.svg'), iconSvg(32));
  fs.writeFileSync(path.join(DESIGN, 'hermes-icon-mark.svg'), markSvg());
  fs.writeFileSync(path.join(DESIGN, 'onizleme.png'), await preview(win));
  console.log('ikonlar hazır:', OUT, DESIGN);
  app.quit();
});
