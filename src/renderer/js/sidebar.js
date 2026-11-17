// Kenar çubuğu: sayfa küçük resimleri, içindekiler (yer imleri), düzenlemeler listesi.
import { App } from './state.js';
import { $, $$, el, debounce } from './util.js';
import { icon } from './icons.js';
import { t, onLang } from './i18n.js';

let side = 'thumbs';
let observer = null;
let builtFor = null; // { doc, pdf, count }

let langHooked = false;
export function initSidebar() {
  if (!langHooked) { langHooked = true; onLang(() => refreshSidebar()); }
  $$('.sidebar-tabs button').forEach((b) => b.addEventListener('click', () => showSide(b.dataset.side)));
  App.on('doc:reloaded', (d) => { if (d === App.active) { builtFor = null; refreshSidebar(); } });
  App.on('selection', (d) => { if (d === App.active && side === 'objects') refreshSidebar(); });
  App.on('history', debounce((d) => { if (d === App.active && side === 'objects') refreshSidebar(); }, 150));
}

export function showSide(name) {
  side = name;
  $$('.sidebar-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.side === name));
  builtFor = null;
  refreshSidebar();
}

export function refreshSidebar(reason) {
  const sb = $('#sidebar');
  const body = $('#sidebar-body');
  if (sb.hidden) return;
  const d = App.active;
  if (!d || !d.pdf) { body.replaceChildren(el('div', { class: 'empty-note', text: t('sidebar.noDoc') })); builtFor = null; return; }
  if (side === 'thumbs') {
    if (builtFor && builtFor.doc === d && builtFor.pdf === d.pdf) {
      markCurrent(body, d, reason === 'page');
      return;
    }
    buildThumbs(body, d);
  } else if (side === 'outline') {
    buildOutline(body, d);
  } else {
    buildObjects(body, d);
  }
}

function markCurrent(body, d, scroll) {
  const cur = d.currentPageIndex;
  $$('.thumb', body).forEach((t) => {
    const on = +t.dataset.i === cur;
    t.classList.toggle('on', on);
    if (on && scroll) t.scrollIntoView({ block: 'nearest' });
  });
}

// Küçük resim çizim kuyruğu (kenar çubuğu + sayfa düzenleyici): aynı anda en fazla 2 çizim, en son görünene
// öncelik. Görünümden çıkan bekleyen iş sıradan düşer, süren çizim iptal edilir; tekrar görünürse yeniden sıraya girer.
// render(kart, iş) → true: bitti (artık izlenmez). İş nesnesine pdf.js RenderTask'ı `task` olarak yazılır.
export function thumbScheduler(root, rootMargin, render, maxJobs = 2) {
  const waiting = [];
  const running = new Map(); // kart -> { task, cancelled, again }
  let dead = false;
  const pump = () => {
    while (!dead && running.size < maxJobs && waiting.length) {
      const t = waiting.shift();
      const job = { task: null, cancelled: false, again: false };
      running.set(t, job);
      Promise.resolve(render(t, job)).catch(() => false).then((ok) => {
        if (running.get(t) === job) running.delete(t);
        if (dead) return;
        if (ok) io.unobserve(t);
        else if (job.again && !waiting.includes(t)) waiting.unshift(t);
        pump();
      });
    }
  };
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const t = en.target;
      const job = running.get(t);
      if (en.isIntersecting) {
        if (job) job.again = true;
        else if (!waiting.includes(t)) waiting.unshift(t);
      } else {
        const k = waiting.indexOf(t);
        if (k >= 0) waiting.splice(k, 1);
        if (job) { job.cancelled = true; job.again = false; try { job.task?.cancel(); } catch (e) { /* yoksay */ } }
      }
    }
    pump();
  }, { root, rootMargin });
  return {
    observe: (t) => io.observe(t),
    stats: () => ({ running: running.size, waiting: waiting.length }),
    disconnect() {
      dead = true;
      io.disconnect();
      waiting.length = 0;
      for (const job of running.values()) { job.cancelled = true; try { job.task?.cancel(); } catch (e) { /* yoksay */ } }
      running.clear();
    },
  };
}

function buildThumbs(body, d) {
  builtFor = { doc: d, pdf: d.pdf };
  observer && observer.disconnect();
  body.replaceChildren();
  const pdf = d.pdf;
  observer = thumbScheduler(body, '300px', (t, job) => renderThumb(pdf, +t.dataset.i, t, job));
  App.thumbStats = { ...App.thumbStats, sidebar: observer.stats };
  for (let i = 0; i < pdf.numPages; i++) {
    const t = el('div', { class: 'thumb', dataset: { i: String(i) } }, el('div', { class: 'ph' }), el('span', { text: String(i + 1) }));
    t.addEventListener('click', () => d.goToPage(i));
    body.append(t);
    observer.observe(t);
  }
  markCurrent(body, d, true);
}

async function renderThumb(pdf, i, t, job) {
  let page = null;
  try {
    page = await pdf.getPage(i + 1);
    if (job.cancelled) return false;
    const vp0 = page.getViewport({ scale: 1 });
    const scale = 150 / Math.max(vp0.width, vp0.height * 0.75);
    const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    c.style.width = `${Math.ceil(vp.width / (window.devicePixelRatio || 1))}px`;
    job.task = page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp, annotationMode: 1 });
    await job.task.promise;
    const ph = t.querySelector('.ph, canvas');
    if (ph) ph.replaceWith(c);
    return true;
  } catch (e) { return false; /* iptal edildi ya da belge değişti */ } finally {
    try { page?.cleanup(); } catch (e) { /* yoksay */ }
  }
}

async function buildOutline(body, d) {
  builtFor = null;
  body.replaceChildren(el('div', { class: 'empty-note', text: t('sidebar.loading') }));
  const outline = await d.pdf.getOutline();
  if (!outline || !outline.length) {
    body.replaceChildren(el('div', { class: 'empty-note', text: t('sidebar.noOutline') }));
    return;
  }
  const build = (items) => el('div', {}, items.map((it) => {
    const row = el('div', { class: 'outline-item', text: it.title, title: it.title });
    row.addEventListener('click', () => {
      if (it.dest) d.linkService.goToDestination(it.dest);
      else if (it.url) window.open(it.url);
    });
    const wrap = el('div', {}, row);
    if (it.items?.length) wrap.append(el('div', { class: 'outline-children' }, build(it.items)));
    return wrap;
  }));
  body.replaceChildren(build(outline));
}

function buildObjects(body, d) {
  builtFor = null;
  const names = { text: ['type', t('optbar.nameText')], image: ['image', t('optbar.nameImage')], ink: ['pencil-line', t('optbar.nameInk')], rect: ['square', t('tools.rect')], ellipse: ['circle', t('tools.ellipse')], line: ['minus', t('tools.line')], arrow: ['move-up-right', t('tools.arrow')], markup: ['highlighter', t('optbar.nameMarkup')], whiteout: ['eraser', t('tools.whiteout')], redact: ['square', t('optbar.nameRedact')], symbol: ['check', t('optbar.nameSymbol')], note: ['sticky-note', t('tools.note')] };
  const rows = [];
  d.pageObjs.forEach((objs, p) => {
    for (const o of objs) {
      const [ic, name] = names[o.type] || ['file', o.type];
      const label = o.type === 'text' ? (o.text || '').slice(0, 40) || name : o.type === 'image' && o.kind === 'signature' ? t('optbar.nameSignature') : o.type === 'note' ? (o.text || t('tools.note')).slice(0, 40) : name;
      const row = el('div', { class: 'obj-row', style: d.selection.has(o.id) ? { background: 'var(--accent-soft)' } : null, html: `${icon(ic)}<span></span><small>${t('sidebar.pageShort', { n: p + 1 })}</small>` });
      row.querySelector('span').textContent = label;
      row.addEventListener('click', () => {
        d.goToPage(p);
        d.setSelection([o.id]);
        requestAnimationFrame(() => d.layers[p]?.querySelector(`[data-id="${o.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      });
      rows.push(row);
    }
  });
  body.replaceChildren(...(rows.length ? rows : [el('div', { class: 'empty-note', text: t('sidebar.noEdits') })]));
}
