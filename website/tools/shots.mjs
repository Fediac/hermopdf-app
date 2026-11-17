#!/usr/bin/env node
// Gerçek ekran görüntüleri: HermoPDF uygulamasını Playwright ile sürer ve site için görüntü alır.
// Uygulama deposu (PDFUsta) yalnız OKUNUR: playwright-core ve electron oradan yüklenir, uygulama
// tests/harness.js ile aynı biçimde başlatılır (PDFUSTA_TEST=1, geçici PDFUSTA_USERDATA).
// Yalnız depodaki SENTETİK test belgeleri (tests/fixtures) geçici bir klasöre kopyalanıp kullanılır;
// kullanıcının belgelerine, gerçek uygulama verisine ya da Claude Desktop ayarlarına dokunulmaz.
//
//   node tools/shots.mjs              → tüm görüntüler
//   node tools/shots.mjs kucultme     → yalnız adı eşleşenler (düzenli ifade)
//   ULTRONIX_APP_DIR=...              → uygulama deposu başka yerdeyse
//
// Görüntüler 2x piksel yoğunluğunda alınır (SHOT_SCALE=1 ile eski 1x): sitede büyük gösterilince yazılar keskin kalır.
// Çıktı: src/img/shots/<ad>.png (1400x900 pencere, kırpılmış, 2x) ve src/content/demo-numbers.json (küçültme önce/sonra sayıları).
// Sonra: node build.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.resolve(process.env.ULTRONIX_APP_DIR || path.join(ROOT, '..', '..', 'PDFUsta'));
const FIX = path.join(APP, 'tests', 'fixtures');
const OUT = path.join(ROOT, 'src', 'img', 'shots');
const NUMBERS = path.join(ROOT, 'src', 'content', 'demo-numbers.json');
const PH = path.join(OUT, '.placeholders.json');
const SCALE = Number(process.env.SHOT_SCALE || 2);
const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;

if (!fs.existsSync(path.join(APP, 'package.json'))) { console.error(`Uygulama deposu bulunamadı: ${APP}`); process.exit(1); }
const require = createRequire(path.join(APP, 'package.json'));
const { _electron: electron } = require('playwright-core');
const electronPath = require('electron');
const appPkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermopdf-shots-'));
const work = path.join(tmp, 'belgeler');
const userData = path.join(tmp, 'userdata');
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
function fixture(name) {
  const d = path.join(work, `k${++n}`);
  fs.mkdirSync(d, { recursive: true });
  const dst = path.join(d, name);
  fs.copyFileSync(path.join(FIX, name), dst);
  return dst;
}

const results = [];
const placeholders = new Set(fs.existsSync(PH) ? JSON.parse(fs.readFileSync(PH, 'utf8')) : []);
// clip: '.modal' gibi bir seçici (çevresine pay bırakılarak kırpılır) ya da {x, y, width, height}.
// Sitede görüntüler yarım sütun genişliğinde gösterildiği için pencere içi yazılar okunur kalsın diye kırpıyoruz.
async function save(win, name, clip) {
  await sleep(350);
  let rect;
  if (typeof clip === 'string') {
    const b = await win.locator(clip).first().boundingBox();
    if (b) {
      const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      const pad = 16;
      const x = Math.max(0, Math.floor(b.x - pad)), y = Math.max(0, Math.floor(b.y - pad));
      rect = { x, y, width: Math.min(vp.w - x, Math.ceil(b.width + pad * 2)), height: Math.min(vp.h - y, Math.ceil(b.height + pad * 2)) };
    }
  } else if (clip) rect = clip;
  await win.screenshot({ path: path.join(OUT, `${name}.png`), ...(rect ? { clip: rect } : {}) });
  placeholders.delete(name);
  console.log(`  görüntü: src/img/shots/${name}.png`);
}
async function step(name, fn) {
  if (only && !only.test(name)) return;
  const t = Date.now();
  try {
    await fn();
    results.push(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push(`✘ ${name}: ${e.message.split('\n')[0]}`);
  }
  console.log(results[results.length - 1]);
}

(async () => {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [...(SCALE !== 1 ? [`--force-device-scale-factor=${SCALE}`] : []), APP],
    env: { ...process.env, PDFUSTA_USERDATA: userData, PDFUSTA_TEST: '1', ...(process.env.PU_TEST_VISIBLE === '1' ? {} : { PU_TEST_OFFSCREEN: '1' }) },
  });
  const win = await app.firstWindow();
  // 1x: Playwright görünüm alanı. 2x: görünüm alanı öykünmesi ölçeği 1'e sabitlediği için pencerenin içerik boyutu ayarlanır.
  if (SCALE === 1) await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  else await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1400, 900); });
  await win.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  // Kaydet / aç pencerelerini geçici klasöre yönlendir (gerçek iletişim kutusu açılmaz).
  await app.evaluate(({ dialog }, work) => {
    dialog.showSaveDialog = async (w, o) => ({ canceled: false, filePath: `${work}\\${String((o || w).defaultPath || 'cikti.pdf').split(/[\\/]/).pop()}` });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: global.__nextOpen || [] });
  }, work);
  const setNextOpen = (files) => app.evaluate((_, files) => { global.__nextOpen = files; }, files);
  const clean = () => win.evaluate(() => {
    document.querySelectorAll('.modal-backdrop, .ctx-menu').forEach((m) => m.remove());
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const pu = window.__pu;
    if (pu.App.tool !== 'select') pu.setTool('select');
  });
  const closeAll = () => win.evaluate(() => { const pu = window.__pu; [...pu.App.docs].forEach((d) => pu.closeDoc(d, { force: true })); });
  const openDoc = async (file) => {
    await win.evaluate((f) => window.__pu.openPaths([f]), file);
    await win.waitForSelector('.doc-view:not(.hidden) .page[data-page-number="1"] canvas', { timeout: 30000 });
    await sleep(900);
  };
  const pageBox = (k) => win.locator(`.doc-view:not(.hidden) .page[data-page-number="${k}"]`).boundingBox();
  const modalBtn = (label) => win.locator('.modal .modal-foot button', { hasText: label }).last().click();
  const dismissOcrHint = async () => {
    await sleep(1500);
    const b = win.locator('.modal .modal-foot button', { hasText: 'Şimdi değil' });
    if (await b.count()) await b.last().click();
  };

  await step('baslangic', async () => {
    await sleep(1200);
    await save(win, 'baslangic');
  });

  await step('metin-duzenleme', async () => {
    await clean(); await closeAll();
    await openDoc(fixture('test.pdf'));
    await win.locator('#ribbon button', { hasText: 'Metni düzenle' }).first().click();
    const span = win.locator('.doc-view:not(.hidden) .page[data-page-number="1"] .textLayer span', { hasText: 'Fatura No' }).first();
    const sb = await span.boundingBox();
    await win.mouse.click(sb.x + sb.width * 0.5, sb.y + sb.height / 2);
    await win.waitForSelector('.pu-obj.editing .pu-text', { timeout: 8000 });
    await win.keyboard.press('Control+a');
    await win.keyboard.type('Fatura No: TR-2026-9999');
    // Yakın kırpım: düzenlenen satır (düzenleme sayfasında gösterilir).
    const eb = await win.locator('.pu-obj.editing').first().boundingBox();
    await save(win, 'metin-duzenleme-yakin', { x: Math.max(0, Math.floor(eb.x - 100)), y: 186, width: 540, height: Math.ceil(eb.y + eb.height + 130 - 186) });
    await win.keyboard.press('Escape');
    await win.keyboard.press('Escape');
  });

  await step('imza', async () => {
    await clean();
    if (!(await win.evaluate(() => window.__pu.App.docs.length))) await openDoc(fixture('test.pdf'));
    await win.locator('#ribbon button', { hasText: 'İmza' }).first().click();
    await win.waitForSelector('.sig-modal', { timeout: 8000 });
    await win.locator('.sig-tabs button', { hasText: 'Çiz' }).click();
    await sleep(200);
    const cb = await win.locator('.sig-pad canvas').boundingBox();
    await win.mouse.move(cb.x + 60, cb.y + 150);
    await win.mouse.down();
    for (let k = 0; k <= 40; k++) await win.mouse.move(cb.x + 60 + k * 9, cb.y + 120 + Math.sin(k / 2.5) * 45 - k);
    await win.mouse.up();
    await save(win, 'imza', '.modal');
    await modalBtn('Yerleştir');
    const b = await pageBox(1);
    await win.mouse.click(b.x + b.width * 0.35, b.y + Math.min(b.height * 0.5, 700));
    await sleep(300);
  });

  await step('karartma', async () => {
    await clean(); await closeAll();
    await openDoc(fixture('test.pdf'));
    await win.evaluate(() => {
      const d = window.__pu.App.active;
      d.addObj(0, { type: 'redact', x: 60, y: 120, w: 200, h: 40 });
      d.addObj(0, { type: 'redact', x: 60, y: 200, w: 260, h: 26 });
    });
    await win.waitForSelector('.redact-bar', { timeout: 8000 });
    await save(win, 'karartma', { x: 200, y: 186, width: 1000, height: 480 });
    await save(win, 'karartma-yakin', { x: 295, y: 306, width: 560, height: 330 }); // telefon: başlık, kutular, satırlar
  });

  await step('kucultme (dialog + sonuc + sayılar)', async () => {
    await clean(); await closeAll();
    const src = fixture('test.pdf');
    const before = fs.statSync(src).size;
    await openDoc(src);
    const pages = await win.evaluate(() => window.__pu.App.active.numPages);
    const targetMB = 0.2;
    await win.evaluate(() => { window.__pu.runAction('tools.compress'); });
    await win.waitForSelector('.modal input[type=number]', { timeout: 8000 });
    await win.fill('.modal input[type=number]', String(targetMB));
    await save(win, 'kucultme-dialog', '.modal');
    // Telefon için yakın kırpım: şu anki boyut + hedef boyut kutusu ve hazır düğmeler.
    {
      const a = await win.locator('.modal .size-box').first().boundingBox();
      const c = await win.locator('.modal .radio-card[data-v="auto"]').first().boundingBox();
      const pad = 14;
      // 440 px genişlik: telefonda ~%80 ölçekle gösterilir, yazılar okunur (sağ kenar bilerek kesilir).
      await save(win, 'kucultme-hedef', { x: Math.floor(c.x - pad), y: Math.floor(a.y - pad), width: 440, height: Math.ceil(c.y + c.height - a.y + pad * 2) });
    }
    const t0 = Date.now();
    await modalBtn('Küçült');
    await win.waitForSelector('.modal .size-compare', { timeout: 240000 });
    let seconds = Math.round((Date.now() - t0) / 100) / 10; // yedek: uygulamanın kendi söylediği süre aşağıda okunur
    // Görüntüde bilgisayarın kullanıcı adı ve geçici klasör görünmesin: yalnız kayıt yolunun klasör kısmı "…" ile kısaltılır.
    await win.evaluate((dir) => {
      for (const p of document.querySelectorAll('.modal .modal-msg')) {
        p.textContent = p.textContent.split(dir).join('…').replace(/(Kaydedildi: )[^\n]*?([^\\/\n]+\.pdf)/, '$1…\\$2');
      }
    }, tmp);
    const msg = await win.evaluate(() => document.querySelector('.modal .modal-msg')?.textContent || '');
    const level = (msg.match(/Seviye: ([^·\n]+?)\s*·/) || [])[1] || null;
    const appSecs = (msg.match(/·\s*([\d.]+) sn/) || [])[1];
    if (appSecs) seconds = Number(appSecs); // sitede uygulamanın kendi gösterdiği süre yazsın
    await save(win, 'kucultme-sonuc', '.modal');
    // Uygulama test kipinde kaydı çalışma klasörünün herhangi bir yerine yapabilir: tüm klasörü tara.
    const findOut = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { const r = findOut(p); if (r) return r; } else if (/küçültülmüş/.test(e.name)) return p;
      }
      return null;
    };
    const outPath = findOut(tmp);
    if (!outPath) throw new Error('küçültülmüş dosya bulunamadı');
    const after = fs.statSync(outPath).size;
    await modalBtn('Tamam');
    const data = {
      _note: 'tools/shots.mjs tarafından üretildi; elle değiştirme. Uygulamanın kendisinde, sentetik test belgesiyle ölçüldü.',
      generatedAt: new Date().toISOString(),
      appVersion: appPkg.version,
      cases: [{
        id: 'fixture-test-pdf',
        source: 'PDFUsta/tests/fixtures/test.pdf',
        label: { tr: `${pages} sayfalık sentetik test belgesi (metin ve fotoğraf içeriyor)`, en: `${pages}-page synthetic test document (text and a photo)` },
        pages, beforeBytes: before, afterBytes: after, targetBytes: Math.round(targetMB * 1048576), targetMB, seconds, level,
        reachedTarget: after <= Math.round(targetMB * 1048576),
      }],
    };
    fs.writeFileSync(NUMBERS, JSON.stringify(data, null, 2) + '\n');
    console.log(`  sayılar: ${before} → ${after} bayt (hedef ${targetMB} MB, ${seconds} sn) → src/content/demo-numbers.json`);
  });

  await step('ocr-sonuc', async () => {
    await clean(); await closeAll();
    await openDoc(fixture('scan.pdf'));
    await dismissOcrHint();
    await win.evaluate(() => { window.__pu.runAction('tools.ocr'); });
    await modalBtn('Başlat');
    await win.waitForFunction(() => [...document.querySelectorAll('.toast span')].some((s) => /OCR tamamlandı/i.test(s.textContent)), null, { timeout: 240000 });
    await sleep(800);
    await win.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    await win.evaluate(() => window.__pu.App.openFind('2026-4815'));
    await sleep(1400);
    await save(win, 'ocr-sonuc');
    await save(win, 'ocr-sonuc-yakin', { x: 300, y: 214, width: 520, height: 168 }); // telefon: bulunan sipariş numarası
    await win.keyboard.press('Escape');
  });

  await step('toplu-islem', async () => {
    await clean(); await closeAll();
    await setNextOpen([fixture('test.pdf'), fixture('scan.pdf')]);
    await win.evaluate(() => { window.__pu.runAction('tools.batch'); });
    await win.waitForSelector('.batch-list', { timeout: 8000 });
    await win.locator('.modal button', { hasText: 'PDF ekle' }).click();
    await win.waitForFunction(() => document.querySelectorAll('.batch-row').length === 2, null, { timeout: 10000 });
    await win.selectOption('.modal select >> nth=0', 'compress');
    await sleep(300);
    await save(win, 'toplu-islem', '.modal');
    await clean();
  });

  fs.writeFileSync(PH, JSON.stringify([...placeholders].sort(), null, 2) + '\n');
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; })).catch(() => {});
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${results.filter((r) => r.startsWith('✔')).length}/${results.length} adım tamam.`);
  if (placeholders.size) console.log(`Hâlâ yer tutucu: ${[...placeholders].join(', ')}`);
  console.log('Şimdi: node build.mjs');
  if (results.some((r) => r.startsWith('✘'))) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
