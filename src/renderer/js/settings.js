// Ayarlar penceresi: Dil (anında uygulanır, kalıcı), Tema (sistem / açık / koyu), Tanıtım turu.
import { App } from './state.js';
import { el, modal, field, select } from './util.js';
import { icon } from './icons.js';
import { t, LANGS, lang, setLang, onLang } from './i18n.js';

let open = false;

export async function openSettings() {
  if (open) return undefined;
  open = true;
  const body = el('div', { class: 'settings-body' });
  let api = null;
  let startTourAfter = false;

  const render = () => {
    const langSel = select(LANGS.map((l) => ({ value: l.code, label: l.name })), lang());
    langSel.id = 'settings-lang';
    langSel.setAttribute('dir', 'auto');
    langSel.addEventListener('change', () => setLang(langSel.value));

    const cur = App.settings.theme === 'dark' || App.settings.theme === 'light' ? App.settings.theme : 'system';
    const themeSel = select([
      { value: 'system', label: t('settings.theme.system') },
      { value: 'light', label: t('settings.theme.light') },
      { value: 'dark', label: t('settings.theme.dark') },
    ], cur);
    themeSel.id = 'settings-theme';
    themeSel.addEventListener('change', async () => {
      const { setTheme } = await import('./app.js');
      if (themeSel.value === 'system') {
        await window.pu.setTheme('system');
        App.settings.theme = null;
        App.followSystemTheme?.();
      } else setTheme(themeSel.value);
    });

    const tourBtn = el('button', { class: 'btn', id: 'settings-tour', html: `${icon('sparkles')}<span></span>` });
    tourBtn.querySelector('span').textContent = t('settings.tour.button');
    tourBtn.addEventListener('click', () => { startTourAfter = true; api?.close(); });

    body.replaceChildren(
      el('div', { class: 'settings-section' },
        el('h4', { html: `${icon('languages')}<span></span>` }),
        field(t('settings.lang.label'), langSel, t('settings.lang.hint'))),
      el('div', { class: 'settings-section' },
        el('h4', { html: `${icon('moon')}<span></span>` }),
        field(t('settings.theme.label'), themeSel)),
      el('div', { class: 'settings-section' },
        el('h4', { html: `${icon('sparkles')}<span></span>` }),
        el('p', { class: 'muted settings-text', text: t('settings.tour.text') }),
        tourBtn),
    );
    const heads = body.querySelectorAll('h4 span');
    heads[0].textContent = t('settings.lang.section');
    heads[1].textContent = t('settings.theme.section');
    heads[2].textContent = t('settings.tour.section');
    if (api) {
      api.box.querySelector('.modal-head h3').textContent = t('settings.title');
      api.box.querySelector('.modal-head .modal-x').title = t('common.close');
      const fb = api.foot.querySelector('button');
      if (fb) fb.textContent = t('common.close');
    }
  };
  render();
  const off = onLang(() => {
    render();
    body.querySelector('#settings-lang')?.focus();
  });
  try {
    await modal({
      title: t('settings.title'), body, width: 460, className: 'settings-modal',
      buttons: [{ label: t('common.close'), primary: true }],
      onOpen: (a) => { api = a; },
    });
  } finally {
    off();
    open = false;
  }
  if (startTourAfter) {
    const { startTour } = await import('./tour.js');
    startTour();
  }
  return undefined;
}
