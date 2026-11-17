#!/usr/bin/env node
// Site görsellerini üretir: Open Graph kartları (1200x630), apple-touch-icon, logo ve
// eksik ekran görüntüleri için yer tutucu PNG'ler (1400x900, uygulama penceresiyle aynı oran).
// Çizim için bilgisayardaki Microsoft Edge (yoksa Chrome) kullanılır; playwright-core uygulama
// deposundan (PDFUsta/node_modules) salt okunur olarak yüklenir. Hiçbir şey indirilmez.
//   node tools/make-images.mjs            → eksik olanları üret
//   node tools/make-images.mjs --force    → OG/ikonları yeniden üret (gerçek ekran görüntülerine dokunmaz)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const APP = process.env.ULTRONIX_APP_DIR || path.resolve(ROOT, '..', '..', 'PDFUsta');
const require = createRequire(path.join(APP, 'package.json'));
const { chromium } = require('playwright-core');
const FORCE = process.argv.includes('--force');

// Hermes teması: ikon design/icon/hermes-icon.svg (site kopyası src/img/), son kare = plaka + kesilmiş Hermes.
const svg = (name) => fs.readFileSync(path.join(SRC, 'img', name), 'utf8').replace('<svg ', '<svg width="100%" height="100%" ');
const iconSvg = svg('hermes-icon.svg');
const dataUri = (rel, type) => `data:${type};base64,${fs.readFileSync(path.join(SRC, rel)).toString('base64')}`;
const pdf = fs.readFileSync(path.join(SRC, 'partials', 'hermes-pdf.html'), 'utf8').replace(/width="124" height="160"/, 'width="100%" height="100%"');
const mascot = `<div style="width:100%;height:100%">${iconSvg}</div>`;
export const SHOTS = {
  'baslangic': 'Başlangıç ekranı',
  'metin-duzenleme-yakin': 'Mevcut metni düzenleme',
  'kucultme-dialog': 'PDF küçült penceresi (hedef boyut)',
  'kucultme-sonuc': 'Küçültme sonucu (önce / sonra)',
  'ocr-sonuc': 'OCR sonrası arama',
  'imza': 'İmza çizme',
  'karartma': 'Karartma',
  'toplu-islem': 'Toplu işlem',
};

const page = (body, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:"Segoe UI",system-ui,sans-serif;color:#181923;background:#F2E4C8}
.serif{font-family:"Palatino Linotype",Palatino,Georgia,serif}
</style></head><body>${body}</body></html>`;

function og(lang) {
  const t = lang === 'tr'
    ? { a: "PDF'in sahibi", b: 'sensin.', s: 'Abonelik yok. Reklam yok.<br>Belgelerin senin bilgisayarında.', f: 'Windows için ücretsiz PDF programı · açık kaynak' }
    : { a: 'You own', b: 'your PDFs.', s: 'No subscription. No ads.<br>Your documents stay on your computer.', f: 'A free PDF editor for Windows · open source' };
  const plate = dataUri('static/hermes/plaka.webp', 'image/webp');
  const her = dataUri('static/hermes/hermes.webp', 'image/webp');
  const gold = 'background:linear-gradient(180deg,#FFF1B8 0%,#E6C56E 38%,#C9A44C 70%,#A78530 100%);-webkit-background-clip:text;background-clip:text;color:transparent';
  return page(`
<div style="position:absolute;inset:0;background:#181923"></div>
<img src="${plate}" style="position:absolute;left:300px;top:0;width:1120px;height:630px">
<img src="${her}" style="position:absolute;left:300px;top:0;width:1120px;height:630px">
<div style="position:absolute;left:749px;top:232px;width:108px;height:140px;transform:rotate(-9deg) scale(.88);filter:drop-shadow(0 0 14px rgba(255,210,110,.75)) drop-shadow(0 6px 10px rgba(0,0,0,.45))">${pdf}</div>
<div style="position:absolute;inset:0;background:linear-gradient(90deg,#181923 0%,#181923 22%,rgba(24,25,35,.88) 40%,rgba(24,25,35,.25) 58%,rgba(24,25,35,0) 66%)"></div>
<div style="position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg,#A78530,#FFF1B8 30%,#C9A44C 60%,#A78530)"></div>
<div style="position:absolute;left:64px;top:52px;display:flex;align-items:center;gap:14px;font-size:34px;font-weight:650;color:#F2E4C8"><div style="width:58px;height:58px">${svg('hermes-icon-small.svg')}</div><span>Hermo<b style="${gold}">PDF</b></span></div>
<div class="serif" style="position:absolute;left:64px;top:164px;font-size:88px;line-height:1.04;font-weight:700;letter-spacing:-1px;color:#F2E4C8">${t.a}<br><span style="${gold}">${t.b}</span></div>
<div style="position:absolute;left:66px;top:390px;font-size:29px;line-height:1.4;color:#efe7d4">${t.s}</div>
<div style="position:absolute;left:66px;top:520px;font-size:22px;font-weight:600;color:#D9B75E">${t.f}</div>`, 1200, 630);
}
const icon = (size) => page(`<div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:radial-gradient(circle at 50% 42%,#3a3122 0%,#181923 70%)"><div style="width:${Math.round(size * 0.8)}px;height:${Math.round(size * 0.8)}px">${iconSvg}</div></div>`, size, size);
const placeholder = (name, label) => page(`
<div style="position:absolute;inset:0;background:repeating-linear-gradient(45deg,#f4eee4,#f4eee4 22px,#fffaf3 22px,#fffaf3 44px)"></div>
<div style="position:absolute;inset:60px;border:4px dashed #c9bfae;border-radius:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center">
<div style="width:220px;height:220px">${mascot}</div>
<div style="font-size:44px;font-weight:700">${label}</div>
<div style="font-size:26px;color:#5a5468">Yer tutucu · gerçek ekran görüntüsü tools/shots.mjs ile alınır<br><code>${name}.png</code></div></div>`, 1400, 900);

async function main() {
  let browser;
  for (const channel of ['msedge', 'chrome']) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch (e) { /* sıradakini dene */ }
  }
  if (!browser) throw new Error('Microsoft Edge ya da Chrome bulunamadı.');
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const render = async (html, w, h, out) => {
    if (fs.existsSync(out) && !FORCE) return false;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(html, { waitUntil: 'load' });
    await p.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h } });
    console.log('yazıldı:', path.relative(ROOT, out));
    return true;
  };
  await render(og('tr'), 1200, 630, path.join(SRC, 'img', 'og-tr.png'));
  await render(og('en'), 1200, 630, path.join(SRC, 'img', 'og-en.png'));
  await render(icon(180), 180, 180, path.join(SRC, 'img', 'apple-touch-icon.png'));
  await render(icon(512), 512, 512, path.join(SRC, 'img', 'logo-512.png'));

  // Ekran görüntüsü yer tutucuları: yalnız dosya yoksa. Listesi .placeholders.json'da tutulur;
  // shots.mjs gerçek görüntüyü yazınca adı listeden çıkarır, build.mjs listede kalanlar için uyarır.
  const listFile = path.join(SRC, 'img', 'shots', '.placeholders.json');
  const list = new Set(fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : []);
  for (const [name, label] of Object.entries(SHOTS)) {
    const out = path.join(SRC, 'img', 'shots', `${name}.png`);
    if (fs.existsSync(out) && !list.has(name)) continue; // gerçek görüntü: dokunma
    const saved = FORCE;
    if (!fs.existsSync(out) || saved) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await p.setViewportSize({ width: 1400, height: 900 });
      await p.setContent(placeholder(name, label), { waitUntil: 'load' });
      await p.screenshot({ path: out });
      console.log('yer tutucu:', path.relative(ROOT, out));
    }
    list.add(name);
  }
  fs.writeFileSync(listFile, JSON.stringify([...list].sort(), null, 2) + '\n');
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
