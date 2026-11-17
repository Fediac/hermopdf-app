// PDF içindeki görseller: konum tespiti, panoya kopyalama, kaydetme, toplu dışa aktarma; alan / sayfa görüntüsü.
import { App } from './state.js';
import { toast, copyImageToClipboard, canvasToBlob, withProgress, baseName, modal, el, field, select } from './util.js';
import { getPdfjs, openPdfjs } from './pdfcore.js';
import { t } from './i18n.js';

const cache = new WeakMap(); // pdf -> Map(pageIndex -> Promise<images[]>)

// Sayfadaki görsellerin görünen çerçevedeki (pt) kutuları
export function pageImages(d, i) {
  let m = cache.get(d.pdf);
  if (!m) { m = new Map(); cache.set(d.pdf, m); }
  if (!m.has(i)) m.set(i, scanPage(d.pdf, i));
  return m.get(i);
}

async function scanPage(pdf, i) {
  const { OPS, Util } = getPdfjs();
  const page = await pdf.getPage(i + 1);
  const ops = await page.getOperatorList();
  const vp = page.getViewport({ scale: 1 });
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let annotDepth = 0;
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k];
    const args = ops.argsArray[k];
    switch (fn) {
      case OPS.save: case OPS.beginGroup: stack.push(ctm); break;
      case OPS.restore: case OPS.endGroup: ctm = stack.pop() || ctm; break;
      case OPS.transform: ctm = Util.transform(ctm, args); break;
      case OPS.paintFormXObjectBegin: stack.push(ctm); if (args[0]) ctm = Util.transform(ctm, args[0]); break;
      case OPS.paintFormXObjectEnd: ctm = stack.pop() || ctm; break;
      case OPS.beginAnnotation: annotDepth++; stack.push(ctm); break;
      case OPS.endAnnotation: annotDepth--; ctm = stack.pop() || ctm; break;
      case OPS.paintImageMaskXObject:
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageXObjectRepeat: {
        if (annotDepth) break;
        const isMask = fn === OPS.paintImageMaskXObject;
        const inline = fn === OPS.paintInlineImageXObject;
        const objId = inline || isMask ? null : args[0];
        const w = isMask ? args[0]?.width : inline ? args[0]?.width : args[1];
        const h = isMask ? args[0]?.height : inline ? args[0]?.height : args[2];
        const m = Util.transform(vp.transform, ctm);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        if (box.w < 2 || box.h < 2) break;
        out.push({ objId, inline: inline ? args[0] : null, isMask, width: w, height: h, box, m, page });
        break;
      }
      default: break;
    }
  }
  return out;
}

export async function findImagesAt(d, i, x, y) {
  const imgs = await pageImages(d, i);
  const hit = (im) => x >= im.box.x && x <= im.box.x + im.box.w && y >= im.box.y && y <= im.box.y + im.box.h;
  return imgs.filter((im) => !im.isMask && hit(im))
    .reverse()
    .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
}

// Görselin üstünde/altında başka katman (maske, ikinci görsel, yazı) var mı?
// Taranmış belgelerde sayfa; bulanık arka plan + keskin yazı maskesi olarak iki katmandan oluşur;
// yalnız tek katmanı kopyalamak "yazıların silinmesi" gibi görünür.
export async function layersOver(d, i, im) {
  const imgs = await pageImages(d, i);
  const overlap = (a, b) => a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
  const others = imgs.filter((o) => o !== im && overlap(o.box, im.box));
  let textItems = 0;
  let maxPx = im.width || 0;
  for (const o of others) maxPx = Math.max(maxPx, o.width || 0);
  try {
    const tc = await d.textContent(i);
    const { Util } = getPdfjs();
    const page = await d.pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tx = Util.transform(vp.transform, it.transform);
      const size = Math.hypot(tx[2], tx[3]) || 8;
      const b = { x: tx[4], y: tx[5] - size, w: it.width || size, h: size * 1.2 };
      if (overlap(b, im.box)) textItems++;
    }
  } catch (e) { /* metin katmanı yoksa sorun değil */ }
  return { others, textItems, maxPx };
}

function getObj(page, id) {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 4000);
    try {
      store.get(id, (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } });
    } catch (e) { clearTimeout(t); resolve(null); }
  });
}

// Görselin orijinal piksellerini canvas'a çiz
export async function imageCanvas(d, i, im) {
  const data = im.inline || (im.objId ? await getObj(im.page, im.objId) : null);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (data) {
    const w = data.width, h = data.height;
    c.width = w; c.height = h;
    try {
      if (data.bitmap) {
        ctx.drawImage(data.bitmap, 0, 0);
        return c;
      }
      if (data.data) {
        const id = ctx.createImageData(w, h);
        const o = id.data, s = data.data;
        if (data.kind === 3) o.set(s.subarray(0, o.length));
        else if (data.kind === 2) {
          for (let p = 0, q = 0; q < o.length; p += 3, q += 4) { o[q] = s[p]; o[q + 1] = s[p + 1]; o[q + 2] = s[p + 2]; o[q + 3] = 255; }
        } else if (data.kind === 1) {
          const rowBytes = (w + 7) >> 3;
          for (let yy = 0; yy < h; yy++) {
            for (let xx = 0; xx < w; xx++) {
              const bit = s[yy * rowBytes + (xx >> 3)] & (128 >> (xx & 7));
              const q = (yy * w + xx) * 4;
              const v = bit ? 255 : 0;
              o[q] = v; o[q + 1] = v; o[q + 2] = v; o[q + 3] = 255;
            }
          }
        }
        ctx.putImageData(id, 0, 0);
        return c;
      }
    } catch (e) { console.warn('görsel verisi okunamadı', e); }
  }
  // yedek yol: sayfadan yüksek çözünürlükte kırp
  const scale = Math.min(6, Math.max(2, (im.width || 1000) / im.box.w));
  return renderRegion(d, i, im.box, scale);
}

// Görseli sayfada göründüğü haliyle (üstündeki yazı/maske katmanlarıyla birlikte) çizer
export async function compositeCanvas(d, i, im, maxPx) {
  const target = Math.max(im.width || 0, maxPx || 0, 1000);
  const scale = Math.min(12, Math.max(1, target / Math.max(1, im.box.w)));
  return renderRegion(d, i, im.box, scale, { withObjects: true });
}

export async function copyImage(d, i, im, { mode = 'auto' } = {}) {
  let c;
  let composited = false;
  if (mode === 'raw') {
    c = await imageCanvas(d, i, im);
  } else {
    const info = await layersOver(d, i, im).catch(() => ({ others: [], textItems: 0, maxPx: 0 }));
    if (info.others.length || info.textItems > 0) {
      c = await compositeCanvas(d, i, im, info.maxPx);
      composited = true;
    } else {
      c = await imageCanvas(d, i, im);
    }
  }
  await copyImageToClipboard(c);
  toast(t(composited ? 'images.copiedComposited' : 'images.copied', { w: c.width, h: c.height }), { type: 'ok', timeout: 5000 });
}

export async function saveImage(d, i, im, { mode = 'auto' } = {}) {
  let c;
  if (mode === 'raw') c = await imageCanvas(d, i, im);
  else {
    const info = await layersOver(d, i, im).catch(() => ({ others: [], textItems: 0, maxPx: 0 }));
    c = info.others.length || info.textItems > 0 ? await compositeCanvas(d, i, im, info.maxPx) : await imageCanvas(d, i, im);
  }
  const target = await window.pu.saveDialog({ defaultName: t('images.fileName', { name: baseName(d.name) }), title: t('images.saveTitle'), filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'JPEG', extensions: ['jpg', 'jpeg'] }] });
  if (!target) return;
  const jpg = /\.jpe?g$/i.test(target);
  const blob = await canvasToBlob(c, jpg ? 'image/jpeg' : 'image/png', 0.95);
  await window.pu.writeFile(target, new Uint8Array(await blob.arrayBuffer()));
  toast(t('images.saved'), { type: 'ok', action: { label: t('images.showInFolder'), run: () => window.pu.showItem(target) } });
}

// Düzenleme nesneleri varsa geçici olarak işlenmiş belgeyi kullan
async function renderSource(d, withObjects) {
  if (withObjects && d.hasObjects()) {
    const bytes = await d.buildBytes({ encrypt: false });
    return openPdfjs(bytes);
  }
  return { doc: d.pdf, destroy: () => {} };
}

export async function renderRegion(d, i, r, scale = 3, { withObjects = true } = {}) {
  const src = await renderSource(d, withObjects && d.pageObjs?.[i]?.length);
  try {
    const page = await src.doc.getPage(i + 1);
    const maxDim = 8000;
    scale = Math.min(scale, maxDim / Math.max(r.w, r.h));
    const vp = page.getViewport({ scale, offsetX: -r.x * scale, offsetY: -r.y * scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(r.w * scale));
    c.height = Math.max(1, Math.ceil(r.h * scale));
    await page.render({ canvas: c, viewport: vp, background: '#ffffff' }).promise;
    return c;
  } finally {
    src.destroy();
  }
}

export async function copyRegion(d, i, r) {
  const c = await renderRegion(d, i, r, 3);
  await copyImageToClipboard(c);
  toast(t('images.regionCopied', { w: c.width, h: c.height }), {
    type: 'ok', timeout: 5000,
    action: { label: t('images.saveToFile'), run: async () => {
      const target = await window.pu.saveDialog({ defaultName: t('images.regionFileName', { name: baseName(d.name) }), filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (target) await window.pu.writeFile(target, new Uint8Array(await (await canvasToBlob(c)).arrayBuffer()));
    } },
  });
}

export async function copyPageImage(d, i) {
  const info = await d.pageInfo(i);
  const c = await renderRegion(d, i, { x: 0, y: 0, w: info.w, h: info.h }, 2.5);
  await copyImageToClipboard(c);
  toast(t('images.pageCopied', { n: i + 1 }), { type: 'ok' });
}

export async function exportImages(d, pages) {
  const all = !pages;
  const list = pages || Array.from({ length: d.numPages }, (_, k) => k);
  const fmt = select([{ value: 'auto', label: t('images.fmtAuto') }, { value: 'png', label: t('images.fmtPng') }, { value: 'jpeg', label: t('images.fmtJpeg') }], 'auto');
  const minSize = el('input', { class: 'input', type: 'number', value: 32, min: 1 });
  const ok = await modal({
    title: t('images.extractTitle'),
    body: el('div', {}, el('p', { class: 'muted', text: all ? t('images.extractAll', { total: d.numPages }) : t('images.extractSome', { count: list.length }) }),
      field(t('images.format'), fmt), field(t('images.minSize'), minSize, t('images.minSizeHint'))),
    buttons: [{ label: t('common.cancel') }, { label: t('images.pickFolderSave'), primary: true, value: true }],
  });
  if (!ok) return;
  const folder = await window.pu.folderDialog({ title: t('images.folderTitle') });
  if (!folder) return;
  const min = +minSize.value || 1;
  const count = await withProgress(t('images.extracting'), async (p) => {
    const seen = new Set();
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      p.check();
      p.set(k / list.length, t('images.extractProgress', { page: list[k] + 1, total: d.numPages, count: n }));
      const imgs = (await pageImages(d, list[k])).filter((im) => !im.isMask);
      let idx = 0;
      for (const im of imgs) {
        const key = im.objId ? `${im.objId}` : null;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        if ((im.width || 0) < min || (im.height || 0) < min) continue;
        // taranmış sayfalarda katmanlar ayrı ayrı anlamsız; göründüğü gibi çıkar
        const info = await layersOver(d, list[k], im).catch(() => ({ others: [], textItems: 0, maxPx: 0 }));
        const c = info.others.length || info.textItems > 0 ? await compositeCanvas(d, list[k], im, info.maxPx) : await imageCanvas(d, list[k], im);
        let type = fmt.value === 'jpeg' ? 'image/jpeg' : 'image/png';
        if (fmt.value === 'auto') type = c.width * c.height > 250000 && !hasAlpha(c) ? 'image/jpeg' : 'image/png';
        const blob = await canvasToBlob(c, type, 0.95);
        idx++;
        await window.pu.writeInFolder(folder, `${baseName(d.name)} - s${list[k] + 1}-${idx}.${type === 'image/png' ? 'png' : 'jpg'}`, new Uint8Array(await blob.arrayBuffer()));
        n++;
      }
    }
    return n;
  });
  if (!count) toast(t('images.noneFound'), { type: 'warn', timeout: 6000 });
  else toast(t('images.savedCount', { count }), { type: 'ok', timeout: 6000, action: { label: t('images.openFolder'), run: () => window.pu.openPath(folder) } });
}

function hasAlpha(c) {
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  for (let k = 3; k < data.length; k += 40) if (data[k] < 250) return true;
  return false;
}

App.on('doc:reloaded', () => {});
