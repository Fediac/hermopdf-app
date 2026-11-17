// Kayıtlı iş akışları (ilk Pro özelliği) — uygulama içinden uçtan uca test.
// Yalnızca sentetik PDF'ler (tests/fixtures → geçici klasör) ve atılık lisans anahtarları kullanılır
// (ULTRONIX_TEST_KEYS; ana süreç bunu yalnızca paketlenmemiş + PDFUSTA_TEST=1 iken kabul eder).
// Kullanım: node tests/workflows.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { launch, shot, sleep, FIX } = require('./harness');
const { keyPair, makeLicense } = require('./license-helpers');

const results = [];
let curWin = null;
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}: ${String(e.message).split('\n')[0]}`);
    if (curWin) await shot(curWin, `FAILwf-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const pdfsIn = (d) => fs.readdirSync(d).filter((f) => /\.pdf$/i.test(f)).sort();

// ---------------- atılık anahtar ----------------
const live = keyPair();
process.env.ULTRONIX_TEST_KEYS = JSON.stringify({ 'test-live-1': { env: 'live', pem: live.pem } });
const lic = makeLicense('test-live-1', live.privateKey, { email: 'is-akisi@example.com' });

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-wf-'));
const dir = (n) => { const d = path.join(TMP, n); fs.mkdirSync(d, { recursive: true }); return d; };
const copy = (fx, d, as) => { const f = path.join(d, as || fx); fs.copyFileSync(path.join(FIX, fx), f); return f; };

(async () => {
  const ud = dir('userdata');
  const work = dir('girdi');
  const A = copy('a.pdf', work);
  const B = copy('b.pdf', work);
  const T = copy('test.pdf', work);
  const origHash = { A: sha(A), B: sha(B), T: sha(T) };
  const out1 = dir('cikti1');
  const out2 = dir('cikti2');
  const out3 = dir('cikti3');
  const PASS = 'Gizli-Parola-482';
  const TARGET_MB = 0.25;
  const WM = 'WFDAMGA';

  let app;
  let win;
  let logs = [];
  const start = async () => {
    ({ app, win, logs } = await launch({ userData: ud }));
    curWin = win;
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: global.__nextOpen || [] }); });
  };
  const setNext = (paths) => app.evaluate((_, p) => { global.__nextOpen = p; }, paths);
  const wf = (fn, ...a) => win.evaluate(([f, args]) => import('app://pu/src/renderer/js/workflows.js').then((m) => m[f](...args)), [fn, a]);
  const recipes = () => win.evaluate(() => import('app://pu/src/renderer/js/state.js').then((m) => m.App.settings.workflows || []));
  const text = (sel) => win.evaluate((s) => document.querySelector(s)?.textContent || '', sel);
  const count = (sel) => win.evaluate((s) => document.querySelectorAll(s).length, sel);
  const esc = async () => { await win.keyboard.press('Escape'); await sleep(200); };
  const openPanel = async () => {
    await closeAll(); // önceki adım yarıda kaldıysa açık pencere tıklamayı engellemesin
    await win.click('#ribbon [data-action="tools.workflows"]');
    await win.waitForSelector('.wf-modal .wf-tpls', { timeout: 8000 });
  };
  const closeAll = async () => { for (let i = 0; i < 5 && (await count('.modal-backdrop')); i++) await esc(); };
  // Çıktıyı uygulamanın kendi pdf.js'iyle aç: sayfa sayısı + tüm metin (ya da hata adı)
  const pdfInfo = (file, password) => win.evaluate(async ([f, pw]) => {
    const { openPdfjs } = await import('app://pu/src/renderer/js/pdfcore.js');
    const r = await window.pu.readPdf(f);
    let src;
    try { src = await openPdfjs(r.bytes, pw || undefined); } catch (e) { return { error: e?.name || String(e) }; }
    try {
      let t = '';
      for (let i = 1; i <= src.doc.numPages; i++) {
        const tc = await (await src.doc.getPage(i)).getTextContent();
        t += `${tc.items.map((x) => x.str).join(' ')}\n`;
      }
      return { pages: src.doc.numPages, text: t, size: r.size };
    } finally { src.destroy(); }
  }, [file, password || null]);
  const summaryRows = () => win.evaluate(() => [...document.querySelectorAll('.wf-summary-modal .wf-res tr[data-status]')].map((tr) => ({
    status: tr.dataset.status, input: tr.querySelector('.wf-res-in')?.textContent, out: tr.querySelector('.wf-res-out')?.textContent || '',
    text: tr.textContent,
  })));
  const closeSummary = async () => { await win.click('.wf-summary-modal .modal-foot button:has-text("Kapat")'); await sleep(250); };
  const runFrom = async (cardSel, item) => {
    await win.click(`${cardSel} [data-act="run"]`);
    await win.waitForSelector('.ctx-menu', { timeout: 3000 });
    await win.click(`.ctx-menu .ctx-item:has-text("${item}")`);
  };
  const addStep = async (op) => {
    await win.selectOption('.wf-edit-modal select.wf-add-op', op);
    await win.click('.wf-edit-modal .wf-add-btn');
  };

  try {
    await start();

    await step('şeritte "Kayıtlı iş akışları" taç işaretiyle durur', async () => {
      const b = await win.$('#ribbon [data-action="tools.workflows"]');
      assert(b, 'düğme yok');
      assert(/Kayıtlı iş akışları/.test(await b.textContent()), 'etiket');
      assert(await win.$('#ribbon [data-action="tools.workflows"] .rpro .ic'), 'taç işareti yok');
      assert(!(await win.$('.modal-backdrop')), 'açılışta pencere açıldı');
    });

    await step('ücretsiz kullanıcı paneli açar ve şablonları görür', async () => {
      await openPanel();
      assert(await win.$('.wf-modal .wf-pro-note'), 'Pro notu yok');
      assert((await count('.wf-modal .wf-tpls .wf-card')) === 3, 'üç şablon yok');
      const t = await text('.wf-modal');
      for (const s of ['Başvuruya hazırla', 'Taranmış belgeleri aranabilir yap', 'Taslak damgası', 'Birleştir', 'Küçült (≤ 1 MB)', 'OCR', 'Filigran “TASLAK”', 'Sayfa no', 'Henüz kayıtlı iş akışınız yok']) assert(t.includes(s), `eksik: ${s}`);
    });

    await step('ücretsiz: Çalıştır / Yeni / Kopyala yükseltme penceresini açar, hiçbir şey yazılmaz', async () => {
      const before = fs.readdirSync(work).join('|');
      await setNext([A, B]);
      await win.click('.wf-card[data-id="tpl-draft"] [data-act="run"]');
      await win.waitForSelector('.pro-modal .pro-asked', { timeout: 3000 });
      assert(/Kayıtlı iş akışları/.test(await text('.pro-modal .pro-asked')), 'özellik adı yok');
      assert(!(await win.$('.ctx-menu')), 'kaynak menüsü açıldı');
      await esc();
      await win.click('.wf-modal button[data-id="new"]');
      await win.waitForSelector('.pro-modal', { timeout: 3000 });
      assert(!(await win.$('.wf-edit-modal')), 'düzenleyici açıldı');
      await esc();
      await win.click('.wf-card[data-id="tpl-apply"] [data-act="copy"]');
      await win.waitForSelector('.pro-modal', { timeout: 3000 });
      await esc();
      // Arayüzü atlayıp doğrudan çağırmak da işe yaramaz
      const r = await wf('runRecipe', { name: 'x', steps: [{ op: 'watermark', params: { text: 'X' } }], output: { folder: 'same', pattern: '{ad}-x' } }, 'files');
      assert(r === null, 'runRecipe çalıştı');
      assert((await wf('upsertRecipe', { name: 'x', steps: [{ op: 'rotate' }] })).ok === false, 'ücretsiz kayıt yapıldı');
      await win.waitForSelector('.pro-modal', { timeout: 3000 });
      await closeAll();
      await sleep(400);
      assert(fs.readdirSync(work).join('|') === before, 'girdi klasörüne yazıldı');
      assert((await recipes()).length === 0, 'tarif kaydedildi');
    });

    await step('tarif doğrulaması (birleştir ilk, parola son, parola asla saklanmaz, ad kalıbı)', async () => {
      const n = (r) => wf('normalizeRecipe', r);
      const base = { name: 'T', output: { folder: 'same', pattern: '{ad}' } };
      assert(!(await n({ ...base, steps: [{ op: 'rotate' }, { op: 'merge' }] })).ok, 'birleştir ikinci adımda kabul edildi');
      assert(!(await n({ ...base, steps: [{ op: 'protect' }, { op: 'rotate' }] })).ok, 'parola son değil kabul edildi');
      const p = await n({ ...base, steps: [{ op: 'protect', params: { password: 'sızmasın', userPassword: 'x' } }] });
      assert(p.ok && JSON.stringify(p.recipe.steps[0].params) === '{}', `parola alanı kaldı: ${JSON.stringify(p.recipe.steps[0])}`);
      assert(!(await n({ ...base, steps: [{ op: 'watermark', params: { text: '  ' } }] })).ok, 'boş filigran');
      assert(!(await n({ ...base, steps: [{ op: 'hack' }] })).ok, 'bilinmeyen adım');
      assert(!(await n({ ...base, steps: [{ op: 'toString' }] })).ok, 'prototip adı adım sayıldı');
      assert(!(await n({ ...base, steps: [{ op: 'removePages', params: { range: '1; rm' } }] })).ok, 'geçersiz aralık');
      assert(!(await n({ ...base, steps: [{ op: 'compress', params: { targetMB: 0 } }] })).ok, 'hedef 0 kabul edildi');
      assert((await n({ ...base, steps: [{ op: 'compress', params: { targetMB: '1,5' } }] })).recipe.steps[0].params.targetMB === 1.5, 'virgüllü sayı');
      assert(!(await n({ ...base, steps: [{ op: 'rotate' }], output: { folder: 'same', pattern: '{foo}' } })).ok, 'bilinmeyen alan');
      assert(!(await n({ ...base, steps: [{ op: 'rotate' }], output: { folder: 'göreli/yol', pattern: '{ad}' } })).ok, 'göreli klasör');
      assert(!(await n({ name: '', steps: [{ op: 'rotate' }] })).ok, 'adsız tarif');
      const name = await win.evaluate(() => import('app://pu/src/renderer/js/workflows.js').then((m) => [
        m.renderName('{ad}-{tarih}', { ad: 'Rapor', now: new Date(2026, 10, 8, 9, 5) }),
        m.renderName('{ad} $` $& {n}', { ad: 'x', n: 3 }),
        m.renderName('../{ad}:*?.pdf', { ad: 'y' }),
        m.renderName('CON', { ad: 'z' }),
      ]));
      assert(name[0] === 'Rapor-2026-11-08.pdf', name[0]);
      assert(name[1] === 'x $` $& 3.pdf', name[1]);
      assert(name[2] === '.._y___.pdf', name[2]);
      assert(name[3] === '_CON.pdf', name[3]);
    });

    await step('Pro lisansı (atılık anahtar) etkinleşir', async () => {
      const r = await win.evaluate((k) => window.pu.license.activate(k), lic.key);
      assert(r.ok, JSON.stringify(r));
      await sleep(300);
      assert(await win.evaluate(() => import('app://pu/src/renderer/js/pro.js').then((m) => m.isPro())), 'Pro değil');
    });

    let recipeId = null;
    await step('arayüzden iş akışı oluşturulur: birleştir → filigran → küçült (hedef)', async () => {
      await openPanel();
      assert(!(await win.$('.wf-modal .wf-pro-note')), 'Pro iken Pro notu duruyor');
      await win.click('.wf-modal button[data-id="new"]');
      await win.waitForSelector('.wf-edit-modal', { timeout: 3000 });
      // boş kayıt reddedilir
      await win.click('.wf-edit-modal button[data-id="save"]');
      await sleep(150);
      assert(/ad verin/.test(await text('.wf-edit-modal .wf-err')) && /adım ekleyin/.test(await text('.wf-edit-modal .wf-err')), `hata: ${await text('.wf-edit-modal .wf-err')}`);
      await win.fill('.wf-edit-modal .wf-name-in', 'Başvuru paketi');
      await addStep('watermark');
      await addStep('compress');
      await addStep('merge'); // her zaman en başa girer
      const ops = await win.evaluate(() => [...document.querySelectorAll('.wf-edit-modal .wf-step')].map((s) => s.dataset.op));
      assert(ops.join(',') === 'merge,watermark,compress', ops.join(','));
      assert(await win.evaluate(() => document.querySelector('.wf-edit-modal option[value="merge"]').disabled), 'ikinci birleştir eklenebiliyor');
      await win.fill('.wf-step[data-op="watermark"] .wf-p-text', WM);
      await win.fill('.wf-step[data-op="compress"] .wf-p-target', String(TARGET_MB).replace('.', ','));
      await setNext([out1]);
      await win.selectOption('.wf-edit-modal select.wf-out-folder', 'custom');
      await win.waitForFunction((d) => document.querySelector('.wf-edit-modal .wf-out-path')?.textContent === d, out1, { timeout: 3000 });
      await win.fill('.wf-edit-modal .wf-pattern', '{ad}-{foo}');
      await win.click('.wf-edit-modal button[data-id="save"]');
      await sleep(150);
      assert(/Bilinmeyen alan/.test(await text('.wf-edit-modal .wf-err')), 'bilinmeyen alan hatası yok');
      await win.fill('.wf-edit-modal .wf-pattern', '{ad}-paket');
      assert((await text('.wf-edit-modal .wf-preview')).includes('Rapor-paket.pdf'), `önizleme: ${await text('.wf-edit-modal .wf-preview')}`);
      await shot(win, 'wf-editor');
      await win.click('.wf-edit-modal button[data-id="save"]');
      await win.waitForSelector('.wf-edit-modal', { state: 'detached', timeout: 3000 });
      const list = await recipes();
      assert(list.length === 1, `kayıt sayısı ${list.length}`);
      const r = list[0];
      recipeId = r.id;
      assert(r.name === 'Başvuru paketi' && r.steps.map((s) => s.op).join(',') === 'merge,watermark,compress', JSON.stringify(r));
      assert(r.steps[2].params.targetMB === TARGET_MB && r.output.folder === out1 && r.output.pattern === '{ad}-paket', JSON.stringify(r));
      assert(await win.$(`.wf-mine .wf-card[data-id="${recipeId}"]`), 'kart yok');
    });

    await step('üç dosyada çalışır: tek çıktı, sayfa sayısı toplam, boyut hedefte (ya da dürüst uyarı), filigran var, orijinaller aynı', async () => {
      const pages = (await pdfInfo(A)).pages + (await pdfInfo(B)).pages + (await pdfInfo(T)).pages;
      await setNext([A, B, T]);
      await runFrom(`.wf-card[data-id="${recipeId}"]`, 'Dosya seç');
      await win.waitForSelector('.wf-summary-modal', { timeout: 180000 });
      const rows = await summaryRows();
      assert(rows.length === 1 && rows[0].status !== 'error', JSON.stringify(rows));
      assert(/3 dosya birleştirildi/.test(rows[0].input), rows[0].input);
      const outs = pdfsIn(out1);
      assert(outs.length === 1 && outs[0] === 'a-paket.pdf', outs.join(','));
      const info = await pdfInfo(path.join(out1, outs[0]));
      assert(info.pages === pages, `sayfa ${info.pages} ≠ ${pages}`);
      assert(info.text.replace(/\s+/g, '').includes(WM), 'filigran metni yok');
      const target = Math.round(TARGET_MB * 1048576);
      if (info.size > target) {
        assert(rows[0].status === 'warn' && /tutturulamadı|aşıldı/.test(rows[0].text), `hedef aşıldı ama uyarı yok: ${info.size}`);
        console.log(`   (hedefe ulaşılamadı, dürüst uyarı gösterildi: ${info.size} B)`);
      } else console.log(`   (çıktı ${info.size} B ≤ hedef ${target} B)`);
      assert(sha(A) === origHash.A && sha(B) === origHash.B && sha(T) === origHash.T, 'orijinal değişti');
      assert(!fs.readdirSync(out1).some((f) => /hermopdf-tmp/.test(f)), 'geçici dosya kaldı');
      assert(await win.$('.wf-summary-modal button[data-id="open"]'), '"Klasörü aç" yok');
      await shot(win, 'wf-summary');
      await closeSummary();
    });

    await step('aynı ad varsa üzerine yazılmaz: (2) eklenir', async () => {
      const h1 = sha(path.join(out1, 'a-paket.pdf'));
      await openPanel();
      await setNext([A, B]);
      await runFrom(`.wf-card[data-id="${recipeId}"]`, 'Dosya seç');
      await win.waitForSelector('.wf-summary-modal', { timeout: 120000 });
      await closeSummary();
      const outs = pdfsIn(out1);
      assert(outs.join('|') === 'a-paket (2).pdf|a-paket.pdf', outs.join('|'));
      assert(sha(path.join(out1, 'a-paket.pdf')) === h1, 'önceki çıktının üzerine yazıldı');
      assert((await pdfInfo(path.join(out1, 'a-paket (2).pdf'))).pages === 5, 'ikinci çıktı sayfa sayısı');
    });

    await step('parola adımı çalıştırırken sorulur, kaydedilmez; çıktı yalnızca parolayla açılır', async () => {
      await openPanel();
      await win.click('.wf-modal button[data-id="new"]');
      await win.waitForSelector('.wf-edit-modal', { timeout: 3000 });
      await win.fill('.wf-edit-modal .wf-name-in', 'Numaralı ve parolalı');
      await addStep('protect');
      await addStep('numbers'); // parolanın önüne girer
      const ops = await win.evaluate(() => [...document.querySelectorAll('.wf-edit-modal .wf-step')].map((s) => s.dataset.op));
      assert(ops.join(',') === 'numbers,protect', ops.join(','));
      await setNext([out2]);
      await win.selectOption('.wf-edit-modal select.wf-out-folder', 'custom');
      await win.waitForFunction((d) => document.querySelector('.wf-edit-modal .wf-out-path')?.textContent === d, out2, { timeout: 3000 });
      await win.fill('.wf-edit-modal .wf-pattern', '{ad}-korumali');
      await win.click('.wf-edit-modal button[data-id="save"]');
      await win.waitForSelector('.wf-edit-modal', { state: 'detached', timeout: 3000 });
      const r = (await recipes()).find((x) => x.name === 'Numaralı ve parolalı');
      assert(r && JSON.stringify(r.steps[1]) === '{"op":"protect","params":{}}', JSON.stringify(r));
      await setNext([A]);
      await runFrom(`.wf-card[data-id="${r.id}"]`, 'Dosya seç');
      await win.waitForSelector('.wf-pw-modal', { timeout: 5000 });
      await sleep(120); // pencerenin kendi ilk-alan odaklaması (30 ms) yazmanın ortasına denk gelmesin
      assert(pdfsIn(out2).length === 0, 'parola sorulmadan yazıldı');
      await win.fill('.wf-pw-modal .wf-pw1', PASS);
      await win.fill('.wf-pw-modal .wf-pw2', `${PASS}x`);
      await win.click('.wf-pw-modal button[data-id="ok"]');
      await sleep(150);
      assert(/eşleşmiyor/.test(await text('.wf-pw-modal .wf-err')), 'eşleşmeme hatası yok');
      await win.fill('.wf-pw-modal .wf-pw1', PASS);
      await win.fill('.wf-pw-modal .wf-pw2', PASS);
      const lens = await win.evaluate(() => ['.wf-pw1', '.wf-pw2'].map((s) => document.querySelector(`.wf-pw-modal ${s}`).value.length));
      assert(lens[0] === PASS.length && lens[1] === PASS.length, `alan uzunlukları ${lens}`);
      await win.click('.wf-pw-modal button[data-id="ok"]');
      await win.waitForSelector('.wf-summary-modal', { timeout: 60000 });
      await closeSummary();
      const outs = pdfsIn(out2);
      assert(outs.join() === 'a-korumali.pdf', outs.join());
      const f = path.join(out2, outs[0]);
      const locked = await pdfInfo(f);
      assert(locked.error === 'PasswordException', `parolasız açıldı: ${JSON.stringify(locked).slice(0, 120)}`);
      const wrong = await pdfInfo(f, 'yanlis');
      assert(wrong.error === 'PasswordException', 'yanlış parolayla açıldı');
      const open = await pdfInfo(f, PASS);
      assert(open.pages === 2 && /Sayfa\s*1\s*\/\s*2/.test(open.text), `parolayla: ${JSON.stringify(open).slice(0, 160)}`);
      await sleep(600); // ayarlar diske yazılsın
      for (const file of ['settings.json', 'pdfusta.log']) {
        const p = path.join(ud, file);
        if (fs.existsSync(p)) assert(!fs.readFileSync(p, 'utf8').includes(PASS), `parola ${file} içinde`);
      }
      assert(sha(A) === origHash.A, 'orijinal değişti');
    });

    await step('klasör (alt klasörsüz): bozuk dosya raporlanır, diğerleri işlenir', async () => {
      const w2 = dir('klasor');
      const a2 = copy('a.pdf', w2);
      const b2 = copy('b.pdf', w2);
      const bad = path.join(w2, 'bozuk.pdf');
      fs.writeFileSync(bad, 'Bu bir PDF değil, yalnızca bozuk bir deneme dosyası.\n'.repeat(20));
      const sub = dir('klasor/alt');
      copy('a.pdf', sub, 'alt.pdf');
      const h = { a: sha(a2), b: sha(b2), bad: sha(bad) };
      await openPanel();
      await setNext([w2]);
      await runFrom('.wf-card[data-id="tpl-draft"]', 'Klasördeki tüm');
      await win.waitForSelector('.wf-summary-modal', { timeout: 120000 });
      const rows = await summaryRows();
      assert(rows.length === 3, JSON.stringify(rows));
      const badRow = rows.find((r) => r.input === 'bozuk.pdf');
      assert(badRow && badRow.status === 'error' && /bozuk|PDF değil/.test(badRow.text), JSON.stringify(badRow));
      assert(rows.filter((r) => r.status === 'ok').length === 2, JSON.stringify(rows));
      assert(/2 dosya hazır, 1 dosyada sorun çıktı/.test(await text('.wf-summary-modal .wf-sum-msg')), await text('.wf-summary-modal .wf-sum-msg'));
      await closeSummary();
      assert(pdfsIn(w2).join('|') === 'a-taslak.pdf|a.pdf|b-taslak.pdf|b.pdf|bozuk.pdf', pdfsIn(w2).join('|'));
      assert(fs.readdirSync(sub).join() === 'alt.pdf', 'alt klasöre dokunuldu');
      const info = await pdfInfo(path.join(w2, 'b-taslak.pdf'));
      assert(info.pages === 3 && info.text.includes('TASLAK') && /Sayfa\s*3\s*\/\s*3/.test(info.text), JSON.stringify(info).slice(0, 200));
      assert(sha(a2) === h.a && sha(b2) === h.b && sha(bad) === h.bad, 'orijinal değişti');
    });

    await step('iptal: yarım çıktı dosyası kalmaz', async () => {
      const w3 = dir('iptal');
      const ins = [1, 2, 3].map((k) => copy('test.pdf', w3, `tarama-${k}.pdf`));
      const res = await wf('upsertRecipe', { name: 'Yavaş tarama', steps: [{ op: 'compress', params: { level: 'raster150' } }, { op: 'watermark', params: { text: 'IPTAL' } }], output: { folder: out3, pattern: '{ad}-yavas' } });
      assert(res.ok, JSON.stringify(res));
      await openPanel();
      await setNext(ins);
      await runFrom(`.wf-card[data-id="${res.recipe.id}"]`, 'Dosya seç');
      await win.waitForSelector('.progress-modal', { timeout: 10000 });
      await sleep(250);
      await win.click('.progress-modal button:has-text("İptal")');
      await win.waitForSelector('.wf-summary-modal', { timeout: 60000 });
      assert(/durduruldu/.test(await text('.wf-summary-modal .modal-head')), 'başlık');
      assert(/yarım kalan dosya yazılmadı/.test(await text('.wf-summary-modal')), 'iptal açıklaması yok');
      const rows = await summaryRows();
      await closeSummary();
      const all = fs.readdirSync(out3);
      assert(!all.some((f) => /hermopdf-tmp/.test(f)), `geçici dosya kaldı: ${all.join()}`);
      const outs = pdfsIn(out3);
      assert(outs.length === rows.filter((r) => r.status !== 'error').length, `çıktı ${outs.length}, özet ${rows.length}`);
      assert(outs.length < 3, 'iptal işe yaramadı');
      for (const o of outs) assert((await pdfInfo(path.join(out3, o))).pages === 4, `${o} eksik`);
      console.log(`   (iptalden önce tamamlanan: ${outs.length})`);
      for (const f of ins) assert(sha(f) === origHash.T, 'orijinal değişti');
    });

    await step('açık belgeye uygulanır; belge ve dosyası değişmez', async () => {
      const w5 = dir('acik');
      const f = copy('b.pdf', w5, 'acik-belge.pdf');
      const h = sha(f);
      await win.evaluate((p) => window.__pu.openPaths([p]), f);
      await win.waitForFunction(() => window.__pu && document.querySelector('.page'), null, { timeout: 15000 }).catch(() => {});
      await sleep(800);
      await openPanel();
      await runFrom('.wf-card[data-id="tpl-draft"]', 'Açık belgeye uygula');
      await win.waitForSelector('.wf-summary-modal', { timeout: 60000 });
      await closeSummary();
      assert(pdfsIn(w5).join('|') === 'acik-belge-taslak.pdf|acik-belge.pdf', pdfsIn(w5).join('|'));
      assert(sha(f) === h, 'dosya değişti');
      const dirty = await win.evaluate(() => import('app://pu/src/renderer/js/state.js').then((m) => m.App.active?.dirty));
      assert(dirty === false, `belge kirli: ${dirty}`);
    });

    await step('OCR şablonu taranmış belgeyi aranabilir yapar', async () => {
      const w4 = dir('ocr');
      const s = copy('scan.pdf', w4);
      const before = await pdfInfo(s);
      await openPanel();
      await setNext([s]);
      await runFrom('.wf-card[data-id="tpl-ocr"]', 'Dosya seç');
      await win.waitForSelector('.wf-summary-modal', { timeout: 240000 });
      const rows = await summaryRows();
      await closeSummary();
      assert(rows.length === 1 && rows[0].status !== 'error', JSON.stringify(rows));
      const info = await pdfInfo(path.join(w4, 'scan-aranabilir.pdf'));
      const n = (t) => t.replace(/\s+/g, '').length;
      assert(info.pages === before.pages && n(info.text) > n(before.text) + 20, `metin ${n(before.text)} → ${n(info.text)}`);
    });

    await step('ulaşılamayan hedef boyut: en küçük sonuç yazılır ve dürüstçe uyarılır', async () => {
      const w6 = dir('hedef');
      const f = copy('test.pdf', w6);
      const target = Math.round(0.05 * 1048576);
      const res = await wf('runJobs', { name: 'Çok küçük hedef', steps: [{ op: 'compress', params: { level: 'medium', targetMB: 0.05, allowRaster: false } }], output: { folder: 'same', pattern: '{ad}-mini' } },
        [{ name: 'test.pdf', path: f, size: fs.statSync(f).size }], {});
      const r = res.results[0];
      assert(!res.cancelled && r && !r.error && r.path, JSON.stringify(res));
      const size = fs.statSync(r.path).size;
      assert(size === r.after, `boyut ${size} ≠ ${r.after}`);
      if (size > target) {
        assert(r.warnings.some((w) => /tutturulamadı/.test(w)), `uyarı yok: ${JSON.stringify(r)}`);
        console.log(`   (hedef ${target} B, ulaşılan ${size} B, uyarı: ${r.warnings[0]})`);
      } else console.log(`   (hedefe ulaşıldı: ${size} B)`);
      assert(sha(f) === origHash.T, 'orijinal değişti');
    });

    await step('çoğalt ve sil (onaylı)', async () => {
      await openPanel();
      const n0 = (await recipes()).length;
      await win.click(`.wf-card[data-id="${recipeId}"] [data-act="dup"]`);
      await sleep(300);
      const list = await recipes();
      assert(list.length === n0 + 1 && list.some((r) => r.name === 'Başvuru paketi (kopya)'), JSON.stringify(list.map((r) => r.name)));
      const copyId = list.find((r) => r.name === 'Başvuru paketi (kopya)').id;
      await win.click(`.wf-card[data-id="${copyId}"] [data-act="del"]`);
      await win.waitForSelector('.modal:has-text("silinsin mi")', { timeout: 3000 });
      await win.click('.modal:has-text("silinsin mi") .modal-foot .btn.danger');
      await sleep(300);
      assert((await recipes()).length === n0, 'silinmedi');
      assert(!(await win.$(`.wf-card[data-id="${copyId}"]`)), 'kart duruyor');
      await closeAll();
    });

    await step('iş akışları yeniden başlatınca korunur', async () => {
      const names = (await recipes()).map((r) => r.name).sort();
      assert(names.length === 3, names.join());
      await app.close();
      await start();
      assert(await win.evaluate(() => import('app://pu/src/renderer/js/pro.js').then((m) => m.isPro())), 'Pro düştü');
      await openPanel();
      const shown = await win.evaluate(() => [...document.querySelectorAll('.wf-mine .wf-card .wf-name')].map((n) => n.textContent).sort());
      assert(JSON.stringify(shown) === JSON.stringify(names), `${shown} ≠ ${names}`);
      assert(!(await win.$('.wf-modal .wf-pro-note')), 'Pro notu');
      assert(!(await win.evaluate(() => [...document.querySelector('.wf-panel').childNodes].some((n) => n.nodeType === 3))), 'panelde başıboş yazı ("null")');
      await shot(win, 'wf-panel');
      await closeAll();
    });

    await step('konsolda sayfa hatası yok', async () => {
      const bad = logs.filter((l) => /pageerror|Uncaught/.test(l));
      assert(!bad.length, bad.join('\n').slice(0, 400));
    });
  } catch (e) {
    console.error('Beklenmeyen hata:', e);
    results.push({ name: 'genel', ok: false, err: e.message });
  } finally {
    if (app) await app.close().catch(() => {});
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* yoksay */ }
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} adım başarılı`);
  process.exit(ok === results.length ? 0 : 1);
})();
