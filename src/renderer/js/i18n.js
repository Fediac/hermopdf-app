// Arayüz dili: sözlükler src/renderer/locales/<kod>.json (düz anahtar → metin).
// Kullanım: t("ribbon.file.open"), t("app.openFailed", { name, error }), t("app.copiedObjs", { count: 3 }).
// Eksik anahtar İngilizceye, o da yoksa anahtarın kendisine düşer. Dil değişince onLang() dinleyicileri çağrılır;
// kalıcı arayüz parçaları (şerit, başlangıç ekranı, durum çubuğu...) kendini yeniden çizer. Yeniden başlatma gerekmez.
// Not: modül düzeyinde t() ÇAĞIRMAYIN (o anki dilde donar); metni çizim anında alın.

export const LANGS = [
  { code: 'en', name: 'English' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh-Hans', name: '简体中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'ar', name: 'العربية', rtl: true },
];
const FALLBACK = 'en';
const isSupported = (c) => LANGS.some((l) => l.code === c);
export const isRtl = (c) => !!LANGS.find((l) => l.code === c && l.rtl);

const dicts = {};
// Yalnızca testler için (eksik anahtar senaryosu): yüklü sözlükler
export const __dicts = dicts;
let current = FALLBACK;
const listeners = new Set();

async function loadDict(code) {
  if (dicts[code]) return dicts[code];
  try {
    const r = await fetch(new URL(`../locales/${code}.json`, import.meta.url));
    dicts[code] = r.ok ? await r.json() : {};
  } catch (e) {
    dicts[code] = {};
  }
  return dicts[code];
}

function format(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

function lookup(code, key, params) {
  const n = params && typeof params.count === 'number' ? params.count : null;
  const cands = [];
  if (n != null) {
    let cat = 'other';
    try { cat = new Intl.PluralRules(code).select(n); } catch (e) { /* yoksay */ }
    cands.push(`${key}_${cat}`, `${key}_other`);
  }
  cands.push(key);
  for (const c of code === FALLBACK ? [code] : [code, FALLBACK]) {
    const d = dicts[c] || {};
    for (const k of cands) if (typeof d[k] === 'string') return d[k];
  }
  return null;
}

// Çeviri. Bulunamazsa İngilizce, o da yoksa anahtar döner.
export function t(key, params) {
  const s = lookup(current, key, params);
  return format(s == null ? key : s, params);
}
// Anahtar mevcut dilde (İngilizceye düşmeden) var mı — testler ve tanılama için
export const has = (key, code = current) => typeof (dicts[code] || {})[key] === 'string';

export const lang = () => current;
// Intl/tarih/sayı biçimleri için BCP 47 etiketi
export const locale = () => current;

function applyRoot() {
  const root = document.documentElement;
  root.lang = current;
  root.dir = isRtl(current) ? 'rtl' : 'ltr';
}

// index.html'deki sabit öğeler: data-i18n (metin), data-i18n-title, data-i18n-placeholder, data-i18n-aria
export function applyDom(root = document) {
  for (const n of root.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of root.querySelectorAll('[data-i18n-title]')) n.title = t(n.dataset.i18nTitle);
  for (const n of root.querySelectorAll('[data-i18n-placeholder]')) n.placeholder = t(n.dataset.i18nPlaceholder);
  for (const n of root.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
}

export function onLang(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Dili değiştir: sözlüğü yükle, <html lang/dir> ve sabit öğeleri güncelle, ana sürece bildir (kalıcı), dinleyicileri çağır.
export async function setLang(code, { persist = true } = {}) {
  if (!isSupported(code)) code = FALLBACK;
  await loadDict(FALLBACK);
  await loadDict(code);
  current = code;
  applyRoot();
  applyDom();
  if (persist) { try { await window.pu.i18n.set(code); } catch (e) { /* yoksay */ } }
  for (const fn of [...listeners]) {
    try { fn(code); } catch (e) { console.error('lang', e); }
  }
  return code;
}

// Açılış: ana süreç dili belirler (kayıtlı seçim > sistem dili > İngilizce; testte Türkçe)
try {
  const boot = await window.pu.i18n.boot();
  current = isSupported(boot?.lang) ? boot.lang : FALLBACK;
} catch (e) {
  current = FALLBACK;
}
await loadDict(FALLBACK);
if (current !== FALLBACK) await loadDict(current);
applyRoot();
