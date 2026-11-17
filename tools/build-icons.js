// Kullanılan lucide ikonlarını tek bir JS modülüne gömer (paketlenen uygulama lucide-static'e ihtiyaç duymasın).
const fs = require('fs');
const path = require('path');

const NAMES = `folder-open save save-all printer undo-2 redo-2 mouse-pointer-2 hand zoom-in zoom-out type text-cursor-input
pencil-line highlighter underline strikethrough square circle minus move-up-right signature stamp image image-plus eraser
square-dashed scan-text crop scissors combine file-plus file-minus files trash-2 rotate-ccw rotate-cw copy clipboard-copy
file-output lock lock-open shield file-text file-image file-type shrink search chevron-left chevron-right chevron-down
chevron-up chevrons-left chevrons-right x plus sun moon maximize presentation volume-2 sticky-note check dot list-ordered
droplets panel-left layout-grid bookmark info settings square-check menu file-lock scan arrow-up-right align-left
align-center align-right bold italic bring-to-front send-to-back copy-plus grip-vertical file-down clock book-open
scroll-text maximize-2 move-horizontal panel-top panel-bottom calendar badge-check file-key file-archive wand-sparkles
keyboard circle-help external-link folder image-down file-pen-line pen-line text-select list rectangle-horizontal
file-scan flip-vertical-2 square-x circle-check languages file-stack eye eye-off square-mouse-pointer
ellipsis-vertical upload pipette file-question file-badge minimize-2 file-symlink panel-left-close sparkles gauge
circle-x triangle-alert loader-circle arrow-left arrow-right file x-circle table-2 file-spreadsheet file-code
spell-check layers pen brush square-split-horizontal copy-check file-heart bot unplug history
crown key-round refresh-cw bell download workflow play arrow-up arrow-down pencil`.split(/\s+/).filter(Boolean);

const dir = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
const out = {};
const missing = [];
for (const n of NAMES) {
  const f = path.join(dir, `${n}.svg`);
  if (!fs.existsSync(f)) { missing.push(n); continue; }
  const svg = fs.readFileSync(f, 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
  out[n] = inner;
}
if (missing.length) console.warn('Eksik ikonlar:', missing.join(', '));
const js = `// Otomatik üretildi: tools/build-icons.js (lucide-static, ISC lisansı)\nexport const ICONS = ${JSON.stringify(out, null, 0)};\n` +
  `export function icon(name, cls = '') {\n  const inner = ICONS[name] || ICONS['file'];\n  return \`<svg class="ic \${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\${inner}</svg>\`;\n}\n`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'icons.js'), js);
console.log('ikon sayısı:', Object.keys(out).length);
