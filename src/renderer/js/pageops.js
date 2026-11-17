// Sayfa işlemleri: sil, döndür, taşı, çoğalt, boş sayfa, dosyadan ekle, birleştir, böl, çıkar, kırp, boyutlandır.
import { App } from './state.js';
import { $, el, toast, modal, promptBox, confirmBox, parseRanges, rangesToText, baseName, withProgress, fmtBytes, field, select } from './util.js';
import { icon } from './icons.js';
import { pageRange, infoBox } from './assist.js';
import { PDFLib, loadPdfLib, savePdfLib, removePagesClean, copyPagesClean } from './pdfcore.js';
import { t } from './i18n.js';

// ---------------- hedef sayfalar ----------------
function selectedPages(d) {
  if (d.pageSel && d.pageSel.size && !$('#organizer').hidden) return [...d.pageSel].sort((a, b) => a - b);
  return null;
}

async function askPages(d, title, verb) {
  const sel = selectedPages(d);
  if (sel) return sel;
  const v = await promptBox(t('pageops.askPages', { verb, total: d.numPages }), { title, value: String(d.currentPageIndex + 1), ok: verb });
  if (v == null) return null;
  const pages = parseRanges(v, d.numPages);
  if (!pages.length) { toast(t('pageops.noValidPage'), { type: 'warn' }); return null; }
  return pages;
}

const identity = (n) => Array.from({ length: n }, (_, k) => k);

// ---------------- sil ----------------
export async function deletePages(d, pages, { confirm = true, quiet = false } = {}) {
  if (pages.length >= d.numPages) { if (!quiet) toast(t('pageops.cannotDeleteAll'), { type: 'warn' }); return false; }
  if (confirm && pages.length > 1 && !(await confirmBox(t('pageops.confirmDelete', { count: pages.length, range: rangesToText(pages) }), { title: t('pageops.deletePagesTitle'), ok: t('common.delete'), danger: true }))) return false;
  const del = new Set(pages);
  await d.structural(t('pageops.labelDelete'), (lib) => {
    const n = lib.getPageCount();
    removePagesClean(lib, [...del]); // form alanları ve sayfaya giden referanslar da gider
    return identity(n).filter((k) => !del.has(k));
  });
  d.pageSel = new Set();
  if (!quiet) toast(t('pageops.deleted', { count: pages.length }), { type: 'ok', action: { label: t('pageops.undo'), run: () => d.undo() } });
  return true;
}
export async function deleteSelectedPrompt(d) {
  const pages = await askPages(d, t('pageops.deletePagesTitle'), t('common.delete'));
  if (pages) await deletePages(d, pages);
}

// ---------------- döndür ----------------
export async function rotatePages(d, pages, deg) {
  const { degrees } = PDFLib();
  await d.structural(deg > 0 ? t('pageops.rotateRight') : t('pageops.rotateLeft'), (lib) => {
    for (const i of pages) {
      const p = lib.getPage(i);
      p.setRotation(degrees((((p.getRotation().angle + deg) % 360) + 360) % 360));
    }
    return null;
  }, { flattenPages: pages });
}
export async function rotateSelectedLeft(d) { const p = selectedPages(d) || [d.currentPageIndex]; await rotatePages(d, p, -90); }
export async function rotateSelectedRight(d) { const p = selectedPages(d) || [d.currentPageIndex]; await rotatePages(d, p, 90); }

// ---------------- taşı / sırala ----------------
export async function reorderPages(d, order, label = t('pageops.movePages')) {
  if (order.every((k, i) => k === i)) return;
  await d.structural(label, (lib) => {
    reorderTree(lib, order);
    return order;
  });
}

// Sayfa ağacını tek düzeye indirip Kids dizisini yeni sıraya göre yeniden yazar (miras alınan öznitelikler korunur)
export function reorderTree(lib, order) {
  const { PDFName } = PDFLib();
  const pages = lib.getPages();
  const refs = pages.map((p) => p.ref);
  for (const p of pages) {
    for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      const n = PDFName.of(k);
      if (!p.node.get(n)) { const v = p.node.getInheritableAttribute(n); if (v) p.node.set(n, v); }
    }
  }
  const rootRef = lib.catalog.get(PDFName.of('Pages'));
  const root = lib.catalog.Pages();
  root.set(PDFName.of('Kids'), lib.context.obj(order.map((k) => refs[k])));
  root.set(PDFName.of('Count'), lib.context.obj(order.length));
  for (const k of order) pages[k].node.set(PDFName.of('Parent'), rootRef);
  lib.pageCache?.invalidate?.();
}

// seçili sayfaları hedef konuma taşı (target: yeni dizideki ekleme noktası, eski indeks uzayında)
export async function movePages(d, pages, target) {
  const n = d.numPages;
  const set = new Set(pages);
  const rest = identity(n).filter((k) => !set.has(k));
  const before = rest.filter((k) => k < target).length;
  const order = [...rest.slice(0, before), ...pages, ...rest.slice(before)];
  await reorderPages(d, order);
  d.pageSel = new Set(pages.map((_, j) => before + j));
}

export async function reversePages(d) {
  await reorderPages(d, identity(d.numPages).reverse(), t('pageops.reverse'));
  toast(t('pageops.reversed'), { type: 'ok' });
}

// ---------------- çoğalt ----------------
export async function duplicateSelected(d) {
  const pages = selectedPages(d) || [d.currentPageIndex];
  await d.structural(t('pageops.duplicate'), async (lib) => {
    const copies = await lib.copyPages(lib, pages);
    const order = identity(lib.getPageCount());
    // her kopyayı kaynağının hemen arkasına ekle (sondan başa)
    for (let j = pages.length - 1; j >= 0; j--) {
      const at = pages[j] + 1;
      lib.insertPage(at, copies[j]);
      order.splice(at, 0, pages[j]);
    }
    return order;
  });
  toast(t('pageops.duplicated', { count: pages.length }), { type: 'ok' });
}

// ---------------- boş sayfa ----------------
const SIZES = { A4: [595.28, 841.89], A3: [841.89, 1190.55], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008] };

// Sağ tık menüsünden hızlı boş sayfa (ayar sormadan, mevcut sayfa boyutunda)
export async function insertBlankQuick(d, at, where = 'after') {
  const info = await d.pageInfo(at);
  const [x0, y0, x1, y1] = info.view;
  const dims = info.rotate % 180 ? [y1 - y0, x1 - x0] : [x1 - x0, y1 - y0];
  const insertAt = where === 'before' ? at : at + 1;
  await d.structural(t('pageops.insertBlank'), (lib) => {
    const order = identity(lib.getPageCount());
    lib.insertPage(insertAt, dims);
    order.splice(insertAt, 0, null);
    return order;
  });
  d.goToPage(insertAt);
  toast(t('pageops.blankAddedAt', { pos: insertAt + 1 }), { type: 'ok', action: { label: t('pageops.undo'), run: () => d.undo() } });
}

export async function insertBlankDialog(d, anchor, { at = null } = {}) {
  const cur = at != null ? at : d.currentPageIndex;
  const where = select([
    { value: 'after', label: t('pageops.whereAfter') },
    { value: 'before', label: t('pageops.whereBefore') },
    { value: 'end', label: t('pageops.whereEnd') },
    { value: 'start', label: t('pageops.whereStart') },
  ], 'after');
  const pageNo = el('input', { class: 'input', type: 'number', min: 1, max: d.numPages, value: cur + 1 });
  const size = select([{ value: 'same', label: t('pageops.sizeSame') }, ...Object.keys(SIZES).map((k) => ({ value: k, label: k })), { value: 'A4L', label: t('pageops.sizeA4L') }], 'same');
  const count = el('input', { class: 'input', type: 'number', min: 1, max: 200, value: 1 });
  const info = el('div', { class: 'range-info' });
  const update = () => {
    const n = Math.max(1, Math.min(200, +count.value || 1));
    const no = Math.max(1, Math.min(d.numPages, +pageNo.value || 1));
    const posText = { after: t('pageops.posAfter', { no, next: no + 1 }), before: t('pageops.posBefore', { no }), end: t('pageops.posEnd', { pos: d.numPages + 1 }), start: t('pageops.posStart') }[where.value];
    info.textContent = t('pageops.blankInfo', { count: n, pos: posText });
  };
  [where, pageNo, count].forEach((x) => x.addEventListener('input', update));
  where.addEventListener('change', () => { pageNo.disabled = where.value === 'end' || where.value === 'start'; update(); });
  update();
  const res = await modal({
    title: t('pageops.insertBlank'), width: 520,
    body: el('div', {},
      infoBox('file-plus', null, t('pageops.blankIntro')),
      field(t('pageops.location'), where),
      field(t('pageops.refPage'), pageNo, t('pageops.refPageHint', { max: d.numPages })),
      el('div', { class: 'row' }, field(t('pageops.pageSize'), size), field(t('pageops.howMany'), count)),
      el('div', { class: 'preview-line' }, el('span', { class: 'ib-ic', html: icon('info') }), info)),
    buttons: [{ label: t('common.cancel') }, { label: t('pageops.add'), primary: true, value: true }],
  });
  if (!res) return;
  const ref = Math.max(0, Math.min(d.numPages - 1, (+pageNo.value || 1) - 1));
  const pinfo = await d.pageInfo(ref);
  let dims;
  if (size.value === 'same') {
    const [x0, y0, x1, y1] = pinfo.view;
    dims = pinfo.rotate % 180 ? [y1 - y0, x1 - x0] : [x1 - x0, y1 - y0];
  } else if (size.value === 'A4L') dims = [841.89, 595.28];
  else dims = SIZES[size.value];
  const n = Math.max(1, Math.min(200, +count.value || 1));
  const insertAt = { after: ref + 1, before: ref, end: d.numPages, start: 0 }[where.value];
  await d.structural(t('pageops.insertBlank'), (lib) => {
    const order = identity(lib.getPageCount());
    for (let k = 0; k < n; k++) { lib.insertPage(insertAt, dims); order.splice(insertAt, 0, null); }
    return order;
  });
  d.goToPage(insertAt);
  toast(t('pageops.blankAdded', { count: n, pos: insertAt + 1 }), { type: 'ok', action: { label: t('pageops.undo'), run: () => d.undo() } });
}

// ---------------- dosyadan sayfa ekle ----------------
export async function loadExternal(file) {
  // Parola bir kez soruldu: aynı dosya yeniden yüklenirken (birleştir) tekrar sorma
  if (file.password != null) return loadPdfLib(file.bytes, file.password);
  try {
    return await loadPdfLib(file.bytes);
  } catch (e) {
    if (!/encrypt|password|parola/i.test(e.message)) throw e;
    const pw = await promptBox(t('pageops.passwordPrompt', { name: file.name }), { title: t('pageops.passwordTitle'), type: 'password' });
    if (pw == null) throw Object.assign(new Error(t('pageops.noPassword')), { cancelled: true });
    const lib = await loadPdfLib(file.bytes, pw);
    file.password = pw;
    return lib;
  }
}

export async function insertFromFile(d) {
  const files = await window.pu.openPdfDialog({ multi: true, title: t('pageops.pickPdfs') });
  if (!files.length) return;
  const cur = d.currentPageIndex;
  const pos = select([{ value: 'end', label: t('pageops.docEnd') }, { value: 'after', label: t('pageops.afterPageN', { no: cur + 1 }) }, { value: 'before', label: t('pageops.beforePageN', { no: cur + 1 }) }, { value: 'start', label: t('pageops.docStart') }], 'end');
  const range = el('input', { class: 'input', placeholder: t('pageops.allPlaceholder') });
  const res = await modal({
    title: t('pageops.insertFromFile'),
    body: el('div', {}, el('p', { class: 'muted', text: files.map((f) => f.name).join(', ') }), field(t('pageops.location'), pos), files.length === 1 ? field(t('pageops.pagesToAdd'), range, t('pageops.pagesToAddHint')) : null),
    buttons: [{ label: t('common.cancel') }, { label: t('pageops.add'), primary: true, value: true }],
  });
  if (!res) return;
  const srcs = [];
  for (const f of files) srcs.push({ f, lib: await loadExternal(f) });
  let at = { after: cur + 1, before: cur, end: d.numPages, start: 0 }[pos.value];
  const startAt = at;
  let added = 0;
  await d.structural(t('pageops.insertFromFile'), async (lib) => {
    const order = identity(lib.getPageCount());
    for (const { lib: src } of srcs) {
      const n = src.getPageCount();
      const idx = srcs.length === 1 && range.value.trim() ? parseRanges(range.value, n) : identity(n);
      const copies = await copyPagesClean(lib, src, idx);
      for (const c of copies) { lib.insertPage(at, c); order.splice(at, 0, null); at++; added++; }
    }
    return order;
  });
  d.goToPage(startAt);
  toast(t('pageops.pagesAdded', { count: added }), { type: 'ok' });
}

// ---------------- birleştir (dosyalar) ----------------
export async function mergeFilesDialog() {
  const list = [];
  const d = App.active;
  if (d) list.push({ name: d.name, doc: d, pages: d.numPages });
  const ul = el('div', { class: 'merge-list', style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflow: 'auto', margin: '6px 0 12px' } });
  const render = () => {
    ul.replaceChildren(...(list.length ? list.map((it, i) => {
      const row = el('div', { class: 'recent-item', style: { border: '1px solid var(--border)', background: 'var(--panel-2)' }, html: `${icon('file-text')}<div class="col"><div></div><div class="path"></div></div>` });
      row.querySelector('.col div').textContent = `${i + 1}. ${it.name}`;
      row.querySelector('.path').textContent = `${it.pages != null ? t('pageops.nPages', { count: it.pages }) : t('pageops.unknownPages')}${it.size ? ` · ${fmtBytes(it.size)}` : ''}${it.doc ? ` · ${t('pageops.openDoc')}` : ''}`;
      const btn = (ic, title, fn, dis) => { const b = el('button', { class: 'icon-btn', title, html: icon(ic), disabled: dis }); b.onclick = (e) => { e.stopPropagation(); fn(); render(); }; return b; };
      row.append(
        btn('chevron-up', t('pageops.moveUp'), () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; }, i === 0),
        btn('chevron-down', t('pageops.moveDown'), () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; }, i === list.length - 1),
        btn('x', t('pageops.removeFromList'), () => list.splice(i, 1)),
      );
      return row;
    }) : [el('div', { class: 'empty-note', text: t('pageops.mergeEmpty') })]));
  };
  const addBtn = el('button', { class: 'btn', html: `${icon('plus')}${t('pageops.addPdf')}` });
  addBtn.onclick = async () => {
    const files = await window.pu.openPdfDialog({ multi: true, title: t('pageops.mergePickTitle') });
    for (const f of files) {
      let pages = null;
      try { pages = (await loadExternal(f)).getPageCount(); f.lib = null; } catch (e) { if (e.cancelled) continue; toast(t('pageops.readFailed', { name: f.name, error: e.message }), { type: 'error' }); continue; }
      list.push({ name: f.name, file: f, pages, size: f.size });
    }
    render();
  };
  render();
  const openTab = el('input', { type: 'checkbox', checked: true });
  const res = await modal({
    title: t('pageops.mergeTitle'), width: 560,
    body: el('div', {}, el('p', { class: 'muted', text: t('pageops.mergeNote') }), addBtn, ul, el('label', { class: 'checkline' }, openTab, t('pageops.mergeOpenTab'))),
    buttons: [{ label: t('common.cancel') }, { label: t('pageops.merge'), primary: true, run: () => (list.length < 2 ? (toast(t('pageops.mergeMin'), { type: 'warn' }), false) : true) }],
  });
  if (!res) return;
  const bytes = await withProgress(t('pageops.merging'), async (p) => {
    const { PDFDocument } = PDFLib();
    const out = await PDFDocument.create();
    for (let k = 0; k < list.length; k++) {
      p.check();
      p.set(k / list.length, list[k].name);
      const it = list[k];
      const src = it.doc ? await loadPdfLib(await it.doc.buildBytes({ encrypt: false })) : await loadExternal(it.file);
      const copies = await copyPagesClean(out, src, src.getPageIndices());
      copies.forEach((c) => out.addPage(c));
    }
    p.set(1, t('pageops.saving'));
    return savePdfLib(out);
  });
  const name = t('pageops.mergedName', { name: baseName(list[0].name) });
  if (openTab.checked) {
    const { openBytes } = await import('./app.js');
    const nd = await openBytes(bytes, name);
    nd?.markDirty();
  } else {
    const target = await window.pu.saveDialog({ defaultName: name });
    if (target) { await window.pu.writeFile(target, bytes, { recent: true }); toast(t('pageops.saved', { name: target }), { type: 'ok', action: { label: t('pageops.showInFolder'), run: () => window.pu.showItem(target) } }); }
  }
}

// ---------------- çıkar ----------------
export async function buildSubset(d, groups, onProgress) {
  const full = await loadPdfLib(await d.buildBytes({ encrypt: false }));
  const { PDFDocument } = PDFLib();
  const outs = [];
  for (let g = 0; g < groups.length; g++) {
    onProgress && onProgress(g / groups.length);
    const out = await PDFDocument.create();
    const copies = await copyPagesClean(out, full, groups[g]); // bağlantılar seçilmeyen sayfaları sürüklemesin
    copies.forEach((c) => out.addPage(c));
    const title = full.getTitle();
    if (title) out.setTitle(title);
    outs.push(await savePdfLib(out));
  }
  return outs;
}

export async function extractDialog(d) {
  const sel = selectedPages(d);
  const range = pageRange(d, { label: t('pageops.extractPages'), value: sel ? rangesToText(sel) : String(d.currentPageIndex + 1) });
  const mode = select([
    { value: 'tab', label: t('pageops.outTab') },
    { value: 'file', label: t('pageops.outFile') },
    { value: 'each', label: t('pageops.outEach') },
  ], 'tab');
  const del = el('input', { type: 'checkbox' });
  const res = await modal({
    title: t('pageops.extractTitle'), width: 560,
    body: el('div', {},
      infoBox('file-output', t('pageops.whatDoes'), t('pageops.extractInfo')),
      range.node,
      field(t('pageops.output'), mode),
      el('label', { class: 'checkline' }, del, t('pageops.extractDelete'))),
    buttons: [{ label: t('common.cancel') }, { label: t('pageops.extract'), primary: true, run: () => { try { range.pages(); return true; } catch (e) { toast(e.message, { type: 'warn' }); return false; } } }],
  });
  if (!res) return;
  const pages = range.pages();
  const base = baseName(d.name);
  if (mode.value === 'each') {
    const folder = await window.pu.folderDialog({ title: t('pageops.extractFolder') });
    if (!folder) return;
    const outs = await withProgress(t('pageops.extracting'), (p) => buildSubset(d, pages.map((k) => [k]), (v) => p.set(v)));
    for (let k = 0; k < outs.length; k++) await window.pu.writeInFolder(folder, t('pageops.eachName', { base, page: pages[k] + 1 }), outs[k]);
    toast(t('pageops.filesSaved', { count: outs.length }), { type: 'ok', action: { label: t('pageops.openFolder'), run: () => window.pu.openPath(folder) } });
  } else {
    const [bytes] = await withProgress(t('pageops.extracting'), () => buildSubset(d, [pages]));
    const name = t('pageops.subsetName', { base, range: rangesToText(pages).replace(/\s/g, '') });
    if (mode.value === 'tab') {
      const { openBytes } = await import('./app.js');
      const nd = await openBytes(bytes, name);
      nd?.markDirty();
    } else {
      const target = await window.pu.saveDialog({ defaultName: name });
      if (!target) return;
      await window.pu.writeFile(target, bytes);
      toast(t('pageops.saved', { name }), { type: 'ok', action: { label: t('pageops.showInFolder'), run: () => window.pu.showItem(target) } });
    }
  }
  if (del.checked && pages.length < d.numPages) await deletePages(d, pages, { confirm: false });
}

// ---------------- böl ----------------
export async function splitDialog(d) {
  const n = d.numPages;
  let mode = 'every';
  const every = el('input', { class: 'input', type: 'number', min: 1, max: n, value: Math.min(5, Math.max(1, Math.ceil(n / 2))) });
  const ranges = el('input', { class: 'input', placeholder: t('pageops.splitRangesPh') });
  const result = el('div', { class: 'range-info' });
  const groupsFor = () => {
    const out = [];
    if (mode === 'every') {
      const k = Math.max(1, Math.min(n, +every.value || 1));
      for (let s2 = 0; s2 < n; s2 += k) out.push(identity(Math.min(k, n - s2)).map((j) => s2 + j));
    } else if (mode === 'single') {
      for (let k = 0; k < n; k++) out.push([k]);
    } else {
      for (const part of ranges.value.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
        try { const g = parseRanges(part, n); if (g.length) out.push(g); } catch (e) { /* yoksay */ }
      }
    }
    return out;
  };
  const update = () => {
    const g = groupsFor();
    if (!g.length) { result.textContent = t('pageops.splitNone'); result.classList.add('bad'); return; }
    result.classList.remove('bad');
    const parts = g.slice(0, 4).map((x) => (x.length === 1 ? t('pageops.partPage', { a: x[0] + 1 }) : t('pageops.partRange', { a: x[0] + 1, b: x[x.length - 1] + 1 })));
    result.textContent = t('pageops.splitResult', { count: g.length, parts: `${parts.join(' | ')}${g.length > 4 ? ' | …' : ''}` });
  };
  const card = (val, title, sub, extra) => {
    const r = el('input', { type: 'radio', name: 'splitmode', value: val, checked: val === mode });
    const c = el('label', { class: `radio-card ${val === mode ? 'on' : ''}` }, r, el('div', { style: { flex: 1 } }, el('b', { text: title }), el('small', { text: sub }), extra || null));
    r.onchange = () => { mode = val; c.parentNode.querySelectorAll('.radio-card').forEach((x) => x.classList.toggle('on', x === c)); update(); };
    c.addEventListener('click', () => { if (!r.checked) { r.checked = true; r.dispatchEvent(new Event('change')); } });
    return c;
  };
  every.addEventListener('input', () => { mode = 'every'; update(); });
  ranges.addEventListener('input', () => { mode = 'ranges'; update(); });
  const body = el('div', {},
    infoBox('scissors', t('pageops.whatDoes'), t('pageops.splitInfo', { name: d.name, count: n })),
    el('div', { class: 'radio-list' },
      card('every', t('pageops.splitEvery'), t('pageops.splitEveryHint', { n, files: Math.ceil(n / 5) }), el('div', { style: { marginTop: '6px', width: '140px' } }, every)),
      card('ranges', t('pageops.splitRanges'), t('pageops.splitRangesHint'), el('div', { style: { marginTop: '6px' } }, ranges)),
      card('single', t('pageops.splitSingle'), t('pageops.splitSingleHint', { count: n }))),
    el('div', { class: 'preview-line' }, el('span', { class: 'ib-ic', html: icon('info') }), result));
  update();
  const res = await modal({ title: t('pageops.splitTitle'), body, width: 560, buttons: [{ label: t('common.cancel') }, { label: t('pageops.splitBtn'), primary: true, value: true }] });
  if (!res) return;
  const groups = groupsFor();
  if (!groups.length) { toast(t('pageops.splitNoneSel'), { type: 'warn' }); return; }
  const labels = groups.map((g) => (g.length === 1 ? t('pageops.partPage', { a: g[0] + 1 }) : t('pageops.partRange', { a: g[0] + 1, b: g[g.length - 1] + 1 })));
  const folder = await window.pu.folderDialog({ title: t('pageops.splitFolder'), defaultDir: d.path ? d.path.replace(/[\\/][^\\/]*$/, '') : undefined });
  if (!folder) return;
  const outs = await withProgress(t('pageops.splitting'), (p) => buildSubset(d, groups, (v) => p.set(v, `${Math.round(v * groups.length)}/${groups.length}`)));
  const base = baseName(d.name);
  for (let k = 0; k < outs.length; k++) await window.pu.writeInFolder(folder, `${base} - ${String(k + 1).padStart(2, '0')} (${labels[k]}).pdf`, outs[k]);
  toast(t('pageops.partsSaved', { count: outs.length }), { type: 'ok', timeout: 6000, action: { label: t('pageops.openFolder'), run: () => window.pu.openPath(folder) } });
}

// ---------------- kırp ----------------
export async function cropFromRegion(d, i, r) {
  const info = await d.pageInfo(i);
  const sameSize = [];
  for (let k = 0; k < d.numPages; k++) {
    const inf = await d.pageInfo(k);
    if (inf.rotate === info.rotate && inf.view.every((v, j) => Math.abs(v - info.view[j]) < 0.5)) sameSize.push(k);
  }
  const all = el('input', { type: 'checkbox' });
  const mm = (pt) => Math.round((pt / 72) * 25.4);
  const res = await modal({
    title: t('pageops.cropTitle'),
    body: el('div', {}, el('p', { class: 'modal-msg', text: t('pageops.cropMsg', { w: mm(r.w), h: mm(r.h) }) }),
      sameSize.length > 1 ? el('label', { class: 'checkline' }, all, t('pageops.cropAll', { count: sameSize.length })) : null),
    buttons: [{ label: t('common.cancel') }, { label: t('pageops.crop'), primary: true, value: true }],
  });
  if (!res) return;
  const T = info.Ti;
  const pts = [[r.x, r.y], [r.x + r.w, r.y + r.h]].map(([x, y]) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]]);
  const x0 = Math.min(pts[0][0], pts[1][0]), y0 = Math.min(pts[0][1], pts[1][1]);
  const w = Math.abs(pts[0][0] - pts[1][0]), h = Math.abs(pts[0][1] - pts[1][1]);
  const pages = all.checked ? sameSize : [i];
  await d.structural(t('pageops.crop'), (lib) => {
    for (const k of pages) lib.getPage(k).setCropBox(x0, y0, w, h);
    return null;
  }, { flattenPages: pages });
  toast(t('pageops.cropped', { count: pages.length }), { type: 'ok', action: { label: t('pageops.undo'), run: () => d.undo() } });
}

// ---------------- sayfa boyutu ----------------
function transformAnnots(lib, page, s, dx, dy) {
  const { PDFName, PDFArray, PDFDict, PDFNumber } = PDFLib();
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return;
  for (let k = 0; k < annots.size(); k++) {
    const a = annots.lookupMaybe(k, PDFDict);
    const rect = a && a.lookupMaybe(PDFName.of('Rect'), PDFArray);
    if (!rect || rect.size() !== 4) continue;
    const v = [0, 1, 2, 3].map((j) => rect.lookup(j, PDFNumber).asNumber());
    a.set(PDFName.of('Rect'), lib.context.obj([v[0] * s + dx, v[1] * s + dy, v[2] * s + dx, v[3] * s + dy]));
  }
}

export async function resizeDialog(d) {
  const size = select(Object.keys(SIZES).map((k) => ({ value: k, label: k })), 'A4');
  const range = el('input', { class: 'input', value: `1-${d.numPages}` });
  const margin = el('input', { class: 'input', type: 'number', min: 0, max: 50, value: 0 });
  const res = await modal({
    title: t('pageops.resizeTitle'),
    body: el('div', {}, el('p', { class: 'muted', text: t('pageops.resizeNote') }),
      el('div', { class: 'row' }, field(t('pageops.targetSize'), size), field(t('pageops.marginMm'), margin)), field(t('pageops.pages'), range)),
    buttons: [{ label: t('common.cancel') }, { label: t('common.apply'), primary: true, value: true }],
  });
  if (!res) return;
  const pages = parseRanges(range.value, d.numPages);
  const m = ((+margin.value || 0) / 25.4) * 72;
  await d.structural(t('pageops.pageSize'), (lib) => {
    for (const k of pages) {
      const p = lib.getPage(k);
      const mb = p.getMediaBox();
      const cb = p.getCropBox();
      const box = { x: Math.max(mb.x, cb.x), y: Math.max(mb.y, cb.y), width: Math.min(cb.width, mb.width), height: Math.min(cb.height, mb.height) };
      let [tw, th] = SIZES[size.value];
      if (box.width > box.height ? tw < th : tw > th) [tw, th] = [th, tw];
      const s = Math.min((tw - 2 * m) / box.width, (th - 2 * m) / box.height);
      const dx = (tw - box.width * s) / 2 - box.x * s;
      const dy = (th - box.height * s) / 2 - box.y * s;
      p.scaleContent(s, s);
      p.translateContent(dx, dy);
      transformAnnots(lib, p, s, dx, dy);
      p.setMediaBox(0, 0, tw, th);
      p.setCropBox(0, 0, tw, th);
      p.setTrimBox(0, 0, tw, th);
      p.setBleedBox(0, 0, tw, th);
    }
    return null;
  }, { flattenPages: pages });
  toast(t('pageops.resized', { count: pages.length, size: size.value }), { type: 'ok' });
}
