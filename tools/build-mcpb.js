// Claude Desktop için tek tıkla kurulan MCP paketi (.mcpb) üretir: dist-mcpb/hermopdf.mcpb
// 1) sunucuyu esbuild ile tek dosyaya paketler  2) araç listesini sunucunun kendisinden okur
// 3) manifest.json yazar  4) "mcpb validate" ve "mcpb pack" çalıştırır. Çalıştır: npm run mcpb
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { buildMcp } = require('./build-mcp');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const OUT_DIR = path.join(ROOT, 'dist-mcpb');
const STAGE = path.join(OUT_DIR, 'stage');
const OUT = path.join(OUT_DIR, 'hermopdf.mcpb');
const MCPB_CLI = path.join(ROOT, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');

// Araç adları ve açıklamaları manifest'e sunucunun kendisinden gelsin (elle tutulan liste eskimesin)
async function listTools(serverFile) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport, getDefaultEnvironment } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverFile],
    env: { ...getDefaultEnvironment(), ULTRONIX_BRIDGE_FILE: path.join(os.tmpdir(), 'ultronpdf-mcpb-build-none.json') },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'hermopdf-mcpb-build', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description.split(/(?<=\.)\s/)[0] }));
  } finally {
    await client.close();
  }
}

function run(args) {
  const r = spawnSync(process.execPath, [MCPB_CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) throw new Error(`mcpb ${args[0]} başarısız (çıkış kodu ${r.status})`);
}

async function main() {
  const server = await buildMcp();
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGE, 'server'), { recursive: true });
  fs.copyFileSync(server, path.join(STAGE, 'server', 'index.cjs'));
  fs.copyFileSync(path.join(ROOT, 'build', 'icon-512.png'), path.join(STAGE, 'icon.png'));
  const tools = await listTools(path.join(STAGE, 'server', 'index.cjs'));
  const manifest = {
    // @anthropic-ai/mcpb 2.1.2: schemas/mcpb-manifest-latest.schema.json → "0.3" (0.4 yalnızca deneysel uv çalışma zamanı için)
    manifest_version: '0.3',
    name: 'hermopdf',
    display_name: 'HermoPDF',
    version: pkg.version,
    description: 'HermoPDF\'te açık belgelerinizi Claude ile okuyun ve düzenleyin. Bilgisayarınızdaki HermoPDF\'e yerel olarak bağlanır.',
    long_description: [
      'HermoPDF, bilgisayarınızda çalışan ücretsiz bir PDF düzenleyicidir. Bu eklenti Claude\'un, HermoPDF\'te açık belgeleri okumasını ve düzenlemesini sağlar: metni okuma, arama, sayfa görüntüsü, döndürme, silme, taşıma, sayfa çıkarma, yazı ve not ekleme, vurgulama, küçültme, OCR ve karartma işaretleme.',
      'Çalışması için HermoPDF açık olmalı ve içinde Claude bağlantısı (Araçlar → "Claude\'a bağla") açılmış olmalıdır. Eklenti yalnızca bu bilgisayardaki HermoPDF\'e bağlanır ve kendisi internete çıkmaz. Claude\'un araçlarla okuduğu içerik (sayfa metni, sayfa görüntüleri, arama sonuçları, belge adları) Claude sohbetinizin parçası olarak Anthropic\'e gider.',
      'Her değişiklik HermoPDF\'te geri alınabilir; Claude yalnızca kendi değişikliklerini geri alabilir. Claude dosyanın üzerine kendi başına kaydedemez, karartmayı uygulayamaz ve başka bir PDF dosyasını sormadan açamaz; bunlar her zaman kullanıcının onayıyla olur. Otomatik kaydet açık olsa bile Claude\'un değiştirdiği belge, kullanıcı kaydedene kadar diske yazılmaz.',
    ].join('\n\n'),
    author: { name: pkg.author || 'Fediac' },
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/index.cjs',
      mcp_config: { command: 'node', args: ['${__dirname}/server/index.cjs'] },
    },
    tools,
    keywords: ['pdf', 'ocr', 'hermopdf', 'türkçe', 'editor'],
    compatibility: { platforms: ['win32'], runtimes: { node: '>=18.0.0' } },
  };
  fs.writeFileSync(path.join(STAGE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest.json yazıldı (${tools.length} araç)`);
  run(['validate', path.join(STAGE, 'manifest.json')]);
  fs.rmSync(OUT, { force: true });
  run(['pack', STAGE, OUT]);
  if (!fs.existsSync(OUT)) throw new Error('.mcpb dosyası oluşmadı');
  console.log(`Hazır: ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
