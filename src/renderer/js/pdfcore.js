// Kütüphaneleri yükler: pdf.js (görüntüleme), pdf.js viewer bileşenleri, pdf-lib (düzenleme), fontkit.
import { t } from './i18n.js';

export const NM = 'app://pu/node_modules';

const scripts = {};
export function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error(t('pdfcore.loadFailed', { src })));
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}

let pdfjs = null;
let viewerLib = null;

export async function initLibs() {
  pdfjs = await import(`${NM}/pdfjs-dist/build/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${NM}/pdfjs-dist/build/pdf.worker.min.mjs`;
  globalThis.pdfjsLib = pdfjs;
  viewerLib = await import(`${NM}/pdfjs-dist/web/pdf_viewer.mjs`);
  await Promise.all([loadScript(`${NM}/@cantoo/pdf-lib/dist/pdf-lib.min.js`), loadScript(`${NM}/@cantoo/fontkit/dist/fontkit.umd.min.js`)]);
  return { pdfjs, viewerLib };
}

export const getPdfjs = () => pdfjs;
export const getViewerLib = () => viewerLib;
export const PDFLib = () => window.PDFLib;
export const fontkit = () => (window.fontkit?.create ? window.fontkit : window.fontkit?.default);

export function pdfjsOpenOptions(bytes, extra = {}) {
  return {
    data: bytes.slice(), // pdf.js veriyi worker'a aktarır (orijinal diziyi boşaltır), kopyasını ver
    cMapUrl: `${NM}/pdfjs-dist/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${NM}/pdfjs-dist/standard_fonts/`,
    wasmUrl: `${NM}/pdfjs-dist/wasm/`,
    iccUrl: `${NM}/pdfjs-dist/iccs/`,
    isEvalSupported: false,
    enableXfa: false,
    ...extra,
  };
}

// Bağımsız (görüntüleyici dışı) pdf.js belgesi aç — dönüştürme/küçültme gibi işler için
export async function openPdfjs(bytes, password) {
  const task = pdfjs.getDocument(pdfjsOpenOptions(bytes, password != null ? { password } : {}));
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

// pdf-lib ile yükle (şifreli ise parola ile çözer)
export async function loadPdfLib(bytes, password) {
  const { PDFDocument } = window.PDFLib;
  const opts = { updateMetadata: false, throwOnInvalidObject: false };
  if (password != null) opts.password = password;
  const doc = await PDFDocument.load(bytes, opts);
  doc.registerFontkit(fontkit());
  return doc;
}

// Erişilemeyen nesneleri sil (silinen sayfaların kalıntıları vb.)
export function garbageCollect(lib) {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = window.PDFLib;
  const ctx = lib.context;
  const seen = new Set();
  // Encrypt: yalnızca encrypt() ile yeni kurulan sözlük burada durur (çözülmüş eskisini pdf-lib trailer'dan siler);
  // kök sayılmazsa silinir ve dosya parolasız açılır
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt].filter(Boolean);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (let k = 0; k < o.size(); k++) stack.push(o.get(k));
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref)) { ctx.delete(ref); removed++; }
  }
  return removed;
}

// Sayfaları kalıntısız sil: yalnızca o sayfalarda olan form alanları (değerleriyle) da gider,
// başka yerlerden (yer imleri, bağlantılar, adlı hedefler, yapı ağacı) silinen sayfaya giden
// referanslar kalan bir sayfaya yönlendirilir ya da kaldırılır; yoksa sayfa içeriği dosyada kalırdı.
export function removePagesClean(lib, indices) {
  const { PDFName, PDFRef, PDFDict, PDFArray, PDFStream } = window.PDFLib;
  const N = (s) => PDFName.of(s);
  const ctx = lib.context;
  const look = (o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const pages = lib.getPages();
  const del = new Set(indices);
  const gone = new Map(); // silinen sayfa ref → yönlendirilecek sayfa ref (önceki kalan sayfa, yoksa ilk kalan)
  const firstKept = pages.find((_, i) => !del.has(i))?.ref;
  pages.forEach((p, i) => { if (del.has(i)) { let k = i - 1; while (k >= 0 && del.has(k)) k--; gone.set(p.ref, k >= 0 ? pages[k].ref : firstKept); } });
  // açıklama (widget) → bulunduğu sayfa
  const annotPage = new Map();
  for (const p of pages) {
    const annots = p.node.Annots();
    if (annots) for (let k = 0; k < annots.size(); k++) { const a = annots.get(k); if (a instanceof PDFRef) annotPage.set(a, p.ref); }
  }
  // Form alanları: tüm parçacıkları silinen sayfalardaysa alanı, bazılarıysa yalnızca o parçacıkları çıkar
  const removedFields = new Set();
  const prune = (arr) => {
    for (let k = arr.size() - 1; k >= 0; k--) {
      const ref = arr.get(k);
      const dict = look(ref);
      if (!(dict instanceof PDFDict)) continue;
      const kids = look(dict.get(N('Kids')));
      let drop = false;
      if (kids instanceof PDFArray && kids.size()) {
        prune(kids);
        drop = kids.size() === 0;
      } else {
        const pg = (ref instanceof PDFRef && annotPage.get(ref)) || dict.get(N('P'));
        drop = pg instanceof PDFRef && gone.has(pg);
      }
      if (drop) { arr.remove(k); if (ref instanceof PDFRef) removedFields.add(ref); }
    }
  };
  const acro = look(lib.catalog.get(N('AcroForm')));
  if (acro instanceof PDFDict) {
    const fields = look(acro.get(N('Fields')));
    if (fields instanceof PDFArray) prune(fields);
    const co = look(acro.get(N('CO')));
    if (co instanceof PDFArray) for (let k = co.size() - 1; k >= 0; k--) if (removedFields.has(co.get(k))) co.remove(k);
  }
  [...del].sort((a, b) => b - a).forEach((i) => lib.removePage(i));
  // Kalan nesnelerde silinen sayfaya giden referanslar: hedef dizisi [sayfa /XYZ …] → kalan sayfaya; sözlük değeri (/P, /Pg …) → sil
  const scrub = (o, seen) => {
    if (o instanceof PDFStream) o = o.dict;
    if (seen.has(o)) return;
    seen.add(o);
    if (o instanceof PDFDict) {
      for (const [k, v] of o.entries()) {
        if (v instanceof PDFRef) { if (gone.has(v)) o.delete(k); } else scrub(v, seen);
      }
    } else if (o instanceof PDFArray) {
      for (let k = 0; k < o.size(); k++) {
        const v = o.get(k);
        if (v instanceof PDFRef) { if (k === 0 && gone.has(v) && gone.get(v)) o.set(0, gone.get(v)); } else scrub(v, seen);
      }
    }
  };
  const seen = new Set();
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!gone.has(ref)) scrub(obj, seen);
  }
  return removedFields.size;
}

// Sayfa kopyala ama bağlantı hedefleri (/Dest, /A /D) ve /P üzerinden başka sayfaları (tüm içerikleriyle)
// sürükleme: kopyalanan kümedeki sayfalara giden bağlantılar yeni sayfalara bağlanır, diğerleri hedefsiz kalır.
export async function copyPagesClean(dst, src, indices) {
  const { PDFName, PDFRef, PDFDict, PDFArray, PDFNull } = window.PDFLib;
  const N = (s) => PDFName.of(s);
  const look = (o, c = src.context) => (o instanceof PDFRef ? c.lookup(o) : o);
  const pages = src.getPages();
  const all = new Set(pages.map((p) => p.ref));
  const destPage = (v) => { const a = look(v); const r = a instanceof PDFArray && a.size() ? a.get(0) : null; return r instanceof PDFRef && all.has(r) ? [r, a] : null; };
  const undo = [];
  const take = (dict, key) => { const k = N(key); undo.push([dict, k, dict.get(k)]); dict.delete(k); };
  const info = new Map(); // kaynak açıklama → { p, dest:[sayfa, dizi], goto:[sayfa, dizi] }
  const gotoOf = new Map(); // kaynak eylem sözlüğü → [sayfa, dizi]
  for (const p of pages) {
    const annots = p.node.Annots();
    if (!annots) continue;
    for (let k = 0; k < annots.size(); k++) {
      const a = look(annots.get(k));
      if (!(a instanceof PDFDict) || info.has(a)) continue;
      const it = {};
      if (a.get(N('P'))) { it.p = true; take(a, 'P'); }
      const dp = destPage(a.get(N('Dest')));
      if (dp) { it.dest = dp; take(a, 'Dest'); }
      // GoTo eylemi ve /Next zinciri (en iyi çaba)
      let x = look(a.get(N('A')));
      const top = x;
      const walked = new Set();
      while (x instanceof PDFDict && !walked.has(x)) {
        walked.add(x);
        if (!gotoOf.has(x)) { const tp = destPage(x.get(N('D'))); if (tp) { gotoOf.set(x, tp); take(x, 'D'); } }
        x = look(x.get(N('Next')));
      }
      if (top instanceof PDFDict && gotoOf.has(top)) it.goto = gotoOf.get(top);
      info.set(a, it);
    }
  }
  let copies;
  try {
    copies = await dst.copyPages(src, indices);
  } finally {
    for (let k = undo.length - 1; k >= 0; k--) { const [d, key, v] = undo[k]; if (v !== undefined) d.set(key, v); }
  }
  const map = new Map();
  indices.forEach((ix, k) => { if (!map.has(pages[ix].ref)) map.set(pages[ix].ref, copies[k].ref); });
  const remap = ([pg, arr]) => {
    const m = map.get(pg);
    if (!m) return null;
    const out = [m];
    for (let k = 1; k < arr.size(); k++) { const v = arr.get(k); out.push(v instanceof PDFRef ? PDFNull : v); }
    return dst.context.obj(out);
  };
  indices.forEach((ix, k) => {
    const sa = pages[ix].node.Annots();
    const da = copies[k].node.Annots();
    if (!sa || !da) return;
    for (let i = 0; i < sa.size() && i < da.size(); i++) {
      const it = info.get(look(sa.get(i)));
      const t = look(da.get(i), dst.context);
      if (!it || !(t instanceof PDFDict)) continue;
      if (it.p) t.set(N('P'), copies[k].ref);
      if (it.dest) { const r = remap(it.dest); if (r) t.set(N('Dest'), r); }
      if (it.goto) {
        const r = remap(it.goto);
        const ta = look(t.get(N('A')), dst.context);
        if (r && ta instanceof PDFDict) ta.set(N('D'), r); else t.delete(N('A'));
      }
    }
  });
  return copies;
}

export async function savePdfLib(doc, extra = {}) {
  // Silinen sayfa kalıntıları, eski xref akışları ve çözülmüş şifreleme sözlüğü dosyaya yazılmasın
  try { garbageCollect(doc); } catch (e) { console.warn('gc', e); }
  return doc.save({ useObjectStreams: true, ...extra });
}
