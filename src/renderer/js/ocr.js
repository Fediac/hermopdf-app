// OCR (yazı tanıma) — Tesseract.js, Türkçe + İngilizce, tamamen yerel.
// Pro özelliği (12 Kas 2026): pencereler requirePro('ocr') ile korunur; giriş noktaları (şerit, öneri, dönüştürme)
// zaten kapıdan geçer, buradaki denetim yalnızca yedektir. İş akışları (ocrBytes) kendi Pro kapısıyla gelir.
import { App, saveSetting } from './state.js';
import { el, toast, modal, field, select, withProgress, parseRanges, rangesToText, canvasToBlob, baseName } from './util.js';
import { pageRange, infoBox } from './assist.js';
import { icon } from './icons.js';
import { NM, loadScript, getPdfjs, PDFLib, fontkit } from './pdfcore.js';
import { fontBytes, fontFile, defaultFamily } from './fonts.js';
import { renderRegion } from './images.js';
import { t } from './i18n.js';
import { requirePro } from './pro.js';

let worker = null;
let workerLangs = '';
let progressCb = null;

async function getWorker(langs = 'tur+eng') {
  await loadScript(`${NM}/tesseract.js/dist/tesseract.min.js`);
  if (worker && workerLangs === langs) return worker;
  if (worker) { await worker.terminate().catch(() => {}); worker = null; }
  worker = await window.Tesseract.createWorker(langs.split('+'), 1, {
    workerPath: `${NM}/tesseract.js/dist/worker.min.js`,
    corePath: `${NM}/tesseract.js-core`,
    langPath: 'app://pu/tessdata',
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    logger: (m) => { if (progressCb && m.status === 'recognizing text') progressCb(m.progress); },
  });
  workerLangs = langs;
  return worker;
}

// check: iptal denetimi (p.check) — sayfa ortasında da iptal edilebilsin diye düzenli yoklanır
async function recognize(canvas, langs, onProgress, check = null) {
  const w = await getWorker(langs);
  progressCb = onProgress;
  const blob = await canvasToBlob(canvas, 'image/png');
  let timer = null;
  let job = null;
  check?.();
  try {
    job = w.recognize(blob, {}, { text: true, blocks: true });
    const cancel = new Promise((_, reject) => {
      timer = setInterval(() => { try { check?.(); } catch (e) { reject(e); } }, 200);
    });
    const { data } = await Promise.race([job, cancel]);
    return data;
  } catch (e) {
    // süren tanımayı durdurmanın tek yolu işçiyi kapatmak; hata veren işçi de bir daha kullanılmasın
    job?.catch(() => {});
    if (worker === w) { worker = null; workerLangs = ''; }
    w.terminate().catch(() => {});
    throw e;
  } finally {
    clearInterval(timer);
    progressCb = null;
  }
}

// ---------------- alandan OCR ----------------
export async function ocrRegion(d, i, r) {
  if (!requirePro('ocr')) return;
  const data = await withProgress(t('ocr.recognizing'), async (p) => {
    p.set(0.05, t('ocr.preparingImage'));
    const c = await renderRegion(d, i, r, 300 / 72);
    p.check();
    p.set(0.15, t('ocr.loadingEngine'));
    return recognize(c, 'tur+eng', (v) => p.set(0.15 + v * 0.85, t('ocr.recognizingPct', { pct: Math.round(v * 100) })), p.check);
  });
  const text = (data.text || '').trim();
  if (!text) { toast(t('ocr.noTextInArea'), { type: 'warn' }); return; }
  const ta = el('textarea', { class: 'input', rows: 12, style: { width: '100%', fontFamily: 'Segoe UI, sans-serif' } });
  ta.value = text;
  const r2 = await modal({
    title: t('ocr.recognizedText'), width: 620,
    body: el('div', {}, el('p', { class: 'muted', text: t('ocr.confidence', { pct: Math.round(data.confidence || 0) }) }), ta),
    buttons: [{ label: t('common.close') }, { label: t('ocr.addAsTextBox'), value: 'add' }, { label: t('ocr.copy'), primary: true, value: 'copy' }],
  });
  if (r2 === 'copy') { await navigator.clipboard.writeText(ta.value); toast(t('ocr.copiedToClipboard'), { type: 'ok' }); }
  if (r2 === 'add') d.addObj(i, { type: 'text', ...App.defaults.text, x: r.x, y: r.y + r.h + 6, w: Math.max(120, r.w), text: ta.value }, { label: t('ocr.addTextLabel') });
}

// ---------------- belge OCR ----------------
export async function ocrDialog(d, anchor, { pages: presetPages = null } = {}) {
  if (!requirePro('ocr')) return;
  const range = pageRange(d, { label: t('ocr.pagesLabel'), value: presetPages ? rangesToText(presetPages) : `1-${d.numPages}` });
  const lang = select([{ value: 'tur+eng', label: t('ocr.langTurEng') }, { value: 'tur', label: t('ocr.langTur') }, { value: 'eng', label: t('ocr.langEng') }], 'tur+eng');
  const dpi = select([
    { value: 200, label: t('ocr.dpiFast') },
    { value: 300, label: t('ocr.dpiBalanced') },
    { value: 400, label: t('ocr.dpiPrecise') },
  ], 300);
  const mode = select([
    { value: 'pdf', label: t('ocr.modePdf') },
    { value: 'text', label: t('ocr.modeText') },
  ], 'pdf');
  const skip = el('input', { type: 'checkbox', checked: true });
  const estimate = el('div', { class: 'range-info' });
  const update = () => {
    let n = 0;
    try { n = range.pages().length; } catch (e) { n = 0; }
    const per = { 200: 2.5, 300: 4, 400: 7 }[+dpi.value] || 4;
    const total = Math.round(n * per);
    const time = total < 60 ? t('ocr.seconds', { count: total }) : t('ocr.minutes', { count: Math.round(total / 60) });
    estimate.textContent = n ? t('ocr.estimate', { count: n, time }) : t('ocr.noPagesSelected');
  };
  range.input.addEventListener('input', update);
  dpi.addEventListener('change', update);
  update();
  const res = await modal({
    title: t('ocr.title'), width: 600,
    body: el('div', {},
      infoBox('scan-text', t('ocr.whatIsTitle'), t('ocr.whatIsBody')),
      field(t('ocr.whatToDo'), mode),
      el('div', { class: 'row' }, field(t('ocr.docLang'), lang), field(t('ocr.scanQuality'), dpi)),
      range.node,
      el('label', { class: 'checkline' }, skip, t('ocr.skipText')),
      el('div', { class: 'preview-line' }, el('span', { class: 'ib-ic', html: icon('clock') }), estimate),
      infoBox('info', t('ocr.afterTitle'), t('ocr.afterBody'))),
    buttons: [{ label: t('common.cancel') }, { label: t('ocr.start'), primary: true, run: () => { try { range.pages(); return true; } catch (e) { toast(e.message, { type: 'warn' }); return false; } } }],
  });
  if (!res) return;
  const pages = range.pages();
  const { results, skipped } = await withProgress(t('ocr.running'), (p) => recognizePages(d, pages, { lang: lang.value, dpi: +dpi.value, skipWithText: skip.checked, p }));
  if (!results.size) { toast(skipped ? t('ocr.allHaveText') : t('ocr.nothingToRecognize'), { type: 'warn', timeout: 5000 }); return; }
  if (mode.value === 'text') {
    const text = [...results.entries()].sort((a, b) => a[0] - b[0]).map(([i, r]) => `${t('ocr.pageMarker', { n: i + 1 })}\n${(r.data.text || '').trim()}`).join('\n\n');
    const ta = el('textarea', { class: 'input', rows: 16 });
    ta.value = text;
    const r2 = await modal({ title: t('ocr.resultTitle'), width: 680, body: ta, buttons: [{ label: t('common.close') }, { label: t('ocr.saveAsTxt'), value: 'save' }, { label: t('ocr.copy'), primary: true, value: 'copy' }] });
    if (r2 === 'copy') { await navigator.clipboard.writeText(ta.value); toast(t('ocr.textCopied'), { type: 'ok' }); }
    if (r2 === 'save') {
      const dest = await window.pu.saveDialog({ defaultName: `${baseName(d.name)} (OCR).txt`, filters: [{ name: t('ocr.filterText'), extensions: ['txt'] }] });
      if (dest) { await window.pu.writeFile(dest, new TextEncoder().encode(`\ufeff${ta.value}`)); toast(t('ocr.saved'), { type: 'ok' }); }
    }
    return;
  }
  const words = await applyOcrLayer(d, results);
  toast(t('ocr.done', { count: results.size, words }), {
    type: 'ok', timeout: 9000,
    action: { label: t('ocr.editText'), run: async () => { const tools = await import('./tools.js'); tools.setTool('edittext'); toast(t('ocr.clickText'), { timeout: 4000 }); } },
  });
  if (!App.settings.ocrSaveHintShown) {
    saveSetting({ ocrSaveHintShown: true });
    setTimeout(() => toast(t('ocr.saveHint'), { timeout: 7000 }), 1200);
  }
}

// Belgedeki sayfaların yazısını tanır (iletişim kutusu olmadan). p: withProgress ilerleme nesnesi.
export async function recognizePages(d, pages, { lang = 'tur+eng', dpi = 300, skipWithText = true, p }) {
  const results = new Map();
  let skipped = 0;
  for (let n = 0; n < pages.length; n++) {
    p.check();
    const i = pages[n];
    const base = n / pages.length, span = 1 / pages.length;
    if (skipWithText) {
      const tc = await d.textContent(i);
      const chars = tc.items.reduce((a, it) => a + (it.str || '').trim().length, 0);
      if (chars > 20) { skipped++; continue; }
    }
    p.set(base, t('ocr.pagePreparing', { n: i + 1 }));
    const info = await d.pageInfo(i);
    const scale = dpi / 72;
    const c = await renderRegion(d, i, { x: 0, y: 0, w: info.w, h: info.h }, scale, { withObjects: false });
    p.set(base + span * 0.1, t('ocr.pageEngine', { n: i + 1 }));
    const data = await recognize(c, lang, (v) => p.set(base + span * (0.1 + v * 0.9), t('ocr.pageProgress', { n: i + 1, idx: n + 1, total: pages.length, pct: Math.round(v * 100) })), p.check);
    // renderRegion çok büyük sayfalarda ölçeği küçültür: piksel → pt dönüşümü gerçek ölçekle yapılmalı
    results.set(i, { data, scale: c.width / info.w });
    c.width = c.height = 0;
  }
  return { results, skipped };
}

// Tanınan yazıyı sayfalara görünmez metin katmanı olarak ekler (geri alınabilir tek adım). Kelime sayısını döndürür.
export async function applyOcrLayer(d, results) {
  let words = 0;
  await d.structural(t('ocr.layerLabel'),async (lib) => {
    const L = PDFLib();
    const font = await lib.embedFont(await fontBytes(fontFile(defaultFamily(), false, false)), { subset: true });
    const charset = new Set(font.getCharacterSet());
    for (const [i, { data, scale }] of results) {
      const info = await d.pageInfo(i);
      const page = lib.getPage(i);
      const H = info.h;
      const M = info.M;
      page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(...M), L.setTextRenderingMode(L.TextRenderingMode.Invisible));
      for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            const lb = line.bbox;
            const lineH = (lb.y1 - lb.y0) / scale;
            const size = Math.max(2, lineH * 0.78);
            for (const w of line.words || []) {
              const txt = [...(w.text || '')].map((ch) => (charset.has(ch.codePointAt(0)) ? ch : '')).join('');
              if (!txt.trim()) continue;
              const x = w.bbox.x0 / scale;
              const ww = (w.bbox.x1 - w.bbox.x0) / scale;
              let baseY = lb.y1 / scale - lineH * 0.22;
              if (line.baseline && line.baseline.x1 !== line.baseline.x0) {
                const bl = line.baseline;
                const t = ((w.bbox.x0 + w.bbox.x1) / 2 - bl.x0) / (bl.x1 - bl.x0);
                baseY = (bl.y0 + (bl.y1 - bl.y0) * t) / scale;
              }
              const natural = font.widthOfTextAtSize(txt, size);
              page.pushOperators(L.setCharacterSqueeze(natural > 0 ? Math.max(5, Math.min(800, (ww / natural) * 100)) : 100));
              page.drawText(txt, { x, y: H - baseY, size, font });
              words++;
            }
          }
        }
      }
      page.pushOperators(L.setCharacterSqueeze(100), L.setTextRenderingMode(L.TextRenderingMode.Fill), L.popGraphicsState());
    }
    return null;
  });
  void getPdfjs; void fontkit;
  return words;
}

// ---------------- toplu işlem için: baytlara OCR uygula ----------------
// Belgeyi açmadan, verilen PDF baytlarına görünmez metin katmanı ekler.
export async function ocrBytes(bytes, { lang = 'tur+eng', dpi = 300, onProgress, check, skipWithText = true } = {}) {
  const { openPdfjs, loadPdfLib, savePdfLib } = await import('./pdfcore.js');
  const { Util } = getPdfjs();
  const src = await openPdfjs(bytes);
  const results = new Map();
  try {
    const n = src.doc.numPages;
    for (let i = 0; i < n; i++) {
      check && check();
      onProgress && onProgress(i / n, t('ocr.bytesPage', { n: i + 1, total: n }));
      const page = await src.doc.getPage(i + 1);
      if (skipWithText) {
        const tc = await page.getTextContent();
        const chars = tc.items.reduce((a, it) => a + (it.str || '').trim().length, 0);
        if (chars > 20) continue;
      }
      const vp = page.getViewport({ scale: dpi / 72 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvas: c, viewport: vp, background: '#ffffff' }).promise;
      const data = await recognize(c, lang, (v) => onProgress && onProgress((i + v) / n, t('ocr.bytesPageProgress', { n: i + 1, total: n, pct: Math.round(v * 100) })), check);
      c.width = c.height = 0;
      const vp1 = page.getViewport({ scale: 1 });
      results.set(i, { data, scale: dpi / 72, h: vp1.height, T: vp1.transform });
    }
  } finally { src.destroy(); }
  if (!results.size) return bytes;
  const L = PDFLib();
  const lib = await loadPdfLib(bytes);
  lib.registerFontkit(fontkit());
  const font = await lib.embedFont(await fontBytes(fontFile(defaultFamily(), false, false)), { subset: true });
  const charset = new Set(font.getCharacterSet());
  for (const [i, r] of results) {
    const page = lib.getPage(i);
    const Ti = Util.inverseTransform(r.T);
    const M = Util.transform(Ti, [1, 0, 0, -1, 0, r.h]);
    page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(...M), L.setTextRenderingMode(L.TextRenderingMode.Invisible));
    for (const block of r.data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const lb = line.bbox;
          const lineH = (lb.y1 - lb.y0) / r.scale;
          const size = Math.max(2, lineH * 0.78);
          for (const w of line.words || []) {
            const txt = [...(w.text || '')].map((ch) => (charset.has(ch.codePointAt(0)) ? ch : '')).join('');
            if (!txt.trim()) continue;
            const x = w.bbox.x0 / r.scale;
            const ww = (w.bbox.x1 - w.bbox.x0) / r.scale;
            let baseY = lb.y1 / r.scale - lineH * 0.22;
            if (line.baseline && line.baseline.x1 !== line.baseline.x0) {
              const bl = line.baseline;
              const t = ((w.bbox.x0 + w.bbox.x1) / 2 - bl.x0) / (bl.x1 - bl.x0);
              baseY = (bl.y0 + (bl.y1 - bl.y0) * t) / r.scale;
            }
            const natural = font.widthOfTextAtSize(txt, size);
            page.pushOperators(L.setCharacterSqueeze(natural > 0 ? Math.max(5, Math.min(800, (ww / natural) * 100)) : 100));
            page.drawText(txt, { x, y: r.h - baseY, size, font });
          }
        }
      }
    }
    page.pushOperators(L.setCharacterSqueeze(100), L.setTextRenderingMode(L.TextRenderingMode.Fill), L.popGraphicsState());
  }
  return savePdfLib(lib);
}
