'use strict';
// HermoPDF'in web adresleri (tek yer). Alan adı henüz alınmadı; adresler yer tutucudur.
// Testte ULTRONIX_SITE_URL / ULTRONIX_API_URL ile yerel bir sahte sunucuya yönlendirilebilir.
// İndirilen her şey ayrıca imzayla doğrulanır; adresi değiştirmek tek başına bir şey kazandırmaz.

const DEFAULT_SITE = 'https://hermopdf.com';
const DEFAULT_API = 'https://api.hermopdf.com';

const isLocalHost = (h) => h === '127.0.0.1' || h === 'localhost' || h === '[::1]';

// Yalnızca https; düz http yalnızca bu bilgisayardaki (test) sunucu için
function cleanBase(value, fallback) {
  if (!value) return fallback;
  try {
    const u = new URL(String(value));
    if (u.username || u.password || u.search || u.hash) return fallback;
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHost(u.hostname))) return fallback;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch (e) {
    return fallback;
  }
}

// Sitenin dil önekleri (website/src/content/languages.json ile aynı); İngilizce kökte.
const SITE_LANG_PATH = { en: '', tr: '/tr', es: '/es', fr: '/fr', de: '/de', 'pt-BR': '/pt-br', ru: '/ru', 'zh-Hans': '/zh', ja: '/ja', ko: '/ko', ar: '/ar' };

// lang verilmezse İngilizce sayfalar. Satın alma sayfası sitede açılır; ödeme sağlayıcısı uygulamaya girmez.
function endpoints(env = process.env, lang = 'en') {
  const prefix = Object.prototype.hasOwnProperty.call(SITE_LANG_PATH, lang) ? SITE_LANG_PATH[lang] : '';
  const tr = lang === 'tr';
  const site = cleanBase(env.ULTRONIX_SITE_URL, DEFAULT_SITE);
  const api = cleanBase(env.ULTRONIX_API_URL, DEFAULT_API);
  return {
    site,
    api,
    updates: `${site}/updates/latest.json`,
    revocations: `${api}/v1/revocations`,
    pricing: `${site}${prefix}${tr ? '/fiyat/' : '/pricing/'}?from=app`,
    support: `${site}${prefix}${tr ? '/destek/' : '/support/'}`,
  };
}

// Dışarıda (tarayıcıda) açılabilecek adres mi? Yalnızca sitemizin kendi adresleri, yalnızca https
// (yerel test sunucusu hariç).
function isSiteUrl(url, env = process.env) {
  try {
    const u = new URL(String(url));
    const site = new URL(endpoints(env).site);
    if (u.username || u.password) return false;
    const hostOk = u.host === site.host || u.host === `www.${site.host}`;
    if (!hostOk) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && site.protocol === 'http:' && isLocalHost(u.hostname);
  } catch (e) {
    return false;
  }
}

module.exports = { endpoints, isSiteUrl, DEFAULT_SITE, DEFAULT_API };
