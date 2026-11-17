// Seçenek çubuğu: etkin aracın varsayılanları ya da seçili nesnelerin özellikleri.
import { App, saveSetting } from './state.js';
import { $, el, debounce } from './util.js';
import { icon } from './icons.js';
import { textFonts, handFonts } from './fonts.js';
import { TOOLS, setTool } from './tools.js';
import { renderLayer, isEditingText } from './overlay.js';
import { resizeObj } from './shapes.js';
import { t, onLang } from './i18n.js';

const PALETTE = ['#111111', '#d32f2f', '#1d4ed8', '#1b5e20', '#ef6c00', '#6a1b9a', '#ffffff'];
const HL_PALETTE = ['#ffe14d', '#8ef58e', '#7fd6ff', '#ff9ecf', '#ffb45e'];

const defKey = (o) => {
  switch (o.type) {
    case 'text': return 'text';
    case 'ink': return 'ink';
    case 'rect': case 'ellipse': case 'line': case 'arrow': return 'shape';
    case 'markup': return o.kind;
    case 'whiteout': return 'whiteout';
    case 'symbol': return 'symbol';
    case 'note': return 'note';
    default: return null;
  }
};
const toolKey = {
  text: 'text', edittext: 'text', ink: 'ink', line: 'shape', arrow: 'shape', rect: 'shape', ellipse: 'shape',
  highlight: 'highlight', areahl: 'highlight', underline: 'underline', strike: 'strike', whiteout: 'whiteout',
  check: 'symbol', cross: 'symbol', dot: 'symbol', note: 'note',
};

const pct = (v) => t('optbar.percent', { n: Math.round(v * 100) });

const persist = debounce(() => saveSetting({ defaults: App.defaults, textFont: App.defaults.text.font }), 600);

let snapArmed = true;
function applyProp(key, prop, value, { live = false } = {}) {
  if (key && App.defaults[key]) App.defaults[key][prop === 'symbolSize' ? 'size' : prop] = value;
  persist();
  const d = App.active;
  if (!d || !d.selection.size) return;
  const sel = d.selectedObjs().filter((s) => defKey(s.obj) === key || (key === 'markup' && s.obj.type === 'markup'));
  if (!sel.length) return;
  if (snapArmed) { d.snapshot(t('optbar.changeProp')); snapArmed = false; }
  if (!live) snapArmed = true;
  const pages = new Set();
  for (const s of sel) {
    if (prop === 'symbolSize') {
      const c = { x: s.obj.x + s.obj.w / 2, y: s.obj.y + s.obj.h / 2 };
      resizeObj(s.obj, { x: c.x - value / 2, y: c.y - value / 2, w: value, h: value }, { ...s.obj });
    } else s.obj[prop] = value;
    pages.add(s.page);
  }
  pages.forEach((p) => renderLayer(d, p));
}

function colorRow(key, prop, current, palette = PALETTE, { allowNone = false, label } = {}) {
  const wrap = el('div', { class: 'colors' });
  if (label) wrap.append(el('span', { class: 'muted', style: { fontSize: '12px', marginRight: '2px' }, text: label }));
  const set = (v) => {
    applyProp(key, prop, v);
    [...wrap.querySelectorAll('.color-dot')].forEach((b) => b.classList.toggle('on', b.dataset.c === (v || '')));
    pick.value = v || '#ffffff';
  };
  if (allowNone) {
    const b = el('button', { class: `color-dot none ${!current ? 'on' : ''}`, title: t('optbar.none'), dataset: { c: '' } });
    b.onclick = () => set('');
    wrap.append(b);
  }
  for (const c of palette) {
    const b = el('button', { class: `color-dot ${c.toLowerCase() === String(current).toLowerCase() ? 'on' : ''}`, style: { background: c }, title: c, dataset: { c } });
    b.onclick = () => set(c);
    wrap.append(b);
  }
  const pick = el('input', { type: 'color', class: 'color-pick', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : allowNone ? '#ffffff' : '#000000', title: t('optbar.customColor') });
  pick.addEventListener('input', () => applyProp(key, prop, pick.value, { live: true }));
  pick.addEventListener('change', () => set(pick.value));
  wrap.append(pick);
  return wrap;
}

function range(label, key, prop, value, min, max, step, fmt = (v) => v) {
  const out = el('span', { class: 'muted', style: { minWidth: '34px' }, text: fmt(value) });
  const r = el('input', { type: 'range', min, max, step, value });
  r.addEventListener('input', () => { out.textContent = fmt(+r.value); applyProp(key, prop, +r.value, { live: true }); });
  r.addEventListener('change', () => { snapArmed = true; });
  return el('label', {}, label, r, out);
}

function numberInput(label, key, prop, value, min, max, step = 1) {
  const n = el('input', { type: 'number', class: 'input', min, max, step, value });
  n.addEventListener('change', () => { const v = Math.max(min, Math.min(max, +n.value || min)); n.value = v; applyProp(key, prop, v); });
  return el('label', {}, label, n);
}

function textControls(vals) {
  const key = 'text';
  const fam = el('select', { class: 'input' });
  const addGroup = (label, list) => {
    if (!list.length) return;
    const g = el('optgroup', { label });
    for (const f of list) g.append(el('option', { value: f.family, text: f.family, selected: f.family === vals.font }));
    fam.append(g);
  };
  addGroup(t('optbar.fontGroup'), textFonts());
  addGroup(t('optbar.handGroup'), handFonts());
  fam.addEventListener('change', () => applyProp(key, 'font', fam.value));
  const tog = (ic, prop, title) => {
    const b = el('button', { class: `tbtn ${vals[prop] ? 'on' : ''}`, title, html: icon(ic) });
    b.onclick = () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); applyProp(key, prop, v); };
    return b;
  };
  const al = (a, ic) => {
    const b = el('button', { class: `tbtn ${vals.align === a ? 'on' : ''}`, title: t('optbar.align'), html: icon(ic), dataset: { al: a } });
    b.onclick = () => { b.parentNode.querySelectorAll('[data-al]').forEach((x) => x.classList.toggle('on', x === b)); applyProp(key, 'align', a); };
    return b;
  };
  return [
    el('label', {}, t('optbar.fontFamily'), fam),
    numberInput(t('optbar.size'), key, 'size', vals.size, 4, 200, 0.5),
    tog('bold', 'bold', t('optbar.bold')), tog('italic', 'italic', t('optbar.italic')),
    el('span', { class: 'ob-sep' }),
    al('left', 'align-left'), al('center', 'align-center'), al('right', 'align-right'),
    el('span', { class: 'ob-sep' }),
    colorRow(key, 'color', vals.color),
  ];
}

function controlsFor(key, vals, { type, tool } = {}) {
  switch (key) {
    case 'text': {
      const c = textControls(vals);
      if (type === 'text') {
        c.push(el('span', { class: 'ob-sep' }), colorRow('text', 'bg', vals.bg || '', ['#ffffff', '#fff59d', '#e3f2fd'], { allowNone: true, label: t('optbar.background') }));
      }
      return c;
    }
    case 'ink':
      return [colorRow(key, 'color', vals.color), range(t('optbar.thickness'), key, 'sw', vals.sw, 0.5, 12, 0.5), range(t('optbar.opacity'), key, 'opacity', vals.opacity ?? 1, 0.1, 1, 0.05, pct)];
    case 'shape': {
      const c = [colorRow(key, 'color', vals.color, PALETTE, { label: t('optbar.strokeColor') }), range(t('optbar.thickness'), key, 'sw', vals.sw, 0.5, 12, 0.5)];
      if (type !== 'line' && type !== 'arrow' && tool !== 'line' && tool !== 'arrow') c.push(el('span', { class: 'ob-sep' }), colorRow(key, 'fill', vals.fill || '', ['#ffffff', '#ffe082', '#bbdefb', '#c8e6c9', '#ffcdd2'], { allowNone: true, label: t('optbar.fill') }));
      c.push(range(t('optbar.opacity'), key, 'opacity', vals.opacity ?? 1, 0.1, 1, 0.05, pct));
      return c;
    }
    case 'highlight':
      return [colorRow(key, 'color', vals.color, HL_PALETTE), range(t('optbar.density'), key, 'opacity', vals.opacity ?? 0.45, 0.15, 1, 0.05, pct)];
    case 'underline':
    case 'strike':
      return [colorRow(key, 'color', vals.color)];
    case 'whiteout':
      return [colorRow(key, 'color', vals.color, ['#ffffff', '#f5f5f5', '#fffde7', '#000000'], { label: t('optbar.coverColor') })];
    case 'symbol':
      return [colorRow(key, 'color', vals.color, ['#111111', '#1b5e20', '#1d4ed8', '#d32f2f']), range(t('optbar.size'), key, 'symbolSize', vals.size || vals.w || 14, 6, 48, 1)];
    case 'note':
      return [colorRow(key, 'color', vals.color, ['#ffd54f', '#81c784', '#64b5f6', '#f48fb1', '#ffb74d'])];
    default:
      return [];
  }
}

export function renderOptbar() {
  const bar = $('#optbar');
  const d = App.active;
  const tool = App.tool;
  const tl = TOOLS[tool];
  const parts = [];
  if (d && d.selection.size && !['place', 'snapshot', 'ocrregion', 'crop'].includes(tool)) {
    const sel = d.selectedObjs();
    const o = sel[0].obj;
    const key = defKey(o);
    const names = { redact: t('optbar.nameRedact'), text: t('optbar.nameText'), image: o.kind === 'signature' ? t('optbar.nameSignature') : o.kind === 'stamp' ? t('optbar.nameStamp') : t('optbar.nameImage'), ink: t('optbar.nameInk'), rect: t('tools.rect'), ellipse: t('tools.ellipse'), line: t('tools.line'), arrow: t('tools.arrow'), markup: t('optbar.nameMarkup'), whiteout: t('tools.whiteout'), symbol: t('optbar.nameSymbol'), note: t('tools.note') };
    parts.push(el('span', { class: 'ob-title', html: `${icon('square-mouse-pointer')}${sel.length > 1 ? t('optbar.nObjects', { count: sel.length }) : names[o.type] || t('optbar.nameObject')}` }));
    const vals = { ...(key ? App.defaults[key] : {}), ...o };
    if (o.type === 'symbol') vals.size = o.w;
    if (key) parts.push(...controlsFor(key, vals, { type: o.type }));
    if (o.type === 'image') {
      parts.push(range(t('optbar.opacity'), null, 'opacity', o.opacity ?? 1, 0.1, 1, 0.05, pct));
      const allBtn = el('button', { class: 'tbtn', title: t('optbar.addAllTitle'), html: `${icon('files')}${t('optbar.addAll')}` });
      allBtn.onclick = () => import('./insert.js').then((m) => m.copyToAllPages(d, o.id));
      parts.push(allBtn);
    }
    parts.push(el('span', { class: 'ob-sep' }));
    const dup = el('button', { class: 'tbtn', title: t('optbar.duplicate'), html: icon('copy-plus') });
    dup.onclick = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    const del = el('button', { class: 'tbtn danger', title: t('optbar.deleteTitle'), html: `${icon('trash-2')}${t('common.delete')}` });
    del.onclick = () => d.removeObjs([...d.selection]);
    parts.push(dup, del);
  } else if (d && tl && toolKey[tool]) {
    const key = toolKey[tool];
    parts.push(el('span', { class: 'ob-title', text: tl.label }));
    parts.push(...controlsFor(key, App.defaults[key], { tool }));
    parts.push(el('span', { class: 'hint', text: tl.hint }));
    parts.push(doneBtn());
  } else if (d && tl && tool !== 'select' && tool !== 'hand') {
    parts.push(el('span', { class: 'ob-title', text: tl.label }), el('span', { class: 'hint', style: { marginLeft: '8px' }, text: tl.hint }), el('span', { style: { flex: 1 } }), doneBtn(t('common.cancel')));
  }
  // yalnızca özellik renk seçici değerlerinin güncellenmesi için yeniden çiz; odak kaybolmasın
  if (bar.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'range') return;
  bar.replaceChildren(...parts);
  bar.hidden = !parts.length;
}

function doneBtn(label = t('optbar.done')) {
  const b = el('button', { class: 'tbtn', html: `${icon('check')}${label}`, title: t('optbar.backToSelect') });
  b.onclick = () => setTool('select');
  return b;
}

let langHooked = false;
export function initOptbar() {
  App.on('tool', renderOptbar);
  App.on('selection', () => { if (!isEditingText()) renderOptbar(); });
  App.on('active', renderOptbar);
  App.on('history', () => { snapArmed = true; });
  if (!langHooked) { langHooked = true; onLang(() => renderOptbar()); }
  renderOptbar();
}
