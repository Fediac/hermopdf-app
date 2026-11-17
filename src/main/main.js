'use strict';
const { app, BrowserWindow, protocol, ipcMain, Menu, shell, dialog, nativeTheme, clipboard, ClipboardItem } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const office = require('./office');
const { createBridge } = require('./claude-bridge');
const { licensingConfig } = require('./keys');
const { endpoints, isSiteUrl } = require('./endpoints');
const { createLicenseStore } = require('./license');
const { createUpdater } = require('./updates');
const i18n = require('./i18n');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const FONT_DIR = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
const TITLEBAR_H = 40;

// Testler gerçek ayarlara dokunmasın diye ayrı klasör verilebilir.
if (process.env.PDFUSTA_USERDATA) app.setPath('userData', process.env.PDFUSTA_USERDATA);

// Yalnızca testte (PDFUSTA_TEST=1 + PU_TEST_OFFSCREEN=1): pencere ekran dışında, odak almadan açılır;
// odak/öne getirme çağrılmaz; sistem pencereleri (dosya seçme, ileti kutusu, yazdırma), tarayıcı ve
// dosya açma (shell) hiçbir şey göstermez. Testler bunları kendi taklitleriyle yine değiştirebilir.
const TEST_OFFSCREEN = process.env.PDFUSTA_TEST === '1' && process.env.PU_TEST_OFFSCREEN === '1';
if (TEST_OFFSCREEN) {
  const quiet = (name, ret) => (...a) => {
    try { log(`test (ekran dışı): ${name} gösterilmedi`, typeof a[a.length - 1] === 'string' ? a[a.length - 1] : ''); } catch (e) { /* yoksay */ }
    return ret();
  };
  dialog.showOpenDialog = quiet('showOpenDialog', async () => ({ canceled: true, filePaths: [] }));
  dialog.showSaveDialog = quiet('showSaveDialog', async () => ({ canceled: true, filePath: '' }));
  dialog.showMessageBox = quiet('showMessageBox', async () => ({ response: 0, checkboxChecked: false }));
  dialog.showOpenDialogSync = quiet('showOpenDialogSync', () => undefined);
  dialog.showSaveDialogSync = quiet('showSaveDialogSync', () => undefined);
  dialog.showMessageBoxSync = quiet('showMessageBoxSync', () => 0);
  dialog.showErrorBox = quiet('showErrorBox', () => undefined);
  shell.openExternal = quiet('openExternal', async () => undefined);
  shell.openPath = quiet('openPath', async () => '');
  shell.showItemInFolder = quiet('showItemInFolder', () => undefined);
}

// ---------------- eski ad ("Ultronix PDF" / "PDF Usta") verisini taşıma ----------------
// Ad her değiştiğinde Electron'un veri klasörü de değişti:
//   %APPDATA%\PDF Usta → %APPDATA%\Ultronix PDF → %APPDATA%\UltronPDF
// İlk açılışta uygulamanın kendi verisini KOPYALARIZ: eski klasöre dokunulmaz, yeni klasördeki hiçbir dosyanın üzerine yazılmaz.
// Kaynak: settings.json'ı olan en yeni eski klasör (önce "Ultronix PDF", yoksa "PDF Usta").
// Taşınanlar: settings.json (tema, son açılanlar, imzalar, pencere, son klasör...), Pro lisansı (license.json),
// iptal listesi (license-revocations.json) ve güncelleme bildirimi durumu (update-state.json).
// Arayüz localStorage/IndexedDB kullanmıyor. Chromium önbellekleri, kilit/günlük dosyaları, primary.json, open-queue,
// claude-bridge.json (her açılışta yeniden yazılır) ve eski klasörün kendi migrated-from.json'ı taşınmaz.
// Testte: PDFUSTA_USERDATA ile birlikte PDFUSTA_LEGACY_USERDATA verilirse aynı taşıma test klasörüne yapılır;
// birden çok eski klasör path.delimiter (;) ile, öncelik sırasıyla verilebilir.
const MIGRATE_ITEMS = ['license.json', 'license-revocations.json', 'update-state.json', 'settings.json']; // settings.json en sonda kalmalı: varlığı "taşıma bitti" demek
const LEGACY_DIR_NAMES = ['UltronPDF', 'Ultronix PDF', 'PDF Usta']; // yeniden eskiye
const MIGRATE_MARKER = 'migrated-from.json';
const MIGRATE_RETRY = 'migrate-retry.json'; // taşıma yarım kaldı: sonraki açılışta yeniden dene
migrateLegacyUserData();

function copyNoOverwrite(src, dst) {
  if (fs.existsSync(dst)) return false;
  if (fs.statSync(src).isDirectory()) {
    fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
    return true;
  }
  // Yarım kopya kalmasın diye önce geçici dosyaya, sonra yerine.
  const tmp = `${dst}.${process.pid}.migrating`;
  fs.copyFileSync(src, tmp);
  if (fs.existsSync(dst)) { try { fs.unlinkSync(tmp); } catch (e) { /* yoksay */ } return false; }
  fs.renameSync(tmp, dst);
  return true;
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Önceki taşıma denemesi başarısız olduysa uygulama bu arada kendi settings.json'ını yazmıştır:
// üzerine yazmadan eski ayarlarla tamamla (yeni oturumdaki değerler önde, son açılanlar ve imzalar birleşir).
function mergeLegacySettings(src, dst) {
  const old = JSON.parse(fs.readFileSync(src, 'utf8'));
  const cur = JSON.parse(fs.readFileSync(dst, 'utf8'));
  if (!old || typeof old !== 'object' || !cur || typeof cur !== 'object') return false;
  const merged = { ...old, ...cur };
  const recent = [...(Array.isArray(cur.recent) ? cur.recent : []), ...(Array.isArray(old.recent) ? old.recent : [])];
  merged.recent = recent.filter((r, k) => typeof r === 'string' && recent.findIndex((x) => typeof x === 'string' && x.toLowerCase() === r.toLowerCase()) === k).slice(0, 15);
  const sigs = [...(Array.isArray(cur.signatures) ? cur.signatures : []), ...(Array.isArray(old.signatures) ? old.signatures : [])];
  merged.signatures = sigs.filter((s, k) => s && sigs.findIndex((x) => x && x.id === s.id) === k);
  const tmp = `${dst}.${process.pid}.migrating`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 1));
  fs.renameSync(tmp, dst);
  return true;
}

function migrateLegacyUserData() {
  try {
    if (process.env.PDFUSTA_USERDATA && !process.env.PDFUSTA_LEGACY_USERDATA) return;
    const target = app.getPath('userData');
    const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    const candidates = process.env.PDFUSTA_LEGACY_USERDATA
      ? process.env.PDFUSTA_LEGACY_USERDATA.split(path.delimiter).filter(Boolean)
      : LEGACY_DIR_NAMES.map((n) => path.join(app.getPath('appData'), n));
    if (fs.existsSync(path.join(target, MIGRATE_MARKER))) return;
    const retry = fs.existsSync(path.join(target, MIGRATE_RETRY));
    if (fs.existsSync(path.join(target, 'settings.json')) && !retry) return;
    const legacy = candidates.find((d) => !same(d, target) && fs.existsSync(path.join(d, 'settings.json')));
    if (!legacy) return;
    const label = path.basename(path.resolve(legacy));
    fs.mkdirSync(target, { recursive: true });
    const copied = [];
    let failed = false;
    for (const item of MIGRATE_ITEMS) {
      const src = path.join(legacy, item);
      const dst = path.join(target, item);
      // Antivirüs taraması / kısa süreli kilit: birkaç kez dene
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (!fs.existsSync(src)) break;
          if (retry && item === 'settings.json' && fs.existsSync(dst)) { if (mergeLegacySettings(src, dst)) copied.push(item); } else if (copyNoOverwrite(src, dst)) copied.push(item);
          break;
        } catch (e) {
          log(`taşıma: kopyalanamadı (deneme ${attempt}/3)`, item, e.code || e.message);
          if (attempt === 3) failed = true; else sleepSync(300);
        }
      }
    }
    // settings.json gelmediyse işaret yazılmaz: bir sonraki açılışta yeniden denenir
    if (failed || !fs.existsSync(path.join(target, 'settings.json'))) {
      fs.writeFileSync(path.join(target, MIGRATE_RETRY), JSON.stringify({ from: legacy, at: new Date().toISOString() }, null, 1));
      log(`eski "${label}" verisi taşınamadı; sonraki açılışta yeniden denenecek:`, legacy);
      return;
    }
    fs.writeFileSync(path.join(target, MIGRATE_MARKER), JSON.stringify({ from: legacy, at: new Date().toISOString(), items: copied }, null, 1));
    try { fs.rmSync(path.join(target, MIGRATE_RETRY), { force: true }); } catch (e) { /* yoksay */ }
    log(`eski "${label}" verisi taşındı:`, legacy, '→', target, '|', copied.join(', ') || '(hiçbir şey)');
  } catch (e) {
    try { log('eski veri taşınamadı:', e.message); } catch (x) { /* yoksay */ }
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream', '.icc': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

// ---------------- ayarlar ----------------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settingsCache = null;
function getSettings() {
  if (!settingsCache) {
    try { settingsCache = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { settingsCache = {}; }
  }
  return settingsCache;
}
let saveTimer = null;
function setSettings(patch) {
  settingsCache = { ...getSettings(), ...patch };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 250);
  return settingsCache;
}
function flushSettings() {
  clearTimeout(saveTimer);
  if (!settingsCache) return;
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile() + '.tmp', JSON.stringify(settingsCache, null, 1));
    fs.renameSync(settingsFile() + '.tmp', settingsFile());
  } catch (e) { console.error('settings', e); }
}

// ---------------- arayüz dili ----------------
// Sıra: PDFUSTA_LANG (yalnız testte) > kayıtlı seçim (settings.lang) > ilk açılışta sistem dili (desteklenmiyorsa İngilizce).
// Testler Türkçe metinlerle çalıştığı için testte varsayılan Türkçedir.
// Dil desteğinden önceki sürümü kullananlar (ayar dosyası dolu, "lang" yok) Türkçe arayüzde kalır; seçim bir kez kaydedilir.
let uiLang = null;
let translate = i18n.createTranslator('tr');
function resolveLang() {
  const s = getSettings();
  const env = process.env.PDFUSTA_TEST ? process.env.PDFUSTA_LANG : null;
  if (env && i18n.isSupported(env)) return env;
  if (i18n.isSupported(s.lang)) return s.lang;
  if (process.env.PDFUSTA_TEST) return 'tr';
  const existingUser = Object.keys(s).length > 0;
  let sys = [];
  try { sys = [...(app.getPreferredSystemLanguages?.() || []), app.getLocale()]; } catch (e) { sys = [app.getLocale()]; }
  const code = existingUser ? 'tr' : i18n.matchLocale(sys);
  setSettings({ lang: code });
  log('arayüz dili belirlendi:', code, existingUser ? '(önceki sürüm kullanıcısı)' : `(sistem: ${sys.join(', ')})`);
  return code;
}
function setUiLang(code) {
  uiLang = i18n.isSupported(code) ? code : i18n.FALLBACK;
  translate = i18n.createTranslator(uiLang);
}
const L = (key, params) => translate(key, params);

// ---------------- yazı tipleri (Windows) ----------------
const FONT_FAMILIES = [
  { family: 'Arial', files: ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'] },
  { family: 'Times New Roman', files: ['times.ttf', 'timesbd.ttf', 'timesi.ttf', 'timesbi.ttf'] },
  { family: 'Calibri', files: ['calibri.ttf', 'calibrib.ttf', 'calibrii.ttf', 'calibriz.ttf'] },
  { family: 'Segoe UI', files: ['segoeui.ttf', 'segoeuib.ttf', 'segoeuii.ttf', 'segoeuiz.ttf'] },
  { family: 'Verdana', files: ['verdana.ttf', 'verdanab.ttf', 'verdanai.ttf', 'verdanaz.ttf'] },
  { family: 'Georgia', files: ['georgia.ttf', 'georgiab.ttf', 'georgiai.ttf', 'georgiaz.ttf'] },
  { family: 'Tahoma', files: ['tahoma.ttf', 'tahomabd.ttf', null, null] },
  { family: 'Courier New', files: ['cour.ttf', 'courbd.ttf', 'couri.ttf', 'courbi.ttf'] },
  { family: 'Consolas', files: ['consola.ttf', 'consolab.ttf', 'consolai.ttf', 'consolaz.ttf'] },
  { family: 'Comic Sans MS', files: ['comic.ttf', 'comicbd.ttf', 'comici.ttf', 'comicz.ttf'] },
  { family: 'Segoe Script', files: ['segoesc.ttf', 'segoescb.ttf', null, null], hand: true },
  { family: 'Segoe Print', files: ['segoepr.ttf', 'segoeprb.ttf', null, null], hand: true },
  { family: 'Ink Free', files: ['Inkfree.ttf', null, null, null], hand: true },
  { family: 'Lucida Handwriting', files: ['LHANDW.TTF', null, null, null], hand: true },
  { family: 'Gabriola', files: ['Gabriola.ttf', null, null, null], hand: true },
];
function listFonts() {
  const out = [];
  for (const f of FONT_FAMILIES) {
    const files = f.files.map((n) => (n && fs.existsSync(path.join(FONT_DIR, n)) ? n : null));
    if (files[0]) out.push({ family: f.family, files, hand: !!f.hand });
  }
  return out;
}

// ---------------- protokol ----------------
function registerProtocol() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const tmp = office.serveTemp(rel);
    if (tmp) return new Response(tmp, { headers: { 'content-type': 'application/octet-stream' } });
    let file;
    let root = APP_ROOT;
    const tess = /^tessdata\/([a-z_]+)\.traineddata\.gz$/.exec(rel);
    const font = /^sysfonts\/([\w.-]+\.(ttf|otf))$/i.exec(rel);
    if (tess) file = path.join(APP_ROOT, 'node_modules', '@tesseract.js-data', tess[1], '4.0.0_best_int', `${tess[1]}.traineddata.gz`);
    else if (font) { root = FONT_DIR; file = path.join(FONT_DIR, font[1]); }
    else file = path.join(APP_ROOT, rel);
    if (!path.resolve(file).startsWith(root)) return new Response('Forbidden', { status: 403 });
    try {
      const buf = await fsp.readFile(file);
      return new Response(buf, { headers: { 'content-type': mimeOf(file) } });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------- dosya açma kuyruğu ----------------
let win = null;
let rendererReady = false;
let bridge = null; // Claude bağlantısı (claude-bridge.js)
const pendingOpen = [];

function pdfArgs(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && /\.pdf$/i.test(a) && fs.existsSync(a)).map((a) => path.resolve(a));
}
// ---------------- açılış posta kutusu ----------------
// Windows'un "tek örnek" devri bazen çalışmıyor (ikinci kopya, açık uygulamayı sonlandırabiliyor).
// Bu yüzden ikinci kopya, dosya yolunu bu klasöre bırakır; açık olan uygulama klasörü izleyip açar.
function queueDir() {
  return path.join(app.getPath('userData'), 'open-queue');
}
function mailboxPut(files) {
  if (!files.length) return false;
  try {
    const dir = queueDir();
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    fs.writeFileSync(path.join(dir, name), JSON.stringify(files), 'utf8');
    return true;
  } catch (e) {
    log('posta kutusuna yazılamadı:', e.message);
    return false;
  }
}
function mailboxTake() {
  const out = [];
  try {
    const dir = queueDir();
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (Array.isArray(data)) out.push(...data.filter((x) => typeof x === 'string' && (x === '__focus__' || fs.existsSync(x))));
      } catch (e) { /* bozuk dosya */ }
      try { fs.unlinkSync(full); } catch (e) { /* yoksay */ }
    }
  } catch (e) {
    log('posta kutusu okunamadı:', e.message);
  }
  return out;
}
// Hangi kopyanın "asıl" uygulama olduğunu kendimiz takip ediyoruz.
// (Windows'un kendi tek-örnek devri bazen açık uygulamayı sonlandırıyordu; ona güvenmiyoruz.)
function primaryFile() {
  return path.join(app.getPath('userData'), 'primary.json');
}
function readPrimary() {
  try { return JSON.parse(fs.readFileSync(primaryFile(), 'utf8')); } catch (e) { return null; }
}
function pidAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
// Dosyayı yalnızca yoksa oluşturarak kilit alır: aynı anda açılan iki kopyada bile tek kazanan olur.
function tryClaimPrimary() {
  const f = primaryFile();
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); } catch (e) { /* yoksay */ }
  const isFresh = (cur) => cur && Number.isFinite(cur.time) && Date.now() - cur.time < 12000 && pidAlive(cur.pid);
  const readAt = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
  const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const fd = fs.openSync(f, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now(), exe: process.execPath }));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { nap(50); continue; }
      if (e.code !== 'EEXIST') return true; // beklenmeyen hata: yine de çalış
      const cur = readPrimary();
      if (isFresh(cur)) return false; // gerçekten açık ve yanıt veren bir kopya var
      if (!cur) {
        // Başka bir kopya kaydı yeni oluşturmuş, henüz yazmamış olabilir: bekle
        let young = false;
        try { young = Date.now() - fs.statSync(f).mtimeMs < 2000; } catch (x) { /* yoksay */ }
        if (young) { nap(50); continue; }
      }
      // Eski/ölü kayıt: körü körüne silme (arada bir başkasının yeni kaydını silebilir); taşı ve kontrol et
      const grave = `${f}.${process.pid}.stale`;
      try { fs.renameSync(f, grave); } catch (x) { nap(20); continue; }
      if (isFresh(readAt(grave))) {
        try { fs.renameSync(grave, f); } catch (x) { /* yoksay */ }
        return false;
      }
      try { fs.unlinkSync(grave); } catch (x) { /* yoksay */ }
    }
  }
  return !isFresh(readPrimary());
}
let heartbeatTimer = null;
function startHeartbeat() {
  const write = () => {
    try {
      fs.writeFileSync(primaryFile(), JSON.stringify({ pid: process.pid, time: Date.now(), exe: process.execPath }));
    } catch (e) { /* yoksay */ }
  };
  write();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(write, 3000);
  const cleanup = () => {
    clearInterval(heartbeatTimer);
    try {
      const cur = readPrimary();
      if (cur && cur.pid === process.pid) fs.unlinkSync(primaryFile());
    } catch (e) { /* yoksay */ }
  };
  app.on('will-quit', cleanup);
  process.on('exit', cleanup);
}

let mailboxTimer = null;
function watchMailbox() {
  const dir = queueDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* yoksay */ }
  const drain = () => {
    const items = mailboxTake();
    if (!items.length) return;
    log('posta kutusundan alındı:', items.join(' | '));
    const files = items.filter((f) => f !== '__focus__');
    if (files.length) queueOpen(files);
    focusWindow();
  };
  try {
    fs.watch(dir, { persistent: false }, () => setTimeout(drain, 60));
  } catch (e) {
    log('posta kutusu izlenemedi:', e.message);
  }
  // izleme çalışmazsa diye yedek yoklama
  clearInterval(mailboxTimer);
  mailboxTimer = setInterval(drain, 1500);
  drain();
}

function queueOpen(files) {
  if (!files.length) return;
  log('queueOpen', files.length, 'dosya; rendererReady =', rendererReady, '; win =', !!win);
  if (win && !win.isDestroyed() && rendererReady && !win.webContents.isCrashed()) {
    try {
      win.webContents.send('open-files', files);
      log('open-files gönderildi:', files.join(' | '));
    } catch (e) {
      log('open-files gönderilemedi:', e.message);
      pendingOpen.push(...files);
    }
  } else pendingOpen.push(...files);
}

// ---------------- pencere ----------------
const THEMES = {
  light: { bg: '#F2E4C8', overlay: { color: '#E5D2A6', symbolColor: '#181923' } },
  dark: { bg: '#15161d', overlay: { color: '#1c1d26', symbolColor: '#efe7d4' } },
};

function createWindow() {
  const s = getSettings();
  const b = s.bounds || {};
  // Kayıtlı seçim yoksa (ilk açılış) sistem temasını izle
  const theme = s.theme === 'dark' || s.theme === 'light' ? s.theme : (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  win = new BrowserWindow({
    width: b.width || 1380,
    height: b.height || 900,
    x: TEST_OFFSCREEN ? -10000 : Number.isFinite(b.x) ? b.x : undefined,
    y: TEST_OFFSCREEN ? -10000 : Number.isFinite(b.y) ? b.y : undefined,
    minWidth: 820,
    minHeight: 560,
    show: false,
    ...(TEST_OFFSCREEN ? { skipTaskbar: true } : {}),
    title: 'HermoPDF',
    icon: path.join(APP_ROOT, 'build', 'icon.ico'),
    backgroundColor: THEMES[theme].bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...THEMES[theme].overlay, height: TITLEBAR_H },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  if (s.maximized && !process.env.PDFUSTA_TEST) win.maximize();
  win.loadURL('app://pu/src/renderer/index.html');
  win.once('ready-to-show', () => { if (TEST_OFFSCREEN) win.showInactive(); else win.show(); });

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    if (!win.isMaximized() && !win.isMinimized()) setSettings({ bounds: win.getBounds() });
    setSettings({ maximized: win.isMaximized() });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  let closeConfirmed = false;
  win.on('close', (e) => {
    if (closeConfirmed || !rendererReady) return;
    e.preventDefault();
    win.webContents.send('close-request');
  });
  ipcMain.removeHandler('app:confirmClose');
  ipcMain.handle('app:confirmClose', () => {
    closeConfirmed = true;
    flushSettings();
    setImmediate(() => win && !win.isDestroyed() && win.close());
  });
  win.on('closed', () => { win = null; rendererReady = false; });
  // Arayüz yeniden yüklenirse Claude'un bekleyen istekleri yanıtsız kalmasın
  win.webContents.on('did-navigate', () => bridge?.failPending('not_ready', 'HermoPDF window reloaded; try again.'));
  // Arayüz süreci çökerse pencere kapanamaz hale gelmesin, gelen dosyalar kaybolmasın: yeniden yükle (dakikada en fazla 3)
  const crashes = [];
  win.webContents.on('render-process-gone', (e, d) => {
    log('renderer gitti:', d.reason, d.exitCode);
    rendererReady = false;
    bridge?.failPending('not_ready', 'HermoPDF window crashed; try again.');
    if (d.reason === 'clean-exit' || !win || win.isDestroyed()) return;
    const now = Date.now();
    while (crashes.length && now - crashes[0] > 60000) crashes.shift();
    crashes.push(now);
    if (crashes.length <= 3) win.webContents.reload();
  });

  // Dış bağlantılar sistem tarayıcısında açılsın
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && LICENSING.dev) win.webContents.toggleDevTools();
  });
}

// ---------------- yazdırma ----------------
async function printImages(pages, jobName) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pdfusta-print-'));
  const parts = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const f = path.join(dir, `p${i}.jpg`);
    await fsp.writeFile(f, Buffer.from(p.bytes));
    const land = p.wPt > p.hPt;
    parts.push(`<section class="${land ? 'l' : 'p'}"><img src="${pathToUrl(f)}"></section>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(jobName || 'HermoPDF')}</title><style>
    @page { margin: 0; }
    html,body{margin:0;padding:0;background:#fff}
    section{page-break-after:always;break-after:page;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden}
    section:last-child{page-break-after:auto;break-after:auto}
    img{max-width:100%;max-height:100%;object-fit:contain}
  </style></head><body>${parts.join('')}</body></html>`;
  const htmlFile = path.join(dir, 'print.html');
  await fsp.writeFile(htmlFile, html, 'utf8');
  if (TEST_OFFSCREEN) {
    // Testte yazdırma penceresi açılmaz
    log('test (ekran dışı): yazdırma penceresi gösterilmedi', pages.length, 'sayfa');
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    return { success: false, reason: 'test-offscreen' };
  }
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await pw.loadFile(htmlFile);
    const ok = await new Promise((resolve) => {
      pw.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, (success, reason) => resolve({ success, reason }));
    });
    return ok;
  } finally {
    pw.destroy();
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
function pathToUrl(f) {
  return 'file:///' + f.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------- IPC ----------------
function addRecent(file) {
  const s = getSettings();
  const recent = (s.recent || []).filter((r) => r.toLowerCase() !== file.toLowerCase());
  recent.unshift(file);
  setSettings({ recent: recent.slice(0, 15) });
}

// Son açılanlara burada eklenmez: birleştirme/toplu işlem girdileri ve açılamayan dosyalar listeye düşmesin.
// Arayüz, belge gerçekten açılınca 'recent:add' çağırır.
async function readPdf(file) {
  const buf = await fsp.readFile(file);
  const st = await fsp.stat(file);
  return { path: file, name: path.basename(file), bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), size: st.size };
}

// Yeni bir dosya yazar, var olan hiçbir dosyanın üzerine YAZMAZ: ad doluysa "ad (2).pdf", "ad (3).pdf"…
// Önce aynı klasörde geçici dosyaya yazılır, sonra tek adımda (sabit bağlantı / COPYFILE_EXCL) adına taşınır;
// böylece yarıda kalan bir yazma hedef adda yarım dosya bırakmaz. Döndürür: yazılan dosyanın yolu.
async function writeNewFile(folder, name, bytes) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error(L('main.err.badFolder'));
  await fsp.mkdir(folder, { recursive: true });
  let clean = String(name || 'belge.pdf').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 180);
  if (!/\.pdf$/i.test(clean)) clean += '.pdf';
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length) || 'belge';
  const tmp = path.join(folder, `${stem.slice(0, 40)}.${process.pid}.${Date.now()}.hermopdf-tmp`);
  await fsp.writeFile(tmp, Buffer.from(bytes), { flag: 'wx' });
  try {
    for (let i = 1; i < 10000; i++) {
      const file = path.join(folder, i === 1 ? `${stem}${ext}` : `${stem} (${i})${ext}`);
      try {
        await fsp.link(tmp, file);
        return file;
      } catch (e) {
        if (e.code === 'EEXIST') continue;
        // Sabit bağlantı desteklenmiyorsa (FAT, bazı ağ sürücüleri): yine üzerine yazmadan kopyala
        try {
          await fsp.copyFile(tmp, file, fs.constants.COPYFILE_EXCL);
          return file;
        } catch (e2) {
          if (e2.code === 'EEXIST') continue;
          throw e2;
        }
      }
    }
    throw new Error(L('main.err.noName'));
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

async function atomicWrite(file, bytes) {
  // Eşzamanlı kayıtlar aynı geçici dosyayı paylaşmasın
  const tmp = `${file}.${process.pid}.${Date.now()}.pdfusta-tmp`;
  try {
    await fsp.writeFile(tmp, Buffer.from(bytes));
    try {
      await fsp.rename(tmp, file);
    } catch (e) {
      // Hedef başka bir program tarafından kilitliyse doğrudan yazmayı dene
      try {
        await fsp.copyFile(tmp, file);
      } catch (e2) {
        const code = e2.code || e.code;
        const err = new Error(['EPERM', 'EACCES', 'EBUSY'].includes(code)
          ? L('main.err.locked')
          : e2.message);
        err.code = code;
        throw err;
      }
    }
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

// Aynı anda yalnızca tek bir sistem penceresi (aç/kaydet/klasör) açılabilir.
// İkincisi açılırsa pencerenin arkasında kalıp uygulamayı kilitli gösterebiliyor.
let dialogOpen = false;
let currentTheme = null; // arayüzün o an gösterdiği tema ('dark' | 'light'); theme:set ile gelir
// Windows 11 koyu temada dosya pencereleri açılırken beyaz yanıp sönme: pencere temasını ve zemin rengini
// sistem penceresinden hemen önce arayüzle eşitle. Kayıtlı seçim yoksa 'system' kalır (arayüz de sistemi izliyor);
// arayüz sistemden farklı bir tema gösteriyorsa (kayıtlı seçim) Windows'a o tema bildirilir. Pencere her zaman
// ana pencereye bağlı (parent) açılır. Kalan kısa parlama Windows'un kendi dosya penceresinden gelir.
function syncThemeForDialog() {
  try {
    const st = getSettings().theme;
    const want = st === 'dark' || st === 'light' ? st : 'system';
    if (nativeTheme.themeSource !== want) nativeTheme.themeSource = want;
    const eff = currentTheme || (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    if (win && !win.isDestroyed()) win.setBackgroundColor(THEMES[eff].bg);
  } catch (e) { /* yoksay */ }
}
async function systemDialog(fn) {
  if (dialogOpen) {
    log('Zaten açık bir sistem penceresi var, ikincisi engellendi');
    focusWindow();
    return { canceled: true, filePaths: [] };
  }
  dialogOpen = true;
  syncThemeForDialog();
  focusWindow();
  try {
    return await fn();
  } finally {
    dialogOpen = false;
    focusWindow();
  }
}
function focusWindow() {
  if (!win || win.isDestroyed() || TEST_OFFSCREEN) return;
  try {
    if (win.isMinimized()) win.restore();
    win.focus();
  } catch (e) { /* yoksay */ }
}

// Sorun giderme günlüğü (userData/pdfusta.log, son 200 KB)
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  try {
    const f = path.join(app.getPath('userData'), 'pdfusta.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 200 * 1024) {
      const tail = fs.readFileSync(f, 'utf8').slice(-100 * 1024);
      fs.writeFileSync(f, tail);
    }
    fs.appendFileSync(f, line);
  } catch (e) { /* yoksay */ }
}

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...args) => fn(...args));
  h('app:log', (msg) => log('[renderer]', String(msg).slice(0, 2000)));
  h('app:openLog', () => shell.openPath(path.join(app.getPath('userData'), 'pdfusta.log')));

  h('app:ready', () => {
    rendererReady = true;
    const files = pendingOpen.splice(0);
    return { files, settings: getSettings(), fonts: listFonts(), version: app.getVersion(), platform: process.platform, test: !!process.env.PDFUSTA_TEST, tour: !!process.env.PDFUSTA_TEST && process.env.PDFUSTA_TOUR === '1' };
  });
  h('settings:set', (patch) => setSettings(patch));
  h('i18n:boot', () => ({ lang: uiLang || 'en', langs: i18n.LANGS }));
  h('i18n:set', (code) => {
    if (!i18n.isSupported(code)) return uiLang;
    setUiLang(code);
    setSettings({ lang: code });
    return uiLang;
  });
  h('theme:set', (theme, persist = true) => {
    // 'system': kayıtlı seçimi kaldır, yeniden sistem temasını izle (arayüz ardından persist=false ile asıl temayı bildirir)
    if (theme === 'system') { nativeTheme.themeSource = 'system'; setSettings({ theme: null }); return; }
    const t = THEMES[theme] || THEMES.light;
    currentTheme = theme === 'dark' ? 'dark' : 'light';
    // persist=false: kullanıcı henüz seçim yapmadı, sistem temasını izliyoruz (kaydetme)
    if (persist) { nativeTheme.themeSource = currentTheme; setSettings({ theme: currentTheme }); }
    try { win.setTitleBarOverlay({ ...t.overlay, height: TITLEBAR_H }); } catch (e) { /* yoksay */ }
    try { win.setBackgroundColor(t.bg); } catch (e) { /* yoksay */ }
  });

  h('dialog:openPdf', async ({ multi = true, title } = {}) => {
    const s = getSettings();
    const r = await systemDialog(() => dialog.showOpenDialog(win, {
      title: title || L('main.dlg.openPdf'),
      defaultPath: s.lastDir || app.getPath('documents'),
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: L('main.filter.pdfDocs'), extensions: ['pdf'] }, { name: L('main.filter.allFiles'), extensions: ['*'] }],
    }));
    if (r.canceled || !r.filePaths.length) return [];
    setSettings({ lastDir: path.dirname(r.filePaths[0]) });
    // Okunamayan tek bir dosya tüm seçimi iptal etmesin
    const res = await Promise.allSettled(r.filePaths.map(readPdf));
    const ok = res.filter((x) => x.status === 'fulfilled').map((x) => x.value);
    res.forEach((x, k) => x.status === 'rejected' && log('okunamadı:', r.filePaths[k], x.reason?.code || x.reason?.message));
    if (!ok.length) throw res[0].reason;
    return ok;
  });
  h('dialog:openFiles', async ({ title, filters, multi = true } = {}) => {
    const s = getSettings();
    const r = await systemDialog(() => dialog.showOpenDialog(win, {
      title, defaultPath: s.lastDir || app.getPath('documents'),
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'], filters,
    }));
    if (r.canceled) return [];
    setSettings({ lastDir: path.dirname(r.filePaths[0]) });
    return Promise.all(r.filePaths.map(async (f) => {
      const buf = await fsp.readFile(f);
      return { path: f, name: path.basename(f), bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
    }));
  });
  h('file:readPdf', (file) => readPdf(file));
  h('file:exists', (file) => fs.existsSync(file));
  h('dialog:save', async ({ defaultName, title, filters, defaultDir } = {}) => {
    const s = getSettings();
    const r = await systemDialog(() => dialog.showSaveDialog(win, {
      title: title || L('main.dlg.save'),
      defaultPath: path.join(defaultDir || s.lastDir || app.getPath('documents'), defaultName || 'belge.pdf'),
      filters: filters || [{ name: L('main.filter.pdfDoc'), extensions: ['pdf'] }],
    }));
    if (r.canceled || !r.filePath) return null;
    setSettings({ lastDir: path.dirname(r.filePath) });
    return r.filePath;
  });
  h('dialog:folder', async ({ title, defaultDir } = {}) => {
    const s = getSettings();
    const r = await systemDialog(() => dialog.showOpenDialog(win, { title: title || L('main.dlg.pickFolder'), defaultPath: defaultDir || s.lastDir || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] }));
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });
  h('file:write', async (file, bytes, { recent = false } = {}) => {
    await atomicWrite(file, bytes);
    if (recent) addRecent(file);
    const st = await fsp.stat(file);
    return { path: file, name: path.basename(file), size: st.size };
  });
  h('file:writeInFolder', async (folder, name, bytes) => {
    await fsp.mkdir(folder, { recursive: true }).catch(() => {});
    let file = path.join(folder, name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_'));
    const ext = path.extname(file);
    const base = file.slice(0, file.length - ext.length);
    for (let i = 2; fs.existsSync(file); i++) file = `${base} (${i})${ext}`;
    await fsp.writeFile(file, Buffer.from(bytes));
    return file;
  });
  // ---------------- kayıtlı iş akışları ----------------
  // Klasördeki PDF'ler (alt klasörlere inilmez); baytlar sırası gelince file:readPdf ile okunur
  h('workflow:pickFolder', async ({ title } = {}) => {
    const s = getSettings();
    const r = await systemDialog(() => dialog.showOpenDialog(win, { title: title || L('main.dlg.pickPdfFolder'), defaultPath: s.lastDir || app.getPath('documents'), properties: ['openDirectory'] }));
    if (r.canceled || !r.filePaths.length) return null;
    const folder = r.filePaths[0];
    setSettings({ lastDir: folder });
    const files = [];
    for (const d of await fsp.readdir(folder, { withFileTypes: true })) {
      if (!d.isFile() || !/\.pdf$/i.test(d.name)) continue;
      const f = path.join(folder, d.name);
      try { const st = await fsp.stat(f); files.push({ path: f, name: d.name, size: st.size }); } catch (e) { /* yoksay */ }
    }
    files.sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true, sensitivity: 'base' }));
    return { folder, files };
  });
  h('workflow:write', (folder, name, bytes) => writeNewFile(folder, name, bytes));
  h('file:stat', async (file) => {
    try { const st = await fsp.stat(file); return { size: st.size, mtime: st.mtimeMs }; } catch (e) { return null; }
  });
  h('shell:showItem', (file) => shell.showItemInFolder(file));
  h('shell:openPath', (file) => shell.openPath(file));
  h('recent:add', (file) => {
    if (typeof file !== 'string' || !file) return getSettings().recent || [];
    addRecent(file);
    return getSettings().recent || [];
  });
  h('recent:remove', (file) => {
    const s = getSettings();
    setSettings({ recent: (s.recent || []).filter((r) => r !== file) });
  });
  h('print:images', (pages, jobName) => printImages(pages, jobName));
  h('office:info', async () => ({ word: await office.hasWord() }));
  h('office:toPdf', (req) => office.officeToPdf(req || {}, log));
  h('win:setTitle', (t) => win && win.setTitle(t));
  h('win:fullscreen', (on) => { if (win) win.setFullScreen(!!on); return win && win.isFullScreen(); });
  h('clipboard:writeImage', async (bytes) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(bytes)], { type: 'image/png' }) })]);
    return true;
  });
  h('fonts:read', async (file) => {
    if (!/^[\w.-]+\.(ttf|otf)$/i.test(file)) throw new Error(L('main.err.badFont'));
    const buf = await fsp.readFile(path.join(FONT_DIR, file));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  // ---------------- lisans (Pro) ----------------
  h('license:status', () => license.status());
  h('license:activate', (text) => {
    if (typeof text !== 'string' || text.length > 64 * 1024) return { ok: false, code: 'format' };
    const r = license.activate(text);
    if (r.ok) sendToWindow('license:changed', r.status);
    return r;
  });
  h('license:importFile', async () => {
    const s = getSettings();
    const r = await systemDialog(() => dialog.showOpenDialog(win, {
      title: L('main.dlg.pickLicense'),
      defaultPath: s.lastDir || app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: L('main.filter.license'), extensions: ['hermopdflicense', 'ultronpdflicense', 'ultronixlicense', 'txt'] }, { name: L('main.filter.allFiles'), extensions: ['*'] }],
    }));
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    let text;
    try {
      const st = await fsp.stat(r.filePaths[0]);
      if (!st.isFile() || st.size > 64 * 1024) return { ok: false, code: 'file' };
      text = await fsp.readFile(r.filePaths[0], 'utf8');
    } catch (e) {
      return { ok: false, code: 'file' };
    }
    const res = license.activate(text);
    if (res.ok) sendToWindow('license:changed', res.status);
    return res;
  });
  h('license:remove', () => {
    const st = license.remove();
    sendToWindow('license:changed', st);
    return st;
  });
  // ---------------- güncelleme bildirimi (isteğe bağlı) ----------------
  h('update:getPrefs', () => updater.getPrefs());
  h('update:setPrefs', (p) => updater.setPrefs(p));
  h('update:checkNow', () => updater.run({ force: true }));
  h('update:openDownload', () => updater.openDownload());
  // Sitemizin sabit sayfaları (arayüz adres vermez, yalnızca türü seçer)
  h('site:open', (kind) => {
    const ep = endpoints(process.env, uiLang || 'en');
    const url = { pricing: ep.pricing, support: ep.support }[kind];
    return url ? openSiteUrl(url) : false;
  });

  // ---------------- Claude bağlantısı ----------------
  h('claude:status', () => claudeStatus());
  h('claude:checkPath', (file) => claudeCheckPdfPath(file));
  h('claude:setEnabled', async (on) => {
    setSettings({ claudeBridge: on === true });
    flushSettings();
    if (on === true) await bridge.start();
    else bridge.stop();
    return claudeStatus();
  });
  h('claude:openBundle', async () => {
    const f = claudePaths().bundle;
    // Testte Claude Desktop'a hiçbir şey kurulmasın
    if (process.env.PDFUSTA_TEST) { log('test: .mcpb açılmadı:', f); return { ok: true, test: true }; }
    if (!fs.existsSync(f)) return { ok: false, reason: 'missing' };
    const err = await shell.openPath(f);
    if (err) log('.mcpb açılamadı:', err);
    return err ? { ok: false, reason: 'no_handler', error: err } : { ok: true };
  });
}

// .mcpb paketi ve yedek (elle kurulum) sunucu dosyasının yeri
function claudePaths() {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'claude') : null;
  return {
    bundle: base ? path.join(base, 'hermopdf.mcpb') : path.join(APP_ROOT, 'dist-mcpb', 'hermopdf.mcpb'),
    server: base ? path.join(base, 'server.cjs') : path.join(APP_ROOT, 'build', 'mcp', 'server.cjs'),
  };
}
// Claude Desktop'ın claude_desktop_config.json dosyasına elle eklenecek parça:
// uygulamanın kendi exe'si ELECTRON_RUN_AS_NODE=1 ile Node gibi çalışıp paketlenmiş sunucuyu yürütür (ayrıca Node kurmak gerekmez).
function claudeManualConfig() {
  const p = claudePaths();
  const s = bridge ? bridge.status() : {};
  return JSON.stringify({
    mcpServers: {
      'hermopdf': {
        command: process.execPath,
        args: [p.server],
        env: { ELECTRON_RUN_AS_NODE: '1', ULTRONIX_BRIDGE_FILE: s.bridgeFile || path.join(app.getPath('userData'), 'claude-bridge.json') },
      },
    },
  }, null, 2);
}
// Yalnızca testte: PDFUSTA_CLAUDE_TIMEOUTS='{"save_document":3000}' ile kısa zaman aşımları
function testTimeouts() {
  if (!process.env.PDFUSTA_TEST || !process.env.PDFUSTA_CLAUDE_TIMEOUTS) return null;
  try { return JSON.parse(process.env.PDFUSTA_CLAUDE_TIMEOUTS); } catch (e) { return null; }
}
// Claude'un açmak istediği yol: kısayol/bağlantılar çözülür, ağ konumuna (\\sunucu\..., eşlenmiş ağ sürücüsü) çıkan reddedilir
async function claudeCheckPdfPath(file) {
  if (typeof file !== 'string' || !file || file.length > 1024) return { error: 'invalid' };
  let real;
  try { real = await fsp.realpath(file); } catch (e) { return { error: 'not_found' }; }
  real = real.replace(/^\\\\\?\\(?=[a-zA-Z]:)/, '');
  if (/^[\\/]{2}/.test(real) || !/^[a-zA-Z]:[\\/]/.test(real)) return { error: 'network' };
  if (!/\.pdf$/i.test(real)) return { error: 'not_pdf' };
  let st;
  try { st = await fsp.stat(real); } catch (e) { return { error: 'not_found' }; }
  if (!st.isFile()) return { error: 'not_found' };
  return { path: real, size: st.size };
}
function claudeStatus() {
  const s = bridge ? bridge.status() : { running: false, clients: 0 };
  const p = claudePaths();
  return {
    ...s,
    enabled: getSettings().claudeBridge === true,
    bundleAvailable: fs.existsSync(p.bundle),
    serverAvailable: fs.existsSync(p.server),
    manualConfig: claudeManualConfig(),
  };
}

// ---------------- lisans ve güncelleme bildirimi ----------------
// Test kancaları (atılık anahtarlar, sandbox lisansı, kısa gecikme) yalnızca repo içinden geliştirme çalıştırmasında.
// app.isPackaged tek başına yetmez: exe'yi "electron.exe" diye kopyalamak onu false yapar (bkz. keys.js isDevRun).
const LICENSING = licensingConfig({ isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath, env: process.env });
const devTest = () => LICENSING.devTest;
let license = null;
let updater = null;
function sendToWindow(ch, payload) {
  try { if (win && !win.isDestroyed() && rendererReady) win.webContents.send(ch, payload); } catch (e) { /* yoksay */ }
}
// Tarayıcıda yalnızca sitemizin kendi https adresleri açılır
function openSiteUrl(url) {
  if (!isSiteUrl(url)) { log('dış adres reddedildi'); return false; }
  if (process.env.PDFUSTA_TEST) {
    // Testte tarayıcı açılmaz; test, açılacak adresi buradan okur
    (global.__ultronixExternal = global.__ultronixExternal || []).push(url);
    log('test: tarayıcı açılmadı:', url);
    return true;
  }
  shell.openExternal(url);
  return true;
}
function initLicensing() {
  const { keys, allowSandbox } = LICENSING;
  const dir = app.getPath('userData');
  license = createLicenseStore({ dir, keys, allowSandbox, log });
  const st = license.load();
  if (st.state !== 'free') log('lisans durumu:', st.state, st.env || '');
  const testDelay = devTest() ? Number(process.env.ULTRONIX_UPDATE_DELAY_MS) : NaN;
  updater = createUpdater({
    dir, appVersion: app.getVersion(), keys, license, endpoints, isSiteUrl,
    getSettings, setSettings, flushSettings, send: sendToWindow, openExternal: openSiteUrl, log,
    delayMs: Number.isFinite(testDelay) && testDelay >= 0 ? testDelay : 10000,
  });
}

// ---------------- başlangıç ----------------
process.on('uncaughtException', (e) => { try { log('ANA SÜREÇ HATASI', e.stack || e.message); } catch (x) { /* yoksay */ } });
process.on('unhandledRejection', (e) => { try { log('ANA SÜREÇ RED', (e && e.stack) || e); } catch (x) { /* yoksay */ } });

// Zaten açık bir HermoPDF varsa dosyayı ona devret; yoksa asıl kopya biz olalım.
const isPrimary = process.env.PDFUSTA_TEST ? true : tryClaimPrimary();
if (!isPrimary) {
  const files = pdfArgs(process.argv);
  log('zaten açık bir kopya var; dosya devrediliyor:', files.join(' | ') || '(dosya yok)');
  mailboxPut(files.length ? files : ['__focus__']);
  app.quit();
  setTimeout(() => app.exit(0), 2500);
} else {
  pendingOpen.push(...pdfArgs(process.argv), ...mailboxTake().filter((f) => f !== '__focus__'));
  app.on('second-instance', (e, argv) => {
    log('second-instance argv:', JSON.stringify(argv));
    const files = pdfArgs(argv);
    const queued = mailboxTake().filter((f) => f !== '__focus__');
    queueOpen([...new Set([...files, ...queued])]);
    focusWindow();
  });
  app.whenReady().then(() => {
    startHeartbeat();
    Menu.setApplicationMenu(null);
    { const st = getSettings().theme; nativeTheme.themeSource = st === 'dark' || st === 'light' ? st : 'system'; }
    registerProtocol();
    bridge = createBridge({ app, getWindow: () => win, isRendererReady: () => rendererReady, log, timeoutOverrides: testTimeouts() });
    // Önceki oturumdan (çökme vb.) kalmış köprü dosyası eski anahtarı göstermesin
    bridge.deleteBridgeFile();
    setUiLang(resolveLang());
    office.setTranslator(L);
    initLicensing();
    registerIpc();
    createWindow();
    watchMailbox();
    // Claude bağlantısı varsayılan KAPALI; yalnızca kullanıcı açtıysa dinlenir
    if (getSettings().claudeBridge === true) bridge.start();
    // Güncelleme bildirimi varsayılan KAPALI; yalnızca kullanıcı "Evet" dediyse ~10 sn sonra denetlenir
    updater.schedule();
  });
  app.on('will-quit', () => { if (bridge) bridge.stop(); if (updater) updater.stop(); });
  process.on('exit', () => { try { bridge?.deleteBridgeFile(); } catch (e) { /* yoksay */ } });
  app.on('window-all-closed', () => {
    flushSettings();
    app.quit();
  });
}
