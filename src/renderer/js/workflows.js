// Kayıtlı iş akışları — HermoPDF Pro'nun ilk özelliği.
// Sık yapılan adımlar (ör. birleştir → küçült → filigran → parola) bir kez kaydedilir; tek tıkla açık belgeye,
// seçilen dosyalara ya da bir klasördeki tüm PDF'lere uygulanır. Her adım uygulamanın zaten test edilmiş
// bayt → bayt motorlarını kullanır (compress.js, ocr.js, batch.js, pdfcore.js).
// Kurallar:
//  - Orijinal dosyalar asla değiştirilmez; çıktı her zaman yeni dosyadır, aynı ad varsa sonuna (2), (3)… eklenir.
//  - Parola adımı parolayı ASLA kaydetmez; her çalıştırmada sorulur.
//  - Ücretsiz kullanıcı paneli açıp şablonlara bakabilir; çalıştırma, kaydetme ve oluşturma requirePro('workflows') ister.
//  - Bir dosyadaki hata diğerlerini durdurmaz; iptal edilen dosyanın yarım çıktısı yazılmaz.
import { App, saveSetting } from './state.js';
import { el, toast, modal, confirmBox, field, select, fmtBytes, baseName, withProgress, CancelError, dropdown, uid, parseRanges } from './util.js';
import { icon } from './icons.js';
import { infoBox } from './assist.js';
import { PDFLib, loadPdfLib, savePdfLib, openPdfjs, copyPagesClean, removePagesClean } from './pdfcore.js';
import { autoCompress, LEVELS } from './compress.js';
import { batchWatermark, batchNumbers } from './batch.js';
import { isPro, requirePro, onProChange, openUpgrade } from './pro.js';
import { t, locale } from './i18n.js';

const MAX_RECIPES = 50;
const MAX_STEPS = 12;
export const DEFAULT_PATTERN = '{ad}-{tarih}';
const PLACEHOLDERS = ['ad', 'tarih', 'saat', 'n'];

const COMPRESS_LEVELS = ['light', 'medium', 'strong', 'extreme', 'raster150', 'raster100'];
const OCR_LANG_VALUES = ['tur+eng', 'tur', 'eng'];
const ocrLangs = () => [{ value: 'tur+eng', label: t('batch.ocrLangTrEn') }, { value: 'tur', label: t('batch.ocrLangTr') }, { value: 'eng', label: t('batch.ocrLangEn') }];
const numFormats = () => [{ value: '{n}', label: '1, 2, 3…' }, { value: '{n} / {t}', label: '1 / 10' }, { value: t('workflows.fmtPage'), label: t('workflows.fmtPageLabel') }, { value: t('workflows.fmtPageOf'), label: t('workflows.fmtPageOfLabel') }];
const rotations = () => [{ value: 90, label: t('workflows.rotRight') }, { value: 180, label: '180°' }, { value: 270, label: t('workflows.rotLeft') }];

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.').trim()));
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const mb = (v) => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2, useGrouping: false }).format(Number(v))} MB`;

// ---------------- işlem kataloğu ----------------
// check(params) → { params (temizlenmiş), error? }   chip(params) → kısa özet
export const OPS = {
  merge: {
    get label() { return t('workflows.opMerge'); }, icon: 'combine', weight: 1, defaults: {},
    get hint() { return t('workflows.hintMerge'); },
    check: () => ({ params: {} }),
    chip: () => t('workflows.chipMerge'),
  },
  compress: {
    get label() { return t('workflows.opCompress'); }, icon: 'shrink', weight: 3, defaults: { level: 'medium', targetMB: null, allowRaster: true },
    get hint() { return t('workflows.hintCompress'); },
    check: (p) => {
      const level = COMPRESS_LEVELS.includes(p.level) ? p.level : 'medium';
      const allowRaster = p.allowRaster !== false;
      const tm = num(p.targetMB);
      if (!COMPRESS_LEVELS.includes(p.level)) return { params: { level, targetMB: null, allowRaster }, error: t('workflows.errCompressLevel') };
      if (tm != null && (!Number.isFinite(tm) || tm < 0.05 || tm > 2000)) return { params: { level, targetMB: null, allowRaster }, error: t('workflows.errCompressTarget') };
      return { params: { level, targetMB: tm == null ? null : Math.round(tm * 100) / 100, allowRaster } };
    },
    chip: (p) => (p.targetMB ? t('workflows.chipCompressTarget', { size: mb(p.targetMB) }) : t('workflows.chipCompress', { level: LEVELS[p.level]?.label || p.level })),
  },
  ocr: {
    get label() { return t('workflows.opOcr'); }, icon: 'scan-text', weight: 6, defaults: { lang: 'tur+eng', dpi: 300, skipText: true },
    get hint() { return t('workflows.hintOcr'); },
    check: (p) => {
      const params = { lang: OCR_LANG_VALUES.includes(p.lang) ? p.lang : 'tur+eng', dpi: +p.dpi === 200 ? 200 : 300, skipText: p.skipText !== false };
      if (!OCR_LANG_VALUES.includes(p.lang)) return { params, error: t('workflows.errOcrLang') };
      if (+p.dpi !== 200 && +p.dpi !== 300) return { params, error: t('workflows.errOcrQuality') };
      return { params };
    },
    chip: (p) => t('workflows.chipOcr', { lang: ocrLangs().find((l) => l.value === p.lang)?.label || p.lang }),
  },
  watermark: {
    get label() { return t('workflows.opWatermark'); }, icon: 'droplets', weight: 1, get defaults() { return { text: t('workflows.wmDraft'), color: '#d32f2f' }; },
    check: (p) => {
      const text = str(p.text, 60);
      const color = /^#[0-9a-f]{6}$/i.test(String(p.color || '')) ? String(p.color).toLowerCase() : '#d32f2f';
      if (!text) return { params: { text, color }, error: t('workflows.errWmEmpty') };
      if (!/^#[0-9a-f]{6}$/i.test(String(p.color || ''))) return { params: { text, color }, error: t('workflows.errColor') };
      return { params: { text, color } };
    },
    chip: (p) => t('workflows.chipWatermark', { text: p.text }),
  },
  numbers: {
    get label() { return t('workflows.opNumbers'); }, icon: 'list-ordered', weight: 1, get defaults() { return { format: t('workflows.fmtPageOf') }; },
    check: (p) => {
      const format = str(p.format, 40);
      if (!format.includes('{n}')) return { params: { format: '{n} / {t}' }, error: t('workflows.errFormatN') };
      return { params: { format } };
    },
    chip: (p) => t('workflows.chipNumbers', { sample: p.format.replace('{n}', '1').replace('{t}', '10') }),
  },
  rotate: {
    get label() { return t('workflows.opRotate'); }, icon: 'rotate-cw', weight: 1, defaults: { deg: 90 },
    check: (p) => {
      const deg = +p.deg;
      if (![90, 180, 270].includes(deg)) return { params: { deg: 90 }, error: t('workflows.errRotate') };
      return { params: { deg } };
    },
    chip: (p) => t('workflows.chipRotate', { dir: rotations().find((r) => r.value === p.deg)?.label || `${p.deg}°` }),
  },
  removePages: {
    get label() { return t('workflows.opRemovePages'); }, icon: 'trash-2', weight: 1, defaults: { range: '' },
    get hint() { return t('workflows.hintRemovePages'); },
    check: (p) => {
      const range = str(p.range, 200);
      if (!range) return { params: { range }, error: t('workflows.errRangeEmpty') };
      if (!/^[\d\s,;-]+$/.test(range)) return { params: { range }, error: t('workflows.errRangeChars') };
      try { parseRanges(range, 100000); } catch (e) { return { params: { range }, error: e.message }; }
      return { params: { range } };
    },
    chip: (p) => t('workflows.chipRemovePages', { range: p.range || '?' }),
  },
  metadata: {
    get label() { return t('workflows.opMetadata'); }, icon: 'eye-off', weight: 1, defaults: { mode: 'clear', title: '', author: '', subject: '', keywords: '' },
    get hint() { return t('workflows.hintMetadata'); },
    check: (p) => {
      const params = { mode: p.mode === 'set' ? 'set' : 'clear', title: str(p.title, 300), author: str(p.author, 300), subject: str(p.subject, 300), keywords: str(p.keywords, 300) };
      if (p.mode !== 'set' && p.mode !== 'clear') return { params, error: t('workflows.errChoice') };
      if (params.mode === 'set' && !params.title && !params.author && !params.subject && !params.keywords) return { params, error: t('workflows.errMetaEmpty') };
      return { params };
    },
    chip: (p) => (p.mode === 'set' ? t('workflows.chipMetaSet') : t('workflows.chipMetaClear')),
  },
  protect: {
    get label() { return t('workflows.opProtect'); }, icon: 'lock', weight: 1, defaults: {},
    get hint() { return t('workflows.hintProtect'); },
    // Parola ASLA tarifte tutulmaz: gelen her alan atılır
    check: () => ({ params: {} }),
    chip: () => t('workflows.chipProtect'),
  },
};

// ---------------- hazır şablonlar ----------------
export const TEMPLATES = [
  {
    id: 'tpl-apply', template: true, get name() { return t('workflows.tplApplyName'); }, get desc() { return t('workflows.tplApplyDesc'); },
    steps: [{ op: 'merge', params: {} }, { op: 'compress', params: { level: 'medium', targetMB: 1, allowRaster: true } }],
    get output() { return { folder: 'same', pattern: t('workflows.tplApplyPattern') }; },
  },
  {
    id: 'tpl-ocr', template: true, get name() { return t('workflows.tplOcrName'); }, get desc() { return t('workflows.tplOcrDesc'); },
    steps: [{ op: 'ocr', params: { lang: 'tur+eng', dpi: 300, skipText: true } }, { op: 'compress', params: { level: 'medium', targetMB: null, allowRaster: false } }],
    get output() { return { folder: 'same', pattern: t('workflows.tplOcrPattern') }; },
  },
  {
    id: 'tpl-draft', template: true, get name() { return t('workflows.tplDraftName'); }, get desc() { return t('workflows.tplDraftDesc'); },
    get steps() { return [{ op: 'watermark', params: { text: t('workflows.wmDraft'), color: '#d32f2f' } }, { op: 'numbers', params: { format: t('workflows.fmtPageOf') } }]; },
    get output() { return { folder: 'same', pattern: t('workflows.tplDraftPattern') }; },
  },
];

// ---------------- doğrulama ----------------
const isAbsPath = (p) => typeof p === 'string' && (/^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(p));

export function patternError(pattern) {
  if (!pattern) return t('workflows.patEmpty');
  for (const m of pattern.matchAll(/\{([^}]*)\}/g)) {
    if (!PLACEHOLDERS.includes(m[1])) return t('workflows.patUnknown', { field: m[1] });
  }
  if (/[{}]/.test(pattern.replace(/\{(ad|tarih|saat|n)\}/g, ''))) return t('workflows.patBraces');
  return null;
}

// Tarifi doğrular ve temizler (bilinmeyen alanlar atılır). Döndürür: { ok, errors[], recipe }
export function normalizeRecipe(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const name = str(r.name, 80);
  if (!name) errors.push(t('workflows.errName'));
  const stepsIn = Array.isArray(r.steps) ? r.steps : [];
  if (!stepsIn.length) errors.push(t('workflows.errNoSteps'));
  if (stepsIn.length > MAX_STEPS) errors.push(t('workflows.errMaxSteps', { max: MAX_STEPS }));
  const steps = [];
  stepsIn.slice(0, MAX_STEPS).forEach((s, i) => {
    const op = s && OPS[s.op];
    if (!op || !Object.prototype.hasOwnProperty.call(OPS, s.op)) { errors.push(t('workflows.errStepUnknown', { num: i + 1 })); return; }
    const given = s.params && typeof s.params === 'object' ? s.params : {};
    const { params, error } = op.check({ ...op.defaults, ...given });
    if (error) errors.push(t('workflows.errStep', { num: i + 1, label: op.label, error }));
    steps.push({ op: s.op, params });
  });
  if (steps.some((s, i) => s.op === 'merge' && i !== 0)) errors.push(t('workflows.errMergeFirst'));
  if (steps.some((s, i) => s.op === 'protect' && i !== steps.length - 1)) errors.push(t('workflows.errProtectLast'));
  const o = r.output && typeof r.output === 'object' ? r.output : {};
  let folder = o.folder;
  if (folder !== 'same' && folder !== 'ask') {
    if (isAbsPath(folder)) folder = String(folder).trim();
    else { errors.push(t('workflows.errFolder')); folder = 'same'; }
  }
  const pattern = str(o.pattern ?? DEFAULT_PATTERN, 120);
  const pe = patternError(pattern);
  if (pe) errors.push(pe);
  const id = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : `wf-${uid()}`;
  return { ok: !errors.length, errors, recipe: { id, name, steps, output: { folder, pattern } } };
}

// Dosya adı kalıbını uygular: {ad} {tarih} {saat} {n}. Sonuç her zaman .pdf ile biter; Windows'ta geçersiz karakterler _ olur.
export function renderName(pattern, { ad, n = 1, now = new Date() } = {}) {
  const p2 = (x) => String(x).padStart(2, '0');
  const vals = {
    ad: String(ad || t('workflows.defaultName')),
    tarih: `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`,
    saat: `${p2(now.getHours())}.${p2(now.getMinutes())}`,
    n: String(n),
  };
  // İşlevli replace: "$&", "$`" gibi özel diziler dosya adında yorumlanmasın
  let s = String(pattern || DEFAULT_PATTERN).replace(/\{(ad|tarih|saat|n)\}/g, (_, k) => vals[k]);
  s = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.pdf$/i, '').replace(/[. ]+$/, '').trim();
  if (!s) s = vals.ad;
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  return `${s.slice(0, 150)}.pdf`;
}

// ---------------- kayıt (settings.workflows) ----------------
export function loadRecipes() {
  const list = Array.isArray(App.settings.workflows) ? App.settings.workflows : [];
  // Bozuk/eksik kayıtları da gösterebilmek için temizlenmiş kopyayı kullan (kimliği koru)
  return list.slice(0, MAX_RECIPES).map((r) => normalizeRecipe(r).recipe);
}
function storeRecipes(list) {
  return saveSetting({ workflows: list.slice(0, MAX_RECIPES).map((r) => ({ id: r.id, name: r.name, steps: r.steps, output: r.output })) });
}
// Doğrulayıp kaydeder (aynı kimlik varsa günceller). Pro gerekir. Döndürür: { ok, errors, recipe }
export async function upsertRecipe(raw) {
  if (!isPro()) return { ok: false, errors: [t('workflows.errNeedPro')] };
  const res = normalizeRecipe(raw);
  if (!res.ok) return res;
  const list = loadRecipes();
  const k = list.findIndex((x) => x.id === res.recipe.id);
  if (k >= 0) list[k] = res.recipe;
  else {
    if (list.length >= MAX_RECIPES) return { ok: false, errors: [t('workflows.errMaxRecipes', { max: MAX_RECIPES })], recipe: res.recipe };
    list.push(res.recipe);
  }
  await storeRecipes(list);
  return res;
}
async function deleteRecipe(id) {
  await storeRecipes(loadRecipes().filter((r) => r.id !== id));
}

// ---------------- adım motorları (bayt → bayt) ----------------
function encryptLib(lib, password) {
  const opts = {
    userPassword: password, ownerPassword: password,
    permissions: { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true },
  };
  try {
    lib.encrypt(opts);
  } catch (e) {
    // pdf-lib PDF/A belgeyi şifrelemeyi reddeder: PDF/A işaretlerini kaldır (şifreli dosya zaten PDF/A olamaz)
    if (!/PDF\/A/i.test(e.message || '')) throw e;
    const { PDFName } = PDFLib();
    lib.catalog.delete(PDFName.of('Metadata'));
    lib.catalog.delete(PDFName.of('OutputIntents'));
    lib.encrypt(opts);
  }
}

const RUN = {
  async compress(bytes, p, c) {
    const target = p.targetMB ? Math.round(p.targetMB * 1048576) : null;
    c.target = target;
    if (target && bytes.length <= target) { c.note(t('workflows.noteAlreadyUnder', { size: mb(p.targetMB) })); return bytes; }
    const best = await autoCompress(bytes, { target, allowRaster: p.allowRaster, startLevel: p.level, p: { set: (v, m) => c.progress(v, m), check: c.check } });
    if (best.bytes.length >= bytes.length) {
      if (target) c.warn(t('workflows.warnNoShrink', { target: mb(p.targetMB), size: fmtBytes(bytes.length) }));
      else c.note(t('workflows.noteWellCompressed'));
      c.targetWarned = !!target;
      return bytes;
    }
    if (target && best.bytes.length > target) {
      c.warn(t('workflows.warnTargetMissed', { target: mb(p.targetMB), size: fmtBytes(best.bytes.length) }));
      c.targetWarned = true;
    }
    return best.bytes;
  },
  async ocr(bytes, p, c) {
    const { ocrBytes } = await import('./ocr.js');
    const out = await ocrBytes(bytes, { lang: p.lang, dpi: p.dpi, skipWithText: p.skipText, onProgress: (v, m) => c.progress(v, `OCR: ${m || ''}`), check: c.check });
    if (out === bytes) c.note(t('workflows.noteHadText'));
    return out;
  },
  async watermark(bytes, p) { return batchWatermark(bytes, p.text, p.color); },
  async numbers(bytes, p) { return batchNumbers(bytes, p.format); },
  async rotate(bytes, p) {
    const { degrees } = PDFLib();
    const lib = await loadPdfLib(bytes);
    for (const page of lib.getPages()) page.setRotation(degrees((page.getRotation().angle + p.deg) % 360));
    return savePdfLib(lib);
  },
  async removePages(bytes, p, c) {
    const lib = await loadPdfLib(bytes);
    const total = lib.getPageCount();
    const del = parseRanges(p.range, total);
    if (!del.length) { c.note(t('workflows.noteNoPagesInRange', { range: p.range })); return bytes; }
    if (del.length >= total) throw new Error(t('workflows.errAllPages', { range: p.range }));
    removePagesClean(lib, del);
    return savePdfLib(lib);
  },
  async metadata(bytes, p) {
    const { PDFName } = PDFLib();
    const lib = await loadPdfLib(bytes);
    const inf = lib.context.lookup(lib.context.trailerInfo.Info);
    if (inf && inf.entries) for (const [k] of inf.entries()) inf.delete(k);
    lib.catalog.delete(PDFName.of('Metadata'));
    if (p.mode === 'set') {
      if (p.title) lib.setTitle(p.title);
      if (p.author) lib.setAuthor(p.author);
      if (p.subject) lib.setSubject(p.subject);
      if (p.keywords) lib.setKeywords(p.keywords.split(/\s*[,;]\s*/).filter(Boolean));
    }
    return savePdfLib(lib);
  },
  async protect(bytes, p, c) {
    if (!c.password) throw new Error(t('workflows.errNoPassword'));
    const lib = await loadPdfLib(bytes);
    encryptLib(lib, c.password);
    return savePdfLib(lib);
  },
};

// Girdi baytlarını doğrular: bozuk / parolalı / düzenleme kısıtlı dosyaları dostça hatayla ayırır.
// Açma parolası olmayan ama şifreli (boş parolalı) dosyalar çözülür. Döndürür: { bytes, pages }
async function prepareInput(bytes) {
  let src;
  try {
    src = await openPdfjs(bytes);
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error(t('workflows.errLocked'));
    throw new Error(t('workflows.errCorrupt'));
  }
  let pages = 0;
  let perms = null;
  try {
    pages = src.doc.numPages;
    perms = await src.doc.getPermissions().catch(() => null);
  } finally { src.destroy(); }
  if (perms) {
    const set = new Set(perms);
    if (!set.has(0x08) || !set.has(0x400)) throw new Error(t('workflows.errRestricted'));
  }
  // Şifreli ama parolasız açılabilen dosya: sonraki adımlar için şifresini çöz
  if (hasEncrypt(bytes)) {
    const lib = await loadPdfLib(bytes, '');
    bytes = await savePdfLib(lib);
  }
  return { bytes, pages };
}
function hasEncrypt(bytes) {
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096));
  const s = new TextDecoder('latin1').decode(tail);
  if (/\/Encrypt\b/.test(s)) return true;
  // xref akışlı dosyalarda /Encrypt baştaki bir sözlükte olabilir
  return /\/Encrypt\s/.test(new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 8 * 1048576))));
}

function friendlyError(e) {
  const m = String(e?.message || e || t('workflows.errUnknown')).replace(/Error invoking remote method '[^']+': (Error: )?/g, '');
  if (/No PDF header|Failed to parse|Invalid PDF/i.test(m)) return t('workflows.errCorrupt');
  if (/ENOENT/.test(m)) return t('workflows.errNotFound');
  if (/EACCES|EPERM|EBUSY/.test(m)) return t('workflows.errAccess');
  return m;
}

const dirOf = (p) => (p ? String(p).replace(/[\\/][^\\/]*$/, '') : null);
const fileOf = (p) => String(p || '').split(/[\\/]/).pop();

async function readInput(f) {
  if (f.bytes) return f.bytes;
  const r = await window.pu.readPdf(f.path);
  return r.bytes;
}

// Bir dosya (ya da birleştirilmiş dosya) için adımları sırayla uygular
async function runSteps(bytes, steps, ctx) {
  const total = steps.reduce((a, s) => a + OPS[s.op].weight, 0) || 1;
  let done = 0;
  for (const s of steps) {
    ctx.check();
    const op = OPS[s.op];
    const w = op.weight / total;
    const at = done;
    const c = {
      ...ctx,
      progress: (v, m) => ctx.progress(at + Math.min(1, Math.max(0, v || 0)) * w, `${op.label}${m ? ` — ${m}` : ''}`),
    };
    c.progress(0);
    bytes = await RUN[s.op](bytes, s.params, c);
    if (c.target !== undefined) { ctx.target = c.target; ctx.targetWarned = !!c.targetWarned; }
    done += w;
  }
  return bytes;
}

// Tarifi verilen girdilere uygular. Döndürür: { results:[{input, out, path, before, after, pages, warnings, notes, error}], cancelled }
export async function runJobs(recipe, inputs, { outDir = null, password = null } = {}) {
  const results = [];
  const merge = recipe.steps[0]?.op === 'merge';
  const steps = merge ? recipe.steps.slice(1) : recipe.steps;
  const jobs = merge ? [inputs] : inputs.map((f) => [f]);
  const now = new Date();
  let cancelled = false;
  try {
    await withProgress(t('workflows.progressTitle', { name: recipe.name }), async (p) => {
      for (let k = 0; k < jobs.length; k++) {
        p.check();
        const base = k / jobs.length;
        const span = 1 / jobs.length;
        const group = jobs[k];
        const label = merge ? t('workflows.mergedFile') : group[0].name;
        const head = jobs.length > 1 ? `${k + 1}/${jobs.length} — ${label}` : label;
        const r = { input: label, before: 0, warnings: [], notes: [] };
        const ctx = {
          check: () => p.check(),
          progress: (v, m) => p.set(base + span * (0.05 + 0.9 * v), `${head}: ${m || ''}`),
          warn: (m) => r.warnings.push(m),
          note: (m) => r.notes.push(m),
          password,
        };
        try {
          let bytes;
          let first = group[0];
          if (merge) {
            const { PDFDocument } = PDFLib();
            const out = await PDFDocument.create();
            const used = [];
            for (let i = 0; i < group.length; i++) {
              p.check();
              const f = group[i];
              p.set(base + span * 0.05 * (i / group.length), t('workflows.merging', { name: f.name, index: i + 1, total: group.length }));
              try {
                const inp = await prepareInput(await readInput(f));
                const src = await loadPdfLib(inp.bytes);
                const cp = await copyPagesClean(out, src, src.getPageIndices());
                cp.forEach((x) => out.addPage(x));
                r.before += f.size || inp.bytes.length;
                used.push(f);
              } catch (e) {
                if (e instanceof CancelError || e?.cancelled) throw e;
                console.error('iş akışı birleştirme', f.name, e);
                results.push({ input: f.name, error: t('workflows.notMerged', { error: friendlyError(e) }), warnings: [], notes: [] });
              } finally { f.bytes = null; }
            }
            if (!used.length) throw new Error(t('workflows.errNoneToMerge'));
            first = used[0];
            r.input = t('workflows.mergedCount', { count: used.length });
            bytes = await savePdfLib(out);
          } else {
            const inp = await prepareInput(await readInput(first));
            first.bytes = null;
            bytes = inp.bytes;
            r.before = first.size || bytes.length;
          }
          bytes = await runSteps(bytes, steps, ctx);
          if (ctx.target && bytes.length > ctx.target && !ctx.targetWarned) {
            r.warnings.push(t('workflows.warnTargetExceeded', { target: fmtBytes(ctx.target), size: fmtBytes(bytes.length) }));
          }
          p.check();
          const dir = outDir || dirOf(first.path);
          if (!dir) throw new Error(t('workflows.errNoOutDir'));
          const name = renderName(recipe.output.pattern, { ad: baseName(first.name), n: k + 1, now });
          p.set(base + span * 0.97, `${head}: ${t('workflows.saving')}`);
          // Yeni dosyaya yazılır; var olan hiçbir dosyanın (orijinaller dahil) üzerine yazılmaz
          r.path = await window.pu.workflow.write(dir, name, bytes);
          r.out = fileOf(r.path);
          r.after = bytes.length;
        } catch (e) {
          if (e instanceof CancelError || e?.cancelled) throw e;
          console.error('iş akışı', label, e);
          r.error = friendlyError(e);
        }
        results.push(r);
      }
    });
  } catch (e) {
    if (!(e instanceof CancelError) && !e?.cancelled) throw e;
    cancelled = true;
  }
  return { results, cancelled };
}

// ---------------- çalıştırma ----------------
function askPassword(count) {
  const pw = el('input', { class: 'input wf-pw1', type: 'password', placeholder: t('workflows.pwPh'), autocomplete: 'new-password' });
  const pw2 = el('input', { class: 'input wf-pw2', type: 'password', placeholder: t('workflows.pwAgainPh'), autocomplete: 'new-password' });
  const show = el('input', { type: 'checkbox' });
  show.onchange = () => { pw.type = pw2.type = show.checked ? 'text' : 'password'; };
  const err = el('div', { class: 'wf-err', role: 'alert', hidden: true });
  const fail = (m) => { err.textContent = m; err.hidden = false; return false; };
  return modal({
    title: t('workflows.pwTitle'), width: 460, className: 'wf-pw-modal',
    body: el('div', {},
      el('p', { class: 'modal-msg', text: count > 1 ? t('workflows.pwBodyMulti') : t('workflows.pwBodySingle') }),
      field(t('batch.password'), pw), field(t('workflows.pwAgain'), pw2),
      el('label', { class: 'checkline' }, show, t('workflows.pwShow')),
      el('p', { class: 'muted', style: { fontSize: '12px' }, text: t('workflows.pwWarn') }),
      err),
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('workflows.next'), id: 'ok', primary: true, run: () => {
      if (!pw.value) return fail(t('workflows.pwEmpty'));
      if (pw.value !== pw2.value) return fail(t('workflows.pwMismatch'));
      return pw.value;
    } }],
  });
}

async function gatherInputs(source, recipe) {
  if (source === 'doc') {
    const d = App.active;
    if (!d) { toast(t('common.needDoc'), { type: 'warn' }); return null; }
    // Kaydedilmemiş düzenlemeler dahil, belgenin şu anki hali (belgenin kendisi değişmez)
    const bytes = await d.buildBytes({ encrypt: false });
    return [{ name: d.name || t('workflows.docName'), path: d.path || null, size: bytes.length, bytes }];
  }
  if (source === 'files') {
    const files = await window.pu.openPdfDialog({ multi: true, title: t('workflows.pickFilesTitle', { name: recipe.name }) });
    return files.length ? files : null;
  }
  if (source === 'folder') {
    const r = await window.pu.workflow.pickFolder({ title: t('workflows.pickFolderTitle', { name: recipe.name }) });
    if (!r) return null;
    if (!r.files.length) { toast(t('workflows.noPdfInFolder'), { type: 'warn', timeout: 5000 }); return null; }
    return r.files;
  }
  return null;
}

export async function runRecipe(raw, source) {
  if (!requirePro('workflows')) return null;
  const { ok, errors, recipe } = normalizeRecipe(raw);
  if (!ok) { toast(t('workflows.runFailed', { error: errors[0] }), { type: 'warn', timeout: 7000 }); return null; }
  const inputs = await gatherInputs(source, recipe);
  if (!inputs) return null;
  let password = null;
  if (recipe.steps.some((s) => s.op === 'protect')) {
    password = await askPassword(recipe.steps[0].op === 'merge' ? 1 : inputs.length);
    if (!password) return null;
  }
  let outDir = null;
  const f = recipe.output.folder;
  if (f === 'ask' || (f === 'same' && inputs.some((x) => !x.path))) {
    outDir = await window.pu.folderDialog({ title: t('workflows.outFolderTitle') });
    if (!outDir) return null;
  } else if (f !== 'same') outDir = f;
  const res = await runJobs(recipe, inputs, { outDir, password });
  password = null;
  await showSummary(recipe, res);
  return res;
}

async function showSummary(recipe, { results, cancelled }) {
  const done = results.filter((r) => r.path);
  const failed = results.filter((r) => r.error);
  const rows = results.map((r) => {
    const status = r.error ? 'error' : r.warnings.length ? 'warn' : 'ok';
    const detail = r.error ? el('div', { class: 'wf-res-err', text: r.error })
      : el('div', {}, el('div', { class: 'wf-res-out', text: r.out }),
        r.warnings.map((w) => el('div', { class: 'wf-res-warn', html: `${icon('triangle-alert')}<span></span>` })).map((n, i) => { n.querySelector('span').textContent = r.warnings[i]; return n; }),
        r.notes.map((m) => el('div', { class: 'wf-res-note muted', text: m })));
    return el('tr', { dataset: { status } },
      el('td', { class: 'wf-res-in', text: r.input }),
      el('td', {}, detail),
      el('td', { class: 'wf-res-size', text: r.error ? '—' : `${r.before ? `${fmtBytes(r.before)} → ` : ''}${fmtBytes(r.after)}` }));
  });
  const before = done.reduce((a, r) => a + (r.before || 0), 0);
  const after = done.reduce((a, r) => a + (r.after || 0), 0);
  let msg = failed.length ? t('workflows.sumReadyFailed', { count: done.length, failed: failed.length }) : t('workflows.sumReady', { count: done.length });
  if (cancelled) msg += ` ${t('workflows.sumCancelled')}`;
  msg += ` ${t('workflows.sumUnchanged')}`;
  const openTarget = dirOf(done[0]?.path);
  const r2 = await modal({
    title: cancelled ? t('workflows.sumStopped') : t('workflows.sumDone', { name: recipe.name }), width: 720, className: 'wf-summary-modal',
    body: el('div', {},
      el('p', { class: 'modal-msg wf-sum-msg', text: msg }),
      rows.length ? el('table', { class: 'info-table wf-res' },
        el('tr', {}, el('th', { text: t('workflows.thInput') }), el('th', { text: t('workflows.thResult') }), el('th', { text: t('workflows.thSize') })),
        rows,
        done.length > 1 ? el('tr', { class: 'wf-res-total' }, el('td', { text: t('workflows.total') }), el('td'), el('td', { text: `${fmtBytes(before)} → ${fmtBytes(after)}` })) : null) : null),
    buttons: openTarget ? [{ label: t('common.close') }, { label: t('batch.openFolder'), id: 'open', primary: true, value: 'open' }] : [{ label: t('common.close'), primary: true }],
  });
  if (r2 === 'open' && openTarget) window.pu.openPath(openTarget);
}

// ---------------- düzenleyici ----------------
function stepEditor(step, onChange) {
  const p = step.params;
  const bind = (input, key, conv = (v) => v, ev = 'input') => {
    input.addEventListener(ev, () => { p[key] = conv(input.type === 'checkbox' ? input.checked : input.value); onChange(); });
    return input;
  };
  const sel = (opts, key, cls, conv) => { const s = select(opts, p[key]); s.classList.add(cls); return bind(s, key, conv, 'change'); };
  switch (step.op) {
    case 'compress': {
      const level = sel(COMPRESS_LEVELS.map((k) => ({ value: k, label: LEVELS[k].label })), 'level', 'wf-p-level');
      const target = bind(el('input', { class: 'input wf-p-target', type: 'text', inputmode: 'decimal', placeholder: t('workflows.targetPh'), value: p.targetMB ?? '' }), 'targetMB', (v) => (String(v).trim() === '' ? null : String(v).trim()));
      const raster = bind(el('input', { type: 'checkbox', class: 'wf-p-raster', checked: p.allowRaster !== false }), 'allowRaster', (v) => !!v, 'change');
      return el('div', {}, el('div', { class: 'row' }, field(t('workflows.targetMb'), target), field(t('workflows.levelNoTarget'), level)),
        el('label', { class: 'checkline' }, raster, t('workflows.allowRaster')));
    }
    case 'ocr':
      return el('div', { class: 'row' }, field(t('batch.lang'), sel(ocrLangs(), 'lang', 'wf-p-lang')),
        field(t('batch.quality'), sel([{ value: 200, label: t('batch.dpiFast') }, { value: 300, label: t('batch.dpiBalanced') }], 'dpi', 'wf-p-dpi', (v) => +v)),
        el('label', { class: 'checkline' }, bind(el('input', { type: 'checkbox', checked: p.skipText !== false }), 'skipText', (v) => !!v, 'change'), t('workflows.skipText')));
    case 'watermark':
      return el('div', { class: 'row' },
        field(t('batch.wmText'), bind(el('input', { class: 'input wf-p-text', value: p.text || '', maxlength: 60 }), 'text')),
        el('label', { class: 'field', style: { flex: '0 0 auto' } }, el('span', { class: 'field-label', text: t('batch.color') }), bind(el('input', { type: 'color', class: 'color-pick wf-p-color', value: p.color || '#d32f2f' }), 'color')));
    case 'numbers': {
      const fmts = numFormats();
      const opts = fmts.some((f) => f.value === p.format) ? fmts : [...fmts, { value: p.format, label: p.format }];
      return field(t('batch.format'), sel(opts, 'format', 'wf-p-format'));
    }
    case 'rotate':
      return field(t('workflows.direction'), sel(rotations(), 'deg', 'wf-p-deg', (v) => +v));
    case 'removePages':
      return field(t('workflows.pagesToDelete'), bind(el('input', { class: 'input wf-p-range', value: p.range || '', placeholder: t('workflows.rangePh') }), 'range'));
    case 'metadata': {
      const extra = el('div', { class: 'wf-meta-fields' },
        el('div', { class: 'row' }, field(t('workflows.metaTitle'), bind(el('input', { class: 'input wf-p-title', value: p.title || '' }), 'title')), field(t('workflows.metaAuthor'), bind(el('input', { class: 'input', value: p.author || '' }), 'author'))),
        el('div', { class: 'row' }, field(t('workflows.metaSubject'), bind(el('input', { class: 'input', value: p.subject || '' }), 'subject')), field(t('workflows.metaKeywords'), bind(el('input', { class: 'input', value: p.keywords || '' }), 'keywords'))));
      const mode = sel([{ value: 'clear', label: t('workflows.metaModeClear') }, { value: 'set', label: t('workflows.metaModeSet') }], 'mode', 'wf-p-mode');
      const sync = () => { extra.hidden = mode.value !== 'set'; };
      mode.addEventListener('change', sync);
      sync();
      return el('div', {}, field(t('workflows.operation'), mode), extra);
    }
    default:
      return null;
  }
}

function outputSummary(o) {
  const where = o.folder === 'same' ? t('workflows.outSame') : o.folder === 'ask' ? t('workflows.outAskShort') : o.folder;
  return `${where} · ${renderName(o.pattern, { ad: t('workflows.sampleName') })}`;
}

export function openEditor(initial) {
  const w = JSON.parse(JSON.stringify(initial || { name: '', steps: [], output: { folder: 'same', pattern: DEFAULT_PATTERN } }));
  w.output = { folder: 'same', pattern: DEFAULT_PATTERN, ...(w.output || {}) };
  const nameIn = el('input', { class: 'input wf-name-in', value: w.name || '', maxlength: 80, placeholder: t('workflows.namePh') });
  nameIn.addEventListener('input', () => { w.name = nameIn.value; validate(); });
  const stepsBox = el('div', { class: 'wf-steps' });
  const addSel = el('select', { class: 'input wf-add-op' });
  const addBtn = el('button', { class: 'btn wf-add-btn', html: `${icon('plus')}${t('workflows.addStep')}` });
  const err = el('div', { class: 'wf-err', role: 'alert', hidden: true });

  const custom = () => w.output.folder !== 'same' && w.output.folder !== 'ask';
  const folderSel = select([{ value: 'same', label: t('workflows.outSame') }, { value: 'ask', label: t('workflows.outAsk') }, { value: 'custom', label: t('workflows.outCustom') }], custom() ? 'custom' : w.output.folder);
  folderSel.classList.add('wf-out-folder');
  const pathEl = el('div', { class: 'wf-out-path' });
  const pickBtn = el('button', { class: 'btn small wf-pick-folder', html: `${icon('folder-open')}${t('workflows.pickFolder')}` });
  const pathRow = el('div', { class: 'row wf-path-row' }, pathEl, pickBtn);
  const patternIn = el('input', { class: 'input wf-pattern', value: w.output.pattern, maxlength: 120 });
  const preview = el('div', { class: 'wf-preview' });
  const chips = el('div', { class: 'wf-ph' }, PLACEHOLDERS.map((k) => el('button', {
    class: 'btn small', text: `{${k}}`, title: { ad: t('workflows.phAd'), tarih: t('workflows.phTarih'), saat: t('workflows.phSaat'), n: t('workflows.phN') }[k],
    onclick: () => {
      const s = patternIn.selectionStart ?? patternIn.value.length;
      const e = patternIn.selectionEnd ?? s;
      patternIn.value = patternIn.value.slice(0, s) + `{${k}}` + patternIn.value.slice(e);
      patternIn.dispatchEvent(new Event('input'));
      patternIn.focus();
    },
  })));

  const syncFolder = () => {
    pathRow.hidden = !custom();
    pathEl.textContent = custom() ? w.output.folder : '';
  };
  const pickFolder = async () => {
    const f = await window.pu.folderDialog({ title: t('workflows.outFolderTitle'), defaultDir: custom() ? w.output.folder : undefined });
    if (f) w.output.folder = f;
    else if (!custom()) folderSel.value = w.output.folder;
    syncFolder();
    validate();
  };
  folderSel.addEventListener('change', () => {
    if (folderSel.value === 'custom') { if (!custom()) pickFolder(); }
    else { w.output.folder = folderSel.value; syncFolder(); validate(); }
  });
  pickBtn.onclick = pickFolder;
  patternIn.addEventListener('input', () => { w.output.pattern = patternIn.value; validate(); });

  const validate = () => {
    const { errors } = normalizeRecipe(w);
    const pe = patternError(String(w.output.pattern || '').trim());
    preview.textContent = pe ? '' : t(w.steps[0]?.op === 'merge' ? 'workflows.exampleMerge' : 'workflows.example', { name: renderName(String(w.output.pattern).trim(), { ad: t('workflows.sampleName') }) });
    err.hidden = !errors.length || !touched;
    err.replaceChildren(...errors.map((m) => el('div', { text: m })));
    return errors;
  };
  let touched = !!initial;

  const canAt = (op, i) => (op === 'merge' ? i === 0 : op === 'protect' ? i === w.steps.length - 1 : true);
  const renderAdd = () => {
    const has = (op) => w.steps.some((s) => s.op === op);
    addSel.replaceChildren(...Object.entries(OPS).map(([k, v]) => el('option', { value: k, text: v.label, disabled: (k === 'merge' || k === 'protect') && has(k) })));
    const firstOk = [...addSel.options].find((o) => !o.disabled);
    if (firstOk) addSel.value = firstOk.value;
    addBtn.disabled = w.steps.length >= MAX_STEPS;
  };
  const renderSteps = () => {
    stepsBox.replaceChildren();
    if (!w.steps.length) stepsBox.append(el('div', { class: 'empty-note', text: t('workflows.noSteps') }));
    w.steps.forEach((s, i) => {
      const op = OPS[s.op];
      const swap = (j) => { [w.steps[i], w.steps[j]] = [w.steps[j], w.steps[i]]; renderSteps(); };
      const mv = (ic, title, j) => {
        const ok = j >= 0 && j < w.steps.length && canAt(w.steps[i].op, j) && canAt(w.steps[j].op, i);
        return el('button', { class: 'icon-btn', title, html: icon(ic), disabled: !ok, dataset: { act: ic === 'chevron-up' ? 'up' : 'down' }, onclick: () => swap(j) });
      };
      stepsBox.append(el('div', { class: 'wf-step', dataset: { op: s.op } },
        el('span', { class: 'wf-step-n', text: String(i + 1) }),
        el('span', { class: 'wf-step-ic', html: icon(op.icon) }),
        el('div', { class: 'wf-step-main' },
          el('b', { text: op.label }),
          op.hint ? el('div', { class: 'muted wf-step-hint', text: op.hint }) : null,
          stepEditor(s, validate)),
        el('div', { class: 'wf-step-btns' },
          mv('chevron-up', t('workflows.moveUp'), i - 1), mv('chevron-down', t('workflows.moveDown'), i + 1),
          el('button', { class: 'icon-btn', title: t('workflows.removeStep'), html: icon('x'), dataset: { act: 'remove' }, onclick: () => { w.steps.splice(i, 1); renderSteps(); } }))));
    });
    renderAdd();
    validate();
  };
  addBtn.onclick = () => {
    const op = addSel.value;
    if (!OPS[op] || w.steps.length >= MAX_STEPS) return;
    const step = { op, params: JSON.parse(JSON.stringify(OPS[op].defaults)) };
    if (op === 'merge') w.steps.unshift(step);
    else if (op !== 'protect' && w.steps[w.steps.length - 1]?.op === 'protect') w.steps.splice(w.steps.length - 1, 0, step);
    else w.steps.push(step);
    renderSteps();
  };
  syncFolder();
  renderSteps();

  return modal({
    title: initial?.id ? t('workflows.editTitle') : t('workflows.newTitle'), width: 680, className: 'wf-edit-modal',
    body: el('div', {},
      field(t('workflows.nameField'), nameIn),
      el('div', { class: 'field-label', text: t('workflows.stepsLabel') }),
      stepsBox,
      el('div', { class: 'row wf-add' }, addSel, addBtn),
      el('div', { class: 'wf-out' },
        el('div', { class: 'field-label', text: t('workflows.resultsLabel') }),
        field(t('workflows.whereSave'), folderSel), pathRow,
        field(t('workflows.fileName'), patternIn), chips, preview,
        el('p', { class: 'muted wf-small', text: t('workflows.originalsSafe') })),
      err),
    buttons: [{ label: t('common.cancel'), value: null }, {
      label: t('common.save'), id: 'save', primary: true, run: async () => {
        touched = true;
        if (!requirePro('workflows')) return false;
        w.name = nameIn.value;
        w.output.pattern = patternIn.value;
        if (validate().length) return false;
        const res = await upsertRecipe(w);
        if (!res.ok) { err.hidden = false; err.replaceChildren(...res.errors.map((m) => el('div', { text: m }))); return false; }
        return res.recipe;
      },
    }],
  });
}

// ---------------- panel ----------------
export async function workflowsDialog() {
  const box = el('div', { class: 'wf-panel' });
  let api = null;
  const card = (r, tpl) => {
    const chips = el('div', { class: 'wf-chips' }, r.steps.flatMap((s, i) => {
      const c = el('span', { class: 'wf-chip', html: `${icon(OPS[s.op].icon)}<span></span>` });
      c.querySelector('span').textContent = OPS[s.op].chip(s.params);
      return i ? [el('span', { class: 'wf-arrow', html: icon('arrow-right') }), c] : c;
    }));
    const btn = (label, act, cls, ic) => el('button', { class: `btn small ${cls || ''}`, dataset: { act }, html: ic ? `${icon(ic)}<span></span>` : '', text: ic ? null : label });
    const runB = btn(t('workflows.run'), 'run', 'primary', 'play');
    runB.querySelector('span').textContent = t('workflows.run');
    runB.onclick = () => {
      if (!requirePro('workflows')) return;
      dropdown(runB, [
        { label: App.active ? t('workflows.applyToOpenNamed', { name: App.active.name }) : t('workflows.applyToOpen'), icon: 'file-text', disabled: !App.active, run: () => api.close({ run: r, source: 'doc' }) },
        { label: t('workflows.pickFiles'), icon: 'files', run: () => api.close({ run: r, source: 'files' }) },
        { label: t('workflows.allInFolder'), icon: 'folder-open', run: () => api.close({ run: r, source: 'folder' }) },
      ]);
    };
    const btns = [runB];
    if (tpl) {
      const cp = btn(t('workflows.copyEdit'), 'copy');
      cp.onclick = async () => {
        if (!requirePro('workflows')) return;
        const saved = await openEditor({ name: r.name, steps: r.steps, output: r.output });
        if (saved) { toast(t('workflows.savedToast', { name: saved.name }), { type: 'ok' }); render(); }
      };
      btns.push(cp);
    } else {
      const ed = btn(t('workflows.edit'), 'edit');
      ed.onclick = async () => {
        if (!requirePro('workflows')) return;
        const saved = await openEditor(r);
        if (saved) render();
      };
      const dup = btn(t('workflows.duplicate'), 'dup');
      dup.onclick = async () => {
        if (!requirePro('workflows')) return;
        const res = await upsertRecipe({ name: t('workflows.copyName', { name: r.name }).slice(0, 80), steps: r.steps, output: r.output });
        if (!res.ok) toast(res.errors[0], { type: 'warn' });
        render();
      };
      // Silmek kişinin kendi verisidir: Pro gerektirmez
      const del = btn(t('common.delete'), 'del', 'danger');
      del.onclick = async () => {
        if (!(await confirmBox(t('workflows.deleteConfirm', { name: r.name }), { title: t('workflows.deleteTitle'), ok: t('common.delete'), danger: true }))) return;
        await deleteRecipe(r.id);
        render();
      };
      btns.push(ed, dup, del);
    }
    return el('div', { class: `wf-card ${tpl ? 'tpl' : ''}`, dataset: { id: r.id } },
      el('div', { class: 'wf-card-head' }, el('b', { class: 'wf-name', text: r.name }), tpl ? el('span', { class: 'wf-tag', text: t('workflows.templateTag') }) : null,
        tpl && r.desc ? el('span', { class: 'muted wf-desc', text: r.desc }) : null),
      chips,
      el('div', { class: 'wf-outline muted', text: outputSummary(r.output) }),
      el('div', { class: 'wf-card-btns' }, btns));
  };
  const render = () => {
    const mine = loadRecipes();
    // replaceChildren null'ı "null" yazısı olarak ekler: boş öğeleri ayıkla
    box.replaceChildren(...[
      infoBox('workflow', t('batch.whatFor'), t('workflows.whatForBody')),
      isPro() ? null : el('div', { class: 'wf-pro-note' },
        el('span', { class: 'wf-pro-ic', html: icon('crown') }),
        el('div', {}, el('b', { text: t('workflows.proNoteTitle') }), el('div', { class: 'muted', text: t('workflows.proNoteBody') })),
        el('button', { class: 'btn small', text: t('pro.aboutBtn'), onclick: () => openUpgrade('workflows') })),
      el('div', { class: 'wf-h', text: t('workflows.mine') }),
      mine.length ? el('div', { class: 'wf-list wf-mine' }, mine.map((r) => card(r, false)))
        : el('div', { class: 'empty-note wf-empty', text: t('workflows.noneYet') }),
      el('div', { class: 'wf-h', text: t('workflows.templates') }),
      el('div', { class: 'wf-list wf-tpls' }, TEMPLATES.map((r) => card(r, true))),
    ].filter(Boolean));
  };
  render();
  const off = onProChange(() => { if (box.isConnected) render(); });
  let res;
  try {
    res = await modal({
      title: t('workflows.panelTitle'), width: 760, className: 'wf-modal', body: box,
      onOpen: (a) => { api = a; },
      buttons: [{ label: t('common.close') }, {
        label: t('workflows.newTitle'), id: 'new', primary: true, run: async () => {
          if (!requirePro('workflows')) return false;
          const saved = await openEditor(null);
          if (saved) { toast(t('workflows.savedToast', { name: saved.name }), { type: 'ok' }); render(); }
          return false;
        },
      }],
    });
  } finally { off(); }
  if (res && res.run) return runRecipe(res.run, res.source);
  return null;
}
