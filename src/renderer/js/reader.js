// Sesli okuma (Windows sesleri) ve tam ekran sunum modu.
import { App } from './state.js';
import { $, el, toast, isModalOpen } from './util.js';
import { icon } from './icons.js';
import { t, locale } from './i18n.js';

let speaking = null;

async function pageText(d, i) {
  const tc = await d.textContent(i);
  let s = '';
  for (const it of tc.items) { s += it.str; s += it.hasEOL ? '\n' : ''; }
  return s.replace(/-\n/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

// Arayüz diline uygun ses: önce tam etiket, sonra dil kodu eşleşmesi
const uiLangBase = () => locale().split('-')[0].toLowerCase();
const speechLang = () => ({ tr: 'tr-TR', en: 'en-US', 'zh-Hans': 'zh-CN' }[locale()] || locale());
const voiceMatches = (v) => !!v && v.lang.toLowerCase().replace('_', '-').split('-')[0] === uiLangBase();

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const want = locale().toLowerCase();
  return voices.find((v) => v.lang.toLowerCase().replace('_', '-') === want) || voices.find(voiceMatches) || voices.find((v) => v.default) || voices[0] || null;
}

export async function readAloud(d) {
  if (speaking) { stop(); return; }
  if (!('speechSynthesis' in window)) { toast(t('reader.noSynth'), { type: 'error' }); return; }
  const { pageRange, infoBox, pagesWithText, offerOcr } = await import('./assist.js');
  const { modal, field, el: E } = await import('./util.js');
  const cur = d.currentPageIndex;
  const range = pageRange(d, { label: t('reader.whichPages'), value: `${cur + 1}-${d.numPages}` });
  const scope = E('div', {});
  const res = await modal({
    title: t('reader.title'), width: 520,
    body: E('div', {},
      infoBox('volume-2', null, t('reader.info')),
      range.node, scope),
    buttons: [{ label: t('common.cancel') }, { label: t('reader.start'), primary: true, run: () => { try { range.pages(); return true; } catch (e) { toast(e.message, { type: 'warn' }); return false; } } }],
  });
  if (!res) return;
  const wanted = range.pages();
  const withText = await pagesWithText(d, wanted);
  if (!withText.length) {
    await offerOcr(d, {
      title: t('reader.noTextTitle'),
      reason: t('reader.noTextReason'),
      pages: wanted,
    });
    return;
  }
  const playList = withText;
  if (!speechSynthesis.getVoices().length) await new Promise((r) => { speechSynthesis.onvoiceschanged = r; setTimeout(r, 1200); });
  const voice = pickVoice();
  if (voice && !voiceMatches(voice)) toast(t('reader.noVoice'), { type: 'warn', timeout: 7000 });
  let rate = 1;
  let listIdx = 0;
  let page = playList[0];
  const bar = el('div', { class: 'findbar', style: { top: 'auto', bottom: '14px', right: '50%', transform: 'translateX(50%)' } });
  const label = el('span', { class: 'muted', text: '' });
  const pauseBtn = el('button', { class: 'icon-btn', title: t('reader.pauseResume'), html: icon('volume-2') });
  const stopBtn = el('button', { class: 'icon-btn', title: t('reader.stop'), html: icon('x') });
  const speed = el('input', { type: 'range', min: 0.6, max: 1.8, step: 0.1, value: 1, title: t('reader.speed') });
  bar.append(el('b', { text: t('reader.bar') }), label, pauseBtn, el('span', { class: 'muted', text: t('reader.speed') }), speed, stopBtn);
  $('#docs').append(bar);
  speaking = { bar, cancelled: false };
  pauseBtn.onclick = () => { if (speechSynthesis.paused) speechSynthesis.resume(); else speechSynthesis.pause(); };
  stopBtn.onclick = stop;
  speed.oninput = () => { rate = +speed.value; };
  const run = async () => {
    while (speaking && !speaking.cancelled && listIdx < playList.length) {
      page = playList[listIdx];
      d.goToPage(page);
      label.textContent = t('reader.pageProgress', { page: page + 1, idx: listIdx + 1, total: playList.length });
      const text = await pageText(d, page);
      const chunks = (text.match(/[^.!?…]+[.!?…]*\s*/g) || []).reduce((acc, s) => {
        if (acc.length && (acc[acc.length - 1] + s).length < 220) acc[acc.length - 1] += s; else acc.push(s);
        return acc;
      }, []);
      for (const ch of chunks) {
        if (!speaking || speaking.cancelled) return;
        await new Promise((res) => {
          const u = new SpeechSynthesisUtterance(ch);
          if (voice) u.voice = voice;
          u.lang = voice?.lang || speechLang();
          u.rate = rate;
          u.onend = res; u.onerror = res;
          speechSynthesis.speak(u);
        });
      }
      listIdx++;
    }
    stop();
  };
  run();
}

function stop() {
  if (!speaking) return;
  speaking.cancelled = true;
  speechSynthesis.cancel();
  speaking.bar.remove();
  speaking = null;
}

export async function presentation(d) {
  if (document.body.classList.contains('presenting')) return App.exitPresentation?.();
  const prev = { scale: d.viewer.currentScaleValue, spread: d.viewer.spreadMode, scroll: d.viewer.scrollMode, page: d.viewer.currentPageNumber };
  // Sunumdan önce seçilmiş nesneler sunum sırasında tuşlarla değişmesin
  if (d.selection?.size) d.setSelection([]);
  document.body.classList.add('presenting');
  await window.pu.fullscreen(true);
  await new Promise((r) => setTimeout(r, 250));
  d.viewer.spreadMode = 0;
  d.viewer.scrollMode = 3; // PAGE: tek sayfa
  d.viewer.currentScaleValue = 'page-fit';
  d.viewer.currentPageNumber = prev.page;
  toast(t('reader.presentHint'), { timeout: 2500 });
  const onKey = (e) => {
    if (isModalOpen()) return; // sunum sırasında açılan pencere (ör. Ctrl+P) kendi tuşlarını alsın
    if (e.key === 'Escape' || e.key === 'F5') { e.preventDefault(); e.stopPropagation(); exit(); }
    else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); d.viewer.nextPage(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); d.viewer.previousPage(); }
    // Diğer tüm kısayollar (Ctrl+W, Ctrl+Tab, Delete…) gizli belgelere dokunmasın; yalnızca yazdır serbest
    else if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p')) { e.preventDefault(); e.stopPropagation(); }
  };
  const onClick = (e) => { if (e.button === 0 && !e.target.closest('a')) d.viewer.nextPage(); };
  const onResize = () => { d.viewer.currentScaleValue = 'page-fit'; };
  document.addEventListener('keydown', onKey, true);
  d.container.addEventListener('click', onClick);
  window.addEventListener('resize', onResize);
  async function exit() {
    App.exitPresentation = null;
    document.removeEventListener('keydown', onKey, true);
    d.container.removeEventListener('click', onClick);
    window.removeEventListener('resize', onResize);
    document.body.classList.remove('presenting');
    await window.pu.fullscreen(false);
    if (!d.viewer || !App.docs.includes(d)) return; // belge sunum sırasında kapatıldı
    d.viewer.scrollMode = prev.scroll;
    d.viewer.spreadMode = prev.spread;
    setTimeout(() => { if (App.docs.includes(d)) d.viewer.currentScaleValue = prev.scale; }, 200);
  }
  App.exitPresentation = exit;
  return undefined;
}
