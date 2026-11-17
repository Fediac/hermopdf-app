// İsteğe bağlı "yeni sürüm" bildirimi — arayüz tarafı.
// Varsayılan KAPALI. Başlangıç ekranında tek bir (pencere olmayan) kart bir kez sorar; seçim Hakkında'dan değiştirilir.
// İndirme ve imza doğrulaması ana süreçte (src/main/updates.js) yapılır; arayüz adres vermez.
import { App, saveSetting } from './state.js';
import { $, el, modal, toast } from './util.js';
import { icon } from './icons.js';
import { t, locale } from './i18n.js';

let prefs = { updateCheck: null, available: null, current: '' };
let showCardThisSession = false;

const explain = () => t('update.explain');

export async function initUpdates({ bootHasFiles = false } = {}) {
  try { prefs = await window.pu.update.getPrefs(); } catch (e) { /* yoksay */ }
  // Kart yalnızca bir kez gösterilir (dırdır yok). Uygulama bir dosyayla açıldıysa başlangıç ekranı görünmez:
  // o durumda "gösterildi" sayılmaz, sonraki açılışta sorulur.
  if (prefs.updateCheck === null && !App.settings.updatePromptShownAt) {
    showCardThisSession = true;
    if (!bootHasFiles) saveSetting({ updatePromptShownAt: new Date().toISOString() });
  }
  window.pu.update.onAvailable((info) => showBanner(info));
  if (prefs.available) showBanner(prefs.available);
}

// Başlangıç ekranındaki soru kartı (renderStart her çağrıldığında yeniden oluşturulur)
export function updatePromptCard() {
  if (!showCardThisSession || prefs.updateCheck !== null) return null;
  const answer = async (on) => {
    try { prefs = await window.pu.update.setPrefs({ updateCheck: on }); } catch (e) { toast(t('update.saveFailed', { error: e.message }), { type: 'error' }); return; }
    App.settings.updateCheck = on;
    showCardThisSession = false;
    $('#update-card')?.remove();
    toast(on ? t('update.yesToast') : t('update.noToast'), { type: on ? 'ok' : 'info', timeout: 4000 });
  };
  return el('div', { id: 'update-card', class: 'update-card', role: 'region', 'aria-label': t('update.cardAria') },
    el('span', { class: 'uc-ic', html: icon('bell') }),
    el('div', { class: 'uc-body' },
      el('b', { text: t('update.cardTitle') }),
      el('p', { text: explain() }),
      el('div', { class: 'uc-btns' },
        el('button', { class: 'btn primary small', id: 'uc-yes', text: t('update.yes'), onclick: () => answer(true) }),
        el('button', { class: 'btn small', id: 'uc-no', text: t('update.no'), onclick: () => answer(false) }))));
}

// ---------------- sakin bildirim (pencere değil; kapatılabilir) ----------------
export function calmNotice({ id, icon: ic = 'info', title, text, actions = [], onClose }) {
  let host = $('#notices');
  if (!host) { host = el('div', { id: 'notices' }); document.body.append(host); }
  if (id) $(`#${id}`)?.remove();
  const close = () => { n.remove(); onClose && onClose(); };
  const n = el('div', { id, class: 'notice', role: 'status' },
    el('span', { class: 'notice-ic', html: icon(ic) }),
    el('div', { class: 'notice-body' },
      el('b', { class: 'notice-title', text: title }),
      text ? el('div', { class: 'notice-text', text }) : null,
      actions.length ? el('div', { class: 'notice-btns' }, actions.map((a) => el('button', { class: `btn small ${a.primary ? 'primary' : ''}`, text: a.label, onclick: () => a.run(close) }))) : null),
    el('button', { class: 'icon-btn notice-x', title: t('common.close'), html: icon('x'), onclick: close }));
  host.append(n);
  return n;
}

function showBanner(info) {
  if (!info || !info.version || App.settings.updateDismissed === info.version) return;
  calmNotice({
    id: 'update-banner', icon: 'download', title: t('update.newTitle', { version: info.version }),
    text: t('update.currentVersion', { version: info.current || App.version }),
    actions: [
      { label: t('update.whatsNew'), run: () => showNotes(info) },
      { label: t('update.download'), primary: true, run: () => window.pu.update.openDownload() },
    ],
    onClose: () => saveSetting({ updateDismissed: info.version }),
  });
}

function showNotes(info) {
  const n = info.notes;
  const notes = (n && (n[locale()] || (locale() === 'tr' ? (n.tr || n.en) : (n.en || n.tr)))) || t('update.noNotes');
  return modal({
    title: `HermoPDF ${info.version}${info.date ? ` · ${new Date(`${info.date}T12:00:00`).toLocaleDateString(locale())}` : ''}`,
    width: 520,
    body: el('div', { class: 'update-notes', text: notes }),
    buttons: [{ label: t('common.close') }, { label: t('update.download'), primary: true, run: () => { window.pu.update.openDownload(); } }],
  });
}

// ---------------- Hakkında penceresindeki bölüm ----------------
export function aboutUpdateSection() {
  const chk = el('input', { type: 'checkbox', id: 'about-update-chk' });
  const now = el('button', { class: 'btn small', id: 'about-check-now', html: `${icon('refresh-cw')}<span>${t('update.checkNow')}</span>` });
  const msg = el('div', { class: 'muted about-small', id: 'about-update-msg' });
  const sync = () => {
    chk.checked = prefs.updateCheck === true;
    now.disabled = prefs.updateCheck !== true;
    msg.textContent = prefs.updateCheck === true
      ? (prefs.lastCheck ? t('update.lastCheck', { date: new Date(prefs.lastCheck).toLocaleString(locale()) }) : t('update.notChecked'))
      : t('update.off');
  };
  chk.addEventListener('change', async () => {
    try { prefs = await window.pu.update.setPrefs({ updateCheck: chk.checked }); } catch (e) { toast(t('update.saveFailed', { error: e.message }), { type: 'error' }); }
    App.settings.updateCheck = prefs.updateCheck;
    showCardThisSession = false;
    $('#update-card')?.remove();
    sync();
  });
  now.addEventListener('click', async () => {
    now.disabled = true;
    msg.textContent = t('update.checking');
    let r = null;
    try { r = await window.pu.update.checkNow(); } catch (e) { r = { status: 'error' }; }
    try { prefs = await window.pu.update.getPrefs(); } catch (e) { /* yoksay */ }
    sync();
    if (r?.status === 'available') { App.settings.updateDismissed = null; showBanner(r); msg.textContent = t('update.newAvailable', { version: r.version }); } else if (r?.status === 'latest') msg.textContent = t('update.latest');
    else if (r?.status === 'error') msg.textContent = t('update.checkFailed');
  });
  sync();
  window.pu.update.getPrefs().then((p) => { prefs = p; if (chk.isConnected) sync(); }).catch(() => {});
  return el('div', { class: 'about-sec about-update' },
    el('div', { class: 'about-sec-title', text: t('update.sectionTitle') }),
    el('label', { class: 'chk about-chk' }, chk, el('span', { text: t('update.notifyChk') })),
    el('div', { class: 'muted about-small', text: explain() }),
    el('div', { class: 'about-btns' }, now, msg));
}
