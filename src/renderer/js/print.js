// Yazdırma: sayfalar yüksek çözünürlükte görüntüye çevrilip Windows yazdırma penceresine gönderilir.
import { el, toast, modal, field, select, withProgress, parseRanges, canvasToBlob } from './util.js';
import { openPdfjs } from './pdfcore.js';
import { t } from './i18n.js';

// Yatay görüntüyü saat yönünde 90° döndürür; dikeyse aynen döner
export function portraitCanvas(c) {
  if (c.width <= c.height) return c;
  const r = document.createElement('canvas');
  r.width = c.height; r.height = c.width;
  const ctx = r.getContext('2d');
  ctx.translate(r.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(c, 0, 0);
  return r;
}

export async function printDoc(d) {
  const range = el('input', { class: 'input', value: `1-${d.numPages}` });
  const dpi = select([{ value: 150, label: t('print.dpiNormal') }, { value: 220, label: t('print.dpiHigh') }, { value: 300, label: t('print.dpiHighest') }], 150);
  const cur = el('button', { class: 'btn small', text: t('print.thisPage') });
  cur.onclick = () => { range.value = String(d.currentPageIndex + 1); };
  const res = await modal({
    title: t('print.title'),
    body: el('div', {}, field(t('print.pagesTotal', { total: d.numPages }), range), cur, el('div', { style: { height: '10px' } }), field(t('print.quality'), dpi),
      el('p', { class: 'muted', style: { fontSize: '12px' }, text: t('print.note') })),
    buttons: [{ label: t('common.cancel') }, { label: t('print.continue'), primary: true, value: true }],
  });
  if (!res) return;
  const pages = parseRanges(range.value, d.numPages);
  if (!pages.length) return;
  const data = await withProgress(t('print.preparing'),async (p) => {
    const src = d.hasObjects() || d.formsModified ? await openPdfjs(await d.buildBytes({ encrypt: false })) : { doc: d.pdf, destroy: () => {} };
    const out = [];
    try {
      for (let n = 0; n < pages.length; n++) {
        p.check();
        p.set(n / pages.length, t('print.pageN', { n: pages[n] + 1 }));
        const page = await src.doc.getPage(pages[n] + 1);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: +dpi.value / 72 });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await page.render({ canvas: c, viewport: vp, background: '#ffffff', intent: 'print', annotationMode: 3 }).promise;
        // yatay sayfa dikey kâğıda döndürülerek gönderilir (yoksa ~%70 boyutunda basılıyordu)
        const pc = portraitCanvas(c);
        const turned = pc !== c;
        const blob = await canvasToBlob(pc, 'image/jpeg', 0.92);
        out.push({ bytes: new Uint8Array(await blob.arrayBuffer()), wPt: turned ? vp1.height : vp1.width, hPt: turned ? vp1.width : vp1.height });
        c.width = c.height = 0;
        pc.width = pc.height = 0;
      }
    } finally { src.destroy(); }
    return out;
  });
  const r = await window.pu.printImages(data, d.name);
  if (r && !r.success && r.reason && !/cancel/i.test(r.reason)) toast(t('print.failed', { reason: r.reason }),{ type: 'error' });
}
