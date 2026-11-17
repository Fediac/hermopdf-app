// Ekleme işlemleri: görsel, tarih, filigran, üst/alt bilgi, sayfa numarası, tüm sayfalara kopyalama.
import { App } from './state.js';
import { el, toast, modal, field, select, blobToDataURL, loadImage, uid, parseRanges, canvasToBlob, dataURLToBytes } from './util.js';
import { pageRange, infoBox } from './assist.js';
import { icon } from './icons.js';
import { setTool } from './tools.js';
import { renderLayer, pageDims } from './overlay.js';
import { textFonts, fontStack, ensureLoaded } from './fonts.js';
import { t, locale } from './i18n.js';

// JPEG'in ham çerçeve (SOF) boyutu ve EXIF yönü. Tarayıcı naturalWidth/Height'ta EXIF yönünü uygular,
// pdf-lib ise ham pikselleri gömer: yön 1 değilse görsel yan yatık ve gerilmiş kaydedilir.
export function jpegInfo(b) {
  let p = 2, orientation = 1, w = 0, h = 0;
  while (p + 9 < b.length) {
    if (b[p] !== 0xFF) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xFF) { p++; continue; }
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
    const len = (b[p + 2] << 8) | b[p + 3];
    if (m === 0xE1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
      try {
        const t = p + 10, le = b[t] === 0x49;
        const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
        const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216 : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
        const ifd = t + u32(t + 4);
        const n = u16(ifd);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === 0x0112) { orientation = u16(e + 8) || 1; break; }
        }
      } catch (e) { /* bozuk EXIF: yok say */ }
    }
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      h = (b[p + 5] << 8) | b[p + 6]; w = (b[p + 7] << 8) | b[p + 8];
      break;
    }
    if (m === 0xDA) break;
    p += 2 + len;
  }
  return { w, h, orientation };
}

// Büyük görselleri makul boyuta indir (dosya şişmesin)
export async function prepareImage(dataURL, maxDim = 2400) {
  const img = await loadImage(dataURL);
  let w = img.naturalWidth, h = img.naturalHeight;
  const isPng = dataURL.startsWith('data:image/png');
  const isJpg = dataURL.startsWith('data:image/jpeg');
  // EXIF yönlü JPEG: kanvasa çizip yeniden kodla (yön piksellere işlenir)
  let jpgOk = isJpg;
  if (isJpg) {
    try {
      const ji = jpegInfo(dataURLToBytes(dataURL));
      jpgOk = ji.orientation === 1 && ji.w === w && ji.h === h;
    } catch (e) { jpgOk = false; }
  }
  if (Math.max(w, h) <= maxDim && (isPng || jpgOk)) return { dataURL, w, h };
  const s = Math.min(1, maxDim / Math.max(w, h));
  w = Math.round(w * s); h = Math.round(h * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const out = isJpg ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png');
  return { dataURL: out, w, h };
}

export async function insertImageObject(d, page, dataURL, w, h, { at = null, label = t('insert.addImage'), kind = 'image', maxW = 0.5 } = {}) {
  const prep = await prepareImage(dataURL);
  const assetId = d.addAsset(prep.dataURL, prep.w, prep.h);
  const dims = pageDims(d, page);
  let ow = Math.min(dims.w * maxW, prep.w * 0.75);
  let oh = ow * (prep.h / prep.w);
  if (oh > dims.h * 0.6) { oh = dims.h * 0.6; ow = oh * (prep.w / prep.h); }
  const cx = at ? at.x : dims.w / 2;
  const cy = at ? at.y : dims.h / 2;
  return d.addObj(page, { type: 'image', kind, assetId, x: cx - ow / 2, y: cy - oh / 2, w: ow, h: oh, opacity: 1 }, { label });
}

export async function insertImageDialog(d) {
  const files = await window.pu.openFilesDialog({ title: t('insert.pickImage'), multi: false, filters: [{ name: t('insert.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
  if (!files.length) return;
  const f = files[0];
  const ext = f.name.split('.').pop().toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[ext] || 'image/png';
  const dataURL = await blobToDataURL(new Blob([f.bytes], { type: mime }));
  const prep = await prepareImage(dataURL);
  const assetId = d.addAsset(prep.dataURL, prep.w, prep.h);
  setTool('place', { place: { assetId, w: prep.w, h: prep.h, label: t('insert.addImage'), kind: 'image', defaultW: Math.min(240, prep.w * 0.75) } });
  toast(t('insert.imageHint'), { timeout: 4000 });
}

export function insertDate(d) {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const text = locale() === 'tr' ? `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()}` : now.toLocaleDateString(locale());
  const page = d.currentPageIndex;
  const dims = pageDims(d, page);
  const o = d.addObj(page, { type: 'text', ...App.defaults.text, x: dims.w / 2 - 40, y: dims.h / 2, w: 100, text }, { label: t('insert.addDate') });
  setTool('select');
  toast(t('insert.dateAdded'), { timeout: 3500 });
  return o;
}

export function copyToAllPages(d, id) {
  const f = d.findObj(id);
  if (!f) return;
  d.snapshot(t('insert.copyAll'));
  let n = 0;
  for (let p = 0; p < d.numPages; p++) {
    if (p === f.page) continue;
    const o = JSON.parse(JSON.stringify(f.obj));
    o.id = uid();
    o.cover = null;
    d.pageObjs[p].push(o);
    n++;
    renderLayer(d, p);
  }
  toast(t('insert.copiedToPages', { count: n }), { type: 'ok', action: { label: t('insert.undo'), run: () => d.undo() } });
}

function removeGroup(d, group) {
  let removed = 0;
  d.pageObjs = d.pageObjs.map((arr) => arr.filter((o) => { if (o.group === group) { removed++; return false; } return true; }));
  return removed;
}

function pagesInput(d) {
  return el('input', { class: 'input', value: `1-${d.numPages}` });
}

// ---------------- filigran ----------------
export async function watermarkDialog(d) {
  const text = el('input', { class: 'input', value: t('insert.wmDefault') });
  const size = el('input', { class: 'input', type: 'number', value: 72, min: 10, max: 300 });
  const color = el('input', { type: 'color', class: 'color-pick', value: '#d32f2f' });
  const opacity = el('input', { type: 'range', min: 5, max: 100, value: 22 });
  const angle = select([{ value: -45, label: t('insert.angleDiag') }, { value: 0, label: t('insert.angleHoriz') }, { value: -90, label: t('insert.angleVert') }], -45);
  const fonts = select(textFonts().map((f) => ({ value: f.family, label: f.family })), 'Arial');
  const bold = el('input', { type: 'checkbox', checked: true });
  const range = pageRange(d, { label: t('insert.wmPages') });

  // Önizleme: gerçek sayfanın küçük hâli + üstünde filigran
  const prevWrap = el('div', { class: 'wm-preview' });
  const prevCanvas = el('canvas');
  prevWrap.append(prevCanvas, el('div', { class: 'wm-caption', text: t('insert.wmPreview', { no: d.currentPageIndex + 1 }) }));
  let pageBitmap = null;
  const loadPage = async () => {
    const page = await d.pdf.getPage(d.currentPageIndex + 1);
    const vp0 = page.getViewport({ scale: 1 });
    const scale = Math.min(320 / vp0.width, 420 / vp0.height);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, viewport: vp, background: '#ffffff' }).promise;
    pageBitmap = c;
  };
  const draw = async () => {
    if (!pageBitmap) return;
    prevCanvas.width = pageBitmap.width;
    prevCanvas.height = pageBitmap.height;
    const x = prevCanvas.getContext('2d');
    x.drawImage(pageBitmap, 0, 0);
    const wm = await watermarkCanvas({ text: text.value, size: +size.value, color: color.value, opacity: +opacity.value / 100, angle: +angle.value, font: fonts.value, bold: bold.checked }, 1);
    const s = Math.min((prevCanvas.width * 0.95) / wm.width, (prevCanvas.height * 0.95) / wm.height, 1);
    x.drawImage(wm, (prevCanvas.width - wm.width * s) / 2, (prevCanvas.height - wm.height * s) / 2, wm.width * s, wm.height * s);
  };
  [text, size, color, opacity, angle, fonts, bold].forEach((i) => i.addEventListener('input', draw));
  loadPage().then(draw);

  const res = await modal({
    title: t('insert.wmTitle'), width: 720, className: 'wide-modal',
    body: el('div', { class: 'two-col' },
      prevWrap,
      el('div', {},
        infoBox('info', t('insert.wmWhat'), t('insert.wmInfo')),
        field(t('insert.text'), text),
        el('div', { class: 'row' }, field(t('insert.size'), size), field(t('insert.angle'), angle)),
        field(t('insert.font'), fonts),
        el('div', { class: 'row' },
          el('label', { class: 'field' }, el('span', { class: 'field-label', text: t('insert.color') }), color),
          el('label', { class: 'field' }, el('span', { class: 'field-label', text: t('insert.opacity') }), opacity),
          el('label', { class: 'checkline' }, bold, t('insert.bold'))),
        range.node,
        el('p', { class: 'muted', style: { fontSize: '12px' }, text: t('insert.wmNote') }))),
    buttons: [{ label: t('common.cancel') }, { label: t('insert.add'), primary: true, run: () => { try { range.pages(); return true; } catch (e) { toast(e.message, { type: 'warn' }); return false; } } }],
  });
  if (!res || !text.value.trim()) return;
  const c = await watermarkCanvas({ text: text.value, size: +size.value, color: color.value, opacity: 1, angle: +angle.value, font: fonts.value, bold: bold.checked }, 3);
  const dataURL = c.toDataURL('image/png');
  const assetId = d.addAsset(dataURL, c.width, c.height);
  const list = range.pages();
  d.snapshot(t('insert.watermark'));
  removeGroup(d, 'watermark');
  for (const p of list) {
    const dims = pageDims(d, p);
    const w = c.width / 3, h = c.height / 3;
    const s = Math.min(1, (dims.w * 0.95) / w, (dims.h * 0.95) / h);
    d.pageObjs[p].push({ id: uid(), type: 'image', kind: 'watermark', group: 'watermark', assetId, x: (dims.w - w * s) / 2, y: (dims.h - h * s) / 2, w: w * s, h: h * s, opacity: +opacity.value / 100 });
  }
  d.layers.forEach((l, i) => l && renderLayer(d, i));
  toast(t('insert.wmAdded', { count: list.length }), { type: 'ok', action: { label: t('insert.undo'), run: () => d.undo() } });
}

async function watermarkCanvas(o, scale) {
  await ensureLoaded(o.font, o.bold, false, 50);
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const fs = o.size * scale;
  const font = `${o.bold ? 'bold ' : ''}${fs}px ${fontStack(o.font)}`;
  x.font = font;
  const tw = x.measureText(o.text).width;
  const th = fs * 1.2;
  const a = (o.angle * Math.PI) / 180;
  const W = Math.abs(tw * Math.cos(a)) + Math.abs(th * Math.sin(a));
  const H = Math.abs(tw * Math.sin(a)) + Math.abs(th * Math.cos(a));
  c.width = Math.ceil(W) + 4; c.height = Math.ceil(H) + 4;
  const y = c.getContext('2d');
  y.translate(c.width / 2, c.height / 2);
  y.rotate(a);
  y.font = font;
  y.fillStyle = o.color;
  y.globalAlpha = o.opacity;
  y.textAlign = 'center';
  y.textBaseline = 'middle';
  y.fillText(o.text, 0, 0);
  return c;
}

// ---------------- üst / alt bilgi ----------------
export async function headerFooterDialog(d) {
  const mk = (ph) => el('input', { class: 'input', placeholder: ph });
  const hl = mk(t('insert.left')), hc = mk(t('insert.center')), hr = mk(t('insert.right'));
  const fl = mk(t('insert.left')), fc = mk(t('insert.center')), fr = mk(t('insert.right'));
  const size = el('input', { class: 'input', type: 'number', value: 9, min: 5, max: 40 });
  const margin = el('input', { class: 'input', type: 'number', value: 10, min: 2, max: 60 });
  const fonts = select(textFonts().map((f) => ({ value: f.family, label: f.family })), App.defaults.text.font);
  const range = pageRange(d, { label: t('insert.hfPages') });

  // İsteğe bağlı görsel (logo / QR kod) — her sayfada aynı köşeye
  let imgAsset = null;
  const imgPos = select([
    { value: 'tr', label: t('insert.hfTr') }, { value: 'tl', label: t('insert.hfTl') }, { value: 'tc', label: t('insert.hfTc') },
    { value: 'br', label: t('insert.hfBr') }, { value: 'bl', label: t('insert.hfBl') }, { value: 'bc', label: t('insert.hfBc') },
  ], 'tr');
  const imgH = el('input', { class: 'input', type: 'number', value: 18, min: 5, max: 80 });
  const imgPrev = el('div', { class: 'hf-img-prev', text: t('insert.noImage') });
  const pickImg = el('button', { class: 'btn small', html: `${icon('image-plus')}${t('insert.pickImg')}` });
  const clearImg = el('button', { class: 'btn small', text: t('insert.remove'), hidden: true });
  pickImg.onclick = async () => {
    const files = await window.pu.openFilesDialog({ title: t('insert.hfPickTitle'), multi: false, filters: [{ name: t('insert.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
    if (!files.length) return;
    const f = files[0];
    const mime = /png$/i.test(f.name) ? 'image/png' : 'image/jpeg';
    const dataURL = await blobToDataURL(new Blob([f.bytes], { type: mime }));
    const prep = await prepareImage(dataURL, 1200);
    imgAsset = prep;
    imgPrev.replaceChildren(el('img', { src: prep.dataURL }));
    clearImg.hidden = false;
  };
  clearImg.onclick = () => { imgAsset = null; imgPrev.replaceChildren(document.createTextNode(t('insert.noImage'))); clearImg.hidden = true; };

  const res = await modal({
    title: t('insert.hfTitle'), width: 660,
    body: el('div', {},
      infoBox('panel-top', t('insert.whatFor'), t('insert.hfInfo')),
      el('div', { class: 'field-label', text: t('insert.hfHeader') }), el('div', { class: 'row', style: { marginBottom: '10px' } }, hl, hc, hr),
      el('div', { class: 'field-label', text: t('insert.hfFooter') }), el('div', { class: 'row', style: { marginBottom: '10px' } }, fl, fc, fr),
      el('div', { class: 'row' }, field(t('insert.font'), fonts), field(t('insert.fontSize'), size), field(t('insert.marginMm'), margin)),
      el('div', { class: 'hf-img-row' },
        el('div', { style: { flex: 1 } }, el('div', { class: 'field-label', text: t('insert.hfImage') }), el('div', { class: 'row' }, pickImg, clearImg),
          el('div', { class: 'row', style: { marginTop: '8px' } }, field(t('insert.position'), imgPos), field(t('insert.heightMm'), imgH))),
        imgPrev),
      range.node),
    buttons: [{ label: t('common.cancel') }, { label: t('insert.add'), primary: true, run: () => {
      if (!hl.value && !hc.value && !hr.value && !fl.value && !fc.value && !fr.value && !imgAsset) { toast(t('insert.hfNeed'), { type: 'warn' }); return false; }
      try { range.pages(); return true; } catch (e) { toast(e.message, { type: 'warn' }); return false; }
    } }],
  });
  if (!res) return;
  const list = range.pages();
  const m = ((+margin.value || 10) / 25.4) * 72;
  const sz = +size.value || 9;
  const today = new Date().toLocaleDateString(locale());
  // Türkçe kısaltmalar ({sayfa}...) korunur; İngilizce karşılıkları ({page}...) da çalışır
  const fill = (str, p) => str.replace(/\{(?:sayfa|page)\}/g, p + 1).replace(/\{(?:toplam|total)\}/g, d.numPages).replace(/\{(?:tarih|date)\}/g, today).replace(/\{(?:dosya|file)\}/g, d.name);
  const assetId = imgAsset ? d.addAsset(imgAsset.dataURL, imgAsset.w, imgAsset.h) : null;
  const imgHeightPt = ((+imgH.value || 18) / 25.4) * 72;
  d.snapshot(t('insert.hfLabel'));
  removeGroup(d, 'headerfooter');
  for (const p of list) {
    const dims = pageDims(d, p);
    const add = (val, align, top) => {
      if (!val.trim()) return;
      const w = dims.w - 2 * m;
      d.pageObjs[p].push({ id: uid(), group: 'headerfooter', type: 'text', ...App.defaults.text, font: fonts.value, size: sz, bold: false, italic: false, color: '#333333', align, x: m, y: top ? m : dims.h - m - sz * 1.2, w, text: fill(val, p) });
    };
    add(hl.value, 'left', true); add(hc.value, 'center', true); add(hr.value, 'right', true);
    add(fl.value, 'left', false); add(fc.value, 'center', false); add(fr.value, 'right', false);
    if (assetId) {
      const ih = imgHeightPt;
      const iw = ih * (imgAsset.w / imgAsset.h);
      const pos = imgPos.value;
      const x = pos[1] === 'l' ? m : pos[1] === 'c' ? (dims.w - iw) / 2 : dims.w - m - iw;
      const y = pos[0] === 't' ? m : dims.h - m - ih;
      d.pageObjs[p].push({ id: uid(), group: 'headerfooter', type: 'image', kind: 'image', assetId, x, y, w: iw, h: ih, opacity: 1 });
    }
  }
  d.layers.forEach((l, i) => l && renderLayer(d, i));
  toast(t('insert.hfAdded', { count: list.length }), { type: 'ok', action: { label: t('insert.undo'), run: () => d.undo() } });
}

// ---------------- sayfa numarası ----------------
export async function pageNumbersDialog(d) {
  const format = select([
    { value: '{n}', label: '1, 2, 3…' }, { value: '{n} / {t}', label: '1 / 10' }, { value: t('insert.fmtPage'), label: t('insert.fmtPageLabel') },
    { value: t('insert.fmtPageOf'), label: t('insert.fmtPageOfLabel') }, { value: '- {n} -', label: '- 1 -' },
  ], '{n} / {t}');
  const pos = select([
    { value: 'bc', label: t('insert.pnBc') }, { value: 'br', label: t('insert.pnBr') }, { value: 'bl', label: t('insert.pnBl') },
    { value: 'tc', label: t('insert.pnTc') }, { value: 'tr', label: t('insert.pnTr') }, { value: 'tl', label: t('insert.pnTl') },
  ], 'bc');
  const start = el('input', { class: 'input', type: 'number', value: 1 });
  const size = el('input', { class: 'input', type: 'number', value: 10, min: 5, max: 40 });
  const skipFirst = el('input', { type: 'checkbox' });
  const range = pageRange(d, { label: t('insert.pnPages') });
  const res = await modal({
    title: t('insert.pnTitle'), width: 560,
    body: el('div', {},
      infoBox('list-ordered', null, t('insert.pnInfo')),
      el('div', { class: 'row' }, field(t('insert.format'), format), field(t('insert.position'), pos)),
      el('div', { class: 'row' }, field(t('insert.startNo'), start), field(t('insert.fontSize'), size)),
      range.node,
      el('label', { class: 'checkline' }, skipFirst, t('insert.skipFirst'))),
    buttons: [{ label: t('common.cancel') }, { label: t('insert.add'), primary: true, run: () => { try { range.pages(); return true; } catch (e) { toast(e.message, { type: 'warn' }); return false; } } }],
  });
  if (!res) return;
  let list = range.pages();
  if (skipFirst.checked) list = list.filter((p) => p !== 0);
  const sz = +size.value || 10;
  const st = +start.value || 1;
  const total = list.length + st - 1;
  const m = 28;
  d.snapshot(t('insert.pnLabel'));
  removeGroup(d, 'pagenum');
  list.forEach((p, k) => {
    const dims = pageDims(d, p);
    const text = format.value.replace('{n}', k + st).replace('{t}', total);
    const align = { c: 'center', r: 'right', l: 'left' }[pos.value[1]];
    const top = pos.value[0] === 't';
    d.pageObjs[p].push({ id: uid(), group: 'pagenum', type: 'text', ...App.defaults.text, size: sz, bold: false, italic: false, color: '#333333', align, x: m, w: dims.w - 2 * m, y: top ? m * 0.7 : dims.h - m * 0.7 - sz * 1.2, text });
  });
  d.layers.forEach((l, i) => l && renderLayer(d, i));
  toast(t('insert.pnAdded', { count: list.length }), { type: 'ok', action: { label: t('insert.undo'), run: () => d.undo() } });
}

export { canvasToBlob };
