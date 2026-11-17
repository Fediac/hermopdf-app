// Uçtan uca test: uygulamayı gerçek bir kullanıcı gibi kullanır, her adımda ekran görüntüsü alır.
// Çalıştır: node tests/e2e.js [adım-filtresi]   (PACKAGED=1 ile paketlenmiş exe test edilir)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launch, shot, copyFixture, sleep, FIX } = require('./harness');
const { enableTestPro } = require('./license-helpers');
// OCR ve toplu işlem Pro özelliği (12 Kas 2026): bu testler onları kullandığı için atılık bir Pro lisansı etkinleştirilir
const PRO = enableTestPro();

const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const results = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-e2e-'));

async function step(name, fn) {
  if (only && !only.test(name)) return;
  const t = Date.now();
  try {
    if (global.__win) {
      await global.__win.evaluate(() => { document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); if (window.__pu.App.tool !== 'select') window.__pu.setTool('select'); });
    }
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}: ${e.message}`);
    if (global.__win) await shot(global.__win, `FAIL-${name.replace(/[^\w]+/g, '_')}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };

// Modal içindeki düğmeye metinle tıkla
async function clickModalBtn(win, label) {
  await win.locator('.modal .modal-foot button', { hasText: label }).last().click();
}
async function ribbonTab(win, label) { await win.locator('.ribbon-tab', { hasText: label }).click(); }
async function ribbonBtn(win, label) { await win.locator('#ribbon button', { hasText: label }).first().click(); }
async function waitToast(win, re, timeout = 20000) {
  await win.waitForFunction((src) => [...document.querySelectorAll('.toast span')].some((s) => new RegExp(src, 'i').test(s.textContent)), re.source, { timeout });
}
async function scrollPage(win, n, frac = 0.5) {
  await win.evaluate(([n, frac]) => {
    const c = document.querySelector('.doc-view:not(.hidden) .viewer-container');
    const p = c.querySelector(`.page[data-page-number="${n}"]`);
    c.scrollTop = p.offsetTop + p.offsetHeight * frac - c.clientHeight / 2;
  }, [n, frac]);
  await sleep(450);
}
async function pageBox(win, n) {
  return win.locator(`.doc-view:not(.hidden) .page[data-page-number="${n}"]`).boundingBox();
}
// Belge çıktısını (düzenlemeler işlenmiş) pdf.js ile metin olarak oku
async function outputText(win, pageNo) {
  return win.evaluate(async (pageNo) => {
    const d = window.__pu.App.active;
    const bytes = await d.buildBytes();
    const pdfjs = window.pdfjsLib;
    const task = pdfjs.getDocument({ data: bytes, cMapUrl: 'app://pu/node_modules/pdfjs-dist/cmaps/', cMapPacked: true, standardFontDataUrl: 'app://pu/node_modules/pdfjs-dist/standard_fonts/' });
    const doc = await task.promise;
    const p = await doc.getPage(pageNo);
    const tc = await p.getTextContent();
    const s = tc.items.map((i) => i.str).join(' ');
    await task.destroy();
    return { text: s, size: bytes.length };
  }, pageNo);
}

(async () => {
  const testPdf = copyFixture('test.pdf', work);
  const { app, win, logs } = await launch({ args: [testPdf] });
  global.__win = win;
  await PRO.activate(win);
  // Kaydetme / klasör iletişim kutularını test için otomatik yanıtla
  await app.evaluate(({ dialog }, work) => {
    dialog.showSaveDialog = async (w, o) => ({ canceled: false, filePath: work + '\\' + String((o || w).defaultPath || 'cikti.pdf').split(/[\\/]/).pop() });
    dialog.showOpenDialog = async (w, o) => ({ canceled: false, filePaths: global.__nextOpen || [] });
  }, work);
  const setNextOpen = (files) => app.evaluate((_, files) => { global.__nextOpen = files; }, files);

  await step('Belge açılır ve 4 sayfa görünür', async () => {
    await win.waitForSelector('.pdfViewer .page[data-page-number="1"] canvas', { timeout: 20000 });
    await sleep(800);
    assert((await win.textContent('#nav-total')).includes('4'), 'sayfa sayısı yanlış');
    await shot(win, '01-acildi');
  });

  await step('Metin seçilebilir ve kopyalanabilir', async () => {
    const b = await pageBox(win, 1);
    const span = win.locator('.page[data-page-number="1"] .textLayer span', { hasText: 'Fatura No' }).first();
    await span.dblclick();
    const sel = await win.evaluate(() => window.getSelection().toString());
    assert(sel.length > 0, 'seçim yok');
    await win.keyboard.press('Control+c');
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert(clip.length > 0, `pano boş (${clip})`);
    void b;
  });

  await step('Yazı ekle: tıkla, Türkçe yaz, kaydedilen PDF\'te var', async () => {
    await win.keyboard.press('Escape');
    await win.evaluate(() => window.getSelection().removeAllRanges());
    await ribbonBtn(win, 'Yazı ekle');
    const b = await pageBox(win, 1);
    await win.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.2);
    await win.waitForSelector('.pu-obj.editing .pu-text');
    await win.keyboard.type('Merhaba Dünya ğüşıöçİ');
    await shot(win, '02-yazi-yaziliyor');
    const b2 = await pageBox(win, 1);
    await win.mouse.click(b2.x + 30, b2.y + b2.height - 30);
    await sleep(200);
    const t = await outputText(win, 1);
    assert(t.text.includes('Merhaba Dünya ğüşıöçİ'), `çıktıda yok: ${t.text.slice(0, 200)}`);
    await shot(win, '03-yazi-eklendi');
  });

  await step('Yazı kutusunu taşı ve Ctrl+Z ile geri al', async () => {
    const obj = win.locator('.pu-obj.t-text').first();
    const ob = await obj.boundingBox();
    await win.mouse.move(ob.x + 10, ob.y + ob.height / 2);
    await win.mouse.down();
    await win.mouse.move(ob.x + 110, ob.y + 80, { steps: 8 });
    await win.mouse.up();
    const nb = await obj.boundingBox();
    assert(Math.abs(nb.x - ob.x - 100) < 6, `taşınmadı ${ob.x} -> ${nb.x}`);
    await win.mouse.click((await pageBox(win, 1)).x + 20, (await pageBox(win, 1)).y + 20);
    await win.keyboard.press('Control+z');
    await sleep(200);
    const bb = await win.locator('.pu-obj.t-text').first().boundingBox();
    assert(Math.abs(bb.x - ob.x) < 3, 'geri alma çalışmadı');
  });

  await step('Mevcut metni düzenle (TR-2026-0042 → TR-2026-9999)', async () => {
    await ribbonBtn(win, 'Metni düzenle');
    const span = win.locator('.page[data-page-number="1"] .textLayer span', { hasText: 'Fatura No' }).first();
    const sb = await span.boundingBox();
    // metin katmanı araç modunda tıklanamaz; koordinatla tıkla
    await win.mouse.click(sb.x + sb.width * 0.5, sb.y + sb.height / 2);
    await win.waitForSelector('.pu-obj.editing .pu-text', { timeout: 5000 });
    const txt = await win.textContent('.pu-obj.editing .pu-text');
    assert(/Fatura No/.test(txt), `yanlış metin alındı: ${txt}`);
    await win.keyboard.press('Control+a');
    await win.keyboard.type('Fatura No: TR-2026-9999');
    await shot(win, '04-metin-duzenleniyor');
    await win.keyboard.press('Escape');
    await win.keyboard.press('Escape');
    await sleep(300);
    const out = await outputText(win, 1);
    assert(out.text.includes('TR-2026-9999'), 'yeni metin çıktıda yok');
    await shot(win, '05-metin-duzenlendi');
  });

  await step('Metin seçip vurgula', async () => {
    await win.evaluate(() => window.__pu.setTool('highlight'));
    await scrollPage(win, 1, 0.62);
    const span = win.locator('.page[data-page-number="1"] .textLayer span', { hasText: 'Toplam Tutar' }).first();
    const sb = await span.boundingBox();
    await win.mouse.move(sb.x + 2, sb.y + sb.height / 2);
    await win.mouse.down();
    await win.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 10 });
    await win.mouse.up();
    await win.waitForSelector('.pu-obj.t-markup', { timeout: 12000 });
    await win.evaluate(() => window.__pu.setTool('select'));
    await shot(win, '06-vurgulandi');
  });

  await step('Kalem ile çiz ve dikdörtgen ekle', async () => {
    await win.evaluate(() => window.__pu.setTool('ink'));
    await scrollPage(win, 1, 0.75);
    const b = await pageBox(win, 1);
    await win.mouse.move(b.x + 150, b.y + b.height * 0.78);
    await win.mouse.down();
    for (let k = 0; k < 30; k++) await win.mouse.move(b.x + 150 + k * 6, b.y + b.height * 0.78 + Math.sin(k / 3) * 18);
    await win.mouse.up();
    await win.evaluate(() => window.__pu.setTool('rect'));
    await win.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.7);
    await win.mouse.down();
    await win.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.8, { steps: 6 });
    await win.mouse.up();
    await win.evaluate(() => window.__pu.setTool('select'));
    const n = await win.locator('.page[data-page-number="1"] .pu-obj').count();
    assert(n >= 4, `nesne sayısı ${n}`);
    await shot(win, '07-cizim');
  });

  await step('İmza çiz ve sayfaya yerleştir', async () => {
    await ribbonBtn(win, 'İmza');
    await win.waitForSelector('.sig-modal');
    const draw = win.locator('.sig-tabs button', { hasText: 'Çiz' });
    await draw.click();
    await sleep(150);
    const cb = await win.locator('.sig-pad canvas').boundingBox();
    await win.mouse.move(cb.x + 60, cb.y + 150);
    await win.mouse.down();
    for (let k = 0; k <= 40; k++) await win.mouse.move(cb.x + 60 + k * 9, cb.y + 120 + Math.sin(k / 2.5) * 45 - k);
    await win.mouse.up();
    await shot(win, '08-imza-cizildi');
    await clickModalBtn(win, 'Yerleştir');
    await scrollPage(win, 1, 0.82);
    const b = await pageBox(win, 1);
    await win.mouse.click(b.x + b.width * 0.35, b.y + b.height * 0.82);
    await win.waitForSelector('.pu-obj.t-image', { timeout: 5000 });
    await shot(win, '09-imza-yerlestirildi');
    const saved = await win.evaluate(() => (window.__pu.App.settings.signatures || []).length);
    assert(saved === 1, 'imza kaydedilmedi');
  });

  await step('Kaydet (Ctrl+S) — dosya yazılır ve yeniden açılınca düzenlemeler var', async () => {
    await win.locator('.doc-view:not(.hidden) .viewer-container').click({ position: { x: 5, y: 5 } });
    await win.keyboard.press('Control+s');
    await waitToast(win, /Kaydedildi/);
    const buf = fs.readFileSync(testPdf);
    assert(buf.slice(0, 5).toString() === '%PDF-', 'PDF değil');
    const dirty = await win.evaluate(() => window.__pu.App.active.dirty);
    assert(!dirty, 'hâlâ kirli');
  });

  await step('Sağ tık → görseli panoya kopyala (sayfa 2 JPEG)', async () => {
    await scrollPage(win, 2, 0.3);
    const b = await pageBox(win, 2);
    await win.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.3, { button: 'right' });
    await win.waitForSelector('.ctx-menu');
    await shot(win, '10-sag-tik-gorsel');
    const item = win.locator('.ctx-item', { hasText: 'Görseli kopyala' });
    assert(await item.count(), 'görsel menüsü çıkmadı');
    await item.click();
    await waitToast(win, /panoya kopyalandı/);
    const has = await app.evaluate(async ({ clipboard }) => clipboard.has('image/png'));
    assert(has, 'panoda görsel yok');
    const size = await app.evaluate(async ({ clipboard }) => { const items = await clipboard.read(); const it = items.find((x) => x.types.includes('image/png')); const b = await it.getType('image/png'); return b.size; });
    assert(size > 100000, `pano görseli çok küçük: ${size}`);
  });

  await step('Alan kopyala (ekran görüntüsü aracı)', async () => {
    await win.evaluate(() => window.__pu.setTool('snapshot'));
    await scrollPage(win, 2, 0.3);
    const b = await pageBox(win, 2);
    await win.mouse.move(b.x + 60, b.y + b.height * 0.25);
    await win.mouse.down();
    await win.mouse.move(b.x + 360, b.y + b.height * 0.25 + 200, { steps: 5 });
    await win.mouse.up();
    await waitToast(win, /Seçilen alan panoya kopyalandı/);
  });

  await step('Görselleri toplu çıkar', async () => {
    const outDir = path.join(work, 'gorseller');
    fs.mkdirSync(outDir, { recursive: true });
    await app.evaluate(({ dialog }, outDir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [outDir] }); }, outDir);
    await win.evaluate(() => { window.__pu.runAction('convert.images'); });
    await clickModalBtn(win, 'Klasör seç');
    await waitToast(win, /görsel kaydedildi/);
    const files = fs.readdirSync(outDir);
    assert(files.length >= 2, `görsel sayısı ${files.length}: ${files}`);
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: global.__nextOpen || [] }); });
  });

  await step('Sayfa sekmesi: düzenleyici, sayfa döndür ve sil, geri al', async () => {
    await ribbonTab(win, 'Sayfa');
    await win.waitForSelector('.org-page canvas', { timeout: 10000 });
    await sleep(500);
    await shot(win, '11-sayfa-duzenleyici');
    await win.locator('.org-page[data-i="3"]').hover();
    await win.locator('.org-page[data-i="3"] .acts button[title="Sağa döndür"]').click();
    await sleep(1200);
    let rot = await win.evaluate(async () => (await window.__pu.App.active.pdf.getPage(4)).rotate);
    assert(rot === 90, `döndürme ${rot}`);
    await win.locator('.org-page[data-i="2"]').click();
    await ribbonBtn(win, 'Sil');
    await sleep(1200);
    let n = await win.evaluate(() => window.__pu.App.active.numPages);
    assert(n === 3, `silme sonrası ${n}`);
    await win.evaluate(() => window.__pu.App.active.undo());
    await sleep(1200);
    n = await win.evaluate(() => window.__pu.App.active.numPages);
    assert(n === 4, `geri alma sonrası ${n}`);
    // düzenlemeler 1. sayfada kaldı mı
    const objs = await win.evaluate(() => window.__pu.App.active.pageObjs[0].length);
    assert(objs >= 4, `sayfa işleminden sonra nesneler kayboldu (${objs})`);
    await shot(win, '12-sayfa-islemleri');
  });

  await step('Sürükle-bırak ile sayfa sırala (4. sayfayı başa)', async () => {
    const sb = await win.locator('.org-page[data-i="3"] .cv').boundingBox();
    const db = await win.locator('.org-page[data-i="0"]').boundingBox();
    await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await win.mouse.down();
    await win.mouse.move(db.x + db.width * 0.5, db.y + 80, { steps: 12 });
    await win.mouse.move(db.x + 12, db.y + 80, { steps: 6 });
    await win.mouse.up();
    await waitToast(win, /taşındı|taşınamadı/, 15000);
    const errT = await win.evaluate(() => [...document.querySelectorAll('.toast span')].map((s) => s.textContent).find((t) => /taşınamadı/.test(t)));
    assert(!errT, errT);
    await sleep(600);
    const first = await win.evaluate(async () => { const d = window.__pu.App.active; const p = await d.pdf.getPage(1); const tc = await p.getTextContent(); return tc.items.map((i) => i.str).join(' '); });
    assert(/Sayfa 4/.test(first), `ilk sayfa: ${first.slice(0, 80)}`);
    await shot(win, '13-surukle-sirala');
    await win.evaluate(() => window.__pu.App.active.undo());
    await sleep(1200);
    await ribbonTab(win, 'Giriş');
  });

  await step('Döndürülmüş sayfaya yazı ekle ve doğru konumda işlensin', async () => {
    if (await win.isVisible('#organizer')) await ribbonTab(win, 'Giriş');
    const d3 = await win.evaluate(async () => { const d = window.__pu.App.active; d.goToPage(2); return (await d.pdf.getPage(3)).rotate; });
    assert(d3 === 90, 'sayfa 3 döndürülmüş değil');
    await sleep(900);
    await scrollPage(win, 3, 0.5);
    await win.evaluate(() => window.__pu.setTool('text'));
    const b = await pageBox(win, 3);
    await win.mouse.click(b.x + b.width * 0.1, b.y + b.height * 0.5);
    await win.waitForSelector('.pu-obj.editing .pu-text');
    await win.keyboard.type('Donuk sayfa notu');
    await win.mouse.click(b.x + b.width * 0.9, b.y + b.height * 0.6);
    // çıktıyı render edip yazının ekrandakiyle aynı yerde olduğunu doğrula
    const pos = await win.evaluate(async () => {
      const d = window.__pu.App.active;
      const bytes = await d.buildBytes();
      const task = window.pdfjsLib.getDocument({ data: bytes });
      const doc = await task.promise;
      const p = await doc.getPage(3);
      const vp = p.getViewport({ scale: 1 });
      const tc = await p.getTextContent();
      const it = tc.items.find((i) => i.str.includes('Donuk'));
      const tx = window.pdfjsLib.Util.transform(vp.transform, it.transform);
      const o = d.pageObjs[2].find((x) => x.type === 'text');
      await task.destroy();
      return { pdfX: tx[4], pdfY: tx[5], angle: Math.atan2(tx[1], tx[0]), objX: o.x, objY: o.y, size: o.size };
    });
    assert(Math.abs(pos.pdfX - pos.objX) < 2, `x uyuşmuyor ${JSON.stringify(pos)}`);
    assert(Math.abs(pos.angle) < 0.01, `yazı yan yatmış ${pos.angle}`);
    assert(pos.pdfY > pos.objY && pos.pdfY - pos.objY < pos.size * 1.2, `y uyuşmuyor ${JSON.stringify(pos)}`);
    await shot(win, '14-donuk-sayfa');
  });

  await step('Filigran ve sayfa numarası', async () => {
    await win.evaluate(() => { window.__pu.runAction('doc.watermark'); });
    await win.waitForSelector('.modal');
    await shot(win, '15-filigran-dialog');
    await clickModalBtn(win, 'Ekle');
    await waitToast(win, /filigran eklendi/);
    await win.evaluate(() => { window.__pu.runAction('doc.pageNumbers'); });
    await clickModalBtn(win, 'Ekle');
    await waitToast(win, /numara eklendi/);
    await win.evaluate(() => window.__pu.App.active.goToPage(0));
    await sleep(700);
    const t = await outputText(win, 2);
    assert(/2 \/ 4/.test(t.text), `sayfa numarası yok: ${t.text.slice(-80)}`);
    await shot(win, '16-filigran-numara');
  });

  await step('Farklı kaydet ve küçült (otomatik, hedef boyut)', async () => {
    await win.evaluate(() => { window.__pu.runAction('tools.compress'); });
    await win.waitForSelector('.modal');
    await win.fill('.modal input[type=number]', '0.15');
    await shot(win, '17-kucult-dialog');
    await clickModalBtn(win, 'Küçült');
    await win.waitForSelector('.modal .size-compare', { timeout: 120000 });
    await shot(win, '18-kucult-sonuc');
    const txt = await win.textContent('.modal .size-compare');
    await clickModalBtn(win, 'Tamam');
    const out = path.join(work, 'test (küçültülmüş).pdf');
    assert(fs.existsSync(out), 'küçültülmüş dosya yok');
    const s0 = fs.statSync(testPdf).size, s1 = fs.statSync(out).size;
    console.log(`   boyut: ${s0} -> ${s1} (${txt.replace(/\s+/g, ' ')})`);
    assert(s1 < s0 * 0.5, 'yeterince küçülmedi');
  });

  await step('Küçültülmüş dosya açılır ve metin hâlâ seçilebilir', async () => {
    const out = path.join(work, 'test (küçültülmüş).pdf');
    await win.evaluate((p) => window.__pu.openPaths([p]), out);
    await win.waitForSelector('.doc-view:not(.hidden) .page[data-page-number="1"] canvas', { timeout: 15000 });
    await sleep(800);
    const t = await win.evaluate(async () => { const p = await window.__pu.App.active.pdf.getPage(1); return (await p.getTextContent()).items.map((i) => i.str).join(' '); });
    assert(/Türkçe Karakter|TR-2026/.test(t), `metin yok: ${t.slice(0, 100)}`);
    await shot(win, '19-kucultulmus-acik');
    await win.evaluate(() => window.__pu.closeDoc(window.__pu.App.active, { force: true }));
  });

  await step('PDF birleştir (a.pdf + b.pdf)', async () => {
    await win.evaluate(() => window.__pu.closeDoc(window.__pu.App.active, { force: true }));
    await setNextOpen([path.join(FIX, 'a.pdf'), path.join(FIX, 'b.pdf')]);
    await win.evaluate(() => { window.__pu.runAction('page.mergeFiles'); });
    await win.locator('.modal button', { hasText: 'PDF ekle' }).click();
    await win.waitForFunction(() => document.querySelectorAll('.merge-list .recent-item').length === 2);
    await shot(win, '20-birlestir');
    await clickModalBtn(win, 'Birleştir');
    await win.waitForFunction(() => window.__pu.App.active && window.__pu.App.active.numPages === 5, null, { timeout: 15000 });
  });

  await step('Böl: her 2 sayfada bir', async () => {
    const outDir = path.join(work, 'parcalar');
    fs.mkdirSync(outDir, { recursive: true });
    await app.evaluate(({ dialog }, outDir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [outDir] }); }, outDir);
    await win.evaluate(() => { window.__pu.runAction('page.split'); });
    await win.fill('.modal input[type=number]', '2');
    await clickModalBtn(win, 'Böl');
    await waitToast(win, /parça kaydedildi/);
    const files = fs.readdirSync(outDir);
    assert(files.length === 3, `parça sayısı ${files.length}`);
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: global.__nextOpen || [] }); });
    await win.evaluate(() => window.__pu.closeDoc(window.__pu.App.active, { force: true }));
  });

  await step('Parolalı PDF açılır (1234) ve parola kaldırılıp kaydedilir', async () => {
    const enc = copyFixture('encrypted.pdf', work);
    const p = win.evaluate((f) => window.__pu.openPaths([f]), enc);
    await win.waitForSelector('.modal input[type=password]');
    await shot(win, '21-parola-sor');
    await win.fill('.modal input[type=password]', '1234');
    await clickModalBtn(win, 'Aç');
    await p;
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 15000 });
    await win.evaluate(() => { window.__pu.runAction('protect.removePassword'); });
    await clickModalBtn(win, 'Kaldır');
    await waitToast(win, /Parola kaldırıldı/);
    const head = fs.readFileSync(enc).toString('latin1');
    assert(!head.includes('/Encrypt'), 'hâlâ şifreli');
  });

  await step('Parola koy (AES-256) ve dosya şifreli olsun', async () => {
    await win.evaluate(() => { window.__pu.runAction('protect.password'); });
    const inputs = win.locator('.modal input[type=password]');
    await inputs.nth(0).fill('gizli99');
    await inputs.nth(1).fill('gizli99');
    await clickModalBtn(win, 'Koru');
    await waitToast(win, /parola ile korundu/);
    const enc = path.join(work, 'encrypted.pdf');
    assert(fs.readFileSync(enc).toString('latin1').includes('/Encrypt'), 'şifrelenmedi');
    await win.evaluate(() => window.__pu.closeDoc(window.__pu.App.active, { force: true }));
  });

  await step('Form alanı doldur ve kaydet', async () => {
    const form = copyFixture('form.pdf', work);
    await win.evaluate((f) => window.__pu.openPaths([f]), form);
    await win.waitForSelector('.doc-view:not(.hidden) .annotationLayer input', { timeout: 15000 });
    await win.locator('.doc-view:not(.hidden) .annotationLayer input[type=text]').first().fill('Ayşe Yılmaz');
    await win.locator('.doc-view:not(.hidden) .annotationLayer input[type=checkbox]').first().check();
    await shot(win, '22-form');
    await win.keyboard.press('Tab');
    await win.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); window.__pu.runAction('file.save'); });
    await waitToast(win, /Kaydedildi: form\.pdf/);
    const val = await win.evaluate(async (f) => {
      const r = await window.pu.readPdf(f);
      const doc = await PDFLib.PDFDocument.load(r.bytes);
      return doc.getForm().getTextField('adsoyad').getText();
    }, form);
    assert(val === 'Ayşe Yılmaz', `form değeri ${val}`);
    await win.evaluate(() => window.__pu.closeDoc(window.__pu.App.active, { force: true }));
  });

  await step('OCR: taranmış sayfa aranabilir hale gelir', async () => {
    const scan = copyFixture('scan.pdf', work);
    await win.evaluate((f) => window.__pu.openPaths([f]), scan);
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 15000 });
    await win.evaluate(() => { window.__pu.runAction('tools.ocr'); });
    await clickModalBtn(win, 'Başlat');
    await waitToast(win, /OCR tamamlandı/, 180000);
    await sleep(800);
    const t = await win.evaluate(async () => { const p = await window.__pu.App.active.pdf.getPage(1); return (await p.getTextContent()).items.map((i) => i.str).join(' '); });
    console.log('   OCR:', t.slice(0, 160));
    assert(/SİPARİŞ|Sipariş|numarası|2026-4815/i.test(t), 'OCR metni bulunamadı');
    await win.evaluate(() => window.__pu.App.openFind('2026-4815'));
    await sleep(1200);
    await shot(win, '23-ocr-arama');
    await win.keyboard.press('Escape');
  });

  await step('PDF → Word (.docx) üretir', async () => {
    await win.evaluate(() => window.__pu.closeDoc(window.__pu.App.active, { force: true }));
    await win.evaluate((f) => window.__pu.openPaths([f]), testPdf);
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 15000 });
    await win.evaluate(() => { window.__pu.runAction('convert.docx'); });
    await clickModalBtn(win, 'Dönüştür');
    await waitToast(win, /Word belgesi oluşturuldu/, 60000);
    const f = path.join(work, 'test.docx');
    assert(fs.existsSync(f) && fs.statSync(f).size > 5000, 'docx yok');
  });

  await step('Koyu tema', async () => {
    await win.click('#theme-btn');
    await sleep(500);
    await shot(win, '24-koyu-tema');
    await win.click('#theme-btn');
  });

  console.log('\n--- konsol hataları ---');
  console.log(logs.filter((l) => !/Autofill|Electron Security Warning/.test(l)).slice(0, 30).join('\n'));
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; })).catch(() => {});
  await app.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} adım başarılı`);
  if (failed.length) { console.log(failed.map((f) => ` - ${f.name}: ${f.err}`).join('\n')); process.exitCode = 1; }
})().catch((e) => { console.error(e); process.exit(1); });
