// Dönüştürme: PDF → PNG/JPEG/TXT/DOCX, Görsel → PDF, Metin → PDF, boş PDF.
import { App } from './state.js';
import { el, toast, modal, field, select, withProgress, parseRanges, canvasToBlob, baseName, esc } from './util.js';
import { icon } from './icons.js';
import { getPdfjs, PDFLib, openPdfjs, savePdfLib, fontkit } from './pdfcore.js';
import { fontBytes, fontFile, defaultFamily } from './fonts.js';
import { wrapText } from './shapes.js';
import { makeZip } from './zip.js';
import { pageImages, imageCanvas, renderRegion } from './images.js';
import { t } from './i18n.js';

async function openBytesTab(bytes, name) {
  const { openBytes } = await import('./app.js');
  const d = await openBytes(bytes, name);
  d?.markDirty();
  return d;
}

// Düzenlemeler dahil render kaynağı
async function sourceFor(d) {
  if (d.hasObjects() || d.formsModified) return openPdfjs(await d.buildBytes({ encrypt: false }));
  return { doc: d.pdf, destroy: () => {} };
}

// ---------------- boş PDF ----------------
export async function newBlankPdf() {
  const { PDFDocument } = PDFLib();
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  doc.setProducer('HermoPDF');
  await openBytesTab(await doc.save(), t('convert.newDocName'));
  toast(t('convert.blankCreated'), { timeout: 5000 });
}

// ---------------- PDF → görsel ----------------
export async function exportPageImages(d, fmt = 'png') {
  const range = el('input', { class: 'input', value: `1-${d.numPages}` });
  const dpi = select([{ value: 96, label: t('convert.dpiScreen') }, { value: 150, label: t('convert.dpiGood') }, { value: 200, label: '200 DPI' }, { value: 300, label: t('convert.dpiPrint') }], 150);
  const format = select([{ value: 'png', label: t('convert.fmtPng') }, { value: 'jpeg', label: t('convert.fmtJpeg') }], fmt);
  const res = await modal({
    title: t('convert.imgTitle'),
    body: el('div', {}, el('div', { class: 'row' }, field(t('convert.format'), format), field(t('convert.resolution'), dpi)), field(t('convert.pagesTotal', { total: d.numPages }), range)),
    buttons: [{ label: t('common.cancel') }, { label: t('convert.pickFolderSave'), primary: true, value: true }],
  });
  if (!res) return;
  const pages = parseRanges(range.value, d.numPages);
  const folder = await window.pu.folderDialog({ title: t('convert.folderTitle') });
  if (!folder) return;
  const type = format.value === 'png' ? 'image/png' : 'image/jpeg';
  await withProgress(t('convert.pagesConverting'), async (p) => {
    const src = await sourceFor(d);
    try {
      for (let n = 0; n < pages.length; n++) {
        p.check();
        p.set(n / pages.length, t('convert.pageN', { n: pages[n] + 1 }));
        const page = await src.doc.getPage(pages[n] + 1);
        const vp = page.getViewport({ scale: +dpi.value / 72 });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await page.render({ canvas: c, viewport: vp, background: '#ffffff' }).promise;
        const blob = await canvasToBlob(c, type, 0.92);
        await window.pu.writeInFolder(folder, `${baseName(d.name)} - ${String(pages[n] + 1).padStart(3, '0')}.${format.value === 'png' ? 'png' : 'jpg'}`, new Uint8Array(await blob.arrayBuffer()));
        c.width = c.height = 0;
      }
    } finally { src.destroy(); }
  });
  toast(t('convert.imagesSaved', { count: pages.length }), { type: 'ok', timeout: 6000, action: { label: t('convert.openFolder'), run: () => window.pu.openPath(folder) } });
}

// ---------------- metin çıkarma (satır / paragraf) ----------------
// Düzenlemelerin örttüğü alanlar (Metni düzenle örtüsü, beyaz kalem, karartma): eski yazı dışa aktarılmasın
function coverRects(d, i) {
  const out = [];
  for (const o of d?.pageObjs?.[i] || []) {
    if (o.type === 'text' && o.cover) out.push(o.cover);
    else if (o.type === 'whiteout' || o.type === 'redact') out.push(o);
  }
  return out;
}
const mostlyCovered = (b, covers) => covers.some((c) => {
  const ix = Math.max(0, Math.min(b.x + b.w, c.x + c.w) - Math.max(b.x, c.x));
  const iy = Math.max(0, Math.min(b.y + b.h, c.y + c.h) - Math.max(b.y, c.y));
  return ix * iy >= 0.8 * b.w * b.h;
});

// d verilirse (pdf = orijinal belge): örtülen yazılar atlanır, yazı nesneleri (kaydedilmemiş olsa da) eklenir
async function pageLines(pdf, i, d = null) {
  const { Util } = getPdfjs();
  const page = await pdf.getPage(i + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const covers = coverRects(d, i);
  const items = [];
  for (const it of tc.items) {
    if (it.str == null) continue;
    const tx = Util.transform(vp.transform, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (covers.length && it.str.trim() && mostlyCovered({ x: tx[4], y: tx[5] - size, w: Math.max(it.width, size * 0.3), h: size }, covers)) continue;
    let fontName = '';
    try { if (page.commonObjs.has(it.fontName)) fontName = page.commonObjs.get(it.fontName)?.name || ''; } catch (e) { /* yoksay */ }
    items.push({ str: it.str, x: tx[4], y: tx[5], w: it.width, size, eol: it.hasEOL, bold: /bold|black|heavy|semibold/i.test(fontName) });
  }
  if (d) {
    const { layoutText } = await import('./flatten.js');
    for (const o of d.pageObjs?.[i] || []) {
      if (o.type !== 'text' || !o.text?.trim()) continue;
      layoutText(o).forEach((t, k) => {
        if (t.trim()) items.push({ str: t, x: o.x, y: o.y + o.size * (0.95 + k * 1.2), w: o.w, size: o.size, eol: true, bold: !!o.bold });
      });
    }
  }
  // satırlara grupla
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    if (!it.str.trim() && !lines.length) continue;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < Math.max(2, Math.min(last.size, it.size || last.size) * 0.45)) last.items.push(it);
    else if (it.str.trim()) lines.push({ y: it.y, size: it.size, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let s = '';
    let end = null;
    for (const it of l.items) {
      if (end != null && it.x - end > l.size * 0.2 && !s.endsWith(' ') && !it.str.startsWith(' ')) s += ' ';
      s += it.str;
      end = it.x + it.w;
    }
    l.text = s.replace(/\s+$/, '');
    l.x = l.items[0].x;
    l.size = Math.max(...l.items.map((t) => t.size));
    l.bold = l.items.filter((t) => t.str.trim()).every((t) => t.bold);
  }
  return { lines: lines.filter((l) => l.text.trim()), vp, page };
}

function linesToParagraphs(lines) {
  const paras = [];
  for (const l of lines) {
    const last = paras[paras.length - 1];
    const prev = last?.lines[last.lines.length - 1];
    const gap = prev ? l.y - prev.y : Infinity;
    const same = prev && gap < prev.size * 1.75 && Math.abs(l.size - prev.size) < 1.2 && l.bold === prev.bold && !/[.:!?]$/.test(prev.text) ? true : prev && gap < prev.size * 1.45 && Math.abs(l.size - prev.size) < 1.2 && l.bold === prev.bold;
    if (same) last.lines.push(l);
    else paras.push({ lines: [l], y: l.y });
  }
  return paras.map((p) => ({ y: p.y, text: p.lines.map((l) => l.text).join(' ').replace(/(\S)- (\S)/g, '$1$2'), size: p.lines[0].size, bold: p.lines[0].bold }));
}

export async function exportText(d) {
  const { text, plain } = await withProgress(t('convert.extracting'), async (p) => {
    const out = [];
    for (let i = 0; i < d.numPages; i++) {
      p.check();
      p.set(i / d.numPages, t('convert.pageNofM', { n: i + 1, total: d.numPages }));
      // kaydedilmemiş düzenlemeler dahil (örtülen eski yazı hariç)
      const { lines } = await pageLines(d.pdf, i, d);
      out.push(lines.map((l) => l.text).join('\r\n'));
    }
    return { text: out.map((s, i) => `${t('convert.txtPageMarker', { n: i + 1 })}\r\n${s}`).join('\r\n\r\n'), plain: out.join('') };
  });
  if (plain.trim().length < 5) {
    toast(t('convert.noSelectableText'), { type: 'warn', timeout: 6000 });
    return;
  }
  const dest = await window.pu.saveDialog({ defaultName: `${baseName(d.name)}.txt`, filters: [{ name: t('convert.filterText'), extensions: ['txt'] }] });
  if (!dest) return;
  await window.pu.writeFile(dest, new TextEncoder().encode(`﻿${text}`));
  toast(t('convert.textSaved'), { type: 'ok', action: { label: t('convert.open'), run: () => window.pu.openPath(dest) } });
}

// ---------------- PDF → Word ----------------
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

function imageXml(rid, id, wPt, hPt) {
  const cx = Math.round(wPt * 12700), cy = Math.round(hPt * 12700);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Resim ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="img${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

export async function exportDocx(d) {
  const { pageRange, infoBox, pagesWithText } = await import('./assist.js');
  const mode = select([{ value: 'text', label: t('convert.docxModeText') }, { value: 'image', label: t('convert.docxModeImage') }], 'text');
  const range = pageRange(d, { label: t('convert.docxPages') });
  const warnBox = el('div', {});
  const checkText = async () => {
    let pgs = [];
    try { pgs = range.pages(); } catch (e) { warnBox.replaceChildren(); return; }
    const withText = await pagesWithText(d, pgs);
    const missing = pgs.filter((p) => !withText.includes(p));
    warnBox.replaceChildren();
    if (!missing.length) return;
    const box = infoBox('triangle-alert', t('convert.noTextPages', { count: missing.length }),
      t('convert.noTextPagesBody'), { warn: true });
    // OCR Pro özelliğidir: düğmede Pro rozeti; ücretsizse tıklayınca yükseltme penceresi açılır
    const pro = await import('./pro.js');
    const btn = el('button', { class: 'btn small primary', html: `${icon('scan-text')}${esc(t('convert.ocrThesePages'))}${pro.isPro() ? '' : `<span class="pro-chip" title="${esc(t('common.proFeature'))}">${icon('crown')}Pro</span>`}` });
    btn.onclick = async () => {
      if (!pro.requirePro('ocr')) return;
      const m = await import('./ocr.js');
      await m.ocrDialog(d, null, { pages: missing });
      checkText();
    };
    box.querySelector('div:last-child').append(el('div', { style: { marginTop: '8px' } }, btn));
    warnBox.append(box);
  };
  range.input.addEventListener('input', () => checkText());
  checkText();
  const res = await modal({
    title: t('convert.docxTitle'), width: 580,
    body: el('div', {}, infoBox('file-type', null, t('convert.docxInfo')),
      field(t('convert.docxType'), mode), range.node, warnBox),
    buttons: [{ label: t('common.cancel') }, { label: t('convert.convert'), primary: true, run: () => { try { range.pages(); return true; } catch (e) { toast(e.message, { type: 'warn' }); return false; } } }],
  });
  if (!res) return;
  const pages = range.pages();
  const target = await window.pu.saveDialog({ defaultName: `${baseName(d.name)}.docx`, filters: [{ name: t('convert.filterWordDoc'), extensions: ['docx'] }] });
  if (!target) return;
  let failedImgs = 0;
  const bytes = await withProgress(t('convert.docxConverting'), async (p) => {
    const media = [];
    const body = [];
    let imgId = 1;
    let sect = null;
    const src = await sourceFor(d);
    try {
      for (let n = 0; n < pages.length; n++) {
        p.check();
        p.set(n / pages.length, t('convert.pageN', { n: pages[n] + 1 }));
        const i = pages[n];
        const page = await src.doc.getPage(i + 1);
        const vp1 = page.getViewport({ scale: 1 });
        if (!sect) sect = { w: vp1.width, h: vp1.height };
        if (n > 0) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        const maxW = vp1.width - 72 * 1.4;
        if (mode.value === 'image') {
          const vp = page.getViewport({ scale: 2 });
          const c = document.createElement('canvas');
          c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          await page.render({ canvas: c, viewport: vp, background: '#ffffff' }).promise;
          const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
          const name = `image${imgId}.jpeg`;
          media.push({ name, data: new Uint8Array(await blob.arrayBuffer()), rid: `rIdImg${imgId}` });
          const s = Math.min(maxW / vp1.width, (vp1.height - 72 * 1.4) / vp1.height);
          body.push(`<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr>${imageXml(`rIdImg${imgId}`, imgId, vp1.width * s, vp1.height * s)}</w:p>`);
          imgId++;
          continue;
        }
        // yazılar orijinal belgeden: örtülen eski yazı atlanır, yazı nesneleri ayrıca eklenir
        const { lines } = await pageLines(d.pdf, i, d);
        const paras = linesToParagraphs(lines).map((pp) => ({ kind: 'p', ...pp }));
        const fakeDoc = { pdf: src.doc, pageObjs: [], hasObjects: () => false };
        const imgs = await pageImages(fakeDoc, i).catch(() => []);
        const covers = coverRects(d, i);
        const overlap = (a, b) => a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
        const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
        const seen = new Set();
        const composited = [];
        for (const im of imgs) {
          if (im.box.w < 24 || im.box.h < 24) continue;
          if (im.objId && seen.has(im.objId)) continue;
          // MRC taramada yazı maskesi, arka plan görseliyle birlikte zaten çizildi
          if (composited.some((b) => inside(im.box, b))) continue;
          if (covers.length && mostlyCovered(im.box, covers)) continue;
          // maske (siyah-beyaz JBIG2/CCITT tarama, MRC yazı katmanı) ya da üst üste katmanlar: sayfada göründüğü gibi çiz
          const layered = im.isMask || imgs.some((o) => o !== im && overlap(o.box, im.box));
          if (layered) composited.push(im.box);
          if (im.objId) seen.add(im.objId);
          paras.push({ kind: 'img', y: im.box.y, im, layered });
        }
        paras.sort((a, b) => a.y - b.y);
        for (const para of paras) {
          if (para.kind === 'img') {
            try {
              const im = para.im;
              let c = para.layered ? null : await imageCanvas(fakeDoc, i, im);
              // döndürülmüş sayfa ya da döndürülmüş/aynalanmış çizilen görsel: ham pikseller yan yatık ve gerilmiş olur
              const m = im.m;
              const upright = m && Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6 && m[0] > 0 && m[3] < 0;
              const boxAr = im.box.w / im.box.h;
              if (c && (!upright || Math.abs(c.width / c.height - boxAr) > 0.1 * boxAr)) c = null;
              if (!c) {
                const px = Math.max(im.width || 0, im.height || 0) || 1000;
                c = await renderRegion(fakeDoc, i, im.box, Math.min(4, Math.max(2, px / Math.max(im.box.w, im.box.h))), { withObjects: false });
              }
              const blob = await canvasToBlob(c, 'image/png');
              const name = `image${imgId}.png`;
              media.push({ name, data: new Uint8Array(await blob.arrayBuffer()), rid: `rIdImg${imgId}` });
              const s = Math.min(1, maxW / im.box.w);
              body.push(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${imageXml(`rIdImg${imgId}`, imgId, im.box.w * s, im.box.h * s)}</w:p>`);
              imgId++;
            } catch (e) { console.warn('görsel aktarılamadı', e); failedImgs++; }
            continue;
          }
          const sz = Math.max(12, Math.round(para.size * 2));
          body.push(`<w:p><w:pPr><w:spacing w:after="${Math.round(para.size * 6)}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${para.bold ? '<w:b/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(para.text)}</w:t></w:r></w:p>`);
        }
      }
    } finally { src.destroy(); }
    const tw = (v) => Math.round(v * 20);
    const sectPr = `<w:sectPr><w:pgSz w:w="${tw(sect.w)}" w:h="${tw(sect.h)}"${sect.w > sect.h ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="1008" w:right="1008" w:bottom="1008" w:left="1008" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}${sectPr}</w:body></w:document>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${media.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('')}</Relationships>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    p.set(0.97, t('convert.packing'));
    return makeZip([
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: rootRels },
      { name: 'word/document.xml', data: docXml },
      { name: 'word/_rels/document.xml.rels', data: rels },
      ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
    ]);
  });
  await window.pu.writeFile(target, bytes);
  toast(t('convert.docxCreated'), { type: 'ok', timeout: 6000, action: { label: t('convert.open'), run: () => window.pu.openPath(target) } });
  if (failedImgs) toast(t('convert.imagesFailed', { count: failedImgs }), { type: 'warn', timeout: 6000 });
}

// ---------------- Görsel → PDF ----------------
export async function imagesToPdfDialog() {
  const files = await window.pu.openFilesDialog({ title: t('convert.imgPickTitle'), multi: true, filters: [{ name: t('convert.filterImages'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] });
  if (!files.length) return;
  const list = files.map((f) => ({ name: f.name, blob: new Blob([f.bytes], { type: mimeOf(f.name) }) }));
  await imagesToPdfWithList(list);
}

export async function imagesToPdf(fileObjs) {
  await imagesToPdfWithList(fileObjs.map((f) => ({ name: f.name, blob: f })));
}

// Kayıpsız gömme: pdf-lib'in embedPng'si PNG'yi JavaScript ile çözüp yeniden sıkıştırır; büyük görselde
// arayüzü saniyelerce kilitliyordu. Tuvalin piksellerini tarayıcının yerel (arka plandaki) zlib'iyle sıkıştırıp
// görüntü nesnesini doğrudan yazıyoruz. Saydamlık varsa ayrı bir SMask olarak eklenir.
async function deflate(bytes) {
  const out = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function embedCanvasLossless(doc, c) {
  const w = c.width, h = c.height, n = w * h;
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(n * 3);
  let alpha = null;
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 3, k += 4) {
    rgb[j] = px[k]; rgb[j + 1] = px[k + 1]; rgb[j + 2] = px[k + 2];
    if (px[k + 3] !== 255) { alpha ||= new Uint8Array(n).fill(255); alpha[i] = px[k + 3]; }
  }
  const ctx = doc.context;
  const base = { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, BitsPerComponent: 8, Filter: 'FlateDecode' };
  const dict = { ...base, ColorSpace: 'DeviceRGB' };
  if (alpha) dict.SMask = ctx.register(ctx.stream(await deflate(alpha), { ...base, ColorSpace: 'DeviceGray' }));
  return { xobject: ctx.register(ctx.stream(await deflate(rgb), dict)) };
}

export function drawXObject(page, img, { x, y, width, height }) {
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = PDFLib();
  const name = page.node.newXObject('Image', img.xobject);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(width, 0, 0, height, x, y), drawObject(name), popGraphicsState());
}

function mimeOf(name) {
  const e = name.split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' }[e] || 'image/png';
}

const IMG_EXT = /\.(jpe?g|png|webp|bmp|gif)$/i;

// Izgara önizlemesi: tam çözünürlüklü görsel yerine ~200 px'lik küçük kopya (çok sayıda büyük fotoğrafta bellek şişmesin).
// Çözülemeyen dosyada özgün blob adresine düşer. Dönen adres freeItem ile serbest bırakılır.
async function thumbUrl(blob) {
  try {
    const bmp = await createImageBitmap(blob, { resizeWidth: 200, resizeQuality: 'medium', imageOrientation: 'from-image' });
    try {
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      const alpha = /^image\/(png|gif|webp)$/.test(blob.type);   // saydamlık korunsun
      const out = await canvasToBlob(c, alpha ? 'image/png' : 'image/jpeg', 0.7);
      c.width = c.height = 0;
      return URL.createObjectURL(out);
    } finally { bmp.close(); }
  } catch { return URL.createObjectURL(blob); }
}

async function imagesToPdfWithList(list) {
  let api = null;
  const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '8px', maxHeight: '280px', overflow: 'auto', margin: '6px 0 12px' } });
  const emptyNote = el('div', { class: 'muted', style: { textAlign: 'center', padding: '28px 12px', border: '1px dashed var(--border)', borderRadius: '8px', margin: '6px 0 12px' }, text: t('convert.emptyNote') });
  const countLabel = el('span', { class: 'muted' });
  // Küçük önizleme adresi (söz olarak saklanır: eşzamanlı render'lar tek kopya üretir, serbest bırakma sızıntı yapmaz)
  const freeItem = (it) => { const p = it.thumb; it.thumb = null; it.url = null; if (p) p.then((u) => URL.revokeObjectURL(u), () => {}); };
  const render = async () => {
    const n = list.length;
    countLabel.textContent = n ? t('convert.imageCount', { count: n }) : '';
    const h = api?.box.querySelector('.modal-head h3');
    if (h) h.textContent = t('convert.imgToPdfTitle', { n });
    const go = api?.foot.querySelector('.btn.primary');
    if (go) go.disabled = !n;
    emptyNote.style.display = n ? 'none' : '';
    grid.style.display = n ? 'grid' : 'none';
    grid.replaceChildren(...await Promise.all(list.map(async (it, i) => {
      it.url = await (it.thumb ||= thumbUrl(it.blob));
      const cell = el('div', { style: { border: '1px solid var(--border)', borderRadius: '8px', padding: '4px', textAlign: 'center', background: 'var(--panel-2)' } },
        el('img', { src: it.url, style: { width: '100%', height: '80px', objectFit: 'contain' } }),
        el('div', { class: 'muted', style: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: `${i + 1}. ${it.name}` }));
      const row = el('div', { class: 'row', style: { justifyContent: 'center', gap: '2px' } });
      const b = (ic, fn, dis) => { const x = el('button', { class: 'icon-btn', html: icon(ic), disabled: dis }); x.onclick = () => { fn(); render(); }; return x; };
      row.append(b('chevron-left', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; }, i === 0), b('x', () => { const [gone] = list.splice(i, 1); freeItem(gone); }), b('chevron-right', () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; }, i === list.length - 1));
      cell.append(row);
      return cell;
    })));
  };
  // Sonradan görsel ekleme: yalnızca görsel dosyalar alınır, ötekiler sessizce yok sayılır
  const addBlobs = async (items) => {
    const ok = items.filter((x) => x.blob && (IMG_EXT.test(x.name || '') || /^image\//.test(x.blob.type)));
    if (!ok.length) return 0;
    for (const x of ok) {
      const blob = /^image\//.test(x.blob.type) ? x.blob : new Blob([x.blob], { type: mimeOf(x.name) });
      list.push({ name: x.name || t('convert.defaultImageName'), blob });
    }
    await render();
    grid.scrollTop = grid.scrollHeight;
    return ok.length;
  };
  const addMore = async () => {
    const files = await window.pu.openFilesDialog({ title: t('convert.addPickTitle'), multi: true, filters: [{ name: t('convert.filterImages'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] });
    if (!files?.length) return;
    await addBlobs(files.map((f) => ({ name: f.name, blob: new Blob([f.bytes], { type: mimeOf(f.name) }) })));
  };
  const addBtn = el('button', { class: 'btn', html: `${icon('plus')} ${t('convert.addImage')}` });
  addBtn.onclick = () => addMore().catch((e) => toast(t('common.error', { error: e?.message || e }), { type: 'error' }));
  const onPaste = (e) => {
    const imgs = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (!imgs.length) return;
    e.preventDefault();
    let n = list.length;
    addBlobs(imgs.map((f) => ({ name: IMG_EXT.test(f.name || '') && f.name !== 'image.png' ? f.name : t('convert.clipboardName', { n: ++n }), blob: f }))).catch(addFailed);
  };
  await render();
  const freeUrls = () => list.forEach(freeItem);
  const addFailed = (e) => toast(t('convert.addFailed', { error: e?.message || e }), { type: 'error', timeout: 6000 });
  const size = select([{ value: 'A4', label: t('convert.sizeA4') }, { value: 'fit', label: t('convert.sizeFit') }, { value: 'Letter', label: 'Letter' }], 'A4');
  const margin = select([{ value: 0, label: t('convert.marginNone') }, { value: 20, label: t('convert.marginSmall') }, { value: 40, label: t('convert.marginNormal') }], 20);
  const quality = select([{ value: 'high', label: t('convert.qualityHigh') }, { value: 'small', label: t('convert.qualitySmall') }], 'high');
  document.addEventListener('paste', onPaste);
  const res = await modal({
    title: t('convert.imgToPdfTitle', { n: list.length }), width: 600,
    body: el('div', {}, el('div', { class: 'row', style: { alignItems: 'center', gap: '10px' } }, addBtn, countLabel), emptyNote, grid, el('div', { class: 'row' }, field(t('convert.pageSize'), size), field(t('convert.margin'), margin), field(t('convert.quality'), quality))),
    buttons: [{ label: t('common.cancel') }, { label: t('convert.createPdf'), primary: true, value: true }],
    onOpen: (a) => {
      api = a;
      // Pencerenin üstüne görsel sürüklenebilir; olay uygulamanın genel bırakma işleyicisine (uyarı gösterir) ulaşmasın
      const zone = a.box.parentElement;
      const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
      zone.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); } });
      zone.addEventListener('drop', (e) => {
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault(); e.stopPropagation();
        addBlobs([...e.dataTransfer.files].map((f) => ({ name: f.name, blob: f }))).catch(addFailed);
      });
      render();
    },
  }).finally(() => document.removeEventListener('paste', onPaste));
  if (!res || !list.length) { freeUrls(); return; }
  const bytes = await withProgress(t('convert.creatingPdf'), async (p) => {
    const { PDFDocument } = PDFLib();
    const doc = await PDFDocument.create();
    const maxDim = quality.value === 'high' ? 3000 : 1600;
    const q = quality.value === 'high' ? 0.9 : 0.72;
    for (let k = 0; k < list.length; k++) {
      p.check();
      p.set(k / list.length, list[k].name);
      const bmp = await createImageBitmap(list[k].blob, { imageOrientation: 'from-image' });
      const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      const ctx = c.getContext('2d');
      const png = list[k].blob.type === 'image/png';
      if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      let img;
      if (png) img = await embedCanvasLossless(doc, c);
      else img = await doc.embedJpg(new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', q)).arrayBuffer()));
      const m = +margin.value;
      let pw, ph;
      if (size.value === 'fit') { pw = (c.width / s) * 0.75 + 2 * m; ph = (c.height / s) * 0.75 + 2 * m; const lim = 14400; const f = Math.min(1, lim / Math.max(pw, ph)); pw *= f; ph *= f; } else {
        [pw, ph] = size.value === 'Letter' ? [612, 792] : [595.28, 841.89];
        if (c.width > c.height) [pw, ph] = [ph, pw];
      }
      const page = doc.addPage([pw, ph]);
      const f = Math.min((pw - 2 * m) / c.width, (ph - 2 * m) / c.height);
      const box = { x: (pw - c.width * f) / 2, y: (ph - c.height * f) / 2, width: c.width * f, height: c.height * f };
      if (img.ref) page.drawImage(img, box);
      else drawXObject(page, img, box);
      c.width = c.height = 0;
      await new Promise((r) => setTimeout(r, 0)); // ilerleme çubuğu ve arayüz nefes alsın
    }
    doc.setProducer('HermoPDF');
    return savePdfLib(doc);
  }).finally(freeUrls);
  await openBytesTab(bytes, `${baseName(list[0].name.replace(/\.[^.]+$/, ''))}.pdf`);
  toast(t('convert.pdfFromImages', { count: list.length }),{ type: 'ok', timeout: 5000 });
}

// ---------------- Word → PDF ----------------
// Word kuruluysa Microsoft Word'ün kendi PDF motoru (birebir), değilse dahili motor (yalnız .docx).
export const WORD_EXT = ['docx', 'doc', 'docm', 'dotx', 'dot', 'rtf', 'odt'];
export const isWordFile = (name) => new RegExp(`\\.(${WORD_EXT.join('|')})$`, 'i').test(name || '');

export async function wordToPdfDialog() {
  const files = await window.pu.openFilesDialog({ title: t('convert.wordPickTitle'), multi: true, filters: [{ name: t('convert.filterWordDocs'), extensions: WORD_EXT }] });
  if (!files.length) return;
  await wordToPdf(files.map((f) => ({ path: f.path, name: f.name })));
}

const cleanIpcError = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// list: [{ path?, name, bytes? }]
export async function wordToPdf(list, { engine = 'auto' } = {}) {
  const { word } = await window.pu.officeInfo();
  const viaWord = word && engine !== 'builtin';
  const done = [];
  const failed = [];
  await withProgress(t(viaWord ? 'convert.wordProgressWord' : 'convert.wordProgressBuiltin'), async (p) => {
    for (let k = 0; k < list.length; k++) {
      p.check();
      p.set((k + 0.15) / list.length, list.length > 1 ? `${k + 1}/${list.length}: ${list[k].name}` : list[k].name);
      try {
        const r = await window.pu.officeToPdf({ path: list[k].path || null, name: list[k].name, bytes: list[k].path ? null : list[k].bytes, engine });
        done.push({ ...r, name: list[k].name });
      } catch (e) {
        failed.push({ name: list[k].name, error: cleanIpcError(e) });
      }
    }
  });
  for (const r of done) await openBytesTab(r.bytes, `${baseName(r.name.replace(/\.[^.]+$/, ''))}.pdf`);
  for (const f of failed) toast(`${f.name}: ${f.error}`, { type: 'error', timeout: 9000 });
  const warn = done.find((r) => r.warning);
  if (warn) toast(warn.warning, { type: 'warn', timeout: 8000 });
  if (done.length) {
    const { runAction } = await import('./ribbon.js');
    const how = t(done.every((r) => r.engine === 'word') ? 'convert.howWord' : 'convert.howBuiltin');
    toast(t('convert.wordDone', { count: done.length, how }), { type: 'ok', timeout: 6000, action: { label: t('common.save'), run: () => runAction('file.save') } });
  }
  return { done: done.length, failed: failed.length };
}

// ---------------- Metin → PDF ----------------
// UTF-16 (Not Defteri "Unicode", PowerShell 5.1 çıktısı), UTF-8, yoksa Windows-1254
export function decodeText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let enc = b[0] === 0xFF && b[1] === 0xFE ? 'utf-16le' : b[0] === 0xFE && b[1] === 0xFF ? 'utf-16be' : null;
  if (!enc && b.length >= 4) {
    // BOM'suz UTF-16: ASCII ağırlıklı metinde baytların yarısı 0
    const n = Math.min(b.length, 2048);
    let zOdd = 0, zEven = 0;
    for (let k = 0; k < n; k++) if (!b[k]) { if (k & 1) zOdd++; else zEven++; }
    if (zOdd > n / 2 * 0.3 && zEven < n / 2 * 0.05) enc = 'utf-16le';
    else if (zEven > n / 2 * 0.3 && zOdd < n / 2 * 0.05) enc = 'utf-16be';
  }
  let text;
  if (enc) text = new TextDecoder(enc).decode(b);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { text = new TextDecoder('windows-1254').decode(b); }
  }
  return text.replace(/^﻿/, '');
}

export async function textToPdfDialog() {
  const files = await window.pu.openFilesDialog({ title: t('convert.textPickTitle'), multi: false, filters: [{ name: t('convert.filterTextShort'), extensions: ['txt', 'md', 'csv', 'log'] }] });
  if (!files.length) return;
  const text = decodeText(files[0].bytes);
  const size = 11, margin = 56, lh = size * 1.35;
  const { PDFDocument } = PDFLib();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit());
  const font = await doc.embedFont(await fontBytes(fontFile(defaultFamily(), false, false)), { subset: true });
  const charset = new Set(font.getCharacterSet());
  const clean = [...text].map((ch) => (ch === '\n' || ch === '\t' ? (ch === '\t' ? '    ' : ch) : charset.has(ch.codePointAt(0)) ? ch : ' ')).join('');
  const [W, H] = [595.28, 841.89];
  const lines = wrapText(clean, W - 2 * margin, (s) => font.widthOfTextAtSize(s, size));
  let page = null, y = 0;
  for (const line of lines) {
    if (!page || y < margin) { page = doc.addPage([W, H]); y = H - margin - size; }
    if (line) page.drawText(line, { x: margin, y, size, font });
    y -= lh;
  }
  await openBytesTab(await savePdfLib(doc), `${baseName(files[0].name.replace(/\.[^.]+$/, ''))}.pdf`);
}

void App; void esc;
