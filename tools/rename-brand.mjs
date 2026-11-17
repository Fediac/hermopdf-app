#!/usr/bin/env node
// Marka (ürün adı) değiştirme aracı — bağımlılıksız Node.
//
//   node tools/rename-brand.mjs --to "HermesPDF" [--domain hermespdf.com] [--apply]
//   node tools/rename-brand.mjs --undo 20261112-143000
//
// Varsayılan DENEME: hiçbir şey yazmaz; neyin değişeceğini, neye dokunulmayacağını ve nedenini raporlar.
// --apply : değiştirir; değişen her dosyanın özgün halini design/rename-yedek/<tarih>/ altına koyar.
// --undo  : o yedeği geri yükler (apply'dan sonra dosya değiştiyse --force olmadan durur).
// Seçenekler: --from "UltronPDF" (şimdiki ad), --root <klasör> (varsayılan: bu aracın üst klasörü),
//             --samples N (kategori başına örnek satır, varsayılan 3), --files (dosya dosya döküm), --json
//
// Güvenlik: eşleşmeler sınır-bilinçli (harf içinde kalan "MULTRONIC" gibi parçalar eşleşmez; "Ultronix" hedef değildir),
// idempotent (ikinci çalıştırma değişiklik bulmaz), CRLF/LF ve UTF-8 BOM korunur, ikili dosyaya yazılmaz.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- argümanlar
const argv = process.argv.slice(2);
const opt = { apply: false, files: false, json: false, force: false, samples: 3 };
function die(msg) { console.error('HATA: ' + msg); process.exit(1); }
function help() {
  console.log('Kullanım: node tools/rename-brand.mjs --to "YeniAd" [--domain yeni.com] [--apply]\n          node tools/rename-brand.mjs --undo <tarih>\nAyrıntı: dosyanın başındaki açıklama.');
}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => { if (i + 1 >= argv.length) die(`${a} için değer yok`); return argv[++i]; };
  if (a === '--to') opt.to = val();
  else if (a === '--from') opt.from = val();
  else if (a === '--domain') opt.domain = val();
  else if (a === '--old-domain') opt.oldDomain = val();
  else if (a === '--root') opt.root = val();
  else if (a === '--undo') opt.undo = val();
  else if (a === '--samples') opt.samples = Math.max(0, parseInt(val(), 10) || 0);
  else if (a === '--apply') opt.apply = true;
  else if (a === '--files') opt.files = true;
  else if (a === '--json') opt.json = true;
  else if (a === '--force') opt.force = true;
  else if (a === '-h' || a === '--help') { help(); process.exit(0); }
  else die(`Bilinmeyen seçenek: ${a}`);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(opt.root || path.join(HERE, '..'));
const BACKUP_BASE = path.join(ROOT, 'design', 'rename-yedek');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- geri al
function undo(stampArg) {
  const dir = path.join(BACKUP_BASE, stampArg);
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) die('Yedek bulunamadı: ' + dir);
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const bad = [];
  for (const e of m.entries) {            // dosya apply'dan sonra elle değiştiyse sessizce ezme
    const rn = m.renames.find((r) => r.from === e.rel);
    const cur = path.join(ROOT, rn ? rn.to : e.rel);
    if (fs.existsSync(cur) && sha(fs.readFileSync(cur)) !== e.after) bad.push(e.rel);
  }
  if (bad.length && !opt.force) die(`Bu dosyalar apply'dan sonra değişmiş, geri alma durduruldu (zorlamak için --force):\n  ${bad.join('\n  ')}`);
  for (const r of [...m.renames].reverse()) {
    const a = path.join(ROOT, r.to), b = path.join(ROOT, r.from);
    if (fs.existsSync(a) && !fs.existsSync(b)) fs.renameSync(a, b);
  }
  for (const e of m.entries) {
    const src = path.join(dir, 'files', ...e.rel.split('/'));
    fs.writeFileSync(path.join(ROOT, e.rel), fs.readFileSync(src));
  }
  console.log(`GERİ ALINDI: ${m.entries.length} dosya özgün haline döndü, ${m.renames.length} yeniden adlandırma geri çevrildi (${m.from} ← ${m.to}).`);
}
if (opt.undo) { undo(opt.undo); process.exit(0); }
if (!opt.to) { help(); die('--to gerekli'); }

// ---------------------------------------------------------------- ad biçimleri
const FROM = opt.from || 'UltronPDF';
const TO = opt.to.trim();
if (!TO || /["'<>\\/]/.test(TO)) die('--to geçersiz karakter içeriyor');
if (TO.toLowerCase().replace(/\s+/g, '') === FROM.toLowerCase().replace(/\s+/g, '')) die('Yeni ad şimdikiyle aynı');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const split = (n) => { const m = /^(.*?)\s*(PDF)$/i.exec(n.trim()); return m && m[1] ? { stem: m[1], suffix: m[2] } : { stem: n.trim(), suffix: '' }; };
const f = split(FROM);
const t = split(TO);
const FORM = {
  pascal: TO.replace(/\s+/g, ''),                       // HermesPDF
  spaced: t.suffix ? `${t.stem} PDF` : TO,              // Hermes PDF
  slug: TO.replace(/\s+/g, '').toLowerCase(),           // hermespdf
  upper: TO.replace(/\s+/g, '').toUpperCase(),          // HERMESPDF
};
const FROM_SLUG = FROM.replace(/\s+/g, '').toLowerCase();
const OLD_DOMAIN = (opt.oldDomain || FROM_SLUG + '.com').toLowerCase();
const NEW_DOMAIN = opt.domain ? opt.domain.trim().toLowerCase() : null;
if (NEW_DOMAIN && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(NEW_DOMAIN)) die('--domain geçersiz (örn. hermespdf.com)');
const nameBody = f.suffix ? `${esc(f.stem)}\\s?${esc(f.suffix)}` : esc(FROM);
// harf içinde kalmasın (MULTRONIC...), ama JS dizgesindeki "\n" kaçışından hemen sonra gelebilsin ("\nUltronPDF")
const NAME_RE = () => new RegExp(`(?:(?<![A-Za-z])|(?<=\\\\[nrt]))${nameBody}`, 'gi');
const STEM_RE = () => new RegExp(esc(f.stem), 'gi');
const formFor = (m) => {
  const compact = m.replace(/\s+/g, '');
  if (/\s/.test(m)) return m === m.toUpperCase() ? FORM.spaced.toUpperCase() : FORM.spaced;
  if (compact === compact.toUpperCase()) return FORM.upper;
  if (compact === compact.toLowerCase()) return FORM.slug;
  return FORM.pascal;
};

// ---------------------------------------------------------------- dosya taraması
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-mcpb', '.git', 'rename-yedek', '.wrangler']);
const SKIP_PATHS = ['build/mcp/', 'website/dist/', 'tests/shots/'];          // üretilmiş / .gitignore'lu
const SKIP_REL = new Set(['tools/rename-brand.mjs', 'design/YENIDEN_ADLANDIRMA.md']);     // aracın kendisi ve raporu
const SKIP_FILES = new Set(['.dev.vars']);                                   // gizli değerler: okunmaz, yazılmaz
const BIN_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.exe', '.dll', '.docx', '.xlsx', '.pptx', '.pdf', '.zip', '.mcpb', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.mp3', '.wav', '.pem', '.bin', '.blockmap', '.map']);

const files = [];      // { abs, rel }
const nameHits = [];   // dosya/klasör adında stem geçenler
const STEM_NAME = new RegExp(esc(f.stem), 'i');
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const r = rel(abs);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || SKIP_PATHS.some((p) => (r + '/').startsWith(p))) continue;
      if (STEM_NAME.test(e.name)) nameHits.push({ rel: r, dir: true });
      walk(abs);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name) || e.name.endsWith('.zip')) continue;
      if (SKIP_PATHS.some((p) => r.startsWith(p)) || SKIP_REL.has(r)) continue;
      if (STEM_NAME.test(e.name)) nameHits.push({ rel: r, dir: false, bin: BIN_EXT.has(path.extname(e.name).toLowerCase()) });
      files.push({ abs, rel: r });
    }
  }
})(ROOT);

// ---------------------------------------------------------------- sınıflandırma kuralları
const CATS = [
  ['Uygulama kodu (src/main, src/mcp, src/renderer)', /^src\//],
  ['Paketleme (package.json, build/, tools/build-*)', /^(package(-lock)?\.json|build\/|tools\/build-)/],
  ['Belge üreteçleri (tools/yol-haritasi, lansman-plani, pazar-raporu)', /^tools\/(yol-haritasi|lansman-plani|pazar-raporu)\.js$/],
  ['Kök belgeler (README, CHANGELOG, TRADEMARKS...)', /^[^/]+\.md$/],
  ['Site içeriği (website/src/content, partials, config)', /^website\/src\/(content|partials|config)\//],
  ['Site diğer (css/js, build, tools, QA)', /^website\//],
  ['Lisans sunucusu (server/)', /^server\//],
  ['Pazarlama metinleri (docs/marketing)', /^docs\/marketing\//],
  ['Testler (tests/)', /^tests\//],
  ['Araçlar (tools/ diğer)', /^tools\//],
];
const catOf = (r) => (CATS.find(([, re]) => re.test(r)) || ['Diğer'])[0];
const HIST_FILE = [/^docs\/research\//, /^design\/ISIM_TARAMASI/];             // tarihsel kayıt: komple dokunulmaz
// Tarihsel ad anlatımı: eski adı / marka çatışmasını anlatan satırlar olduğu gibi kalır
const HIST_LINE = /Ultronix|Marvel|Hindistan|Seçilen ad|Age of Ultron|ULTRON markası/i;
// Eski ad taşıma listeleri: yalnızca tırnak/ters bölü hemen öncesindeki ad korunur (makro adları normal değişir)
const MIGRATE_LINE = /LEGACY_DIR_NAMES\s*=|insertmacro\s+\w+\s+"\\[^"]+"\s+\d+/;

const stats = { change: new Map(), keep: new Map() };   // kategori/neden -> { occ, files:Map, samples:[] }
const bucket = (m, key) => { let b = m.get(key); if (!b) m.set(key, b = { occ: 0, files: new Map(), samples: [] }); return b; };
const note = (m, key, r, line, lineNo) => {
  const b = bucket(m, key); b.occ++; b.files.set(r, (b.files.get(r) || 0) + 1);
  if (b.samples.length < opt.samples && !b.samples.some((s) => s.r === r && s.n === lineNo)) b.samples.push({ r, n: lineNo, line: line.trim().slice(0, 150) });
};
let totalOcc = 0, totalLines = 0;
const plan = [];       // { f, before, after, buf, changes }
const unreadable = [];

// Bir ad eşleşmesi için karar: { to } değiştir ya da { keep: neden }
function decide(ctx, m, idx, line) {
  const compact = m[0].replace(/\s+/g, '');
  const after = line.slice(idx + m[0].length);
  const before = line.slice(0, idx);
  if (ctx.histFile) return { keep: 'Tarihsel dosya (docs/research, design/ISIM_TARAMASI*): kayıt olduğu gibi kalır' };
  if (ctx.oldSection) return { keep: 'CHANGELOG eski sürüm girdileri: tarihsel' };
  if (MIGRATE_LINE.test(line)) {
    return /['"\\]$/.test(before) ? { keep: 'Eski ad taşıma listesi (userData / kurulum klasörü): yeni ad "eski ad" olarak EKLENİR, satır yeniden yazılmaz' } : { to: formFor(m[0]) };
  }
  if (HIST_LINE.test(line)) return { keep: 'Tarihsel ad anlatımı (Ultronix/Marvel/Hindistan/isim kararı satırları)' };
  if (compact === compact.toLowerCase()) {
    if (/^license/i.test(after)) return { keep: `Lisans dosyası uzantısı .${FROM_SLUG}license (sözleşme biçimi; eski kullanıcı dosyaları; sunucu+site+uygulama birlikte değişmeli)` };
    if (/^-license-(sbx|live)/i.test(after)) return { keep: `Cloudflare worker / D1 kaynak adları (${FROM_SLUG}-license-*): yeni kaynak açılıp veri taşınmadan değişmez` };
    if (/^-pro-lifetime/i.test(after)) return { keep: `Paddle ürün kodu (sku ${FROM_SLUG}-pro-lifetime): ödeme kataloğu kimliği` };
    const tail = line.slice(idx).toLowerCase();
    if (tail.startsWith(OLD_DOMAIN) && !/[\w-]/.test(line.charAt(idx + OLD_DOMAIN.length))) {
      const sub = /@$/.test(before) ? 'e-posta adresi' : /api\.$/i.test(before) ? 'API / güncelleme uç noktası' : 'site adresi';
      if (!NEW_DOMAIN) return { keep: `Alan adı (${sub}): --domain verilmedi, alan adı kesinleşene kadar dokunulmaz` };
      return { to: NEW_DOMAIN, extra: OLD_DOMAIN.length - m[0].length, cat: `Alan adı → ${NEW_DOMAIN} (${sub})` };
    }
    if (/^\.(net|app|org)\b/i.test(after)) return { keep: 'Alternatif alan adı anlatımı (.net/.app)' };
  }
  return { to: formFor(m[0]) };
}

for (const fi of files) {
  const buf = fs.readFileSync(fi.abs);
  if (BIN_EXT.has(path.extname(fi.abs).toLowerCase()) || buf.subarray(0, 8000).includes(0)) continue; // ikili
  const text = buf.toString('utf8');
  if (!STEM_RE().test(text)) continue;
  if (!Buffer.from(text, 'utf8').equals(buf)) { unreadable.push(fi.rel); continue; }
  const histFile = HIST_FILE.some((re) => re.test(fi.rel));
  const parts = text.split(/(\r\n|\n|\r)/);
  let changed = false, sections = 0, fileChanges = 0;
  for (let p = 0; p < parts.length; p += 2) {
    const line = parts[p];
    if (fi.rel === 'CHANGELOG.md' && /^## \[/.test(line)) sections++;
    const ctx = { histFile, oldSection: fi.rel === 'CHANGELOG.md' && sections >= 2 };
    if (!STEM_RE().test(line)) continue;
    totalLines++;
    const cat = catOf(fi.rel);
    const spans = [];
    let out = '', last = 0, m;
    const found = [];
    if (f.suffix) {                                        // logo yazısı: Ultron<b>PDF</b> (ad iki etikete bölünmüş)
      const wm = new RegExp(esc(f.stem) + '(<b(?:\\s[^>]*)?>)' + esc(f.suffix) + '(</b>)', 'g');
      while ((m = wm.exec(line))) found.push({ m, wm: true });
    }
    const re = NAME_RE();
    while ((m = re.exec(line))) {
      const nc = line.charAt(m.index + m[0].length);   // sağ sınır: kelime ortasında kalan eşleşme sayılmaz (ultronpdfReplaceTail gibi tanımlayıcılarda büyük harf serbest)
      const compact = m[0].replace(/\s+/g, '');
      if ((/[a-z]/.test(nc) && !line.startsWith('license', m.index + m[0].length)) || (/[A-Z]/.test(nc) && compact !== compact.toLowerCase())) { re.lastIndex = m.index + 1; continue; }
      found.push({ m });
      re.lastIndex = Math.max(re.lastIndex, m.index + m[0].length);
    }
    found.sort((a, b) => a.m.index - b.m.index);
    for (const { m, wm } of found) {                       // 1) hedef eşleşmeler (ad)
      if (m.index < last) continue;
      const d = wm
        ? { to: t.suffix ? FORM.pascal.replace(/PDF$/i, '') + m[1] + 'PDF' + m[2] : FORM.pascal, cat: 'Logo yazısı (Ultron<b>PDF</b> biçimi; yeni ad PDF ile bitmiyorsa görünümü el ile bak)' }
        : decide(ctx, m, m.index, line);
      const end = m.index + m[0].length + (d.extra || 0);
      spans.push([m.index, end]);
      totalOcc++;
      if (d.keep) note(stats.keep, d.keep, fi.rel, line, p / 2 + 1);
      else { note(stats.change, d.cat ? d.cat : cat, fi.rel, line, p / 2 + 1); out += line.slice(last, m.index) + d.to; last = end; fileChanges++; }
    }
    out += line.slice(last);
    const sr = STEM_RE();                                  // 2) hedef olmayan geçişler: eski ad kalıntıları vb.
    while ((m = sr.exec(line))) {
      if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
      totalOcc++;
      const around = line.slice(Math.max(0, m.index - 12), m.index + 24);
      let why;
      if (histFile) why = 'Tarihsel dosya (docs/research, design/ISIM_TARAMASI*): kayıt olduğu gibi kalır';
      else if (ctx.oldSection) why = 'CHANGELOG eski sürüm girdileri: tarihsel';
      else if (/ULTRONIX_[A-Z_]+/.test(around)) why = 'Ortam değişkenleri ULTRONIX_* (test/geliştirici anahtarları; tests/ ve src/ birlikte kullanır, kullanıcıya görünmez)';
      else if (/\.ultronix-keys/i.test(around)) why = 'Özel anahtar klasörü ~/.ultronix-keys (sahibinin bilgisayarında; adı değişirse anahtarlar "kaybolur")';
      else if (/ultronixlicense/i.test(around)) why = 'Eski lisans dosyası uzantısı .ultronixlicense (uygulama hâlâ açar)';
      else if (/ultronx1/i.test(around)) why = 'Kriptografik / sınama sabiti (ultronx1): imza-anahtar biçimi';
      else if (/ultronix/i.test(around)) why = 'Eski ad "Ultronix" kalıntıları (taşıma kodu, test verileri, kaynak yorumları)';
      else why = 'Yalın "Ultron" / benzer-ad örnekleri (Marvel, ULTRONIC, benzerlik taraması anlatımı)';
      note(stats.keep, why, fi.rel, line, p / 2 + 1);
    }
    if (out !== line) { parts[p] = out; changed = true; }
  }
  if (changed) plan.push({ f: fi, buf, before: text, after: parts.join(''), changes: fileChanges });
}

// ---------------------------------------------------------------- taşıma yamaları (eski adı "eski ad" listesine ekle)
const patches = [];   // { rel, what, status }
function planPatch(relPath, what, fn) {
  const fi = files.find((x) => x.rel === relPath);
  if (!fi) { patches.push({ rel: relPath, what, status: 'dosya yok' }); return; }
  let cur = plan.find((p) => p.f.rel === relPath);
  const buf = fs.readFileSync(fi.abs);
  const next = fn(cur ? cur.after : buf.toString('utf8'));
  if (next === null) { patches.push({ rel: relPath, what, status: 'zaten var / işaret bulunamadı (uygulanmaz)' }); return; }
  patches.push({ rel: relPath, what, status: 'EKLENECEK' });
  if (!cur) { cur = { f: fi, buf, before: buf.toString('utf8'), after: next, changes: 0 }; plan.push(cur); } else cur.after = next;
}
planPatch('src/main/main.js', `LEGACY_DIR_NAMES listesinin başına '${FROM}' (eski veri klasörü adı) eklenir`, (txt) => {
  const m = /(const LEGACY_DIR_NAMES = \[)([^\]]*)(\];)/.exec(txt);
  if (!m || m[2].includes(`'${FROM}'`)) return null;
  return txt.replace(m[0], () => `${m[1]}'${FROM}', ${m[2].trim()}${m[3]}`);
});
planPatch('build/installer.nsh', `Eski kurulum klasörü "\\${FROM}" için ReplaceTail satırı eklenir`, (txt) => {
  const re = /^([ \t]*)!insertmacro (\w+) "\\[^"]+" \d+[^\r\n]*$/gm;
  let last = null, mm;
  while ((mm = re.exec(txt))) last = mm;
  if (!last || txt.includes(`"\\${FROM}"`)) return null;
  const eol = txt.includes('\r\n') ? '\r\n' : '\n';
  const add = `${last[1]}!insertmacro ${last[2]} "\\${FROM}" ${FROM.length + 1}`;
  return txt.slice(0, last.index + last[0].length) + eol + add + txt.slice(last.index + last[0].length);
});

// ---------------------------------------------------------------- rapor
const lines = [];
const P = (s = '') => lines.push(s);
P(`# Marka değiştirme ${opt.apply ? 'UYGULAMA' : 'DENEME'} raporu: "${FROM}" → "${TO}"`);
P();
P(`Kök: ${ROOT}`);
P(`Biçimler: ${FROM} → ${FORM.pascal} | ${f.stem} PDF → ${FORM.spaced} | ${FROM.toUpperCase().replace(/\s+/g, '')} → ${FORM.upper} | ${FROM_SLUG} → ${FORM.slug}`);
P(`Alan adı: ${NEW_DOMAIN ? `${OLD_DOMAIN} → ${NEW_DOMAIN}` : `--domain VERİLMEDİ: ${OLD_DOMAIN} adresleri, e-postalar ve uç noktalar DEĞİŞMEZ (aşağıda listeli)`}`);
const sumOcc = (m) => [...m.values()].reduce((a, b) => a + b.occ, 0);
P(`Taranan metin dosyası: ${files.length} | "${f.stem}" geçen satır: ${totalLines} | geçiş (eşleşme): ${totalOcc}`);
P(`  Değişecek: ${sumOcc(stats.change)} geçiş, ${plan.filter((p) => p.changes).length} dosya | Dokunulmayacak: ${sumOcc(stats.keep)} geçiş`);
P(`  Sınıflandırma kontrolü: ${sumOcc(stats.change) + sumOcc(stats.keep) === totalOcc ? 'tüm geçişler sınıflandı (sınıflanmamış: 0)' : 'UYARI: sınıflanmamış geçiş var'}`);
P();

function table(m, title) {
  P(`## ${title}`);
  P();
  P('| Kategori / neden | Dosya | Geçiş |');
  P('|---|---:|---:|');
  const sorted = [...m].sort((a, b) => b[1].occ - a[1].occ);
  for (const [k, b] of sorted) P(`| ${k.replace(/\|/g, '/')} | ${b.files.size} | ${b.occ} |`);
  P();
  for (const [k, b] of sorted) {
    P(`### ${k}`);
    P(`${b.files.size} dosya, ${b.occ} geçiş`);
    const fl = [...b.files].sort((a, c) => c[1] - a[1]);
    if (opt.files) for (const [fr, n] of fl) P(`- ${fr} (${n})`);
    else P('En çok: ' + fl.slice(0, 6).map(([fr, n]) => `${fr} (${n})`).join(', ') + (fl.length > 6 ? ' ...' : ''));
    for (const s of b.samples) P(`    ${s.r}:${s.n}: ${s.line}`);
    P();
  }
}
table(stats.change, 'DEĞİŞECEKLER');
table(stats.keep, 'DOKUNULMAYANLAR (nedenleriyle)');

P('## Taşıma yamaları (userData / kurulum klasörü: ayarlar ve lisans "kaybolmasın" diye)');
P();
P('Ürün adı (package.json productName) değişince Electron veri klasörü %APPDATA%\\<ad> de değişir. Eski adı mevcut taşıma mekanizmasına EKLEYEREK (kopyalar, üzerine yazmaz) çözülür:');
for (const pa of patches) P(`- ${pa.rel}: ${pa.what} -> ${pa.status}`);
P(`- Elle: tests/rename.js'e "${FROM} -> ${TO}" taşıma adımı (eski klasörden settings.json + license.json yeni klasöre geliyor mu) eklenmeli.`);
P();

P('## Dosya ve klasör adları');
P();
if (!nameHits.length) P('(yok)');
for (const n of nameHits) {
  const histf = HIST_FILE.some((re) => re.test(n.rel));
  const how = n.dir ? 'klasör: el ile' : n.bin ? 'İKİLİ: içeriği üreteç betiğiyle yeniden üretilir, araç dokunmaz' : histf ? 'tarihsel: dokunulmaz' : 'metin dosyası: --apply ile yeniden adlandırılır';
  const newName = n.rel.replace(NAME_RE(), (x) => formFor(x));
  P(`- ${n.rel}  ->  ${newName}  [${how}]`);
}
P();
if (unreadable.length) { P('## UTF-8 olmayan, atlanan dosyalar'); for (const u of unreadable) P('- ' + u); P(); }

if (opt.json) {
  console.log(JSON.stringify({ totalOcc, totalLines, change: [...stats.change].map(([k, b]) => [k, b.files.size, b.occ]), keep: [...stats.keep].map(([k, b]) => [k, b.files.size, b.occ]), patches, nameHits }));
  process.exit(0);
}

// ---------------------------------------------------------------- uygula
if (!opt.apply) {
  console.log(lines.join('\n'));
  console.log('DENEME modu: hiçbir dosya yazılmadı. Uygulamak için aynı komuta --apply ekleyin.');
  process.exit(0);
}

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const bdir = path.join(BACKUP_BASE, stamp);
if (fs.existsSync(bdir)) die('Yedek klasörü zaten var: ' + bdir);
const manifest = { tool: 'rename-brand', stamp, from: FROM, to: TO, domain: NEW_DOMAIN, entries: [], renames: [] };

for (const p of plan) {
  const dest = path.join(bdir, 'files', ...p.f.rel.split('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, p.buf);                                   // özgün hal (bayt bayt)
  manifest.entries.push({ rel: p.f.rel, before: sha(p.buf), after: sha(Buffer.from(p.after, 'utf8')) });
}
fs.writeFileSync(path.join(bdir, 'manifest.json'), JSON.stringify(manifest, null, 1)); // yazmadan ÖNCE de dursun
for (const p of plan) fs.writeFileSync(p.f.abs, Buffer.from(p.after, 'utf8'));

// yeniden adlandırma: yalnızca tarihsel olmayan METİN dosyaları (ikili/docx üreteçten yeniden üretilir)
const renamed = [];
for (const n of nameHits.filter((x) => !x.dir && !x.bin && !HIST_FILE.some((re) => re.test(x.rel)))) {
  const to = n.rel.replace(NAME_RE(), (x) => formFor(x));
  if (to === n.rel || fs.existsSync(path.join(ROOT, to))) continue;
  fs.renameSync(path.join(ROOT, n.rel), path.join(ROOT, to));
  manifest.renames.push({ from: n.rel, to });
  renamed.push(`${n.rel} -> ${to}`);
}
fs.writeFileSync(path.join(bdir, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(bdir, 'rapor.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`UYGULANDI: ${plan.length} dosya yazıldı, ${renamed.length} dosya yeniden adlandırıldı.`);
console.log(`Yedek: ${rel(bdir)}  |  Geri almak için: node tools/rename-brand.mjs --undo ${stamp}`);
