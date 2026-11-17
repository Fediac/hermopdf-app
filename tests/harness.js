// Ortak test yardımcıları: uygulamayı Playwright ile başlatır.
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const SHOTS = path.join(__dirname, 'shots');

const EXE_NAME = 'HermoPDF.exe';

// Kurulu uygulama: normalde "Programs\HermoPDF" (installer.nsh eski "PDF Usta" / "Ultronix PDF" / "UltronPDF" klasörünü buna çevirir);
// yine de eski kurulum klasöründe kalmış bir "HermoPDF.exe" varsa onu da bul.
function installedExe() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'Programs');
  const cands = ['HermoPDF', 'UltronPDF', 'Ultronix PDF', 'PDF Usta'].map((d) => path.join(base, d, EXE_NAME));
  return cands.find((f) => fs.existsSync(f)) || cands[0];
}

async function launch({ args = [], packaged = process.env.PACKAGED === '1', userData, legacyUserData } = {}) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const ud = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-test-'));
  const env = { ...process.env, PDFUSTA_USERDATA: ud, PDFUSTA_TEST: '1' };
  // Varsayılan: pencere ekran dışında, odak çalmadan; dosya/ileti/yazdırma pencereleri ve tarayıcı açılmaz.
  // Pencereyi görmek için: PU_TEST_VISIBLE=1
  if (process.env.PU_TEST_VISIBLE === '1') delete env.PU_TEST_OFFSCREEN;
  else env.PU_TEST_OFFSCREEN = '1';
  delete env.PDFUSTA_LEGACY_USERDATA;
  if (legacyUserData) env.PDFUSTA_LEGACY_USERDATA = legacyUserData;
  const opts = packaged
    ? { executablePath: path.join(ROOT, 'dist', 'win-unpacked', EXE_NAME), args, env }
    : { executablePath: require('electron'), args: [ROOT, ...args], env };
  const app = await electron.launch(opts);
  const win = await app.firstWindow();
  const logs = [];
  win.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  win.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await win.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  return { app, win, logs, userData: ud };
}

async function shot(win, name) {
  const f = path.join(SHOTS, `${name}.png`);
  await win.screenshot({ path: f });
  return f;
}

function copyFixture(name, dir, srcPath) {
  const d = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'pdfusta-fx-'));
  fs.mkdirSync(d, { recursive: true });
  const dst = path.join(d, name);
  fs.copyFileSync(srcPath || path.join(FIX, name), dst);
  return dst;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { launch, shot, copyFixture, sleep, installedExe, EXE_NAME, FIX, SHOTS, ROOT };
