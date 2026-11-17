// Düzenlenebilir nesne katmanı: nesneleri çizer, seçim, taşıma, boyutlandırma ve yazı düzenleme.
import { App } from './state.js';
import { el, clamp } from './util.js';
import { fontStack } from './fonts.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { SYMBOL_PATHS, smoothPath, arrowGeometry, lineBox, objBox, translateObj, resizeObj, LINE_HEIGHT } from './shapes.js';

const S = (v) => `calc(var(--total-scale-factor) * ${+(+v).toFixed(3)}px)`;
const SVGNS = 'http://www.w3.org/2000/svg';

let editing = null; // { doc, id, el, before }
let toolHooks = null; // tools.js tarafından atanır
export function setToolHooks(h) { toolHooks = h; }
export const isEditingText = () => !!editing;

// ---------------- çizim ----------------
export function renderLayer(doc, i) {
  const layer = doc.layers[i];
  if (!layer) return;
  const objs = doc.pageObjs[i] || [];
  const keep = editing && editing.doc === doc ? editing.el : null;
  const nodes = [];
  // Örtüler (düzenlenen metnin eski halini kapatan kutular) en altta
  for (const o of objs) {
    if (o.type === 'text' && o.cover) nodes.push(coverEl(o.cover));
  }
  for (const o of objs) {
    if (keep && keep.dataset.id === o.id) { nodes.push(keep); continue; }
    nodes.push(objElement(doc, o));
  }
  const previews = [...layer.querySelectorAll(':scope > .pu-preview')];
  layer.replaceChildren(...nodes, ...previews);
}

function coverEl(c) {
  return el('div', { class: 'pu-cover', style: { left: S(c.x), top: S(c.y), width: S(c.w), height: S(c.h), background: c.color || '#fff' } });
}

function svg(w, h, inner) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('preserveAspectRatio', 'none');
  s.setAttribute('class', 'pu-svg');
  s.innerHTML = inner;
  return s;
}

export function objElement(doc, o) {
  const sel = doc.selection.has(o.id);
  const e = el('div', { class: `pu-obj t-${o.type}${sel ? ' sel' : ''}`, dataset: { id: o.id } });
  const b = objBox(o);
  Object.assign(e.style, { left: S(b.x), top: S(b.y), width: S(b.w) });
  if (o.type !== 'text') e.style.height = S(b.h);
  if (o.opacity != null && o.opacity < 1 && o.type !== 'markup') e.style.opacity = o.opacity;
  switch (o.type) {
    case 'text': {
      const t = el('div', { class: 'pu-text' });
      t.textContent = o.text || '';
      Object.assign(t.style, {
        fontFamily: fontStack(o.font),
        fontSize: S(o.size),
        fontWeight: o.bold ? 'bold' : 'normal',
        fontStyle: o.italic ? 'italic' : 'normal',
        color: o.color,
        textAlign: o.align || 'left',
        lineHeight: String(LINE_HEIGHT),
        background: o.bg || 'transparent',
      });
      e.append(t);
      break;
    }
    case 'image': {
      const a = doc.assets.get(o.assetId);
      const img = el('img', { src: a ? a.dataURL : '', draggable: 'false', alt: '' });
      e.append(img);
      break;
    }
    case 'rect': {
      const sw = o.sw || 0;
      e.append(svg(o.w, o.h, `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, o.w - sw)}" height="${Math.max(0, o.h - sw)}" fill="${o.fill || 'none'}" stroke="${sw ? o.color : 'none'}" stroke-width="${sw}"/>`));
      break;
    }
    case 'ellipse': {
      const sw = o.sw || 0;
      e.append(svg(o.w, o.h, `<ellipse cx="${o.w / 2}" cy="${o.h / 2}" rx="${Math.max(0, (o.w - sw) / 2)}" ry="${Math.max(0, (o.h - sw) / 2)}" fill="${o.fill || 'none'}" stroke="${sw ? o.color : 'none'}" stroke-width="${sw}"/>`));
      break;
    }
    case 'line':
    case 'arrow': {
      const x1 = o.x1 - b.x, y1 = o.y1 - b.y, x2 = o.x2 - b.x, y2 = o.y2 - b.y;
      let inner;
      if (o.type === 'arrow') {
        const g = arrowGeometry(x1, y1, x2, y2, o.sw);
        inner = `<line x1="${x1}" y1="${y1}" x2="${g.lineEnd[0]}" y2="${g.lineEnd[1]}" stroke="${o.color}" stroke-width="${o.sw}" stroke-linecap="round"/><polygon points="${g.head.join(' ')}" fill="${o.color}"/>`;
      } else {
        inner = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.color}" stroke-width="${o.sw}" stroke-linecap="round"/>`;
      }
      e.append(svg(b.w, b.h, inner));
      break;
    }
    case 'ink': {
      const paths = o.paths.map((p) => `<path d="${smoothPath(p.map((v, k) => v - (k % 2 ? o.y : o.x)))}" fill="none" stroke="${o.color}" stroke-width="${o.sw}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      e.append(svg(o.w, o.h, paths));
      break;
    }
    case 'markup': {
      for (const r of o.rects) {
        const d = el('div', { class: `pu-mk ${o.kind}` });
        let top = r.y - o.y, h = r.h;
        if (o.kind === 'underline') { top = r.y - o.y + r.h * 0.9; h = Math.max(0.8, r.h * 0.08); }
        if (o.kind === 'strike') { top = r.y - o.y + r.h * 0.52; h = Math.max(0.8, r.h * 0.08); }
        Object.assign(d.style, { left: S(r.x - o.x), top: S(top), width: S(r.w), height: S(h), background: o.color, opacity: o.opacity ?? 1 });
        e.append(d);
      }
      break;
    }
    case 'whiteout':
      e.style.background = o.color || '#fff';
      break;
    case 'redact':
      e.append(el('div', { class: 'pu-redact-fill' }));
      break;
    case 'symbol': {
      const sw = 0.12;
      const inner = o.kind === 'dot'
        ? `<circle cx="0.5" cy="0.5" r="0.32" fill="${o.color}"/>`
        : `<path d="${SYMBOL_PATHS[o.kind]}" fill="none" stroke="${o.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
      const s = svg(1, 1, inner);
      e.append(s);
      break;
    }
    case 'note': {
      const n = el('div', { class: 'pu-note', html: icon('sticky-note'), title: o.text || '' });
      n.style.background = o.color || '#ffd54f';
      e.append(n);
      break;
    }
    default:
      break;
  }
  if (sel) e.append(handlesFor(o));
  return e;
}

function handlesFor(o) {
  const wrap = el('div', { class: 'pu-handles' });
  if (o.type === 'line' || o.type === 'arrow') {
    const b = lineBox(o);
    for (const [k, x, y] of [['p1', o.x1 - b.x, o.y1 - b.y], ['p2', o.x2 - b.x, o.y2 - b.y]]) {
      wrap.append(el('div', { class: 'pu-handle pt', dataset: { h: k }, style: { left: S(x), top: S(y) } }));
    }
    return wrap;
  }
  if (o.type === 'markup' || o.type === 'note') return wrap;
  const hs = o.type === 'text' ? ['w', 'e'] : o.type === 'symbol' ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  for (const h of hs) wrap.append(el('div', { class: `pu-handle ${h}`, dataset: { h } }));
  return wrap;
}

// ---------------- koordinat yardımcıları ----------------
export function pageDims(doc, i) {
  const pv = doc.viewer.getPageView(i);
  const vp = pv.viewport;
  return { w: vp.width / vp.scale, h: vp.height / vp.scale };
}

export function eventToPage(doc, e, i) {
  const layer = doc.layers[i] || doc.viewer.getPageView(i).div;
  const r = layer.getBoundingClientRect();
  const d = pageDims(doc, i);
  return { x: ((e.clientX - r.left) * d.w) / r.width, y: ((e.clientY - r.top) * d.h) / r.height, k: d.w / r.width, dims: d };
}

export function pageIndexFromTarget(t) {
  const p = t?.closest?.('.page');
  if (!p) return -1;
  return parseInt(p.dataset.pageNumber, 10) - 1;
}

// ---------------- metin düzenleme ----------------
export function startTextEdit(doc, id, { selectAll = true } = {}) {
  finishTextEdit();
  const f = doc.findObj(id);
  if (!f || f.obj.type !== 'text') return;
  const layer = doc.layers[f.page];
  const node = layer?.querySelector(`.pu-obj[data-id="${id}"]`);
  if (!node) return;
  const t = node.querySelector('.pu-text');
  t.contentEditable = 'plaintext-only';
  node.classList.add('editing');
  editing = { doc, id, el: node, before: f.obj.text, page: f.page };
  t.focus();
  const range = document.createRange();
  range.selectNodeContents(t);
  if (!selectAll) range.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(range);
  t.addEventListener('blur', onEditBlur);
  t.addEventListener('keydown', onEditKey);
  t.addEventListener('input', onEditInput);
}

function onEditInput() {
  if (!editing) return;
  const f = editing.doc.findObj(editing.id);
  if (f) f.obj.text = editing.el.querySelector('.pu-text').innerText.replace(/\n$/, '');
  App.emit('text:input', editing.doc);
}
function onEditKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
  // Uygulama kısayolları (kaydet, kapat, aç, ara, yazdır, sekme, yakınlaştırma, F4/F5) genel dinleyiciye ulaşsın;
  // Ctrl+Z/Y/A/C/X/V ve diğer tuşlar düzenleyicide kalır
  const ctrl = e.ctrlKey || e.metaKey;
  if ((ctrl && ['s', 'w', 'o', 'f', 'p', 'tab', '=', '+', '-', '0'].includes(e.key.toLowerCase())) || e.key === 'F4' || e.key === 'F5') return;
  e.stopPropagation();
}
function onEditBlur() {
  setTimeout(() => { if (editing && document.activeElement !== editing.el.querySelector('.pu-text')) finishTextEdit(); }, 0);
}

export function finishTextEdit() {
  if (!editing) return;
  const { doc, id, el: node, before, page } = editing;
  const tx = node.querySelector('.pu-text');
  tx.removeEventListener('blur', onEditBlur);
  tx.removeEventListener('keydown', onEditKey);
  tx.removeEventListener('input', onEditInput);
  tx.contentEditable = 'false';
  node.classList.remove('editing');
  editing = null;
  const f = doc.findObj(id);
  if (!f) return;
  const text = tx.innerText.replace(/\n$/, '');
  if (!text.trim() && !f.obj.cover) {
    // boş metin kutusu: sil (geri alma kaydı olmadan, oluşturma kaydı zaten var)
    doc.pageObjs[f.page] = doc.pageObjs[f.page].filter((o) => o.id !== id);
    doc.selection.delete(id);
    renderLayer(doc, page);
    App.emit('selection', doc);
    return;
  }
  if (text !== before) {
    f.obj.text = before;
    doc.snapshot(t('tools.edittext'));
    f.obj.text = text;
  }
  renderLayer(doc, f.page);
}

// ---------------- etkileşim ----------------
export function attachLayerEvents(doc) {
  const c = doc.container;

  c.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const tool = toolHooks?.current();
    if (App.tool === 'hand') return toolHooks.handDown(doc, e);
    const handle = e.target.closest('.pu-handle');
    const objEl = e.target.closest('.pu-obj');
    const i = pageIndexFromTarget(e.target);
    if (editing && objEl && objEl === editing.el) return; // düzenleme içinde tıklama
    if (editing) finishTextEdit();
    if (handle && objEl) {
      e.preventDefault();
      return startResize(doc, objEl.dataset.id, handle.dataset.h, e);
    }
    if (objEl && (!tool?.layer || doc.selection.has(objEl.dataset.id) || tool?.selectsObjects)) {
      e.preventDefault();
      const id = objEl.dataset.id;
      if (e.shiftKey) {
        const s = new Set(doc.selection);
        s.has(id) ? s.delete(id) : s.add(id);
        doc.setSelection([...s]);
        return;
      }
      if (!doc.selection.has(id)) doc.setSelection([id]);
      return startMove(doc, e);
    }
    if (i >= 0 && tool?.layer && e.target.closest('.pu-layer, .page')) {
      e.preventDefault();
      if (doc.selection.size) doc.setSelection([]);
      return toolHooks.toolDown(doc, i, e);
    }
    if (doc.selection.size && !e.shiftKey) doc.setSelection([]);
  });

  c.addEventListener('dblclick', (e) => {
    const objEl = e.target.closest('.pu-obj');
    if (!objEl) return;
    const f = doc.findObj(objEl.dataset.id);
    if (!f) return;
    if (f.obj.type === 'text') startTextEdit(doc, f.obj.id, { selectAll: false });
    else if (f.obj.type === 'note') toolHooks?.editNote(doc, f.obj);
  });
}

function startMove(doc, e) {
  const sel = doc.selectedObjs();
  if (!sel.length) return;
  const i0 = sel[0].page;
  const start = eventToPage(doc, e, i0);
  const orig = sel.map((s) => ({ id: s.obj.id, page: s.page, json: JSON.parse(JSON.stringify(s.obj)) }));
  let moved = false;
  let snap = false;
  const onMove = (ev) => {
    const p = eventToPage(doc, ev, i0);
    let dx = p.x - start.x, dy = p.y - start.y;
    if (!moved && Math.hypot(dx / start.k, dy / start.k) < 3) return;
    if (!snap) { doc.snapshot(t('overlay.move')); snap = true; }
    moved = true;
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    for (const o of orig) {
      const f = doc.findObj(o.id);
      if (!f) continue;
      const fresh = JSON.parse(JSON.stringify(o.json));
      translateObj(fresh, dx, dy);
      // sayfa dışına taşmasın
      const d = pageDims(doc, f.page);
      const b = objBox(fresh);
      const cx = clamp(b.x, -b.w + 10, d.w - 10) - b.x;
      const cy = clamp(b.y, -b.h + 10, d.h - 10) - b.y;
      if (cx || cy) translateObj(fresh, cx, cy);
      Object.assign(f.obj, fresh);
      updateObjPosition(doc, f.page, f.obj);
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) {
      const pages = new Set(orig.map((o) => o.page));
      pages.forEach((p) => renderLayer(doc, p));
      App.emit('selection', doc);
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function updateObjPosition(doc, page, o) {
  const node = doc.layers[page]?.querySelector(`.pu-obj[data-id="${o.id}"]`);
  if (!node) return;
  const b = objBox(o);
  node.style.left = S(b.x);
  node.style.top = S(b.y);
}

function startResize(doc, id, h, e) {
  const f = doc.findObj(id);
  if (!f) return;
  const o = f.obj;
  const start = eventToPage(doc, e, f.page);
  const orig = JSON.parse(JSON.stringify(o));
  const keepRatio = o.type === 'image' || o.type === 'symbol';
  let snap = false;
  const onMove = (ev) => {
    const p = eventToPage(doc, ev, f.page);
    const dx = p.x - start.x, dy = p.y - start.y;
    if (!snap) { doc.snapshot(t('overlay.resize')); snap = true; }
    if (h === 'p1' || h === 'p2') {
      o[h === 'p1' ? 'x1' : 'x2'] = orig[h === 'p1' ? 'x1' : 'x2'] + dx;
      o[h === 'p1' ? 'y1' : 'y2'] = orig[h === 'p1' ? 'y1' : 'y2'] + dy;
      renderLayer(doc, f.page);
      return;
    }
    let { x, y, w, h: hh } = orig;
    if (h.includes('e')) w = orig.w + dx;
    if (h.includes('s')) hh = orig.h + dy;
    if (h.includes('w')) { w = orig.w - dx; x = orig.x + dx; }
    if (h.includes('n')) { hh = orig.h - dy; y = orig.y + dy; }
    const minS = 4;
    if (keepRatio && h.length === 2 && !ev.shiftKey) {
      const ratio = orig.w / orig.h;
      if (Math.abs(w / orig.w) > Math.abs(hh / orig.h)) hh = w / ratio; else w = hh * ratio;
      if (h.includes('w')) x = orig.x + orig.w - w;
      if (h.includes('n')) y = orig.y + orig.h - hh;
    }
    if (w < minS) { if (h.includes('w')) x -= minS - w; w = minS; }
    if (hh < minS) { if (h.includes('n')) y -= minS - hh; hh = minS; }
    resizeObj(o, { x, y, w, h: hh }, orig);
    renderLayer(doc, f.page);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    App.emit('selection', doc);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Seçili nesneleri klavyeyle kaydır
export function nudgeSelection(doc, dx, dy) {
  const sel = doc.selectedObjs();
  if (!sel.length) return;
  doc.snapshot(t('overlay.nudge'));
  const pages = new Set();
  for (const s of sel) { translateObj(s.obj, dx, dy); pages.add(s.page); }
  pages.forEach((p) => renderLayer(doc, p));
}

// Önizleme öğesi (sürüklerken)
export function preview(doc, i, cls = '') {
  const layer = doc.layers[i];
  const p = el('div', { class: `pu-preview ${cls}` });
  layer.append(p);
  return {
    el: p,
    box(x, y, w, h) { Object.assign(p.style, { left: S(x), top: S(y), width: S(w), height: S(h) }); },
    svg(w, h, inner) { p.replaceChildren(svg(w, h, inner)); },
    remove() { p.remove(); },
  };
}
export { S };
