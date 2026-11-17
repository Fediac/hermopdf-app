#!/usr/bin/env node
// Görsel ve teknik QA turu (yerel önizleme sunucusu çalışırken):
//   node serve.mjs   (ayrı pencerede)   →   node tools/qa.mjs [--only tr|en|main] [--no-shots]
// Her sayfa için 390x844 (telefon) ve 1440x900 (masaüstü), açık ve koyu temada tam sayfa ekran görüntüsü alır
// (website/qa/, git'e girmez) ve şunları denetler: konsol hatası, CSP ihlali, yatay kaydırma, yinelenen id,
// başlık sırası atlaması, lang özniteliği, boyutsuz / tembel yüklemesiz görsel, render engelleyen betik,
// dokunma hedefi küçük bağlantılar (telefonda). Sonuç: qa/report.json + konsol özeti.
// playwright-core uygulama deposundan salt okunur yüklenir; tarayıcı olarak bilgisayardaki Edge kullanılır.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.ULTRONIX_APP_DIR || path.resolve(ROOT, '..', '..', 'PDFUsta');
const require = createRequire(path.join(APP, 'package.json'));
const { chromium } = require('playwright-core');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173';
const OUT = path.join(ROOT, 'qa');
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const only = arg('--only');
const SHOTS = !process.argv.includes('--no-shots');
const { pages } = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'pages.json'), 'utf8'));
const MAIN_EN = ['home', 'download', 'pricing', 'compress', 'compare', 'privacy', 'faq', 'success'];

// Adresler: İngilizce kökte, Türkçe /tr/ altında, diğer diller kendi önekiyle (src/content/languages.json).
const { languages } = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'content', 'languages.json'), 'utf8'));
const pre = Object.fromEntries(languages.map((l) => [l.code, l.path ? `/${l.path}` : '']));
const targets = [];
for (const [id, p] of Object.entries(pages)) {
  if (only !== 'en') targets.push({ id, lang: 'tr', url: pre.tr + p.tr });
  if (only !== 'tr' && (only === 'en' || MAIN_EN.includes(id))) targets.push({ id, lang: 'en', url: p.en });
}
// diğer diller: yalnız ana sayfa (--only tr|en değilken)
if (!only) for (const l of languages) if (!['en', 'tr'].includes(l.code)) targets.push({ id: 'home', lang: l.code, url: `${pre[l.code]}/` });
targets.push({ id: '404', lang: 'tr', url: '/tr/yok-boyle-bir-sayfa/' });
// --page home,pricing → yalnız bu sayfalar (hızlı tekrar için)
const pageFilter = arg('--page');
if (pageFilter) { const keep = new Set(pageFilter.split(',')); for (let i = targets.length - 1; i >= 0; i--) if (!keep.has(targets[i].id)) targets.splice(i, 1); }

const VIEWS = [
  { name: 'm', width: 390, height: 844, mobile: true },
  { name: 'd', width: 1440, height: 900, mobile: false },
];
const SCHEMES = ['light', 'dark'];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
for (const v of VIEWS) {
  for (const scheme of SCHEMES) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, colorScheme: scheme, isMobile: v.mobile, hasTouch: v.mobile, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    for (const t of targets) {
      const page = await ctx.newPage();
      const issues = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') issues.push(`console.${m.type()}: ${m.text()}`); });
      page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => { const u = r.url(); if (!u.startsWith('data:')) issues.push(`requestfailed: ${u} ${r.failure()?.errorText || ''}`); });
      await page.addInitScript(() => {
        window.__csp = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
      });
      let status = 0;
      try {
        const r = await page.goto(BASE + t.url, { waitUntil: 'load' });
        status = r ? r.status() : 0;
      } catch (e) { issues.push(`goto: ${e.message}`); }
      // tembel görselleri yükle
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(150);
      const dom = await page.evaluate(() => {
        const out = { csp: window.__csp };
        const de = document.documentElement;
        out.hscroll = de.scrollWidth > de.clientWidth + 1 ? `${de.scrollWidth} > ${de.clientWidth}` : null;
        // taşan öğeler
        out.overflow = [];
        if (out.hscroll) {
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.right > de.clientWidth + 1 && r.width > 0) out.overflow.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} → ${Math.round(r.right)}`);
            if (out.overflow.length > 6) break;
          }
        }
        const ids = {};
        for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
        out.dupIds = Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k);
        out.lang = de.getAttribute('lang');
        const hs = [...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')].map((h) => Number(h.tagName[1]));
        out.h1 = document.querySelectorAll('h1').length;
        out.headingSkips = [];
        for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) out.headingSkips.push(`h${hs[i - 1]}→h${hs[i]}`);
        out.imgs = [...document.querySelectorAll('img')].filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).map((i) => `nosize ${i.src}`)
          .concat([...document.querySelectorAll('main img')].filter((i, n) => n > 0 && i.loading !== 'lazy').map((i) => `eager ${i.src}`));
        out.blocking = [...document.querySelectorAll('head script[src]:not([defer]):not([async]):not([type="module"])')].map((s) => s.src);
        out.extLinksNoRel = [...document.querySelectorAll('a[target="_blank"]')].filter((a) => !/noopener/.test(a.rel)).map((a) => a.href);
        out.emptyLinks = [...document.querySelectorAll('a, button')].filter((a) => !a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]')).map((a) => a.outerHTML.slice(0, 80));
        if (matchMedia('(max-width: 500px)').matches) {
          out.smallTargets = [...document.querySelectorAll('main a, main button, header a, header button')].filter((a) => {
            const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
            return r.width > 0 && r.height > 0 && r.height < 24 && cs.display !== 'inline';
          }).slice(0, 5).map((a) => `${a.textContent.trim().slice(0, 30)} (${Math.round(a.getBoundingClientRect().height)}px)`);
        }
        out.height = document.body.scrollHeight;
        return out;
      });
      if (status !== 200 && t.id !== '404') issues.push(`HTTP ${status}`);
      const file = `${t.lang}-${t.id}-${v.name}-${scheme}.png`;
      if (SHOTS) await page.screenshot({ path: path.join(OUT, file), fullPage: true });
      report.push({ page: t.url, id: t.id, lang: t.lang, view: v.name, scheme, file, issues, ...dom });
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));

let n = 0;
for (const r of report) {
  const probs = [...r.issues, ...r.csp.map((c) => `CSP ${c}`)];
  if (r.hscroll) probs.push(`yatay kaydırma ${r.hscroll}: ${r.overflow.join(', ')}`);
  if (r.dupIds.length) probs.push(`yinelenen id: ${r.dupIds.join(', ')}`);
  if (r.h1 !== 1) probs.push(`h1 sayısı ${r.h1}`);
  if (r.headingSkips.length) probs.push(`başlık atlaması: ${r.headingSkips.join(' ')}`);
  if (r.imgs.length) probs.push(`görsel: ${r.imgs.join(', ')}`);
  if (r.blocking.length) probs.push(`render engelleyen betik: ${r.blocking.join(', ')}`);
  if (r.extLinksNoRel.length) probs.push(`noopener yok: ${r.extLinksNoRel.join(', ')}`);
  if (r.emptyLinks.length) probs.push(`adsız bağlantı/düğme: ${r.emptyLinks.join(' | ')}`);
  if (r.smallTargets && r.smallTargets.length) probs.push(`küçük dokunma hedefi: ${r.smallTargets.join(', ')}`);
  if (r.lang !== r.lang) probs.push('lang');
  if (probs.length) { n++; console.log(`${r.page} [${r.view}/${r.scheme}]\n  - ${probs.join('\n  - ')}`); }
}
console.log(`\n${report.length} görünüm denetlendi, ${n} görünümde not var. Ekran görüntüleri: ${OUT}`);
