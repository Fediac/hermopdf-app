'use strict';
// Arayüz dilleri (ana süreç + testler). Sözlükler: src/renderer/locales/<kod>.json (düz anahtar → metin).
// Eksik anahtar İngilizceye, o da yoksa anahtarın kendisine düşer. Yer tutucular: {ad}.
// Çoğul: t('anahtar', { count: n }) önce "anahtar_<Intl.PluralRules kategorisi>", sonra "anahtar_other", sonra "anahtar".
const fs = require('fs');
const path = require('path');

const LOCALE_DIR = path.join(__dirname, '..', 'renderer', 'locales');

// Dil adları kendi dilinde (Ayarlar > Dil seçicisinde böyle görünür)
const LANGS = [
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
const CODES = LANGS.map((l) => l.code);
const FALLBACK = 'en';

const isSupported = (code) => CODES.includes(code);
const isRtl = (code) => !!LANGS.find((l) => l.code === code && l.rtl);

// "tr-TR", "pt_PT", "zh-CN", "es-419" gibi sistem dil etiketlerini desteklenen bir koda çevirir; yoksa null.
function matchTag(tag) {
  if (typeof tag !== 'string' || !tag) return null;
  const t = tag.replace(/_/g, '-').toLowerCase();
  const exact = CODES.find((c) => c.toLowerCase() === t);
  if (exact) return exact;
  const base = t.split('-')[0];
  if (base === 'pt') return 'pt-BR';
  if (base === 'zh') return 'zh-Hans';
  return CODES.find((c) => c.toLowerCase() === base) || null;
}
// Sistem dil listesinden ilk desteklenen; hiçbiri yoksa İngilizce
function matchLocale(tags) {
  for (const tag of (Array.isArray(tags) ? tags : [tags])) {
    const m = matchTag(tag);
    if (m) return m;
  }
  return FALLBACK;
}

const cache = new Map();
function loadDict(code) {
  if (!isSupported(code)) return {};
  if (cache.has(code)) return cache.get(code);
  let d = {};
  try { d = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, `${code}.json`), 'utf8')); } catch (e) { d = {}; }
  cache.set(code, d);
  return d;
}

function format(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

function lookup(dicts, code, key, params) {
  const n = params && typeof params.count === 'number' ? params.count : null;
  const cands = [];
  if (n != null) {
    let cat = 'other';
    try { cat = new Intl.PluralRules(code).select(n); } catch (e) { /* yoksay */ }
    cands.push(`${key}_${cat}`, `${key}_other`);
  }
  cands.push(key);
  for (const d of dicts) {
    for (const k of cands) if (typeof d[k] === 'string') return d[k];
  }
  return null;
}

// Bir dil için çevirici: t(anahtar, parametreler)
function createTranslator(code, { dicts } = {}) {
  const lang = isSupported(code) ? code : FALLBACK;
  const own = dicts ? dicts[lang] || {} : loadDict(lang);
  const fb = dicts ? dicts[FALLBACK] || {} : loadDict(FALLBACK);
  const t = (key, params) => {
    const s = lookup(lang === FALLBACK ? [own] : [own, fb], lang, key, params);
    return format(s == null ? key : s, params);
  };
  t.lang = lang;
  return t;
}

module.exports = { LANGS, CODES, FALLBACK, LOCALE_DIR, isSupported, isRtl, matchTag, matchLocale, loadDict, createTranslator, format };
