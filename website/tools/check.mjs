#!/usr/bin/env node
// Önizleme sunucusu çalışırken siteyi uçtan uca denetler (bağımlılık yok):
// her sayfa 200 mü, iç bağlantılar ve #çapalar var mı, JSON-LD geçerli JSON mu, sitemap adresleri
// var mı, hreflang çiftleri karşılıklı mı, başlıklar tekil mi, görsellerde alt metin var mı, CSP başlığı geliyor mu.
//   node serve.mjs   (ayrı pencerede)   →   node tools/check.mjs [http://127.0.0.1:4173]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'config', 'site.json'), 'utf8'));
const SITE = cfg.siteUrl.replace(/\/$/, '');
const problems = [];
const bad = (m) => problems.push(m);
const toLocal = (u) => (u.startsWith(SITE) ? u.slice(SITE.length) || '/' : u);

const cache = new Map();
async function get(p) {
  if (!cache.has(p)) {
    cache.set(p, fetch(BASE + p, { redirect: 'manual' }).then(async (r) => ({ status: r.status, headers: r.headers, body: (r.headers.get('content-type') || '').includes('text/html') ? await r.text() : '' })));
  }
  return cache.get(p);
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };

async function main() {
  const sm = await get('/sitemap.xml');
  if (sm.status !== 200) bad(`/sitemap.xml → ${sm.status}`);
  const smText = await (await fetch(BASE + '/sitemap.xml')).text();
  const locs = [...smText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => toLocal(m[1]));
  const alts = [...smText.matchAll(/href="([^"]+)"/g)].map((m) => toLocal(m[1]));
  // sitemap'te olmayan (noindex) sayfalar da denetlensin
  const pages = new Set([...locs, ...alts]);
  const walk = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    if (e.isDirectory()) walk(path.join(d, e.name), `${rel}/${e.name}`);
    else if (e.name === 'index.html') pages.add(`${rel}/`);
  });
  walk(path.join(ROOT, 'dist'));

  const titles = new Map();
  const links = new Map(); // hedef → kaynak
  let ldCount = 0;
  for (const p of [...pages].sort()) {
    const r = await get(p);
    if (r.status !== 200) { bad(`${p} → HTTP ${r.status}`); continue; }
    if (!r.headers.get('content-security-policy')) bad(`${p}: CSP başlığı yok`);
    const html = r.body;
    if (html.includes('{{')) bad(`${p}: işlenmemiş şablon etiketi`);
    if (/__hermes|DEMO-START|demoAllowed/.test(html)) bad(`${p}: test kancası kaldı`);
    if (/\sstyle="/.test(html.replace(/<svg[\s\S]*?<\/svg>/g, ''))) bad(`${p}: satır içi style özniteliği (CSP)`);
    const noindex = /<meta name="robots" content="noindex">/.test(html);
    const fallback = html.includes('class="fallback-note"');   // çevrilmemiş sayfa: İngilizce içerik, noindex
    const lang = (html.match(/<html lang="([^"]+)"/) || [])[1];
    if (!lang) bad(`${p}: <html lang> yok`);
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
    if (!title) bad(`${p}: <title> yok`);
    else if (!noindex) { if (titles.has(title)) bad(`${p}: başlık ${titles.get(title)} ile aynı`); else titles.set(title, p); }
    if (!/<meta name="description" content="[^"]{50,}"/.test(html)) bad(`${p}: açıklama yok/kısa`);
    if ((html.match(/<h1[\s>]/g) || []).length !== 1) bad(`${p}: tam olarak bir <h1> olmalı`);
    const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    const hl = Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], toLocal(m[2])]));
    if (fallback) {
      if (!noindex) bad(`${p}: çevrilmemiş sayfa noindex değil`);
      if (Object.keys(hl).length) bad(`${p}: çevrilmemiş sayfada hreflang olmamalı`);
      if (locs.includes(p)) bad(`${p}: çevrilmemiş sayfa site haritasında`);
      const c = canon && await get(toLocal(canon));
      if (!c || c.status !== 200) bad(`${p}: canonical (${canon}) açılmıyor`);
    } else {
      if (!canon || toLocal(canon) !== p) bad(`${p}: canonical yanlış (${canon})`);
      if (!hl['x-default']) bad(`${p}: hreflang x-default yok`);
      if (hl[lang] !== p) bad(`${p}: kendi dili (${lang}) hreflang listesinde yok`);
      for (const [l, u] of Object.entries(hl)) {
        if (l === 'x-default' || u === p) continue;
        const other = await get(u);
        if (other.status !== 200) bad(`${p}: hreflang ${l} → ${u} ${other.status}`);
        else if (!other.body.includes(`hreflang="${lang}" href="${SITE}${p}"`)) bad(`${p}: ${u} karşılıklı hreflang vermiyor`);
      }
    }
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(m[1]); ldCount++; } catch (e) { bad(`${p}: JSON-LD bozuk: ${e.message}`); }
    }
    for (const m of html.matchAll(/<img\b[^>]*>/g)) if (attr(m[0], 'alt') == null || attr(m[0], 'alt') === '') bad(`${p}: alt metni olmayan görsel ${attr(m[0], 'src')}`);
    for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const u = m[1];
      if (/^(mailto:|https?:|#$|data:|blob:)/.test(u)) continue;
      if (u.startsWith('#')) { links.set(p + u, p); continue; }
      links.set(new URL(u, BASE + p).pathname + (u.includes('#') ? '#' + u.split('#')[1] : ''), p);
    }
  }
  for (const [target, from] of links) {
    const [pth, hash] = target.split('#');
    const r = await get(pth);
    if (r.status !== 200) { bad(`kırık bağlantı: ${from} → ${target} (${r.status})`); continue; }
    if (hash && !new RegExp(`\\sid="${hash}"`).test(r.body)) bad(`kırık çapa: ${from} → ${target}`);
  }
  // özel durumlar
  const nf = await get('/bu-sayfa-yok/');
  if (nf.status !== 404) bad(`404 sayfası 404 döndürmüyor (${nf.status})`);
  const rd = await fetch(BASE + '/satin-al', { redirect: 'manual' });
  if (![301, 302].includes(rd.status)) bad(`/satin-al yönlendirmesi yok (${rd.status})`);
  for (const f of ['/robots.txt', '/favicon.svg', '/img/og-tr.png', '/img/og-en.png']) {
    const r = await fetch(BASE + f);
    if (r.status !== 200) bad(`${f} → ${r.status}`);
  }
  for (const pp of ['/pricing/', '/tr/fiyat/', '/ar/pricing/']) {
    const pricing = await get(pp);
    if (!/checkout\.freemius\.com/.test(pricing.headers.get('content-security-policy') || '')) bad(`${pp}: fiyat sayfasının CSP'sinde Freemius yok`);
  }
  // eski adresler (uygulama /fiyat ve /destek'e bağlanır; eski İngilizce /en/ altındaydı)
  for (const [from, to] of [['/fiyat', '/tr/fiyat/'], ['/destek', '/tr/destek/'], ['/indir/', '/tr/indir/'], ['/en/', '/'], ['/en/download/', '/download/']]) {
    const r = await fetch(BASE + from, { redirect: 'manual' });
    if (![301, 302].includes(r.status) || r.headers.get('location') !== to) bad(`yönlendirme ${from} → ${to} değil (${r.status} ${r.headers.get('location')})`);
  }
  const sj = await fetch(BASE + '/i18n/suggest.json');
  if (sj.status !== 200) bad(`/i18n/suggest.json → ${sj.status}`);
  else { const d = await sj.json(); if (Object.keys(d).length !== 11) bad(`suggest.json ${Object.keys(d).length} dil içeriyor (11 olmalı)`); }
  const home = await get('/');
  if (/checkout\.freemius\.com/.test(home.headers.get('content-security-policy') || '')) bad('ana sayfa CSP\'si Paddle\'a gereksiz izin veriyor');

  console.log(`${pages.size} sayfa, ${links.size} iç bağlantı, ${locs.length} sitemap adresi, ${ldCount} JSON-LD bloğu denetlendi.`);
  if (problems.length) { console.log(`\nSORUNLAR (${problems.length}):\n  - ${problems.join('\n  - ')}`); process.exit(1); }
  console.log('Sorun yok.');
}
main().catch((e) => { console.error(e.message.includes('fetch failed') ? `Sunucuya ulaşılamadı: ${BASE} (önce node serve.mjs)` : e); process.exit(1); });
