// Explorer'dan (dosyaya çift tıklayarak) arka arkaya PDF açma testi.
// Playwright kullanmaz; uygulamayı gerçek hayattaki gibi başlatır ve kendi günlüğünden doğrular.
// Çalıştır: node tests/secondinstance.js [dev|packaged|installed]
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { installedExe, EXE_NAME } = require('./harness');

function launcher(kind) {
  if (kind === 'installed') return { exe: installedExe(), pre: [], proc: 'HermoPDF' };
  if (kind === 'packaged') return { exe: path.join(ROOT, 'dist', 'win-unpacked', EXE_NAME), pre: [], proc: 'HermoPDF' };
  return { exe: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), pre: [ROOT], proc: 'electron' };
}

(async () => {
  const kind = process.argv[2] || 'dev';
  const { exe, pre, proc } = launcher(kind);
  if (!fs.existsSync(exe)) { console.log('exe bulunamadı:', exe); process.exit(1); }
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-ud-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-2nd-'));
  const names = ['test.pdf', 'a.pdf', 'b.pdf', 'scan.pdf', 'form.pdf'];
  const files = names.map((n) => {
    const dst = path.join(work, n);
    fs.copyFileSync(path.join(FIX, n), dst);
    return dst;
  });
  const env = { ...process.env, PDFUSTA_USERDATA: ud };
  delete env.PDFUSTA_TEST;
  const logFile = path.join(ud, 'pdfusta.log');
  const readLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');
  const opened = () => (readLog().match(/\[renderer\] açıldı:/g) || []).length;
  const start = (file) => { const c = spawn(exe, [...pre, file], { env, detached: true, stdio: 'ignore' }); c.unref(); };
  const kill = () => spawnSync('powershell', ['-NoProfile', '-Command', `Get-Process -Name '${proc}' -ErrorAction SilentlyContinue | Stop-Process -Force`]);

  const fail = [];
  console.log(`--- ${kind} sürümü`);
  start(files[0]);
  for (let i = 0; i < 60 && opened() < 1; i++) await sleep(500);
  const first = opened() >= 1;
  console.log(first ? '✔ ilk dosya açıldı' : '✘ ilk dosya açılmadı');
  if (!first) fail.push('ilk dosya');

  for (let k = 1; k < files.length; k++) {
    const before = opened();
    start(files[k]);
    let ok = false;
    for (let i = 0; i < 30; i++) { await sleep(500); if (opened() > before) { ok = true; break; } }
    console.log(ok ? `✔ ${names[k]} yeni sekmede açıldı` : `✘ ${names[k]} AÇILMADI`);
    if (!ok) fail.push(names[k]);
  }

  // eşzamanlı test için daha önce açılmamış iki kopya
  const dup1 = path.join(work, 'esz-1.pdf');
  const dup2 = path.join(work, 'esz-2.pdf');
  fs.copyFileSync(path.join(FIX, 'a.pdf'), dup1);
  fs.copyFileSync(path.join(FIX, 'b.pdf'), dup2);
  const before = opened();
  start(dup1);
  start(dup2);
  let both = false;
  for (let i = 0; i < 30; i++) { await sleep(500); if (opened() >= before + 2) { both = true; break; } }
  console.log(both ? '✔ aynı anda açılan iki dosya da işlendi' : '✘ eşzamanlı açma başarısız');
  if (!both) fail.push('eşzamanlı');

  const ps = spawnSync('powershell', ['-NoProfile', '-Command',
    `(Get-Process -Name '${proc}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Measure-Object).Count`], { encoding: 'utf8' });
  const windows = parseInt((ps.stdout || '0').trim(), 10);
  console.log(windows === 1 ? '✔ tek pencere açık' : `✘ pencere sayısı: ${windows}`);
  if (windows !== 1) fail.push('pencere sayısı');

  try {
    const beat1 = JSON.parse(fs.readFileSync(path.join(ud, 'primary.json'), 'utf8')).time;
    await sleep(4500);
    const beat2 = JSON.parse(fs.readFileSync(path.join(ud, 'primary.json'), 'utf8')).time;
    console.log(beat2 > beat1 ? '✔ uygulama yaşıyor (donma yok)' : '✘ uygulama yanıt vermiyor');
    if (!(beat2 > beat1)) fail.push('canlılık');
  } catch (e) {
    console.log('✘ canlılık dosyası okunamadı:', e.message);
    fail.push('canlılık');
  }

  kill();
  console.log(`\n${fail.length ? `BAŞARISIZ: ${fail.join(', ')}` : 'Tüm adımlar başarılı'} — açılan sekme sayısı: ${opened()}`);
  process.exitCode = fail.length ? 1 : 0;
})();
