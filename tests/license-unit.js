// Lisans biçimi v1 birim testleri (düz node; Electron gerekmez).
// Yalnızca atılık anahtarlar kullanılır. Kullanım: node tests/license-unit.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const L = require('../src/main/license');
const { KEYS, withTestKeys, isDevRun, licensingConfig } = require('../src/main/keys');
const { endpoints, isSiteUrl } = require('../src/main/endpoints');
const { createUpdater } = require('../src/main/updates');
const { b64u, keyPair, makeLicense, signKey, signDoc } = require('./license-helpers');

const ROOT = path.join(__dirname, '..');
const results = [];
function step(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`✘ ${name}: ${String(e.message).split('\n')[0]}`);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };
const eq = (a, b, m) => assert(a === b, `${m || ''} beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`);

const live = keyPair();
const sbx = keyPair();
const rel = keyPair();
const other = keyPair();
const keys = {
  'license-live-2026a': { env: 'live', pem: live.pem },
  'license-sbx-2026a': { env: 'sandbox', pem: sbx.pem },
  'release-2026a': { env: 'release', pem: rel.pem },
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermopdf-lic-unit-'));

step('gömülü açık anahtarlar ~/.ultronix-keys/*.public.pem ile aynı; depoda özel anahtar yok', () => {
  const dir = path.join(os.homedir(), '.ultronix-keys');
  for (const kid of Object.keys(KEYS)) {
    const f = path.join(dir, `${kid}.public.pem`);
    if (fs.existsSync(f)) eq(KEYS[kid].pem.trim(), fs.readFileSync(f, 'utf8').replace(/\r/g, '').trim(), kid);
    const k = require('crypto').createPublicKey(KEYS[kid].pem);
    eq(k.asymmetricKeyType, 'ed25519', kid);
  }
  eq(KEYS['license-live-2026a'].env, 'live'); eq(KEYS['license-sbx-2026a'].env, 'sandbox'); eq(KEYS['release-2026a'].env, 'release');
  const hits = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, n.name);
      if (n.isDirectory()) { if (n.name !== 'shots' && n.name !== 'node_modules') walk(f); continue; }
      if (/\.(js|mjs|cjs|json|pem|txt|ultronixlicense|ultronpdflicense|hermopdflicense)$/i.test(n.name) && /-----BEGIN (ENCRYPTED )?PRIVATE KEY-----/.test(fs.readFileSync(f, 'utf8'))) hits.push(f);
    }
  };
  for (const d of ['src', 'tools', 'tests']) walk(path.join(ROOT, d));
  for (const f of fs.readdirSync(ROOT)) if (/\.pem$/i.test(f)) hits.push(f);
  assert(!hits.length, `özel anahtar bulundu: ${hits.join(', ')}`);
});

step('geçerli canlı lisans doğrulanır', () => {
  const { key, payload } = makeLicense('license-live-2026a', live.privateKey);
  const r = L.verifyKey(key, { keys });
  assert(r.ok, r.code); eq(r.env, 'live'); eq(r.payload.lid, payload.lid); eq(r.canonical, key);
});

step('sandbox lisansı: allowSandbox yoksa reddedilir, varsa kabul edilir', () => {
  const { key } = makeLicense('license-sbx-2026a', sbx.privateKey, { env: 'sandbox' });
  eq(L.verifyKey(key, { keys }).code, 'sandbox_not_allowed');
  eq(L.verifyKey(key, { keys, allowSandbox: false }).code, 'sandbox_not_allowed');
  assert(L.verifyKey(key, { keys, allowSandbox: true }).ok);
  // env alanı anahtarın türüyle uyuşmalı (sandbox anahtarıyla "live" iddiası)
  const lie = makeLicense('license-sbx-2026a', sbx.privateKey, { env: 'live' }).key;
  assert(!L.verifyKey(lie, { keys, allowSandbox: true }).ok);
});

step('değiştirilmiş payload ve imza reddedilir', () => {
  const { key, payload } = makeLicense('license-live-2026a', live.privateKey);
  const [, , s] = key.split('.');
  const forged = `UPRO1.${b64u(JSON.stringify({ ...payload, email: 'baska@example.com' }))}.${s}`;
  eq(L.verifyKey(forged, { keys }).code, 'signature');
  const sig = Buffer.from(s, 'base64url'); sig[5] ^= 1;
  eq(L.verifyKey(`${key.slice(0, key.lastIndexOf('.'))}.${b64u(sig)}`, { keys }).code, 'signature');
  // Başka bir anahtarla imzalanmış
  eq(L.verifyKey(makeLicense('license-live-2026a', other.privateKey).key, { keys }).code, 'signature');
});

step('yanlış önek reddedilir', () => {
  const { key, payload } = makeLicense('license-live-2026a', live.privateKey);
  eq(L.verifyKey(key.replace('UPRO1.', 'UPRO2.'), { keys }).code, 'format');
  eq(L.verifyKey(key.replace('UPRO1.', 'upro1.'), { keys }).code, 'format');
  // İmza başka bir önek üzerinden atılmış (ör. iptal listesi öneki)
  eq(L.verifyKey(signKey(payload, live.privateKey, { prefix: 'UREV1.' }), { keys }).code, 'signature');
});

step('bilinmeyen kid ve release anahtarıyla imzalı lisans reddedilir', () => {
  eq(L.verifyKey(makeLicense('license-live-2099z', live.privateKey).key, { keys }).code, 'unknown_key');
  eq(L.verifyKey(makeLicense('release-2026a', rel.privateKey).key, { keys }).code, 'unknown_key');
  eq(L.verifyKey(makeLicense('__proto__', live.privateKey).key, { keys }).code, 'unknown_key');
});

step('boşluk, satır kırılması, dolgu ve çevre metin tolere edilir', () => {
  const { key } = makeLicense('license-live-2026a', live.privateKey);
  const [, p, s] = key.split('.');
  assert(L.verifyKey(`   ${key}\r\n\n`, { keys }).ok, 'baş/son boşluk');
  const wrapped = key.match(/.{1,40}/g).join('\r\n');
  assert(L.verifyKey(wrapped, { keys }).ok, 'satırlara bölünmüş');
  const padded = `UPRO1.${p}${'='.repeat((4 - (p.length % 4)) % 4)}.${s}==`;
  assert(L.verifyKey(padded, { keys }).ok, 'dolgulu');
  const file = `HermoPDF Pro lisansı\nLisans sahibi: deneme@example.com\n\n${wrapped}\n\nTeşekkürler!\nThanks\n`;
  assert(L.verifyKey(file, { keys }).ok, 'dosya içeriği');
  eq(L.parseKey(file).canonical, key, 'kanonik biçim');
});

step('bozuk girdiler "format" hatası verir', () => {
  const { key, payload } = makeLicense('license-live-2026a', live.privateKey);
  for (const bad of ['', '   ', 'merhaba', 'UPRO1.', 'UPRO1..', `UPRO1.${b64u('{}')}`, key.slice(0, -5), 'UPRO1.!!!.' + 'A'.repeat(86), `UPRO1.${b64u('not json')}.${key.split('.')[2]}`, 'x'.repeat(70000) + key]) {
    eq(L.verifyKey(bad, { keys }).code, 'format', JSON.stringify(bad.slice(0, 30)));
  }
  eq(L.verifyKey(null, { keys }).code, 'format');
  eq(L.verifyKey(makeLicense('license-live-2026a', live.privateKey, { v: 2 }).key, { keys }).code, 'format', 'v:2');
  eq(L.verifyKey(makeLicense('license-live-2026a', live.privateKey, { lid: 'L123' }).key, { keys }).code, 'format', 'lid');
  eq(L.verifyKey(makeLicense('license-live-2026a', live.privateKey, { lid: 'LUUUUUUUUUUUUUUUU' }).key, { keys }).code, 'format', 'lid U');
  eq(L.verifyKey(makeLicense('license-live-2026a', live.privateKey, { email: 7 }).key, { keys }).code, 'format', 'email');
  assert(payload.v === 1);
});

step('bilinmeyen plan Pro değildir; ek alanlar yok sayılır', () => {
  eq(L.verifyKey(makeLicense('license-live-2026a', live.privateKey, { plan: 'pro_monthly' }).key, { keys }).code, 'plan');
  eq(L.verifyKey(makeLicense('license-live-2026a', live.privateKey, { plan: undefined }).key, { keys }).code, 'plan');
  const r = L.verifyKey(makeLicense('license-live-2026a', live.privateKey, { name: 'Ayşe', seats: 3, future: { x: 1 } }).key, { keys });
  assert(r.ok, r.code); eq(r.payload.name, 'Ayşe');
});

step('iptal listesi doğrulaması', () => {
  const doc = signDoc({ v: 1, kid: 'license-live-2026a', iat: 100, lids: ['LAAAAAAAAAAAAAAAA'] }, 'UREV1.', live.privateKey);
  const one = { 'license-live-2026a': keys['license-live-2026a'] };
  const r = L.verifySignedDoc(JSON.stringify(doc), 'UREV1.', one);
  assert(r.ok, r.code); eq(L.validateRevocations(r.payload).lids.has('LAAAAAAAAAAAAAAAA'), true);
  eq(L.verifySignedDoc(doc, 'UUPD1.', one).code, 'signature', 'yanlış önek');
  eq(L.verifySignedDoc({ ...doc, sig: doc.sig.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }, 'UREV1.', one).code, 'signature');
  // Sandbox anahtarıyla imzalanmış "canlı" liste
  eq(L.verifySignedDoc(signDoc({ v: 1, kid: 'license-live-2026a', iat: 1, lids: [] }, 'UREV1.', sbx.privateKey), 'UREV1.', one).code, 'signature');
  eq(L.verifySignedDoc(signDoc({ v: 1, kid: 'license-sbx-2026a', iat: 1, lids: [] }, 'UREV1.', sbx.privateKey), 'UREV1.', one).code, 'unknown_key');
  eq(L.verifySignedDoc('{"payload":1}', 'UREV1.', one).code, 'format');
  eq(L.verifySignedDoc('çöp', 'UREV1.', one).code, 'format');
});

step('lisans deposu: etkinleştir, iptal, geri dönüş koruması, yeniden yükleme', () => {
  const dir = path.join(tmp, 'store1');
  const store = L.createLicenseStore({ dir, keys });
  eq(store.load().state, 'free');
  const { key, payload } = makeLicense('license-live-2026a', live.privateKey, { email: 'ali@example.com' });
  eq(store.activate('çöp').code, 'format');
  eq(store.status().state, 'free', 'hatalı anahtardan sonra hâlâ ücretsiz');
  const a = store.activate(`\n  ${key}  \n`);
  assert(a.ok, a.code); eq(a.status.state, 'active'); eq(a.status.pro, true); eq(a.status.email, 'ali@example.com');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'license.json'), 'utf8'));
  eq(saved.key, key); assert(!('pro' in saved), 'pro bayrağı saklanmamalı');
  const rev = (iat, lids, priv = live.privateKey, kid = 'license-live-2026a') => JSON.stringify(signDoc({ v: 1, kid, iat, lids }, 'UREV1.', priv));
  eq(store.applyRevocations(rev(100, [payload.lid])).status.state, 'revoked');
  eq(store.applyRevocations(rev(50, [])).code, 'stale', 'eski liste');
  eq(store.applyRevocations(rev(100, [])).code, 'stale', 'aynı tarihli liste');
  eq(store.status().state, 'revoked');
  eq(store.applyRevocations(rev(500, [], other.privateKey)).code, 'signature');
  eq(store.applyRevocations(rev(500, [], sbx.privateKey, 'license-sbx-2026a')).code, 'unknown_key');
  // Yeniden açılış: kayıtlı liste yeniden doğrulanır
  eq(L.createLicenseStore({ dir, keys }).load().state, 'revoked', 'yeniden yüklemede iptal korunur');
  // İptal edilmiş anahtar yeniden etkinleştirilemez
  eq(store.activate(key).code, 'revoked');
  const back = store.applyRevocations(rev(200, ['LZZZZZZZZZZZZZZZZ']));
  assert(back.ok && back.changed); eq(back.status.state, 'active');
  // İptal dosyasıyla oynanırsa yok sayılır (lisans etkin kalır)
  const rf = path.join(dir, 'license-revocations.json');
  const j = JSON.parse(fs.readFileSync(rf, 'utf8'));
  j['license-live-2026a'] = JSON.parse(rev(900, [payload.lid], other.privateKey));
  fs.writeFileSync(rf, JSON.stringify(j));
  eq(L.createLicenseStore({ dir, keys }).load().state, 'active');
  // Elle "pro" yazılmış sahte dosya
  fs.writeFileSync(path.join(dir, 'license.json'), JSON.stringify({ key: 'UPRO1.sahte', pro: true, state: 'active' }));
  const s2 = L.createLicenseStore({ dir, keys }).load();
  eq(s2.state, 'invalid'); eq(s2.pro, false);
  // Paketlenmiş sürümde sandbox lisansı kayıtlıysa geçersiz sayılır
  const sb = makeLicense('license-sbx-2026a', sbx.privateKey, { env: 'sandbox' }).key;
  fs.writeFileSync(path.join(dir, 'license.json'), JSON.stringify({ key: sb }));
  eq(L.createLicenseStore({ dir, keys, allowSandbox: false }).load().code, 'sandbox_not_allowed');
  eq(L.createLicenseStore({ dir, keys, allowSandbox: true }).load().state, 'active');
  eq(store.remove().state, 'free');
  assert(!fs.existsSync(path.join(dir, 'license.json')));
});

step('güncelleme dosyası doğrulaması (imza, önek, adres, sürüm)', () => {
  const env = { ULTRONIX_SITE_URL: 'https://hermopdf.com' };
  const up = createUpdater({
    dir: path.join(tmp, 'upd'), appVersion: '1.2.0', keys, license: { status: () => ({ state: 'free' }) },
    endpoints: () => endpoints(env), isSiteUrl: (u) => isSiteUrl(u, env), getSettings: () => ({}), setSettings() {}, flushSettings() {}, send() {}, openExternal() {},
  });
  const man = (o = {}) => ({ v: 1, version: '1.3.0', date: '2026-11-08', url: 'https://hermopdf.com/indir', sha256: 'a'.repeat(64), notes: { tr: 'Yeni', en: 'New' }, ...o });
  const good = up.verifyManifest(JSON.stringify(signDoc(man(), 'UUPD1.', rel.privateKey)));
  assert(good.ok, good.code); eq(good.manifest.version, '1.3.0');
  eq(up.verifyManifest(signDoc(man(), 'UREV1.', rel.privateKey)).code, 'signature', 'yanlış önek');
  eq(up.verifyManifest(signDoc(man(), 'UUPD1.', live.privateKey)).code, 'signature', 'lisans anahtarı geçmez');
  eq(up.verifyManifest(signDoc(man({ url: 'https://kotu.example.com/indir' }), 'UUPD1.', rel.privateKey)).code, 'url');
  eq(up.verifyManifest(signDoc(man({ url: 'http://hermopdf.com/indir' }), 'UUPD1.', rel.privateKey)).code, 'url');
  eq(up.verifyManifest(signDoc(man({ version: '1.3' }), 'UUPD1.', rel.privateKey)).code, 'format');
  eq(up.verifyManifest(signDoc(man({ sha256: 'xyz' }), 'UUPD1.', rel.privateKey)).code, 'format');
  eq(up.verifyManifest(signDoc(man({ v: 2 }), 'UUPD1.', rel.privateKey)).code, 'format');
  eq(up.verifyManifest(JSON.stringify({ payload: 'A'.repeat(70000), sig: 'x' })).code, 'format', '64 KB sınırı');
  eq(up.getPrefs().updateCheck, null, 'varsayılan: sorulmadı');
});

step('uç noktalar: varsayılanlar, ortam değişkeni, güvenli dış adres', () => {
  const d = endpoints({});
  eq(d.site, 'https://hermopdf.com'); eq(d.api, 'https://api.hermopdf.com');
  eq(d.updates, 'https://hermopdf.com/updates/latest.json'); eq(d.revocations, 'https://api.hermopdf.com/v1/revocations');
  eq(d.pricing, 'https://hermopdf.com/pricing/?from=app');
  eq(endpoints({}, 'tr').pricing, 'https://hermopdf.com/tr/fiyat/?from=app');
  eq(endpoints({}, 'de').pricing, 'https://hermopdf.com/de/pricing/?from=app');
  eq(endpoints({}, 'pt-BR').support, 'https://hermopdf.com/pt-br/support/');
  eq(endpoints({}, 'xx').pricing, 'https://hermopdf.com/pricing/?from=app', 'bilinmeyen dil: İngilizce');
  const t = endpoints({ ULTRONIX_SITE_URL: 'http://127.0.0.1:5555/', ULTRONIX_API_URL: 'http://127.0.0.1:5556' });
  eq(t.site, 'http://127.0.0.1:5555'); eq(t.revocations, 'http://127.0.0.1:5556/v1/revocations');
  eq(endpoints({ ULTRONIX_SITE_URL: 'http://kotu.example.com' }).site, 'https://hermopdf.com', 'uzak http reddedilir');
  eq(endpoints({ ULTRONIX_SITE_URL: 'javascript:alert(1)' }).site, 'https://hermopdf.com');
  assert(isSiteUrl('https://hermopdf.com/indir', {}));
  assert(isSiteUrl('https://www.hermopdf.com/x', {}));
  assert(!isSiteUrl('http://hermopdf.com/indir', {}));
  assert(!isSiteUrl('https://hermopdf.com.kotu.com/indir', {}));
  assert(!isSiteUrl('https://user@hermopdf.com/', {}));
  assert(!isSiteUrl('file:///C:/Windows/notepad.exe', {}));
});

step('compareVersions', () => {
  const c = L.compareVersions;
  eq(c('1.2.0', '1.2.0'), 0); eq(c('1.2.1', '1.2.0'), 1); eq(c('1.2.0', '1.10.0'), -1); eq(c('2.0.0', '1.99.99'), 1);
  eq(c('v1.3.0', '1.3.0'), 0); eq(c('1.3.0-beta.1', '1.3.0'), -1); eq(c('1.3.0', '1.3.0-rc.1'), 1);
  eq(c('1.3.0-beta.2', '1.3.0-beta.10'), -1); eq(c('1.3.0-alpha', '1.3.0-beta'), -1); eq(c('1.3.0-1', '1.3.0-alpha'), -1);
  assert(Number.isNaN(c('1.3', '1.2.0'))); assert(Number.isNaN(c('', '1.2.0'))); assert(!(c('abc', '1.0.0') > 0));
});

step('test anahtarları gömülü kimliklerin üzerine yazamaz', () => {
  const k = withTestKeys(JSON.stringify({ 'license-live-2026a': { env: 'live', pem: other.pem }, 'test-x': { env: 'live', pem: other.pem }, 'test-y': { env: 'admin', pem: other.pem } }));
  eq(k['license-live-2026a'].pem, KEYS['license-live-2026a'].pem); assert(k['test-x']); assert(!k['test-y']);
  eq(Object.keys(withTestKeys('çöp')).length, 3);
});

step('kurulu sürüm: sandbox lisansı ve test anahtarları hiçbir ortam değişkeniyle açılmaz (exe adı "electron.exe" olsa bile)', () => {
  const env = { PDFUSTA_TEST: '1', ULTRONIX_ALLOW_SANDBOX: '1', ULTRONIX_TEST_KEYS: JSON.stringify({ 'test-evil': { env: 'live', pem: other.pem } }) };
  const inst = 'C:\\Users\\u\\AppData\\Local\\Programs\\HermoPDF';
  const res = `${inst}\\resources`;
  // Kurulu sürüm, normal exe adıyla
  const packed = licensingConfig({ isPackaged: true, appPath: `${res}\\app.asar`, resourcesPath: res, env });
  // Kurulu sürüm, exe "electron.exe" diye kopyalanmış: Electron isPackaged=false der, ama kod hâlâ resources içinde
  const renamed = licensingConfig({ isPackaged: false, appPath: `${res}\\app.asar`, resourcesPath: res, env });
  const unpackedDir = licensingConfig({ isPackaged: false, appPath: `${res}\\app`, resourcesPath: res, env });
  for (const [name, c] of Object.entries({ packed, renamed, unpackedDir })) {
    eq(c.dev, false, name); eq(c.devTest, false, name); eq(c.allowSandbox, false, name);
    assert(!c.keys['test-evil'], `${name}: test anahtarı kabul edildi`);
    eq(Object.keys(c.keys).sort().join(), Object.keys(KEYS).sort().join(), name);
    // Sandbox lisansı bu ayarlarla Pro açmaz
    const { key } = makeLicense('license-sbx-2026a', sbx.privateKey, { env: 'sandbox' });
    eq(L.verifyKey(key, { keys: { ...c.keys, 'license-sbx-2026a': keys['license-sbx-2026a'] }, allowSandbox: c.allowSandbox }).code, 'sandbox_not_allowed', name);
  }
  // Geliştirme: repo içinden `electron .`
  const dev = licensingConfig({ isPackaged: false, appPath: ROOT, resourcesPath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'resources'), env });
  eq(dev.dev, true); eq(dev.devTest, true); eq(dev.allowSandbox, true); assert(dev.keys['test-evil']);
  const devNoTest = licensingConfig({ isPackaged: false, appPath: ROOT, resourcesPath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'resources'), env: {} });
  eq(devNoTest.devTest, false); assert(!devNoTest.keys['test-evil']);
  // Eksik bilgi → güvenli taraf
  eq(isDevRun({ isPackaged: undefined, appPath: ROOT, resourcesPath: '/x' }), false);
  eq(isDevRun({ isPackaged: false, appPath: '', resourcesPath: '/x' }), false);
  // main.js bu yardımcıyı kullanır; eski ortam değişkeni anahtarı kaldırıldı
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
  assert(!/ULTRONIX_ALLOW_SANDBOX/.test(main), 'main.js hâlâ ULTRONIX_ALLOW_SANDBOX okuyor');
  assert(/licensingConfig\(\{ isPackaged: app\.isPackaged, appPath: app\.getAppPath\(\), resourcesPath: process\.resourcesPath/.test(main), 'main.js licensingConfig kullanmıyor');
  assert(!/!app\.isPackaged/.test(main), 'main.js hâlâ yalnızca app.isPackaged ile karar veriyor');
});

step('tools/release-manifest.mjs: atılık anahtarla imzalar ve doğrular', () => {
  const work = path.join(tmp, 'rel');
  fs.mkdirSync(work, { recursive: true });
  const inst = path.join(work, 'HermoPDF-Setup-9.9.9.exe');
  fs.writeFileSync(inst, 'sahte kurulum dosyası');
  const priv = path.join(work, 'throwaway.private.pem');
  const pub = path.join(work, 'throwaway.public.pem');
  fs.writeFileSync(priv, rel.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(pub, rel.pem);
  const out = path.join(work, 'latest.json');
  const base = ['tools/release-manifest.mjs', '--version', '9.9.9', '--installer', inst, '--url', 'https://hermopdf.com/indir', '--notes-tr', 'Türkçe not', '--notes-en', 'English', '--key', priv, '--out', out, '--date', '2026-11-08'];
  const env = { ...process.env };
  delete env.ULTRONIX_SITE_URL;
  // Gömülü release anahtarıyla doğrulanamaz → dosya yazılmaz
  const r1 = spawnSync(process.execPath, base, { cwd: ROOT, env, encoding: 'utf8' });
  assert(r1.status !== 0 && !fs.existsSync(out), 'atılık anahtar gömülü anahtarla doğrulanmamalıydı');
  const r2 = spawnSync(process.execPath, [...base, '--pub', pub], { cwd: ROOT, env, encoding: 'utf8' });
  eq(r2.status, 0, r2.stderr);
  assert(!/PRIVATE KEY/.test(r2.stdout + r2.stderr), 'özel anahtar çıktıya düştü');
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  const v = L.verifySignedDoc(doc, 'UUPD1.', { 'release-2026a': keys['release-2026a'] });
  assert(v.ok, v.code);
  const m = L.validateManifest(v.payload);
  eq(m.version, '9.9.9'); eq(m.sha256, require('crypto').createHash('sha256').update('sahte kurulum dosyası').digest('hex')); eq(m.notes.tr, 'Türkçe not');
  const r3 = spawnSync(process.execPath, [...base.slice(0, 6), 'http://hermopdf.com/indir', ...base.slice(7), '--pub', pub], { cwd: ROOT, env, encoding: 'utf8' });
  assert(r3.status !== 0, 'http adresi reddedilmeliydi');
});

fs.rmSync(tmp, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} adım başarılı`);
process.exit(bad.length ? 1 : 0);
