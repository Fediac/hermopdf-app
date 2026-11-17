// Ortak yardımcılar: sayfa aralığı seçici, metin katmanı kontrolü ve OCR yönlendirmesi.
import { App } from './state.js';
import { el, parseRanges, rangesToText, toast, modal, confirmBox } from './util.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { isPro, openUpgrade } from './pro.js';

/**
 * Sayfa aralığı alanı: metin kutusu + hızlı düğmeler + canlı "kaç sayfa seçildi" bilgisi.
 * api: { node, value(), pages(), set(text) }
 */
export function pageRange(doc, { label = t('assist.pages'), value = null, hint = null, showCurrent = true } = {}) {
  const total = doc.numPages;
  const input = el('input', { class: 'input', value: value != null ? value : `1-${total}`, placeholder: t('assist.rangePlaceholder', { total }) });
  const info = el('span', { class: 'range-info' });
  const quick = el('div', { class: 'range-quick' });
  const setVal = (v) => { input.value = v; update(); };
  const btn = (text, fn, title) => {
    const b = el('button', { class: 'chip', text, title: title || '' });
    b.onclick = (e) => { e.preventDefault(); fn(); };
    return b;
  };
  const all = () => Array.from({ length: total }, (_, k) => k);
  quick.append(...[
    btn(t('assist.all'), () => setVal(`1-${total}`), t('assist.allTitle')),
    showCurrent ? btn(t('assist.thisPage'), () => setVal(String(doc.currentPageIndex + 1)), t('assist.thisPageTitle')) : null,
    btn(t('assist.odd'), () => setVal(rangesToText(all().filter((k) => k % 2 === 0))), '1, 3, 5…'),
    btn(t('assist.even'), () => setVal(rangesToText(all().filter((k) => k % 2 === 1))), '2, 4, 6…'),
    doc.pageSel?.size ? btn(t('assist.selected', { n: doc.pageSel.size }), () => setVal(rangesToText([...doc.pageSel])), t('assist.selectedTitle')) : null,
  ].filter(Boolean));
  function update() {
    try {
      const p = parseRanges(input.value, total);
      info.textContent = p.length ? t('assist.nSelected', { count: p.length }) : t('assist.noneSelected');
      info.classList.toggle('bad', !p.length);
    } catch (e) {
      info.textContent = e.message;
      info.classList.add('bad');
    }
  }
  input.addEventListener('input', update);
  update();
  const node = el('label', { class: 'field' },
    el('span', { class: 'field-label' }, `${label} `, el('span', { class: 'muted', text: t('assist.docHas', { count: total }) })),
    input, quick,
    el('span', { class: 'field-hint' }, hint || t('assist.rangeHint'), info));
  return {
    node,
    input,
    value: () => input.value,
    set: setVal,
    pages: () => {
      const p = parseRanges(input.value, total);
      if (!p.length) throw Object.assign(new Error(t('assist.noPagesChosen')), { userError: true });
      return p;
    },
  };
}

// Verilen sayfalarda seçilebilir metin var mı?
export async function pagesWithText(doc, pages) {
  const out = [];
  for (const i of pages) {
    try {
      const tc = await doc.textContent(i);
      const chars = tc.items.reduce((a, it) => a + (it.str || '').trim().length, 0);
      if (chars > 20) out.push(i);
    } catch (e) { /* yoksay */ }
  }
  return out;
}

export async function hasTextLayer(doc, page) {
  return (await pagesWithText(doc, [page])).length > 0;
}

/**
 * "Bu sayfada yazı yok" durumunda kullanıcıyı OCR'a yönlendirir.
 * reason: neden gerektiğini anlatan kısa cümle.
 * OCR Pro özelliğidir: ücretsiz kullanıcıya yalnızca bilgi + "Pro hakkında" bağlantısı gösterilir
 * (yükseltme penceresi kendiliğinden açılmaz; ancak kullanıcı o düğmeye basarsa açılır). Dönüş: OCR yapıldıysa true.
 */
export async function offerOcr(doc, { reason, pages = null, title = t('assist.noTextTitle') } = {}) {
  const pro = isPro();
  const body = el('div', {},
    el('p', { class: 'modal-msg' }, reason),
    el('div', { class: 'info-box' }, el('span', { class: 'ib-ic', html: icon('scan-text') }), el('div', {},
      el('b', { text: t('assist.ocrWhatTitle') }),
      el('div', { class: 'muted', text: t('assist.ocrWhatBody') }))),
    pro ? null : el('div', { class: 'wf-pro-note ocr-pro-note' },
      el('span', { class: 'wf-pro-ic', html: icon('crown') }),
      el('div', {}, el('b', { text: t('assist.ocrProTitle') }), el('div', { class: 'muted', text: t('assist.ocrProBody') }))),
  );
  const r = await modal({
    title, width: 540, body,
    buttons: pro
      ? [{ label: t('assist.notNow') }, { label: t('assist.doOcr'), primary: true, value: 'ocr' }]
      : [{ label: t('assist.notNow'), primary: true }, { label: t('pro.aboutBtn'), id: 'pro', value: 'pro' }],
  });
  if (r === 'pro') { setTimeout(() => openUpgrade('ocr'), 0); return false; }
  if (r !== 'ocr') return false;
  const m = await import('./ocr.js');
  await m.ocrDialog(doc, null, { pages });
  return true;
}

// Belge tamamen taranmış mı (hiç metin yok)?
export async function isScanned(doc) {
  const sample = [0, Math.floor(doc.numPages / 2), doc.numPages - 1].filter((v, k, a) => a.indexOf(v) === k && v >= 0 && v < doc.numPages);
  const withText = await pagesWithText(doc, sample);
  return withText.length === 0;
}

// Modal içinde kullanılan bilgi kutusu
export function infoBox(iconName, title, text, { warn = false } = {}) {
  return el('div', { class: `info-box ${warn ? 'warn' : ''}` },
    el('span', { class: 'ib-ic', html: icon(iconName) }),
    el('div', { class: 'ib-body' }, title ? el('b', { text: title }) : null, el('div', { class: 'muted', text })));
}

export { toast, confirmBox, App };
