// HermoPDF — ana arayüz: sekmeler, belge yönetimi, durum çubuğu, arama, kısayollar, sürükle-bırak.
import { App, saveSetting } from './state.js';
import { $, $$, el, toast, esc, fmtBytes, confirmBox, choiceBox, contextMenu, isModalOpen, isBusy, baseName, copyImageToClipboard, blobToDataURL, loadImage } from './util.js';
import { icon } from './icons.js';
import { initLibs } from './pdfcore.js';
import { initFonts, defaultFamily } from './fonts.js';
import { PdfDoc } from './doc.js';
import { initTools, setTool, TOOLS, markupFromSelection, selectionRects } from './tools.js';
import { isEditingText, finishTextEdit, nudgeSelection, renderLayer, pageIndexFromTarget, eventToPage, pageDims } from './overlay.js';
import { buildRibbon, refreshRibbon, runAction, relabelRibbon } from './ribbon.js';
import { initOptbar } from './optbar.js';
import { initSidebar, refreshSidebar } from './sidebar.js';
import { initClaude } from './claude.js';
import { initPro, requirePro } from './pro.js';
import { initUpdates, updatePromptCard } from './update.js';
import { t, onLang, applyDom } from './i18n.js';

const docsHost = () => $('#docs');

// ---------------- belge yönetimi ----------------
// Açılmakta olan (yükleniyor / parola bekliyor) dosyalar: küçük harf yol -> PdfDoc.open sözü.
// Aynı dosya bu sırada yeniden açılırsa ikinci sekme yerine ilk açılışın sonucu kullanılır.
const opening = new Map();

// Son açılanlar listesine ekle ve oturum içindeki listeyi güncelle
function rememberRecent(p) {
  if (!p || !window.pu.addRecent) return;
  window.pu.addRecent(p).then((r) => {
    if (!Array.isArray(r)) return;
    App.settings.recent = r;
    if (!App.active) renderStart();
  }).catch(() => {});
}
App.rememberRecent = rememberRecent;

export async function openFiles(files) {
  let last = null;
  window.pu.log(`openFiles: ${files.length} dosya (${files.map((f) => f.name).join(', ')})`);
  for (const f of files) {
    const key = f.path ? f.path.toLowerCase() : null;
    const existing = key && App.docs.find((d) => d.path && d.path.toLowerCase() === key);
    if (existing) { last = existing; continue; }
    if (key && opening.has(key)) {
      const other = await opening.get(key).catch(() => null);
      if (other && App.docs.includes(other)) last = other;
      continue;
    }
    try {
      const pr = PdfDoc.open(f);
      if (key) opening.set(key, pr);
      let doc;
      try { doc = await pr; } finally { if (key) opening.delete(key); }
      App.docs.push(doc);
      doc.mount(docsHost());
      last = doc;
      window.pu.log(`açıldı: ${f.name} (${doc.numPages} sayfa, toplam sekme ${App.docs.length})`);
      rememberRecent(f.path);
    } catch (e) {
      if (e?.cancelled) { window.pu.log(`iptal: ${f.name}`); continue; }
      console.error(e);
      window.pu.log(`AÇILAMADI ${f.name}: ${e?.stack || e?.message || e}`);
      toast(t('app.openFailed', { name: f.name, error: e?.message || e }), { type: 'error', timeout: 7000 });
    }
  }
  if (last) activate(last);
  renderTabs();
  return last;
}

export async function openPaths(paths) {
  window.pu.log(`openPaths: ${paths.join(' | ')}`);
  const files = [];
  for (const p of paths) {
    try { files.push(await window.pu.readPdf(p)); } catch (e) { window.pu.log(`okunamadı ${p}: ${e?.message || e}`); toast(t('app.readFailed', { path: p }), { type: 'error' }); }
  }
  return openFiles(files);
}

export async function openBytes(bytes, name, { path = null } = {}) {
  return openFiles([{ bytes, name, path, size: bytes.length }]);
}

export function activate(doc) {
  finishTextEdit();
  // Sunum modu yalnızca sunulan belgeye aittir; başka belgeye geçerken kapat
  if (doc !== App.active && App.exitPresentation) App.exitPresentation();
  App.active = doc;
  for (const d of App.docs) {
    d.el.classList.toggle('hidden', d !== doc);
    // Arka plandaki belgelerin çizilmiş sayfa görüntülerini bellekten at
    if (d !== doc) {
      try { d.viewer?.cleanup?.(); } catch (e) { /* yoksay */ }
      try { Promise.resolve(d.pdf?.cleanup?.()).catch(() => {}); } catch (e) { /* yoksay */ }
    }
  }
  $('#start').hidden = !!doc;
  document.body.classList.toggle('has-doc', !!doc);
  renderTabs();
  updateStatus();
  updateTitle();
  refreshRibbon();
  refreshSidebar();
  App.emit('active', doc);
  if (doc) setTimeout(() => doc.container.focus({ preventScroll: true }), 0);
}

// Aynı yoldaki açık belge (büyük/küçük harf duyarsız); doc.js döngüsel içe aktarma olmasın diye App üzerinden kullanır
export const docForPath = (p, except) => p && App.docs.find((x) => x !== except && x.path && x.path.toLowerCase() === p.toLowerCase());
App.docForPath = docForPath;
App.closeDoc = (doc, o) => closeDoc(doc, o);

export async function closeDoc(doc, { force = false } = {}) {
  // Zaten kapanmış belge: splice(-1) son sekmeyi düşürmesin
  if (!doc || !App.docs.includes(doc)) return true;
  // Aynı belge için açık bir "Kapatmadan önce" sorusu varsa ikincisini açma, onun sonucunu bekle
  if (doc._closing && !force) return doc._closing;
  const p = closeDocNow(doc, force);
  if (!force) { doc._closing = p; p.finally(() => { if (doc._closing === p) doc._closing = null; }).catch(() => {}); }
  return p;
}

async function closeDocNow(doc, force) {
  finishTextEdit();
  if (document.body.classList.contains('presenting')) await App.exitPresentation?.();
  if (doc.dirty && !force) {
    activate(doc);
    const r = await choiceBox(t('app.unsaved', { name: doc.name }), [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('app.dontSave'), value: 'discard', danger: true },
      { label: t('common.save'), value: 'save', primary: true },
    ], { title: t('app.beforeClose') });
    if (!r || r === 'cancel') return false;
    if (!App.docs.includes(doc)) return true; // soru açıkken başka yoldan kapatıldı
    if (r === 'save') {
      const ok = await doc.save().catch((e) => { toast(t('common.saveFailed', { error: e.message }), { type: 'error' }); return false; });
      if (!ok) return false;
    }
  }
  const idx = App.docs.indexOf(doc);
  if (idx < 0) return true;
  App.docs.splice(idx, 1);
  doc.destroy();
  if (App.active === doc) activate(App.docs[Math.min(idx, App.docs.length - 1)] || null);
  renderTabs();
  renderStart();
  return true;
}

function renderTabs() {
  const host = $('#doctabs');
  host.replaceChildren();
  for (const d of App.docs) {
    const tab = el('div', { class: `doctab ${d === App.active ? 'on' : ''}`, title: d.path || d.name, role: 'tab' },
      d.dirty ? el('span', { class: 'dirty', title: t('app.unsavedChange') }) : null,
      el('span', { class: 'name', text: d.name }),
      el('span', { class: 'x', title: t('app.closeTab'), html: icon('x') }));
    tab.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); closeDoc(d); return; }
      if (e.target.closest('.x')) return;
      activate(d);
    });
    tab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.x')) return;
      startTabDrag(d, tab, e);
    });
    tab.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); closeDoc(d); });
    host.append(tab);
  }
  const plus = el('button', { class: 'icon-btn doctab-new', title: t('app.openTip'), html: icon('plus') });
  plus.addEventListener('click', () => runAction('file.open'));
  host.append(plus);
}

// Sekmeleri Chrome'daki gibi sürükleyerek yeniden sırala
function startTabDrag(doc, tabEl, e) {
  const host = $('#doctabs');
  const startX = e.clientX;
  let dragging = false;
  let target = null;
  const clearMarks = () => $$('.doctab', host).forEach((t) => t.classList.remove('drop-left', 'drop-right'));
  const move = (ev) => {
    if (!dragging) {
      if (Math.abs(ev.clientX - startX) < 5) return;
      dragging = true;
      tabEl.classList.add('dragging');
    }
    clearMarks();
    const tabs = [...host.querySelectorAll('.doctab')];
    target = tabs.length; // varsayılan: sona
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect();
      if (ev.clientX < r.left + r.width / 2) { target = i; break; }
    }
    const mark = tabs[Math.min(target, tabs.length - 1)];
    if (mark) mark.classList.add(target >= tabs.length ? 'drop-right' : 'drop-left');
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    clearMarks();
    tabEl.classList.remove('dragging');
    if (!dragging || target == null) return;
    const from = App.docs.indexOf(doc);
    let to = target;
    if (from < to) to--;
    if (from >= 0 && to >= 0 && from !== to) {
      App.docs.splice(from, 1);
      App.docs.splice(to, 0, doc);
      renderTabs();
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function updateTitle() {
  const d = App.active;
  const t = d ? `${d.dirty ? '• ' : ''}${d.name} — HermoPDF` : 'HermoPDF';
  document.title = t;
}

export function updateStatus() {
  const d = App.active;
  const has = !!(d && d.viewer && d.pdf);
  $('#sb-nav').style.visibility = has ? 'visible' : 'hidden';
  $$('#zoom-out, #zoom-in, #zoom-val').forEach((b) => { b.disabled = !has; });
  if (!has) { $('#sb-size').textContent = ''; return; }
  $('#nav-page').value = d.viewer.currentPageNumber || 1;
  $('#nav-total').textContent = `/ ${d.numPages}`;
  $('#zoom-val').textContent = `${Math.round((d.viewer.currentScale || 1) * 100)}%`;
  $('#sb-size').textContent = d.fileSize ? fmtBytes(d.fileSize) : '';
}

function updateHint() {
  const t = TOOLS[App.tool];
  $('#sb-hint').textContent = t ? t.hint || '' : '';
}

// ---------------- başlangıç ekranı ----------------
function renderStart() {
  const s = $('#start');
  const recent = App.settings.recent || [];
  const proLabel = t('common.proFeature');
  const quick = [
    ['folder-open', t('app.q.open'), t('app.q.openSub'), 'file.open'],
    ['combine', t('app.q.merge'), t('app.q.mergeSub'), 'page.mergeFiles'],
    ['file-image', t('app.q.images'), t('app.q.imagesSub'), 'convert.imagesToPdf'],
    ['file-type', t('app.q.word'), t('app.q.wordSub'), 'convert.wordToPdf'],
    ['shrink', t('app.q.compress'), t('app.q.compressSub'), 'tools.compressFile'],
    ['scan-text', t('app.q.ocr'), t('app.q.ocrSub'), 'tools.ocrFile', true],
    ['file-plus', t('app.q.blank'), t('app.q.blankSub'), 'file.new'],
    ['file-stack', t('app.q.batch'), t('app.q.batchSub'), 'tools.batch', true],
  ];
  const inner = el('div', { class: 'start-inner' },
    el('div', { class: 'start-hero' },
      el('img', { src: 'app://pu/build/icon-256.png', alt: '' }),
      el('div', {}, el('h1', { text: 'HermoPDF' }), el('p', { text: t('app.heroText') }))),
    updatePromptCard(),
    el('div', { class: 'dropzone', onclick: () => runAction('file.open'), html: `${icon('upload')}<b>${esc(t('app.dropTitle'))}</b><span>${esc(t('app.dropSub'))}</span>` }),
    el('div', { class: 'quick' }, quick.map(([ic, t, sub, act, pro]) => el('button', { class: pro ? 'has-pro' : '', onclick: () => runAction(act), html: `<span class="qi">${icon(ic)}</span><span><b>${esc(t)}</b><small>${esc(sub)}</small></span>${pro ? `<span class="rpro" title="${esc(proLabel)}">${icon('crown')}</span>` : ''}` }))),
    recent.length ? el('div', { class: 'recent' }, el('h3', { text: t('app.recent') }), recent.map((p) => {
      const row = el('div', { class: 'recent-item', title: p, html: `${icon('file-text')}<div class="col"><div>${esc(p.split(/[\\/]/).pop())}</div><div class="path">${esc(p)}</div></div>` });
      const rm = el('button', { class: 'icon-btn rm', title: t('app.removeRecent'), html: icon('x') });
      rm.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.pu.removeRecent(p);
        App.settings.recent = (App.settings.recent || []).filter((r) => r !== p);
        renderStart();
      });
      row.append(rm);
      row.addEventListener('click', async () => {
        if (!(await window.pu.exists(p))) {
          toast(t('app.recentMissing'), { type: 'warn' });
          await window.pu.removeRecent(p);
          App.settings.recent = (App.settings.recent || []).filter((r) => r !== p);
          renderStart();
          return;
        }
        openPaths([p]);
      });
      return row;
    })) : null);
  s.replaceChildren(inner);
}

// ---------------- arama ----------------
function initFind() {
  const bar = $('#findbar');
  const input = $('#find-input');
  $('#find-prev').innerHTML = icon('chevron-up');
  $('#find-next').innerHTML = icon('chevron-down');
  $('#find-close').innerHTML = icon('x');
  const dispatch = (type, findPrevious = false) => {
    const d = App.active;
    if (!d) return;
    d.eventBus.dispatch('find', {
      source: null, type, query: input.value, caseSensitive: $('#find-case').checked, entireWord: $('#find-word').checked,
      highlightAll: true, findPrevious, matchDiacritics: false,
    });
  };
  input.addEventListener('input', () => dispatch(''));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); dispatch('again', e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  $('#find-prev').addEventListener('click', () => dispatch('again', true));
  $('#find-next').addEventListener('click', () => dispatch('again', false));
  $('#find-case').addEventListener('change', () => dispatch('casesensitivitychange'));
  $('#find-word').addEventListener('change', () => dispatch('entirewordchange'));
  $('#find-close').addEventListener('click', closeFind);
  App.on('find:count', (doc, mc) => {
    if (doc !== App.active) return;
    $('#find-count').textContent = mc.total ? `${mc.current}/${mc.total}` : input.value ? t('app.notFound') : '';
  });
  App.on('find:state', async (doc, e) => {
    if (doc !== App.active) return;
    if (e.state !== 1) return; // 1 = bulunamadı
    $('#find-count').textContent = t('app.notFound');
    if (!input.value.trim() || doc.__ocrSuggested) return;
    const { isScanned, offerOcr } = await import('./assist.js');
    if (!(await isScanned(doc))) return; // metin var, sadece bu kelime yok
    doc.__ocrSuggested = true;
    await offerOcr(doc, {
      title: t('app.noSearchText'),
      reason: t('app.noSearchReason', { q: input.value.trim() }),
    });
  });
  function closeFind() {
    bar.hidden = true;
    const d = App.active;
    if (d) {
      d.eventBus.dispatch('find', { source: null, type: '', query: '', highlightAll: false });
      d.container.focus();
    }
  }
  App.openFind = (q) => {
    if (!App.active) return;
    bar.hidden = false;
    if (q) { input.value = q; dispatch(''); }
    input.focus();
    input.select();
  };
}

// ---------------- durum çubuğu ----------------
function initStatusbar() {
  const set = (id, ic) => { $(id).innerHTML = icon(ic); };
  set('#nav-first', 'chevrons-left'); set('#nav-prev', 'chevron-left'); set('#nav-next', 'chevron-right'); set('#nav-last', 'chevrons-right');
  set('#zoom-out', 'zoom-out'); set('#zoom-in', 'zoom-in'); set('#sb-sidebar', 'panel-left');
  const d = () => App.active;
  $('#nav-first').onclick = () => d()?.goToPage(0);
  $('#nav-last').onclick = () => d() && d().goToPage(d().numPages - 1);
  $('#nav-prev').onclick = () => d() && d().viewer.previousPage();
  $('#nav-next').onclick = () => d() && d().viewer.nextPage();
  $('#nav-page').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const n = parseInt(e.target.value, 10);
      if (d() && n) d().goToPage(n - 1);
      d()?.container.focus();
    }
  });
  $('#nav-page').addEventListener('focus', (e) => e.target.select());
  $('#zoom-in').onclick = () => zoom(1);
  $('#zoom-out').onclick = () => zoom(-1);
  $('#zoom-val').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.top - 290, [
      { label: t('app.zoom.width'), icon: 'move-horizontal', run: () => setScale('page-width') },
      { label: t('app.zoom.fit'), icon: 'maximize-2', run: () => setScale('page-fit') },
      { label: t('app.zoom.auto'), icon: 'wand-sparkles', run: () => setScale('auto') },
      '-',
      ...[50, 75, 100, 125, 150, 200, 300].map((z) => ({ label: t('app.zoom.pct', { n: z }), icon: z === 100 ? 'dot' : null, run: () => setScale(z / 100) })),
    ]);
  };
  $('#sb-sidebar').onclick = () => toggleSidebar();
  App.on('doc:page', (doc) => { if (doc === App.active) { updateStatus(); refreshSidebar('page'); } });
  App.on('doc:scale', (doc) => { if (doc === App.active) updateStatus(); });
  App.on('doc:pagesinit', (doc) => { if (doc === App.active) { updateStatus(); refreshSidebar(); } });
  App.on('doc:dirty', () => { renderTabs(); updateTitle(); });
  App.on('doc:saved', (d) => { renderTabs(); updateTitle(); updateStatus(); rememberRecent(d?.path); });
  App.on('doc:structure', () => { updateStatus(); });
  App.on('tool', updateHint);
}

export function setScale(v) {
  const d = App.active;
  if (!d) return;
  d.viewer.currentScaleValue = typeof v === 'number' ? String(v) : v;
}

export function zoom(dir, origin) {
  const d = App.active;
  if (!d) return;
  if (dir > 0) d.viewer.increaseScale({ steps: 1, origin });
  else d.viewer.decreaseScale({ steps: 1, origin });
}

export function toggleSidebar(force) {
  const sb = $('#sidebar');
  sb.hidden = force != null ? !force : !sb.hidden;
  saveSetting({ sidebar: !sb.hidden });
  refreshSidebar();
  // pdf.js görüntüleyicisi kap boyutunu kendisi izler
}

export function setTheme(theme, { persist = true } = {}) {
  document.documentElement.dataset.theme = theme;
  window.pu.setTheme(theme, persist);
  if (persist) App.settings.theme = theme;
  $('#theme-btn').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
}

// ---------------- karartma bilgi çubuğu ----------------
let redactBar = null;
let redactBarDismissed = false;
export function updateRedactBar() {
  const d = App.active;
  const count = d ? d.pageObjs.reduce((a, objs) => a + objs.filter((o) => o.type === 'redact').length, 0) : 0;
  if (!count || redactBarDismissed) {
    redactBar?.remove();
    redactBar = null;
    return;
  }
  if (!redactBar) {
    const apply = el('button', { class: 'btn small primary', html: `${icon('shield')}${esc(t('app.redact.apply'))}` });
    apply.onclick = () => runAction('protect.applyRedactions');
    const close = el('button', { class: 'icon-btn', title: t('app.redact.hide'), html: icon('x') });
    close.onclick = () => { redactBarDismissed = true; updateRedactBar(); };
    redactBar = el('div', { class: 'redact-bar' },
      el('span', { class: 'rb-ic', html: icon('triangle-alert') }),
      el('div', { class: 'rb-text' }, el('b', { class: 'rb-count' }), el('span', { class: 'rb-rest', text: t('app.redact.text') })),
      apply, close);
    $('#docs').append(redactBar);
  }
  redactBar.querySelector('.rb-count').textContent = t('app.redact.count', { count });
}

// ---------------- otomatik kaydet ----------------
let autoSaveTimer = null;
export function setAutoSave(on) {
  saveSetting({ autoSave: !!on });
  paintAutoSave();
  if (on) scheduleAutoSave();
}
function paintAutoSave() {
  const on = !!App.settings.autoSave;
  const btn = $('#autosave-btn');
  if (btn) {
    btn.classList.toggle('on', !!on);
    btn.querySelector('.as-label').textContent = t('app.autosave');
    btn.querySelector('.as-state').textContent = on ? t('app.autosave.on') : t('app.autosave.off');
    btn.title = on ? t('app.autosave.onTip') : t('app.autosave.offTip');
  }
}
function scheduleAutoSave() {
  if (!App.settings.autoSave) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    for (const d of App.docs) {
      // Claude'un değiştirdiği belge otomatik kaydedilmez: kullanıcı kendisi kaydedene kadar bekler (claude.js)
      if (!d.dirty || !d.path || d.readOnlyReason || d.claudeHold) continue;
      try {
        await d.save({ quiet: true });
        toast(t('app.autosave.saved', { name: d.name }), { timeout: 1600 });
      } catch (e) {
        toast(t('app.autosave.failed', { error: e.message }), { type: 'error', timeout: 6000 });
      }
    }
  }, 2500);
}
function initAutoSave() {
  const btn = el('button', { id: 'autosave-btn', class: 'autosave-btn', html: `${icon('save')}<span class="as-label"></span><span class="as-pill"><span class="as-state"></span></span>` });
  btn.onclick = () => setAutoSave(!App.settings.autoSave);
  $('#ribbon-tabs').append(el('span', { class: 'spacer' }), btn);
  setAutoSave(!!App.settings.autoSave);
  // Kullanıcının kendi kaydı (Ctrl+S, Farklı kaydet ya da Claude'un sorduğu pencerede "Kaydet") otomatik kaydı yeniden açar
  App.on('doc:saved', (d) => { if (d) { d.claudeHold = false; d.claudeHoldNoticed = false; } });
  App.on('doc:dirty', (d) => {
    scheduleAutoSave();
    // ilk değişiklikte bir kez öner
    if (!App.settings.autoSave && !App.settings.autoSaveAsked && d?.dirty && d?.path && !d.claudeHold) {
      saveSetting({ autoSaveAsked: true });
      setTimeout(() => {
        toast(t('app.autosave.tip'), {
          timeout: 9000,
          action: { label: t('app.autosave.turnOn'), run: () => { setAutoSave(true); toast(t('app.autosave.turnedOn'), { type: 'ok' }); } },
        });
      }, 800);
    }
  });
}

// ---------------- kısayollar ----------------
function initShortcuts() {
  document.addEventListener('keydown', async (e) => {
    if (isModalOpen()) return;
    const tag = e.target.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const d = App.active;
    // Uzun bir işlem sürerken belgeyi değiştiren kısayolları yok say (geri al yığınını bozmasın)
    if (isBusy() && ((ctrl && 'zyxdsw'.includes(k) && k.length === 1) || e.key === 'Delete' || e.key === 'Backspace' || e.key.startsWith('Arrow'))) { e.preventDefault(); return; }
    if (ctrl && k === 'o') { e.preventDefault(); return runAction('file.open'); }
    // Yazı kutusu düzenlenirken de çalışır: önce düzenlemeyi bitir ki yazılan metin kaydedilsin
    if (ctrl && k === 's') { e.preventDefault(); finishTextEdit(); return runAction(e.shiftKey ? 'file.saveas' : 'file.save'); }
    if (ctrl && k === 'p') { e.preventDefault(); finishTextEdit(); return runAction('file.print'); }
    if (ctrl && k === 'w') { e.preventDefault(); return d && closeDoc(d); }
    if (ctrl && k === 'f') { e.preventDefault(); return App.openFind(window.getSelection()?.toString().trim().slice(0, 80)); }
    if (ctrl && e.key === 'Tab') {
      e.preventDefault();
      if (App.docs.length > 1) activate(App.docs[(App.docs.indexOf(d) + (e.shiftKey ? -1 : 1) + App.docs.length) % App.docs.length]);
      return;
    }
    if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); return zoom(1); }
    if (ctrl && k === '-') { e.preventDefault(); return zoom(-1); }
    if (ctrl && k === '0') { e.preventDefault(); return setScale('page-width'); }
    if (e.key === 'F4') { e.preventDefault(); return toggleSidebar(); }
    if (e.key === 'F5') { e.preventDefault(); finishTextEdit(); return runAction('tools.present'); }
    if (inField) return;
    if (ctrl && k === 'z' && d) { e.preventDefault(); return e.shiftKey ? d.redo() : d.undo(); }
    if (ctrl && k === 'y' && d) { e.preventDefault(); return d.redo(); }
    if (!d) return;
    // Sayfa düzenleyici açıkken nesne kısayolları gizli görüntüleyicideki nesnelere gitmesin;
    // Delete/Backspace seçili sayfaları siler (onay sorulur)
    if (!$('#organizer').hidden) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && d.pageSel?.size) { e.preventDefault(); return runAction('page.delete'); }
      return undefined;
    }
    if (ctrl && k === 'a' && d.selection.size) {
      e.preventDefault();
      const page = d.selectedObjs()[0].page;
      return d.setSelection(d.pageObjs[page].map((o) => o.id));
    }
    if (ctrl && k === 'c') {
      if (d.selection.size) { e.preventDefault(); return copyObjects(d); }
      return undefined; // metin kopyalama tarayıcıya kalsın
    }
    if (ctrl && k === 'x' && d.selection.size) { e.preventDefault(); copyObjects(d); return d.removeObjs([...d.selection], t('app.h.cut')); }
    if (ctrl && k === 'd' && d.selection.size) { e.preventDefault(); return duplicateSelection(d); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && d.selection.size) { e.preventDefault(); return d.removeObjs([...d.selection]); }
    if (e.key === 'Escape') {
      if (App.tool !== 'select') return setTool('select');
      if (d.selection.size) return d.setSelection([]);
    }
    if (d.selection.size && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      return nudgeSelection(d, e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    }
    if (ctrl || e.altKey) return;
    const map = { v: 'select', h: 'hand', t: 'text', e: 'edittext', p: 'ink', u: 'highlight', r: 'rect', w: 'whiteout' };
    if (map[k] && document.activeElement?.closest?.('.viewer-container, body')) { setTool(map[k]); return; }
    if (e.key === 'Home' && document.activeElement === d.container) { e.preventDefault(); d.goToPage(0); }
    if (e.key === 'End' && document.activeElement === d.container) { e.preventDefault(); d.goToPage(d.numPages - 1); }
  });

  // Ctrl + tekerlek / dokunmatik yüzey kıstırma: imleç konumunda yakınlaştır. Olaylar kare başına toplanır,
  // miktar deltaY ile orantılıdır (bir fare tıkı ≈ bir adım ×1.1) ve yeniden çizim kısa bir gecikmeyle yapılır.
  let wheelAcc = 0;
  let wheelRaf = 0;
  let wheelOrigin = null;
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !App.active) return;
    if (!e.target.closest('.viewer-container')) return;
    e.preventDefault();
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    wheelAcc = Math.max(-1000, Math.min(1000, wheelAcc));
    wheelOrigin = [e.clientX, e.clientY];
    if (wheelRaf) return;
    wheelRaf = requestAnimationFrame(() => {
      wheelRaf = 0;
      const d = App.active;
      if (!d?.viewer) { wheelAcc = 0; return; }
      const factor = Math.pow(1.1, -wheelAcc / 100);
      const cur = d.viewer.currentScale || 1;
      if (Math.round(cur * factor * 100) === Math.round(cur * 100)) return; // pdf.js %1'e yuvarlar: biriktirmeye devam
      wheelAcc = 0;
      d.viewer.updateScale({ scaleFactor: factor, drawingDelay: 300, origin: wheelOrigin });
    });
  }, { passive: false });
}

// ---------------- nesne pano işlemleri ----------------
let objClipboard = null;
function copyObjects(d) {
  const sel = d.selectedObjs();
  objClipboard = { t: Date.now(), items: sel.map((s) => ({ obj: JSON.parse(JSON.stringify(s.obj)), asset: s.obj.assetId ? d.assets.get(s.obj.assetId) : null })) };
  toast(t('app.copiedObjs', { count: sel.length }), { timeout: 1200 });
}
function duplicateSelection(d) {
  const sel = d.selectedObjs();
  if (!sel.length) return;
  d.snapshot(t('app.h.duplicate'));
  const ids = [];
  for (const s of sel) {
    const o = JSON.parse(JSON.stringify(s.obj));
    o.id = Math.random().toString(36).slice(2);
    shift(o, 12, 12);
    d.pageObjs[s.page].push(o);
    ids.push(o.id);
  }
  d.setSelection(ids);
}
function shift(o, dx, dy) {
  if (o.x1 != null) { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; return; }
  o.x += dx; o.y += dy;
  if (o.paths) o.paths = o.paths.map((p) => p.map((v, i) => v + (i % 2 ? dy : dx)));
  if (o.rects) o.rects = o.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  if (o.cover) o.cover = null;
}

async function pasteObjects(d, sysItems) {
  const page = d.currentPageIndex;
  // Sistem panosunda görsel varsa ve bizim kopyamızdan yeni ise onu yapıştır
  const imgFile = sysItems?.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
  if (imgFile) {
    const blob = imgFile.getAsFile();
    const dataURL = await blobToDataURL(blob);
    const img = await loadImage(dataURL);
    const { insertImageObject } = await import('./insert.js');
    return insertImageObject(d, page, dataURL, img.naturalWidth, img.naturalHeight, { label: t('app.h.pasteImage') });
  }
  if (objClipboard) {
    d.snapshot(t('app.h.paste'));
    const ids = [];
    for (const it of objClipboard.items) {
      const o = JSON.parse(JSON.stringify(it.obj));
      o.id = Math.random().toString(36).slice(2);
      if (it.asset) o.assetId = d.addAsset(it.asset.dataURL, it.asset.w, it.asset.h);
      shift(o, 14, 14);
      d.pageObjs[page].push(o);
      ids.push(o.id);
    }
    d.setSelection(ids);
    return undefined;
  }
  const text = sysItems?.find((it) => it.kind === 'string' && it.type === 'text/plain');
  if (text) {
    text.getAsString((s) => {
      if (!s.trim()) return;
      const dims = pageDims(d, page);
      d.addObj(page, { type: 'text', ...App.defaults.text, x: 40, y: 60, w: Math.min(360, dims.w - 80), text: s }, { label: t('app.h.pasteText') });
    });
  }
  return undefined;
}

// ---------------- sağ tık menüsü ----------------
function initContextMenu() {
  docsHost().addEventListener('contextmenu', async (e) => {
    const d = App.active;
    if (!d || !e.target.closest('.viewer-container')) return;
    if (isEditingText()) return; // yazı düzenlerken tarayıcı menüsü yerine kopyala/yapıştır kısayolları
    e.preventDefault();
    const i = pageIndexFromTarget(e.target);
    const objEl = e.target.closest('.pu-obj');
    const selText = window.getSelection()?.toString() || '';
    const items = [];
    if (objEl) {
      const id = objEl.dataset.id;
      if (!d.selection.has(id)) d.setSelection([id]);
      const f = d.findObj(id);
      items.push({ header: t('app.m.object') });
      if (f?.obj.type === 'text') items.push({ label: t('app.m.editText'), icon: 'type', run: () => import('./overlay.js').then((m) => m.startTextEdit(d, id, { selectAll: false })) });
      if (f?.obj.type === 'image') items.push({ label: t('app.m.copyImageClip'), icon: 'clipboard-copy', run: async () => { const a = d.assets.get(f.obj.assetId); const img = await loadImage(a.dataURL); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); await copyImageToClipboard(c); toast(t('app.m.imageCopied'), { type: 'ok' }); } });
      if (f?.obj.type === 'image' || f?.obj.type === 'text') items.push({ label: t('app.m.copyAllPages'), icon: 'files', run: () => import('./insert.js').then((m) => m.copyToAllPages(d, id)) });
      items.push(
        { label: t('app.m.copy'), icon: 'copy', kbd: 'Ctrl+C', run: () => copyObjects(d) },
        { label: t('app.h.duplicate'), icon: 'copy-plus', kbd: 'Ctrl+D', run: () => duplicateSelection(d) },
        { label: t('app.h.front'), icon: 'bring-to-front', run: () => reorderSel(d, 1) },
        { label: t('app.h.back'), icon: 'send-to-back', run: () => reorderSel(d, -1) },
        '-',
        { label: t('common.delete'), icon: 'trash-2', kbd: 'Del', danger: true, run: () => d.removeObjs([...d.selection]) },
      );
      contextMenu(e.clientX, e.clientY, items);
      return;
    }
    if (selText.trim()) {
      items.push(
        { label: t('app.m.copyText'), icon: 'copy', kbd: 'Ctrl+C', run: () => { navigator.clipboard.writeText(selText); toast(t('app.m.textCopied'), { type: 'ok', timeout: 1200 }); } },
        { label: t('app.m.highlight'), icon: 'highlighter', run: () => markupFromSelection(d, 'highlight') },
        { label: t('app.m.underline'), icon: 'underline', run: () => markupFromSelection(d, 'underline') },
        { label: t('app.m.strike'), icon: 'strikethrough', run: () => markupFromSelection(d, 'strike') },
        { label: t('app.m.search'), icon: 'search', run: () => App.openFind(selText.trim().slice(0, 80)) },
        { label: t('app.m.redactSel'), icon: 'square', run: () => redactSelection(d) },
        '-',
      );
    }
    if (i >= 0) {
      const p = eventToPage(d, e, i);
      const { findImagesAt } = await import('./images.js');
      const hits = await findImagesAt(d, i, p.x, p.y).catch(() => []);
      if (hits.length) {
        const img = hits[0];
        items.push({ header: t('app.m.imageHeader', { w: img.width, h: img.height }) },
          { label: t('app.m.copyImage'), icon: 'clipboard-copy', run: () => import('./images.js').then((m) => m.copyImage(d, i, img)) },
          { label: t('app.m.saveImageAs'), icon: 'image-down', run: () => import('./images.js').then((m) => m.saveImage(d, i, img)) },
          { label: t('app.m.copyRaw'), icon: 'layers', run: () => import('./images.js').then((m) => m.copyImage(d, i, img, { mode: 'raw' })) },
          { label: t('app.m.removeImage'), icon: 'eraser', run: () => d.addObj(i, { type: 'whiteout', x: img.box.x, y: img.box.y, w: img.box.w, h: img.box.h, color: '#ffffff' }, { label: t('app.h.coverImage') }) },
          '-');
      }
      items.push(
        { label: t('app.m.copyArea'), icon: 'square-dashed', run: () => setTool('snapshot') },
        { label: t('app.m.copyPage'), icon: 'image', run: () => import('./images.js').then((m) => m.copyPageImage(d, i)) },
        { label: t('app.m.saveAllImages'), icon: 'image-down', run: () => import('./images.js').then((m) => m.exportImages(d, [i])) },
        '-',
        { label: t('app.m.addTextHere'), icon: 'type', run: () => { d.addObj(i, { type: 'text', ...App.defaults.text, x: p.x, y: p.y - 6, w: 200, text: '' }); import('./overlay.js').then((m) => requestAnimationFrame(() => m.startTextEdit(d, [...d.selection][0]))); } },
        { label: t('app.m.signHere'), icon: 'signature', run: () => runAction('insert.signature') },
        { label: t('app.h.paste'), icon: 'clipboard-copy', kbd: 'Ctrl+V', run: async () => { try { const items2 = await navigator.clipboard.read(); const fake = []; for (const it of items2) { const t = it.types.find((x) => x.startsWith('image/')); if (t) { const b = await it.getType(t); fake.push({ kind: 'file', type: t, getAsFile: () => b }); } } pasteObjects(d, fake.length ? fake : null); } catch (err) { pasteObjects(d, null); } } },
        '-',
        { label: t('app.m.rotatePage'), icon: 'rotate-cw', run: () => import('./pageops.js').then((m) => m.rotatePages(d, [i], 90)) },
        { label: t('app.m.deletePage'), icon: 'trash-2', danger: true, run: () => import('./pageops.js').then((m) => m.deletePages(d, [i])) },
      );
    }
    contextMenu(e.clientX, e.clientY, items);
  });
}

function reorderSel(d, dir) {
  const sel = d.selectedObjs();
  if (!sel.length) return;
  d.snapshot(dir > 0 ? t('app.h.front') : t('app.h.back'));
  const pages = new Set(sel.map((s) => s.page));
  for (const p of pages) {
    const ids = new Set(sel.filter((s) => s.page === p).map((s) => s.obj.id));
    const moving = d.pageObjs[p].filter((o) => ids.has(o.id));
    const rest = d.pageObjs[p].filter((o) => !ids.has(o.id));
    d.pageObjs[p] = dir > 0 ? [...rest, ...moving] : [...moving, ...rest];
    renderLayer(d, p);
  }
}

function redactSelection(d) {
  const byPage = selectionRects(d);
  if (!byPage) return;
  let first = true;
  for (const [i, rects] of byPage) {
    for (const r of rects) {
      const o = { type: 'redact', x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
      if (first) { d.addObj(i, o, { label: t('app.h.redact'), select: false }); first = false; } else { o.id = Math.random().toString(36).slice(2); d.pageObjs[i].push(o); renderLayer(d, i); }
    }
  }
  window.getSelection().removeAllRanges();
}

// ---------------- sürükle-bırak ve yapıştır ----------------
function initDnD() {
  let depth = 0;
  let overlay = null;
  const show = (on) => {
    document.body.classList.toggle('dragging', on);
    if (on && !overlay) { overlay = el('div', { class: 'drop-overlay', text: t('app.dropOverlay') }); document.body.append(overlay); }
    if (!on && overlay) { overlay.remove(); overlay = null; }
  };
  // Açık bir pencere (soru, ilerleme) varken bırakılan dosyalar işlenmez; tarayıcı da dosyayı açmasın diye preventDefault sürer
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files') && !isModalOpen()) { depth++; show(true); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    depth = 0;
    show(false);
    if (isModalOpen()) { toast(t('app.closeModalFirst'), { type: 'warn' }); return; }
    if (isBusy()) { toast(t('app.busyDrop'), { type: 'warn' }); return; }
    const files = [...e.dataTransfer.files];
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
    const imgs = files.filter((f) => /^image\//.test(f.type));
    const conv = await import('./convert.js');
    const words = files.filter((f) => conv.isWordFile(f.name));
    if (words.length) {
      const list = await Promise.all(words.map(async (f) => {
        const p = window.pu.pathForFile(f);
        return p ? { path: p, name: f.name } : { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
      }));
      conv.wordToPdf(list).catch((err) => { if (!err?.cancelled) toast(t('common.error', { error: err?.message || err }), { type: 'error', timeout: 7000 }); });
    }
    if (pdfs.length) {
      const list = [];
      for (const f of pdfs) {
        const p = window.pu.pathForFile(f);
        if (p) { try { list.push(await window.pu.readPdf(p)); continue; } catch (err) { /* aşağıda bayt olarak dene */ } }
        list.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), size: f.size });
      }
      await openFiles(list);
    }
    if (imgs.length) {
      const d = App.active;
      const i = d ? pageIndexFromTarget(e.target) : -1;
      const { insertImageObject } = await import('./insert.js');
      if (d && i >= 0) {
        const p = eventToPage(d, e, i);
        for (const f of imgs) {
          const dataURL = await blobToDataURL(f);
          const img = await loadImage(dataURL);
          insertImageObject(d, i, dataURL, img.naturalWidth, img.naturalHeight, { at: p });
        }
      } else if (!pdfs.length) {
        const { imagesToPdf } = await import('./convert.js');
        imagesToPdf(imgs);
      }
    }
  });
  document.addEventListener('paste', (e) => {
    const d = App.active;
    if (!d || isModalOpen()) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    e.preventDefault();
    pasteObjects(d, [...(e.clipboardData?.items || [])]);
  });
}

// ---------------- bölge olayları ----------------
function initRegionEvents() {
  const guard = (p) => p.catch((e) => { if (!e?.cancelled) { console.error(e); toast(t('common.error', { error: e?.message || e }), { type: 'error', timeout: 7000 }); } });
  App.on('region:snapshot', (d, i, r) => guard(import('./images.js').then((m) => m.copyRegion(d, i, r))));
  // Alan OCR'ı Pro'dur; olay yalnızca kullanıcının sürüklemesiyle gelir (ücretsizse yükseltme penceresi, işlem yok)
  App.on('region:ocr', (d, i, r) => { if (requirePro('ocr')) guard(import('./ocr.js').then((m) => m.ocrRegion(d, i, r))); });
  App.on('region:crop', (d, i, r) => guard(import('./pageops.js').then((m) => m.cropFromRegion(d, i, r))));
}

// ---------------- kapanış ----------------
function initClose() {
  // Pencerenin X'ine ikinci kez basılırsa soruları üst üste açma
  let closing = false;
  window.pu.on('close-request', async () => {
    if (closing) return;
    closing = true;
    try {
      finishTextEdit();
      for (const d of [...App.docs]) {
        if (!d.dirty || !App.docs.includes(d)) continue;
        const ok = await closeDoc(d);
        if (!ok) return;
      }
      window.pu.confirmClose();
    } finally {
      closing = false;
    }
  });
  window.pu.on('open-files', (paths) => {
    window.pu.log(`open-files olayı geldi: ${(paths || []).join(' | ')}`);
    openPaths(paths).catch((e) => window.pu.log(`open-files hatası: ${e?.stack || e?.message || e}`));
  });
}

// ---------------- başlat ----------------
function initErrorLog() {
  window.addEventListener('error', (e) => {
    window.pu.log(`hata: ${e.message} @ ${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r?.cancelled) return;
    window.pu.log(`yakalanmamış: ${r?.stack || r?.message || r}`);
    toast(t('common.unexpected', { error: r?.message || r }), { type: 'error', timeout: 6000 });
  });
}

async function main() {
  const boot = await window.pu.ready();
  App.settings = boot.settings || {};
  App.version = boot.version;
  // Kayıtlı seçim varsa onu, yoksa (ilk açılış) sistem temasını kullan; sistem değişirse seçim yapılmadıysa izle
  const hasChoice = () => App.settings.theme === 'dark' || App.settings.theme === 'light';
  const sysMq = window.matchMedia('(prefers-color-scheme: dark)');
  setTheme(hasChoice() ? App.settings.theme : (sysMq.matches ? 'dark' : 'light'), { persist: false });
  sysMq.addEventListener('change', (e) => { if (!hasChoice()) setTheme(e.matches ? 'dark' : 'light', { persist: false }); });
  $('#theme-btn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  App.followSystemTheme = () => setTheme(sysMq.matches ? 'dark' : 'light', { persist: false });
  $('#settings-btn').innerHTML = icon('settings');
  $('#settings-btn').onclick = () => runAction('app.settings');
  applyDom();
  try {
    await initLibs();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font:14px Segoe UI">${esc(t('app.libsFailed', { error: e.message }))}</div>`;
    throw e;
  }
  initFonts(boot.fonts);
  App.defaults.text.font = App.settings.textFont || defaultFamily();
  if (App.settings.defaults) {
    for (const [k, v] of Object.entries(App.settings.defaults)) if (App.defaults[k]) Object.assign(App.defaults[k], v);
  }
  buildRibbon();
  initOptbar();
  initSidebar();
  initTools();
  initFind();
  initStatusbar();
  initShortcuts();
  initContextMenu();
  initDnD();
  initRegionEvents();
  initClose();
  initErrorLog();
  initAutoSave();
  initClaude();
  await initPro();
  await initUpdates({ bootHasFiles: !!boot.files?.length });
  App.on('history', () => updateRedactBar());
  App.on('active', () => { redactBarDismissed = false; updateRedactBar(); });
  App.on('selection', () => updateRedactBar());
  renderTabs();
  renderStart();
  activate(null);
  if (App.settings.sidebar) $('#sidebar').hidden = false;
  onLang(onLanguageChanged);
  const i18n = await import('./i18n.js');
  window.__pu = { App, openFiles, openPaths, activate, closeDoc, setTool, runAction, i18n };
  if (boot.files?.length) await openPaths(boot.files);
  document.body.dataset.ready = '1';
  // İlk açılış tanıtım turu (bir kez; Ayarlar > Turu başlat ile yeniden). Testte yalnızca PDFUSTA_TOUR=1 ile.
  if (!App.settings.tourDone && (!boot.test || boot.tour)) {
    setTimeout(() => import('./tour.js').then((m) => m.startTour({ auto: true })).catch((e) => window.pu.log(`tur açılamadı: ${e?.message || e}`)), 600);
  }
}

// Dil değişti: kalıcı arayüzü yeniden çiz (açık belgeler ve düzenlemeler olduğu gibi kalır)
function onLanguageChanged() {
  relabelRibbon();
  renderTabs();
  renderStart();
  updateStatus();
  updateHint();
  updateTitle();
  paintAutoSave();
  if (redactBar) { redactBar.remove(); redactBar = null; }
  updateRedactBar();
  $('#find-count').textContent = '';
}

export { renderStart, renderTabs, baseName };
main();
