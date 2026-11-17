// Sayfa düzenleyici: küçük resim ızgarası, çoklu seçim, sürükle-bırak ile sıralama.
import { App, saveSetting } from './state.js';
import { $, $$, el, toast, parseRanges, rangesToText } from './util.js';
import { icon } from './icons.js';
import { thumbScheduler } from './sidebar.js';
import { t, onLang } from './i18n.js';

let visible = false;
let builtFor = null;
let observer = null;
let lastClicked = null;

export function showOrganizer(on) {
  visible = !!on && !!App.active;
  $('#organizer').hidden = !visible;
  if (visible) {
    // Gizli görüntüleyicide seçili kalan nesneler Delete/oklar/Ctrl+X ile yanlışlıkla değişmesin
    if (App.active?.selection?.size) App.active.setSelection([]);
    render();
  } else {
    builtFor = null;
    // Gizlenen ızgaranın bekleyen/süren küçük resim çizimlerini bırak
    observer && observer.disconnect();
    observer = null;
  }
}

App.on('active', () => { if (visible || App.ribbonTab === 'page') showOrganizer(App.ribbonTab === 'page'); });
App.on('doc:reloaded', (d) => { if (visible && d === App.active) { builtFor = null; render(); } });
App.on('doc:pagesinit', (d) => { if (visible && d === App.active && builtFor?.pdf !== d.pdf) render(); });
// Dil değişince görünür ızgara başlığı/etiketleri yeniden çizilsin
onLang(() => { if (visible) { builtFor = null; render(); } });

function render() {
  const d = App.active;
  const host = $('#organizer');
  if (!d || !d.pdf) return;
  if (builtFor && builtFor.doc === d && builtFor.pdf === d.pdf) { updateSel(); return; }
  builtFor = { doc: d, pdf: d.pdf };
  d.pageSel = new Set([...(d.pageSel || [])].filter((k) => k < d.numPages));
  observer && observer.disconnect();
  const size = App.settings.orgSize || 170;
  host.style.setProperty('--org-size', `${size}px`);

  const rangeInput = el('input', { class: 'input', placeholder: t('organizer.selectPh') });
  rangeInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    try { d.pageSel = new Set(parseRanges(rangeInput.value, d.numPages)); updateSel(); } catch (err) { toast(err.message, { type: 'warn' }); }
  });
  const slider = el('input', { type: 'range', min: 110, max: 340, value: size, title: t('organizer.thumbSize') });
  slider.addEventListener('input', () => { host.style.setProperty('--org-size', `${slider.value}px`); });
  slider.addEventListener('change', () => saveSetting({ orgSize: +slider.value }));
  const count = el('span', { class: 'muted org-count' });
  const btn = (label, fn) => { const b = el('button', { class: 'btn small', text: label }); b.onclick = fn; return b; };
  const head = el('div', { class: 'org-head' },
    el('b', { text: t('organizer.pageCount', { count: d.numPages }) }),
    btn(t('organizer.selectAll'), () => { d.pageSel = new Set(Array.from({ length: d.numPages }, (_, k) => k)); updateSel(); }),
    btn(t('organizer.oddPages'), () => { d.pageSel = new Set(Array.from({ length: d.numPages }, (_, k) => k).filter((k) => k % 2 === 0)); updateSel(); }),
    btn(t('organizer.evenPages'), () => { d.pageSel = new Set(Array.from({ length: d.numPages }, (_, k) => k).filter((k) => k % 2 === 1)); updateSel(); }),
    btn(t('organizer.clearSel'), () => { d.pageSel = new Set(); updateSel(); }),
    rangeInput, count,
    el('span', { style: { flex: 1 } }),
    el('span', { class: 'muted', text: t('organizer.dragHint') }),
    el('span', { html: icon('zoom-out'), class: 'muted' }), slider);
  const grid = el('div', { class: 'org-grid' });
  // Sınırlı, iptal edilebilir küçük resim kuyruğu (bkz. sidebar.js)
  observer = thumbScheduler(host, '400px', (c, job) => thumb(d, +c.dataset.i, c.querySelector('.cv'), job));
  App.thumbStats = { ...App.thumbStats, organizer: observer.stats };
  for (let i = 0; i < d.numPages; i++) grid.append(card(d, i));
  host.replaceChildren(head, grid);
  $$('.org-page', grid).forEach((c) => observer.observe(c));
  updateSel();
}

function card(d, i) {
  const chk = el('input', { type: 'checkbox', class: 'check', title: t('organizer.select') });
  const act = (ic, title, fn) => { const b = el('button', { title, html: icon(ic) }); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
  const c = el('div', { class: 'org-page', dataset: { i: String(i) } },
    el('div', { class: 'cv' }),
    el('span', { class: 'num', text: String(i + 1) }),
    chk,
    el('div', { class: 'acts' },
      act('rotate-ccw', t('organizer.rotateLeft'), () => import('./pageops.js').then((m) => m.rotatePages(d, [i], -90))),
      act('rotate-cw', t('organizer.rotateRight'), () => import('./pageops.js').then((m) => m.rotatePages(d, [i], 90))),
      act('copy-plus', t('organizer.duplicate'), () => { d.pageSel = new Set([i]); import('./pageops.js').then((m) => m.duplicateSelected(d)); }),
      act('trash-2', t('common.delete'), () => import('./pageops.js').then((m) => m.deletePages(d, [i]))),
    ));
  chk.addEventListener('click', (e) => { e.stopPropagation(); toggle(d, i, chk.checked); lastClicked = i; });
  c.addEventListener('click', (e) => {
    if (suppressClick) return;
    if (e.shiftKey && lastClicked != null) {
      const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
      for (let k = a; k <= b; k++) d.pageSel.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      toggle(d, i, !d.pageSel.has(i));
    } else {
      d.pageSel = new Set([i]);
    }
    lastClicked = i;
    updateSel();
  });
  c.addEventListener('dblclick', () => {
    d.goToPage(i);
    import('./ribbon.js').then((m) => m.selectTab('home'));
  });
  c.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input')) return;
    startDrag(d, i, c, e);
  });
  c.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (!d.pageSel.has(i)) { d.pageSel = new Set([i]); updateSel(); }
    const sel = [...d.pageSel].sort((a, b) => a - b);
    const many = sel.length > 1;
    const ops = await import('./pageops.js');
    const { contextMenu } = await import('./util.js');
    contextMenu(e.clientX, e.clientY, [
      { header: many ? t('organizer.selectedCount', { count: sel.length }) : t('organizer.pageNo', { no: i + 1 }) },
      { label: t('organizer.blankBefore'), icon: 'file-plus', run: () => ops.insertBlankQuick(d, i, 'before') },
      { label: t('organizer.blankAfter'), icon: 'file-plus', run: () => ops.insertBlankQuick(d, i, 'after') },
      { label: t('organizer.blankDialog'), icon: 'settings', run: () => ops.insertBlankDialog(d, null, { at: i }) },
      '-',
      { label: t('organizer.rotateLeft'), icon: 'rotate-ccw', run: () => ops.rotatePages(d, sel, -90) },
      { label: t('organizer.rotateRight'), icon: 'rotate-cw', run: () => ops.rotatePages(d, sel, 90) },
      { label: many ? t('organizer.duplicateMany') : t('organizer.duplicateOne'), icon: 'copy-plus', run: () => ops.duplicateSelected(d) },
      '-',
      { label: many ? t('organizer.extractMany') : t('organizer.extractOne'), icon: 'file-output', run: () => ops.extractDialog(d) },
      { label: t('organizer.insertFromFile'), icon: 'files', run: () => ops.insertFromFile(d) },
      '-',
      { label: many ? t('organizer.deleteMany', { count: sel.length }) : t('organizer.deleteOne'), icon: 'trash-2', danger: true, run: () => ops.deletePages(d, sel) },
    ]);
  });
  return c;
}

// İşaretçi olaylarıyla sürükle-bırak (HTML5 DnD'den daha akıcı ve güvenilir)
let suppressClick = false;
function startDrag(d, i, card, e) {
  const sx = e.clientX, sy = e.clientY;
  let dragging = false;
  let ghost = null;
  let target = null;
  const host = $('#organizer');
  let scrollTimer = null;
  const clearMarks = () => $$('.org-page').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  const move = (ev) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      dragging = true;
      if (!d.pageSel.has(i)) { d.pageSel = new Set([i]); updateSel(); }
      $$('.org-page').forEach((x) => { if (d.pageSel.has(+x.dataset.i)) x.classList.add('dragging'); });
      const cv = card.querySelector('canvas');
      ghost = el('div', { class: 'org-ghost' });
      if (cv) { const g = document.createElement('canvas'); g.width = cv.width; g.height = cv.height; g.getContext('2d').drawImage(cv, 0, 0); ghost.append(g); }
      if (d.pageSel.size > 1) ghost.append(el('span', { text: String(d.pageSel.size) }));
      document.body.append(ghost);
    }
    ghost.style.left = `${ev.clientX + 12}px`;
    ghost.style.top = `${ev.clientY + 12}px`;
    clearMarks();
    target = null;
    const over = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList?.contains('org-page'));
    if (over) {
      const r = over.getBoundingClientRect();
      const after = ev.clientX > r.left + r.width / 2;
      over.classList.add(after ? 'drop-after' : 'drop-before');
      target = +over.dataset.i + (after ? 1 : 0);
    }
    // kenara yaklaşınca otomatik kaydır
    const hr = host.getBoundingClientRect();
    clearInterval(scrollTimer);
    const edge = ev.clientY < hr.top + 50 ? -1 : ev.clientY > hr.bottom - 50 ? 1 : 0;
    if (edge) scrollTimer = setInterval(() => { host.scrollTop += edge * 18; }, 30);
  };
  const up = async () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    clearInterval(scrollTimer);
    if (!dragging) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 50);
    ghost?.remove();
    clearMarks();
    $$('.org-page').forEach((x) => x.classList.remove('dragging'));
    if (target == null) return;
    const pages = [...d.pageSel].sort((a, b) => a - b);
    const m = await import('./pageops.js');
    try {
      await m.movePages(d, pages, target);
    } catch (err) {
      console.error(err);
      toast(t('organizer.moveFailed', { error: err.message }), { type: 'error', timeout: 7000 });
      return;
    }
    toast(t('organizer.moved', { count: pages.length }), { type: 'ok', timeout: 1800, action: { label: t('organizer.undo'), run: () => d.undo() } });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function toggle(d, i, on) {
  if (on) d.pageSel.add(i); else d.pageSel.delete(i);
  updateSel();
}

function updateSel() {
  const d = App.active;
  if (!d) return;
  $$('.org-page').forEach((c) => {
    const on = d.pageSel.has(+c.dataset.i);
    c.classList.toggle('sel', on);
    const chk = c.querySelector('.check');
    if (chk) chk.checked = on;
  });
  const cnt = $('.org-count');
  if (cnt) cnt.textContent = d.pageSel.size ? t('organizer.selected', { count: d.pageSel.size, range: rangesToText([...d.pageSel]) }) : t('organizer.noSelection');
}

async function thumb(d, i, host, job) {
  let page = null;
  try {
    page = await d.pdf.getPage(i + 1);
    if (job.cancelled) return false;
    const vp0 = page.getViewport({ scale: 1 });
    const target = 340 * (window.devicePixelRatio || 1);
    const scale = target / Math.max(vp0.width, vp0.height);
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width);
    cv.height = Math.ceil(vp.height);
    job.task = page.render({ canvas: cv, viewport: vp });
    await job.task.promise;
    // Düzenleme nesnelerinin varlığını küçük resimde işaretle
    if (d.pageObjs[i]?.length) cv.title = t('organizer.editsTitle', { count: d.pageObjs[i].length });
    host.replaceChildren(cv);
    return true;
  } catch (e) { return false; /* iptal edildi ya da belge değişti */ } finally {
    try { page?.cleanup(); } catch (e) { /* yoksay */ }
  }
}
