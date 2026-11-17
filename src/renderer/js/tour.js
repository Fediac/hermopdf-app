// İlk açılış tanıtım turu: en çok 5 adım, ekranı kaplamayan küçük balon + hedefi saran hafif altın çerçeve.
// Bir kez gösterilir (settings.tourDone); Ayarlar > "Turu yeniden başlat" ile tekrar açılır.
import { App, saveSetting } from './state.js';
import { $, el, toast, isModalOpen } from './util.js';
import { icon } from './icons.js';
import { t, onLang } from './i18n.js';

// Hedefler sırayla denenir; ilk görünen kullanılır (belge açıksa başlangıç ekranı gizlidir)
const steps = () => [
  { id: 'open', icon: 'folder-open', targets: ['#start:not([hidden]) .dropzone', '#ribbon [data-action="file.open"]'], title: t('tour.open.title'), body: t('tour.open.body') },
  { id: 'ribbon', icon: 'layout-grid', targets: ['#ribbon .rgroup[data-group="ribbon.grp.hizliDuzenleme"]', '#ribbon'], title: t('tour.ribbon.title'), body: t('tour.ribbon.body') },
  { id: 'edittext', icon: 'file-pen-line', targets: ['#ribbon [data-tool="edittext"]'], title: t('tour.edit.title'), body: t('tour.edit.body') },
  { id: 'compress', icon: 'shrink', targets: ['#ribbon [data-action="tools.compress"]'], title: t('tour.compress.title'), body: t('tour.compress.body'), badge: t('tour.compress.badge') },
  { id: 'settings', icon: 'settings', targets: ['#settings-btn'], title: t('tour.settings.title'), body: t('tour.settings.body') },
];

let state = null; // { i, ring, pop, offLang, onResize, onKey }

const visible = (n) => {
  if (!n) return false;
  const r = n.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && n.offsetParent !== null;
};
function findTarget(step) {
  for (const sel of step.targets) {
    const n = document.querySelector(sel);
    if (visible(n)) return n;
  }
  return null;
}

export const isTourOpen = () => !!state;

export async function startTour({ auto = false } = {}) {
  if (state) return;
  // Açılışta bir pencere (ör. lisans/güncelleme sorusu) açıksa biraz sonra yeniden dene
  if (auto && isModalOpen()) { setTimeout(() => startTour({ auto }), 1500); return; }
  // Hedefler "Giriş" sekmesinde
  if (App.ribbonTab !== 'home') {
    const { selectTab } = await import('./ribbon.js');
    selectTab('home');
  }
  const ring = el('div', { class: 'tour-ring', 'aria-hidden': 'true' });
  const pop = el('div', { class: 'tour-pop', role: 'dialog', 'aria-live': 'polite' });
  document.body.append(ring, pop);
  state = { i: 0, ring, pop };
  state.onResize = () => place();
  state.onKey = (e) => {
    if (!state || isModalOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); finish(true); }
    else if (e.key === 'ArrowRight' && document.dir !== 'rtl') next();
    else if (e.key === 'ArrowLeft' && document.dir !== 'rtl') back();
  };
  window.addEventListener('resize', state.onResize);
  document.addEventListener('keydown', state.onKey);
  state.offLang = onLang(() => render());
  render();
}

function next() {
  if (!state) return;
  if (state.i >= steps().length - 1) finish(false);
  else { state.i++; render(); }
}
function back() {
  if (!state || state.i === 0) return;
  state.i--;
  render();
}

function render() {
  if (!state) return;
  const all = steps();
  const s = all[state.i];
  const last = state.i === all.length - 1;
  const { pop } = state;
  pop.dataset.step = s.id;
  pop.replaceChildren(
    el('div', { class: 'tour-head' },
      el('span', { class: 'tour-ic', html: icon(s.icon) }),
      el('b', { class: 'tour-title', text: s.title }),
      el('span', { class: 'tour-count', text: t('tour.count', { n: state.i + 1, total: all.length }) })),
    s.badge ? el('div', { class: 'tour-badge', text: s.badge }) : null,
    el('p', { class: 'tour-body', text: s.body }),
    el('div', { class: 'tour-foot' },
      el('button', { class: 'tour-skip', 'data-act': 'skip', text: t('tour.skip'), onclick: () => finish(true) }),
      el('span', { class: 'spacer' }),
      state.i > 0 ? el('button', { class: 'btn small', 'data-act': 'back', text: t('tour.back'), onclick: back }) : null,
      el('button', { class: 'btn small primary', 'data-act': 'next', text: last ? t('tour.done') : t('tour.next'), onclick: next })),
    el('div', { class: 'tour-dots' }, all.map((x, k) => el('span', { class: k === state.i ? 'on' : '' }))),
  );
  place();
  pop.querySelector('[data-act="next"]').focus({ preventScroll: true });
}

function place() {
  if (!state) return;
  const { ring, pop } = state;
  const target = findTarget(steps()[state.i]);
  const vw = innerWidth;
  const vh = innerHeight;
  pop.classList.remove('above', 'below', 'center');
  if (!target) {
    ring.hidden = true;
    pop.classList.add('center');
    pop.style.left = `${Math.max(16, (vw - pop.offsetWidth) / 2)}px`;
    pop.style.top = `${Math.max(16, (vh - pop.offsetHeight) / 2)}px`;
    return;
  }
  target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const r = target.getBoundingClientRect();
  const pad = 5;
  ring.hidden = false;
  Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const gap = 14;
  let top = r.bottom + gap;
  let side = 'below';
  if (top + ph > vh - 12) { top = r.top - gap - ph; side = 'above'; }
  if (top < 12) { top = Math.min(vh - ph - 12, Math.max(12, r.bottom + gap)); side = 'below'; }
  const cx = r.left + r.width / 2;
  const left = Math.min(vw - pw - 12, Math.max(12, cx - pw / 2));
  pop.classList.add(side);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.setProperty('--arrow-x', `${Math.min(pw - 18, Math.max(18, cx - left))}px`);
}

function finish(skipped) {
  if (!state) return;
  const s = state;
  state = null;
  window.removeEventListener('resize', s.onResize);
  document.removeEventListener('keydown', s.onKey);
  s.offLang?.();
  s.ring.remove();
  s.pop.remove();
  saveSetting({ tourDone: true });
  toast(t('tour.hint'), { timeout: 8000, type: skipped ? 'info' : 'ok' });
  $('#docs')?.querySelector('.doc-view:not(.hidden) .viewer-container')?.focus?.({ preventScroll: true });
}
