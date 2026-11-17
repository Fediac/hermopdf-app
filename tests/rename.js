// Ad değişikliği testi (PDF Usta → Ultronix PDF → UltronPDF): eski veri klasöründen ayar ve lisans taşıma.
// Geçici klasörde sahte eski veri klasörleri kurulur; uygulama boş bir test klasörüyle açılır.
// Eski klasörler, gerçek uygulamadaki sırayla (önce "Ultronix PDF", sonra "PDF Usta") PDFUSTA_LEGACY_USERDATA ile verilir.
// Doğrular: "Ultronix PDF" klasöründe settings.json yoksa "PDF Usta"dan taşınır; ayarlar geldi, önbellek/kilit/günlük
// taşınmadı, eski klasör bayt bayt aynı kaldı, işaret dosyası yazıldı, ikinci açılış yeniden kopyalamıyor ve değişen ayarın
// üzerine yazmıyor; eski ayar dosyası kilitliyken işaret yazılmıyor ve taşıma sonraki açılışta (yeni ayarlar korunarak)
// tamamlanıyor; iki eski klasör de varsa "Ultronix PDF" seçiliyor ve Pro lisansı, iptal listesi, güncelleme durumu
// taşınıyor (yenide var olan dosyanın üzerine yazılmadan).
// Yalnızca atılık lisans anahtarları kullanılır (ULTRONIX_TEST_KEYS). Kullanım: node tests/rename.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { launch, shot, sleep, copyFixture } = require('./harness');
const { keyPair, makeLicense, makeLid, signDoc } = require('./license-helpers');

const liveKey = keyPair();
process.env.ULTRONIX_TEST_KEYS = JSON.stringify({ 'test-live-1': { env: 'live', pem: liveKey.pem } });

const results = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-rename-'));
const legacy = path.join(work, 'PDF Usta');
const emptyUltronix = path.join(work, 'Ultronix PDF bos'); // var ama settings.json yok → "PDF Usta"ya düşülmeli
const legacyList = (...dirs) => dirs.join(path.delimiter);
const ud = path.join(work, 'HermoPDF');
let curWin = null;

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}: ${e.message.split('\n')[0]}`);
    if (curWin) await shot(curWin, `FAILr-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };

// Klasörün tam "parmak izi": her dosyanın yolu, boyutu, değişme zamanı ve SHA-1'i.
function fingerprint(dir) {
  const out = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d).sort()) {
      const f = path.join(d, n);
      const st = fs.statSync(f);
      const rel = path.relative(dir, f);
      if (st.isDirectory()) { out.push(`D ${rel} ${st.mtimeMs}`); walk(f); }
      else out.push(`F ${rel} ${st.size} ${st.mtimeMs} ${crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex')}`);
    }
  };
  walk(dir);
  return out.join('\n');
}
const put = (rel, data) => {
  const f = path.join(legacy, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = (rel) => fs.existsSync(path.join(ud, rel));

(async () => {
  // ---- sahte eski veri klasörü ----
  const recentPdf = copyFixture('test.pdf', path.join(work, 'belgeler'));
  const sig = { id: 'eski-imza-1', dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', w: 1, h: 1, initials: false };
  const legacySettings = { theme: 'dark', recent: [recentPdf], signatures: [sig], lastSigName: 'Eski Kullanıcı', lastDir: path.dirname(recentPdf), maximized: false };
  put('settings.json', JSON.stringify(legacySettings, null, 1));
  put('pdfusta.log', 'ESKI-GUNLUK-SATIRI\n');
  put('primary.json', JSON.stringify({ pid: 999999, time: 1, eski: true }));
  put(path.join('open-queue', 'eski.json'), JSON.stringify([recentPdf]));
  put(path.join('Cache', 'Cache_Data', 'eski-onbellek.bin'), 'x');
  put(path.join('Code Cache', 'js', 'eski-onbellek.bin'), 'x');
  put(path.join('GPUCache', 'eski-onbellek.bin'), 'x');
  put(path.join('DawnCache', 'eski-onbellek.bin'), 'x');
  put(path.join('blob_storage', 'eski-onbellek.bin'), 'x');
  put(path.join('Crashpad', 'eski-onbellek.bin'), 'x');
  put(path.join('Local Storage', 'leveldb', 'eski-onbellek.log'), 'x');
  put('lockfile', '');
  const before = fingerprint(legacy);
  fs.mkdirSync(emptyUltronix, { recursive: true });
  fs.writeFileSync(path.join(emptyUltronix, 'pdfusta.log'), 'YARIM-ULTRONIX-KLASORU\n');

  // ---- 1. açılış: taşıma ----
  let r = await launch({ userData: ud, legacyUserData: legacyList(emptyUltronix, legacy) });
  curWin = r.win;
  try {
    await step('Koyu tema eski ayarlardan geldi', async () => {
      const th = await r.win.evaluate(() => document.documentElement.dataset.theme);
      assert(th === 'dark', `tema: ${th}`);
    });
    await step('Son açılanlar listesi eski kaydı gösteriyor', async () => {
      const titles = await r.win.$$eval('.recent-item', (els) => els.map((e) => e.title));
      assert(titles.includes(recentPdf), `liste: ${JSON.stringify(titles)}`);
    });
    await step('Kayıtlı imza ve diğer ayarlar geldi', async () => {
      const s = await r.win.evaluate(() => window.__pu.App.settings);
      assert((s.signatures || []).some((x) => x.id === sig.id && x.dataURL === sig.dataURL), 'imza yok');
      assert(s.lastSigName === 'Eski Kullanıcı', `lastSigName: ${s.lastSigName}`);
      assert(s.lastDir === legacySettings.lastDir, `lastDir: ${s.lastDir}`);
    });
    await step('Yeni ad görünüyor (pencere başlığı, başlangıç ekranı)', async () => {
      const t = await r.win.title();
      assert(t === 'HermoPDF', `başlık: ${t}`);
      const h1 = await r.win.$eval('.start-hero h1', (e) => e.textContent);
      assert(h1 === 'HermoPDF', `h1: ${h1}`);
      const winTitle = await r.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
      assert(winTitle === 'HermoPDF', `pencere: ${winTitle}`);
    });
    await step('İşaret dosyası yazıldı ve günlüğe not düşüldü', async () => {
      const m = readJson(path.join(ud, 'migrated-from.json'));
      assert(m.from === legacy, `from: ${m.from}`);
      assert(JSON.stringify(m.items) === JSON.stringify(['settings.json']), `items: ${JSON.stringify(m.items)}`);
      const lg = fs.readFileSync(path.join(ud, 'pdfusta.log'), 'utf8');
      assert(/eski "PDF Usta" verisi taşındı/.test(lg), 'günlükte taşıma satırı yok');
    });
    await step('Önbellek, kilit, günlük ve posta kutusu taşınmadı', async () => {
      for (const rel of [path.join('Cache', 'Cache_Data', 'eski-onbellek.bin'), path.join('Code Cache', 'js', 'eski-onbellek.bin'),
        path.join('GPUCache', 'eski-onbellek.bin'), path.join('DawnCache', 'eski-onbellek.bin'), path.join('blob_storage', 'eski-onbellek.bin'),
        path.join('Crashpad', 'eski-onbellek.bin'), path.join('Local Storage', 'leveldb', 'eski-onbellek.log'),
        path.join('open-queue', 'eski.json'), 'lockfile']) {
        assert(!exists(rel), `taşınmaması gereken dosya kopyalanmış: ${rel}`);
      }
      assert(!fs.readFileSync(path.join(ud, 'pdfusta.log'), 'utf8').includes('ESKI-GUNLUK-SATIRI'), 'eski günlük taşınmış');
      if (exists('primary.json')) assert(!readJson(path.join(ud, 'primary.json')).eski, 'eski primary.json taşınmış');
      await sleep(1500); // posta kutusu izleyicisi bir şey açacak olsaydı açsın
      const tabs = await r.win.evaluate(() => window.__pu.App.docs.length);
      assert(tabs === 0, 'eski posta kutusundaki dosya açıldı');
    });
    await step('Tema değiştirilip kaydedildi', async () => {
      await r.win.click('#theme-btn');
      await sleep(700);
      assert(await r.win.evaluate(() => document.documentElement.dataset.theme) === 'light', 'tema açığa geçmedi');
    });
  } finally {
    await r.app.close().catch(() => {});
  }
  await sleep(500);

  await step('Eski klasör bayt bayt aynı kaldı', async () => {
    assert(fingerprint(legacy) === before, 'eski veri klasörü değişmiş');
    assert(readJson(path.join(legacy, 'settings.json')).theme === 'dark', 'eski ayar değişmiş');
  });
  const marker1 = fs.readFileSync(path.join(ud, 'migrated-from.json'), 'utf8');
  await step('Yeni klasörde değişen ayar diske yazıldı', async () => {
    assert(readJson(path.join(ud, 'settings.json')).theme === 'light', 'settings.json güncellenmedi');
  });

  // ---- 2. açılış: yeniden taşıma olmamalı ----
  r = await launch({ userData: ud, legacyUserData: legacyList(emptyUltronix, legacy) });
  curWin = r.win;
  try {
    await step('İkinci açılış yeniden kopyalamıyor, değişen ayar korunuyor', async () => {
      const th = await r.win.evaluate(() => document.documentElement.dataset.theme);
      assert(th === 'light', `tema yeniden eskiye döndü: ${th}`);
      assert(fs.readFileSync(path.join(ud, 'migrated-from.json'), 'utf8') === marker1, 'işaret dosyası yeniden yazıldı');
      const n = (fs.readFileSync(path.join(ud, 'pdfusta.log'), 'utf8').match(/verisi taşındı/g) || []).length;
      assert(n === 1, `taşıma ${n} kez çalıştı`);
    });
  } finally {
    await r.app.close().catch(() => {});
  }
  await sleep(500);

  // ---- 3. açılış: eski klasör verilmezse test klasörüne taşıma yapılmaz ----
  const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-rename-ud2-'));
  r = await launch({ userData: ud2 });
  curWin = r.win;
  try {
    await step('Eski klasör verilmeyen test açılışında taşıma yok', async () => {
      const th = await r.win.evaluate(() => document.documentElement.dataset.theme);
      assert(th === 'light', `tema: ${th}`);
      assert(!fs.existsSync(path.join(ud2, 'migrated-from.json')), 'işaret dosyası oluşmuş');
    });
  } finally {
    await r.app.close().catch(() => {});
  }
  await sleep(300);
  await step('Eski klasör üç açılıştan sonra da aynı', async () => {
    assert(fingerprint(legacy) === before, 'eski veri klasörü değişmiş');
  });

  // ---- 4. senaryo: taşıma sırasında eski ayar dosyası kilitli (antivirüs vb.) → işaret yazılmaz, sonraki açılışta tamamlanır ----
  const legacy2 = path.join(work, 'PDF Usta 2');
  const ud3 = path.join(work, 'HermoPDF 3');
  fs.mkdirSync(legacy2, { recursive: true });
  fs.writeFileSync(path.join(legacy2, 'settings.json'), JSON.stringify({ ...legacySettings, theme: 'light' }, null, 1));
  const before2 = fingerprint(legacy2);
  const locker = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `$f = [System.IO.File]::Open('${path.join(legacy2, 'settings.json').replace(/'/g, "''")}', 'Open', 'Read', 'None'); Write-Output 'kilitli'; Start-Sleep -Seconds 120; $f.Close()`], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('kilit alınamadı')), 20000);
      locker.stdout.on('data', (d) => { if (String(d).includes('kilitli')) { clearTimeout(t); res(); } });
    });
    r = await launch({ userData: ud3, legacyUserData: legacy2 });
    curWin = r.win;
    try {
      await step('Kilitli eski ayar: işaret dosyası yazılmadı, yeniden deneme notu bırakıldı', async () => {
        assert(!fs.existsSync(path.join(ud3, 'migrated-from.json')), 'başarısız taşımada işaret dosyası yazıldı');
        assert(fs.existsSync(path.join(ud3, 'migrate-retry.json')), 'yeniden deneme notu yok');
        assert(/sonraki açılışta yeniden denenecek/.test(fs.readFileSync(path.join(ud3, 'pdfusta.log'), 'utf8')), 'günlükte not yok');
      });
      await step('Yarım taşımalı oturumda kullanıcı koyu temayı seçti (uygulama kendi settings.json\'ını yazdı)', async () => {
        await r.win.click('#theme-btn');
        await sleep(700);
        assert(readJson(path.join(ud3, 'settings.json')).theme === 'dark', 'yeni oturumun ayarı yazılmadı');
      });
    } finally {
      await r.app.close().catch(() => {});
    }
  } finally {
    locker.kill();
  }
  await sleep(800);
  r = await launch({ userData: ud3, legacyUserData: legacy2 });
  curWin = r.win;
  try {
    await step('Kilit kalkınca sonraki açılışta taşıma tamamlandı (yeni oturumdaki ayar korunarak)', async () => {
      const m = readJson(path.join(ud3, 'migrated-from.json'));
      assert(JSON.stringify(m.items) === JSON.stringify(['settings.json']), `items: ${JSON.stringify(m.items)}`);
      assert(!fs.existsSync(path.join(ud3, 'migrate-retry.json')), 'yeniden deneme notu silinmedi');
      const s = await r.win.evaluate(() => window.__pu.App.settings);
      assert((s.signatures || []).some((x) => x.id === sig.id), 'imza gelmedi');
      assert((s.recent || []).includes(recentPdf), 'son açılanlar gelmedi');
      assert(s.lastSigName === 'Eski Kullanıcı', `lastSigName: ${s.lastSigName}`);
      assert(s.theme === 'dark', `yeni oturumda seçilen tema korunmadı: ${s.theme}`);
    });
  } finally {
    await r.app.close().catch(() => {});
  }
  await sleep(300);
  await step('Kilitli senaryoda da eski klasör bayt bayt aynı', async () => {
    assert(fingerprint(legacy2) === before2, 'eski veri klasörü değişmiş');
  });

  // ---- 5. senaryo: hem "Ultronix PDF" hem "PDF Usta" var → Ultronix seçilir, Pro lisansı da taşınır ----
  const oldUsta = path.join(work, 'iki', 'PDF Usta');
  const oldUltronix = path.join(work, 'iki', 'Ultronix PDF');
  const ud4 = path.join(work, 'iki', 'HermoPDF');
  for (const d of [oldUsta, oldUltronix, ud4]) fs.mkdirSync(d, { recursive: true });
  const ustaSig = { ...sig, id: 'usta-imzasi' };
  const ultronixSig = { ...sig, id: 'ultronix-imzasi' };
  fs.writeFileSync(path.join(oldUsta, 'settings.json'), JSON.stringify({ theme: 'light', recent: [], signatures: [ustaSig], lastSigName: 'Usta Dönemi' }, null, 1));
  fs.writeFileSync(path.join(oldUltronix, 'settings.json'), JSON.stringify({ theme: 'dark', recent: [recentPdf], signatures: [ultronixSig], lastSigName: 'Ultronix Dönemi' }, null, 1));
  const lic = makeLicense('test-live-1', liveKey.privateKey, { email: 'tasima@example.com', name: 'Taşıma Deneme' });
  const licJson = JSON.stringify({ key: lic.key, activatedAt: '2026-11-09T10:00:00.000Z' }, null, 1);
  fs.writeFileSync(path.join(oldUltronix, 'license.json'), licJson);
  const revJson = JSON.stringify({ 'test-live-1': signDoc({ v: 1, kid: 'test-live-1', iat: Math.floor(Date.now() / 1000) - 60, lids: [makeLid()] }, 'UREV1.', liveKey.privateKey) }, null, 1);
  fs.writeFileSync(path.join(oldUltronix, 'license-revocations.json'), revJson);
  fs.writeFileSync(path.join(oldUltronix, 'update-state.json'), JSON.stringify({ eskiDurum: 'ultronix' }, null, 1));
  fs.writeFileSync(path.join(oldUltronix, 'migrated-from.json'), JSON.stringify({ from: oldUsta, at: '2026-11-08T10:00:00.000Z', items: ['settings.json'] }, null, 1));
  fs.writeFileSync(path.join(oldUltronix, 'claude-bridge.json'), JSON.stringify({ pipe: '\\\\.\\pipe\\eski', token: 'eski', pid: 1 }));
  fs.writeFileSync(path.join(oldUltronix, 'pdfusta.log'), 'ULTRONIX-GUNLUK-SATIRI\n');
  // Yeni klasörde zaten bir güncelleme durumu var (ör. kurulumdan sonra çok kısa açılış): üzerine yazılmamalı
  const ud4State = JSON.stringify({ yeniDurum: true }, null, 1);
  fs.writeFileSync(path.join(ud4, 'update-state.json'), ud4State);
  const beforeUsta = fingerprint(oldUsta);
  const beforeUltronix = fingerprint(oldUltronix);
  r = await launch({ userData: ud4, legacyUserData: legacyList(oldUltronix, oldUsta) });
  curWin = r.win;
  try {
    await step('İki eski klasör: ayarlar "Ultronix PDF"ten geldi ("PDF Usta" değil)', async () => {
      const s = await r.win.evaluate(() => window.__pu.App.settings);
      assert(s.theme === 'dark' && s.lastSigName === 'Ultronix Dönemi', `ayarlar: ${s.theme} / ${s.lastSigName}`);
      assert((s.signatures || []).some((x) => x.id === 'ultronix-imzasi'), 'Ultronix imzası yok');
      assert(!(s.signatures || []).some((x) => x.id === 'usta-imzasi'), 'PDF Usta imzası karışmış');
    });
    await step('Pro lisansı taşındı ve uygulama Pro olarak açıldı', async () => {
      const st = await r.win.evaluate(() => window.pu.license.status());
      assert(st.pro === true && st.state === 'active', `durum: ${JSON.stringify(st)}`);
      assert(st.email === 'tasima@example.com', `e-posta: ${st.email}`);
      assert(fs.readFileSync(path.join(ud4, 'license.json'), 'utf8') === licJson, 'license.json birebir değil');
    });
    await step('İptal listesi taşındı, var olan güncelleme durumunun üzerine yazılmadı', async () => {
      assert(JSON.stringify(readJson(path.join(ud4, 'license-revocations.json'))) === JSON.stringify(JSON.parse(revJson)), 'iptal listesi farklı');
      assert(fs.readFileSync(path.join(ud4, 'update-state.json'), 'utf8') === ud4State || readJson(path.join(ud4, 'update-state.json')).yeniDurum === true, 'update-state.json üzerine yazıldı');
      assert(!readJson(path.join(ud4, 'update-state.json')).eskiDurum, 'eski güncelleme durumu yeninin üzerine yazıldı');
    });
    await step('İşaret dosyası Ultronix kaynağını ve taşınanları yazıyor; köprü/günlük/eski işaret taşınmadı', async () => {
      const m = readJson(path.join(ud4, 'migrated-from.json'));
      assert(m.from === oldUltronix, `from: ${m.from}`);
      assert(JSON.stringify(m.items) === JSON.stringify(['license.json', 'license-revocations.json', 'settings.json']), `items: ${JSON.stringify(m.items)}`);
      const lg = fs.readFileSync(path.join(ud4, 'pdfusta.log'), 'utf8');
      assert(/eski "Ultronix PDF" verisi taşındı/.test(lg), 'günlükte taşıma satırı yok');
      assert(!lg.includes('ULTRONIX-GUNLUK-SATIRI'), 'eski günlük taşınmış');
      if (fs.existsSync(path.join(ud4, 'claude-bridge.json'))) assert(readJson(path.join(ud4, 'claude-bridge.json')).token !== 'eski', 'eski köprü dosyası taşınmış');
    });
  } finally {
    await r.app.close().catch(() => {});
  }
  await sleep(300);
  await step('İki eski klasör de bayt bayt aynı kaldı', async () => {
    assert(fingerprint(oldUltronix) === beforeUltronix, '"Ultronix PDF" klasörü değişmiş');
    assert(fingerprint(oldUsta) === beforeUsta, '"PDF Usta" klasörü değişmiş');
  });
  await step('Yarım "Ultronix PDF" klasörü (settings.json yok) değişmedi', async () => {
    assert(fs.readdirSync(emptyUltronix).join() === 'pdfusta.log', `içerik: ${fs.readdirSync(emptyUltronix).join()}`);
  });

  const pass = results.filter((x) => x.ok).length;
  console.log(`\n${pass}/${results.length} adım başarılı`);
  for (const x of results.filter((y) => !y.ok)) console.log(`  ✘ ${x.name}: ${x.err}`);
  for (const d of [work, ud2]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* yoksay */ } }
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
