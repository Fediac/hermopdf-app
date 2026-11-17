// Dönüştürme testleri: Görsel/Word/Metin → PDF ve PDF → Word/PNG/JPEG/Metin, gerçek kullanıcı akışıyla.
// Sistem pencereleri (aç/kaydet/klasör) kullanıcı dosya arıyormuş gibi gecikmeli döner; bu sırada
// "İşlem sürüyor" katmanının pencereleri kapatmaması da doğrulanır (kullanıcının yaşadığı donma hatası).
// Kullanım: node tests/convert.js [adım-süzgeci]    PACKAGED=1 ile kurulum klasörü test edilir.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const { launch, shot, sleep, FIX } = require('./harness');

const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const results = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-conv-'));
// İsteğe bağlı: kendi büyük görsellerinizle denemek için ortam değişkenleri (varsayılan: yalnızca sahte test dosyaları)
const REAL_SHOT = process.env.PU_REAL_SHOT || '';
const BIG_PNG = process.env.PU_BIG_PNG || '';

async function step(name, fn) {
  if (only && !only.test(name)) return;
  const t = Date.now();
  try {
    await global.__win.evaluate(() => { document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); });
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}: ${e.message.split('\n')[0]}`);
    await shot(global.__win, `FAILc-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };

(async () => {
  // --- test dosyaları ---
  const png = path.join(work, 'ekran.png');
  fs.copyFileSync(REAL_SHOT && fs.existsSync(REAL_SHOT) ? REAL_SHOT : path.join(FIX, 'logo.png'), png);
  const jpg = path.join(work, 'foto.jpg');
  fs.copyFileSync(path.join(FIX, 'photo.jpg'), jpg);
  const bmp = path.join(work, 'resim.bmp');
  const gif = path.join(work, 'resim.gif');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile('${jpg}'); $i.Save('${bmp}',[System.Drawing.Imaging.ImageFormat]::Bmp); $i.Save('${gif}',[System.Drawing.Imaging.ImageFormat]::Gif); $i.Dispose()`], { windowsHide: true });
  fs.writeFileSync(path.join(work, 'utf8.txt'), 'Başlık: Türkçe metin\r\nğüşıöç ĞÜŞİÖÇ — UTF-8 satırı\r\nSON SATIR\r\n', 'utf8');
  fs.writeFileSync(path.join(work, 'ansi.txt'), Buffer.from([...Buffer.from('Windows-1254: '), 0xF0, 0xFC, 0xFE, 0xFD, 0xF6, 0xE7, 0x20, 0xD0, 0xDC, 0xDE, 0xDD, 0xD6, 0xC7, 0x0D, 0x0A]));
  for (const f of ['rapor.docx', 'rapor-word.docx', 'rapor.doc', 'rapor.odt', 'kisa.rtf', 'test.pdf']) fs.copyFileSync(path.join(FIX, f), path.join(work, f));

  const { app, win, logs } = await launch();
  global.__win = win;
  // Sistem pencereleri: kullanıcı dosya ararken birkaç saniye açık kalır
  await app.evaluate(({ dialog }, work) => {
    global.__delay = 2500;
    const wait = () => new Promise((r) => setTimeout(r, global.__delay));
    dialog.showOpenDialog = async (w, o) => { await wait(); return { canceled: false, filePaths: (o || w).properties?.includes('openDirectory') ? [global.__folder || work] : (global.__nextOpen || []) }; };
    dialog.showSaveDialog = async (w, o) => { await wait(); return { canceled: false, filePath: work + '\\' + String((o || w).defaultPath || 'x.pdf').split(/[\\/]/).pop() }; };
  }, work);
  const setNextOpen = (files) => app.evaluate((_, f) => { global.__nextOpen = f; }, files);
  const docCount = () => win.evaluate(() => window.__pu.App.docs.length);
  const closeAll = () => win.evaluate(async () => { for (const d of [...window.__pu.App.docs]) await window.__pu.closeDoc(d, { force: true }); });
  const waitNewDocs = async (n0, n = 1, timeout = 90000) => {
    await win.waitForFunction(([a, b]) => window.__pu.App.docs.length >= a + b, [n0, n], { timeout });
    await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 30000 });
    await sleep(400);
  };
  const activeInfo = () => win.evaluate(async () => {
    const d = window.__pu.App.active;
    const pages = [];
    let text = '';
    for (let i = 1; i <= d.numPages; i++) {
      const p = await d.pdf.getPage(i);
      pages.push(p.view.slice(2).map(Math.round));
      text += (await p.getTextContent()).items.map((t) => t.str).join(' ').replace(/\s+/g, ' ') + '\n';
    }
    return { name: d.name, n: d.numPages, pages, text, dirty: d.dirty };
  });
  const clearToasts = () => win.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const toastText = () => win.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  // Sistem penceresi açıkken ve sonrasında meşgul katmanı pencereyi kapatmasın
  const assertClickable = async (label) => {
    const r = await win.evaluate((label) => {
      const b = [...document.querySelectorAll('.modal .modal-foot button')].find((x) => x.textContent.includes(label));
      if (!b) return { found: false };
      const rc = b.getBoundingClientRect();
      const hit = document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2);
      return { found: true, ok: hit === b || b.contains(hit), hit: hit?.className, busy: !!document.querySelector('.busy-overlay') };
    }, label);
    assert(r.found, `"${label}" düğmesi yok`);
    assert(r.ok, `"${label}" düğmesinin üstünde başka katman var: ${r.hit}`);
  };
  const startJank = () => win.evaluate(() => {
    window.__jank = { max: 0, last: performance.now(), on: true };
    const tick = () => { const j = window.__jank; if (!j.on) return; const t = performance.now(); j.max = Math.max(j.max, t - j.last); j.last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const stopJank = () => win.evaluate(() => { window.__jank.on = false; return Math.round(window.__jank.max); });

  try {
    await sleep(800);

    // ================= Görsel → PDF =================
    await step('Görsel → PDF: dosya penceresi uzun açık kalsa da pencere tıklanabilir (kullanıcının hatası)', async () => {
      await setNextOpen([png]);
      const n0 = await docCount();
      await win.evaluate(() => { window.__pu.runAction('convert.imagesToPdf'); });
      await sleep(1500); // sistem penceresi hâlâ açık
      const during = await win.evaluate(() => !!document.querySelector('.busy-overlay'));
      assert(!during, 'dosya penceresi açıkken "İşlem sürüyor" katmanı çıktı');
      await win.waitForSelector('.modal .modal-foot button:has-text("PDF oluştur")', { timeout: 20000 });
      await sleep(900); // eski hatada katman 400 ms sonra pencerenin üstüne çıkıyordu
      await assertClickable('PDF oluştur');
      await shot(win, 'c01-gorsel-pencere');
      await win.locator('.modal .modal-foot button', { hasText: 'PDF oluştur' }).click({ timeout: 3000 });
      await waitNewDocs(n0);
      const info = await activeInfo();
      assert(info.n === 1, `sayfa ${info.n}`);
      assert(/\.pdf$/.test(info.name), info.name);
      await shot(win, 'c02-gorsel-pdf');
    });

    await step('Görsel → PDF: PNG + JPEG + BMP + GIF + WEBP + saydam PNG tek belgede, yönler doğru', async () => {
      // WEBP ve saydam PNG'yi uygulamanın tuvaliyle üret
      const made = await win.evaluate(async () => {
        const mk = async (w, h, type, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const b = await new Promise((r) => c.toBlob(r, type, 0.9)); return btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer()))); };
        const webp = await mk(900, 500, 'image/webp', (x) => { x.fillStyle = '#2a6'; x.fillRect(0, 0, 900, 500); x.fillStyle = '#fff'; x.font = '60px sans-serif'; x.fillText('WEBP yatay', 200, 270); });
        const alpha = await mk(600, 600, 'image/png', (x) => { x.fillStyle = '#d62839'; x.beginPath(); x.arc(300, 300, 200, 0, Math.PI * 2); x.fill(); });
        return { webp, alpha };
      });
      const webp = path.join(work, 'yatay.webp');
      const alpha = path.join(work, 'saydam.png');
      fs.writeFileSync(webp, Buffer.from(made.webp, 'base64'));
      fs.writeFileSync(alpha, Buffer.from(made.alpha, 'base64'));
      const list = [png, jpg, bmp, gif, webp, alpha];
      if (BIG_PNG && fs.existsSync(BIG_PNG)) list.push(BIG_PNG);
      await setNextOpen(list);
      await app.evaluate(() => { global.__delay = 600; });
      const n0 = await docCount();
      await win.evaluate(() => { window.__pu.runAction('convert.imagesToPdf'); });
      await win.waitForSelector('.modal .modal-foot button:has-text("PDF oluştur")', { timeout: 20000 });
      const thumbs = await win.evaluate(() => document.querySelectorAll('.modal img').length);
      assert(thumbs === list.length, `küçük resim ${thumbs}/${list.length}`);
      await shot(win, 'c03-coklu-gorsel');
      await startJank();
      const t0 = Date.now();
      await win.locator('.modal .modal-foot button', { hasText: 'PDF oluştur' }).click();
      await waitNewDocs(n0);
      const ms = Date.now() - t0;
      const jank = await stopJank();
      const info = await activeInfo();
      assert(info.n === list.length, `sayfa ${info.n}/${list.length}`);
      const land = info.pages.map(([w, h]) => w > h);
      assert(land[4] === true, `WEBP yatay sayfa olmalı: ${JSON.stringify(info.pages)}`);
      assert(land[5] === false, 'kare görsel dikey A4 olmalı');
      // Saydam PNG: daire dışı beyaz olmalı (siyah değil)
      const px = await win.evaluate(async () => {
        const d = window.__pu.App.active;
        const p = await d.pdf.getPage(6);
        const vp = p.getViewport({ scale: 0.5 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        await p.render({ canvas: c, viewport: vp, background: '#ffffff' }).promise;
        const x = c.getContext('2d');
        const at = (fx, fy) => [...x.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)];
        return { corner: at(0.12, 0.32), center: at(0.5, 0.5) };
      });
      assert(px.corner.every((v) => v > 240), `saydam alan beyaz değil: ${px.corner}`);
      assert(px.center[0] > 180 && px.center[1] < 90, `daire kırmızı değil: ${px.center}`);
      console.log(`   ${list.length} görsel → ${ms} ms, en uzun arayüz donması ${jank} ms`);
      assert(jank < 900, `arayüz ${jank} ms dondu`);
      await win.evaluate(() => window.__pu.setScale && window.__pu.setScale(0.5)).catch(() => {});
      await shot(win, 'c04-coklu-gorsel-pdf');
    });

    await step('Görsel → PDF: liste açıkken sonradan görsel ekleme (düğme + sürükle-bırak + boş durum)', async () => {
      await app.evaluate(() => { global.__delay = 400; });
      await setNextOpen([png, jpg]);
      const n0 = await docCount();
      await win.evaluate(() => { window.__pu.runAction('convert.imagesToPdf'); });
      await win.waitForSelector('.modal .modal-foot button:has-text("PDF oluştur")', { timeout: 20000 });
      const count = () => win.evaluate(() => document.querySelectorAll('.modal img').length);
      const title = () => win.evaluate(() => document.querySelector('.modal .modal-head h3').textContent);
      assert((await count()) === 2 && /\(2\)/.test(await title()), `başlangıç ${await count()} ${await title()}`);
      // 1) "+ Görsel ekle" düğmesi: aynı dosya adı tekrar eklenebilir
      await setNextOpen([jpg]);
      await win.locator('.modal button', { hasText: 'Görsel ekle' }).click();
      await win.waitForFunction(() => document.querySelectorAll('.modal img').length === 3, null, { timeout: 10000 });
      assert(/\(3\)/.test(await title()), `başlık ${await title()}`);
      // 2) Pencerenin üstüne sürükle-bırak: görsel eklenir, görsel olmayan sessizce yok sayılır; genel "pencereyi kapatın" uyarısı çıkmaz
      await clearToasts();
      await win.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'birakilan.jpg', { type: 'image/jpeg' }));
        dt.items.add(new File(['merhaba'], 'not.txt', { type: 'text/plain' }));
        document.querySelector('.modal-backdrop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, fs.readFileSync(jpg).toString('base64'));
      await win.waitForFunction(() => document.querySelectorAll('.modal img').length === 4, null, { timeout: 10000 });
      assert(!/Önce açık pencereyi/.test(await toastText()), 'genel bırakma uyarısı çıktı');
      // 3) Sil: dördüncüyü kaldır → 3
      await win.locator('.modal .icon-btn').nth(0).waitFor();
      await win.evaluate(() => { const cells = document.querySelectorAll('.modal img'); const cell = cells[3].parentElement; cell.querySelector('.row .icon-btn:nth-child(2)').click(); });
      await win.waitForFunction(() => document.querySelectorAll('.modal img').length === 3, null, { timeout: 10000 });
      await shot(win, 'c03b-gorsel-ekleme');
      await win.locator('.modal .modal-foot button', { hasText: 'PDF oluştur' }).click();
      await waitNewDocs(n0);
      assert((await activeInfo()).n === 3, `sayfa ${(await activeInfo()).n}/3`);
      // 4) Boş durum: hepsini silince metin görünür, "PDF oluştur" devre dışı
      await setNextOpen([png]);
      await win.evaluate(() => { window.__pu.runAction('convert.imagesToPdf'); });
      await win.waitForSelector('.modal .modal-foot button:has-text("PDF oluştur")', { timeout: 20000 });
      await win.evaluate(() => document.querySelector('.modal img').parentElement.querySelector('.row .icon-btn:nth-child(2)').click());
      await win.waitForFunction(() => document.querySelectorAll('.modal img').length === 0, null, { timeout: 5000 });
      const empty = await win.evaluate(() => ({ note: /Henüz görsel yok/.test(document.querySelector('.modal').textContent), dis: [...document.querySelectorAll('.modal .modal-foot button')].find((b) => /PDF oluştur/.test(b.textContent)).disabled }));
      assert(empty.note && empty.dis, `boş durum: ${JSON.stringify(empty)}`);
      await win.locator('.modal button', { hasText: 'Vazgeç' }).click();
    });

    await step('Görsel sürükle-bırak (açık belge yokken) → PDF', async () => {
      await closeAll();
      await sleep(400);
      const n0 = await docCount();
      await win.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'surukle.jpg', { type: 'image/jpeg' }));
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, fs.readFileSync(jpg).toString('base64'));
      await win.waitForSelector('.modal .modal-foot button:has-text("PDF oluştur")', { timeout: 10000 });
      await assertClickable('PDF oluştur');
      await win.locator('.modal .modal-foot button', { hasText: 'PDF oluştur' }).click();
      await waitNewDocs(n0);
      assert((await activeInfo()).n === 1, 'sayfa sayısı');
    });

    // ================= Word → PDF =================
    await step('Word → PDF (Microsoft Word ile): 5 sayfa, Türkçe, tablo, sayfa no', async () => {
      await app.evaluate(() => { global.__delay = 2500; });
      await setNextOpen([path.join(work, 'rapor-word.docx')]);
      const n0 = await docCount();
      await clearToasts();
      await win.evaluate(() => { window.__pu.runAction('convert.wordToPdf'); });
      await sleep(1500);
      assert(!(await win.evaluate(() => !!document.querySelector('.busy-overlay'))), 'dosya penceresi açıkken meşgul katmanı çıktı');
      await win.waitForSelector('.progress-modal', { timeout: 15000 });
      await shot(win, 'c05-word-donusturuluyor');
      // Word başka bir süreçte çalışır: dönüşüm boyunca arayüz akıcı kalmalı (ekran görüntüsü dışında ölç)
      await startJank();
      await win.waitForFunction((a) => window.__pu.App.docs.length > a, n0, { timeout: 150000 });
      const jank = await stopJank();
      await waitNewDocs(n0, 1, 30000);
      const info = await activeInfo();
      assert(info.n === 5, `sayfa ${info.n}`);
      assert(/SON SATIR/.test(info.text) && /Ğ Ü Ş İ Ö Ç/.test(info.text), 'metin eksik');
      assert(/Sayfa 3/.test(info.text), 'sayfa numarası yok');
      assert(info.name === 'rapor-word.pdf', info.name);
      assert(/Microsoft Word ile/.test(await toastText()), `bildirim: ${await toastText()}`);
      console.log(`   arayüz en uzun donma: ${jank} ms`);
      assert(jank < 600, `Word dönüşümünde arayüz ${jank} ms dondu`);
      await shot(win, 'c06-word-pdf');
    });

    await step('Word → PDF: .doc + .rtf + .odt birlikte (3 sekme)', async () => {
      await app.evaluate(() => { global.__delay = 500; });
      await setNextOpen(['rapor.doc', 'kisa.rtf', 'rapor.odt'].map((f) => path.join(work, f)));
      const n0 = await docCount();
      await clearToasts();
      await win.evaluate(() => { window.__pu.runAction('convert.wordToPdf'); });
      await waitNewDocs(n0, 3, 240000);
      const names = await win.evaluate(() => window.__pu.App.docs.slice(-3).map((d) => `${d.name}:${d.numPages}`));
      assert(names.join() === 'rapor.pdf:5,kisa.pdf:1,rapor.pdf:5', names.join());
      assert(/SON SATIR/.test((await activeInfo()).text), 'odt metni');
    });

    await step('Word → PDF (dahili motor, Word yokmuş gibi): Word\'e çok yakın sonuç', async () => {
      const n0 = await docCount();
      await clearToasts();
      await win.evaluate((p) => import('app://pu/src/renderer/js/convert.js').then((m) => { m.wordToPdf([{ path: p, name: 'rapor-word.docx' }], { engine: 'builtin' }); }), path.join(work, 'rapor-word.docx'));
      await waitNewDocs(n0, 1, 120000);
      const info = await activeInfo();
      assert(info.n >= 5 && info.n <= 6, `sayfa ${info.n}`);
      assert(/SON SATIR/.test(info.text) && /Ğ Ü Ş İ Ö Ç/.test(info.text), 'metin eksik');
      assert(/Sayfa 2/.test(info.text), 'sayfa numarası yok');
      assert(/dahili motorla/.test(await toastText()), 'bildirim');
      await shot(win, 'c07-word-dahili');
    });

    await step('Word → PDF dahili motor: Word\'de hiç açılmamış belge sayfalara bölünür', async () => {
      const n0 = await docCount();
      await clearToasts();
      await win.evaluate((p) => import('app://pu/src/renderer/js/convert.js').then((m) => { m.wordToPdf([{ path: p, name: 'rapor.docx' }], { engine: 'builtin' }); }), path.join(work, 'rapor.docx'));
      await waitNewDocs(n0, 1, 120000);
      const info = await activeInfo();
      assert(info.n >= 5 && info.n <= 7, `sayfa ${info.n}`);
      assert(info.pages.every(([w, h]) => w === 595 && h === 842), `A4 değil: ${JSON.stringify(info.pages)}`);
      assert(/SON SATIR/.test(info.text), 'son satır kayıp (kesilmiş içerik)');
    });

    await step('Word → PDF: .docx sürükle-bırak', async () => {
      const n0 = await docCount();
      await win.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'Sürüklenen Rapor.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, fs.readFileSync(path.join(work, 'rapor-word.docx')).toString('base64'));
      await waitNewDocs(n0, 1, 150000);
      const info = await activeInfo();
      assert(info.name === 'Sürüklenen Rapor.pdf' && info.n === 5, `${info.name} ${info.n}`);
    });

    await step('Word → PDF: boş (0 bayt) Word dosyası anlaşılır hata verir', async () => {
      const empty = path.join(work, 'Word Test.docx');
      fs.writeFileSync(empty, '');
      await setNextOpen([empty]);
      const n0 = await docCount();
      await clearToasts();
      await win.evaluate(() => { window.__pu.runAction('convert.wordToPdf'); });
      await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /boş/.test(t.textContent)), null, { timeout: 30000 });
      assert((await docCount()) === n0, 'boş dosyadan sekme açılmamalı');
      await shot(win, 'c08-bos-word-hata');
    });

    await step('Dönüştür sekmesinde Word → PDF düğmesi görünür', async () => {
      await win.locator('.ribbon-tabs button, .rtab, [data-tab]', { hasText: 'Dönüştür' }).first().click();
      await sleep(400);
      const has = await win.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Word → PDF/.test(b.textContent)));
      assert(has, 'düğme yok');
      await shot(win, 'c09-donustur-sekmesi');
    });

    // ================= Metin / boş =================
    await step('Metin → PDF: UTF-8 ve Windows-1254 Türkçe karakterler', async () => {
      await app.evaluate(() => { global.__delay = 300; });
      for (const [f, re] of [['utf8.txt', /ğüşıöç ĞÜŞİÖÇ/], ['ansi.txt', /ğüşıöç ĞÜŞİÖÇ/]]) {
        await setNextOpen([path.join(work, f)]);
        const n0 = await docCount();
        await win.evaluate(() => { window.__pu.runAction('convert.textToPdf'); });
        await waitNewDocs(n0);
        const info = await activeInfo();
        assert(re.test(info.text.replace(/\s+/g, ' ')), `${f}: ${info.text.slice(0, 120)}`);
      }
    });

    await step('Boş PDF oluşturulur (A4, 1 sayfa)', async () => {
      const n0 = await docCount();
      await win.evaluate(() => { window.__pu.runAction('file.new'); });
      await waitNewDocs(n0);
      const info = await activeInfo();
      assert(info.n === 1 && info.pages[0][0] === 595 && info.pages[0][1] === 842, JSON.stringify(info.pages));
    });

    // ================= PDF'ten =================
    await step('PDF → Word (düzenlenebilir) ve PDF → Word (birebir görünüm)', async () => {
      await closeAll();
      await win.evaluate((f) => window.__pu.openPaths([f]), path.join(work, 'test.pdf'));
      await win.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 20000 });
      const pdfText = (await activeInfo()).text;
      const word = pdfText.split(/\s+/).find((w) => w.length > 6 && /^[\wçğıöşüÇĞİÖŞÜ-]+$/.test(w));
      for (const mode of ['text', 'image']) {
        const target = path.join(work, 'test.docx');
        if (fs.existsSync(target)) fs.rmSync(target);
        await clearToasts();
        await win.evaluate(() => { window.__pu.runAction('convert.docx'); });
        await win.waitForSelector('.modal .modal-foot button:has-text("Dönüştür")');
        await win.locator('.modal select').first().selectOption(mode);
        await win.locator('.modal .modal-foot button', { hasText: 'Dönüştür' }).click();
        await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Word belgesi oluşturuldu/.test(t.textContent)), null, { timeout: 90000 });
        assert(fs.existsSync(target), 'docx yazılmadı');
        const zip = await JSZip.loadAsync(fs.readFileSync(target));
        const list = Object.keys(zip.files).join('\n');
        if (mode === 'text') {
          const xml = await zip.file('word/document.xml').async('string');
          assert(xml.includes(word), `metin Word'de yok: ${word}`);
        } else {
          const media = list.split(/\r?\n/).filter((l) => /word\/media\//.test(l)).length;
          assert(media === (await activeInfo()).n, `görsel ${media}`);
        }
      }
    });

    await step('PDF → PNG ve PDF → JPEG (klasöre)', async () => {
      for (const fmt of ['png', 'jpeg']) {
        const out = path.join(work, `sayfalar-${fmt}`);
        fs.mkdirSync(out, { recursive: true });
        await app.evaluate((_, o) => { global.__folder = o; }, out);
        await clearToasts();
        await win.evaluate((f) => { window.__pu.runAction(`convert.${f}`); }, fmt);
        await win.locator('.modal .modal-foot button', { hasText: 'Klasör seç' }).click();
        await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /görüntü kaydedildi/.test(t.textContent)), null, { timeout: 60000 });
        const files = fs.readdirSync(out);
        const n = (await activeInfo()).n;
        assert(files.length === n, `${fmt}: ${files.length}/${n}`);
        const head = fs.readFileSync(path.join(out, files[0])).subarray(0, 4).toString('hex');
        assert(fmt === 'png' ? head === '89504e47' : head.startsWith('ffd8'), `${fmt} geçersiz: ${head}`);
      }
      await app.evaluate(() => { global.__folder = null; });
    });

    await step('PDF → Metin (.txt)', async () => {
      await clearToasts();
      await win.evaluate(() => { window.__pu.runAction('convert.txt'); });
      await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Metin kaydedildi/.test(t.textContent)), null, { timeout: 30000 });
      const t = fs.readFileSync(path.join(work, 'test.txt'), 'utf8');
      assert(/----- Sayfa 1 -----/.test(t) && t.length > 100, t.slice(0, 100));
    });

    await step('Görselleri çıkar (klasöre)', async () => {
      const out = path.join(work, 'gorseller');
      fs.mkdirSync(out, { recursive: true });
      await app.evaluate((_, o) => { global.__folder = o; }, out);
      await clearToasts();
      await win.evaluate(() => { window.__pu.runAction('convert.images'); });
      await win.locator('.modal .modal-foot button', { hasText: 'Klasör seç' }).click();
      await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /görsel kaydedildi/.test(t.textContent)), null, { timeout: 30000 });
      assert(fs.readdirSync(out).length >= 1, 'görsel yok');
      await app.evaluate(() => { global.__folder = null; });
    });

    await step('Başlangıç ekranında Word → PDF kutusu', async () => {
      await closeAll();
      await sleep(500);
      const has = await win.evaluate(() => [...document.querySelectorAll('#start .quick button')].some((b) => /Word → PDF/.test(b.textContent)));
      assert(has, 'kutu yok');
      await shot(win, 'c10-baslangic');
    });
  } catch (e) {
    console.log('BEKLENMEYEN:', e.message);
  }

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} adım başarılı`);
  const errs = logs.filter((l) => !/TT: undefined function|Electron Security Warning/.test(l));
  if (errs.length) console.log('Konsol:\n' + errs.slice(0, 15).join('\n'));
  await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; })).catch(() => {});
  await app.close();
  process.exit(bad.length ? 1 : 0);
})();
