// Araçlar: yazı, kalem, şekiller, vurgulama, beyaz kalem, karartma, not, işaretler, yerleştirme, alan seçimleri.
import { App } from './state.js';
import { $, $$, el, toast, modal, uid } from './util.js';
import { getPdfjs } from './pdfcore.js';
import { guessFamily, fontStack, ensureLoaded } from './fonts.js';
import { renderLayer, eventToPage, pageDims, preview, startTextEdit, setToolHooks, finishTextEdit, S } from './overlay.js';
import { smoothPath, simplify, pointsBox, rectsBox, arrowGeometry, baselineRatio } from './shapes.js';
import { t } from './i18n.js';

export const TOOLS = {
  select: { get label() { return t('tools.select'); }, get hint() { return t('tools.selectHint'); } },
  hand: { get label() { return t('tools.hand'); }, get hint() { return t('tools.handHint'); } },
  text: { get label() { return t('tools.text'); }, layer: true, get hint() { return t('tools.textHint'); }, cursor: 'text' },
  edittext: { get label() { return t('tools.edittext'); }, layer: true, sticky: true, get hint() { return t('tools.edittextHint'); }, cursor: 'text' },
  highlight: { get label() { return t('tools.highlight'); }, sticky: true, markup: 'highlight', get hint() { return t('tools.highlightHint'); } },
  underline: { get label() { return t('tools.underline'); }, sticky: true, markup: 'underline', get hint() { return t('tools.underlineHint'); } },
  strike: { get label() { return t('tools.strike'); }, sticky: true, markup: 'strike', get hint() { return t('tools.strikeHint'); } },
  areahl: { get label() { return t('tools.areahl'); }, layer: true, sticky: true, get hint() { return t('tools.areahlHint'); } },
  ink: { get label() { return t('tools.ink'); }, layer: true, sticky: true, get hint() { return t('tools.inkHint'); }, cursor: 'crosshair' },
  line: { get label() { return t('tools.line'); }, layer: true, sticky: true, get hint() { return t('tools.lineHint'); } },
  arrow: { get label() { return t('tools.arrow'); }, layer: true, sticky: true, get hint() { return t('tools.arrowHint'); } },
  rect: { get label() { return t('tools.rect'); }, layer: true, sticky: true, get hint() { return t('tools.rectHint'); } },
  ellipse: { get label() { return t('tools.ellipse'); }, layer: true, sticky: true, get hint() { return t('tools.ellipseHint'); } },
  whiteout: { get label() { return t('tools.whiteout'); }, layer: true, sticky: true, get hint() { return t('tools.whiteoutHint'); } },
  redact: { get label() { return t('tools.redact'); }, layer: true, sticky: true, get hint() { return t('tools.redactHint'); } },
  note: { get label() { return t('tools.note'); }, layer: true, get hint() { return t('tools.noteHint'); } },
  check: { get label() { return t('tools.check'); }, layer: true, sticky: true, symbol: 'check', get hint() { return t('tools.checkHint'); } },
  cross: { get label() { return t('tools.cross'); }, layer: true, sticky: true, symbol: 'cross', get hint() { return t('tools.crossHint'); } },
  dot: { get label() { return t('tools.dot'); }, layer: true, sticky: true, symbol: 'dot', get hint() { return t('tools.dotHint'); } },
  place: { get label() { return t('tools.place'); }, layer: true, get hint() { return t('tools.placeHint'); }, cursor: 'copy' },
  snapshot: { get label() { return t('tools.snapshot'); }, layer: true, sticky: false, get hint() { return t('tools.snapshotHint'); }, cursor: 'crosshair' },
  ocrregion: { get label() { return t('tools.ocrregion'); }, layer: true, get hint() { return t('tools.ocrregionHint'); }, cursor: 'crosshair' },
  crop: { get label() { return t('tools.crop'); }, layer: true, get hint() { return t('tools.cropHint'); }, cursor: 'crosshair' },
};

export function setTool(name, opts = {}) {
  if (!TOOLS[name]) name = 'select';
  finishTextEdit();
  if (name !== 'place') App.pendingPlace = null;
  if (opts.place) App.pendingPlace = opts.place;
  App.tool = name;
  const t = TOOLS[name];
  document.body.dataset.tool = name;
  document.body.classList.toggle('tool-layer', !!t.layer);
  document.body.classList.toggle('tool-markup', !!t.markup);
  App.emit('tool', name);
}

const current = () => TOOLS[App.tool];

function afterCreate() {
  if (!current()?.sticky) setTool('select');
}

// ---------------- sürükleme yardımcı ----------------
function drag(doc, i, e, { onMove, onUp }) {
  const start = eventToPage(doc, e, i);
  const layer = doc.layers[i];
  layer.setPointerCapture?.(e.pointerId);
  const move = (ev) => {
    const p = eventToPage(doc, ev, i);
    p.x = Math.max(0, Math.min(p.dims.w, p.x));
    p.y = Math.max(0, Math.min(p.dims.h, p.y));
    onMove && onMove(p, start, ev);
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const p = eventToPage(doc, ev, i);
    p.x = Math.max(0, Math.min(p.dims.w, p.x));
    p.y = Math.max(0, Math.min(p.dims.h, p.y));
    onUp && onUp(p, start, ev);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  return start;
}

function rectFrom(a, b, square = false) {
  let w = b.x - a.x, h = b.y - a.y;
  if (square) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
  return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) };
}

// Sürükleyerek alan seç (genel)
export function dragRect(doc, i, e, cls, cb, { minSize = 3 } = {}) {
  const pv = preview(doc, i, cls);
  drag(doc, i, e, {
    onMove: (p, s, ev) => { const r = rectFrom(s, p, ev.shiftKey && cls.includes('square')); pv.box(r.x, r.y, r.w, r.h); },
    onUp: (p, s, ev) => {
      pv.remove();
      const r = rectFrom(s, p, ev.shiftKey && cls.includes('square'));
      cb(r, r.w < minSize && r.h < minSize, s);
    },
  });
}

// ---------------- araç işlemleri ----------------
function toolDown(doc, i, e) {
  const name = App.tool;
  const d = App.defaults;
  switch (name) {
    case 'text': {
      const p = eventToPage(doc, e, i);
      const o = { type: 'text', ...d.text, x: p.x, y: p.y - d.text.size * 0.6, w: Math.min(220, pageDims(doc, i).w - p.x - 4), text: '' };
      o.w = Math.max(40, o.w);
      doc.addObj(i, o, { label: t('tools.text') });
      setTool('select');
      requestAnimationFrame(() => startTextEdit(doc, o.id));
      return;
    }
    case 'edittext':
      return editExistingText(doc, i, e);
    case 'ink':
      return drawInk(doc, i, e);
    case 'line':
    case 'arrow': {
      const pv = preview(doc, i, 'line');
      const opts = d.shape;
      drag(doc, i, e, {
        onMove: (p, s, ev) => {
          const q = snap45(s, p, ev.shiftKey);
          const bx = Math.min(s.x, q.x) - 20, by = Math.min(s.y, q.y) - 20;
          const w = Math.abs(q.x - s.x) + 40, h = Math.abs(q.y - s.y) + 40;
          pv.box(bx, by, w, h);
          let inner = `<line x1="${s.x - bx}" y1="${s.y - by}" x2="${q.x - bx}" y2="${q.y - by}" stroke="${opts.color}" stroke-width="${opts.sw}" stroke-linecap="round"/>`;
          if (name === 'arrow') {
            const g = arrowGeometry(s.x - bx, s.y - by, q.x - bx, q.y - by, opts.sw);
            inner = `<line x1="${s.x - bx}" y1="${s.y - by}" x2="${g.lineEnd[0]}" y2="${g.lineEnd[1]}" stroke="${opts.color}" stroke-width="${opts.sw}" stroke-linecap="round"/><polygon points="${g.head.join(' ')}" fill="${opts.color}"/>`;
          }
          pv.svg(w, h, inner);
        },
        onUp: (p, s, ev) => {
          pv.remove();
          const q = snap45(s, p, ev.shiftKey);
          if (Math.hypot(q.x - s.x, q.y - s.y) < 3) return;
          doc.addObj(i, { type: name, x1: s.x, y1: s.y, x2: q.x, y2: q.y, color: opts.color, sw: opts.sw, opacity: opts.opacity }, { label: name === 'arrow' ? t('tools.drawArrow') : t('tools.drawLine') });
          afterCreate();
        },
      });
      return;
    }
    case 'rect':
    case 'ellipse': {
      const opts = d.shape;
      const pv = preview(doc, i, `shape square ${name}`);
      drag(doc, i, e, {
        onMove: (p, s, ev) => {
          const r = rectFrom(s, p, ev.shiftKey);
          pv.box(r.x, r.y, r.w, r.h);
          const sw = opts.sw;
          pv.svg(r.w || 1, r.h || 1, name === 'rect'
            ? `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, r.w - sw)}" height="${Math.max(0, r.h - sw)}" fill="${opts.fill || 'none'}" stroke="${opts.color}" stroke-width="${sw}"/>`
            : `<ellipse cx="${r.w / 2}" cy="${r.h / 2}" rx="${Math.max(0, (r.w - sw) / 2)}" ry="${Math.max(0, (r.h - sw) / 2)}" fill="${opts.fill || 'none'}" stroke="${opts.color}" stroke-width="${sw}"/>`);
        },
        onUp: (p, s, ev) => {
          pv.remove();
          const r = rectFrom(s, p, ev.shiftKey);
          if (r.w < 3 || r.h < 3) return;
          doc.addObj(i, { type: name, ...r, color: opts.color, fill: opts.fill, sw: opts.sw, opacity: opts.opacity }, { label: name === 'rect' ? t('tools.rect') : t('tools.ellipse') });
          afterCreate();
        },
      });
      return;
    }
    case 'areahl':
      return dragRect(doc, i, e, 'hl', (r, tiny) => {
        if (tiny) return;
        doc.addObj(i, { type: 'markup', kind: 'highlight', ...r, rects: [r], color: d.highlight.color, opacity: d.highlight.opacity }, { label: t('tools.areahl') });
        afterCreate();
      });
    case 'whiteout':
      return dragRect(doc, i, e, 'whiteout', (r, tiny) => {
        if (tiny) return;
        doc.addObj(i, { type: 'whiteout', ...r, color: d.whiteout.color }, { label: t('tools.whiteout') });
        afterCreate();
      });
    case 'redact':
      return dragRect(doc, i, e, 'redact', (r, tiny) => {
        if (tiny) return;
        doc.addObj(i, { type: 'redact', ...r }, { label: t('tools.redact') });
        afterCreate();
      });
    case 'note': {
      const p = eventToPage(doc, e, i);
      const o = { type: 'note', x: p.x - 10, y: p.y - 10, w: 20, h: 20, text: '', color: d.note.color };
      editNote(doc, o, true).then((ok) => {
        if (ok) doc.addObj(i, o, { label: t('tools.addNote') });
        afterCreate();
      });
      return;
    }
    case 'check':
    case 'cross':
    case 'dot': {
      const p = eventToPage(doc, e, i);
      const s = App.defaults.symbol.size || 14;
      doc.addObj(i, { type: 'symbol', kind: TOOLS[name].symbol, x: p.x - s / 2, y: p.y - s / 2, w: s, h: s, color: d.symbol.color }, { label: t('tools.putSymbol'), select: false });
      return;
    }
    case 'place':
      return placeAsset(doc, i, e);
    case 'snapshot':
      return dragRect(doc, i, e, 'snap', (r, tiny) => {
        setTool('select');
        if (!tiny) App.emit('region:snapshot', doc, i, r);
      });
    case 'ocrregion':
      return dragRect(doc, i, e, 'snap', (r, tiny) => {
        setTool('select');
        if (!tiny) App.emit('region:ocr', doc, i, r);
      });
    case 'crop':
      return dragRect(doc, i, e, 'crop', (r, tiny) => {
        setTool('select');
        if (!tiny) App.emit('region:crop', doc, i, r);
      });
    default:
      return undefined;
  }
}

function snap45(s, p, on) {
  if (!on) return p;
  const ang = Math.atan2(p.y - s.y, p.x - s.x);
  const step = Math.PI / 4;
  const a = Math.round(ang / step) * step;
  const len = Math.hypot(p.x - s.x, p.y - s.y);
  return { x: s.x + Math.cos(a) * len, y: s.y + Math.sin(a) * len };
}

function drawInk(doc, i, e) {
  const opts = App.defaults.ink;
  const pv = preview(doc, i, 'ink');
  const d = pageDims(doc, i);
  pv.box(0, 0, d.w, d.h);
  const pts = [];
  const pathEl = () => `<path d="${smoothPath(pts)}" fill="none" stroke="${opts.color}" stroke-width="${opts.sw}" stroke-linecap="round" stroke-linejoin="round" opacity="${opts.opacity}"/>`;
  const s0 = eventToPage(doc, e, i);
  pts.push(s0.x, s0.y);
  drag(doc, i, e, {
    onMove: (p, s, ev) => {
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const ce of evs) { const q = eventToPage(doc, ce, i); pts.push(q.x, q.y); }
      pv.svg(d.w, d.h, pathEl());
    },
    onUp: () => {
      pv.remove();
      const simp = simplify(pts, 0.5);
      const paths = [simp];
      const box = pointsBox(paths, opts.sw);
      // Aynı çizim oturumunda son mürekkebe yakın ise birleştir (tek imza gibi davranır)
      const last = doc.pageObjs[i][doc.pageObjs[i].length - 1];
      const now = Date.now();
      if (last && last.type === 'ink' && last._t && now - last._t < 1200 && last.color === opts.color && last.sw === opts.sw) {
        doc.snapshot(t('tools.ink'));
        last.paths.push(simp);
        Object.assign(last, pointsBox(last.paths, last.sw));
        last._t = now;
        renderLayer(doc, i);
        return;
      }
      doc.addObj(i, { type: 'ink', paths, ...box, color: opts.color, sw: opts.sw, opacity: opts.opacity, _t: now }, { label: t('tools.ink'), select: false });
    },
  });
}

async function placeAsset(doc, i, e) {
  const pend = App.pendingPlace;
  if (!pend) { setTool('select'); return; }
  const { assetId, w: aw, h: ah } = pend;
  const ratio = aw / ah;
  // Görsel bu belgeye ait değilse (ör. başka sekmede hazırlanmış) yerleştirme modundan çık; önizleme sızmasın
  const a = doc.assets.get(assetId);
  if (!a) { setTool('select'); return; }
  const pv = preview(doc, i, 'place');
  pv.el.append(el('img', { src: a.dataURL, style: { width: '100%', height: '100%', opacity: '0.7' } }));
  // Fare hareket edene kadar görünmesin (sol üst köşede hayalet görünmesin)
  pv.el.style.display = 'none';
  drag(doc, i, e, {
    onMove: (p, s) => {
      const w = Math.max(10, Math.abs(p.x - s.x));
      const r = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w, h: w / ratio };
      if (w > 8) { pv.el.style.display = ''; pv.box(r.x, r.y, r.w, r.h); }
    },
    onUp: (p, s) => {
      pv.remove();
      const dims = pageDims(doc, i);
      let r;
      if (Math.abs(p.x - s.x) < 6) {
        const w = Math.min(pend.defaultW || 160, dims.w * 0.6);
        r = { x: s.x - w / 2, y: s.y - w / ratio / 2, w, h: w / ratio };
      } else {
        const w = Math.abs(p.x - s.x);
        r = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w, h: w / ratio };
      }
      doc.addObj(i, { type: 'image', assetId, ...r, opacity: 1, kind: pend.kind || 'image' }, { label: pend.label || t('tools.addImage') });
      if (!pend.repeat) setTool('select');
    },
  });
}

export async function editNote(doc, o, isNew = false) {
  const ta = el('textarea', { class: 'input', rows: 5, placeholder: t('tools.notePlaceholder') });
  ta.value = o.text || '';
  const colors = ['#ffd54f', '#81c784', '#64b5f6', '#f48fb1', '#ffb74d'];
  let col = o.color;
  const sw = el('div', { class: 'swatches' }, colors.map((c) => {
    const b = el('button', { class: `swatch ${c === col ? 'on' : ''}`, style: { background: c }, onclick: () => { col = c; $$('.swatch', sw).forEach((x) => x.classList.toggle('on', x === b)); } });
    return b;
  }));
  const res = await modal({ title: isNew ? t('tools.addNote') : t('tools.editNote'), body: el('div', {}, ta, sw), buttons: [{ label: t('common.cancel'), value: false }, { label: t('common.save'), primary: true, value: true }] });
  if (!res) return false;
  if (!isNew) doc.snapshot(t('tools.editNote'));
  o.text = ta.value;
  o.color = col;
  if (!isNew) { const f = doc.findObj(o.id); if (f) renderLayer(doc, f.page); }
  return true;
}

// ---------------- mevcut metni düzenleme ----------------
async function editExistingText(doc, i, e) {
  const p = eventToPage(doc, e, i);
  const { Util } = getPdfjs();
  const page = await doc.pdf.getPage(i + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await doc.textContent(i);
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() && !it.width) continue;
    const tx = Util.transform(vp.transform, it.transform);
    const fh = Math.hypot(tx[2], tx[3]);
    const angle = Math.atan2(tx[1], tx[0]);
    if (Math.abs(angle) > 0.02) continue; // döndürülmüş metinleri atla
    const style = tc.styles[it.fontName] || {};
    const asc = style.ascent || 0.8;
    const desc = style.descent ? Math.abs(style.descent) : 0.2;
    items.push({ it, x: tx[4], base: tx[5], top: tx[5] - fh * asc, bottom: tx[5] + fh * desc, w: it.width, fh, style });
  }
  const hit = items.find((t) => p.x >= t.x - 1 && p.x <= t.x + t.w + 1 && p.y >= t.top - 1 && p.y <= t.bottom + 1);
  if (!hit) {
    toast(t('tools.noEditableText'), { type: 'warn', timeout: 5000 });
    return;
  }
  // Aynı satırdaki komşu parçaları birleştir
  const sameLine = items.filter((t) => Math.abs(t.base - hit.base) < hit.fh * 0.35 && Math.abs(t.fh - hit.fh) < hit.fh * 0.3).sort((a, b) => a.x - b.x);
  let group = [hit];
  let left = hit.x, right = hit.x + hit.w;
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of sameLine) {
      if (group.includes(t)) continue;
      const gap = t.x > right ? t.x - right : left - (t.x + t.w);
      if (gap < hit.fh * 1.2) {
        group.push(t); left = Math.min(left, t.x); right = Math.max(right, t.x + t.w); grew = true;
      }
    }
  }
  group.sort((a, b) => a.x - b.x);
  let text = '';
  let prevEnd = null;
  for (const t of group) {
    if (prevEnd != null && t.x - prevEnd > hit.fh * 0.15 && !text.endsWith(' ') && !t.it.str.startsWith(' ')) text += ' ';
    text += t.it.str;
    prevEnd = t.x + t.w;
  }
  text = text.replace(/\s+$/, '');
  const top = Math.min(...group.map((t) => t.top));
  const bottom = Math.max(...group.map((t) => t.bottom));
  const fh = hit.fh;
  // Renkleri render edilmiş sayfadan örnekle
  const { fg, bg } = sampleColors(doc, i, { x: left, y: top, w: right - left, h: bottom - top });
  let fontName = '';
  try {
    const fobj = page.commonObjs.has(hit.it.fontName) ? page.commonObjs.get(hit.it.fontName) : null;
    fontName = fobj?.name || '';
  } catch (err) { /* yoksay */ }
  const family = guessFamily(fontName, hit.style.fontFamily);
  const bold = /bold|black|heavy|semibold|demi/i.test(fontName);
  const italic = /italic|oblique/i.test(fontName);
  await ensureLoaded(family, bold, italic);
  const size = Math.round(fh * 10) / 10;
  const ratio = baselineRatio(fontStack(family), bold, italic);
  const pad = Math.max(1, fh * 0.12);
  const cover = { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2, color: bg };
  const o = {
    type: 'text', text, font: family, size, color: fg, bold, italic, align: 'left',
    x: left, y: hit.base - ratio * size, w: Math.max(right - left + fh * 2, 30), cover,
  };
  doc.addObj(i, o, { label: t('tools.edittext') });
  requestAnimationFrame(() => startTextEdit(doc, o.id, { selectAll: false }));
}

function sampleColors(doc, i, r) {
  const pv = doc.viewer.getPageView(i);
  const canvas = pv?.canvas || pv?.div.querySelector('canvas');
  const res = { fg: '#000000', bg: '#ffffff' };
  if (!canvas || !canvas.width) return res;
  try {
    const d = pageDims(doc, i);
    const kx = canvas.width / d.w, ky = canvas.height / d.h;
    const x0 = Math.max(0, Math.floor((r.x - 2) * kx)), y0 = Math.max(0, Math.floor((r.y - 2) * ky));
    const x1 = Math.min(canvas.width, Math.ceil((r.x + r.w + 2) * kx)), y1 = Math.min(canvas.height, Math.ceil((r.y + r.h + 2) * ky));
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return res;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(x0, y0, w, h).data;
    // arka plan: kenar piksellerinin en sık rengi
    const counts = new Map();
    const push = (k) => {
      const q = ((data[k] >> 3) << 10) | ((data[k + 1] >> 3) << 5) | (data[k + 2] >> 3);
      counts.set(q, (counts.get(q) || 0) + 1);
    };
    for (let x = 0; x < w; x++) { push(x * 4); push(((h - 1) * w + x) * 4); }
    for (let y = 0; y < h; y++) { push((y * w) * 4); push((y * w + w - 1) * 4); }
    let best = 0, bestQ = 0x7fff;
    counts.forEach((c, q) => { if (c > best) { best = c; bestQ = q; } });
    const bgc = [(bestQ >> 10) & 31, (bestQ >> 5) & 31, bestQ & 31].map((v) => (v << 3) | 4);
    // yazı rengi: arka plandan en farklı piksel
    let far = -1, fgc = [0, 0, 0];
    for (let k = 0; k < data.length; k += 4) {
      const dist = Math.abs(data[k] - bgc[0]) + Math.abs(data[k + 1] - bgc[1]) + Math.abs(data[k + 2] - bgc[2]);
      if (dist > far) { far = dist; fgc = [data[k], data[k + 1], data[k + 2]]; }
    }
    const hex = (a) => `#${a.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
    // neredeyse beyaz/siyahı tam değere yuvarla
    const snapc = (a) => (a.every((v) => v > 238) ? [255, 255, 255] : a.every((v) => v < 40) ? [0, 0, 0] : a);
    res.bg = hex(snapc(bgc));
    res.fg = hex(snapc(fgc));
  } catch (err) { /* okunamadı */ }
  return res;
}

// ---------------- el aracı ----------------
function handDown(doc, e) {
  e.preventDefault();
  const c = doc.container;
  const sx = e.clientX, sy = e.clientY, st = c.scrollTop, sl = c.scrollLeft;
  c.classList.add('grabbing');
  const move = (ev) => { c.scrollTop = st - (ev.clientY - sy); c.scrollLeft = sl - (ev.clientX - sx); };
  const up = () => { c.classList.remove('grabbing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ---------------- metin seçimiyle vurgulama ----------------
export function selectionRects(doc) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const byPage = new Map();
  for (let r = 0; r < sel.rangeCount; r++) {
    const range = sel.getRangeAt(r);
    for (const cr of range.getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
      for (let i = 0; i < doc.layers.length; i++) {
        const layer = doc.layers[i];
        if (!layer || !layer.isConnected) continue;
        const lr = layer.getBoundingClientRect();
        if (cx < lr.left || cx > lr.right || cy < lr.top || cy > lr.bottom) continue;
        const d = pageDims(doc, i);
        const k = d.w / lr.width;
        const rect = { x: (cr.left - lr.left) * k, y: (cr.top - lr.top) * k, w: cr.width * k, h: cr.height * k };
        if (!byPage.has(i)) byPage.set(i, []);
        byPage.get(i).push(rect);
        break;
      }
    }
  }
  // Aynı satırdaki örtüşen dikdörtgenleri birleştir
  for (const [i, rects] of byPage) {
    rects.sort((a, b) => a.y - b.y || a.x - b.x);
    const out = [];
    for (const r of rects) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5 && r.x <= last.x + last.w + Math.min(last.h, r.h) * 0.6) {
        const x = Math.min(last.x, r.x), y = Math.min(last.y, r.y);
        last.w = Math.max(last.x + last.w, r.x + r.w) - x;
        last.h = Math.max(last.y + last.h, r.y + r.h) - y;
        last.x = x; last.y = y;
      } else out.push({ ...r });
    }
    byPage.set(i, out.filter((r) => !out.some((o) => o !== r && o.x <= r.x && o.y <= r.y && o.x + o.w >= r.x + r.w && o.y + o.h >= r.y + r.h)));
  }
  return byPage.size ? byPage : null;
}

export function markupFromSelection(doc, kind) {
  const byPage = selectionRects(doc);
  if (!byPage) return false;
  const d = App.defaults[kind];
  let first = true;
  for (const [i, rects] of byPage) {
    const o = { type: 'markup', kind, rects, ...rectsBox(rects), color: d.color, opacity: d.opacity };
    if (first) { doc.addObj(i, o, { label: kind === 'highlight' ? t('tools.highlight') : kind === 'underline' ? t('tools.underline') : t('tools.strike'), select: false }); first = false; } else {
      o.id = uid();
      doc.pageObjs[i].push(o);
      renderLayer(doc, i);
    }
  }
  window.getSelection().removeAllRanges();
  return true;
}

export function initTools() {
  setToolHooks({ current, toolDown, handDown, editNote });
  // İmza/damga/görsel yerleştirme bekleyen görsel belgeye özeldir: sekme değişince bırak
  let lastActive = App.active;
  App.on('active', (d) => {
    if (d !== lastActive && App.tool === 'place') setTool('select');
    lastActive = d;
  });
  document.addEventListener('pointerup', (e) => {
    const tl = current();
    if (!tl?.markup || !App.active) return;
    if (!e.target.closest?.('.viewer-container')) return;
    setTimeout(async () => {
      const d = App.active;
      if (markupFromSelection(d, tl.markup)) return;
      // Seçim oluşmadıysa: sayfada seçilebilir metin var mı?
      const page = d.currentPageIndex;
      const { hasTextLayer, offerOcr } = await import('./assist.js');
      if (await hasTextLayer(d, page)) return; // metin var, kullanıcı henüz seçmemiş
      if (markupNoTextWarned) return;
      markupNoTextWarned = true;
      setTimeout(() => { markupNoTextWarned = false; }, 1500);
      const label = { highlight: t('tools.markHighlight'), underline: t('tools.markUnderline'), strike: t('tools.markStrike') }[tl.markup] || t('tools.markGeneric');
      const done = await offerOcr(d, {
        title: t('tools.ocrFirstTitle', { label }),
        reason: t('tools.ocrFirstReason'),
        pages: [page],
      });
      if (!done) toast(t('tools.areaHint'), { timeout: 7000 });
    }, 0);
  });
  setTool('select');
}
let markupNoTextWarned = false;

export { S };
