// Koruma: parola/izinler, parola kaldırma, güvenli karartma, düzleştirme, meta veri, belge özellikleri, form bilgisi.
import { App } from './state.js';
import { el, toast, modal, field, fmtBytes, withProgress, confirmBox, esc } from './util.js';
import { infoBox } from './assist.js';
import { icon } from './icons.js';
import { PDFLib, loadPdfLib, savePdfLib, openPdfjs, removePagesClean } from './pdfcore.js';
import { rasterizePages } from './raster.js';
import { flattenInto } from './flatten.js';
import { t, locale } from './i18n.js';

export async function passwordDialog(d) {
  const pw = el('input', { class: 'input', type: 'password', placeholder: t('protect.openPassword') });
  const pw2 = el('input', { class: 'input', type: 'password', placeholder: t('protect.retypePassword') });
  const owner = el('input', { class: 'input', type: 'password', placeholder: t('protect.ownerPlaceholder') });
  const show = el('input', { type: 'checkbox' });
  show.onchange = () => [pw, pw2, owner].forEach((i) => { i.type = show.checked ? 'text' : 'password'; });
  const perm = (label, on = true) => { const c = el('input', { type: 'checkbox', checked: on }); return { c, row: el('label', { class: 'checkline' }, c, label) }; };
  const pPrint = perm(t('protect.permPrint'));
  const pCopy = perm(t('protect.permCopy'));
  const pModify = perm(t('protect.permModify'));
  const pAnnot = perm(t('protect.permAnnot'));
  const res = await modal({
    title: t('protect.passwordTitle'), width: 500,
    body: el('div', {},
      d.encryption?.userPassword ? el('p', { class: 'muted', text: t('protect.alreadyProtected') }) : null,
      field(t('protect.openPassword'), pw), field(t('protect.passwordAgain'), pw2),
      el('label', { class: 'checkline' }, show, t('protect.showPasswords')),
      el('details', {}, el('summary', { class: 'muted', style: { cursor: 'pointer', margin: '6px 0' }, text: t('protect.advanced') }),
        field(t('protect.ownerPassword'), owner), pPrint.row, pCopy.row, pModify.row, pAnnot.row),
      el('p', { class: 'muted', style: { fontSize: '12px' }, text: t('protect.aesNote') })),
    buttons: [{ label: t('common.cancel') }, { label: t('protect.protect'), primary: true, run: () => {
      if (!pw.value) { toast(t('protect.passwordEmpty'), { type: 'warn' }); return false; }
      if (pw.value !== pw2.value) { toast(t('protect.passwordMismatch'), { type: 'warn' }); return false; }
      return true;
    } }],
  });
  if (!res) return;
  const prev = { enc: d.encryption, fr: d.forceRewrite };
  d.encryption = {
    userPassword: pw.value,
    ownerPassword: owner.value || pw.value,
    permissions: {
      printing: pPrint.c.checked ? 'highResolution' : false,
      copying: pCopy.c.checked,
      modifying: pModify.c.checked,
      annotating: pAnnot.c.checked,
      fillingForms: pAnnot.c.checked,
      contentAccessibility: true,
      documentAssembly: pModify.c.checked,
    },
  };
  d.forceRewrite = true;
  d.markDirty();
  const saved = await d.save({ as: !d.path }).catch((e) => { toast(t('common.saveFailed', { error: e.message }), { type: 'error' }); return false; });
  if (saved) toast(t('protect.protectedSaved'), { type: 'ok', timeout: 5000 });
  else { d.encryption = prev.enc; d.forceRewrite = prev.fr; } // başarısız ya da iptal: sonraki kayıtları bozma
}

export async function removePassword(d) {
  if (!d.encryption && !d.openedPassword) { toast(t('protect.noPassword'), { type: 'info' }); return; }
  if (!(await confirmBox(t('protect.removeBody'), { title: t('protect.removeTitle'), ok: t('protect.remove') }))) return;
  d.encryption = null;
  d.forceRewrite = true;
  d.markDirty();
  const ok = await d.save().catch((e) => { toast(t('common.saveFailed', { error: e.message }), { type: 'error' }); return false; });
  if (ok) toast(t('protect.removed'), { type: 'ok' });
}

// Karartma kutularının altındaki içerik gerçekten silinir: sayfa görüntüye çevrilir, kutuya denk gelen metin atılır.
export async function applyRedactions(d) {
  const map = new Map();
  d.pageObjs.forEach((objs, i) => {
    const r = objs.filter((o) => o.type === 'redact').map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
    if (r.length) map.set(i, r);
  });
  if (!map.size) {
    await modal({
      title: t('protect.markFirstTitle'), width: 520,
      body: el('div', {}, infoBox('square', t('protect.howTitle'), t('protect.howBody'))),
      buttons: [{ label: t('protect.gotIt'), primary: true }],
    });
    return;
  }
  const count = [...map.values()].reduce((a, r) => a + r.length, 0);
  if (!(await confirmBox(t('protect.redactConfirm', { pages: map.size, areas: count }), { title: t('protect.applyRedaction'), ok: t('common.apply'), danger: true }))) return;
  const pages = [...map.keys()].sort((a, b) => a - b);
  await withProgress(t('protect.redacting'), async (p) => {
    // Diğer düzenlemeleri bu sayfalara işle (karartmalar hariç), sonra rasterleştir
    const keep = d.pageObjs;
    const tmp = keep.map((objs, i) => (map.has(i) ? objs.filter((o) => o.type !== 'redact') : []));
    d.pageObjs = tmp;
    let flattened;
    try {
      const lib0 = await loadPdfLib(await d.bakeForms());
      await flattenInto(lib0, d, { pages });
      flattened = await savePdfLib(lib0);
    } finally {
      d.pageObjs = keep;
    }
    const src = await openPdfjs(flattened);
    let rast;
    try {
      rast = await rasterizePages(src.doc, { pages, dpi: 200, quality: 0.85, redactions: map, onProgress: (v, m) => p.set(v * 0.9, m), check: () => p.check() });
    } finally { src.destroy(); }
    const rastBytes = await savePdfLib(rast);
    await d.structural(t('protect.applyRedaction'), async (lib) => {
      const rl = await loadPdfLib(rastBytes);
      const copies = await lib.copyPages(rl, pages.map((_, k) => k));
      pages.forEach((pi, k) => {
        // önce görüntü kopyasını koy, sonra özgün sayfayı form alanlarıyla (değerleri karartılmış olabilir) birlikte sil;
        // özgün sayfaya giden bağlantı/yer imleri kopyaya yönlenir
        lib.insertPage(pi, copies[k]);
        removePagesClean(lib, [pi + 1]);
      });
      return null;
    });
    // bu sayfalardaki tüm nesneler artık görüntünün içinde
    for (const pi of pages) d.pageObjs[pi] = [];
    d.layers.forEach((l, i) => l && import('./overlay.js').then((m) => m.renderLayer(d, i)));
  });
  toast(t('protect.redacted'), { type: 'ok', timeout: 6000 });
}

export async function flattenDialog(d) {
  const forms = el('input', { type: 'checkbox', checked: true });
  const objs = el('input', { type: 'checkbox', checked: true });
  const objCount = d.pageObjs.reduce((a, x) => a + x.length, 0);
  let fieldCount = 0;
  try { fieldCount = Object.keys((await d.pdf.getFieldObjects()) || {}).length; } catch (e) { /* yoksay */ }
  const res = await modal({
    title: t('protect.flatten'), width: 560,
    body: el('div', {},
      infoBox('layers', t('protect.flattenWhatTitle'), t('protect.flattenWhatBody')),
      infoBox('triangle-alert', t('protect.warning'), t('protect.flattenWarn'), { warn: true }),
      el('label', { class: 'checkline' }, forms, fieldCount ? t('protect.flattenFormsCount', { count: fieldCount }) : t('protect.flattenFormsNone')),
      el('label', { class: 'checkline' }, objs, objCount ? t('protect.flattenObjsCount', { count: objCount }) : t('protect.flattenObjsNone'))),
    buttons: [{ label: t('common.cancel') }, { label: t('protect.flatten'), primary: true, value: true }],
  });
  if (!res) return;
  const pages = objs.checked ? d.pageObjs.map((_, i) => i).filter((i) => d.pageObjs[i].length) : [];
  await d.structural(t('protect.flatten'), (lib) => {
    if (forms.checked) {
      try {
        const form = lib.getForm();
        if (form.getFields().length) form.flatten({ updateFieldAppearances: false });
      } catch (e) { console.warn('form düzleştirilemedi', e); }
    }
    return null;
  }, { flattenPages: pages });
  toast(t('protect.flattened'), { type: 'ok', timeout: 6000, action: { label: t('protect.undo'), run: () => d.undo() } });
}

export async function cleanMetadata(d) {
  const meta = await d.pdf.getMetadata().catch(() => ({ info: {} }));
  const info = meta.info || {};
  const rows = [
    [t('protect.fieldTitle'), info.Title], [t('protect.fieldAuthor'), info.Author], [t('protect.fieldSubject'), info.Subject], [t('protect.fieldKeywords'), info.Keywords],
    [t('protect.creatorApp'), info.Creator], [t('protect.producer'), info.Producer],
  ].filter(([, v]) => v && String(v).trim());
  const table = rows.length
    ? el('table', { class: 'info-table' }, rows.map(([k, v]) => el('tr', {}, el('td', { text: k }), el('td', { text: String(v) }))))
    : el('p', { class: 'muted', text: t('protect.nothingToClean') });
  const res = await modal({
    title: t('protect.cleanMeta'), width: 560,
    body: el('div', {},
      infoBox('eye-off', t('protect.metaWhatTitle'), t('protect.metaWhatBody')),
      el('div', { class: 'field-label', text: t('protect.currentInfo') }),
      table),
    buttons: [{ label: t('common.cancel') }, { label: t('protect.clean'), primary: true, value: true }],
  });
  if (!res) return;
  await d.structural(t('protect.cleanMeta'), (lib) => {
    const { PDFName } = PDFLib();
    lib.setTitle(''); lib.setAuthor(''); lib.setSubject(''); lib.setKeywords([]); lib.setCreator(''); lib.setProducer('');
    const inf = lib.context.lookup(lib.context.trailerInfo.Info);
    if (inf && inf.entries) for (const [k] of inf.entries()) inf.delete(k);
    lib.catalog.delete(PDFName.of('Metadata'));
    return null;
  });
  toast(t('protect.metaCleaned'), { type: 'ok' });
}

export async function documentProperties(d) {
  const meta = await d.pdf.getMetadata().catch(() => ({ info: {} }));
  const info = meta.info || {};
  const title = el('input', { class: 'input', value: info.Title || '' });
  const author = el('input', { class: 'input', value: info.Author || '' });
  const subject = el('input', { class: 'input', value: info.Subject || '' });
  const keywords = el('input', { class: 'input', value: info.Keywords || '' });
  const pi = await d.pageInfo(d.currentPageIndex);
  const mm = (v) => Math.round((v / 72) * 25.4);
  const fmtDate = (s) => {
    const { PDFDateString } = window.pdfjsLib;
    const dt = s ? PDFDateString.toDateObject(s) : null;
    return dt ? dt.toLocaleString(locale()) : '-';
  };
  const rows = [
    [t('protect.file'), d.path || d.name], [t('protect.size'), d.fileSize ? fmtBytes(d.fileSize) : '-'], [t('protect.pageCount'), d.numPages],
    [t('protect.currentPageSize'), `${mm(pi.w)} × ${mm(pi.h)} mm`], [t('protect.pdfVersion'), info.PDFFormatVersion || '-'],
    [t('protect.creator'), info.Creator || '-'], [t('protect.producer'), info.Producer || '-'],
    [t('protect.created'), fmtDate(info.CreationDate)], [t('protect.modified'), fmtDate(info.ModDate)],
    [t('protect.encryption'), d.encryption?.userPassword || d.openedPassword ? t('protect.encPassword') : d.encryption ? t('protect.encRestricted') : t('protect.encNone')], [t('protect.formFields'), info.IsAcroFormPresent ? t('protect.present') : t('protect.absent')],
  ];
  const table = el('table', { class: 'info-table' }, rows.map(([k, v]) => el('tr', {}, el('td', { text: k }), el('td', { text: String(v) }))));
  const res = await modal({
    title: t('protect.propsTitle'), width: 560,
    body: el('div', {}, field(t('protect.fieldTitle'), title), el('div', { class: 'row' }, field(t('protect.fieldAuthor'), author), field(t('protect.fieldSubject'), subject)), field(t('protect.fieldKeywords'), keywords), table),
    buttons: [{ label: t('common.close') }, { label: t('protect.updateInfo'), primary: true, value: true }],
  });
  if (!res) return;
  await d.structural(t('protect.docInfo'), (lib) => {
    lib.setTitle(title.value);
    lib.setAuthor(author.value);
    lib.setSubject(subject.value);
    lib.setKeywords(keywords.value.split(/[,;]\s*/).filter(Boolean));
    lib.setModificationDate(new Date());
    return null;
  });
  toast(t('protect.infoUpdated'), { type: 'ok' });
}

export async function formInfo(d) {
  const fields = await d.pdf.getFieldObjects().catch(() => null);
  const names = fields ? Object.keys(fields) : [];
  if (!names.length) {
    await modal({
      title: t('protect.formFields'),
      body: el('div', { html: t('protect.noFormHtml') }),
      buttons: [{ label: t('common.ok'), primary: true }],
    });
    return;
  }
  const list = el('table', { class: 'info-table' }, names.slice(0, 200).map((n) => {
    const f = fields[n][0];
    const typeTr = { text: t('protect.ftText'), checkbox: t('protect.ftCheckbox'), radiobutton: t('protect.ftRadio'), combobox: t('protect.ftList'), listbox: t('protect.ftList'), button: t('protect.ftButton'), signature: t('optbar.nameSignature') }[f.type] || f.type || '-';
    return el('tr', {}, el('td', { text: n }), el('td', { html: `${esc(typeTr)}${f.page != null ? ` · ${t('sidebar.pageShort', { n: f.page + 1 })}` : ''}` }));
  }));
  await modal({
    title: t('protect.formFieldsCount', { count: names.length }), width: 520,
    body: el('div', {}, el('p', { class: 'muted', text: t('protect.formsHelp') }), list),
    buttons: [{ label: t('common.ok'), primary: true }],
  });
}

void App;
