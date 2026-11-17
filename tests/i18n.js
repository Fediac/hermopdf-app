// Arayüz dili ve tanıtım turu testleri.
// Çalıştır: node tests/i18n.js   (önce Electron'suz birim denetimleri, sonra uygulama ekran dışında açılır)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { launch, sleep, ROOT } = require('./harness');
const i18n = require('../src/main/i18n');

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}: ${e.message}`);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };
const eq = (a, b, m) => assert(a === b, `${m || ''} beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`);
const readSettings = (ud) => { try { return JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')); } catch (e) { return {}; } };

(async () => {
  // ---------------- Electron'suz ----------------
  await step('sistem dili eşleme (tr-TR, pt-PT, zh-CN, ar-SA, desteklenmeyen → en)', () => {
    eq(i18n.matchLocale(['tr-TR']), 'tr'); eq(i18n.matchLocale(['pt-PT']), 'pt-BR'); eq(i18n.matchLocale('pt_BR'), 'pt-BR');
    eq(i18n.matchLocale(['zh-CN']), 'zh-Hans'); eq(i18n.matchLocale(['ar-SA']), 'ar'); eq(i18n.matchLocale(['es-419']), 'es');
    eq(i18n.matchLocale(['xx-YY', 'de-AT']), 'de'); eq(i18n.matchLocale(['xx', 'yy']), 'en'); eq(i18n.matchLocale([]), 'en');
  });
  await step('eksik anahtar İngilizceye, o da yoksa anahtara düşer; yer tutucu ve çoğul', () => {
    const dicts = { en: { a: 'Hello {name}', n: '{count} pages', n_one: '1 page' }, de: { n: '{count} Seiten', n_one: 'eine Seite' }, ja: { n: '{count}ページ' } };
    const de = i18n.createTranslator('de', { dicts });
    eq(de('a', { name: 'X' }), 'Hello X', 'İngilizceye düşme');
    eq(de('yok.boyle'), 'yok.boyle', 'anahtar');
    eq(de('n', { count: 1 }), 'eine Seite'); eq(de('n', { count: 3 }), '3 Seiten');
    eq(i18n.createTranslator('ja', { dicts })('n', { count: 1 }), '1ページ', 'tekil biçimi olmayan dil');
    eq(i18n.createTranslator('zz', { dicts }).lang, 'en', 'desteklenmeyen kod');
    assert(i18n.isRtl('ar') && !i18n.isRtl('tr'), 'rtl');
  });
  await step('11 dil dosyası: aynı anahtarlar, yer tutucular tutarlı, koddaki anahtarlar var (tools/i18n-check.js)', () => {
    eq(i18n.CODES.length, 11);
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'i18n-check.js')], { stdio: 'pipe' });
    // Türkçe kaynak metinler İngilizce sözlükle aynı anahtar kümesine sahip olmalı
    const tr = JSON.parse(fs.readFileSync(path.join(i18n.LOCALE_DIR, 'tr.json'), 'utf8'));
    eq(tr['app.q.compress'], 'PDF küçült');
  });

  // ---------------- uygulama ----------------
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-i18n-'));
  let s = await launch({ userData: ud });
  let { app, win } = s;
  const lang = () => win.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, cur: window.__pu.i18n.lang() }));
  const tabText = (id) => win.textContent(`.ribbon-tab[data-tab="${id}"]`);

  await step('testte varsayılan dil Türkçe; şerit ve başlangıç ekranı Türkçe', async () => {
    const l = await lang();
    eq(l.cur, 'tr'); eq(l.lang, 'tr'); eq(l.dir, 'ltr');
    eq((await tabText('home')).trim(), 'Giriş');
    assert((await win.textContent('#start')).includes('PDF küçült'), 'başlangıç ekranı');
    eq(await win.getAttribute('#settings-btn', 'title'), 'Ayarlar');
  });

  await step('dil değişimi anında uygulanır (yeniden başlatmadan) ve kalıcıdır', async () => {
    await win.evaluate(() => window.__pu.i18n.setLang('en'));
    eq((await tabText('home')).trim(), 'Home');
    eq((await tabText('page')).trim(), 'Pages');
    assert((await win.textContent('#start')).includes('Compress PDF'), 'başlangıç ekranı İngilizce değil');
    eq(await win.getAttribute('#settings-btn', 'title'), 'Settings');
    eq(await win.getAttribute('#find-input', 'placeholder'), 'Search in document…');
    assert((await win.textContent('#ribbon')).includes('Edit text'), 'şerit düğmeleri');
    assert((await win.textContent('#autosave-btn')).includes('AutoSave'), 'otomatik kaydet düğmesi');
    await sleep(400);
    eq(readSettings(ud).lang, 'en', 'settings.json');
  });

  await step('ana süreç pencereleri de seçili dilde (dosya aç başlığı)', async () => {
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async (w, o) => { global.__lastTitle = (o || w).title; return { canceled: true, filePaths: [] }; }; });
    await win.evaluate(() => window.__pu.runAction('file.open'));
    eq(await app.evaluate(() => global.__lastTitle), 'Open PDF');
  });

  await step('eksik anahtar: geçerli dilde yoksa İngilizce gösterilir, hiç yoksa anahtar', async () => {
    const r = await win.evaluate(async () => {
      const m = window.__pu.i18n;
      await m.setLang('de');
      const before = m.t('app.q.compress');
      delete m.__dicts.de['app.q.compress'];
      const after = m.t('app.q.compress');
      return { before, after, none: m.t('boyle.bir.anahtar.yok'), has: m.has('app.q.compress', 'de') };
    });
    assert(r.before && r.before !== 'Compress PDF', `Almanca beklenirdi: ${r.before}`);
    eq(r.after, 'Compress PDF'); eq(r.none, 'boyle.bir.anahtar.yok'); eq(r.has, false);
  });

  await step('Arapça: <html dir="rtl">, başlık çubuğu soldan sağa kalır; geri dönünce ltr', async () => {
    await win.evaluate(() => window.__pu.i18n.setLang('ar'));
    const l = await lang();
    eq(l.dir, 'rtl'); eq(l.lang, 'ar');
    eq(await win.evaluate(() => getComputedStyle(document.querySelector('#titlebar')).direction), 'ltr');
    eq(await win.evaluate(() => getComputedStyle(document.body).direction), 'rtl');
    await win.evaluate(() => window.__pu.i18n.setLang('tr'));
    eq((await lang()).dir, 'ltr');
    eq((await tabText('home')).trim(), 'Giriş');
  });

  await step('Ayarlar: Dil seçicisi (dil adları kendi dilinde) anında değiştirir; Tema ve "Turu yeniden başlat" var', async () => {
    await win.evaluate(() => window.__pu.runAction('app.settings'));
    await win.waitForSelector('.settings-modal #settings-lang');
    const opts = await win.$$eval('#settings-lang option', (o) => o.map((x) => x.textContent));
    for (const n of ['English', 'Türkçe', 'Español', 'Deutsch', '日本語', 'العربية', '简体中文', 'Português (Brasil)']) assert(opts.includes(n), `seçenek yok: ${n}`);
    eq(opts.length, 11);
    assert(await win.$('#settings-theme'), 'tema seçici');
    await win.selectOption('#settings-lang', 'fr');
    await win.waitForFunction(() => document.documentElement.lang === 'fr');
    assert(!(await tabText('home')).includes('Giriş'), 'şerit değişmedi');
    eq(await win.textContent('.settings-modal .modal-head h3'), await win.evaluate(() => window.__pu.i18n.t('settings.title')));
    assert((await win.textContent('#settings-tour')).trim().length > 3, 'tur düğmesi');
    await win.keyboard.press('Escape');
    await win.evaluate(() => window.__pu.i18n.setLang('tr'));
  });
  await app.close();

  await step('kayıtlı dil yeniden açılışta korunur; ilk açılışta tur testte görünmez', async () => {
    await (async () => {
      s = await launch({ userData: ud });
      ({ app, win } = s);
      await win.evaluate(() => window.__pu.i18n.setLang('en'));
      await sleep(400);
      await app.close();
      s = await launch({ userData: ud });
      ({ app, win } = s);
    })();
    eq((await lang()).cur, 'en');
    await sleep(900);
    eq(await win.$('.tour-pop'), null, 'tur testte kendiliğinden açılmamalı');
    await app.close();
  });

  // ---------------- tanıtım turu ----------------
  const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-tour-'));
  process.env.PDFUSTA_TOUR = '1';
  s = await launch({ userData: ud2 });
  ({ app, win } = s);
  await step('tur ilk açılışta görünür: 5 adım, balon + çerçeve, İleri/Geri/Geç, hedefler doğru', async () => {
    await win.waitForSelector('.tour-pop', { timeout: 5000 });
    assert(await win.$('.tour-ring'), 'çerçeve yok');
    eq(await win.textContent('.tour-count'), '1 / 5');
    eq(await win.getAttribute('.tour-pop', 'data-step'), 'open');
    assert(await win.$('.tour-pop [data-act="skip"]'), 'Geç yok');
    eq(await win.$('.tour-pop [data-act="back"]'), null, 'ilk adımda Geri olmamalı');
    // Balon ekranı kaplamaz
    const box = await win.locator('.tour-pop').boundingBox();
    assert(box.width < 400 && box.height < 400, 'balon çok büyük');
    eq(await win.$('.modal-backdrop'), null, 'arka plan kaplanmamalı');
    const expect = ['open', 'ribbon', 'edittext', 'compress', 'settings'];
    for (let i = 1; i < 5; i++) {
      await win.click('.tour-pop [data-act="next"]');
      eq(await win.getAttribute('.tour-pop', 'data-step'), expect[i]);
    }
    // PDF küçült adımı küçült düğmesini çerçeveler
    await win.click('.tour-pop [data-act="back"]');
    eq(await win.getAttribute('.tour-pop', 'data-step'), 'compress');
    await sleep(400); // çerçeve kayarak yerine gelir
    const ring = await win.locator('.tour-ring').boundingBox();
    const btn = await win.locator('#ribbon [data-action="tools.compress"]').first().boundingBox();
    assert(Math.abs(ring.x + ring.width / 2 - (btn.x + btn.width / 2)) < 3, 'çerçeve küçült düğmesinde değil');
    assert(await win.$('.tour-badge'), 'öne çıkan rozet yok');
    await win.click('.tour-pop [data-act="next"]');
    eq(await win.textContent('.tour-pop [data-act="next"]'), 'Bitir');
  });
  await step('dil değişince tur balonu da güncellenir', async () => {
    await win.evaluate(() => window.__pu.i18n.setLang('en'));
    eq(await win.textContent('.tour-pop [data-act="next"]'), 'Finish');
    await win.evaluate(() => window.__pu.i18n.setLang('tr'));
  });
  await step('bitince bayrak kalıcı + "Ayarlar > Turu yeniden başlat" ipucu', async () => {
    await win.click('.tour-pop [data-act="next"]');
    eq(await win.$('.tour-pop'), null);
    await win.waitForFunction(() => [...document.querySelectorAll('.toast span')].some((x) => /Turu yeniden başlat/.test(x.textContent)));
    await sleep(400);
    eq(readSettings(ud2).tourDone, true);
  });
  await step('Ayarlar > Turu yeniden başlat turu yeniden açar; Geç (Esc) kapatır', async () => {
    await win.evaluate(() => window.__pu.runAction('app.settings'));
    await win.click('#settings-tour');
    await win.waitForSelector('.tour-pop');
    eq(await win.textContent('.tour-count'), '1 / 5');
    await win.click('.tour-pop [data-act="skip"]');
    eq(await win.$('.tour-pop'), null);
  });
  await app.close();
  s = await launch({ userData: ud2 });
  ({ app, win } = s);
  await step('tur bir kez gösterilir (ikinci açılışta yok)', async () => {
    await sleep(1200);
    eq(await win.$('.tour-pop'), null);
  });
  await app.close();
  delete process.env.PDFUSTA_TOUR;

  const fail = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} geçti`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
