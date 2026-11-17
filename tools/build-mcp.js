// Claude için yerel MCP sunucusunu (src/mcp/server.mjs) tek dosyaya paketler: build/mcp/server.cjs
// Böylece ne .mcpb paketine ne de uygulamaya node_modules girer. Çalıştır: npm run mcp:build
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const OUT = path.join(ROOT, 'build', 'mcp', 'server.cjs');

async function buildMcp() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'mcp', 'server.mjs')],
    outfile: OUT,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    minify: true,
    legalComments: 'eof', // MIT lisans notları (MCP SDK, zod vb.) dosyanın sonunda kalır
    define: { __ULTRONIX_VERSION__: JSON.stringify(pkg.version) },
    logLevel: 'warning',
    metafile: true,
  });
  const size = fs.statSync(OUT).size;
  console.log(`MCP sunucusu paketlendi: ${path.relative(ROOT, OUT)} (${(size / 1024).toFixed(0)} KB)`);
  if (r.warnings.length) console.log(`${r.warnings.length} uyarı`);
  return OUT;
}

module.exports = { buildMcp, OUT };

if (require.main === module) {
  buildMcp().catch((e) => { console.error(e); process.exit(1); });
}
