// Sayfaları görüntüye çevirip yeni PDF oluşturur; seçilebilir görünmez metin katmanı korunur.
// Hem "maksimum küçültme" hem de "güvenli karartma" bunu kullanır.
import { getPdfjs, PDFLib, fontkit } from './pdfcore.js';
import { fontBytes, fontFile, defaultFamily } from './fonts.js';
import { canvasToBlob } from './util.js';
import { t } from './i18n.js';

let fontPromise = null;
function arialBytes() {
  if (!fontPromise) fontPromise = fontBytes(fontFile(defaultFamily(), false, false));
  return fontPromise;
}

// Kutular kesişiyor mu (görünen çerçevede)
const hit = (a, r) => a.x < r.x + r.w && a.x + a.w > r.x && a.y < r.y + r.h && a.y + a.h > r.y;

/**
 * pdfjsDoc sayfalarını rasterleştirir.
 * opts: { pages:[i], dpi, quality, gray, redactions: Map(i -> [rect]), onProgress(p,msg), check() }
 * Döndürür: pdf-lib PDFDocument (yalnızca istenen sayfalar, sırayla)
 */
export async function rasterizePages(pdfjsDoc, opts) {
  const { Util } = getPdfjs();
  const L = PDFLib();
  const out = await L.PDFDocument.create();
  out.registerFontkit(fontkit());
  const font = await out.embedFont(await arialBytes(), { subset: true });
  const charset = new Set(font.getCharacterSet());
  const pages = opts.pages;
  for (let n = 0; n < pages.length; n++) {
    opts.check && opts.check();
    const i = pages[n];
    opts.onProgress && opts.onProgress(n / pages.length, t('raster.pageProcessing', { n: i + 1 }));
    const page = await pdfjsDoc.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = (opts.dpi || 150) / 72;
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(vp.width));
    c.height = Math.max(1, Math.round(vp.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, viewport: vp, background: '#ffffff', annotationMode: getPdfjs().AnnotationMode.ENABLE_STORAGE, intent: 'print' }).promise; // ENABLE_FORMS dolu alanları çizmez
    const reds = opts.redactions?.get(i) || [];
    if (reds.length) {
      ctx.fillStyle = '#000';
      for (const r of reds) ctx.fillRect(Math.floor(r.x * scale), Math.floor(r.y * scale), Math.ceil(r.w * scale) + 1, Math.ceil(r.h * scale) + 1);
    }
    if (opts.gray) {
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      for (let k = 0; k < d.length; k += 4) { const v = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]; d[k] = d[k + 1] = d[k + 2] = v; }
      ctx.putImageData(id, 0, 0);
    }
    const blob = await canvasToBlob(c, 'image/jpeg', opts.quality ?? 0.6);
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const W = vp1.width, H = vp1.height;
    const np = out.addPage([W, H]);
    np.drawImage(img, { x: 0, y: 0, width: W, height: H });
    c.width = c.height = 0;

    // görünmez metin katmanı
    if (opts.keepText !== false) {
      const tc = await page.getTextContent();
      np.pushOperators(L.setTextRenderingMode(L.TextRenderingMode.Invisible));
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tx = Util.transform(vp1.transform, it.transform);
        const size = Math.hypot(tx[2], tx[3]);
        if (size < 0.5) continue;
        const ang = Math.atan2(tx[1], tx[0]);
        // Döndürülmüş sayfa / dikey metin için yönlü kutu: taban çizgisi boyunca uzunluk, (tx[2],tx[3]) yönünde yükseklik
        const len = it.width || size * it.str.length * 0.5;
        const ux = tx[0] / size, uy = tx[1] / size;
        const xs = [], ys = [];
        for (const a of [-0.2, 1]) for (const b of [0, len]) { xs.push(tx[4] + b * ux + a * tx[2]); ys.push(tx[5] + b * uy + a * tx[3]); }
        const x0 = Math.min(...xs) - 2, y0 = Math.min(...ys) - 2;
        const box = { x: x0, y: y0, w: Math.max(...xs) + 2 - x0, h: Math.max(...ys) + 2 - y0 };
        if (reds.some((r) => hit(box, r))) continue; // karartılan metni tamamen at
        const text = [...it.str].map((ch) => (charset.has(ch.codePointAt(0)) ? ch : ' ')).join('');
        if (!text.trim()) continue;
        const natural = font.widthOfTextAtSize(text, size);
        const target = Math.abs(ang) < 0.01 ? it.width : it.width;
        const squeeze = natural > 0 && target > 0 ? Math.max(1, Math.min(1000, (target / natural) * 100)) : 100;
        np.pushOperators(L.setCharacterSqueeze(squeeze));
        np.drawText(text, { x: tx[4], y: H - tx[5], size, font, rotate: L.degrees((-ang * 180) / Math.PI) });
      }
      np.pushOperators(L.setCharacterSqueeze(100), L.setTextRenderingMode(L.TextRenderingMode.Fill));
    }
  }
  opts.onProgress && opts.onProgress(1, t('raster.finishing'));
  return out;
}
