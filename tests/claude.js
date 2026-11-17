// Claude bağlantısı testi: uygulama (geçici veri klasörü) + yerel MCP sunucusu (kaynak ve esbuild paketi).
// Claude Desktop'a hiçbir şey kurulmaz; sunucu, SDK'nın Client + StdioClientTransport'u ile test içinden başlatılır.
// Doğrular: varsayılan KAPALI, arayüzden açma (onay penceresi), araçlar, geçersiz istekler (MCP ve ham boru),
// yanlış anahtar, tanıtılmamış bağlantı sınırı, Claude'un yalnızca kendi adımlarını geri alması, otomatik kaydetin
// Claude'un değişikliklerini yazmaması, open_pdf onayı, zaman aşımında iptal, kapatınca ve uygulama kapanınca
// dostça hata, köprü dosyasının silinmesi.
// Kullanım: node tests/claude.js   (önce: npm run mcp:build — yoksa test kendisi paketler)
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { launch, shot, sleep, copyFixture, ROOT } = require('./harness');
const { MAX_UNAUTHED } = require('../src/main/claude-bridge');

// Yalnızca test: zaman aşımı/iptal yolunu sınamak için kısa süreler (ana süreç bunu PDFUSTA_TEST olmadan yok sayar)
const SAVE_TIMEOUT = 8000;
const NOTE_TIMEOUT = 3000;
process.env.PDFUSTA_CLAUDE_TIMEOUTS = JSON.stringify({ save_document: SAVE_TIMEOUT, add_note: NOTE_TIMEOUT });

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
    if (curWin) await shot(curWin, `FAILc-${name.replace(/[^\w]+/g, '_').slice(0, 60)}`).catch(() => {});
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'doğrulama başarısız'); };
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

const SRC_SERVER = path.join(ROOT, 'src', 'mcp', 'server.mjs');
const BUNDLE = path.join(ROOT, 'build', 'mcp', 'server.cjs');
const LONG = { timeout: 180000 };

let sdk = null;
async function connectClient(serverFile, bridgeFile, { command = process.execPath, extraEnv = {} } = {}) {
  if (!sdk) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport, getDefaultEnvironment } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    sdk = { Client, StdioClientTransport, getDefaultEnvironment };
  }
  const transport = new sdk.StdioClientTransport({
    command,
    args: [serverFile],
    env: { ...sdk.getDefaultEnvironment(), ULTRONIX_BRIDGE_FILE: bridgeFile, ...extraEnv },
    stderr: 'pipe',
  });
  const client = new sdk.Client({ name: 'hermopdf-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
// Araç çağrısı: protokol hatası da (ör. şema doğrulaması) "isError" sonucu gibi döner
async function call(client, name, args = {}) {
  try {
    return await client.callTool({ name, arguments: args }, undefined, LONG);
  } catch (e) {
    return { isError: true, protocolError: true, content: [{ type: 'text', text: e.message }] };
  }
}
const textOf = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
function dataOf(r) {
  for (const c of r.content || []) {
    if (c.type !== 'text') continue;
    try { const v = JSON.parse(c.text); if (v && typeof v === 'object') return v; } catch (e) { /* metin */ }
  }
  return null;
}
const ok = (r, what) => assert(!r.isError, `${what}: ${textOf(r).slice(0, 300)}`);

// Boruya ham bağlantı: ilk satır yanıtını döndürür (bağlantı reddedilirse hata kodu)
function rawPipe(pipe, firstLine) {
  return new Promise((resolve) => {
    const s = net.connect(pipe);
    let buf = '';
    let closed = false;
    const done = (v) => { clearTimeout(t); s.destroy(); resolve(v); };
    const t = setTimeout(() => done({ timeout: true, buf, closed }), 4000);
    s.on('connect', () => { if (firstLine != null) s.write(`${firstLine}\n`); });
    s.on('data', (d) => { buf += d; });
    s.on('error', (e) => done({ error: e.code || e.message }));
    s.on('close', () => { closed = true; done({ buf, closed: true }); });
  });
}

// Ham boru oturumu: anahtarlı hello, sonra istekler TEK TEK (yanıt gelince sıradaki); her isteğin yanıtını döndürür.
// MCP sunucusunun şema denetimini atlar: uygulamanın kendi doğrulamasını sınar.
function rawSession(pipe, token, requests) {
  return new Promise((resolve, reject) => {
    const s = net.connect(pipe);
    s.setEncoding('utf8');
    let buf = '';
    let hello = null;
    const replies = new Map();
    const t = setTimeout(() => { s.destroy(); reject(new Error(`ham oturum zaman aşımı (${replies.size}/${requests.length})`)); }, 30000);
    const finish = () => { clearTimeout(t); s.destroy(); resolve({ hello, replies }); };
    const next = () => {
      const k = replies.size;
      if (k >= requests.length) { finish(); return; }
      const [method, params] = requests[k];
      s.write(`${JSON.stringify({ id: k + 1, method, params })}\n`);
    };
    s.on('connect', () => s.write(`${JSON.stringify({ type: 'hello', token })}\n`));
    s.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (!hello) {
          hello = msg;
          if (!msg.ok) { finish(); return; }
          next();
          continue;
        }
        replies.set(msg.id, msg);
        next();
      }
    });
    s.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}
const tokenOf = (bridgeFile) => JSON.parse(fs.readFileSync(bridgeFile, 'utf8')).token;
const pipeOf = (bridgeFile) => JSON.parse(fs.readFileSync(bridgeFile, 'utf8')).pipe;

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hermopdf-claude-'));
  const ud = path.join(work, 'userdata');
  fs.mkdirSync(ud);
  const pdf = copyFixture('test.pdf', path.join(work, 'belgeler'));
  const origHash = sha(pdf);
  const bridgeFile = path.join(ud, 'claude-bridge.json');
  const pdf2 = copyFixture('test.pdf', path.join(work, 'diger'));
  fs.renameSync(pdf2, path.join(work, 'diger', 'ikinci belge.pdf'));
  const pdf2Path = path.join(work, 'diger', 'ikinci belge.pdf');
  let pipe = null;

  if (!fs.existsSync(BUNDLE)) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-mcp.js')], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) { console.log(r.stdout, r.stderr); process.exit(1); }
  }

  let { app, win, logs } = await launch({ userData: ud, args: [pdf] });
  curWin = win;
  let client = null;
  let docId = null;
  let word = null;
  try {
    await win.waitForFunction(() => window.__pu.App.active && window.__pu.App.active.numPages > 0, null, { timeout: 30000 });

    await step('Varsayılan KAPALI: köprü dosyası yok, boru dinlenmiyor', async () => {
      assert(!fs.existsSync(bridgeFile), 'köprü dosyası var');
      const st = await win.evaluate(() => window.pu.claude.status());
      assert(!st.running && !st.pipe, `köprü çalışıyor: ${JSON.stringify(st)}`);
      const s = await win.evaluate(() => window.__pu.App.settings.claudeBridge);
      assert(s !== true, 'ayar açık görünüyor');
      assert(await win.locator('#sb-claude').isHidden(), 'durum çubuğu göstergesi görünüyor');
    });

    await step('Kapalıyken MCP sunucusu dostça hata veriyor (TR + EN)', async () => {
      const c = await connectClient(SRC_SERVER, bridgeFile);
      try {
        const r = await call(c, 'list_documents');
        assert(r.isError && !r.protocolError, 'hata sonucu değil');
        const t = textOf(r);
        assert(/Claude bağlantısını açın/.test(t) && /turn on the Claude connection/.test(t), t);
      } finally { await c.close(); }
    });

    await step('Arayüzden açma: şerit → onay penceresi → Bağlantıyı aç → kurulum adımı', async () => {
      await win.click('[data-tab="tools"]');
      await win.click('[data-action="claude.connect"]');
      const m = win.locator('.modal', { hasText: 'Ne paylaşılır?' });
      await m.waitFor({ timeout: 5000 });
      const body = await m.innerText();
      for (const s of ['Anthropic', 'ücretsiz', 'Claude planınızdan', 'Geri al', 'karartmayı uygulayamaz']) assert(body.includes(s), `onay metninde yok: ${s}`);
      assert(!fs.existsSync(bridgeFile), 'onaydan önce köprü açılmış');
      await shot(win, 'claude-1-onay');
      await m.locator('.modal-foot button', { hasText: 'Bağlantıyı aç' }).click();
      const setup = win.locator('.claude-setup-modal');
      await setup.waitFor({ timeout: 5000 });
      await setup.locator('button', { hasText: 'Claude Desktop\'a ekle' }).click();
      await setup.locator('.claude-result', { hasText: 'Install' }).waitFor({ timeout: 5000 });
      const json = await setup.locator('.claude-json').textContent();
      // Kurulum penceresi açıkken Claude çalışabilmeli (pencere "pasif"): düzenleme beklemeden yapılır
      client = await connectClient(SRC_SERVER, bridgeFile);
      const rot0 = await win.evaluate(async () => (await window.__pu.App.active.pageInfo(0)).rotate);
      const t0 = Date.now();
      const rr = await call(client, 'rotate_pages', { pages: '1', degrees: 180 });
      ok(rr, 'kurulum penceresi açıkken rotate_pages');
      assert(Date.now() - t0 < 5000, `kurulum penceresi açıkken düzenleme ${Date.now() - t0} ms bekledi`);
      assert(await setup.isVisible(), 'kurulum penceresi kapanmış');
      assert(await win.evaluate(async () => (await window.__pu.App.active.pageInfo(0)).rotate) === (rot0 + 180) % 360, 'döndürülmedi');
      ok(await call(client, 'undo', {}), 'undo');
      assert(await win.evaluate(async () => (await window.__pu.App.active.pageInfo(0)).rotate) === rot0, 'geri alınmadı');
      const cfg = JSON.parse(json);
      const srv = cfg.mcpServers['hermopdf'];
      assert(srv && srv.env.ELECTRON_RUN_AS_NODE === '1' && /server\.cjs$/.test(srv.args[0]), `elle kurulum: ${json}`);
      await shot(win, 'claude-2-kurulum');
      await setup.locator('.modal-foot button', { hasText: 'Tamam' }).click();
      const info = JSON.parse(fs.readFileSync(bridgeFile, 'utf8'));
      pipe = info.pipe;
      // Boru adı her açılışta rastgele
      assert(/^\\\\\.\\pipe\\hermopdf-claude-[0-9a-f]{24}$/.test(info.pipe) && info.protocol === 1 && /^[0-9a-f]{64}$/.test(info.token), `köprü dosyası: ${JSON.stringify({ ...info, token: '…' })}`);
      assert(await win.locator('#sb-claude').isVisible(), 'durum göstergesi yok');
      assert(/Claude: (açık|bağlı)/.test(await win.locator('#sb-claude').innerText()), 'durum metni');
      const saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
      assert(saved.claudeBridge === true, 'ayar kaydedilmedi');
    });

    await step('MCP istemcisi bağlanıyor, 19 araç listeleniyor, durum "bağlı"', async () => {
      if (!client) client = await connectClient(SRC_SERVER, bridgeFile);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const n of ['list_documents', 'read_text', 'search_text', 'render_page', 'rotate_pages', 'add_text', 'highlight_text', 'extract_pages', 'compress', 'mark_redaction', 'undo', 'save_document', 'open_pdf']) assert(names.includes(n), `araç yok: ${n}`);
      assert(names.length === 19, `${names.length} araç`);
      const r = await call(client, 'list_documents');
      ok(r, 'list_documents');
      await win.locator('#sb-claude', { hasText: 'Claude: bağlı' }).waitFor({ timeout: 5000 });
    });

    await step('list_documents: belge, sayfa sayısı, boyutlar', async () => {
      const r = await call(client, 'list_documents');
      ok(r, 'list_documents');
      const d = dataOf(r);
      const n = await win.evaluate(() => window.__pu.App.active.numPages);
      assert(d.documents.length === 1 && d.documents[0].pages === n && d.documents[0].active && d.documents[0].saved_to_disk, JSON.stringify(d));
      assert(d.documents[0].page_sizes_pt.length >= 1 && d.documents[0].page_sizes_pt[0].width > 100, 'sayfa boyutu');
      docId = d.documents[0].id;
    });

    await step('read_text ve search_text', async () => {
      const r = await call(client, 'read_text', { pages: '1' });
      ok(r, 'read_text');
      const t = textOf(r);
      assert(t.includes('=== Page 1 ==='), t.slice(0, 200));
      const words = (t.split('=== Page 1 ===')[1] || '').match(/[A-Za-zÇĞİÖŞÜçğıöşü]{5,}/g) || [];
      assert(words.length, '1. sayfada kelime yok');
      word = words[Math.min(2, words.length - 1)];
      const s = await call(client, 'search_text', { query: word });
      ok(s, 'search_text');
      const sd = dataOf(s);
      assert(sd.total >= 1 && sd.results[0].page >= 1 && sd.results[0].snippet.includes('['), JSON.stringify(sd).slice(0, 300));
      const none = dataOf(await call(client, 'search_text', { query: 'qzxqzxqzx-yok' }));
      assert(none.total === 0, 'olmayan kelime bulundu');
    });

    await step('render_page geçerli bir PNG döndürüyor', async () => {
      const r = await call(client, 'render_page', { page: 1, scale: 1 });
      ok(r, 'render_page');
      const img = r.content.find((c) => c.type === 'image');
      assert(img && img.mimeType === 'image/png', 'görüntü yok');
      const b = Buffer.from(img.data, 'base64');
      assert(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.length > 2000, `PNG değil (${b.length} bayt)`);
    });

    await step('rotate_pages + undo', async () => {
      const rot0 = await win.evaluate(async () => (await window.__pu.App.active.pageInfo(0)).rotate);
      const r = await call(client, 'rotate_pages', { pages: '1', degrees: 90 });
      ok(r, 'rotate_pages');
      const rot1 = await win.evaluate(async () => (await window.__pu.App.active.pageInfo(0)).rotate);
      assert(rot1 === (rot0 + 90) % 360, `dönüş ${rot0} → ${rot1}`);
      assert(await win.locator('.toast', { hasText: 'Claude:' }).count() > 0, 'Claude bildirimi yok');
      const u = await call(client, 'undo', {});
      ok(u, 'undo');
      assert(/^Claude: /.test(dataOf(u).undone), `geri alınan adım Claude etiketli değil: ${dataOf(u).undone}`);
      const rot2 = await win.evaluate(async () => (await window.__pu.App.active.pageInfo(0)).rotate);
      assert(rot2 === rot0, `geri alınmadı: ${rot2}`);
      assert(await win.locator('.toast', { hasText: 'Claude: geri alındı' }).count() > 0, 'geri alma bildirimi yok');
    });

    await step('add_text nesne ekliyor, undo kaldırıyor', async () => {
      const r = await call(client, 'add_text', { page: 1, x: 72, y: 72, text: 'Claude test yazısı', size: 14, color: '#d32f2f' });
      ok(r, 'add_text');
      const has = () => win.evaluate(() => window.__pu.App.active.pageObjs[0].some((o) => o.type === 'text' && o.text === 'Claude test yazısı' && o.color === '#d32f2f'));
      assert(await has(), 'yazı nesnesi yok');
      ok(await call(client, 'undo', { document_id: docId }), 'undo');
      assert(!(await has()), 'geri alınmadı');
    });

    await step('undo kullanıcının adımını (ör. uygulanmış karartma) geri almıyor', async () => {
      // Kullanıcı kendi adımını yapıyor (karartma uygulaması gibi yapısal bir adımın etiketini taklit eder)
      const n0 = await win.evaluate(() => {
        const d = window.__pu.App.active;
        d.addObj(0, { type: 'note', x: 300, y: 300, w: 20, h: 20, text: 'kullanıcı notu', color: '#f5c518' }, { label: 'Karartmayı uygula', select: false });
        return d.undoStack.length;
      });
      const r = await call(client, 'undo', { document_id: docId });
      assert(r.isError && /made by the user/.test(textOf(r)), `kullanıcının adımı geri alındı: ${textOf(r).slice(0, 200)}`);
      const st = await win.evaluate(() => { const d = window.__pu.App.active; return { n: d.undoStack.length, has: d.pageObjs[0].some((o) => o.text === 'kullanıcı notu') }; });
      assert(st.n === n0 && st.has, `kullanıcının adımı değişti: ${JSON.stringify(st)}`);
      await win.evaluate(() => window.__pu.App.active.undo());
    });

    await step('Bildirimdeki "Geri al" araya giren kullanıcı adımını geri almıyor', async () => {
      await win.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()));
      ok(await call(client, 'add_text', { page: 1, x: 100, y: 400, text: 'Bildirim testi' }), 'add_text');
      const btn = win.locator('.toast', { hasText: 'yazı eklendi' }).locator('.toast-act');
      await btn.waitFor({ timeout: 3000 });
      await win.evaluate(() => window.__pu.App.active.addObj(0, { type: 'note', x: 320, y: 320, w: 20, h: 20, text: 'araya giren', color: '#f5c518' }, { label: 'Nesne ekle', select: false }));
      await btn.click();
      await win.locator('.toast', { hasText: 'Ctrl+Z' }).waitFor({ timeout: 3000 });
      const st = await win.evaluate(() => { const o = window.__pu.App.active.pageObjs[0]; return { user: o.some((x) => x.text === 'araya giren'), claude: o.some((x) => x.text === 'Bildirim testi') }; });
      assert(st.user && st.claude, `yanlış adım geri alındı: ${JSON.stringify(st)}`);
      await win.evaluate(async () => { await window.__pu.App.active.undo(); await window.__pu.App.active.undo(); });
      const left = await win.evaluate(() => window.__pu.App.active.pageObjs[0].filter((x) => x.text === 'araya giren' || x.text === 'Bildirim testi').length);
      assert(left === 0, 'temizlenemedi');
    });

    await step('Sayfa araçları: insert_blank_page, move_pages (ve boş taşıma), delete_pages, goto_page, add_note', async () => {
      const info = () => win.evaluate(async () => {
        const d = window.__pu.App.active;
        const firstText = (await d.textContent(0)).items.map((i) => i.str).join('').slice(0, 40);
        return { n: d.numPages, cur: d.currentPageIndex, firstText, undo: d.undoStack.length, top: d.undoStack[d.undoStack.length - 1]?.label };
      });
      const a = await info();
      const ins = await call(client, 'insert_blank_page', { after_page: 0, size: 'A4', document_id: docId });
      ok(ins, 'insert_blank_page');
      const b = await info();
      assert(b.n === a.n + 1 && b.firstText === '' && b.top === 'Claude: boş sayfa ekle', `boş sayfa: ${JSON.stringify(b)}`);
      // boş sayfayı sona taşı → ilk sayfa yeniden eski ilk sayfa
      ok(await call(client, 'move_pages', { pages: '1', to: b.n + 1, document_id: docId }), 'move_pages');
      const c = await info();
      assert(c.n === b.n && c.firstText === a.firstText && /^Claude: /.test(c.top), `taşıma: ${JSON.stringify(c)}`);
      // sırası değişmeyen taşıma hiçbir şey yapmaz, geri alma yığınına adım eklemez
      const noop = await call(client, 'move_pages', { pages: '1', to: 1, document_id: docId });
      ok(noop, 'boş move_pages');
      assert(dataOf(noop).changed === false && (await info()).undo === c.undo, 'boş taşıma adım ekledi');
      ok(await call(client, 'delete_pages', { pages: String(c.n), document_id: docId }), 'delete_pages');
      const e = await info();
      assert(e.n === a.n && e.firstText === a.firstText && /^Claude: /.test(e.top), `silme: ${JSON.stringify(e)}`);
      if (a.n >= 2) {
        ok(await call(client, 'goto_page', { page: 2, document_id: docId }), 'goto_page');
        await win.waitForFunction(() => window.__pu.App.active.currentPageIndex === 1, null, { timeout: 5000 });
        await call(client, 'goto_page', { page: 1, document_id: docId });
      }
      const note = await call(client, 'add_note', { page: 1, x: 50, y: 50, text: 'Claude notu', document_id: docId });
      ok(note, 'add_note');
      assert(await win.evaluate(() => window.__pu.App.active.pageObjs[0].some((o) => o.type === 'note' && o.text === 'Claude notu')), 'not yok');
      // dört adımı geri al (not, silme, taşıma, ekleme): belge başlangıçtaki hâline döner
      for (let k = 0; k < 4; k++) ok(await call(client, 'undo', { document_id: docId }), `undo ${k + 1}`);
      const f = await info();
      assert(f.n === a.n && f.undo === a.undo && f.firstText === a.firstText, `geri alma sonrası: ${JSON.stringify(f)}`);
    });

    await step('highlight_text düzenlenebilir vurgu nesneleri ekliyor', async () => {
      const r = await call(client, 'highlight_text', { query: word });
      ok(r, 'highlight_text');
      const d = dataOf(r);
      const n = await win.evaluate(() => window.__pu.App.active.pageObjs.flat().filter((o) => o.type === 'markup' && o.kind === 'highlight').length);
      assert(d.highlighted >= 1 && n === d.highlighted, `vurgu ${d.highlighted} / nesne ${n}`);
    });

    await step('mark_redaction yalnızca işaretliyor (uygulanmıyor, dosya aynı)', async () => {
      const r = await call(client, 'mark_redaction', { query: word, pages: '1' });
      ok(r, 'mark_redaction');
      const d = dataOf(r);
      assert(d.marked >= 1 && d.applied === false, JSON.stringify(d));
      const n = await win.evaluate(() => window.__pu.App.active.pageObjs[0].filter((o) => o.type === 'redact').length);
      assert(n >= 1, 'karartma işareti yok');
      const still = await win.evaluate(async (w) => { const tc = await window.__pu.App.active.textContent(0); return tc.items.map((i) => i.str).join(' ').includes(w); }, word);
      assert(still, 'yazı belgeden silinmiş (karartma uygulanmış)');
      assert(sha(pdf) === origHash, 'dosya diske yazılmış');
    });

    await step('extract_pages yeni, kaydedilmemiş sekme açıyor', async () => {
      const before = await win.evaluate(() => window.__pu.App.docs.length);
      const r = await call(client, 'extract_pages', { pages: '1', document_id: docId });
      ok(r, 'extract_pages');
      const d = dataOf(r);
      const info = await win.evaluate((id) => { const x = window.__pu.App.docs.find((k) => k.id === id); return x && { n: x.numPages, dirty: x.dirty, path: x.path }; }, d.new_document_id);
      assert(info && info.n === 1 && info.dirty && !info.path, JSON.stringify(info));
      assert(await win.evaluate(() => window.__pu.App.docs.length) === before + 1, 'sekme sayısı');
    });

    await step('compress küçük ya da eşit; küçüldüyse yeni sekme', async () => {
      const before = await win.evaluate(() => window.__pu.App.docs.length);
      const r = await call(client, 'compress', { level: 'medium', document_id: docId });
      ok(r, 'compress');
      const d = dataOf(r);
      assert(d.after_bytes <= d.before_bytes || d.new_document_id === null, JSON.stringify(d));
      const after = await win.evaluate(() => window.__pu.App.docs.length);
      if (d.new_document_id) assert(after === before + 1 && d.after_bytes < d.before_bytes, `sekme ${before}→${after}`);
      else assert(after === before, 'gereksiz sekme açıldı');
      assert(sha(pdf) === origHash, 'özgün dosya değişti');
      console.log(`    (küçültme: ${d.before_bytes} → ${d.after_bytes} bayt, ${d.level})`);
    });

    await step('Geçersiz istekler hata döndürüyor, uygulama sağlam kalıyor', async () => {
      const bad = [
        ['render_page', { page: 9999, document_id: docId }],
        ['rotate_pages', { pages: '0-2', document_id: docId }],
        ['rotate_pages', { pages: '1', degrees: 45, document_id: docId }],
        ['delete_pages', { pages: 'all', document_id: docId }],
        ['add_text', { page: 1, x: -5, y: 10, text: 'x', document_id: docId }],
        ['add_text', { page: 1, x: 10, y: 10, text: 'x', color: 'red', document_id: docId }],
        ['read_text', { document_id: 'yok-boyle-belge' }],
        ['search_text', { query: '', document_id: docId }],
        ['open_pdf', { path: 'C:\\Windows\\win.ini' }],
        ['open_pdf', { path: '\\\\sunucu\\pay\\a.pdf' }],
        ['move_pages', { pages: '1', to: 0, document_id: docId }],
      ];
      for (const [name, args] of bad) {
        const r = await call(client, name, args);
        assert(r.isError, `${name} ${JSON.stringify(args)} hata vermedi: ${textOf(r).slice(0, 200)}`);
      }
      const n = await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).numPages, docId);
      assert(n >= 1, 'sayfalar silinmiş');
      ok(await call(client, 'list_documents'), 'sonrasında list_documents');
      const pe = logs.filter((l) => l.startsWith('[pageerror]'));
      assert(!pe.length, pe.join('\n'));
    });

    await step('Ham boru: uygulamanın kendi doğrulaması geçersiz değerleri reddediyor (MCP şeması atlanınca)', async () => {
      const bad = [
        ['add_text', { page: 1, x: -5, y: 10, text: 'x', document_id: docId }],
        ['add_text', { page: 1, x: 10, y: 10, text: 'x', color: 'red', document_id: docId }],
        ['add_text', { page: 1, x: 10, y: 10, text: '   ', document_id: docId }],
        ['move_pages', { pages: '1', to: 0, document_id: docId }],
        ['search_text', { query: '', document_id: docId }],
        ['rotate_pages', { pages: '1', degrees: 45, document_id: docId }],
        ['rotate_pages', { pages: '1-x', document_id: docId }],
        ['render_page', { page: 1.5, document_id: docId }],
        ['render_page', { page: 1, scale: 9, document_id: docId }],
        ['insert_blank_page', { size: 'A9', document_id: docId }],
        ['highlight_text', { query: 'a', style: 'blink', document_id: docId }],
        ['ocr_pages', { lang: 'deu', document_id: docId }],
        ['open_pdf', { path: 'belge.pdf' }],
        ['open_pdf', { path: 'C:\\Windows\\win.ini' }],
        ['read_text', { document_id: 123 }],
      ];
      const n0 = await win.evaluate((id) => { const d = window.__pu.App.docs.find((k) => k.id === id); return d.undoStack.length; }, docId);
      const { hello, replies } = await rawSession(pipe, tokenOf(bridgeFile), bad);
      assert(hello.ok, 'hello reddedildi');
      bad.forEach(([m, p], k) => {
        const r = replies.get(k + 1);
        assert(r && r.error && r.error.code === 'invalid_params', `${m} ${JSON.stringify(p)} → ${JSON.stringify(r).slice(0, 200)}`);
      });
      const n1 = await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).undoStack.length, docId);
      assert(n1 === n0, 'geçersiz istek belgeyi değiştirdi');
    });

    // OCR Pro özelliğidir (12 Kas 2026): bu test ücretsiz modda çalışır; Claude'un isteği yükseltme penceresi de açmaz
    await step('Ham boru: Pro yokken ocr_pages reddedilir (pro_required), belge değişmez, pencere açılmaz', async () => {
      const n0 = await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).undoStack.length, docId);
      const { hello, replies } = await rawSession(pipe, tokenOf(bridgeFile), [['ocr_pages', { document_id: docId }]]);
      assert(hello.ok, 'hello reddedildi');
      const r = replies.get(1);
      assert(r && r.error && r.error.code === 'pro_required', `ocr_pages → ${JSON.stringify(r).slice(0, 200)}`);
      const n1 = await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).undoStack.length, docId);
      assert(n1 === n0, 'ocr_pages belgeyi değiştirdi');
      assert(!(await win.$('.pro-modal')), 'Claude isteği yükseltme penceresi açtı');
    });

    await step(`Tanıtılmamış ${MAX_UNAUTHED}+ bağlantı Claude'u dışarıda bırakamıyor`, async () => {
      const squatters = [];
      for (let k = 0; k < MAX_UNAUTHED + 2; k++) {
        const s = net.connect(pipe);
        s.on('error', () => {});
        await new Promise((res) => { s.once('connect', res); s.once('close', res); });
        squatters.push(s);
      }
      await sleep(200);
      const { hello, replies } = await rawSession(pipe, tokenOf(bridgeFile), [['ping', {}]]);
      assert(hello.ok && replies.get(1)?.result?.text === 'pong', `yeni Claude bağlantısı reddedildi: ${JSON.stringify(hello)}`);
      ok(await call(client, 'list_documents'), 'mevcut Claude bağlantısı');
      const closed = squatters.filter((s) => s.destroyed || s.readyState === 'closed' || !s.writable).length;
      squatters.forEach((s) => s.destroy());
      assert(closed >= 2, `en eski tanıtılmamış bağlantılar kapatılmadı (${closed})`);
    });

    await step('Yanlış anahtar reddediliyor (ham boru ve MCP sunucusu)', async () => {
      const r = await rawPipe(pipe, JSON.stringify({ type: 'hello', token: 'yanlis-anahtar' }));
      assert(/"ok":false/.test(r.buf) && r.closed, `ham: ${JSON.stringify(r)}`);
      const r2 = await rawPipe(pipe, JSON.stringify({ id: 1, method: 'list_documents', params: {} }));
      assert(/"ok":false/.test(r2.buf) && r2.closed, `hello'suz istek: ${JSON.stringify(r2)}`);
      const fake = path.join(work, 'sahte-kopru.json');
      const info = JSON.parse(fs.readFileSync(bridgeFile, 'utf8'));
      fs.writeFileSync(fake, JSON.stringify({ ...info, token: crypto.randomBytes(32).toString('hex') }));
      const c = await connectClient(SRC_SERVER, fake);
      try {
        const x = await call(c, 'list_documents');
        assert(x.isError && /reddetti/.test(textOf(x)) && /rejected/.test(textOf(x)), textOf(x));
      } finally { await c.close(); }
    });

    await step('save_document: İptal → dosya değişmedi', async () => {
      const p = call(client, 'save_document', { document_id: docId });
      const m = win.locator('.claude-save-modal');
      await m.waitFor({ timeout: 10000 });
      const txt = await m.innerText();
      assert(txt.includes('Claude bu belgeyi kaydetmek istiyor') && txt.includes('Karartma henüz uygulanmadı'), txt);
      await shot(win, 'claude-3-kaydet');
      await m.locator('.modal-foot button', { hasText: 'İptal' }).click();
      const r = await p;
      ok(r, 'save_document');
      const d = dataOf(r);
      assert(d.saved === false, JSON.stringify(d));
      assert(sha(pdf) === origHash, 'dosya değişti');
      await win.locator('.claude-save-modal').waitFor({ state: 'detached', timeout: 5000 });
    });

    await step('save_document: Kaydet onayı → dosya geçici klasörde yazıldı', async () => {
      const p = call(client, 'save_document', { document_id: docId });
      const m = win.locator('.modal-backdrop:not(.out) .claude-save-modal');
      await m.waitFor({ timeout: 10000 });
      await m.locator('.modal-foot button', { hasText: /^Kaydet$/ }).click();
      const r = await p;
      ok(r, 'save_document');
      const d = dataOf(r);
      assert(d.saved === true && d.choice === 'saved', JSON.stringify(d));
      assert(sha(pdf) !== origHash && fs.readFileSync(pdf).subarray(0, 5).toString() === '%PDF-', 'dosya yazılmadı');
      const dirty = await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).dirty, docId);
      assert(!dirty, 'kaydedildikten sonra hâlâ değişmiş görünüyor');
    });

    await step('Otomatik kaydet açıkken Claude\'un değişikliği diske yazılmıyor; kullanıcının kaydı yeniden açıyor', async () => {
      await win.evaluate(async () => { const a = await import('./js/app.js'); a.setAutoSave(true); });
      const h0 = sha(pdf);
      ok(await call(client, 'add_text', { page: 1, x: 80, y: 500, text: 'Otomatik kaydet testi', document_id: docId }), 'add_text');
      await win.locator('.toast', { hasText: 'otomatik kaydet duraklatıldı' }).waitFor({ timeout: 3000 });
      await sleep(4500); // otomatik kaydet 2,5 sn sonra çalışır
      assert(sha(pdf) === h0, 'Claude\'un değişikliği otomatik kaydedildi');
      assert(await win.locator('.claude-save-modal').count() === 0, 'kaydetme penceresi açıldı');
      const st = await win.evaluate((id) => { const d = window.__pu.App.docs.find((k) => k.id === id); return { dirty: d.dirty, hold: d.claudeHold }; }, docId);
      assert(st.dirty && st.hold, JSON.stringify(st));
      // Claude'un undo'su da otomatik kaydedilmez
      ok(await call(client, 'undo', { document_id: docId }), 'undo');
      await sleep(3500);
      assert(sha(pdf) === h0, 'Claude\'un geri alması otomatik kaydedildi');
      // Kullanıcı kendisi kaydedince otomatik kaydet bu belge için yeniden çalışır
      await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).save(), docId);
      const h1 = sha(pdf);
      await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).addObj(0, { type: 'note', x: 400, y: 400, w: 20, h: 20, text: 'kullanıcı', color: '#f5c518' }, { label: 'Nesne ekle', select: false }), docId);
      const t0 = Date.now();
      while (sha(pdf) === h1 && Date.now() - t0 < 8000) await sleep(250);
      assert(sha(pdf) !== h1, 'kullanıcının kendi değişikliği otomatik kaydedilmedi');
      await win.evaluate(async () => { const a = await import('./js/app.js'); a.setAutoSave(false); });
    });

    await step('open_pdf: onay penceresi → İptal açmıyor, Aç açıyor', async () => {
      const n0 = await win.evaluate(() => window.__pu.App.docs.length);
      let p = call(client, 'open_pdf', { path: pdf2Path });
      let m = win.locator('.modal-backdrop:not(.out) .claude-open-modal');
      await m.waitFor({ timeout: 10000 });
      assert((await m.innerText()).toLowerCase().includes(pdf2Path.toLowerCase()), 'pencerede dosya yolu yok');
      await shot(win, 'claude-5-ac');
      await m.locator('.modal-foot button', { hasText: 'İptal' }).click();
      let r = await p;
      ok(r, 'open_pdf iptal');
      assert(dataOf(r).opened === false && await win.evaluate(() => window.__pu.App.docs.length) === n0, 'iptal edilen dosya açıldı');
      p = call(client, 'open_pdf', { path: pdf2Path });
      m = win.locator('.modal-backdrop:not(.out) .claude-open-modal');
      await m.waitFor({ timeout: 10000 });
      await m.locator('.modal-foot button', { hasText: /^Aç$/ }).click();
      r = await p;
      ok(r, 'open_pdf');
      const d = dataOf(r);
      assert(d.document_id && d.pages >= 1 && await win.evaluate(() => window.__pu.App.docs.length) === n0 + 1, JSON.stringify(d));
      const nf = await call(client, 'open_pdf', { path: path.join(work, 'yok', 'olmayan.pdf') });
      assert(nf.isError && /No such PDF/.test(textOf(nf)), textOf(nf));
      await win.evaluate((id) => { const x = window.__pu.App.docs.find((k) => k.id === id); x.dirty = false; return window.__pu.App.closeDoc(x, { force: true }); }, d.document_id);
    });

    await step('Zaman aşımı: sırada bekleyen düzenleme iptal ediliyor, sonradan uygulanmıyor', async () => {
      await win.evaluate(async () => { const u = await import('./js/util.js'); u.confirmBox('Engelleyen pencere', { title: 'Test' }); });
      const t0 = Date.now();
      const r = await call(client, 'add_note', { page: 1, x: 60, y: 60, text: 'Geç kalan not', document_id: docId });
      assert(r.isError && /did not finish in time/.test(textOf(r)), textOf(r).slice(0, 200));
      assert(Date.now() - t0 < NOTE_TIMEOUT + 3000, `zaman aşımı geç geldi (${Date.now() - t0} ms)`);
      await sleep(500);
      await win.locator('.modal-backdrop:not(.out) .modal-foot button', { hasText: 'Vazgeç' }).click();
      await sleep(1500);
      const late = await win.evaluate(() => window.__pu.App.docs.some((d) => d.pageObjs.flat().some((o) => o.text === 'Geç kalan not')));
      assert(!late, 'zaman aşımına uğrayan not sonradan eklendi');
    });

    await step('Zaman aşımı: yanıtlanmayan kaydetme penceresi kapanıyor, dosya yazılmıyor', async () => {
      await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).addObj(0, { type: 'note', x: 420, y: 420, w: 20, h: 20, text: 'kirli', color: '#f5c518' }, { label: 'Nesne ekle', select: false }), docId);
      const h0 = sha(pdf);
      const p = call(client, 'save_document', { document_id: docId });
      await win.locator('.modal-backdrop:not(.out) .claude-save-modal').waitFor({ timeout: 5000 });
      const r = await p;
      assert(r.isError && /withdrawn/.test(textOf(r)), textOf(r).slice(0, 200));
      await win.locator('.claude-save-modal').waitFor({ state: 'detached', timeout: 3000 });
      assert(sha(pdf) === h0, 'dosya yazıldı');
      assert(await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).dirty, docId), 'belge kirli değil');
      await win.evaluate((id) => window.__pu.App.docs.find((k) => k.id === id).undo(), docId);
    });

    await step('Beklerken kapatılan sekmeye "başarılı" denmiyor', async () => {
      const ex = dataOf(await call(client, 'extract_pages', { pages: '1', document_id: docId }));
      await win.evaluate(async () => { const u = await import('./js/util.js'); u.confirmBox('Engelleyen pencere', { title: 'Test' }); });
      const p = call(client, 'add_note', { page: 1, x: 30, y: 30, text: 'kapanan sekme', document_id: ex.new_document_id });
      await sleep(600);
      await win.evaluate((id) => { const x = window.__pu.App.docs.find((k) => k.id === id); x.dirty = false; return window.__pu.App.closeDoc(x, { force: true }); }, ex.new_document_id);
      await win.locator('.modal-backdrop:not(.out) .modal-foot button', { hasText: 'Vazgeç' }).click();
      const r = await p;
      assert(r.isError && /was closed/.test(textOf(r)), textOf(r).slice(0, 200));
    });

    await step('esbuild paketi (server.cjs) Node ile ve ELECTRON_RUN_AS_NODE ile çalışıyor', async () => {
      const c = await connectClient(BUNDLE, bridgeFile);
      try {
        const { tools } = await c.listTools();
        assert(tools.length === 19, `${tools.length} araç`);
        const r = await call(c, 'list_documents');
        ok(r, 'paket list_documents');
        assert(dataOf(r).documents.length >= 2, 'belge listesi');
      } finally { await c.close(); }
      const c2 = await connectClient(BUNDLE, bridgeFile, { command: require('electron'), extraEnv: { ELECTRON_RUN_AS_NODE: '1' } });
      try {
        ok(await call(c2, 'list_documents'), 'Electron-as-Node list_documents');
      } finally { await c2.close(); }
    });

    await step('Durum panelinde günlük var; "Bağlantıyı kapat" → dostça hata, köprü dosyası silindi', async () => {
      await win.click('#sb-claude');
      const m = win.locator('.claude-panel');
      await m.waitFor({ timeout: 5000 });
      assert(await m.locator('.claude-log-row').count() >= 5, 'günlük boş');
      await shot(win, 'claude-4-panel');
      await m.locator('.modal-foot button', { hasText: 'Bağlantıyı kapat' }).click();
      await win.locator('#sb-claude').waitFor({ state: 'hidden', timeout: 5000 });
      assert(!fs.existsSync(bridgeFile), 'köprü dosyası duruyor');
      const r = await call(client, 'list_documents');
      assert(r.isError && /Claude bağlantısını açın/.test(textOf(r)), textOf(r));
      assert((await rawPipe(pipe, null)).error, 'boru hâlâ açık');
      const saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
      assert(saved.claudeBridge === false, 'ayar kapalı kaydedilmedi');
    });

    await step('Yeniden açılıp uygulama kapanınca: dostça hata, köprü dosyası silindi', async () => {
      await win.click('[data-tab="tools"]');
      await win.click('[data-action="claude.connect"]');
      const m = win.locator('.modal', { hasText: 'Ne paylaşılır?' });
      await m.waitFor({ timeout: 5000 });
      await m.locator('.modal-foot button', { hasText: 'Bağlantıyı aç' }).click();
      const setup = win.locator('.claude-setup-modal');
      await setup.waitFor({ timeout: 5000 });
      await setup.locator('.modal-foot button', { hasText: 'Tamam' }).click();
      assert(pipeOf(bridgeFile) !== pipe, 'yeniden açılışta boru adı değişmedi');
      ok(await call(client, 'list_documents'), 'yeniden bağlanma (yeni anahtar, yeni boru)');
      // kaydedilmemiş sekmeler kapanışı sormasın
      await win.evaluate(() => window.__pu.App.docs.forEach((d) => { d.dirty = false; }));
      await app.close();
      app = null;
      await sleep(500);
      assert(!fs.existsSync(bridgeFile), 'kapanınca köprü dosyası silinmedi');
      const r = await call(client, 'list_documents');
      assert(r.isError && /HermoPDF/.test(textOf(r)) && /open HermoPDF/i.test(textOf(r)), textOf(r));
    });
  } finally {
    if (client) await client.close().catch(() => {});
    if (app) await app.close().catch(() => {});
  }

  const okN = results.filter((r) => r.ok).length;
  console.log(`\n${okN}/${results.length} adım başarılı`);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* yoksay */ }
  process.exit(okN === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
