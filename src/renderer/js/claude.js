// Claude bağlantısı: Claude Desktop'taki yerel MCP sunucusundan (src/mcp/server.mjs) gelen istekleri
// uygulamanın kendi işlemleriyle yürütür. Her düzenleme normal bir uygulama adımıdır (Geri al ile geri alınır).
// Gelen her değer güvenilmez kabul edilir: PDF içindeki yazılar Claude'u yanıltmaya çalışmış olabilir.
// Kaydetme her zaman kullanıcıya sorulur; karartma yalnızca İŞARETLENİR, uygulamak kullanıcının işidir.
import { App, saveSetting } from './state.js';
import { $, el, toast, modal, isModalOpen, isBusy, fmtBytes, baseName, rangesToText, canvasToBlob, blobToDataURL, withProgress, sleep } from './util.js';
import { icon } from './icons.js';
import { getPdfjs } from './pdfcore.js';
import { finishTextEdit, renderLayer } from './overlay.js';
import { rectsBox } from './shapes.js';
import { measureFn } from './flatten.js';
import { infoBox } from './assist.js';
import { t, onLang, locale } from './i18n.js';
import { isPro } from './pro.js';

const MAX_READ_CHARS = 60000;
const MAX_SEARCH_RESULTS = 100;
const MAX_MARKS = 500;
const MAX_TEXT = 5000;
const LOG_MAX = 100;
const DOWNLOAD_URL = 'https://claude.ai/download';

// ---------------- durum ----------------
let state = { enabled: false, running: false, clients: 0, error: null };
const activity = []; // { t, text, ok }
const activityListeners = new Set();

class ClaudeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const bad = (msg) => new ClaudeError('invalid_params', msg);

// ---------------- doğrulama ----------------
function getDoc(id) {
  if (id != null) {
    if (typeof id !== 'string' || id.length > 64) throw bad('document_id must be a string from list_documents.');
    const d = App.docs.find((x) => x.id === id);
    if (!d) throw new ClaudeError('not_found', `No open document has id "${id}". Call list_documents to see the open tabs.`);
    return d;
  }
  const d = App.active;
  if (!d) throw new ClaudeError('no_document', 'No PDF is open in HermoPDF. Ask the user to open one (or use open_pdf with a file path). / HermoPDF\'te açık PDF yok.');
  return d;
}

function int(v, name, min, max) {
  const n = typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw bad(`${name} must be a whole number.`);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max} (got ${n}).`);
  return n;
}
function num(v, name, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${name} must be a finite number.`);
  if (v < min || v > max) throw bad(`${name} must be between ${min} and ${max} (got ${v}).`);
  return v;
}
function str(v, name, { max = MAX_TEXT, required = true } = {}) {
  if (v == null || v === '') { if (required) throw bad(`${name} is required.`); return ''; }
  if (typeof v !== 'string') throw bad(`${name} must be text.`);
  if (v.length > max) throw bad(`${name} is too long (max ${max} characters).`);
  return v;
}
function color(v, def) {
  if (v == null || v === '') return def;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad('color must look like "#1d4ed8".');
  return v.toLowerCase();
}
function bool(v, def) {
  if (v == null) return def;
  if (typeof v !== 'boolean') throw bad('Expected true or false.');
  return v;
}
function page1(v, d, name = 'page') {
  return int(v, name, 1, d.numPages) - 1;
}
// "1-3,5" / [1,2] / 3 → 0 tabanlı, sıralı, tekrarsız; aralık dışı sayfa hata verir (sessizce atlanmaz)
function parsePages(spec, n, { allByDefault = true } = {}) {
  if (spec == null || spec === '') {
    if (!allByDefault) throw bad('pages is required, e.g. "1-3,5".');
    return Array.from({ length: n }, (_, k) => k);
  }
  if (Array.isArray(spec)) {
    if (spec.length > 5000) throw bad('Too many pages listed.');
    spec = spec.map((x) => int(x, 'page', 1, n)).join(',');
  } else if (typeof spec === 'number') spec = String(int(spec, 'page', 1, n));
  if (typeof spec !== 'string' || spec.length > 500) throw bad('pages must be text like "1-3,5".');
  const s = spec.replace(/\s+/g, '').toLowerCase();
  if (s === 'all') return Array.from({ length: n }, (_, k) => k);
  const out = new Set();
  for (const part of s.split(/[,;]/)) {
    if (!part) continue;
    const m = /^(\d{1,6})(?:-(\d{1,6}))?$/.exec(part);
    if (!m) throw bad(`Invalid page range "${part.slice(0, 30)}". Use 1-based pages like "1-3,5".`);
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (const v of [a, b]) if (v < 1 || v > n) throw bad(`Page ${v} does not exist; the document has ${n} page${n === 1 ? '' : 's'}.`);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i - 1);
  }
  if (!out.size) throw bad('No pages given.');
  return [...out].sort((x, y) => x - y);
}
const pagesText = (pages) => rangesToText(pages);

// Kullanıcı yazı düzenliyorsa bitir; açık pencere ya da süren işlem varsa bir süre bekle
// Claude günlüğü / kurulum penceresi açıkken Claude çalışabilsin (kullanıcı izliyor olabilir)
const PASSIVE_MODALS = ['claude-panel', 'claude-setup-modal'];
function blockingModalOpen() {
  if (!isModalOpen()) return false;
  const boxes = [...document.querySelectorAll('.modal-backdrop:not(.out) > .modal')];
  return !boxes.length || boxes.some((b) => !PASSIVE_MODALS.some((c) => b.classList.contains(c)));
}

const timedOut = () => new ClaudeError('timeout', 'The request timed out before it started, so it was cancelled. Nothing was changed.');
function onAbort(signal, fn) {
  if (!signal) return;
  if (signal.aborted) fn();
  else signal.addEventListener('abort', fn, { once: true });
}

async function waitIdle(signal, ms = 15000) {
  finishTextEdit();
  const t0 = Date.now();
  while (blockingModalOpen() || isBusy()) {
    if (signal?.aborted) throw timedOut();
    if (Date.now() - t0 > ms) {
      throw new ClaudeError('busy', 'HermoPDF is busy: a dialog is open or an operation is running. Ask the user to finish it, then try again. / HermoPDF meşgul: açık bir pencere ya da süren bir işlem var.');
    }
    await sleep(250);
  }
  if (signal?.aborted) throw timedOut();
}

// Beklerken sekme kapatılmış olabilir: kapanmış belgeye "başarılı" denmesin
async function ready(d, ctx) {
  await waitIdle(ctx?.signal);
  if (!App.docs.includes(d)) throw new ClaudeError('not_found', `"${d.name}" was closed in HermoPDF. Call list_documents to see the open tabs.`);
}

// Düzenleme başlıyor: belge, kullanıcı kendisi kaydedene kadar otomatik kaydedilmez (app.js scheduleAutoSave).
// Dönen değer düzenlemeden önceki son geri alma adımı (didChange, Claude'un adımını bununla tanır).
async function beginEdit(d, ctx) {
  await ready(d, ctx);
  d.claudeHold = true;
  return d.undoStack[d.undoStack.length - 1] || null;
}
const isClaudeStep = (s) => !!s && /^Claude:/.test(String(s.label || ''));

// ---------------- metin ve konumlar ----------------
// Sayfa metni + her parçanın görünen sayfadaki yeri (sol üst köşe, y aşağı, birim pt)
async function pageGlyphs(d, i) {
  const tc = await d.textContent(i);
  const page = await d.pdf.getPage(i + 1);
  const vp = page.getViewport({ scale: 1 });
  const { Util } = getPdfjs();
  let text = '';
  const spans = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue;
    const start = text.length;
    text += it.str;
    if (it.str.length) {
      const tx = Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(tx[2], tx[3]);
      const angle = Math.atan2(tx[1], tx[0]);
      const style = tc.styles[it.fontName] || {};
      const asc = style.ascent || 0.8;
      const desc = style.descent ? Math.abs(style.descent) : 0.2;
      spans.push({ start, end: text.length, x: tx[4], base: tx[5], fh, asc, desc, w: it.width, ok: Math.abs(angle) < 0.02 && it.width > 0 && fh > 0 });
    }
    if (it.hasEOL) text += '\n';
  }
  return { text, spans };
}

function hasText(text) {
  return text.replace(/\s+/g, '').length > 0;
}

// Türkçe dostu, büyük/küçük harf duyarsız arama ifadesi; boşluklar satır sonlarını da kapsar
function queryRegex(q, caseSensitive) {
  const esc = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let src = '';
  let space = false;
  for (const ch of q.trim()) {
    if (/\s/.test(ch)) { if (!space) src += '\\s*'; space = true; continue; }
    space = false;
    src += !caseSensitive && /[iİıI]/.test(ch) ? '[iİıI]' : esc(ch);
  }
  return new RegExp(src, caseSensitive ? 'gu' : 'giu');
}

function findMatches(text, re, limit) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) && out.length < limit) {
    if (!m[0].length) { re.lastIndex++; continue; }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// Eşleşmenin sayfadaki dikdörtgenleri (satır başına bir tane)
function matchRects(spans, s, e) {
  const rects = [];
  let skipped = false;
  for (const sp of spans) {
    if (sp.end <= s || sp.start >= e) continue;
    if (!sp.ok) { skipped = true; continue; }
    const len = sp.end - sp.start;
    const a = Math.max(s, sp.start) - sp.start, b = Math.min(e, sp.end) - sp.start;
    const x0 = sp.x + (sp.w * a) / len, x1 = sp.x + (sp.w * b) / len;
    const r = { x: x0, y: sp.base - sp.fh * sp.asc, w: Math.max(0.5, x1 - x0), h: sp.fh * (sp.asc + sp.desc) };
    const last = rects[rects.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.4 && r.x <= last.x + last.w + r.h) {
      const x = Math.min(last.x, r.x), y = Math.min(last.y, r.y);
      last.w = Math.max(last.x + last.w, r.x + r.w) - x;
      last.h = Math.max(last.y + last.h, r.y + r.h) - y;
      last.x = x; last.y = y;
    } else rects.push(r);
  }
  return { rects, skipped };
}

function snippet(text, s, e, pad = 60) {
  const a = Math.max(0, s - pad), b = Math.min(text.length, e + pad);
  return `${a > 0 ? '…' : ''}${text.slice(a, s)}[${text.slice(s, e)}]${text.slice(e, b)}${b < text.length ? '…' : ''}`.replace(/\s+/g, ' ');
}

// Sorgunun geçtiği yerlerin dikdörtgenleri: sayfa -> [[rect...] her eşleşme için]
async function locate(d, query, pages, caseSensitive) {
  const re = queryRegex(query, caseSensitive);
  const byPage = new Map();
  let total = 0, skipped = 0;
  for (const i of pages) {
    if (total >= MAX_MARKS) break;
    const { text, spans } = await pageGlyphs(d, i);
    for (const m of findMatches(text, re, MAX_MARKS - total)) {
      const r = matchRects(spans, m.start, m.end);
      if (r.skipped && !r.rects.length) { skipped++; continue; }
      if (!r.rects.length) continue;
      if (!byPage.has(i)) byPage.set(i, []);
      byPage.get(i).push(r.rects);
      total++;
    }
  }
  return { byPage, total, skipped };
}

// Bir grup nesneyi tek geri alma adımıyla ekle
function addObjects(d, items, label) {
  let first = true;
  const pages = new Set();
  for (const { page, obj } of items) {
    if (first) { d.addObj(page, obj, { label, select: false }); first = false; continue; }
    obj.id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    d.pageObjs[page].push(obj);
    pages.add(page);
  }
  pages.forEach((p) => renderLayer(d, p));
  App.emit('selection', d);
}

// ---------------- etkinlik günlüğü ve bildirim ----------------
function logActivity(text, ok = true) {
  activity.unshift({ t: new Date(), text, ok });
  if (activity.length > LOG_MAX) activity.length = LOG_MAX;
  activityListeners.forEach((fn) => { try { fn(); } catch (e) { /* yoksay */ } });
}
// prevTop: beginEdit'in döndürdüğü adım. Yeni adım "Claude: …" diye etiketlenir (undo aracı yalnızca bunları geri alır).
function didChange(d, text, prevTop) {
  logActivity(`${text} — ${d.name}`);
  const top = d.undoStack[d.undoStack.length - 1];
  const step = top && top !== prevTop ? top : null;
  if (step && !isClaudeStep(step)) step.label = `Claude: ${step.label}`;
  // "Geri al" yalnızca Claude'un adımı hâlâ en üstteyse onu geri alır; arada kullanıcı bir şey yaptıysa dokunmaz
  const undoStep = () => {
    if (App.docs.includes(d) && d.undoStack[d.undoStack.length - 1] === step) return d.undo();
    toast(t('claude.undoChanged'), { type: 'warn', timeout: 5000 });
    return undefined;
  };
  toast(`🤖 Claude: ${text}`, { type: 'ok', timeout: 6000, action: step ? { label: t('claude.undoAction'), run: undoStep } : undefined });
  if (App.settings.autoSave && d.path && !d.claudeHoldNoticed) {
    d.claudeHoldNoticed = true;
    toast(t('claude.autoSavePaused', { name: d.name }), { type: 'warn', timeout: 9000 });
  }
}

async function appModule() { return import('./app.js'); }

// ---------------- araçlar ----------------
const H = {};

H.ping = async () => ({ text: 'pong' });

H.list_documents = async () => {
  const docs = [];
  for (const d of App.docs) {
    if (!d.pdf) continue;
    const sizes = new Map();
    const n = Math.min(d.numPages, 200);
    for (let i = 0; i < n; i++) {
      const info = await d.pageInfo(i);
      const key = `${Math.round(info.w)}x${Math.round(info.h)}`;
      sizes.set(key, (sizes.get(key) || 0) + 1);
    }
    docs.push({
      id: d.id,
      name: d.name,
      pages: d.numPages,
      page_sizes_pt: [...sizes].map(([k, c]) => { const [w, h] = k.split('x').map(Number); return { width: w, height: h, pages: c }; }),
      page_sizes_note: d.numPages > n ? `Sizes counted for the first ${n} pages only.` : undefined,
      active: d === App.active,
      unsaved_changes: !!d.dirty,
      saved_to_disk: !!d.path,
      read_only_reason: d.readOnlyReason || undefined,
      hermopdf_edits: d.pageObjs.reduce((a, o) => a + o.length, 0),
    });
  }
  logActivity(t('claude.logListDocs'));
  return {
    text: docs.length ? `${docs.length} open document(s). Coordinates for editing tools are PDF points with the origin at the top-left of the page as displayed.` : 'No documents are open in HermoPDF.',
    data: { documents: docs, active_id: App.active?.id || null },
  };
};

H.read_text = async (p) => {
  const d = getDoc(p.document_id);
  const pages = parsePages(p.pages, d.numPages);
  const parts = [];
  let used = 0;
  let truncatedAt = null;
  const empty = [];
  for (const i of pages) {
    const { text } = await pageGlyphs(d, i);
    const tx = text.replace(/[ \t]+\n/g, '\n').trim();
    let block = `=== Page ${i + 1} ===\n`;
    if (!hasText(tx)) { block += '[No text layer on this page — it may be a scanned image. OCR may be needed (ocr_pages) or use render_page to look at it. / OCR gerekebilir]\n'; empty.push(i); } else block += `${tx}\n`;
    const edits = (d.pageObjs[i] || []).filter((o) => (o.type === 'text' || o.type === 'note') && o.text);
    if (edits.length) block += `--- Unsaved HermoPDF edits on this page: ${edits.map((o) => `${o.type} "${String(o.text).slice(0, 300)}"`).join('; ')}\n`;
    if (used + block.length > MAX_READ_CHARS && parts.length) { truncatedAt = i; break; }
    if (block.length > MAX_READ_CHARS) { parts.push(block.slice(0, MAX_READ_CHARS)); truncatedAt = i + 1 < d.numPages ? i + 1 : null; used += MAX_READ_CHARS; break; }
    parts.push(block);
    used += block.length;
  }
  const last = pages[pages.length - 1];
  let text = `Document "${d.name}" (id ${d.id}), ${d.numPages} pages.\n\n${parts.join('\n')}`;
  if (truncatedAt != null) text += `\n[Truncated to about ${MAX_READ_CHARS} characters. Continue with read_text pages "${truncatedAt + 1}-${last + 1}".]`;
  const readPages = truncatedAt != null ? pages.filter((i) => i < truncatedAt) : pages;
  logActivity(`${t('claude.logRead', { pages: pagesText(readPages) })} — ${d.name}`);
  return { text };
};

H.search_text = async (p) => {
  const d = getDoc(p.document_id);
  const q = str(p.query, 'query', { max: 200 });
  if (!q.trim()) throw bad('query must not be empty.');
  const cs = bool(p.case_sensitive, false);
  const re = queryRegex(q, cs);
  const results = [];
  let total = 0;
  const empty = [];
  for (let i = 0; i < d.numPages; i++) {
    const { text, spans } = await pageGlyphs(d, i);
    if (!hasText(text)) empty.push(i);
    for (const m of findMatches(text, re, 10000)) {
      total++;
      if (results.length < MAX_SEARCH_RESULTS) results.push({ page: i + 1, snippet: snippet(text, m.start, m.end), highlightable: matchRects(spans, m.start, m.end).rects.length > 0 });
    }
  }
  logActivity(`${t('claude.logSearch', { query: q.slice(0, 60), count: total })} — ${d.name}`);
  return {
    text: `${total} match(es) for "${q}" in "${d.name}"${total > results.length ? ` (showing the first ${results.length})` : ''}.${empty.length ? ` ${empty.length} page(s) have no text layer and could not be searched (OCR may be needed): ${pagesText(empty)}.` : ''}`,
    data: { total, results },
  };
};

H.render_page = async (p) => {
  const d = getDoc(p.document_id);
  const i = page1(p.page, d);
  const scale0 = p.scale == null ? 1.5 : num(p.scale, 'scale', 0.25, 2);
  const info = await d.pageInfo(i);
  const scale = Math.min(scale0, 2000 / Math.max(info.w, info.h));
  const { renderRegion } = await import('./images.js');
  const c = await renderRegion(d, i, { x: 0, y: 0, w: info.w, h: info.h }, scale);
  const blob = await canvasToBlob(c, 'image/png');
  const url = await blobToDataURL(blob);
  const w = c.width, h = c.height;
  c.width = c.height = 0;
  logActivity(`${t('claude.logRender', { page: i + 1 })} — ${d.name}`);
  return {
    text: `Page ${i + 1} of "${d.name}" rendered at ${w}×${h} px. The page is ${Math.round(info.w)}×${Math.round(info.h)} pt; 1 pt = ${(w / info.w).toFixed(3)} px in this image. Unsaved HermoPDF edits are included.`,
    image: url.slice(url.indexOf(',') + 1),
  };
};

H.goto_page = async (p) => {
  const d = getDoc(p.document_id);
  const i = page1(p.page, d);
  const { activate } = await appModule();
  if (App.active !== d) activate(d);
  d.goToPage(i);
  logActivity(`${t('claude.logGoto', { page: i + 1 })} — ${d.name}`);
  return { text: `Showing page ${i + 1} of "${d.name}".` };
};

H.rotate_pages = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const pages = parsePages(p.pages, d.numPages, { allByDefault: false });
  const deg = p.degrees == null ? 90 : p.degrees;
  if (![90, 180, 270, -90].includes(deg)) throw bad('degrees must be 90, 180, 270 or -90 (clockwise).');
  const prev = await beginEdit(d, ctx);
  const { rotatePages } = await import('./pageops.js');
  await rotatePages(d, pages, deg === 270 ? -90 : deg);
  didChange(d, t(deg === -90 || deg === 270 ? 'claude.rotLeft' : deg === 180 ? 'claude.rot180' : 'claude.rotRight', { pages: pagesText(pages) }), prev);
  return { text: `Rotated page(s) ${pagesText(pages)} by ${deg}° in "${d.name}". The user can undo this.` };
};

H.delete_pages = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const pages = parsePages(p.pages, d.numPages, { allByDefault: false });
  if (pages.length >= d.numPages) throw bad('Cannot delete every page; at least one page must remain.');
  const prev = await beginEdit(d, ctx);
  const { deletePages } = await import('./pageops.js');
  const ok = await deletePages(d, pages, { confirm: false, quiet: true });
  if (!ok) throw new ClaudeError('failed', 'Pages were not deleted.');
  didChange(d, t('claude.pagesDeleted', { count: pages.length, pages: pagesText(pages) }), prev);
  return { text: `Deleted page(s) ${pagesText(pages)} from "${d.name}". It now has ${d.numPages} pages. The user can undo this.` };
};

H.move_pages = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const pages = parsePages(p.pages, d.numPages, { allByDefault: false });
  const to = int(p.to, 'to', 1, d.numPages + 1);
  // Sıra değişmiyorsa hiçbir şey yapma (yoksa bildirimdeki "Geri al" önceki bir adımı geri alırdı)
  const rest = Array.from({ length: d.numPages }, (_, k) => k).filter((k) => !pages.includes(k));
  const before = rest.filter((k) => k < to - 1).length;
  const order = [...rest.slice(0, before), ...pages, ...rest.slice(before)];
  if (order.every((k, j) => k === j)) return { text: `Page(s) ${pagesText(pages)} are already at that position; nothing changed.`, data: { changed: false } };
  const prev = await beginEdit(d, ctx);
  const { movePages } = await import('./pageops.js');
  await movePages(d, pages, to - 1);
  const first = d.pageSel && d.pageSel.size ? Math.min(...d.pageSel) + 1 : null;
  didChange(d, t('claude.pagesMoved', { pages: pagesText(pages) }), prev);
  return { text: `Moved page(s) ${pagesText(pages)}${first ? `; they now start at page ${first}` : ''} in "${d.name}".` };
};

H.extract_pages = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const pages = parsePages(p.pages, d.numPages, { allByDefault: false });
  await ready(d, ctx);
  const { buildSubset } = await import('./pageops.js');
  const [bytes] = await withProgress(t('claude.extractProgress'), () => buildSubset(d, [pages]));
  const name = t('claude.extractName', { name: baseName(d.name), pages: pagesText(pages).replace(/\s/g, '') });
  const { openBytes } = await appModule();
  const nd = await openBytes(bytes, name);
  if (!nd) throw new ClaudeError('failed', 'The extracted PDF could not be opened.');
  nd.markDirty();
  logActivity(`${t('claude.logExtract', { pages: pagesText(pages) })} — ${d.name}`);
  toast(`🤖 Claude: ${t('claude.toastExtract', { pages: pagesText(pages) })}`, { type: 'ok', timeout: 6000 });
  return { text: `Opened a new unsaved tab "${name}" with ${pages.length} page(s). The original is unchanged.`, data: { new_document_id: nd.id, name, pages: nd.numPages } };
};

const SIZES = { A4: [595.28, 841.89], A3: [841.89, 1190.55], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008] };
H.insert_blank_page = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const after = p.after_page == null ? d.currentPageIndex + 1 : int(p.after_page, 'after_page', 0, d.numPages);
  const size = p.size == null ? 'same' : p.size;
  if (size !== 'same' && !SIZES[size]) throw bad(`size must be one of: same, ${Object.keys(SIZES).join(', ')}.`);
  const prev = await beginEdit(d, ctx);
  let dims = SIZES[size];
  if (!dims) {
    const info = await d.pageInfo(Math.max(0, Math.min(d.numPages - 1, after - 1)));
    const [x0, y0, x1, y1] = info.view;
    dims = info.rotate % 180 ? [y1 - y0, x1 - x0] : [x1 - x0, y1 - y0];
  }
  await d.structural(`Claude: ${t('claude.lblBlankPage')}`, (lib) => {
    const order = Array.from({ length: lib.getPageCount() }, (_, k) => k);
    lib.insertPage(after, dims);
    order.splice(after, 0, null);
    return order;
  });
  d.goToPage(after);
  didChange(d, t('claude.blankInserted', { page: after + 1 }), prev);
  return { text: `Inserted a blank page as page ${after + 1} in "${d.name}" (${Math.round(dims[0])}×${Math.round(dims[1])} pt).` };
};

async function pointOnPage(d, p) {
  const i = page1(p.page, d);
  const info = await d.pageInfo(i);
  const x = num(p.x, 'x', 0, info.w);
  const y = num(p.y, 'y', 0, info.h);
  return { i, info, x, y };
}

H.add_text = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const { i, info, x, y } = await pointOnPage(d, p);
  const text = str(p.text, 'text').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw bad('text must not be empty.');
  const size = p.size == null ? App.defaults.text.size : num(p.size, 'size', 4, 200);
  const o = { type: 'text', ...App.defaults.text, size, color: color(p.color, App.defaults.text.color), bold: bool(p.bold, false), italic: bool(p.italic, false), x, y, text };
  const prev = await beginEdit(d, ctx);
  const measure = measureFn(o);
  const need = Math.max(...text.split('\n').map((l) => measure(l))) + 4;
  o.w = Math.max(30, Math.min(need, info.w - x));
  d.addObj(i, o, { label: `Claude: ${t('claude.lblAddText')}`, select: false });
  didChange(d, t('claude.textAdded', { page: i + 1 }), prev);
  return { text: `Added a text box on page ${i + 1} at x=${Math.round(x)}, y=${Math.round(y)} pt (top-left), ${Math.round(o.w)} pt wide. It is an editable HermoPDF object until the document is saved.`, data: { object_id: o.id } };
};

H.add_note = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const { i, x, y } = await pointOnPage(d, p);
  const text = str(p.text, 'text');
  if (!text.trim()) throw bad('text must not be empty.');
  const prev = await beginEdit(d, ctx);
  const o = { type: 'note', x, y, w: 20, h: 20, text, color: App.defaults.note.color };
  d.addObj(i, o, { label: `Claude: ${t('claude.lblAddNote')}`, select: false });
  didChange(d, t('claude.noteAdded', { page: i + 1 }), prev);
  return { text: `Added a sticky note on page ${i + 1} at x=${Math.round(x)}, y=${Math.round(y)} pt. It is saved as a PDF comment.`, data: { object_id: o.id } };
};

H.highlight_text = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const q = str(p.query, 'query', { max: 200 });
  if (!q.trim()) throw bad('query must not be empty.');
  const pages = parsePages(p.pages, d.numPages);
  const kind = p.style == null ? 'highlight' : p.style;
  if (!['highlight', 'underline', 'strike'].includes(kind)) throw bad('style must be highlight, underline or strike.');
  const def = App.defaults[kind];
  const col = color(p.color, def.color);
  const cs = bool(p.case_sensitive, false);
  await ready(d, ctx);
  const { byPage, total, skipped } = await locate(d, q, pages, cs);
  if (!total) return { text: `"${q}" was not found in the selected pages${skipped ? ' (some matches are in rotated text, which cannot be highlighted)' : ''}. Pages without a text layer need OCR first.`, data: { highlighted: 0 } };
  const items = [];
  for (const [i, list] of byPage) {
    for (const rects of list) items.push({ page: i, obj: { type: 'markup', kind, rects, ...rectsBox(rects), color: col, opacity: def.opacity } });
  }
  const prev = await beginEdit(d, ctx);
  addObjects(d, items, `Claude: ${t(kind === 'highlight' ? 'claude.lblHighlight' : kind === 'underline' ? 'claude.lblUnderline' : 'claude.lblStrike')}`);
  didChange(d, t(kind === 'highlight' ? 'claude.hlDone' : kind === 'underline' ? 'claude.ulDone' : 'claude.stDone', { query: q.slice(0, 40), count: total }), prev);
  return { text: `Marked ${total} match(es) of "${q}" (${kind}) on page(s) ${pagesText([...byPage.keys()])}.${total >= MAX_MARKS ? ` Stopped at ${MAX_MARKS}.` : ''}${skipped ? ` ${skipped} match(es) in rotated text were skipped.` : ''}`, data: { highlighted: total, pages: [...byPage.keys()].map((k) => k + 1) } };
};

H.mark_redaction = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const q = str(p.query, 'query', { max: 200 });
  if (!q.trim()) throw bad('query must not be empty.');
  const pages = parsePages(p.pages, d.numPages);
  const cs = bool(p.case_sensitive, false);
  await ready(d, ctx);
  const { byPage, total, skipped } = await locate(d, q, pages, cs);
  if (!total) return { text: `"${q}" was not found in the selected pages${skipped ? ' (some matches are in rotated text)' : ''}. Nothing was marked. Scanned pages need OCR first.`, data: { marked: 0 } };
  const items = [];
  for (const [i, list] of byPage) {
    for (const rects of list) for (const r of rects) items.push({ page: i, obj: { type: 'redact', x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 } });
  }
  const prev = await beginEdit(d, ctx);
  addObjects(d, items, `Claude: ${t('claude.lblRedact')}`);
  didChange(d, t('claude.redactMarked', { query: q.slice(0, 40), count: total }), prev);
  return {
    text: `Marked ${total} match(es) of "${q}" for redaction on page(s) ${pagesText([...byPage.keys()])}. The redaction is NOT applied yet: the text is still in the file. The user must review the black boxes and click "Karartmayı uygula" (Apply redaction) in HermoPDF, then save.`,
    data: { marked: total, applied: false },
  };
};

H.compress = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const { LEVELS, autoCompress } = await import('./compress.js');
  let target = null;
  if (p.target_mb != null) target = Math.round(num(p.target_mb, 'target_mb', 0.05, 2000) * 1048576);
  const level = p.level == null ? 'medium' : p.level;
  if (!LEVELS[level]) throw bad(`level must be one of: ${Object.keys(LEVELS).join(', ')}.`);
  const allowRaster = bool(p.allow_raster, false);
  await ready(d, ctx);
  const input = await d.buildBytes({ encrypt: false });
  const best = await withProgress(t('claude.compressProgress'), (pr) => autoCompress(input, { target, p: pr, startLevel: level, allowRaster }));
  const before = input.length, after = best.bytes.length;
  const data = { before_bytes: before, after_bytes: after, level: best.level };
  if (after >= before) {
    logActivity(`${t('claude.logCompressNoGain')} — ${d.name}`);
    return { text: `The document is already compact (${fmtBytes(before)}); compression did not make it smaller, so no new tab was opened.${allowRaster ? '' : ' allow_raster=true could shrink it further at the cost of turning pages into images.'}`, data: { ...data, new_document_id: null } };
  }
  const name = t('claude.compressName', { name: baseName(d.name) });
  const { openBytes } = await appModule();
  const nd = await openBytes(best.bytes, name);
  if (!nd) throw new ClaudeError('failed', 'The compressed PDF could not be opened.');
  nd.markDirty();
  const pct = Math.round((1 - after / before) * 100);
  logActivity(`${t('claude.logCompressed', { before: fmtBytes(before), after: fmtBytes(after) })} — ${d.name}`);
  toast(`🤖 Claude: ${t('claude.toastCompressed', { before: fmtBytes(before), after: fmtBytes(after), pct })}`, { type: 'ok', timeout: 7000 });
  return {
    text: `Compressed copy opened in a new unsaved tab "${name}": ${fmtBytes(before)} → ${fmtBytes(after)} (${pct}% smaller, level ${best.level}).${target && after > target ? ` The target of ${fmtBytes(target)} could not be reached.` : ''} The original is unchanged.`,
    data: { ...data, new_document_id: nd.id },
  };
};

H.ocr_pages = async (p, ctx) => {
  const d = getDoc(p.document_id);
  const pages = parsePages(p.pages, d.numPages);
  const lang = p.lang == null ? 'tur+eng' : p.lang;
  if (!['tur+eng', 'tur', 'eng'].includes(lang)) throw bad('lang must be "tur+eng", "tur" or "eng".');
  // OCR bir Pro özelliğidir (12 Kas 2026). Claude'un isteği kullanıcı eylemi sayılmaz: yükseltme penceresi AÇILMAZ, yalnızca reddedilir.
  if (!isPro()) {
    logActivity(`${t('claude.logOcrPro')} — ${d.name}`, false);
    throw new ClaudeError('pro_required', 'OCR is a HermoPDF Pro feature and this copy of HermoPDF does not have an active Pro license, so no OCR was run. Tell the user that OCR needs HermoPDF Pro (they can see it via the crown "Pro" button in HermoPDF). Do not retry; you can still use render_page to look at scanned pages.');
  }
  await ready(d, ctx);
  const { recognizePages, applyOcrLayer } = await import('./ocr.js');
  const { results, skipped } = await withProgress(t('claude.ocrProgress'), (pr) => recognizePages(d, pages, { lang, dpi: 300, skipWithText: true, p: pr }));
  if (!results.size) {
    logActivity(`${t('claude.logOcrNone')} — ${d.name}`);
    return { text: `No OCR was needed: all ${skipped} selected page(s) already have selectable text.`, data: { pages_recognized: 0, skipped } };
  }
  const prev = await beginEdit(d, ctx); // OCR uzun sürer: bu arada sekme kapandıysa ya da istek zaman aşımına uğradıysa uygulanmaz
  const words = await applyOcrLayer(d, results);
  const done = [...results.keys()].sort((a, b) => a - b);
  didChange(d, t('claude.ocrDone', { pages: pagesText(done), count: words }), prev);
  return { text: `OCR added an invisible text layer to page(s) ${pagesText(done)} (${words} words). ${skipped ? `${skipped} page(s) already had text and were skipped. ` : ''}Use read_text to read it.`, data: { pages_recognized: done.length, skipped, words } };
};

// Claude yalnızca KENDİ adımlarını geri alabilir: kullanıcının işini (ör. uygulanmış karartmayı) geri alamaz
H.undo = async (p, ctx) => {
  const d = getDoc(p.document_id);
  await ready(d, ctx);
  const top = d.undoStack[d.undoStack.length - 1];
  if (!top) return { text: `Nothing to undo in "${d.name}".`, data: { undone: null } };
  if (!isClaudeStep(top)) {
    logActivity(`${t('claude.logUndoRefused', { label: top.label })} — ${d.name}`, false);
    throw new ClaudeError('not_allowed', `The most recent change in "${d.name}" ("${top.label}") was made by the user, not by Claude. Claude can only undo its own changes; ask the user to undo it in HermoPDF (Ctrl+Z) if needed.`);
  }
  d.claudeHold = true;
  await d.undo();
  const what = top.label.replace(/^Claude:\s*/, '');
  logActivity(`${t('claude.logUndone', { what })} — ${d.name}`);
  toast(`🤖 Claude: ${t('claude.toastUndone', { what })}`, { type: 'ok', timeout: 6000 });
  return { text: `Undid "${top.label}" in "${d.name}".`, data: { undone: top.label } };
};

H.save_document = async (p, ctx) => {
  const d = getDoc(p.document_id);
  await ready(d, ctx);
  const { activate } = await appModule();
  if (App.active !== d) activate(d);
  const body = el('div', {},
    el('p', { class: 'modal-msg', text: t('claude.saveMsg', { name: d.name }) }),
    infoBox('info', null, d.path
      ? t('claude.saveOverwrite')
      : t('claude.saveNew')),
    d.pageObjs.some((objs) => objs.some((o) => o.type === 'redact'))
      ? infoBox('triangle-alert', t('claude.redactNotApplied'), t('claude.redactNotAppliedBody'), { warn: true })
      : null);
  const choice = await modal({
    title: t('claude.saveTitle'), width: 500, className: 'claude-save-modal', body,
    buttons: [{ label: t('common.abort'), value: 'cancel' }, { label: t('claude.saveAs'), value: 'saveas' }, { label: t('common.save'), value: 'save' }],
    // Kaydet düğmesi vurgulu ama Enter ile kazara onaylanmasın: odak pencerede kalır
    onOpen: ({ foot, close }) => {
      foot.lastChild.classList.add('primary');
      // Claude'a "zaman aşımı" dendiyse pencere açık kalıp sonradan kaydetmesin
      onAbort(ctx?.signal, () => close('timeout'));
    },
  });
  if (choice === 'timeout' || ctx?.signal?.aborted) {
    throw new ClaudeError('timeout', 'The save request timed out and its dialog was closed. Nothing was saved.');
  }
  if (!App.docs.includes(d)) throw new ClaudeError('not_found', `"${d.name}" was closed in HermoPDF. Nothing was saved.`);  if (!choice || choice === 'cancel') {
    logActivity(`${t('claude.logSaveDeclined')} — ${d.name}`);
    return { text: 'The user cancelled saving. Nothing was written to disk.', data: { saved: false, choice: 'cancelled' } };
  }
  const ok = await d.save({ as: choice === 'saveas' }).catch((e) => { throw new ClaudeError('save_failed', `Saving failed: ${e.message}`); });
  if (!ok) {
    logActivity(`${t('claude.logSaveCancelled')} — ${d.name}`);
    return { text: 'The user cancelled the save dialog. Nothing was written.', data: { saved: false, choice: 'cancelled' } };
  }
  logActivity(`${t(choice === 'saveas' ? 'claude.logSavedAs' : 'claude.logSaved')} — ${d.name}`);
  return { text: `The user saved the document as "${d.name}".`, data: { saved: true, choice: choice === 'saveas' ? 'saved_as' : 'saved', name: d.name } };
};

const fileName = (f) => String(f).split(/[\\/]/).pop();

// Claude başka bir dosyayı ancak kullanıcı onaylarsa açar (PDF içindeki bir yazı Claude'u
// başka özel belgeleri açıp okumaya yönlendirmeye çalışabilir)
function confirmOpen(real, ctx) {
  const body = el('div', {},
    el('p', { class: 'modal-msg', text: t('claude.openMsg') }),
    el('div', { class: 'claude-path', text: real }),
    infoBox('triangle-alert', null, t('claude.openWarn'), { warn: true }));
  return modal({
    title: t('claude.openTitle'), width: 520, className: 'claude-open-modal', body,
    buttons: [{ label: t('common.abort'), value: 'cancel' }, { label: t('claude.openBtn'), value: 'open' }],
    // "Aç" vurgulu ama Enter ile kazara onaylanmasın
    onOpen: ({ foot, close }) => {
      foot.lastChild.classList.add('primary');
      onAbort(ctx?.signal, () => close('timeout'));
    },
  });
}

H.open_pdf = async (p, ctx) => {
  const f = str(p.path, 'path', { max: 1024 });
  if (/[\u0000-\u001f]/.test(f)) throw bad('path contains invalid characters.');
  // Yalnızca yerel sürücüdeki .pdf dosyaları (ağ yolu yok: \\sunucu\... uzak bağlantı açabilir)
  if (!/^[a-zA-Z]:[\\/]/.test(f) || /^[\\/]{2}/.test(f)) throw bad('path must be a full local path like C:\\Users\\name\\Documents\\file.pdf. Network paths are not allowed.');
  if (!/\.pdf$/i.test(f)) throw bad('Only .pdf files can be opened.');
  await waitIdle(ctx?.signal);
  // Ana süreç kısayolları/bağlantıları çözer; ağ konumuna çıkan yol reddedilir
  const chk = await window.pu.claude.checkPath(f);
  if (chk?.error === 'network') throw bad('This path leads to a network location. Only PDF files stored on this computer can be opened.');
  if (chk?.error === 'not_pdf') throw bad('Only .pdf files can be opened.');
  if (!chk || chk.error) throw new ClaudeError('not_found', 'No such PDF file.');
  if (chk.size > 1024 * 1048576) throw new ClaudeError('too_large', 'The file is too large (over 1 GB).');
  const choice = await confirmOpen(chk.path, ctx);
  if (choice === 'timeout' || ctx?.signal?.aborted) {
    throw new ClaudeError('timeout', 'The user did not answer in time; the file was not opened.');
  }
  if (choice !== 'open') {
    logActivity(`${t('claude.logOpenDeclined')} — ${fileName(chk.path)}`);
    return { text: 'The user declined to open this file in HermoPDF. Do not try to open it again unless the user asks.', data: { opened: false } };
  }
  let file;
  try { file = await window.pu.readPdf(chk.path); } catch (e) { throw new ClaudeError('not_found', 'The file could not be read.'); }
  const head = new TextDecoder('latin1').decode(file.bytes.subarray(0, 1024));
  if (!head.includes('%PDF-')) throw new ClaudeError('not_pdf', 'The file is not a PDF.');
  const { openFiles } = await appModule();
  const nd = await openFiles([file]);
  if (!nd) throw new ClaudeError('failed', 'The PDF could not be opened (it may be damaged, or the user cancelled a password prompt).');
  logActivity(t('claude.logOpened', { name: nd.name }));
  toast(`🤖 Claude: ${t('claude.toastOpened', { name: nd.name })}`, { timeout: 4000 });
  return { text: `Opened "${nd.name}" (${nd.numPages} pages).`, data: { document_id: nd.id, name: nd.name, pages: nd.numPages } };
};

const READ_ONLY = new Set(['ping', 'list_documents', 'read_text', 'search_text', 'render_page']);

// Düzenleyen istekler sırayla yürür (aynı anda iki Claude işlemi belgeyi karıştırmasın)
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

// Ana süreç bir isteği zaman aşımı ya da bağlantı kapatma yüzünden bıraktığında 'claude:cancel' gelir:
// sırada bekleyen iş hiç başlamaz, açık onay penceresi kapanır.
const controllers = new Map(); // callId -> AbortController
function cancelCall(callId) {
  const ac = controllers.get(callId);
  if (ac) ac.abort();
}

async function handleCall(req) {
  const { callId, method, params } = req || {};
  const ac = new AbortController();
  controllers.set(callId, ac);
  const ctx = { signal: ac.signal };
  let payload;
  try {
    const fn = Object.prototype.hasOwnProperty.call(H, method) ? H[method] : null;
    if (!fn) throw new ClaudeError('unknown_method', `Unknown method: ${String(method).slice(0, 60)}`);
    const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
    const run = () => {
      if (ac.signal.aborted) throw timedOut();
      return fn(p, ctx);
    };
    const result = READ_ONLY.has(method) ? await fn(p, ctx) : await serial(run);
    payload = { result };
  } catch (e) {
    const cancelled = e?.cancelled;
    const code = e instanceof ClaudeError ? e.code : cancelled ? 'cancelled' : 'error';
    const message = e instanceof ClaudeError ? e.message : cancelled ? 'The user cancelled the operation in HermoPDF.' : `HermoPDF could not do this: ${e?.message || e}`;
    if (!(e instanceof ClaudeError) && !cancelled) { console.error('claude', method, e); window.pu.log(`claude ${method} hatası: ${e?.stack || e?.message || e}`); }
    const what = t(code === 'invalid_params' ? 'claude.whatInvalid' : cancelled ? 'claude.whatCancelled' : code === 'timeout' ? 'claude.whatTimeout' : code === 'not_allowed' ? 'claude.whatNotAllowed' : 'claude.whatFailed');
    logActivity(`${method}: ${what} (${message.slice(0, 120)})`, false);
    payload = { error: { code, message } };
  } finally {
    controllers.delete(callId);
  }
  window.pu.claude.reply(callId, payload).catch(() => {});
}

// ---------------- arayüz ----------------
function applyState(s) {
  if (!s) return;
  state = { ...state, ...s };
  renderStatusButton();
}

function renderStatusButton() {
  const b = $('#sb-claude');
  if (!b) return;
  b.hidden = !state.enabled;
  b.classList.toggle('connected', state.running && state.clients > 0);
  b.classList.toggle('err', state.enabled && !state.running);
  const label = !state.running ? t('claude.stError') : state.clients > 0 ? t('claude.stConnected') : t('claude.stOpen');
  b.querySelector('.lbl').textContent = label;
  b.title = !state.running
    ? t('claude.tipError')
    : state.clients > 0 ? t('claude.tipConnected') : t('claude.tipOpen');
}

async function refresh() {
  try { applyState(await window.pu.claude.status()); } catch (e) { /* yoksay */ }
}

export function initClaude() {
  const sbRight = document.querySelector('#statusbar .sb-right');
  if (sbRight && !$('#sb-claude')) {
    const b = el('button', { id: 'sb-claude', class: 'sb-claude', hidden: true, html: `${icon('bot')}<span class="lbl">Claude</span><span class="dot"></span>` });
    b.addEventListener('click', () => showPanel());
    sbRight.prepend(b);
  }
  window.pu.on('claude:call', (req) => { handleCall(req); });
  window.pu.on('claude:cancel', (m) => { if (m && m.callId != null) cancelCall(m.callId); });
  window.pu.on('claude:clients', (s) => applyState(s));
  if (!langHooked) { langHooked = true; onLang(() => renderStatusButton()); }
  refresh();
}
let langHooked = false;

async function setEnabled(on) {
  const s = await window.pu.claude.setEnabled(on);
  applyState(s);
  return s;
}

// Şeritteki "Claude'a bağla"
export async function openClaudeDialog() {
  await refresh();
  if (state.enabled) return showPanel();
  const ok = await consent();
  if (!ok) return undefined;
  const s = await setEnabled(true);
  saveSetting({ claudeConsentAt: new Date().toISOString() });
  if (!s.running) {
    toast(t('claude.startFailed', { error: s.error || t('claude.unknownError') }), { type: 'error', timeout: 8000 });
    return undefined;
  }
  logActivity(t('claude.logConnOpened'));
  return showSetup();
}

function consent() {
  const body = el('div', { class: 'claude-consent' },
    el('p', { class: 'modal-msg', text: t('claude.consentIntro') }),
    infoBox('eye', t('claude.shareTitle'), t('claude.shareBody')),
    infoBox('info', t('claude.feeTitle'), t('claude.feeBody')),
    infoBox('shield', t('claude.controlTitle'), t('claude.controlBody')),
    infoBox('triangle-alert', t('claude.warnTitle'), t('claude.warnBody'), { warn: true }));
  return modal({
    title: t('claude.title'), width: 580, body,
    buttons: [{ label: t('common.cancel'), value: false }, { label: t('claude.openConn'), value: true, primary: true }],
  }).then((v) => v === true);
}

function setupBody(st) {
  const result = el('div', { class: 'claude-result' });
  const downloadBtn = () => el('a', { class: 'btn small', href: DOWNLOAD_URL, target: '_blank', rel: 'noopener noreferrer', html: `${icon('external-link')}${t('claude.downloadBtn')}` });
  const add = el('button', { class: 'btn primary', html: `${icon('bot')}${t('claude.addBtn')}` });
  add.addEventListener('click', async () => {
    add.disabled = true;
    try {
      const r = await window.pu.claude.openBundle();
      if (r.ok) {
        result.replaceChildren(infoBox('circle-check', t('claude.openingTitle'), t('claude.openingBody')));
      } else if (r.reason === 'missing') {
        result.replaceChildren(infoBox('triangle-alert', t('claude.missingTitle'), t('claude.missingBody'), { warn: true }));
      } else {
        result.replaceChildren(infoBox('triangle-alert', t('claude.notFoundTitle'), t('claude.notFoundBody'), { warn: true }), downloadBtn());
      }
    } finally {
      add.disabled = false;
    }
  });
  const pre = el('pre', { class: 'claude-json', text: st.manualConfig || '' });
  const copy = el('button', { class: 'btn small', html: `${icon('copy')}${t('claude.copyBtn')}` });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(st.manualConfig || ''); toast(t('claude.copied'), { type: 'ok', timeout: 1500 }); } catch (e) {
      const r = document.createRange(); r.selectNodeContents(pre); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      toast(t('claude.copyFailed'), { type: 'warn' });
    }
  });
  const manual = el('details', { class: 'claude-manual' },
    el('summary', { text: t('claude.manualSummary') }),
    el('p', { class: 'muted', text: t('claude.manualBody') }),
    pre, copy);
  return el('div', {},
    infoBox('bot', t('claude.step2Title'), t('claude.step2Body')),
    el('div', { class: 'claude-actions' }, add, el('a', { class: 'claude-link', href: DOWNLOAD_URL, target: '_blank', rel: 'noopener noreferrer', text: t('claude.noClaudeLink') })),
    result, manual);
}

async function showSetup() {
  const st = await window.pu.claude.status();
  applyState(st);
  return modal({ title: t('claude.setupTitle'), width: 580, className: 'claude-setup-modal', body: setupBody(st), buttons: [{ label: t('common.ok'), primary: true }] });
}

function logList() {
  const box = el('div', { class: 'claude-log' });
  const render = () => {
    box.replaceChildren(...(activity.length ? activity.map((a) => el('div', { class: `claude-log-row ${a.ok ? '' : 'err'}` },
      el('time', { text: a.t.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }),
      el('span', { text: a.text }))) : [el('div', { class: 'empty-note', text: t('claude.logEmpty') })]));
  };
  render();
  activityListeners.add(render);
  return { box, dispose: () => activityListeners.delete(render) };
}

async function showPanel() {
  await refresh();
  if (!state.enabled) return openClaudeDialog();
  const st = await window.pu.claude.status();
  const statusText = !st.running
    ? t('claude.statusFailed', { error: st.error || t('claude.unknownError') })
    : st.clients > 0 ? t('claude.statusConnected', { count: st.clients }) : t('claude.statusWaiting');
  const log = logList();
  const setup = el('details', { class: 'claude-manual' }, el('summary', { text: t('claude.panelSetupSummary') }), setupBody(st));
  const r = await modal({
    title: t('claude.title'), width: 600, className: 'claude-panel',
    body: el('div', {},
      el('div', { class: `claude-status ${st.running ? (st.clients ? 'ok' : '') : 'err'}` }, el('span', { class: 'dot' }), el('span', { text: statusText })),
      el('h4', { class: 'claude-h', text: t('claude.logHeading') }),
      log.box,
      el('p', { class: 'muted claude-note', text: t('claude.logNote') }),
      setup),
    buttons: [{ label: t('claude.turnOff'), value: 'off', danger: true }, { label: t('common.close'), primary: true }],
  });
  log.dispose();
  if (r === 'off') {
    await setEnabled(false);
    logActivity(t('claude.logConnClosed'));
    toast(t('claude.toastClosed'), { type: 'ok' });
  }
  return undefined;
}

export { activity };
