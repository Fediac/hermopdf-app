#!/usr/bin/env node
// dist/ klasörünü http://localhost:4173 adresinde sunar. Cloudflare Pages davranışını yaklaşık taklit eder:
// _headers (CSP dahil) ve _redirects uygulanır, klasörler index.html'e, bulunamayanlar 404.html'e gider.
//   node serve.mjs [--port 4173]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const pi = process.argv.indexOf('--port');
const PORT = pi > -1 ? Number(process.argv[pi + 1]) : Number(process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
};

function parseHeaders() {
  const f = path.join(DIST, '_headers');
  if (!fs.existsSync(f)) return [];
  const rules = [];
  let cur = null;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const re = new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      cur = { re, set: [], unset: [] };
      rules.push(cur);
    } else if (cur) {
      const t = line.trim();
      if (t.startsWith('!')) cur.unset.push(t.slice(1).trim().toLowerCase());
      else { const i = t.indexOf(':'); cur.set.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]); }
    }
  }
  return rules;
}
function parseRedirects() {
  const f = path.join(DIST, '_redirects');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => {
    const [from, to, code = '302'] = l.trim().split(/\s+/);
    return { from, to, code: Number(code) };
  });
}

function headersFor(urlPath) {
  const out = {};
  for (const r of parseHeaders()) {
    if (!r.re.test(urlPath)) continue;
    for (const u of r.unset) delete out[u];
    for (const [k, v] of r.set) out[k.toLowerCase()] = out[k.toLowerCase()] && k.toLowerCase() !== 'content-security-policy' ? `${out[k.toLowerCase()]}, ${v}` : v;
  }
  return out;
}

function resolveFile(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const full = path.join(DIST, clean);
  if (!full.startsWith(DIST)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    const idx = path.join(full, 'index.html');
    return fs.existsSync(idx) ? idx : null;
  }
  return fs.existsSync(full) ? full : null;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let p = u.pathname;
  if (p.split('/').includes('..')) { res.writeHead(400).end('bad path'); return; }
  for (const r of parseRedirects()) {
    let target = null;
    if (r.from.endsWith('/*') && p.startsWith(r.from.slice(0, -1))) target = r.to.replace(':splat', p.slice(r.from.length - 1));
    else if (r.from === p) target = r.to;
    if (target) { res.writeHead(r.code, { Location: target + u.search }).end(); return; }
  }
  // Cloudflare Pages gibi: klasör adresine sondaki / eklenir.
  if (!p.endsWith('/') && !path.extname(p)) {
    const dir = path.join(DIST, p);
    if (fs.existsSync(path.join(dir, 'index.html'))) { res.writeHead(308, { Location: p + '/' + u.search }).end(); return; }
  }
  let file = resolveFile(p);
  let status = 200;
  if (!file || path.basename(file).startsWith('_')) {
    status = 404;
    // Cloudflare Pages gibi: dil önekindeki 404.html (/tr/404.html), yoksa kökteki (İngilizce).
    const seg = p.split('/')[1] || '';
    const local = seg && /^[a-z-]+$/.test(seg) ? path.join(DIST, seg, '404.html') : '';
    file = local && fs.existsSync(local) ? local : path.join(DIST, '404.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end('404'); return; }
  }
  const h = headersFor(p);
  h['content-type'] = h['content-type'] || TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (!h['cache-control']) h['cache-control'] = 'no-cache';
  // Video için bayt aralığı (Cloudflare gibi): tarayıcı moov kutusunu dosya sonundan okuyabilsin.
  const range = status === 200 && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const size = fs.statSync(file).size;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
    res.writeHead(206, { ...h, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  if (status === 200) h['accept-ranges'] = 'bytes';
  res.writeHead(status, h);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT, '127.0.0.1', () => console.log(`HermoPDF sitesi: http://127.0.0.1:${PORT}/  (Ctrl+C ile durdur)`));
