#!/usr/bin/env node
// HermoPDF web sitesi derleyicisi. Bağımlılık yok (yalnız Node 18+).
//   node build.mjs          → üretim derlemesi (dist/). Demo modu kodu tamamen silinir.
//   node build.mjs --dev    → geliştirme derlemesi: ?demo=1 yerel sunucuyla (127.0.0.1:8787) çalışır.
// Diller: src/content/languages.json. Varsayılan İngilizce (kök /), diğerleri önekli (/tr/, /es/ ...). Her dil için
// ayrı statik sayfa üretilir; içeriği çevrilmemiş sayfa İngilizce gösterilir (üstte not, noindex, canonical → İngilizce).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const DEV = process.argv.includes('--dev');

// Windows (CRLF) satir sonlarini LF yap: tarayici satir ici stil/betik karmasini LF uzerinden hesaplar.
const rd = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
const readJson = (p) => JSON.parse(rd(p));
// --config <dosya>: deneme için başka bir yapılandırma (ör. checkoutEnabled:true ile CSP testi). Varsayılan src/config/site.json.
const ci = process.argv.indexOf('--config');
const cfg = readJson(ci > -1 ? path.resolve(process.argv[ci + 1]) : path.join(SRC, 'config', 'site.json'));
const { pages } = readJson(path.join(SRC, 'pages.json'));
const langCfg = readJson(path.join(SRC, 'content', 'languages.json'));
const LANGS = langCfg.languages.map((l) => l.code);
const DEF = langCfg.default;
const L = Object.fromEntries(langCfg.languages.map((l) => [l.code, l]));
const numbersFile = path.join(SRC, 'content', 'demo-numbers.json');
const numbers = fs.existsSync(numbersFile) ? readJson(numbersFile) : { cases: [] };
// Ana sayfa küçültme hareketli görseli (tools/compress-demo.mjs): her dilde gerçek uygulama kaydı + ölçülen boyutlar.
const demoFile = path.join(SRC, 'content', 'demo-compress.json');
const demoData = fs.existsSync(demoFile) ? readJson(demoFile) : { langs: {} };
const SITE = cfg.siteUrl.replace(/\/$/, '');
const errors = [];
const warn = [];

// Metinler: her dil kendi dosyası; eksik anahtar İngilizceye düşer (uyarı verilir).
const strings = {};
for (const code of LANGS) {
  const f = path.join(SRC, 'content', 'strings', `${code}.json`);
  const own = fs.existsSync(f) ? readJson(f) : {};
  if (!fs.existsSync(f)) warn.push(`metin dosyası yok: content/strings/${code}.json (İngilizce kullanıldı)`);
  delete own._note;
  strings[code] = own;
}
const base = strings[DEF];
for (const code of LANGS) {
  if (code === DEF) continue;
  const miss = Object.keys(base).filter((k) => !(k in strings[code]) && k !== '_note' && !(code === 'tr' && k === 'uiNoteHtml'));
  if (miss.length) warn.push(`${code}: ${miss.length} metin anahtarı eksik, İngilizce kullanıldı (${miss.slice(0, 5).join(', ')}${miss.length > 5 ? '…' : ''})`);
  strings[code] = { ...base, ...strings[code] };
}
// Uygulama arayüzü yalnız Türkçe: Türkçe dışındaki her dilde üstte not gösterilir.
const uiNoteFor = (lang) => (lang === 'tr' ? '' : strings[lang].uiNoteHtml || '');
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// ---------- yardımcılar ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sha256b64 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
const shortHash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const hasPlaceholder = (v) => /PLACEHOLDER/i.test(JSON.stringify(v));
// Arama anahtarı: küçük harf, aksansız ("turkce" → Türkçe bulunur).
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function write(rel, content) {
  const f = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
function copyDir(from, to, filter = () => true) {
  if (!fs.existsSync(from)) return;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b, filter);
    else if (filter(a)) { fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(a, b); }
  }
}
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const nf = (lang, opts) => new Intl.NumberFormat(L[lang].num, opts);
const num = (v, lang) => nf(lang, { maximumFractionDigits: 2 }).format(v);
function fmtBytes(n, lang) {
  if (n >= 1048576) return `${nf(lang, { maximumFractionDigits: 2 }).format(n / 1048576)} MB`;
  return `${nf(lang, { maximumFractionDigits: 0 }).format(Math.round(n / 1024))} KB`;
}
const pct = (v, lang) => nf(lang, { style: 'percent', maximumFractionDigits: 0 }).format(v);
const prefix = (lang) => (L[lang].path ? `/${L[lang].path}` : '');
const pageUrl = (id, lang) => {
  const p = pages[id];
  if (!p) { errors.push(`bilinmeyen sayfa kimliği: ${id}`); return '/'; }
  return prefix(lang) + (lang === 'tr' ? p.tr : p.en);
};
const abs = (p) => SITE + p;

// ---------- girdiler ----------
const partialCache = {};
function partial(name) {
  if (!(name in partialCache)) {
    const f = path.join(SRC, 'partials', `${name}.html`);
    if (!fs.existsSync(f)) { errors.push(`parça yok: ${name}`); return ''; }
    partialCache[name] = rd(f).trim();
  }
  return partialCache[name];
}
const css = rd(path.join(SRC, 'css', 'site.css'))
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
// Satır içi tek betik (CSP özetiyle izinli, her sayfada aynı): JS sınıfı + elle seçilmiş tema (ilk boyamadan önce,
// yanıp sönme olmasın) + kayıtlı dil tercihi: dışarıdan gelinen sayfanın o dilde çevirisi varsa ilk boyamadan önce oraya geçilir.
// <head>'de hreflang bağlantılarından SONRA durur.
const jsClassScript = "(function(d){d.classList.add('js');try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);var p=localStorage.getItem('lang'),r=document.referrer;if(p&&p!==d.lang&&!(r&&r.indexOf(location.origin+'/')===0)){var l=document.querySelector('link[rel=\"alternate\"][hreflang=\"'+p+'\"]');if(l){var u=l.getAttribute('href').replace(/^https?:\\/\\/[^\\/]+/,'');if(u!==location.pathname)location.replace(u+location.search+location.hash)}}}catch(e){}})(document.documentElement)";

// JS dosyaları: üretimde demo blokları silinir, adlara içerik özeti eklenir (önbellek kırma).
const jsOut = {};
for (const f of fs.readdirSync(path.join(SRC, 'js'))) {
  let code = rd(path.join(SRC, 'js', f));
  if (!DEV) code = code.replace(/\/\*DEMO-START\*\/[\s\S]*?\/\*DEMO-END\*\//g, '');
  if (!DEV && /demoAllowed|devApiBase/.test(code)) errors.push(`${f}: üretim derlemesinde demo kodu kaldı`);
  const name = f.replace(/\.js$/, '');
  jsOut[name] = { code, src: `/js/${f}?v=${shortHash(code)}` };
}

// Dil önerisi metinleri (yalnız tarayıcı dili sayfanın dilinden farklıysa, sayfa yüklendikten sonra çekilir).
const suggestJson = JSON.stringify(Object.fromEntries(LANGS.map((c) => [c, {
  text: strings[c].suggestText, go: strings[c].suggestSwitch, stay: strings[c].suggestStay, dir: L[c].dir,
}])));
const suggestSrc = `/i18n/suggest.json?v=${shortHash(suggestJson)}`;

// ---------- şablon motoru ----------
// Ekran görüntüleri dile göre: img/shots/<ad>.<dil>.png → (Türkçe dışı diller için) <ad>.en.png → <ad>.png.
// <ad>.png bugün Türkçe arayüzlü görüntüdür (uygulamada henüz İngilizce arayüz yok).
const phFile = path.join(SRC, 'img', 'shots', '.placeholders.json');
const placeholders = new Set(fs.existsSync(phFile) ? readJson(phFile) : []);
function shotFile(name, lang) {
  const cands = [`${name}.${lang}`, ...(lang === 'tr' || lang === 'en' ? [] : [`${name}.en`]), name];
  for (const c of cands) if (fs.existsSync(path.join(SRC, 'img', 'shots', `${c}.png`))) return c;
  return null;
}
// {{shot:geniş>yakın|alt|alt yazı}}: telefonda (≤640 px) "yakın" kırpım gösterilir, yazılar okunur kalsın.
function shot(spec, ctx) {
  const [names, alt = '', caption = ''] = spec.split('|').map((s) => s.trim());
  const [name, mobile] = names.split('>').map((s) => s.trim());
  if (mobile) {
    const html = shot([name, alt, caption].join('|'), ctx);
    const mn = shotFile(mobile, ctx.lang);
    if (!mn) { warn.push(`ekran görüntüsü yok: img/shots/${mobile}.png`); return html; }
    const ms = pngSize(path.join(SRC, 'img', 'shots', `${mn}.png`)) || { w: 1080, h: 720 };
    return html.replace(/<img [^>]*>/, (img) => `<picture><source media="(max-width: 640px)" srcset="/img/shots/${mn}.png" width="${ms.w}" height="${ms.h}">${img}</picture>`);
  }
  if (!alt) errors.push(`ekran görüntüsü için alt metin yok: ${name}`);
  const cap = caption ? `<figcaption>${caption}</figcaption>` : '';
  const fn = shotFile(name, ctx.lang);
  if (!fn) {
    warn.push(`ekran görüntüsü yok: img/shots/${name}.png`);
    return `<figure class="shot"><div class="shot-ph" role="img" aria-label="${esc(alt)}">${esc(strings[ctx.clang].shotPending)}<br>${esc(alt)}</div>${cap}</figure>`;
  }
  if (placeholders.has(name)) warn.push(`ekran görüntüsü hâlâ yer tutucu: img/shots/${name}.png (tools/shots.mjs ile al)`);
  const sz = pngSize(path.join(SRC, 'img', 'shots', `${fn}.png`)) || { w: 1400, h: 900 };
  return `<figure class="shot"><img src="/img/shots/${fn}.png" width="${sz.w}" height="${sz.h}" loading="lazy" decoding="async" alt="${esc(alt)}">${cap}</figure>`;
}

// {{demo:ad|<shot etiketi gövdesi>}}: static/demo/<ad>.<dil>.mp4 + .webp (poster) varsa, o dilde uygulamanın gerçek
// kaydı olan sessiz döngü videosu (js/demo.js oynatır: görünürken, hareket azaltılmamışsa, "Hareketi durdur" ile durur).
// JS yoksa / hareket azaltılmışsa yalnız poster (sonuç ekranı) görünür. Dosya yoksa eski ekran görüntüsüne ({{shot:...}}) düşer.
function demo(spec, ctx) {
  const i = spec.indexOf('|');
  const name = spec.slice(0, i < 0 ? spec.length : i).trim();
  const fallback = i < 0 ? '' : spec.slice(i + 1);
  const base = `${name}.${ctx.lang}`;
  const d = demoData.langs && demoData.langs[ctx.lang];
  const dir = path.join(SRC, 'static', 'demo');
  if (!d || !fs.existsSync(path.join(dir, `${base}.mp4`)) || !fs.existsSync(path.join(dir, `${base}.webp`))) {
    warn.push(`hareketli görsel yok: static/demo/${base}.mp4 (tools/compress-demo.mjs ${ctx.lang})`);
    return fallback ? shot(fallback, ctx) : '';
  }
  const s = strings[ctx.lang];
  for (const k of ['demoCompressAlt', 'demoCompressCaption', 'skyMotion']) if (!s[k]) errors.push(`${ctx.where}: çeviri yok: ${k}`);
  const alt = fill(s.demoCompressAlt, { before: fmtBytes(d.beforeBytes, ctx.lang), after: fmtBytes(d.afterBytes, ctx.lang), target: `${num(demoData.targetMB, ctx.lang)} MB` });
  const v = `?v=${shortHash(fs.readFileSync(path.join(dir, `${base}.mp4`)))}`;
  const wh = `width="${d.width}" height="${d.height}"`;
  return `<figure class="shot demo" data-demo><div class="demo-frame">` +
    `<img class="demo-poster" src="/demo/${base}.webp${v}" ${wh} loading="lazy" decoding="async" alt="${esc(alt)}">` +
    `<video class="demo-video" data-src="/demo/${base}.mp4${v}" ${wh} muted loop playsinline disablepictureinpicture preload="none" aria-hidden="true" tabindex="-1"></video>` +
    `<button type="button" class="demo-toggle" aria-pressed="false" hidden><svg class="i-pause" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg><svg class="i-play" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4.5 2.5v11l9-5.5z" fill="currentColor"/></svg><span>${esc(s.skyMotion)}</span></button>` +
    `</div><figcaption>${esc(s.demoCompressCaption)}</figcaption></figure>`;
}

const caseLabel = (c, lang) => (c.label && (c.label[lang] || c.label.en)) || '';
function numbersBlock(lang) {
  const s = strings[lang];
  const c = (numbers.cases || [])[0];
  if (!c || !c.beforeBytes || !c.afterBytes) {
    return DEV ? `<div class="note"><p>${esc(s.numbersPending)}</p></div>` : '';
  }
  const label = caseLabel(c, lang);
  const pctTxt = fill(s.sdSmaller, { pct: pct(1 - c.afterBytes / c.beforeBytes, lang) });
  const target = c.targetBytes ? `<p class="small muted">${esc(s.numbersTarget)}: ${c.targetMB ? `${num(c.targetMB, lang)} MB` : fmtBytes(c.targetBytes, lang)}${c.seconds ? ` · ${num(c.seconds, lang)} ${s.seconds}` : ''}</p>` : '';
  return `<div class="card"><h3>${esc(s.numbersTitle)}</h3>${label ? `<p class="muted">${esc(label)}${c.pages ? ` · ${c.pages} ${s.pages}` : ''}</p>` : ''}
<div class="ba"><div class="box"><small>${esc(s.numbersBefore)}</small><b>${fmtBytes(c.beforeBytes, lang)}</b></div><div class="arrow" aria-hidden="true">→</div><div class="box after"><small>${esc(s.numbersAfter)}</small><b>${fmtBytes(c.afterBytes, lang)}</b><small>${esc(pctTxt)}</small></div></div>
${target}<p class="small muted">${esc(s.numbersNote)}</p></div>`;
}

// Ana sayfa kanca kartı: hedef boyuta küçültme. Ölçüm varsa (tools/shots.mjs) gerçek sayılar,
// yoksa açıkça "temsilî" diye etiketlenmiş bir çizim. Sayı uydurulmaz.
const LEVEL_KEY = { 'Hafif': 'sdLight', 'Orta (önerilen)': 'sdMedium', 'Orta': 'sdMedium', 'Güçlü': 'sdStrong', 'Çok güçlü': 'sdVeryStrong' };
function sizeDemo(lang) {
  const s = strings[lang];
  const c = (numbers.cases || [])[0];
  const real = c && c.beforeBytes && c.afterBytes && c.reachedTarget;
  const chips = `<p class="sd-chips"><span>1 MB</span> <span>2 MB</span> <span>5 MB</span> <span>${esc(s.sdEmail)}</span> <span>${pct(0.5, lang)}</span></p>`;
  const bar = `<div class="sd-bar" aria-hidden="true"><i></i><i></i><i></i><span>${esc(s.sdCompress)}</span></div>`;
  const alert = `<p class="sd-alert"><span class="sd-x" aria-hidden="true">!</span>${esc(s.sdAlert)}</p>`;
  const mascot = `<div class="sd-mascot">${partial('mascot')}</div>`;
  if (real) {
    const lvl = c.level ? (LEVEL_KEY[c.level] ? s[LEVEL_KEY[c.level]] : c.level) : '';
    const tgt = c.targetMB ? num(c.targetMB, lang) : num(Math.round(c.targetBytes / 104857.6) / 10, lang);
    const firstTry = c.level === 'Hafif';
    const how = `${esc(firstTry ? s.sdFirstTry : fill(s.sdLevelSetting, { level: lvl }))}${c.seconds ? `<span class="nowrap"> · ${num(c.seconds, lang)} ${esc(s.seconds)}</span>` : ''}`;
    const doc = c.pages ? fill(s.sdDoc, { n: c.pages }) : caseLabel(c, lang);
    return `<figure class="sizedemo">${alert}<div class="sd-win">${bar}<div class="sd-body">
<p class="sd-row"><span>${esc(s.sdCurrent)}</span><b>${fmtBytes(c.beforeBytes, lang)}</b></p>
<p class="sd-row"><span>${esc(s.sdTarget)}</span><span class="sd-input">${tgt}<span class="sd-caret" aria-hidden="true"></span></span></p>
${chips}
<div class="sd-result"><div><small>${esc(s.sdBefore)}</small><b>${fmtBytes(c.beforeBytes, lang)}</b></div><span class="sd-arrow" aria-hidden="true">→</span><div class="sd-after"><small>${esc(s.sdAfter)}</small><b>${fmtBytes(c.afterBytes, lang)}</b><small>${esc(fill(s.sdSmaller, { pct: pct(1 - c.afterBytes / c.beforeBytes, lang) }))}</small></div></div>
<p class="sd-ok"><span aria-hidden="true">✓</span> ${esc(s.sdUnder)} ${how}</p>
</div></div>${mascot}
<figcaption>${s.sdCaptionHtml} <span class="muted">${esc(fill(s.sdRealNote, { doc }))}</span></figcaption></figure>`;
  }
  const steps = [[s.sdLight, s.sdStillBig], [s.sdMedium, s.sdStillBig], [s.sdStrong, s.sdHit], [s.sdVeryStrong, s.sdNotNeeded]];
  return `<figure class="sizedemo">${alert}<div class="sd-win">${bar}<div class="sd-body">
<p class="sd-row"><span>${esc(s.sdTarget)}</span><span class="sd-input">1<span class="sd-caret" aria-hidden="true"></span></span></p>
${chips}
<ol class="sd-steps">${steps.map(([a, b], i) => `<li class="sd-s${i + 1}${i === 2 ? ' hit' : i === 3 ? ' skip' : ''}"><span>${esc(a)}</span><em>${esc(b)}</em></li>`).join('')}</ol>
</div></div>${mascot}
<figcaption>${s.sdIllusHtml} <span class="muted">${esc(s.sdIllus)}</span></figcaption></figure>`;
}

// Ana sayfa "İndir" düğmesi: yayında doğrudan kurulum dosyası (tıklayınca indirme hemen başlar, sayfa kalır).
// Yer tutucu varken boş; düğme o zaman eskisi gibi indirme sayfasına gider.
function directDownload() {
  const r = cfg.release;
  if (hasPlaceholder({ u: r.downloadUrl, f: r.fileName })) return '';
  if (/\.(exe|msi)$/i.test(r.downloadUrl)) return r.downloadUrl;
  // Sürüme sabit adres: dosya adı sürüm içerir, "latest/download/<ad>" yeni sürümde 404 verirdi.
  const m = r.downloadUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\/latest\/?$/);
  if (m) return `${m[1]}/releases/download/v${encodeURIComponent(r.version)}/${encodeURIComponent(r.fileName)}`;
  return '';
}

// Dil seçici: dil adları kendi dillerinde; arama, sayfanın dilindeki ve İngilizce adlarla da çalışır.
const enNames = new Intl.DisplayNames(['en'], { type: 'language' });
function langItems(ctx, cls) {
  const target = ctx.id === '404' ? 'home' : ctx.id;
  const here = new Intl.DisplayNames([ctx.lang], { type: 'language' });
  return LANGS.map((code) => {
    const l = L[code];
    const local = here.of(code);
    const keys = norm([l.native, l.short, local, enNames.of(code), code].join(' '));
    const cur = code === ctx.lang ? ' aria-current="true"' : '';
    const sub = cls === 'menu' && norm(local) !== norm(l.native) ? `<span class="ln-l" lang="${ctx.lang}" dir="${L[ctx.lang].dir}">${esc(local)}</span>` : '';
    return `<li><a href="${pageUrl(target, code)}" hreflang="${code}" lang="${code}" data-lang="${code}"${cls === 'menu' ? ` data-k="${esc(keys)}"` : ''}${cur}><span class="ln-n" dir="${l.dir}">${esc(l.native)}</span>${sub}</a></li>`;
  }).join('');
}
const GLOBE = '<svg class="i-globe" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9M12 3C9.4 5.8 8.1 8.8 8.1 12s1.3 6.2 3.9 9"/></g></svg>';
function langMenu(ctx) {
  const s = strings[ctx.lang], l = L[ctx.lang];
  return `<div class="lang-menu"><details><summary class="lang-btn" title="${esc(s.langLabel)}">${GLOBE}<span class="sr">${esc(s.langLabel)}: </span><span class="lang-cur" lang="${ctx.lang}">${esc(l.short)}</span><span class="lang-code" aria-hidden="true">${esc(ctx.lang.split('-')[0].toUpperCase())}</span><svg class="i-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
<div class="lang-pop"><input class="lang-q" type="search" placeholder="${esc(s.langSearch)}" aria-label="${esc(s.langSearch)}" autocomplete="off" spellcheck="false"><ul class="lang-list" aria-label="${esc(s.langLabel)}">${langItems(ctx, 'menu')}</ul><p class="lang-empty" hidden>${esc(s.langNone)}</p></div></details></div>`;
}

// Pro fiyatı: yalnız site.json → pro; dile göre Intl ile biçimlenir (tr: "6,99 $"; {{price:proTR}} → priceTR).
function proPrice(lang, key = 'price') {
  const { currency } = cfg.pro;
  const price = cfg.pro[key];
  if (lang === 'tr') return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(price)} $`;
  return new Intl.NumberFormat(L[lang].num, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(price);
}

function render(tpl, ctx, depth = 0) {
  if (depth > 8) { errors.push('parça iç içe geçme sınırı aşıldı'); return tpl; }
  // Koşullu blok: {{?yol}}...{{/?}} yapılandırma değeri boşsa blok çıkarılır (ör. VirusTotal bağlantısı yokken).
  tpl = tpl.replace(/\{\{\?\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\?\}\}/g, (m, p, body) => (get(cfg, p) ? body : ''));
  return tpl.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, expr) => {
    if (expr.startsWith('>')) return render(partial(expr.slice(1).trim()), ctx, depth + 1);
    const i = expr.indexOf(':');
    const op = i === -1 ? expr : expr.slice(0, i);
    const arg = i === -1 ? '' : expr.slice(i + 1);
    switch (op) {
      case 't': {
        const v = strings[ctx.clang][arg];
        if (v == null) { errors.push(`${ctx.where}: çeviri anahtarı yok: ${arg}`); return m; }
        return /Html$/.test(arg) ? render(v, ctx, depth + 1) : esc(v);
      }
      case 'url': {
        const [id, l] = arg.split('@');
        const [pid, hash] = id.split('#');
        return pageUrl(pid, l || ctx.lang) + (hash ? `#${hash}` : '');
      }
      case 'abs': return abs(pageUrl(arg, ctx.lang));
      case 'cfg': {
        const v = get(cfg, arg);
        if (v == null) { errors.push(`${ctx.where}: yapılandırma yok: ${arg}`); return m; }
        return esc(v);
      }
      case 'price': {
        if (arg !== 'pro' && arg !== 'proTR') { errors.push(`${ctx.where}: bilinmeyen fiyat: ${arg}`); return m; }
        return esc(proPrice(ctx.lang, arg === 'proTR' ? 'priceTR' : 'price'));
      }
      case 'current': return ctx.id === arg ? ' aria-current="page"' : '';
      case 'langmenu': return langMenu(ctx);
      case 'langlinks': return `<ul>${langItems(ctx, 'foot')}</ul>`;
      case 'lang': return ctx.lang;
      case 'year': return String(new Date().getFullYear());
      // {{date:compareDate}} → cfg.compareDate.iso, içerik dilinde uzun tarih (ör. "8 de noviembre de 2026")
      case 'date': {
        const iso = get(cfg, `${arg}.iso`);
        if (!iso) { errors.push(`${ctx.where}: tarih yok: ${arg}.iso`); return m; }
        return esc(new Intl.DateTimeFormat(L[ctx.clang].num, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)));
      }
      case 'shot': return shot(arg, ctx);
      case 'demo': return demo(arg, ctx);
      case 'numbers': return numbersBlock(ctx.clang);
      case 'sizedemo': return sizeDemo(ctx.clang);
      case 'sizeMB': return String(cfg.release.sizeMB);
      case 'dlfile': return esc(directDownload());
      case 'dlhref': return esc(directDownload() || pageUrl('download', ctx.lang));
      default:
        errors.push(`${ctx.where}: bilinmeyen etiket: ${m}`);
        return m;
    }
  });
}

// İçerik dosyası: en üstte <!--meta {...} --> bloğu, sonra HTML gövde. Dilde yoksa İngilizce (fallback).
const hasContent = (lang, id) => fs.existsSync(path.join(SRC, 'content', lang, `${id}.html`));
function readContent(lang, id) {
  const clang = hasContent(lang, id) ? lang : DEF;
  const f = path.join(SRC, 'content', clang, `${id}.html`);
  if (!fs.existsSync(f)) { errors.push(`içerik yok: content/${clang}/${id}.html`); return { meta: {}, body: '', clang }; }
  const raw = rd(f);
  const mm = raw.match(/^\s*<!--meta\s*([\s\S]*?)-->/);
  if (!mm) { errors.push(`${clang}/${id}: meta bloğu yok`); return { meta: {}, body: raw, clang }; }
  let meta = {};
  try { meta = JSON.parse(mm[1]); } catch (e) { errors.push(`${clang}/${id}: meta JSON hatalı: ${e.message}`); }
  return { meta, body: raw.slice(mm[0].length), clang };
}
// Bir sayfanın gerçekten çevrilmiş olduğu diller (hreflang ve site haritası yalnız bunları listeler).
const translated = (id) => LANGS.filter((l) => hasContent(l, id));

// ---------- yapılandırılmış veri ----------
const org = {
  '@type': 'Organization', '@id': `${SITE}/#org`, name: cfg.owner.brand, url: `${SITE}/`,
  logo: `${SITE}/img/logo-512.png`, email: cfg.contactEmail,
};
function softwareApp(lang) {
  const dir = path.join(SRC, 'img', 'shots');
  const shots = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[^.]+\.png$/.test(f)).slice(0, 3) : [];
  return {
    '@type': 'SoftwareApplication', '@id': `${SITE}/#app`, name: 'HermoPDF',
    description: strings[lang].appDescription,
    applicationCategory: 'BusinessApplication', operatingSystem: 'Windows 10, Windows 11',
    softwareVersion: cfg.release.version, fileSize: `${cfg.release.sizeMB}MB`,
    downloadUrl: abs(pageUrl('download', lang)), url: abs(pageUrl('home', lang)),
    inLanguage: 'tr', isAccessibleForFree: true,
    license: 'https://www.gnu.org/licenses/gpl-3.0.html',
    publisher: { '@id': `${SITE}/#org` },
    screenshot: shots.map((f) => `${SITE}/img/shots/${f}`),
    offers: { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD', url: abs(pageUrl('download', lang)) },
  };
}
const stripTags = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
function faqSchema(html) {
  const items = [];
  const re = /<details class="faq"[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<div class="faq-a">([\s\S]*?)<\/div>\s*<\/details>/g;
  let m;
  while ((m = re.exec(html))) items.push({ '@type': 'Question', name: stripTags(m[1]), acceptedAnswer: { '@type': 'Answer', text: stripTags(m[2]) } });
  return items.length ? { '@type': 'FAQPage', mainEntity: items } : null;
}

// ---------- CSP ve başlıklar ----------
const gc = cfg.goatcounter && /^[a-z0-9-]+$/.test(cfg.goatcounter) ? cfg.goatcounter : '';
const apiOrigin = new URL(cfg.apiBase).origin;
function csp({ checkout }) {
  const script = ["'self'", `'sha256-${sha256b64(jsClassScript)}'`];
  const style = ["'self'", `'sha256-${sha256b64(css)}'`];
  const img = ["'self'", 'data:'];
  const connect = ["'self'", apiOrigin];
  const frame = [];
  if (gc) { script.push('https://gc.zgo.at'); img.push(`https://${gc}.goatcounter.com`); connect.push(`https://${gc}.goatcounter.com`); }
  if (DEV) connect.push(new URL(cfg.devApiBase).origin);
  if (checkout) {
    // Freemius Checkout JS (https://checkout.freemius.com/js/v1/): betik checkout.freemius.com'dan gelir, ödeme ekranı
    // aynı kökten bir iframe'dir (ekranın kendi istekleri iframe'in içindedir, bizim CSP'mize tabi değil).
    // Betiğin kaynağı okundu: fetch/XHR yok; yalnız bir <iframe>, bir <style> öğesi ve style özniteliği ekliyor.
    // Resmî belgede CSP listesi yok; bu yüzden connect ve img izni EKLENMEDİ. Canlıda konsolu yeniden kontrol et.
    script.push('https://checkout.freemius.com');
    style.splice(1, 1, "'unsafe-inline'"); // Betik satır içi stil ekler; hash ile birlikte 'unsafe-inline' yok sayılır.
    frame.push('https://checkout.freemius.com');
  }
  const d = [
    "default-src 'self'", `script-src ${script.join(' ')}`, `style-src ${style.join(' ')}`,
    `img-src ${img.join(' ')} blob:`, "media-src 'self'", `connect-src ${connect.join(' ')}`, "font-src 'self'",
    `frame-src ${frame.length ? frame.join(' ') : "'none'"}`, "object-src 'none'", "base-uri 'self'",
    "form-action 'self'", "frame-ancestors 'none'", "manifest-src 'self'",
  ];
  if (!DEV) d.push('upgrade-insecure-requests');
  return d.join('; ');
}

// ---------- sayfa ----------
const titles = new Map();
const descs = new Map();
function buildPage(id, lang) {
  const content = readContent(lang, id);
  const fallback = content.clang !== lang;
  const p = pages[id] || { noindex: true };
  const ctx = { id, lang, clang: lang, where: `${lang}/${id}` };
  const bctx = { ...ctx, clang: content.clang };   // gövde: içerik dilinin metinleri, sayfa dilinin adresleri
  const { meta, body } = content;
  if (!meta.title || !meta.description) errors.push(`${ctx.where}: title/description eksik`);
  if (!fallback) {
    if (meta.title && meta.title.length > 70) warn.push(`${ctx.where}: başlık uzun (${meta.title.length})`);
    if (meta.description && (meta.description.length > 170 || meta.description.length < 70)) warn.push(`${ctx.where}: açıklama uzunluğu ${meta.description.length}`);
  }
  if (id !== '404' && !fallback) {
    if (titles.has(meta.title)) errors.push(`${ctx.where}: başlık tekrar ediyor (${titles.get(meta.title)})`);
    if (descs.has(meta.description)) errors.push(`${ctx.where}: açıklama tekrar ediyor (${descs.get(meta.description)})`);
    titles.set(meta.title, ctx.where); descs.set(meta.description, ctx.where);
  }
  let main = render(body, bctx).trim();
  if (fallback && id !== '404') {
    const note = p.legal ? `${strings[lang].fallbackNote} ${strings[lang].legalNote}` : strings[lang].fallbackNote;
    main = `<div class="fallback-note" lang="${lang}" dir="${L[lang].dir}"><div class="wrap"><p>${esc(note)}</p></div></div>\n${main}`;
  }
  if (/\sstyle="/.test(main)) errors.push(`${ctx.where}: satır içi style özniteliği var (CSP bunu engeller); sınıf kullan`);
  const header = render(partial('header'), ctx);
  const footer = render(partial('footer'), ctx);
  const is404 = id === '404';
  const noindex = p.noindex || is404 || fallback;
  // Çevrilmemiş sayfa: kanonik adres İngilizce sürüm, hreflang yok.
  const url = is404 ? null : abs(pageUrl(id, fallback ? DEF : lang));
  const alts = is404 || fallback ? [] : translated(id);
  const ogImg = `${SITE}/img/og-${lang === 'tr' ? 'tr' : 'en'}.png`;
  const graph = [org];
  if (id === 'home') graph.push({ '@type': 'WebSite', '@id': `${SITE}/#site`, url: `${SITE}/`, name: 'HermoPDF', inLanguage: LANGS, publisher: { '@id': `${SITE}/#org` } });
  if (['home', 'download', 'pricing', 'compress', 'edit'].includes(id)) graph.push(softwareApp(content.clang));
  if (p.faqSchema && !fallback) { const f = faqSchema(main); if (f) graph.push(f); else errors.push(`${ctx.where}: SSS şeması için soru bulunamadı`); }
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');

  const s = strings[lang];
  const pageCfg = {
    lang, goatcounter: gc, apiBase: cfg.apiBase, suggest: suggestSrc,
    t: { copied: s.copied, copyFail: s.copyFail, ...(p.checkout ? { buyComingSoon: s.buyComingSoon, buyComingSoonNote: s.buyComingSoonNote, buyLoading: s.buyLoading, buyFailed: s.buyFailed, buyError: s.buyError } : {}) },
    ...(DEV ? { demoAllowed: true, devApiBase: cfg.devApiBase } : {}),
    ...(p.checkout ? { freemius: cfg.freemius, checkoutLocale: L[lang].fs, successPath: pageUrl('success', lang) } : {}),
  };
  const scripts = [`<script src="${jsOut.site.src}" defer></script>`]
    .concat((p.scripts || []).map((sc) => { if (!jsOut[sc]) { errors.push(`betik yok: ${sc}`); return ''; } return `<script src="${jsOut[sc].src}" defer></script>`; }));
  const preview = hasPlaceholder({ p: cfg.freemius, r: cfg.release, g: cfg.githubUrl, o: cfg.owner }) ? `<div class="preview-bar">${esc(s.previewBar)}</div>` : '';
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    url ? `<link rel="canonical" href="${url}">` : '',
    alts.length ? alts.map((a) => `<link rel="alternate" hreflang="${a}" href="${abs(pageUrl(id, a))}">`).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${abs(pageUrl(id, DEF))}">` : '',
    noindex ? '<meta name="robots" content="noindex">' : '',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="theme-color" content="#F2E4C8" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#15161d" media="(prefers-color-scheme: dark)">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="HermoPDF">',
    `<meta property="og:title" content="${esc(meta.ogTitle || meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    url ? `<meta property="og:url" content="${url}">` : '',
    `<meta property="og:image" content="${ogImg}">`,
    '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(s.ogAlt)}">`,
    `<meta property="og:locale" content="${L[lang].locale}">`,
    ...alts.filter((a) => a !== lang).map((a) => `<meta property="og:locale:alternate" content="${L[a].locale}">`),
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(meta.ogTitle || meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.description)}">`,
    `<meta name="twitter:image" content="${ogImg}">`,
    `<style>${css}</style>`,
    `<script>${jsClassScript}</script>`,
    `<script type="application/ld+json">${ld}</script>`,
  ].filter(Boolean).join('\n');

  const uiNote = uiNoteFor(lang);
  const mainAttr = fallback ? ` lang="${DEF}" dir="${L[DEF].dir}"` : '';
  return `<!doctype html>
<html lang="${lang}" dir="${L[lang].dir}">
<head>
${head}
</head>
<body class="page-${id}">
<a class="skip" href="#main">${esc(s.skip)}</a>
${preview}${header}
${uiNote ? `<div class="ui-note"><div class="wrap"><p>${render(uiNote, ctx)}</p></div></div>
` : ''}<main id="main" tabindex="-1"${mainAttr}>
${main}
</main>
${footer}
<script type="application/json" id="site-config">${JSON.stringify(pageCfg).replace(/</g, '\\u003c')}</script>
${scripts.join('\n')}
</body>
</html>
`;
}

// ---------- derle ----------
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const built = [];
for (const id of Object.keys(pages)) {
  for (const lang of LANGS) {
    const rel = pageUrl(id, lang).replace(/^\//, '') + 'index.html';
    write(rel, buildPage(id, lang));
    built.push({ id, lang, rel });
  }
}
// 404: her dil kendi önekinde (Cloudflare Pages en yakın 404.html'i kullanır).
for (const lang of LANGS) write(`${prefix(lang).replace(/^\//, '')}${prefix(lang) ? '/' : ''}404.html`, buildPage('404', lang));

for (const [name, j] of Object.entries(jsOut)) write(`js/${name}.js`, j.code);
write('i18n/suggest.json', suggestJson);
copyDir(path.join(SRC, 'img'), path.join(DIST, 'img'), (f) => /\.(png|svg|jpg|webp|ico)$/i.test(f));
copyDir(path.join(SRC, 'static'), DIST);

// sitemap.xml (yalnız çevrilmiş sayfalar, hreflang alternatifleriyle)
const lastmod = cfg.legalUpdated.iso;
const sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
for (const [id, p] of Object.entries(pages)) {
  if (p.noindex) continue;
  const tl = translated(id);
  const altXml = tl.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${abs(pageUrl(id, a))}"/>`).join('') +
    `<xhtml:link rel="alternate" hreflang="x-default" href="${abs(pageUrl(id, DEF))}"/>`;
  for (const lang of tl) {
    sm.push(`  <url><loc>${abs(pageUrl(id, lang))}</loc><lastmod>${lastmod}</lastmod><priority>${(p.priority ?? 0.5).toFixed(1)}</priority>${altXml}</url>`);
  }
}
sm.push('</urlset>');
write('sitemap.xml', sm.join('\n') + '\n');
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

// _headers (Cloudflare Pages). serve.mjs de aynı dosyayı uygular.
const common = [
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  X-Frame-Options: DENY',
  '  Cross-Origin-Opener-Policy: same-origin-allow-popups',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=()',
];
if (!DEV) common.push('  Strict-Transport-Security: max-age=31536000');
const checkoutPaths = Object.keys(pages).filter((id) => pages[id].checkout).flatMap((id) => LANGS.map((l) => pageUrl(id, l)));
const headers = [
  '# Otomatik üretildi (build.mjs). Elle değiştirme; src/ ve build.mjs üzerinden düzenle.',
  '/*', ...common, `  Content-Security-Policy: ${csp({ checkout: false })}`, '',
  ...checkoutPaths.flatMap((pp) => [`${pp}*`, '  ! Content-Security-Policy', `  Content-Security-Policy: ${csp({ checkout: true })}`, '']),
  '/js/*', '  Cache-Control: public, max-age=31536000, immutable', '',
  '/i18n/*', '  Cache-Control: public, max-age=86400', '',
  '/img/*', '  Cache-Control: public, max-age=86400', '',
  '/hermes/*', '  Cache-Control: public, max-age=86400', '',
  '/demo/*', '  Cache-Control: public, max-age=86400', '',
  '/updates/*', '  Cache-Control: public, max-age=300, must-revalidate', '  Content-Type: application/json; charset=utf-8', '',
];
write('_headers', headers.join('\n'));

// Yönlendirmeler. İlk eşleşen kazanır: özel kurallar önce, joker en sonda.
// Eski düzen (12 Kasım 2026 öncesi): Türkçe kökteydi (/indir/), İngilizce /en/ altındaydı. Uygulama /fiyat ve /destek'e bağlanır.
const redirects = [
  '# Otomatik üretildi (build.mjs).',
  `/satin-al ${pageUrl('pricing', 'tr')} 302`,
  `/buy ${pageUrl('pricing', 'en')} 302`,
  `/en/buy ${pageUrl('pricing', 'en')} 302`,
  `/lisans ${pageUrl('recover', 'tr')} 302`,
  `/license ${pageUrl('recover', 'en')} 302`,
  `/en/license ${pageUrl('recover', 'en')} 302`,
  `/github ${cfg.githubUrl} 302`,
  `/en/compress-pdf ${pageUrl('compress', 'en')} 301`,
  `/compress-pdf ${pageUrl('compress', 'en')} 301`,
  `/pdf-sikistirma ${pageUrl('compress', 'tr')} 301`,
];
for (const [id, p] of Object.entries(pages)) {
  if (id === 'home') continue;
  const to = pageUrl(id, 'tr');
  redirects.push(`${p.tr} ${to} 301`, `${p.tr.replace(/\/$/, '')} ${to} 301`);
}
redirects.push('/en / 301', '/en/* /:splat 301');
write('_redirects', redirects.join('\n') + '\n');

// rapor
if (warn.length) console.log(`Uyarılar (${warn.length}):\n  - ${[...new Set(warn)].join('\n  - ')}`);
if (errors.length) {
  console.error(`\nHATA (${errors.length}):\n  - ${[...new Set(errors)].join('\n  - ')}`);
  process.exit(1);
}
const nTrans = built.filter((b) => hasContent(b.lang, b.id)).length;
console.log(`\n${DEV ? 'Geliştirme' : 'Üretim'} derlemesi tamam: ${built.length + LANGS.length} sayfa (${LANGS.length} dil; ${nTrans} çevrilmiş, ${built.length - nTrans} İngilizce yedek) → ${path.relative(process.cwd(), DIST) || DIST}`);
