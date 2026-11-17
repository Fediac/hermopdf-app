#!/usr/bin/env node
// Fiyat sayfası satın alma düğmesi denetimi (yerel önizleme sunucusu çalışırken).
//   node tools/qa-checkout.mjs placeholder   → yer tutucu yapılandırma: düğme kapalı, Freemius betiği hiç yüklenmemeli, düğme "yakında"
//   node tools/qa-checkout.mjs configured    → sahte sandbox değerleriyle derlenmiş site (checkoutEnabled:true ile derlenmiş geçici yapılandırma, --config):
//                                              Freemius betiği yüklenmeli, CSP ihlali olmamalı, düğme tıklanınca overlay açılmaya çalışmalı.
// GoatCounter istekleri tarayıcıda engellenir (üçüncü tarafa sayım gitmesin). Hiçbir ödeme bilgisi girilmez.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.ULTRONIX_APP_DIR || path.resolve(ROOT, '..', '..', 'PDFUsta');
const { chromium } = createRequire(path.join(APP, 'package.json'))('playwright-core');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173';
const mode = process.argv[2] || 'placeholder';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const out = [];
for (const url of ['/tr/fiyat/', '/pricing/', '/']) {
  const page = await browser.newPage();
  const csp = [], errors = [], requests = [];
  await page.route(/goatcounter\.com|gc\.zgo\.at/, (r) => { requests.push(`BLOCKED ${r.request().url()}`); r.abort(); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) requests.push(r.url()); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => {
    const b = document.querySelector('[data-buy]');
    return {
      button: b ? { disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), text: b.textContent.trim() } : null,
      status: document.querySelector('[data-buy-status]')?.textContent || null,
      price: document.querySelector('[data-pro-price]')?.textContent || null,
      fsLoaded: !!window.FS,
    };
  });
  let afterClick = null;
  if (mode === 'configured' && state.button && !state.button.disabled) {
    await page.click('[data-buy]');
    await page.waitForTimeout(4000);
    afterClick = await page.evaluate(() => ({
      overlayFrame: [...document.querySelectorAll('iframe')].map((f) => f.src.replace(/\?.*/, '')).filter((s) => /freemius/.test(s)),
      status: document.querySelector('[data-buy-status]')?.textContent || null,
    }));
  }
  out.push({ url, state, afterClick, csp, errors: errors.filter((e) => !/Content Security Policy/i.test(e)).slice(0, 6), external: [...new Set(requests)].slice(0, 12) });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
