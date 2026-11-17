// PDF küçültme (downgrade): görselleri yeniden örnekle/sıkıştır, gereksiz verileri temizle,
// gerekirse sayfaları görüntüye çevir. Hedef boyut verilirse kademeleri otomatik dener.
import { App } from './state.js';
import { el, toast, modal, fmtBytes, baseName, withProgress, field, canvasToBlob } from './util.js';
import { icon } from './icons.js';
import { PDFLib, loadPdfLib, savePdfLib, openPdfjs, garbageCollect } from './pdfcore.js';
import { pageImages } from './images.js';
import { rasterizePages } from './raster.js';
import { t } from './i18n.js';

// label/sub getter: dil değişince güncel metni versin (modül yüklenirken çevrilmez)
export const LEVELS = {
  light: { get label() { return t('compress.lvLight'); }, get sub() { return t('compress.lvLightSub'); }, dpi: 220, q: 0.82 },
  medium: { get label() { return t('compress.lvMedium'); }, get sub() { return t('compress.lvMediumSub'); }, dpi: 150, q: 0.7 },
  strong: { get label() { return t('compress.lvStrong'); }, get sub() { return t('compress.lvStrongSub'); }, dpi: 110, q: 0.55 },
  extreme: { get label() { return t('compress.lvExtreme'); }, get sub() { return t('compress.lvExtremeSub'); }, dpi: 72, q: 0.42 },
  raster150: { get label() { return t('compress.lvRaster150'); }, get sub() { return t('compress.lvRaster150Sub'); }, raster: true, dpi: 150, q: 0.6 },
  raster100: { get label() { return t('compress.lvRaster100'); }, get sub() { return t('compress.lvRaster100Sub'); }, raster: true, dpi: 100, q: 0.5 },
  raster72: { get label() { return t('compress.lvRaster72'); }, get sub() { return t('compress.lvRaster72Sub'); }, raster: true, dpi: 72, q: 0.4 },
};
const AUTO_ORDER = ['light', 'medium', 'strong', 'extreme', 'raster150', 'raster100', 'raster72'];

// ---------------- yardımcılar ----------------
async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function unpredictPng(data, colors, bpc, columns) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const off = r * (rowLen + 1);
    const ft = data[off];
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const x = data[off + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (ft) {
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = x;
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return out;
}

function names(obj) {
  const { PDFName, PDFArray } = PDFLib();
  if (obj instanceof PDFName) return [obj];
  if (obj instanceof PDFArray) return obj.asArray().map((x) => x);
  return [];
}

function colorComponents(ctx, cs) {
  const { PDFName, PDFArray, PDFRawStream, PDFNumber } = PDFLib();
  const N = PDFName.of;
  if (cs instanceof PDFName) {
    if (cs === N('DeviceRGB') || cs === N('CalRGB')) return 3;
    if (cs === N('DeviceGray') || cs === N('CalGray')) return 1;
    return 0;
  }
  if (cs instanceof PDFArray) {
    const kind = cs.lookup(0);
    if (kind === N('ICCBased')) {
      const st = cs.lookup(1);
      const n = st && st.dict ? st.dict.lookup(N('N')) : null;
      return n instanceof PDFNumber ? n.asNumber() : 0;
    }
    if (kind === N('CalRGB')) return 3;
    if (kind === N('CalGray')) return 1;
  }
  void PDFRawStream;
  return 0;
}

function cleanup(lib, { metadata }) {
  const { PDFName, PDFDict } = PDFLib();
  const N = PDFName.of;
  for (const p of lib.getPages()) {
    p.node.delete(N('Thumb'));
    p.node.delete(N('PieceInfo'));
  }
  const cat = lib.catalog;
  cat.delete(N('PieceInfo'));
  if (metadata) {
    cat.delete(N('Metadata'));
    for (const p of lib.getPages()) p.node.delete(N('Metadata'));
  }
  void PDFDict;
}

// Görsellerin sayfadaki en büyük gösterim boyutları: "GxY" -> {wPt, hPt}
async function imageUsage(pdfjsDoc, onProgress, check) {
  const usage = new Map();
  const fake = { pdf: pdfjsDoc };
  for (let i = 0; i < pdfjsDoc.numPages; i++) {
    check && check();
    onProgress && onProgress(i / pdfjsDoc.numPages);
    let imgs = [];
    try { imgs = await pageImages(fake, i); } catch (e) { /* atla */ }
    for (const im of imgs) {
      if (!im.width || !im.height) continue;
      const key = `${im.width}x${im.height}`;
      const u = usage.get(key) || { w: 0, h: 0 };
      u.w = Math.max(u.w, im.box.w); u.h = Math.max(u.h, im.box.h);
      usage.set(key, u);
    }
  }
  return usage;
}

// ---------------- görsel sıkıştırma ----------------
async function recompressImages(lib, usage, level, { gray, onProgress, check }) {
  const L = PDFLib();
  const { PDFName, PDFRawStream, PDFNumber, PDFBool } = L;
  const N = PDFName.of;
  const ctx = lib.context;
  const objs = ctx.enumerateIndirectObjects();
  // SMask olarak kullanılan akışlar
  const smasks = new Set();
  for (const [, o] of objs) {
    if (o instanceof PDFRawStream && o.dict.get(N('Subtype')) === N('Image')) {
      const sm = o.dict.get(N('SMask'));
      if (sm) smasks.add(sm);
    }
  }
  const images = objs.filter(([, o]) => o instanceof PDFRawStream && o.dict.get(N('Subtype')) === N('Image'));
  let saved = 0, done = 0;
  for (const [ref, o] of images) {
    check && check();
    done++;
    if (done % 3 === 0) onProgress && onProgress(done / images.length, t('compress.imageProgress', { done, total: images.length }));
    const dict = o.dict;
    const im = dict.lookup(N('ImageMask'));
    if (im instanceof PDFBool && im.asBoolean()) continue;
    const w = dict.lookup(N('Width'), PDFNumber)?.asNumber();
    const h = dict.lookup(N('Height'), PDFNumber)?.asNumber();
    const bpc = dict.lookup(N('BitsPerComponent'))?.asNumber?.() ?? 8;
    if (!w || !h || w * h < 4096) continue;
    if (dict.has(N('Decode')) || dict.lookup(N('Mask'))) continue;
    const filters = names(dict.lookup(N('Filter')));
    const isSmask = smasks.has(ref);
    const comps = isSmask ? 1 : colorComponents(ctx, dict.lookup(N('ColorSpace')));
    if (comps !== 1 && comps !== 3) continue;
    // hedef çözünürlük
    const u = usage.get(`${w}x${h}`);
    let scale;
    if (u && u.w > 0) {
      const tw = (u.w / 72) * level.dpi, th = (u.h / 72) * level.dpi;
      scale = Math.min(1, Math.max(tw / w, th / h));
    } else {
      scale = Math.min(1, (level.dpi * 11) / Math.max(w, h)); // ~A4 uzun kenar varsayımı
    }
    const w2 = Math.max(1, Math.round(w * scale)), h2 = Math.max(1, Math.round(h * scale));

    // çöz
    let canvas;
    try {
      if (filters.length === 1 && filters[0] === N('DCTDecode') && !isSmask) {
        if (scale > 0.97 && level.q >= 0.8) continue; // zaten JPEG ve küçültme yok
        const bmp = await createImageBitmap(new Blob([o.contents], { type: 'image/jpeg' }));
        canvas = document.createElement('canvas');
        canvas.width = w2; canvas.height = h2;
        const c2 = canvas.getContext('2d');
        c2.imageSmoothingQuality = 'high';
        c2.drawImage(bmp, 0, 0, w2, h2);
        bmp.close();
      } else if (filters.every((f) => f === N('FlateDecode')) && bpc === 8) {
        let raw = filters.length ? L.decodePDFRawStream(o).decode() : o.contents;
        const parms = dict.lookup(N('DecodeParms'));
        const pred = parms && parms.lookup ? parms.lookup(N('Predictor'))?.asNumber?.() : 1;
        if (pred && pred >= 10) raw = unpredictPng(raw, parms.lookup(N('Colors'))?.asNumber?.() ?? comps, 8, parms.lookup(N('Columns'))?.asNumber?.() ?? w);
        else if (pred && pred > 1) continue;
        if (raw.length < w * h * comps) continue;
        const src = document.createElement('canvas');
        src.width = w; src.height = h;
        const sctx = src.getContext('2d');
        const id = sctx.createImageData(w, h);
        const d = id.data;
        for (let p = 0, q = 0; q < d.length; q += 4, p += comps) {
          if (comps === 3) { d[q] = raw[p]; d[q + 1] = raw[p + 1]; d[q + 2] = raw[p + 2]; } else { d[q] = d[q + 1] = d[q + 2] = raw[p]; }
          d[q + 3] = 255;
        }
        sctx.putImageData(id, 0, 0);
        if (scale >= 0.97 && isSmask) continue;
        canvas = document.createElement('canvas');
        canvas.width = w2; canvas.height = h2;
        const c2 = canvas.getContext('2d');
        c2.imageSmoothingQuality = 'high';
        c2.drawImage(src, 0, 0, w2, h2);
        src.width = src.height = 0;
      } else continue;
    } catch (e) {
      console.warn('görsel atlandı', e);
      continue;
    }

    let newBytes, newDict;
    if (isSmask) {
      // yumuşak maske gri + Flate kalmalı
      const d = canvas.getContext('2d').getImageData(0, 0, w2, h2).data;
      const g = new Uint8Array(w2 * h2);
      for (let k = 0, q = 0; k < g.length; k++, q += 4) g[k] = d[q];
      newBytes = await deflate(g);
      newDict = ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: w2, Height: h2, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: 'FlateDecode' });
    } else {
      const c2 = canvas.getContext('2d');
      if (gray) {
        const id = c2.getImageData(0, 0, w2, h2);
        const d = id.data;
        for (let k = 0; k < d.length; k += 4) { const v = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]; d[k] = d[k + 1] = d[k + 2] = v; }
        c2.putImageData(id, 0, 0);
      }
      const blob = await canvasToBlob(canvas, 'image/jpeg', level.q);
      newBytes = new Uint8Array(await blob.arrayBuffer());
      newDict = ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: w2, Height: h2, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' });
    }
    canvas.width = canvas.height = 0;
    if (newBytes.length >= o.contents.length * 0.92) continue;
    // maske, Interpolate gibi diğer anahtarları taşı
    for (const k of ['SMask', 'Interpolate', 'Intent', 'OC', 'Metadata', 'Name', 'StructParent']) {
      const v = dict.get(N(k));
      if (v) newDict.set(N(k), v);
    }
    saved += o.contents.length - newBytes.length;
    ctx.assign(ref, PDFRawStream.of(newDict, newBytes));
  }
  return saved;
}

async function compressUncompressedStreams(lib, check) {
  const { PDFName, PDFRawStream } = PDFLib();
  const N = PDFName.of;
  const ctx = lib.context;
  for (const [ref, o] of ctx.enumerateIndirectObjects()) {
    check && check();
    if (!(o instanceof PDFRawStream) || o.contents.length < 512) continue;
    if (o.dict.has(N('Filter'))) continue;
    if (o.dict.get(N('Type')) === N('XRef') || o.dict.get(N('Type')) === N('ObjStm')) continue;
    const z = await deflate(o.contents);
    if (z.length < o.contents.length * 0.9) {
      const d = o.dict.clone(ctx);
      d.set(N('Filter'), N('FlateDecode'));
      d.delete(N('DecodeParms'));
      ctx.assign(ref, PDFRawStream.of(d, z));
    }
  }
}

// ---------------- motor ----------------
export async function compressBytes(bytes, levelKey, { gray = false, metadata = true, usage = null, onProgress, check, password } = {}) {
  const level = LEVELS[levelKey];
  if (level.raster) {
    const src = await openPdfjs(bytes, password);
    try {
      const out = await rasterizePages(src.doc, { pages: Array.from({ length: src.doc.numPages }, (_, k) => k), dpi: level.dpi, quality: level.q, gray, onProgress, check });
      const info = await src.doc.getMetadata().catch(() => null);
      if (info?.info?.Title && !metadata) out.setTitle(info.info.Title);
      out.setProducer('HermoPDF');
      return savePdfLib(out);
    } finally { src.destroy(); }
  }
  const lib = await loadPdfLib(bytes, password);
  cleanup(lib, { metadata });
  garbageCollect(lib);
  await recompressImages(lib, usage || new Map(), level, { gray, onProgress, check });
  await compressUncompressedStreams(lib, check);
  garbageCollect(lib);
  if (metadata) {
    lib.setProducer('HermoPDF');
    lib.setCreator('HermoPDF');
  }
  return savePdfLib(lib);
}

export async function autoCompress(bytes, { target = null, gray = false, metadata = true, allowRaster = true, p, startLevel = 'medium' }) {
  const usage = await (async () => {
    p.set(0, t('compress.inspecting'));
    const src = await openPdfjs(bytes);
    try { return await imageUsage(src.doc, (v) => p.set(v * 0.25, t('compress.inspecting')), () => p.check()); } finally { src.destroy(); }
  })();
  const order = target ? AUTO_ORDER.filter((k) => allowRaster || !LEVELS[k].raster) : [startLevel];
  let best = null;
  for (let n = 0; n < order.length; n++) {
    p.check();
    const key = order[n];
    const base = 0.25 + (0.75 * n) / order.length;
    const span = 0.75 / order.length;
    p.set(base, t('compress.trying', { level: LEVELS[key].label }));
    const out = await compressBytes(bytes, key, { gray, metadata, usage, check: () => p.check(), onProgress: (v, msg) => p.set(base + v * span, `${LEVELS[key].label}: ${msg || ''}`) });
    if (!best || out.length < best.bytes.length) best = { bytes: out, level: key };
    if (!target || out.length <= target) break;
  }
  return best;
}

// ---------------- arayüz ----------------
export async function compressDialog(d) {
  const before = d.fileSize || d.baseBytes.length;
  let mode = 'auto';
  const targetIn = el('input', { class: 'input', type: 'number', min: 0.05, step: 0.1, placeholder: t('compress.targetPlaceholder'), style: { width: '110px' } });
  const presets = el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px', marginTop: '6px' } },
    [['1 MB', 1], ['2 MB', 2], ['5 MB', 5], [t('compress.presetEmail'), 10], [t('compress.presetHalf'), before / 2 / 1048576]].map(([l, v]) => {
      const b = el('button', { class: 'btn small', text: l });
      b.onclick = () => { targetIn.value = (+v).toFixed(2); pick('auto'); };
      return b;
    }));
  const levelSel = el('select', { class: 'input' }, Object.entries(LEVELS).map(([k, v]) => el('option', { value: k, text: `${v.label} — ${v.sub}`, selected: k === 'medium' })));
  const gray = el('input', { type: 'checkbox' });
  const meta = el('input', { type: 'checkbox', checked: true });
  const raster = el('input', { type: 'checkbox', checked: true });
  const out = el('select', { class: 'input' }, el('option', { value: 'file', text: t('compress.outFile') }), el('option', { value: 'tab', text: t('compress.outTab') }), el('option', { value: 'replace', text: t('compress.outReplace') }));
  const cards = el('div', { class: 'radio-list' });
  const card = (val, title, sub, extra) => {
    const r = el('input', { type: 'radio', name: 'cmode', checked: val === mode });
    const c = el('label', { class: `radio-card ${val === mode ? 'on' : ''}`, dataset: { v: val } }, r, el('div', { style: { flex: 1 } }, el('b', { text: title }), el('small', { text: sub }), extra || null));
    r.onchange = () => pick(val);
    return c;
  };
  const pick = (v) => {
    mode = v;
    cards.querySelectorAll('.radio-card').forEach((c) => { const on = c.dataset.v === v; c.classList.toggle('on', on); c.querySelector('input').checked = on; });
  };
  cards.append(
    card('auto', t('compress.modeAuto'), t('compress.modeAutoSub'), el('div', { style: { marginTop: '8px' } }, el('div', { class: 'row' }, el('span', { class: 'muted', text: t('compress.targetLabel') }), targetIn), presets, el('label', { class: 'checkline' }, raster, t('compress.allowRaster')))),
    card('manual', t('compress.modeManual'), t('compress.modeManualSub'), el('div', { style: { marginTop: '8px' } }, levelSel)),
  );
  const res = await modal({
    title: t('compress.title'), width: 600,
    body: el('div', {},
      el('div', { class: 'size-box', style: { marginBottom: '12px' } }, el('small', { text: t('compress.currentSize') }), el('b', { text: fmtBytes(before) }), el('small', { text: t('compress.pagesAndName', { count: d.numPages, name: d.name }) })),
      cards,
      el('label', { class: 'checkline' }, gray, t('compress.grayscale')),
      el('label', { class: 'checkline' }, meta, t('compress.cleanMeta')),
      field(t('compress.result'), out)),
    buttons: [{ label: t('common.cancel') }, { label: t('compress.run'), primary: true, value: true }],
  });
  if (!res) return;
  const input = await d.buildBytes({ encrypt: false });
  const target = mode === 'auto' && +targetIn.value > 0 ? Math.round(+targetIn.value * 1048576) : null;
  const t0 = performance.now();
  const best = await withProgress(t('compress.progress'),(p) => autoCompress(input, {
    target, gray: gray.checked, metadata: meta.checked, allowRaster: raster.checked, p,
    startLevel: mode === 'manual' ? levelSel.value : 'medium',
  }));
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  await showResult(d, before, best, { target, out: out.value, secs });
}

async function showResult(d, before, best, { target, out, secs }) {
  const after = best.bytes.length;
  const pct = Math.round((1 - after / before) * 100);
  const note = after >= before
    ? t('compress.noteAlready')
    : target && after > target ? t('compress.noteTarget', { size: fmtBytes(target) }) : t('compress.noteLevel', { level: LEVELS[best.level].label, secs });
  if (after >= before && out !== 'tab') {
    await modal({ title: t('compress.resultTitle'), body: el('div', {}, sizeCompare(before, after, pct), el('p', { class: 'modal-msg', text: note })), buttons: [{ label: t('common.ok'), primary: true }] });
    return;
  }
  const name = t('compress.outName', { name: baseName(d.name) });
  if (out === 'file') {
    const target2 = await window.pu.saveDialog({ defaultName: name, defaultDir: d.path ? d.path.replace(/[\\/][^\\/]*$/, '') : undefined, title: t('compress.saveTitle') });
    if (!target2) return;
    const info = await window.pu.writeFile(target2, best.bytes, { recent: true });
    const r = await modal({
      title: t('compress.doneTitle'),
      body: el('div', {}, sizeCompare(before, info.size, Math.round((1 - info.size / before) * 100)), el('p', { class: 'modal-msg', text: `${note}\n${t('compress.savedPath', { path: info.path })}` })),
      buttons: [{ label: t('compress.showInFolder'), value: 'show' }, { label: t('compress.open'), value: 'open' }, { label: t('common.ok'), primary: true }],
    });
    if (r === 'show') window.pu.showItem(info.path);
    if (r === 'open') (await import('./app.js')).openPaths([info.path]);
  } else if (out === 'tab') {
    const { openBytes } = await import('./app.js');
    const nd = await openBytes(best.bytes, name);
    if (nd) { nd.markDirty(); toast(`${t('compress.shrunk', { before: fmtBytes(before), after: fmtBytes(after), pct })} ${note}`, { type: 'ok', timeout: 7000 }); }
  } else {
    d.snapshot(t('compress.snapshot'), { bytes: true });
    await d.reloadBytes(best.bytes, { keepObjs: false });
    d.pageObjs = d.pageObjs.map(() => []);
    d.markDirty();
    toast(`${t('compress.shrunk', { before: fmtBytes(before), after: fmtBytes(after), pct })} ${t('compress.saveToKeep')}`, { type: 'ok', timeout: 7000 });
  }
}

function sizeCompare(before, after, pct) {
  return el('div', { class: 'size-compare' },
    el('div', { class: 'size-box' }, el('small', { text: t('compress.before') }), el('b', { text: fmtBytes(before) })),
    el('div', { html: icon('arrow-right') }),
    el('div', { class: `size-box ${after < before ? 'good' : ''}` }, el('small', { text: t('compress.after') }), el('b', { text: fmtBytes(after) }), el('small', { text: after < before ? t('compress.smallerBy', { pct }) : t('compress.notShrunk') })));
}

export async function compressFilesDialog() {
  const files = await window.pu.openPdfDialog({ multi: false, title: t('compress.pickTitle') });
  if (!files.length) return;
  const { openFiles } = await import('./app.js');
  const d = await openFiles(files);
  if (d) await compressDialog(d);
}

void App;
