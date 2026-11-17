// Ekran (SVG) ve PDF çıktısında ortak kullanılan geometri yardımcıları. Tüm koordinatlar nokta (pt), sol üst başlangıçlı.

export const SYMBOL_PATHS = {
  // 0..1 birim kutu
  check: 'M 0.12 0.55 L 0.4 0.82 L 0.9 0.18',
  cross: 'M 0.18 0.18 L 0.82 0.82 M 0.82 0.18 L 0.18 0.82',
};

export function smoothPath(pts) {
  // pts: [x0,y0,x1,y1,...]
  const n = pts.length / 2;
  if (n === 0) return '';
  const f = (v) => +v.toFixed(2);
  if (n === 1) return `M ${f(pts[0])} ${f(pts[1])} L ${f(pts[0] + 0.01)} ${f(pts[1] + 0.01)}`;
  if (n === 2) return `M ${f(pts[0])} ${f(pts[1])} L ${f(pts[2])} ${f(pts[3])}`;
  let d = `M ${f(pts[0])} ${f(pts[1])}`;
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    const nx = pts[(i + 1) * 2], ny = pts[(i + 1) * 2 + 1];
    d += ` Q ${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  d += ` L ${f(pts[(n - 1) * 2])} ${f(pts[(n - 1) * 2 + 1])}`;
  return d;
}

// Çok yakın noktaları ayıkla (çizim akıcılığı ve dosya boyutu için)
export function simplify(pts, minDist = 0.6) {
  if (pts.length <= 4) return pts;
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i] - out[out.length - 2];
    const dy = pts[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= minDist * minDist || i === pts.length - 2) out.push(pts[i], pts[i + 1]);
  }
  return out;
}

export function arrowGeometry(x1, y1, x2, y2, sw) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const L = Math.min(Math.max(8, sw * 4.5), len * 0.6 || 8);
  const W = L * 0.5;
  const bx = x2 - Math.cos(ang) * L;
  const by = y2 - Math.sin(ang) * L;
  const px = -Math.sin(ang) * W;
  const py = Math.cos(ang) * W;
  return { lineEnd: [bx, by], head: [x2, y2, bx + px, by + py, bx - px, by - py] };
}

export function lineBox(o) {
  const pad = Math.max((o.sw || 2) * 5, 8);
  const x = Math.min(o.x1, o.x2) - pad;
  const y = Math.min(o.y1, o.y2) - pad;
  return { x, y, w: Math.abs(o.x2 - o.x1) + pad * 2, h: Math.abs(o.y2 - o.y1) + pad * 2 };
}

export function pointsBox(paths, sw = 2) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) {
    for (let i = 0; i < p.length; i += 2) {
      minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
      minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
    }
  }
  const pad = sw / 2 + 1;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export function rectsBox(rects) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Nesnenin sınır kutusu
export function objBox(o) {
  if (o.type === 'line' || o.type === 'arrow') return lineBox(o);
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

// Nesneyi kaydır
export function translateObj(o, dx, dy) {
  if (o.type === 'line' || o.type === 'arrow') {
    o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy;
    return;
  }
  o.x += dx; o.y += dy;
  if (o.paths) o.paths = o.paths.map((p) => p.map((v, i) => v + (i % 2 ? dy : dx)));
  if (o.rects) o.rects = o.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
}

// Nesneyi yeni kutuya ölçekle
export function resizeObj(o, nb, start) {
  const sx = start.w ? nb.w / start.w : 1;
  const sy = start.h ? nb.h / start.h : 1;
  if (o.paths && start.paths) {
    o.paths = start.paths.map((p) => p.map((v, i) => (i % 2 ? nb.y + (v - start.y) * sy : nb.x + (v - start.x) * sx)));
    if (start.sw) o.sw = Math.max(0.3, start.sw * Math.sqrt(sx * sy));
  }
  o.x = nb.x; o.y = nb.y; o.w = nb.w; o.h = nb.h;
}

// Türkçe dahil tüm karakterleri koruyarak kelime bazlı satır kırma. measure(str) -> genişlik (pt)
export function wrapText(text, maxW, measure) {
  const lines = [];
  for (const para of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!para) { lines.push(''); continue; }
    const words = para.split(/(\s+)/);
    let line = '';
    // tek kelime kutudan geniş: harf harf böl
    const chunk = (start, word) => {
      let c = start;
      for (const ch of word) {
        if (measure(c + ch) > maxW && c.trim()) { lines.push(c); c = ch; } else c += ch;
      }
      return c;
    };
    for (const w of words) {
      if (!w) continue;
      const cand = line + w;
      if (measure(cand.replace(/\s+$/, '')) <= maxW + 0.01 || !line.trim()) {
        if (!line.trim() && measure(w) > maxW && !/^\s+$/.test(w)) line = chunk(line, w);
        else line = cand;
      } else {
        lines.push(line.replace(/\s+$/, ''));
        // kelimelerden sonra gelen uzun kelime de bölünmeli (yoksa satır kenar boşluğunu aşar)
        line = /^\s+$/.test(w) ? '' : measure(w) > maxW ? chunk('', w) : w;
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

export function hexToRgb01(hex) {
  const h = String(hex || '#000').replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(f.slice(0, 2), 16) / 255, parseInt(f.slice(2, 4), 16) / 255, parseInt(f.slice(4, 6), 16) / 255];
}

// Tarayıcının kullandığı yazı tipi ölçüleriyle ilk satırın taban çizgisi oranı (satır yüksekliği 1.2)
const baselineCache = new Map();
export function baselineRatio(cssFamily, bold, italic) {
  const key = `${cssFamily}|${bold}|${italic}`;
  if (baselineCache.has(key)) return baselineCache.get(key);
  const c = document.createElement('canvas').getContext('2d');
  c.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px ${cssFamily}`;
  const m = c.measureText('Hgİş');
  const asc = m.fontBoundingBoxAscent ?? 90;
  const desc = m.fontBoundingBoxDescent ?? 21;
  const r = ((120 - (asc + desc)) / 2 + asc) / 100;
  if (document.fonts.check(c.font)) baselineCache.set(key, r);
  return r;
}

export const LINE_HEIGHT = 1.2;
