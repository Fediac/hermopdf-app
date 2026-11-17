// Dil dosyalarını ve çeviri anahtarlarını denetler (Electron gerekmez):
//   node tools/i18n-check.js            → locales/*.json: geçerli JSON, en ile aynı anahtarlar, yer tutucular tutarlı,
//                                          kaynak koddaki t('...') anahtarlarının hepsi en.json'da var
//   node tools/i18n-check.js --syntax a.js b.js → yalnızca JS sözdizimi denetimi (esbuild ile)
// Çıkış kodu: sorun varsa 1.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOC = path.join(ROOT, 'src', 'renderer', 'locales');
const args = process.argv.slice(2);

if (args[0] === '--syntax') {
  const esbuild = require('esbuild');
  let bad = 0;
  for (const f of args.slice(1)) {
    try {
      esbuild.transformSync(fs.readFileSync(f, 'utf8'), { loader: 'js', format: /\.mjs$|renderer/.test(f) ? 'esm' : 'cjs', sourcefile: f, logLevel: 'silent' });
      console.log(`OK  ${f}`);
    } catch (e) {
      bad++;
      console.log(`ERR ${f}\n${(e.errors || []).map((x) => `  ${x.location ? `${x.location.line}:${x.location.column} ` : ''}${x.text}`).join('\n') || e.message}`);
    }
  }
  process.exit(bad ? 1 : 0);
}

const { CODES, FALLBACK } = require('../src/main/i18n');
const problems = [];
const warn = [];
const dicts = {};
for (const c of CODES) {
  const f = path.join(LOC, `${c}.json`);
  if (!fs.existsSync(f)) { problems.push(`${c}.json yok`); continue; }
  try { dicts[c] = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { problems.push(`${c}.json bozuk JSON: ${e.message}`); }
}
const base = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');
// Değerinde kendi dilinde düz (yer tutucu olmayan) {belirteç} gösteren anahtarlar: yer tutucu denetimi dışı
const LITERAL_TOKENS = new Set(['insert.hfInfo']);
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const en = dicts[FALLBACK] || {};
const enBases = new Set(Object.keys(en).map(base));
for (const c of CODES) {
  const d = dicts[c];
  if (!d) continue;
  const bases = new Set(Object.keys(d).map(base));
  const missing = [...enBases].filter((k) => !bases.has(k));
  const extra = [...bases].filter((k) => !enBases.has(k));
  if (missing.length) problems.push(`${c}: ${missing.length} eksik anahtar (ör. ${missing.slice(0, 5).join(', ')})`);
  if (extra.length) warn.push(`${c}: ${extra.length} fazladan anahtar (ör. ${extra.slice(0, 5).join(', ')})`);
  for (const [k, v] of Object.entries(d)) {
    if (typeof v !== 'string' || !v.trim()) { problems.push(`${c}: "${k}" boş`); continue; }
    const ref = en[k] ?? en[`${base(k)}_other`] ?? en[base(k)];
    if (ref != null && !LITERAL_TOKENS.has(k) && ph(ref) && ph(v) !== ph(ref)) {
      // Çoğul tekil biçimi sayıyı yazmayabilir ({count} düşebilir)
      const a = ph(ref).split(',').filter((x) => x !== 'count').join(',');
      const b = ph(v).split(',').filter((x) => x !== 'count').join(',');
      if (a !== b) problems.push(`${c}: "${k}" yer tutucular uyuşmuyor (${ph(v)} ≠ en: ${ph(ref)})`);
    }
  }
}
// Kaynakta kullanılan anahtarlar en.json'da olmalı
const used = new Set();
const walk = (d) => {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, n.name);
    if (n.isDirectory()) { if (n.name !== 'locales') walk(f); continue; }
    if (!/\.(js|html)$/.test(n.name)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:t|L)\(\s*'([a-zA-Z0-9_.-]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="([a-zA-Z0-9_.-]+)"/g)) used.add(m[1]);
  }
};
walk(path.join(ROOT, 'src'));
const notInEn = [...used].filter((k) => k.includes('.') && !enBases.has(k));
if (notInEn.length) problems.push(`kodda kullanılıp en.json'da olmayan ${notInEn.length} anahtar: ${notInEn.slice(0, 15).join(', ')}`);

for (const w of warn) console.log(`uyarı: ${w}`);
for (const p of problems) console.log(`SORUN: ${p}`);
console.log(problems.length ? `\n${problems.length} sorun` : `Dil dosyaları tamam (${CODES.length} dil, ${enBases.size} anahtar, kodda ${used.size} anahtar kullanılıyor)`);
process.exit(problems.length ? 1 : 0);
