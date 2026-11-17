// Toplu işlem: seçilen birçok PDF'e aynı işlemi uygular (küçült, OCR, filigran, sayfa numarası,
// görüntüye çevir, birleştir, parola kaldır). Pro özelliği (12 Kas 2026): requirePro('batch').
// Tek dosyada küçültme / birleştirme / bölme ücretsiz kalır (compress.js, pageops.js).
import { App } from './state.js';
import { el, toast, modal, field, select, fmtBytes, baseName, withProgress, CancelError } from './util.js';
import { icon } from './icons.js';
import { infoBox } from './assist.js';
import { PDFLib, loadPdfLib, savePdfLib, openPdfjs, copyPagesClean } from './pdfcore.js';
import { compressBytes, LEVELS } from './compress.js';
import { pageImages } from './images.js';
import { fontBytes, fontFile, defaultFamily } from './fonts.js';
import { t } from './i18n.js';
import { requirePro } from './pro.js';

const JOBS = {
  compress: { get label() { return t('batch.jobCompress'); }, icon: 'shrink', get suffix() { return t('batch.sufCompress'); } },
  ocr: { get label() { return t('batch.jobOcr'); }, icon: 'scan-text', get suffix() { return t('batch.sufOcr'); } },
  watermark: { get label() { return t('batch.jobWatermark'); }, icon: 'droplets', get suffix() { return t('batch.sufWatermark'); } },
  numbers: { get label() { return t('batch.jobNumbers'); }, icon: 'list-ordered', get suffix() { return t('batch.sufNumbers'); } },
  images: { get label() { return t('batch.jobImages'); }, icon: 'file-image', suffix: '' },
  merge: { get label() { return t('batch.jobMerge'); }, icon: 'combine', suffix: '' },
  unlock: { get label() { return t('batch.jobUnlock'); }, icon: 'lock-open', get suffix() { return t('batch.sufUnlock'); } },
};

export async function batchDialog() {
  if (!requirePro('batch')) return;
  const files = [];
  const list = el('div', { class: 'batch-list' });
  const job = select(Object.entries(JOBS).map(([k, v]) => ({ value: k, label: v.label })), 'compress');
  const opts = el('div', { class: 'batch-opts' });

  // işleme özel seçenekler
  const level = select(Object.entries(LEVELS).map(([k, v]) => ({ value: k, label: v.label })), 'medium');
  const target = el('input', { class: 'input', type: 'number', step: 0.1, min: 0.1, placeholder: t('batch.targetPh') });
  const wmText = el('input', { class: 'input', value: t('batch.wmDefault') });
  const wmColor = el('input', { type: 'color', class: 'color-pick', value: '#d32f2f' });
  const numFormat = select([{ value: '{n}', label: '1, 2, 3…' }, { value: '{n} / {t}', label: '1 / 10' }, { value: t('batch.numPageFmt'), label: t('batch.numPageLabel') }], '{n} / {t}');
  const ocrLang = select([{ value: 'tur+eng', label: t('batch.ocrLangTrEn') }, { value: 'tur', label: t('batch.ocrLangTr') }, { value: 'eng', label: t('batch.ocrLangEn') }], 'tur+eng');
  const ocrDpi = select([{ value: 200, label: t('batch.dpiFast') }, { value: 300, label: t('batch.dpiBalanced') }], 300);
  const imgDpi = select([{ value: 150, label: '150 DPI' }, { value: 200, label: '200 DPI' }, { value: 300, label: '300 DPI' }], 150);
  const pw = el('input', { class: 'input', type: 'password', placeholder: t('batch.pwPh') });

  const renderOpts = () => {
    const v = job.value;
    const parts = [];
    if (v === 'compress') parts.push(infoBox('shrink', null, t('batch.infoCompress')), el('div', { class: 'row' }, field(t('batch.level'), level), field(t('batch.targetSize'), target)));
    if (v === 'ocr') parts.push(infoBox('scan-text', null, t('batch.infoOcr')), el('div', { class: 'row' }, field(t('batch.lang'), ocrLang), field(t('batch.quality'), ocrDpi)));
    if (v === 'watermark') parts.push(el('div', { class: 'row' }, field(t('batch.wmText'), wmText), el('label', { class: 'field' }, el('span', { class: 'field-label', text: t('batch.color') }), wmColor)));
    if (v === 'numbers') parts.push(field(t('batch.format'), numFormat));
    if (v === 'images') parts.push(infoBox('file-image', null, t('batch.infoImages')), field(t('batch.resolution'), imgDpi));
    if (v === 'merge') parts.push(infoBox('combine', null, t('batch.infoMerge')));
    if (v === 'unlock') parts.push(field(t('batch.password'), pw, t('batch.pwHint')));
    opts.replaceChildren(...parts);
  };
  job.addEventListener('change', renderOpts);
  renderOpts();

  const render = () => {
    if (!files.length) {
      list.replaceChildren(el('div', { class: 'empty-note', text: t('batch.empty') }));
      return;
    }
    list.replaceChildren(...files.map((f, i) => {
      const row = el('div', { class: 'batch-row' },
        el('span', { class: 'bi', html: icon('file-text') }),
        el('div', { class: 'bn' }, el('div', { class: 'bname', text: f.name }), el('div', { class: 'bpath', text: `${fmtBytes(f.size)}` })),
        el('span', { class: 'bstatus', text: f.status || '' }));
      const b = (ic, title, fn, dis) => { const x = el('button', { class: 'icon-btn', title, html: icon(ic), disabled: dis }); x.onclick = () => { fn(); render(); }; return x; };
      row.append(
        b('chevron-up', t('batch.up'), () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; }, i === 0),
        b('chevron-down', t('batch.down'), () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; }, i === files.length - 1),
        b('x', t('batch.removeFromList'), () => files.splice(i, 1)),
      );
      return row;
    }));
  };
  render();

  const addBtn = el('button', { class: 'btn', html: `${icon('plus')}${t('batch.addPdf')}` });
  addBtn.onclick = async () => {
    const picked = await window.pu.openPdfDialog({ multi: true, title: t('batch.pickTitle') });
    for (const f of picked) if (!files.some((x) => x.path === f.path)) files.push(f);
    render();
  };
  const outMode = select([
    { value: 'same', label: t('batch.outSame') },
    { value: 'folder', label: t('batch.outFolder') },
  ], 'same');

  const res = await modal({
    title: t('batch.title'), width: 680,
    body: el('div', {},
      infoBox('file-stack', t('batch.whatFor'), t('batch.whatForBody')),
      el('div', { class: 'row', style: { marginBottom: '10px' } }, addBtn, el('span', { class: 'muted', text: t('batch.ctrlA') })),
      list,
      field(t('batch.jobField'), job),
      opts,
      field(t('batch.outField'), outMode)),
    buttons: [{ label: t('common.cancel') }, { label: t('batch.start'), primary: true, run: () => {
      if (!files.length) { toast(t('batch.needFiles'), { type: 'warn' }); return false; }
      if (job.value === 'merge' && files.length < 2) { toast(t('batch.needTwo'), { type: 'warn' }); return false; }
      return true;
    } }],
  });
  if (!res) return;

  let folder = null;
  if (outMode.value === 'folder' || job.value === 'merge' || job.value === 'images') {
    folder = await window.pu.folderDialog({ title: t('batch.outFolderTitle') });
    if (!folder) return;
  }
  const done = [];
  const failed = [];
  try {
    await withProgress(t('batch.progressTitle', { job: JOBS[job.value].label }), async (p) => {
      if (job.value === 'merge') {
        const { PDFDocument } = PDFLib();
        const out = await PDFDocument.create();
        for (let k = 0; k < files.length; k++) {
          p.check();
          p.set(k / files.length, files[k].name);
          const src = await loadPdfLib(files[k].bytes);
          const cp = await copyPagesClean(out, src, src.getPageIndices());
          cp.forEach((x) => out.addPage(x));
        }
        const bytes = await savePdfLib(out);
        const name = `${baseName(files[0].name)} ${t('batch.sufMerged')}.pdf`;
        const f = await window.pu.writeInFolder(folder, name, bytes);
        done.push({ name, path: f, size: bytes.length });
        return;
      }
      for (let k = 0; k < files.length; k++) {
        p.check();
        const f = files[k];
        const base = k / files.length;
        const span = 1 / files.length;
        p.set(base, `${k + 1}/${files.length} — ${f.name}`);
        try {
          const outName = `${baseName(f.name)} ${JOBS[job.value].suffix}.pdf`.replace(/\s+\./, '.');
          const dir = folder || f.path.replace(/[\\/][^\\/]*$/, '');
          let bytes = null;
          if (job.value === 'compress') {
            const tgt = +target.value > 0 ? Math.round(+target.value * 1048576) : null;
            bytes = await batchCompress(f.bytes, level.value, tgt, (v, m) => p.set(base + v * span, `${k + 1}/${files.length} — ${f.name} ${m || ''}`), () => p.check());
          } else if (job.value === 'ocr') {
            bytes = await batchOcr(f.bytes, ocrLang.value, +ocrDpi.value, (v, m) => p.set(base + v * span, `${k + 1}/${files.length} — ${f.name} ${m || ''}`), () => p.check());
          } else if (job.value === 'watermark') {
            bytes = await batchWatermark(f.bytes, wmText.value, wmColor.value);
          } else if (job.value === 'numbers') {
            bytes = await batchNumbers(f.bytes, numFormat.value);
          } else if (job.value === 'unlock') {
            const lib = await loadPdfLib(f.bytes, pw.value || '');
            bytes = await savePdfLib(lib);
          } else if (job.value === 'images') {
            const sub = await batchImages(f, folder, +imgDpi.value, (v, m) => p.set(base + v * span, `${k + 1}/${files.length} — ${f.name} ${m || ''}`), () => p.check());
            done.push({ name: f.name, path: sub, size: 0, note: 'klasör' });
            continue;
          }
          const written = await window.pu.writeInFolder(dir, outName, bytes);
          done.push({ name: outName, path: written, size: bytes.length, before: f.size });
        } catch (e) {
          if (e instanceof CancelError || e?.cancelled) throw e;
          console.error(e);
          failed.push({ name: f.name, error: e.message });
        }
      }
    });
  } catch (e) {
    if (!(e instanceof CancelError) && !e?.cancelled) throw e;
  }

  const rows = [
    ...done.map((r) => el('tr', {}, el('td', { text: r.name }), el('td', { text: r.note === 'klasör' ? t('batch.wroteToFolder') : `${r.before ? `${fmtBytes(r.before)} → ` : ''}${fmtBytes(r.size)}` }))),
    ...failed.map((r) => el('tr', {}, el('td', { text: r.name }), el('td', { style: { color: 'var(--err)' }, text: r.error }))),
  ];
  const openTarget = done[0]?.path?.replace(/[\\/][^\\/]*$/, '') || folder;
  const r2 = await modal({
    title: t('batch.doneTitle'), width: 620,
    body: el('div', {},
      el('p', { class: 'modal-msg', text: failed.length ? t('batch.doneFailed', { count: done.length, failed: failed.length }) : t('batch.doneOk', { count: done.length }) }),
      el('table', { class: 'info-table' }, rows)),
    buttons: [{ label: t('common.close') }, { label: t('batch.openFolder'), primary: true, value: 'open' }],
  });
  if (r2 === 'open' && openTarget) window.pu.openPath(openTarget);
}

// ---------------- iş türleri ----------------
async function batchCompress(bytes, levelKey, targetSize, onProgress, check) {
  const order = targetSize ? ['light', 'medium', 'strong', 'extreme', 'raster150', 'raster100'] : [levelKey];
  let best = null;
  for (let i = 0; i < order.length; i++) {
    check();
    const out = await compressBytes(bytes, order[i], { onProgress: (v, m) => onProgress((i + v) / order.length, m), check });
    if (!best || out.length < best.length) best = out;
    if (!targetSize || out.length <= targetSize) break;
  }
  return best;
}

async function batchOcr(bytes, lang, dpi, onProgress, check) {
  const { ocrBytes } = await import('./ocr.js');
  return ocrBytes(bytes, { lang, dpi, onProgress, check });
}

// Türkçe karakterli yazı tipi (Standart Helvetica'da İ, ı, Ş, ş, Ğ, ğ yok — '?' çıkıyordu)
async function trFont(lib, bold) {
  const font = await lib.embedFont(await fontBytes(fontFile(defaultFamily(), bold, false)), { subset: true });
  const charset = new Set(font.getCharacterSet());
  const clean = (s) => [...s].filter((ch) => ch === ' ' || charset.has(ch.codePointAt(0))).join('');
  return { font, clean };
}

// Görünen çerçeve (CropBox + /Rotate): görünen koordinatı (sol alt köşe, y yukarı) kullanıcı uzayına çevirir
function viewFrame(page) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const side = rot === 90 || rot === 270;
  const vw = side ? box.height : box.width, vh = side ? box.width : box.height;
  const toUser = (vx, vy) => {
    if (rot === 90) return { x: box.x + box.width - vy, y: box.y + vx };
    if (rot === 180) return { x: box.x + box.width - vx, y: box.y + box.height - vy };
    if (rot === 270) return { x: box.x + vy, y: box.y + box.height - vx };
    return { x: box.x + vx, y: box.y + vy };
  };
  return { vw, vh, rot, toUser };
}

export async function batchWatermark(bytes, text, color) {
  const L = PDFLib();
  const lib = await loadPdfLib(bytes);
  const { rgb, degrees } = L;
  const { font, clean } = await trFont(lib, true);
  const dflt = t('batch.wmDefault');
  const safe = clean(String(text || dflt)) || dflt;
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16) / 255);
  // Yazı tipinin gerçek genişliğiyle ölçülür: uzun filigran metni sayfa kenarından taşmasın
  const unit = font.widthOfTextAtSize(safe, 1) || safe.length * 0.6;
  const c45 = Math.SQRT1_2;
  for (const page of lib.getPages()) {
    const { vw, vh, rot, toUser } = viewFrame(page);
    // 45° döndürülmüş yazının kapladığı kare ≈ (genişlik + yükseklik)·cos45; kısa kenarın %90'ına sığdır
    const fit = (0.9 * Math.min(vw, vh)) / ((unit + 0.7) * c45);
    const size = Math.max(4, Math.min(Math.min(vw, vh) / (safe.length * 0.42), fit));
    // Yazının ortası sayfanın ortasına gelsin
    const hw = (unit * size) / 2, hh = size * 0.35;
    const vx = vw / 2 - (hw - hh) * c45, vy = vh / 2 - (hw + hh) * c45;
    page.drawText(safe, {
      ...toUser(vx, vy), size, font,
      color: rgb(r, g, b), opacity: 0.18, rotate: degrees(rot + 45),
    });
  }
  return savePdfLib(lib);
}

export async function batchNumbers(bytes, format) {
  const L = PDFLib();
  const lib = await loadPdfLib(bytes);
  const { font, clean } = await trFont(lib, false);
  const pages = lib.getPages();
  pages.forEach((page, i) => {
    const { vw, rot, toUser } = viewFrame(page);
    const text = clean(format.replace('{n}', i + 1).replace('{t}', pages.length));
    const w = font.widthOfTextAtSize(text, 10);
    page.drawText(text, { ...toUser((vw - w) / 2, 22), size: 10, font, color: L.rgb(0.2, 0.2, 0.2), rotate: L.degrees(rot) });
  });
  return savePdfLib(lib);
}

async function batchImages(file, folder, dpi, onProgress, check) {
  const { canvasToBlob } = await import('./util.js');
  const src = await openPdfjs(file.bytes);
  const sub = `${folder}\\${baseName(file.name)}`;
  try {
    for (let i = 0; i < src.doc.numPages; i++) {
      check();
      onProgress(i / src.doc.numPages, t('batch.pageProgress', { page: i + 1, total: src.doc.numPages }));
      const page = await src.doc.getPage(i + 1);
      const vp = page.getViewport({ scale: dpi / 72 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvas: c, viewport: vp, background: '#ffffff' }).promise;
      const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
      await window.pu.writeInFolder(sub, `${baseName(file.name)} - ${String(i + 1).padStart(3, '0')}.jpg`, new Uint8Array(await blob.arrayBuffer()));
      c.width = c.height = 0;
    }
  } finally { src.destroy(); }
  return sub;
}

void App; void pageImages;
