#!/usr/bin/env node
// Ana sayfadaki "hedef boyuta küçültme" hareketli görseli: uygulamanın GERÇEK arayüzü, her dilde ayrı dosya.
// Çizim/sahte arayüz yok: HermoPDF Playwright ile sürülür (tests/harness.js ile aynı: PDFUSTA_TEST=1, geçici
// PDFUSTA_USERDATA, pencere ekran dışında), kareler uygulamanın kendi ekranından alınır, küçültme gerçekten yapılır
// ve sondaki önce/sonra boyutu uygulamanın gerçek sonucudur.
//
//   node tools/compress-demo.mjs              → 11 dil
//   node tools/compress-demo.mjs tr en ar     → yalnız bu diller
//   node tools/compress-demo.mjs --keep       → ara kareleri (PNG) geçici klasörde bırak, yolunu yaz
//
// Kaynak belge: Hermes görseli (website/prototipler/hermes-test/assets/hermes.png, kendi ürettiğimiz görsel) ve
// altında o dilde 3 cümlelik mitoloji bilgisi olan tek sayfalık PDF; bilgisayardaki Edge ile (Chromium "PDF olarak
// yazdır") her dil için üretilir, böylece Arapça/Japonca/Korece/Çince yazılar doğru çizilir.
//
// Çıktı: src/static/demo/kucultme.<dil>.mp4 (sessiz, ~6,5 sn döngü, H.264) ve kucultme.<dil>.webp (durağan poster:
// sonuç ekranı) + src/content/demo-compress.json (her dilde ölçülen gerçek önce/sonra baytları).
// Gerekenler: ffmpeg (PATH'te), Microsoft Edge, uygulama deposundaki playwright-core ve electron. Hiçbir şey indirilmez.
// Sonra: node build.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.resolve(process.env.ULTRONIX_APP_DIR || path.join(ROOT, '..'));
const OUT = path.join(ROOT, 'src', 'static', 'demo');
const NUMBERS = path.join(ROOT, 'src', 'content', 'demo-compress.json');
const HERMES = path.join(ROOT, 'prototipler', 'hermes-test', 'assets', 'hermes.png');
const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const ALL = ['en', 'tr', 'es', 'fr', 'de', 'pt-BR', 'ru', 'zh-Hans', 'ja', 'ko', 'ar'];
const LANGS = args.filter((a) => !a.startsWith('--'));
for (const l of LANGS) if (!ALL.includes(l)) { console.error(`Bilinmeyen dil: ${l} (${ALL.join(', ')})`); process.exit(1); }
const TARGET_MB = 0.5;
const SCALE = 2; // kareler 2x alınır, videoda küçültülür (yazılar keskin kalsın)
const OUT_W = 960; // video genişliği (px); sitede ~560 px gösterilir, yüksek yoğunluklu ekranda da keskin
const FPS = 15;

if (!fs.existsSync(path.join(APP, 'package.json'))) { console.error(`Uygulama deposu bulunamadı: ${APP}`); process.exit(1); }
const require = createRequire(path.join(APP, 'package.json'));
const { _electron: electron, chromium } = require('playwright-core');
const electronPath = require('electron');
const appPkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.error('ffmpeg bulunamadı (PATH).'); process.exit(1); }

// Hermes: Yunan mitolojisi, kısa ve doğru (tanrıların habercisi, Zeus ile Maia'nın oğlu, kanatlı sandaletler, yolcular/tüccarlar, ruhlara rehberlik).
const DOC = {
  en: ['Hermes, Messenger of the Gods', 'In Greek mythology, Hermes is the messenger of the Olympian gods and the son of Zeus and Maia. With his winged sandals he was the swiftest of the gods. He protected travelers, merchants and roads, and guided souls to the underworld.'],
  tr: ['Hermes, Tanrıların Habercisi', 'Yunan mitolojisinde Hermes, Olimposlu tanrıların habercisi ve Zeus ile Maia’nın oğludur. Kanatlı sandaletleriyle tanrıların en hızlısıydı. Yolcuları, tüccarları ve yolları korur, ruhları yeraltı dünyasına götürürdü.'],
  es: ['Hermes, el mensajero de los dioses', 'En la mitología griega, Hermes es el mensajero de los dioses del Olimpo e hijo de Zeus y Maya. Con sus sandalias aladas era el más veloz de los dioses. Protegía a los viajeros, los comerciantes y los caminos, y guiaba a las almas al inframundo.'],
  fr: ['Hermès, le messager des dieux', 'Dans la mythologie grecque, Hermès est le messager des dieux de l’Olympe et le fils de Zeus et de Maïa. Grâce à ses sandales ailées, il était le plus rapide des dieux. Il protégeait les voyageurs, les marchands et les routes, et conduisait les âmes aux Enfers.'],
  de: ['Hermes, Bote der Götter', 'In der griechischen Mythologie ist Hermes der Bote der olympischen Götter und der Sohn von Zeus und Maia. Mit seinen geflügelten Sandalen war er der schnellste der Götter. Er beschützte Reisende, Kaufleute und Wege und geleitete die Seelen in die Unterwelt.'],
  'pt-BR': ['Hermes, o mensageiro dos deuses', 'Na mitologia grega, Hermes é o mensageiro dos deuses do Olimpo e filho de Zeus e Maia. Com suas sandálias aladas, era o mais veloz dos deuses. Protegia os viajantes, os comerciantes e os caminhos, e guiava as almas ao mundo dos mortos.'],
  ru: ['Гермес, вестник богов', 'В греческой мифологии Гермес — вестник олимпийских богов, сын Зевса и Майи. В крылатых сандалиях он был быстрейшим из богов. Он покровительствовал путникам, торговцам и дорогам и провожал души умерших в подземное царство.'],
  'zh-Hans': ['赫尔墨斯：众神的信使', '在希腊神话中，赫尔墨斯是奥林匹斯众神的信使，也是宙斯与迈亚之子。他脚穿带翼的凉鞋，是众神中速度最快的一位。他守护旅人、商人和道路，并引导亡魂前往冥界。'],
  ja: ['ヘルメス：神々の使者', 'ギリシア神話のヘルメスは、オリュンポスの神々の使者であり、ゼウスとマイアの息子です。翼のあるサンダルを履き、神々の中で最も速く駆けました。旅人や商人、道の守り神であり、死者の魂を冥界へ導きました。'],
  ko: ['헤르메스, 신들의 전령', '그리스 신화에서 헤르메스는 올림포스 신들의 전령이자 제우스와 마이아의 아들입니다. 날개 달린 샌들을 신은 그는 신들 가운데 가장 빨랐습니다. 여행자와 상인, 길을 지켜 주었고 죽은 이의 영혼을 저승으로 인도했습니다.'],
  ar: ['هيرميس، رسول الآلهة', 'في الأساطير الإغريقية، هيرميس هو رسول آلهة الأولمب وابن زيوس ومايا. وبفضل صندله المجنّح كان أسرع الآلهة. وكان يحمي المسافرين والتجار والطرق، ويرشد أرواح الموتى إلى العالم السفلي.'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermopdf-demo-'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ff = (a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'ignore', 'inherit'] });

// ---------- 1) Kaynak PDF'ler (Edge, Chromium "PDF olarak yazdır") ----------
async function makePdfs(langs) {
  // Görsel kayıpsız PNG olarak gömülür: "belgeye yapıştırılmış büyük görsel" gibi, birkaç MB'lık gerçekçi bir dosya.
  const img = path.join(tmp, 'hermes.png');
  ff(['-i', HERMES, '-vf', 'scale=3600:-2:flags=lanczos', img]);
  let browser;
  for (const channel of ['msedge', 'chrome']) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* sıradakini dene */ }
  }
  if (!browser) throw new Error('Edge/Chrome bulunamadı');
  const page = await browser.newPage();
  const out = {};
  for (const lang of langs) {
    const [title, body] = DOC[lang];
    const cjk = /^(zh|ja|ko)/.test(lang);
    const html = `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{size:A4;margin:0}
html,body{margin:0;background:#FBF5E6}
.p{box-sizing:border-box;width:210mm;height:297mm;padding:20mm 18mm;color:#181923;background:#FBF5E6;border-top:5mm solid #C9A44C}
h1{font:700 27pt/1.2 ${cjk || lang === 'ar' ? "'Segoe UI','Yu Gothic','Malgun Gothic','Microsoft YaHei',sans-serif" : "Georgia,'Times New Roman',serif"};margin:0 0 9mm;color:#181923}
.rule{height:.6mm;width:30mm;background:#C9A44C;margin:0 0 9mm}
img{display:block;width:100%;height:auto;border-radius:2mm}
p{font:400 13.5pt/1.65 ${cjk || lang === 'ar' ? "'Segoe UI','Yu Gothic','Malgun Gothic','Microsoft YaHei',sans-serif" : "Georgia,'Times New Roman',serif"};margin:9mm 0 0}
</style></head><body><div class="p"><h1>${esc(title)}</h1><div class="rule"></div><img src="hermes.png" alt=""><p>${esc(body)}</p></div></body></html>`;
    const hf = path.join(tmp, `doc-${lang}.html`);
    fs.writeFileSync(hf, html);
    await page.goto(pathToFileURL(hf).href);
    await page.waitForLoadState('load');
    const dir = path.join(tmp, 'belge', lang);
    fs.mkdirSync(dir, { recursive: true });
    out[lang] = path.join(dir, 'Hermes.pdf');
    await page.pdf({ path: out[lang], format: 'A4', printBackground: true, preferCSSPageSize: true });
    console.log(`  belge: ${lang} ${(fs.statSync(out[lang]).size / 1048576).toFixed(2)} MB`);
  }
  await browser.close();
  return out;
}

// ---------- 2) Uygulamadan kareler ----------
async function capture(lang, pdf) {
  const frames = path.join(tmp, 'kare', lang);
  fs.mkdirSync(frames, { recursive: true });
  const userData = path.join(tmp, 'ud', lang);
  const saveDir = path.join(tmp, 'kayit', lang);
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(saveDir, { recursive: true });
  const app = await electron.launch({
    executablePath: electronPath,
    args: [`--force-device-scale-factor=${SCALE}`, APP],
    env: { ...process.env, PDFUSTA_USERDATA: userData, PDFUSTA_TEST: '1', PDFUSTA_LANG: lang, ...(process.env.PU_TEST_VISIBLE === '1' ? {} : { PU_TEST_OFFSCREEN: '1' }) },
  });
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1400, 900); });
    await win.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
    await app.evaluate(({ dialog }, dir) => {
      dialog.showSaveDialog = async (w, o) => ({ canceled: false, filePath: `${dir}\\${String((o || w).defaultPath || 'out.pdf').split(/[\\/]/).pop()}` });
    }, saveDir);
    await win.evaluate(() => import('app://pu/src/renderer/js/app.js').then((m) => m.setTheme('light')));
    await win.evaluate((f) => window.__pu.openPaths([f]), pdf);
    await win.waitForSelector('.doc-view:not(.hidden) .page[data-page-number="1"] canvas', { timeout: 30000 });
    await sleep(800);
    // Uygulamanın kendiliğinden açtığı ipucu/iletişim kutusu varsa kapat.
    await win.evaluate(() => { document.querySelectorAll('.modal-backdrop, .toast').forEach((m) => m.remove()); });
    await win.evaluate(() => window.__pu.setScale ? window.__pu.setScale('page-fit') : import('app://pu/src/renderer/js/app.js').then((m) => m.setScale('page-fit')));
    await sleep(1500);

    // Kırpım: küçült penceresinin çevresi (pencere ortada); belge karesi de aynı kırpımla alınır.
    const openDialog = async () => {
      await win.evaluate(() => { window.__pu.runAction('tools.compress'); });
      await win.waitForSelector('.modal input[type=number]', { timeout: 10000 });
      await sleep(450);
    };
    await openDialog();
    const b = await win.locator('.modal').first().boundingBox();
    await win.keyboard.press('Escape');
    await sleep(500);
    const pad = 22;
    const clip = { x: Math.floor(b.x - pad), y: Math.max(0, Math.floor(b.y - pad)), width: Math.ceil(b.width + pad * 2), height: Math.min(900 - Math.max(0, Math.floor(b.y - pad)), Math.ceil(b.height + pad * 2)) };
    clip.width -= clip.width % 2; clip.height -= clip.height % 2;

    const list = []; // { file, t (ms, gerçek), tag }
    let k = 0;
    const snap = async (tag) => {
      const file = path.join(frames, `f${String(++k).padStart(4, '0')}.png`);
      await win.screenshot({ path: file, clip });
      list.push({ file, t: Date.now(), tag });
      return file;
    };
    // a) belge
    await snap('doc');
    // b) pencere açılır, hedef yazılır
    await openDialog();
    await snap('dialog');
    await win.click('.modal input[type=number]');
    for (const ch of String(TARGET_MB)) { await win.keyboard.type(ch); await sleep(60); await snap('type'); }
    // Kaydet seçeneği: "yeni dosya (orijinal korunur)" varsayılan; görünür kalsın.
    await snap('ready');
    // c) Küçült: ilerleme penceresi canlı kaydedilir. Küçültme ~1 sn sürdüğü için ekran görüntüsü yerine Chromium'un
    // ekran yayını (CDP screencast) kullanılır: arayüz her değiştiğinde bir kare gelir, iş hiç yavaşlatılmaz.
    const before = fs.statSync(pdf).size;
    const cdp = await win.context().newCDPSession(win);
    const cast = [];
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      cast.push({ data, t: metadata.timestamp * 1000 });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    // Zaman damgaları: küçült penceresinin kapandığı an ve sonuç penceresinin göründüğü an (yalnız aradaki kareler alınır;
    // sonuç penceresi ham hâliyle kayıt yolunu içerir, o kareler kullanılmaz).
    await win.evaluate(() => {
      const T = (window.__demoT = {});
      const mo = new MutationObserver(() => {
        if (!T.gone && !document.querySelector('.modal input[type=number]')) T.gone = Date.now();
        if (!T.result && document.querySelector('.modal .size-compare')) { T.result = Date.now(); mo.disconnect(); }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1400 * SCALE, maxHeight: 900 * SCALE, everyNthFrame: 1 });
    await win.locator('.modal .modal-foot button').last().click();
    await win.waitForSelector('.modal .size-compare', { timeout: 240000 });
    await cdp.send('Page.stopScreencast');
    await cdp.detach().catch(() => {});
    const T = await win.evaluate(() => window.__demoT);
    const prog = cast.filter((f) => f.t >= T.gone && f.t < T.result - 20);
    if (!prog.length) throw new Error(`ilerleme karesi yok (${cast.length} yayın karesi)`);
    for (const f of prog) {
      const raw = path.join(frames, `c${String(++k).padStart(4, '0')}.png`);
      fs.writeFileSync(raw, Buffer.from(f.data, 'base64'));
      const file = raw.replace(/c(\d+)\.png$/, 'f$1.png');
      // Yayın karesi tüm pencere: aynı kırpım uygulanır (kare boyutu ölçeğe göre).
      const s = SCALE;
      ff(['-i', raw, '-vf', `scale=${1400 * s}:${900 * s},crop=${clip.width * s}:${clip.height * s}:${clip.x * s}:${clip.y * s}`, file]);
      fs.rmSync(raw);
      list.push({ file, t: f.t, tag: 'progress' });
    }
    // d) sonuç: bilgisayar adı/geçici klasör görünmesin
    await win.evaluate((dir) => {
      for (const p of document.querySelectorAll('.modal .modal-msg')) p.textContent = p.textContent.split(dir + '\\').join('…\\').split(dir).join('…');
    }, saveDir);
    await sleep(500);
    const resultFile = await snap('result');
    const outs = fs.readdirSync(saveDir).filter((f) => /\.pdf$/i.test(f));
    if (outs.length !== 1) throw new Error(`kaydedilen dosya bulunamadı (${outs.join(', ')})`);
    const after = fs.statSync(path.join(saveDir, outs[0])).size;
    const msg = await win.evaluate(() => document.querySelector('.modal .modal-msg')?.textContent || '');
    await win.locator('.modal .modal-foot button').last().click().catch(() => {});
    return { list, resultFile, before, after, outName: outs[0], msg, clip };
  } finally {
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
}

// ---------- 3) Zaman çizelgesi + kodlama ----------
// ~6,7 sn döngü: belge 0,9 · pencere 0,8 · yazma 3×0,28 · hazır 0,35 · ilerleme 1,6 (gerçek kareler, gerçek zaman
// oranlarıyla bu süreye yayılır) · sonuç 2,2 (önce/sonra, uygulamanın gerçek sonucu)
function encode(lang, cap) {
  const { list } = cap;
  const seq = [];
  const by = (tag) => list.filter((f) => f.tag === tag);
  seq.push([by('doc')[0].file, 0.9]);
  seq.push([by('dialog')[0].file, 0.8]);
  for (const f of by('type')) seq.push([f.file, 0.28]);
  seq.push([by('ready')[0].file, 0.35]);
  const prog = by('progress');
  const PROG = 1.6;
  if (prog.length) {
    // gerçek zaman oranları korunur, toplam süre PROG'a sığdırılır (en az 1 kare/çerçeve)
    const span = Math.max(1, prog[prog.length - 1].t - prog[0].t + 1);
    const ends = [...prog.slice(1).map((f) => f.t), prog[0].t + span];
    prog.forEach((f, i) => seq.push([f.file, Math.max(1 / FPS, ((ends[i] - f.t) / span) * PROG)]));
  }
  seq.push([cap.resultFile, 2.2]);
  const total = seq.reduce((s, [, d]) => s + d, 0);
  const listFile = path.join(tmp, `concat-${lang}.txt`);
  const q = (p) => `'${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
  fs.writeFileSync(listFile, seq.map(([f, d]) => `file ${q(f)}\nduration ${d.toFixed(3)}`).join('\n') + `\nfile ${q(seq[seq.length - 1][0])}\n`);
  fs.mkdirSync(OUT, { recursive: true });
  const mp4 = path.join(OUT, `kucultme.${lang}.mp4`);
  const vf = `scale=${OUT_W}:-2:flags=lanczos,fps=${FPS},format=yuv420p`;
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'stillimage', '-crf', '24',
    '-profile:v', 'high', '-level', '4.0', '-g', String(FPS * 4), '-movflags', '+faststart', '-an', '-t', total.toFixed(2), mp4]);
  const webp = path.join(OUT, `kucultme.${lang}.webp`);
  ff(['-i', cap.resultFile, '-vf', `scale=${OUT_W}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', webp]);
  const dim = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4]).toString().trim().split(',').map(Number);
  return { mp4, webp, total, w: dim[0], h: dim[1] };
}

(async () => {
  const langs = LANGS.length ? LANGS : ALL;
  console.log(`Geçici klasör: ${tmp}`);
  const pdfs = await makePdfs(langs);
  const data = fs.existsSync(NUMBERS) ? JSON.parse(fs.readFileSync(NUMBERS, 'utf8')) : {};
  data._note = 'tools/compress-demo.mjs tarafından üretildi; elle değiştirme. Uygulamanın kendisinde, her dilin Hermes örnek belgesiyle ölçüldü.';
  data.appVersion = appPkg.version;
  data.targetMB = TARGET_MB;
  data.langs = data.langs || {};
  let failed = 0;
  for (const lang of langs) {
    try {
      console.log(`${lang}: uygulama`);
      const cap = await capture(lang, pdfs[lang]);
      const enc = encode(lang, cap);
      const kb = (f) => Math.round(fs.statSync(f).size / 1024);
      data.langs[lang] = { beforeBytes: cap.before, afterBytes: cap.after, reachedTarget: cap.after <= TARGET_MB * 1048576, width: enc.w, height: enc.h, seconds: Math.round(enc.total * 10) / 10, generatedAt: new Date().toISOString() };
      console.log(`  ${cap.before} → ${cap.after} bayt · ${cap.list.filter((f) => f.tag === 'progress').length} ilerleme karesi · ${enc.w}x${enc.h} · ${enc.total.toFixed(1)} sn · mp4 ${kb(enc.mp4)} KB · poster ${kb(enc.webp)} KB`);
    } catch (e) {
      failed++;
      console.error(`  ✘ ${lang}: ${e.stack || e.message}`);
    }
  }
  data.generatedAt = new Date().toISOString();
  fs.writeFileSync(NUMBERS, JSON.stringify(data, null, 2) + '\n');
  if (KEEP) console.log(`Ara kareler: ${tmp}`);
  else fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `${failed} dil başarısız.` : 'Tamam. Şimdi: node build.mjs');
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
