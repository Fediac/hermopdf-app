// Şerit menü (Giriş, Düzenle, Açıklama, Sayfa, Form, Dönüştür, Koru, Araçlar) ve eylemler.
import { App } from './state.js';
import { $, $$, el, toast, dropdown, contextMenu, modal, esc, fmtBytes, busy } from './util.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { setTool, TOOLS } from './tools.js';
import { openFiles, openPaths, closeDoc, setScale, zoom, setTheme, toggleSidebar, activate } from './app.js';
import { requirePro } from './pro.js';

const needDoc = () => {
  if (!App.active) { toast(t('common.needDoc'), { type: 'warn' }); return null; }
  return App.active;
};

const lazy = (mod, fn, ...args) => async (anchor) => {
  const m = await import(mod);
  return m[fn](...args, anchor);
};
const withDoc = (mod, fn) => async (anchor) => {
  const d = needDoc();
  if (!d) return undefined;
  const m = await import(mod);
  return m[fn](d, anchor);
};
// Pro kapısı: yalnızca kullanıcının tıklamasıyla çağrılır (ücretsizse yükseltme penceresi açılır, işlem yapılmaz)
const PRO_TOOLS = { ocrregion: 'ocr' };
const tool = (name) => () => {
  if (!needDoc()) return;
  if (App.tool !== name && PRO_TOOLS[name] && !requirePro(PRO_TOOLS[name])) return;
  setTool(App.tool === name ? 'select' : name);
};
const pro = (id, fn) => async (anchor) => (requirePro(id) ? fn(anchor) : undefined);

export const ACTIONS = {
  'file.open': async () => { const files = await window.pu.openPdfDialog({ multi: true }); if (files.length) await openFiles(files); },
  'file.save': async () => { const d = needDoc(); if (d) await d.save().catch((e) => toast(t('common.saveFailed', { error: e.message }), { type: 'error', timeout: 7000 })); },
  'file.saveas': async () => { const d = needDoc(); if (d) await d.save({ as: true }).catch((e) => toast(t('common.saveFailed', { error: e.message }), { type: 'error', timeout: 7000 })); },
  'file.print': withDoc('./print.js', 'printDoc'),
  'file.close': () => App.active && closeDoc(App.active),
  'file.new': lazy('./convert.js', 'newBlankPdf'),
  'file.props': withDoc('./protect.js', 'documentProperties'),
  'file.showInFolder': () => { const d = needDoc(); if (d?.path) window.pu.showItem(d.path); else toast(t('ribbon.notSavedYet'), { type: 'warn' }); },
  'edit.undo': () => App.active?.undo(),
  'edit.redo': () => App.active?.redo(),

  'view.zoomIn': () => zoom(1),
  'view.zoomOut': () => zoom(-1),
  'view.fitWidth': () => setScale('page-width'),
  'view.fitPage': () => setScale('page-fit'),
  'view.actual': () => setScale(1),
  'view.spread': () => { const d = needDoc(); if (!d) return; d.viewer.spreadMode = d.viewer.spreadMode === 0 ? 1 : 0; refreshRibbon(); },
  'view.sidebar': () => toggleSidebar(),
  'view.find': () => App.openFind && App.openFind(),
  'view.theme': () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),

  'insert.image': withDoc('./insert.js', 'insertImageDialog'),
  'insert.signature': withDoc('./signature.js', 'signatureDialog'),
  'insert.initials': async () => { const d = needDoc(); if (d) (await import('./signature.js')).signatureDialog(d, null, { initials: true }); },
  'insert.stamp': withDoc('./signature.js', 'stampDialog'),
  'insert.date': withDoc('./insert.js', 'insertDate'),
  'doc.watermark': withDoc('./insert.js', 'watermarkDialog'),
  'doc.headerFooter': withDoc('./insert.js', 'headerFooterDialog'),
  'doc.pageNumbers': withDoc('./insert.js', 'pageNumbersDialog'),

  'page.organize': () => { if (needDoc()) import('./organizer.js').then((m) => m.showOrganizer(true)); },
  'page.delete': withDoc('./pageops.js', 'deleteSelectedPrompt'),
  'page.rotateLeft': withDoc('./pageops.js', 'rotateSelectedLeft'),
  'page.rotateRight': withDoc('./pageops.js', 'rotateSelectedRight'),
  'page.extract': withDoc('./pageops.js', 'extractDialog'),
  'page.split': withDoc('./pageops.js', 'splitDialog'),
  'page.merge': withDoc('./pageops.js', 'insertFromFile'),
  'page.mergeFiles': lazy('./pageops.js', 'mergeFilesDialog'),
  'page.insertBlank': withDoc('./pageops.js', 'insertBlankDialog'),
  'page.duplicate': withDoc('./pageops.js', 'duplicateSelected'),
  'page.crop': () => { if (needDoc()) { import('./organizer.js').then((m) => m.showOrganizer(false)); setTool('crop'); } },
  'page.resize': withDoc('./pageops.js', 'resizeDialog'),
  'page.reverse': withDoc('./pageops.js', 'reversePages'),

  'form.flatten': withDoc('./protect.js', 'flattenDialog'),
  'form.info': withDoc('./protect.js', 'formInfo'),

  'convert.png': async () => { const d = needDoc(); if (d) (await import('./convert.js')).exportPageImages(d, 'png'); },
  'convert.jpeg': async () => { const d = needDoc(); if (d) (await import('./convert.js')).exportPageImages(d, 'jpeg'); },
  'convert.txt': withDoc('./convert.js', 'exportText'),
  'convert.docx': withDoc('./convert.js', 'exportDocx'),
  'convert.images': async () => { const d = needDoc(); if (d) (await import('./images.js')).exportImages(d); },
  'convert.imagesToPdf': lazy('./convert.js', 'imagesToPdfDialog'),
  'convert.wordToPdf': lazy('./convert.js', 'wordToPdfDialog'),
  'convert.textToPdf': lazy('./convert.js', 'textToPdfDialog'),

  'protect.password': withDoc('./protect.js', 'passwordDialog'),
  'protect.removePassword': withDoc('./protect.js', 'removePassword'),
  'protect.applyRedactions': withDoc('./protect.js', 'applyRedactions'),
  'protect.metadata': withDoc('./protect.js', 'cleanMetadata'),

  'tools.compress': withDoc('./compress.js', 'compressDialog'),
  'tools.compressFile': async () => { const m = await import('./compress.js'); m.compressFilesDialog(); },
  'tools.batch': pro('batch', lazy('./batch.js', 'batchDialog')),
  'tools.workflows': lazy('./workflows.js', 'workflowsDialog'),
  'tools.ocr': pro('ocr', withDoc('./ocr.js', 'ocrDialog')),
  'tools.ocrFile': pro('ocr', async () => { const files = await window.pu.openPdfDialog({ multi: false, title: t('ribbon.ocrPick') }); if (!files.length) return; const d = await openFiles(files); if (d) (await import('./ocr.js')).ocrDialog(d); }),
  'tools.readAloud': withDoc('./reader.js', 'readAloud'),
  'tools.present': withDoc('./reader.js', 'presentation'),
  // Beklemeden döner: Claude paneli açıkken uygulama "meşgul" sayılmasın (Claude çalışmaya devam edebilsin)
  'claude.connect': async () => { const m = await import('./claude.js'); m.openClaudeDialog().catch((e) => toast(t('common.error', { error: e?.message || e }), { type: 'error', timeout: 8000 })); },
  'app.shortcuts': () => showShortcuts(),
  'app.about': () => showAbout(),
  'app.settings': async () => { (await import('./settings.js')).openSettings(); },
};

export async function runAction(id, anchor) {
  const fn = ACTIONS[id];
  if (!fn) { console.warn('Bilinmeyen eylem', id); return undefined; }
  const b = busy(t('common.working'));
  try {
    return await fn(anchor);
  } catch (e) {
    if (e?.cancelled) { toast(t('common.cancelled'), { timeout: 2000 }); return undefined; }
    console.error(id, e);
    window.pu.log(`eylem hatası ${id}: ${e?.stack || e?.message || e}`);
    toast(t('common.error', { error: e?.message || e }), { type: 'error', timeout: 8000 });
    return undefined;
  } finally {
    b.done();
  }
}

// ---------------- şerit tanımı ----------------
// Öğe: [ikon, etiket, eylem | {tool}, ipucu]
const T = (name, ic, label, tip, extra = {}) => ({ ic, label, tool: name, tip, ...extra });
const A = (action, ic, label, tip, extra = {}) => ({ ic, label, action, tip, ...extra });

// Pro özellikleri: şeritte küçük taç işaretiyle gösterilir (ücretsiz kullanıcı da iş akışı panelini açıp şablonlara bakabilir;
// OCR ve toplu işlemde tıklama yükseltme penceresini açar)
const PRO = { pro: true };
const WF = A('tools.workflows', 'workflow', 'ribbon.tools.workflows', 'ribbon.tools.workflows.tip', PRO);

const RIBBON = [
  {
    id: 'home', label: 'ribbon.tab.home', groups: [
      { label: 'ribbon.grp.dosya', items: [A('file.open', 'folder-open', 'ribbon.file.open', 'ribbon.file.open.tip'), A('file.save', 'save', 'ribbon.file.save', 'ribbon.file.save.tip'), A('file.saveas', 'save-all', 'ribbon.file.saveas', 'ribbon.file.saveas.tip'), A('file.print', 'printer', 'ribbon.file.print', 'ribbon.file.print.tip')] },
      { label: 'ribbon.grp.arac', items: [T('select', 'mouse-pointer-2', 'ribbon.tool.select', 'ribbon.tool.select.tip'), T('hand', 'hand', 'ribbon.tool.hand', 'ribbon.tool.hand.tip'), T('snapshot', 'square-dashed', 'ribbon.tool.snapshot', 'ribbon.tool.snapshot.tip')] },
      { label: 'ribbon.grp.gorunum', items: [{ stack: [A('view.zoomIn', 'zoom-in', 'ribbon.view.zoomIn', 'ribbon.view.zoomIn.tip', { small: true }), A('view.zoomOut', 'zoom-out', 'ribbon.view.zoomOut', 'ribbon.view.zoomOut.tip', { small: true }), A('view.actual', 'scan', 'ribbon.view.actual', 'ribbon.view.actual.tip', { small: true })] }, { stack: [A('view.fitWidth', 'move-horizontal', 'ribbon.view.fitWidth', 'ribbon.view.fitWidth.tip', { small: true }), A('view.fitPage', 'maximize-2', 'ribbon.view.fitPage', '', { small: true }), A('view.spread', 'book-open', 'ribbon.view.spread', '', { small: true, toggle: 'spread' })] }, A('view.sidebar', 'panel-left', 'ribbon.view.sidebar', 'ribbon.view.sidebar.tip'), A('view.find', 'search', 'ribbon.view.find', 'ribbon.view.find.tip')] },
      { label: 'ribbon.grp.hizliDuzenleme', items: [T('edittext', 'file-pen-line', 'ribbon.tool.edittext', 'ribbon.tool.edittext.tip'), T('text', 'type', 'ribbon.tool.text', 'ribbon.tool.text.tip'), T('highlight', 'highlighter', 'ribbon.tool.highlight', 'ribbon.tool.highlight.tip'), A('insert.signature', 'signature', 'ribbon.insert.signature', 'ribbon.insert.signature.tip'), A('convert.images', 'image-down', 'ribbon.convert.images', 'ribbon.convert.images.tip')] },
      { label: 'ribbon.grp.sikKullanilan', items: [A('tools.compress', 'shrink', 'ribbon.tools.compress', 'ribbon.tools.compress.tip'), A('tools.ocr', 'scan-text', 'ribbon.tools.ocr', 'ribbon.tools.ocr.tip', PRO), A('tools.batch', 'file-stack', 'ribbon.tools.batch', 'ribbon.tools.batch.tip', PRO), WF] },
      { label: 'ribbon.grp.gecmis', items: [A('edit.undo', 'undo-2', 'ribbon.edit.undo', 'ribbon.edit.undo.tip'), A('edit.redo', 'redo-2', 'ribbon.edit.redo', 'ribbon.edit.redo.tip')] },
    ],
  },
  {
    id: 'edit', label: 'ribbon.tab.edit', groups: [
      { label: 'ribbon.grp.metin', items: [T('edittext', 'file-pen-line', 'ribbon.tool.edittext', 'ribbon.tool.edittext.tip2'), T('text', 'type', 'ribbon.tool.text.box', 'ribbon.tool.text.tip2'), A('insert.date', 'calendar', 'ribbon.insert.date', 'ribbon.insert.date.tip')] },
      { label: 'ribbon.grp.ekle', items: [A('insert.image', 'image-plus', 'ribbon.insert.image', 'ribbon.insert.image.tip'), A('insert.signature', 'signature', 'ribbon.insert.signature', 'ribbon.insert.signature.tip'), A('insert.initials', 'pen-line', 'ribbon.insert.initials', 'ribbon.insert.initials.tip'), A('insert.stamp', 'stamp', 'ribbon.insert.stamp', 'ribbon.insert.stamp.tip')] },
      { label: 'ribbon.grp.silKapat', items: [T('whiteout', 'eraser', 'ribbon.tool.whiteout', 'ribbon.tool.whiteout.tip'), T('redact', 'square', 'ribbon.tool.redact', 'ribbon.tool.redact.tip')] },
      { label: 'ribbon.grp.formIsaretleri', items: [T('check', 'check', 'ribbon.tool.check', ''), T('cross', 'x', 'ribbon.tool.cross', ''), T('dot', 'dot', 'ribbon.tool.dot', '')] },
      { label: 'ribbon.grp.belge', items: [A('doc.watermark', 'droplets', 'ribbon.doc.watermark', 'ribbon.doc.watermark.tip'), A('doc.headerFooter', 'panel-top', 'ribbon.doc.headerFooter', 'ribbon.doc.headerFooter.tip'), A('doc.pageNumbers', 'list-ordered', 'ribbon.doc.pageNumbers', 'ribbon.doc.pageNumbers.tip')] },
    ],
  },
  {
    id: 'annotate', label: 'ribbon.tab.annotate', groups: [
      { label: 'ribbon.grp.metinIsaretleme', items: [T('highlight', 'highlighter', 'ribbon.tool.highlight', 'ribbon.tool.highlight.tip2'), T('underline', 'underline', 'ribbon.tool.underline', ''), T('strike', 'strikethrough', 'ribbon.tool.strike', ''), T('areahl', 'rectangle-horizontal', 'ribbon.tool.areahl', 'ribbon.tool.areahl.tip')] },
      { label: 'ribbon.grp.cizim', items: [T('ink', 'pencil-line', 'ribbon.tool.ink', 'ribbon.tool.ink.tip'), T('line', 'minus', 'ribbon.tool.line', ''), T('arrow', 'move-up-right', 'ribbon.tool.arrow', ''), T('rect', 'square', 'ribbon.tool.rect', 'ribbon.tool.rect.tip'), T('ellipse', 'circle', 'ribbon.tool.ellipse', '')] },
      { label: 'ribbon.grp.yorum', items: [T('note', 'sticky-note', 'ribbon.tool.note', 'ribbon.tool.note.tip'), T('text', 'type', 'ribbon.tool.text.short', 'ribbon.tool.text.tip3')] },
      { label: 'ribbon.grp.liste', items: [A('view.sidebar', 'list', 'ribbon.view.sidebar.edits', 'ribbon.view.sidebar.editsTip', { side: 'objects' })] },
    ],
  },
  {
    id: 'page', label: 'ribbon.tab.page', organizer: true, groups: [
      { label: 'ribbon.grp.gorunum', items: [A('page.organize', 'layout-grid', 'ribbon.page.organize', 'ribbon.page.organize.tip')] },
      { label: 'ribbon.grp.seciliSayfalar', items: [A('page.delete', 'trash-2', 'ribbon.page.delete', 'ribbon.page.delete.tip'), A('page.rotateLeft', 'rotate-ccw', 'ribbon.page.rotateLeft', ''), A('page.rotateRight', 'rotate-cw', 'ribbon.page.rotateRight', ''), A('page.duplicate', 'copy-plus', 'ribbon.page.duplicate', ''), A('page.extract', 'file-output', 'ribbon.page.extract', 'ribbon.page.extract.tip')] },
      { label: 'ribbon.grp.ekleBirlestir', items: [A('page.insertBlank', 'file-plus', 'ribbon.page.insertBlank', ''), A('page.merge', 'files', 'ribbon.page.merge', 'ribbon.page.merge.tip'), A('page.mergeFiles', 'combine', 'ribbon.page.mergeFiles', 'ribbon.page.mergeFiles.tip'), A('page.split', 'scissors', 'ribbon.page.split', 'ribbon.page.split.tip')] },
      { label: 'ribbon.grp.bicim', items: [A('page.crop', 'crop', 'ribbon.page.crop', 'ribbon.page.crop.tip'), A('page.resize', 'scan', 'ribbon.page.resize', 'ribbon.page.resize.tip'), A('page.reverse', 'flip-vertical-2', 'ribbon.page.reverse', 'ribbon.page.reverse.tip')] },
    ],
  },
  {
    id: 'form', label: 'ribbon.tab.form', groups: [
      { label: 'ribbon.grp.doldur', items: [A('form.info', 'text-cursor-input', 'ribbon.form.info', 'ribbon.form.info.tip'), T('text', 'type', 'ribbon.tool.text.short', 'ribbon.tool.text.tip4'), T('check', 'check', 'ribbon.tool.check', ''), T('cross', 'x', 'ribbon.tool.cross', ''), T('dot', 'dot', 'ribbon.tool.dot', '')] },
      { label: 'ribbon.grp.imza', items: [A('insert.signature', 'signature', 'ribbon.insert.signature', ''), A('insert.initials', 'pen-line', 'ribbon.insert.initials', ''), A('insert.date', 'calendar', 'ribbon.insert.date', '')] },
      { label: 'ribbon.grp.son', items: [A('form.flatten', 'layers', 'ribbon.form.flatten', 'ribbon.form.flatten.tip')] },
    ],
  },
  {
    id: 'convert', label: 'ribbon.tab.convert', groups: [
      { label: 'ribbon.grp.pdfTen', items: [A('convert.docx', 'file-type', 'ribbon.convert.docx', 'ribbon.convert.docx.tip'), A('convert.png', 'file-image', 'ribbon.convert.png', 'ribbon.convert.png.tip'), A('convert.jpeg', 'image', 'ribbon.convert.jpeg', 'ribbon.convert.jpeg.tip'), A('convert.txt', 'file-text', 'ribbon.convert.txt', 'ribbon.convert.txt.tip'), A('convert.images', 'image-down', 'ribbon.convert.images', 'ribbon.convert.images.tip2')] },
      { label: 'ribbon.grp.pdfE', items: [A('convert.wordToPdf', 'file-type', 'ribbon.convert.wordToPdf', 'ribbon.convert.wordToPdf.tip'), A('convert.imagesToPdf', 'file-image', 'ribbon.convert.imagesToPdf', 'ribbon.convert.imagesToPdf.tip'), A('convert.textToPdf', 'file-text', 'ribbon.convert.textToPdf', 'ribbon.convert.textToPdf.tip'), A('file.new', 'file-plus', 'ribbon.file.new', 'ribbon.file.new.tip')] },
    ],
  },
  {
    id: 'protect', label: 'ribbon.tab.protect', groups: [
      { label: 'ribbon.grp.parola', items: [A('protect.password', 'lock', 'ribbon.protect.password', 'ribbon.protect.password.tip'), A('protect.removePassword', 'lock-open', 'ribbon.protect.removePassword', '')] },
      { label: 'ribbon.grp.gizlilik', items: [T('redact', 'square', 'ribbon.tool.redact', 'ribbon.tool.redact.tip2'), A('protect.applyRedactions', 'shield', 'ribbon.protect.applyRedactions', 'ribbon.protect.applyRedactions.tip'), A('protect.metadata', 'eye-off', 'ribbon.protect.metadata', 'ribbon.protect.metadata.tip')] },
      { label: 'ribbon.grp.belge', items: [A('form.flatten', 'layers', 'ribbon.form.flatten', ''), A('file.props', 'info', 'ribbon.file.props', 'ribbon.file.props.tip')] },
    ],
  },
  {
    id: 'tools', label: 'ribbon.tab.tools', groups: [
      { label: 'ribbon.grp.boyut', items: [A('tools.compress', 'shrink', 'ribbon.tools.compress', 'ribbon.tools.compress.tip2'), A('tools.batch', 'file-stack', 'ribbon.tools.batch', 'ribbon.tools.batch.tip2', PRO), WF] },
      { label: 'ribbon.grp.yaziTanima', items: [A('tools.ocr', 'scan-text', 'ribbon.tools.ocr', 'ribbon.tools.ocr.tip2', PRO), T('ocrregion', 'text-select', 'ribbon.tool.ocrregion', 'ribbon.tool.ocrregion.tip', PRO)] },
      { label: 'ribbon.grp.okuma', items: [A('tools.readAloud', 'volume-2', 'ribbon.tools.readAloud', 'ribbon.tools.readAloud.tip'), A('tools.present', 'presentation', 'ribbon.tools.present', 'ribbon.tools.present.tip')] },
      { label: 'ribbon.grp.yapayZeka', items: [A('claude.connect', 'bot', 'ribbon.claude.connect', 'ribbon.claude.connect.tip')] },
      { label: 'ribbon.grp.uygulama', items: [A('view.theme', 'moon', 'ribbon.view.theme', 'ribbon.view.theme.tip'), A('app.settings', 'settings', 'ribbon.app.settings', 'ribbon.app.settings.tip'), A('app.shortcuts', 'keyboard', 'ribbon.app.shortcuts', ''), A('app.about', 'circle-help', 'ribbon.app.about', '')] },
    ],
  },
];

export function buildRibbon() {
  const tabs = $('#ribbon-tabs');
  tabs.replaceChildren();
  for (const tab of RIBBON) {
    const b = el('button', { class: `ribbon-tab ${App.ribbonTab === tab.id ? 'on' : ''}`, text: t(tab.label), dataset: { tab: tab.id } });
    b.addEventListener('click', () => selectTab(tab.id));
    tabs.append(b);
  }
  $('#appmenu-btn').onclick = (e) => openAppMenu(e.currentTarget);
  renderRibbonBody();
  App.on('tool', refreshRibbon);
  App.on('history', refreshRibbon);
  App.on('selection', refreshRibbon);
}

export function selectTab(id) {
  App.ribbonTab = id;
  $$('.ribbon-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
  renderRibbonBody();
  const tab = RIBBON.find((t) => t.id === id);
  import('./organizer.js').then((m) => m.showOrganizer(!!tab.organizer && !!App.active));
}

function renderRibbonBody() {
  const host = $('#ribbon');
  host.replaceChildren();
  const tab = RIBBON.find((t) => t.id === App.ribbonTab) || RIBBON[0];
  for (const g of tab.groups) {
    const items = el('div', { class: 'rgroup-items' });
    for (const it of g.items) {
      if (it.stack) {
        items.append(el('div', { class: 'rstack' }, it.stack.map((s) => itemButton(s, true))));
      } else items.append(itemButton(it, it.small));
    }
    host.append(el('div', { class: 'rgroup', dataset: { group: g.label } }, items, el('div', { class: 'rgroup-label', text: t(g.label) })));
  }
  refreshRibbon();
}

function itemButton(it, small) {
  const label = t(it.label);
  const b = el('button', { class: small ? 'rsmall' : 'rbtn', title: it.tip ? `${label} — ${t(it.tip)}` : label, html: `${icon(it.ic)}<span>${esc(label)}</span>` });
  if (it.tool) b.dataset.tool = it.tool;
  if (it.action) b.dataset.action = it.action;
  if (it.toggle) b.dataset.toggle = it.toggle;
  if (it.pro) { b.classList.add('has-pro'); b.append(el('span', { class: 'rpro', title: t('common.proFeature'), html: icon('crown') })); }
  b.addEventListener('click', () => {
    if (it.tool) return tool(it.tool)();
    if (it.side) { toggleSidebar(true); import('./sidebar.js').then((m) => m.showSide(it.side)); return undefined; }
    return runAction(it.action, b);
  });
  return b;
}

// Dil değişince: sekme adları ve açık sekmenin düğmeleri yeniden yazılır (otomatik kaydet düğmesi yerinde kalır)
export function relabelRibbon() {
  for (const b of $$('#ribbon-tabs .ribbon-tab')) {
    const tab = RIBBON.find((x) => x.id === b.dataset.tab);
    if (tab) b.textContent = t(tab.label);
  }
  renderRibbonBody();
}

export function refreshRibbon() {
  const d = App.active;
  $$('#ribbon [data-tool]').forEach((b) => b.classList.toggle('on', App.tool === b.dataset.tool));
  $$('#ribbon [data-action="edit.undo"]').forEach((b) => { b.disabled = !d || !d.undoStack.length; });
  $$('#ribbon [data-action="edit.redo"]').forEach((b) => { b.disabled = !d || !d.redoStack.length; });
  $$('#ribbon [data-toggle="spread"]').forEach((b) => b.classList.toggle('on', !!d && d.viewer?.spreadMode === 1));
}

function openAppMenu(anchor) {
  const recent = (App.settings.recent || []).slice(0, 6);
  dropdown(anchor, [
    { label: t('ribbon.menu.open'), icon: 'folder-open', kbd: 'Ctrl+O', run: () => runAction('file.open') },
    { label: t('ribbon.menu.new'), icon: 'file-plus', run: () => runAction('file.new') },
    { label: t('ribbon.menu.images'), icon: 'file-image', run: () => runAction('convert.imagesToPdf') },
    { label: t('ribbon.menu.merge'), icon: 'combine', run: () => runAction('page.mergeFiles') },
    '-',
    { label: t('common.save'), icon: 'save', kbd: 'Ctrl+S', disabled: !App.active, run: () => runAction('file.save') },
    { label: t('ribbon.menu.saveas'), icon: 'save-all', kbd: 'Ctrl+Shift+S', disabled: !App.active, run: () => runAction('file.saveas') },
    { label: t('ribbon.menu.print'), icon: 'printer', kbd: 'Ctrl+P', disabled: !App.active, run: () => runAction('file.print') },
    { label: t('ribbon.menu.showInFolder'), icon: 'folder', disabled: !App.active?.path, run: () => runAction('file.showInFolder') },
    { label: t('ribbon.menu.props'), icon: 'info', disabled: !App.active, run: () => runAction('file.props') },
    { label: t('common.close'), icon: 'x', kbd: 'Ctrl+W', disabled: !App.active, run: () => runAction('file.close') },
    recent.length ? '-' : null,
    recent.length ? { header: t('app.recent') } : null,
    ...recent.map((p) => ({ label: p.split(/[\\/]/).pop(), icon: 'clock', run: () => openPaths([p]) })),
    '-',
    { label: t('ribbon.menu.settings'), icon: 'settings', run: () => runAction('app.settings') },
    { label: t('ribbon.menu.tour'), icon: 'sparkles', run: () => import('./tour.js').then((m) => m.startTour()) },
    { label: t('ribbon.menu.shortcuts'), icon: 'keyboard', run: () => showShortcuts() },
    { label: t('ribbon.app.about'), icon: 'circle-help', run: () => showAbout() },
  ]);
}

function showShortcuts() {
  const rows = [
    ['Ctrl+O', t('ribbon.k.open')], ['Ctrl+S / Ctrl+Shift+S', t('ribbon.k.save')], ['Ctrl+P', t('ribbon.file.print')], ['Ctrl+W', t('ribbon.k.close')], ['Ctrl+Tab', t('ribbon.k.next')],
    ['Ctrl+Z / Ctrl+Y', t('ribbon.k.undo')], ['Ctrl+F', t('ribbon.k.find')], ['Ctrl + / Ctrl - / Ctrl+0', t('ribbon.k.zoom')], [t('ribbon.k.wheelKey'), t('ribbon.k.wheel')],
    ['V / H', t('ribbon.k.selectHand')], ['T', t('ribbon.tool.text')], ['E', t('ribbon.tool.edittext')], ['P', t('ribbon.tool.ink')], ['U', t('ribbon.tool.highlight')], ['R', t('ribbon.tool.rect')], ['W', t('ribbon.tool.whiteout')],
    ['Del', t('ribbon.k.delete')], ['Ctrl+C / Ctrl+V / Ctrl+D', t('ribbon.k.copy')], [t('ribbon.k.pasteShotKey'), t('ribbon.k.pasteShot')], [t('ribbon.k.arrowsKey'), t('ribbon.k.arrows')],
    ['Esc', t('ribbon.k.esc')], ['F4', t('ribbon.view.sidebar')], ['F5', t('ribbon.k.present')],
  ];
  const tbl = el('table', { class: 'info-table kbd-table' }, rows.map(([k, v]) => el('tr', {}, el('td', { text: k }), el('td', { text: v }))));
  modal({ title: t('ribbon.menu.shortcuts'), body: tbl, width: 520, buttons: [{ label: t('common.close'), primary: true }] });
}

async function showAbout() {
  const [{ aboutLicenseSection }, { aboutUpdateSection }] = await Promise.all([import('./pro.js'), import('./update.js')]);
  const body = el('div', { class: 'about-body', html: `<div style="display:flex;gap:16px;align-items:center"><img src="app://pu/build/icon-256.png" style="width:72px;height:72px"><div><b style="font-size:16px">HermoPDF ${esc(App.version)}</b><div class="muted">${esc(t('ribbon.about.tagline'))}</div></div></div>
      <p>${esc(t('ribbon.about.body'))}</p>` });
  body.append(aboutLicenseSection(), aboutUpdateSection(),
    el('p', { class: 'muted', style: { fontSize: '12px' }, text: t('ribbon.about.oss') }));
  modal({ title: t('ribbon.about.title'), width: 520, className: 'about-modal', body, buttons: [{ label: t('common.close'), primary: true }] });
}

export { needDoc, fmtBytes, contextMenu, TOOLS, activate };
