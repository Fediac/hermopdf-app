'use strict';
// Word → PDF dönüştürme (ana süreç).
// 1) Microsoft Word kuruluysa Word'ün kendi "PDF olarak kaydet" motoru kullanılır (birebir görünüm).
//    Word görünmez açılır, makrolar kapalıdır, belge salt okunur açılır; takılırsa süre sınırıyla kapatılır.
//    Kullanıcının açık Word penceresine asla dokunulmaz: yalnızca bizim başlattığımız WINWORD kapatılır.
// 2) Word yoksa (ya da başarısız olursa) dahili motor: docx-preview belgeyi gizli bir pencerede çizer,
//    docx-print.js sayfalara böler, Chromium'un PDF yazıcısı (printToPDF) PDF'i üretir.
const { BrowserWindow } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');

const WORD_TIMEOUT = 120000;
const BUILTIN_TIMEOUT = 90000;
const BUILTIN_EXT = ['.docx', '.docm', '.dotx'];

// Dahili motorun sayfası belgeyi app://pu/__tmp/<kimlik> adresinden okur
const tempFiles = new Map();
function serveTemp(rel) {
  const m = /^__tmp\/([a-f0-9]{32})$/.exec(rel);
  if (!m) return null;
  return tempFiles.get(m[1]) || null;
}

let wordCache = null;
function hasWord() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  if (process.env.PDFUSTA_NO_WORD === '1') return Promise.resolve(false);
  if (wordCache !== null) return Promise.resolve(wordCache);
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCR\\Word.Application\\CurVer'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      wordCache = !err && /Word\.Application/i.test(String(out));
      resolve(wordCache);
    });
  });
}

// Not: COM yöntemlerine [Type]::Missing ve Quit(0) gibi değerler PowerShell'den geçmiyor (ByRef parametreler);
// yalnızca denenmiş biçimler kullanılıyor.
const PS_SCRIPT = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$src = $env:PU_IN; $dst = $env:PU_OUT
$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$word = $null; $doc = $null; $ours = $false; $code = 0
try {
  $word = New-Object -ComObject Word.Application
  $new = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
  if ($new.Count -gt 0) { $ours = $true; [Console]::Out.WriteLine('PID:' + ($new -join ',')); [Console]::Out.Flush() }
  if ($ours) { $word.Visible = $false }
  $prevAlerts = $word.DisplayAlerts; $prevSec = $word.AutomationSecurity
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument, PasswordTemplate
  # (sahte parola: parolalı belgede görünmez bir soru penceresinde takılmak yerine hata versin)
  $doc = $word.Documents.Open($src, $false, $true, $false, 'pu-parola-yok', 'pu-parola-yok')
  # OutputFileName, PDF, OpenAfterExport, baskı kalitesi, tüm belge, From, To, içerik, özellikler, IRM,
  # başlıklardan yer imi, etiketli PDF, eksik yazı tipini bitmap yap, PDF/A değil
  $doc.ExportAsFixedFormat($dst, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $false)
  [Console]::Out.WriteLine('OK')
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  $code = 2
} finally {
  if ($doc) { try { $doc.Close(0) } catch {} }
  if ($word -and $ours) { try { $word.Quit() } catch {} }
  elseif ($word) { try { $word.DisplayAlerts = $prevAlerts; $word.AutomationSecurity = $prevSec } catch {} }
  if ($word) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) } catch {} }
}
exit $code
`;

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}
function killPids(pids) {
  for (const pid of pids) {
    try { execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch (e) { /* yoksay */ }
  }
}
// PowerShell hata akışındaki CLIXML gürültüsünü ayıkla, son anlamlı satırı döndür
function cleanPsError(err) {
  const lines = String(err).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^#< CLIXML|^<\/?Objs/.test(l));
  return (lines.pop() || '').slice(0, 300);
}

// Microsoft Word ile: giriş dosyasının geçici kopyası açılır (kullanıcının dosyası kilitlenmez)
async function wordToPdf(inputPath, log) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pdfusta-word-'));
  const src = path.join(dir, `girdi${path.extname(inputPath).toLowerCase() || '.docx'}`);
  const dst = path.join(dir, 'cikti.pdf');
  try {
    await fsp.copyFile(inputPath, src);
    const t0 = Date.now();
    await new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')], {
        windowsHide: true, env: { ...process.env, PU_IN: src, PU_OUT: dst },
      });
      let out = '';
      let err = '';
      let pids = [];
      ps.stdout.on('data', (d) => {
        out += d;
        const m = /PID:([\d,]+)/.exec(out);
        if (m) pids = m[1].split(',').map(Number);
      });
      ps.stderr.on('data', (d) => { err += d; });
      const timer = setTimeout(() => {
        log && log('Word dönüştürme zaman aşımı, kapatılıyor');
        killPids(pids);
        ps.kill();
        reject(new Error(L('main.office.wordTimeout')));
      }, WORD_TIMEOUT);
      ps.on('error', (e) => { clearTimeout(timer); reject(e); });
      ps.on('close', (code) => {
        clearTimeout(timer);
        // Bizim başlattığımız Word düzgün kapanmadıysa arkada kalmasın
        setTimeout(() => killPids(pids.filter(isAlive)), 4000);
        if (code === 0 && /OK/.test(out)) resolve();
        else reject(new Error(cleanPsError(err) || `Word hata kodu ${code}`));
      });
    });
    const bytes = await fsp.readFile(dst);
    log && log(`Word → PDF (Word): ${path.basename(inputPath)} ${Date.now() - t0} ms, ${bytes.length} bayt`);
    return bytes;
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Dahili motor: yalnızca .docx ailesi
async function builtinToPdf(inputPath, log) {
  const data = await fsp.readFile(inputPath);
  if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error(L('main.office.notDocx'));
  const id = crypto.randomBytes(16).toString('hex');
  tempFiles.set(id, data);
  const w = new BrowserWindow({
    show: false, width: 1300, height: 1000,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  const t0 = Date.now();
  let timer;
  try {
    const work = (async () => {
      await w.loadURL('app://pu/src/renderer/docx-print.html');
      const info = await w.webContents.executeJavaScript(`window.renderDocx(${JSON.stringify(`app://pu/__tmp/${id}`)})`, true);
      const pdf = await w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' }, generateTaggedPDF: true });
      return { pdf, info };
    })();
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(L('main.office.builtinTimeout'))), BUILTIN_TIMEOUT); });
    const { pdf, info } = await Promise.race([work, timeout]);
    log && log(`Word → PDF (dahili): ${path.basename(inputPath)} ${Date.now() - t0} ms, ${info && info.pages} sayfa, ${pdf.length} bayt`);
    return { bytes: pdf, info };
  } finally {
    clearTimeout(timer);
    tempFiles.delete(id);
    if (!w.isDestroyed()) w.destroy();
  }
}

// engine: 'auto' | 'word' | 'builtin'
async function officeToPdf({ path: inputPath, name, bytes, engine = 'auto' }, log) {
  let tmpDir = null;
  try {
    if (!inputPath) {
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pdfusta-doc-'));
      inputPath = path.join(tmpDir, String(name || 'belge.docx').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_'));
      await fsp.writeFile(inputPath, Buffer.from(bytes));
    }
    const ext = path.extname(inputPath).toLowerCase();
    const st = await fsp.stat(inputPath);
    if (!st.size) throw new Error(L('main.office.empty'));
    const word = engine !== 'builtin' && await hasWord();
    if (word) {
      try {
        return { bytes: await wordToPdf(inputPath, log), engine: 'word' };
      } catch (e) {
        log && log(`Word ile dönüştürülemedi: ${e.message}`);
        if (engine === 'word' || !BUILTIN_EXT.includes(ext)) throw e;
        const r = await builtinToPdf(inputPath, log);
        return { bytes: r.bytes, engine: 'builtin', info: r.info, warning: L('main.office.wordFailed', { error: e.message }) };
      }
    }
    if (!BUILTIN_EXT.includes(ext)) {
      throw new Error(ext ? L('main.office.needWord', { ext }) : L('main.office.needWordThis'));
    }
    const r = await builtinToPdf(inputPath, log);
    return { bytes: r.bytes, engine: 'builtin', info: r.info };
  } finally {
    if (tmpDir) fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Kullanıcıya gösterilen hata metinleri arayüz dilinde (main.js setTranslator ile verir)
let L = (k) => k;
function setTranslator(fn) { if (typeof fn === 'function') L = fn; }

module.exports = { hasWord, officeToPdf, serveTemp, setTranslator };
