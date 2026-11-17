// HermoPDF Pro: tek seferlik "Lifetime Pro" lisansı.
// Kurallar: ücretsiz sürüm okuma, düzenleme, hedef boyuta küçültme, birleştirme, bölme, imza ve temel
// dönüşümleri kapsar; bunlar kilitlenmez. Pro: OCR (yazı tanıma), toplu işlemler ve kayıtlı iş akışları.
// (12 Kas 2026: OCR ve toplu işlem ürün kararıyla Pro'ya alındı; o tarihte kayıtlı/ödemeli kullanıcı yoktu.
//  Küçültmedeki "tarama modu" sayfayı görüntüye çevirir, OCR DEĞİLDİR; ücretsizdir.)
// Reklam yok, dırdır yok: yükseltme penceresi yalnızca kullanıcı bir düğmeye bastığında açılır
// (açılışta ya da zamanlayıcıyla asla). Satın alma web sitesinde yapılır, uygulama ödeme bilgisi istemez.
// Lisans doğrulaması ana süreçte (src/main/license.js) yapılır; burada yalnızca sonucu kullanırız.
import { App, saveSetting } from './state.js';
import { $, el, modal, confirmBox, toast } from './util.js';
import { icon } from './icons.js';
import { t, onLang, locale } from './i18n.js';

// Pro özellik kaydı. status: 'available' (bu sürümde var) | 'planned' (yolda; pencerede "planlanan" yazar)
export const PRO_FEATURES = [
  {
    id: 'ocr',
    get title() { return t('pro.featOcrTitle'); },
    get desc() { return t('pro.featOcrDesc'); },
    status: 'available',
  },
  {
    id: 'batch',
    get title() { return t('pro.featBatchTitle'); },
    get desc() { return t('pro.featBatchDesc'); },
    status: 'available',
  },
  {
    id: 'workflows',
    get title() { return t('pro.featWorkflowsTitle'); },
    get desc() { return t('pro.featWorkflowsDesc'); },
    status: 'available',
  },
];

let status = { pro: false, state: 'free' };
let langHooked = false;
const listeners = new Set();

export const isPro = () => status.pro === true;
export const licenseStatus = () => ({ ...status });

// Lisans durumu değişince çağrılır: fn(isPro, status). Aboneliği bırakmak için dönen işlevi çağırın.
export function onProChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(s) {
  if (!s || typeof s !== 'object') return;
  const before = status;
  status = s;
  App.license = { ...s };
  updateButton();
  if (before.pro !== s.pro || before.state !== s.state || before.lid !== s.lid) {
    for (const fn of listeners) { try { fn(isPro(), licenseStatus()); } catch (e) { console.error('pro', e); } }
    App.emit('license', licenseStatus());
  }
  if (s.state === 'revoked') revokedNotice();
}

// Bir Pro özelliğinin girişinde kullanın: Pro ise true; değilse o özellik için yükseltme penceresini açar ve false döner.
// YALNIZCA kullanıcının açık bir eylemiyle (tıklama, kısayol) çağrılmalıdır.
export function requirePro(id) {
  if (isPro()) return true;
  openUpgrade(id);
  return false;
}

export async function refreshLicense() {
  try { setStatus(await window.pu.license.status()); } catch (e) { /* yoksay */ }
  return licenseStatus();
}

export function initPro() {
  const tabs = $('#ribbon-tabs');
  if (tabs && !$('#pro-btn')) {
    const b = el('button', { id: 'pro-btn', class: 'pro-btn', html: `${icon('crown')}<span>Pro</span>` });
    b.addEventListener('click', () => (isPro() ? openLicenseDialog() : openUpgrade()));
    // Otomatik kaydet düğmesi aralığı zaten eklediyse ikincisini ekleme (Pro en sağda, sessiz durur)
    if (!tabs.querySelector('.spacer')) tabs.append(el('span', { class: 'spacer' }));
    tabs.append(b);
  }
  updateButton();
  if (!langHooked) { langHooked = true; onLang(() => updateButton()); }
  window.pu.license.onChange((s) => setStatus(s));
  return refreshLicense();
}

function updateButton() {
  const b = $('#pro-btn');
  if (!b) return;
  b.classList.toggle('on', isPro());
  b.title = isPro() ? (status.email ? t('pro.btnActiveEmail', { email: status.email }) : t('pro.btnActive')) : t('pro.btnFree');
}

// ---------------- yükseltme penceresi ----------------
export function openUpgrade(featureId) {
  if (isPro()) return openLicenseDialog();
  const asked = PRO_FEATURES.find((f) => f.id === featureId);
  const available = PRO_FEATURES.filter((f) => f.status === 'available');
  const planned = PRO_FEATURES.filter((f) => f.status === 'planned');
  const item = (f, tag) => el('li', { class: 'pro-feat' },
    el('span', { class: 'pro-feat-ic', html: icon(tag ? 'clock' : 'check') }),
    el('div', {}, el('b', { text: f.title }), tag ? el('span', { class: 'pro-tag', text: tag }) : null, el('div', { class: 'muted', text: f.desc })));
  const body = el('div', { class: 'pro-upgrade' },
    asked ? el('p', { class: 'pro-asked', text: t('pro.askedFeature', { title: asked.title }) }) : null,
    el('p', { class: 'pro-lead', text: t('pro.lead') }),
    el('ul', { class: 'pro-feats' }, available.map((f) => item(f)), planned.map((f) => item(f, t('pro.planned')))),
    el('p', { class: 'pro-free', html: `${icon('badge-check')}<span>${t('pro.freeNote')}</span>` }),
    el('p', { class: 'muted pro-small', text: t('pro.small') }));
  return modal({
    title: 'HermoPDF Pro', width: 500, className: 'pro-modal', body,
    buttons: [
      { label: t('pro.have'), id: 'have', run: () => { setTimeout(() => openActivation(), 0); } },
      { label: t('pro.buy'), id: 'buy', primary: true, run: async () => { await window.pu.openSite('pricing'); toast(t('pro.pricingOpened'), { timeout: 3000 }); } },
    ],
  });
}

// ---------------- etkinleştirme ----------------
const ERROR_KEYS = {
  empty: 'pro.errEmpty',
  format: 'pro.errFormat',
  signature: 'pro.errSignature',
  unknown_key: 'pro.errUnknownKey',
  sandbox_not_allowed: 'pro.errSandbox',
  revoked: 'pro.errRevoked',
  plan: 'pro.errPlan',
  file: 'pro.errFile',
};
export const licenseErrorText = (code) => t(Object.prototype.hasOwnProperty.call(ERROR_KEYS, code) ? ERROR_KEYS[code] : 'pro.errDefault');

function successBody() {
  return el('div', { class: 'pro-success' },
    el('div', { class: 'pro-success-title', text: t('pro.successTitle', { email: status.email || '' }) }),
    el('p', { class: 'muted', text: t('pro.successBody') }));
}

export function openActivation() {
  const input = el('textarea', { class: 'input pro-key', rows: 5, spellcheck: 'false', placeholder: 'UPRO1.…', 'aria-label': t('pro.keyAria') });
  const err = el('div', { class: 'pro-err', role: 'alert', hidden: true });
  const body = el('div', { class: 'pro-activate' },
    el('p', { class: 'modal-msg', text: t('pro.activatePrompt') }),
    input, err);
  let api = null;
  const showErr = (code) => { err.textContent = licenseErrorText(code); err.hidden = false; };
  const succeed = (s) => {
    setStatus(s);
    if (!api) return;
    api.content.replaceChildren(successBody());
    api.foot.replaceChildren(el('button', { class: 'btn primary', text: t('common.ok'), onclick: () => api.close(true) }));
    api.foot.querySelector('button').focus();
  };
  return modal({
    title: t('pro.activateTitle'), width: 520, className: 'pro-modal pro-activate-modal', body,
    onOpen: (a) => { api = a; },
    buttons: [
      {
        label: t('pro.fromFile'), id: 'file', run: async () => {
          err.hidden = true;
          const r = await window.pu.license.importFile();
          if (!r || r.canceled) return false;
          if (r.ok) succeed(r.status); else showErr(r.code);
          return false;
        },
      },
      {
        label: t('pro.activate'), id: 'activate', primary: true, run: async () => {
          err.hidden = true;
          if (!input.value.trim()) { showErr('empty'); return false; }
          const r = await window.pu.license.activate(input.value);
          if (r?.ok) succeed(r.status); else showErr(r?.code);
          return false;
        },
      },
    ],
  });
}

// Pro düğmesi (Pro etkinken) ve Hakkında → "Lisansı yönet"
export function openLicenseDialog() {
  if (status.state === 'free') return openActivation();
  const rows = [];
  if (status.state === 'active') rows.push(successBody());
  else if (status.state === 'revoked') rows.push(el('p', { class: 'modal-msg', text: revokedText() }));
  else rows.push(el('p', { class: 'modal-msg', text: t('pro.invalidWithReason', { reason: licenseErrorText(status.code) }) }));
  if (status.activatedAt) rows.push(el('p', { class: 'muted pro-small', text: status.lid ? t('pro.activatedOnLid', { date: new Date(status.activatedAt).toLocaleDateString(locale()), lid: status.lid }) : t('pro.activatedOn', { date: new Date(status.activatedAt).toLocaleDateString(locale()) }) }));
  const buttons = [
    { label: t('pro.remove'), id: 'remove', danger: true, run: async () => (await removeLicense()) ? undefined : false },
  ];
  if (status.state === 'revoked') buttons.push({ label: t('pro.support'), id: 'support', run: () => { window.pu.openSite('support'); return false; } });
  else if (status.state !== 'active') buttons.push({ label: t('pro.otherKey'), id: 'other', run: () => { setTimeout(() => openActivation(), 0); } });
  buttons.push({ label: t('common.close'), primary: true });
  return modal({ title: t('pro.manageTitle'), width: 520, className: 'pro-modal pro-manage-modal', body: el('div', {}, rows), buttons });
}

export async function removeLicense() {
  const ok = await confirmBox(t('pro.removeConfirm'), { title: t('pro.remove'), ok: t('pro.removeOk'), danger: true });
  if (!ok) return false;
  setStatus(await window.pu.license.remove());
  toast(t('pro.removed'), { timeout: 2500 });
  return true;
}

// ---------------- iptal (iade / ters ibraz) ----------------
const revokedText = () => t('pro.revokedText');

// Aynı lisans için yalnızca bir kez, sakin ve kapatılabilir bir bildirim
function revokedNotice() {
  if (!status.lid || App.settings.revokedNoticeLid === status.lid || $('#pro-revoked-notice')) return;
  import('./update.js').then(({ calmNotice }) => {
    if ($('#pro-revoked-notice')) return;
    calmNotice({
      id: 'pro-revoked-notice', icon: 'info', title: t('pro.revokedTitle'), text: revokedText(),
      actions: [{ label: t('pro.support'), run: () => window.pu.openSite('support') }],
      onClose: () => saveSetting({ revokedNoticeLid: status.lid }),
    });
  });
}

// ---------------- Hakkında penceresindeki lisans bölümü ----------------
export function aboutLicenseSection() {
  const box = el('div', { class: 'about-sec about-license' });
  const render = () => {
    const s = status;
    let line;
    if (s.state === 'active') line = el('div', { class: 'about-line', html: `${icon('crown')}<span></span>` });
    else line = el('div', { class: 'about-line', html: `${icon(s.state === 'free' ? 'badge-check' : 'triangle-alert')}<span></span>` });
    line.querySelector('span').textContent = s.state === 'active' ? t('pro.aboutActive', { email: s.email })
      : s.state === 'revoked' ? t('pro.aboutRevoked')
        : s.state === 'invalid' ? t('pro.aboutInvalid')
          : t('pro.aboutFree');
    const btns = el('div', { class: 'about-btns' });
    if (s.state === 'free') {
      btns.append(el('button', { class: 'btn small', text: t('pro.aboutBtn'), onclick: () => openUpgrade() }),
        el('button', { class: 'btn small', text: t('pro.have'), onclick: () => openActivation() }));
    } else {
      btns.append(el('button', { class: 'btn small', id: 'about-manage', text: t('pro.manage'), onclick: () => openLicenseDialog() }),
        el('button', { class: 'btn small danger', id: 'about-remove', text: t('pro.remove'), onclick: async () => { if (await removeLicense()) render(); } }));
    }
    box.replaceChildren(el('div', { class: 'about-sec-title', text: t('pro.licenseTitle') }), line, btns);
  };
  render();
  const off = onProChange(() => { if (box.isConnected) render(); else off(); });
  return box;
}
