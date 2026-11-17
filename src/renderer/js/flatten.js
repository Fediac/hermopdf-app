// Düzenleme nesnelerini (yazı, imza, şekil, vurgulama…) pdf-lib ile PDF sayfa içeriğine işler.
import { PDFLib, fontkit } from './pdfcore.js';
import { fontFile, fontBytes, fontStack, ensureLoaded, defaultFamily } from './fonts.js';
import { SYMBOL_PATHS, smoothPath, arrowGeometry, wrapText, hexToRgb01, baselineRatio, LINE_HEIGHT } from './shapes.js';
import { dataURLToBytes } from './util.js';

const measureCtx = document.createElement('canvas').getContext('2d');

// Bazı yazı tipleri (ör. Calibri, Courier New) alt kümeye ayrılamıyor: bir kez dene, olmazsa tamamını göm
const subsetOk = new Map();
export function canSubset(file, bytes) {
  if (!subsetOk.has(file)) {
    subsetOk.set(file, (async () => {
      try {
        const { PDFDocument } = PDFLib();
        const t = await PDFDocument.create();
        t.registerFontkit(fontkit());
        const f = await t.embedFont(bytes, { subset: true });
        t.addPage().drawText('AaĞğŞşİıÖöÜüÇç 0123', { font: f, size: 10, x: 10, y: 10 });
        await t.save();
        return true;
      } catch (e) {
        console.warn('Alt küme yok, tam gömülecek:', file, e.message);
        return false;
      }
    })());
  }
  return subsetOk.get(file);
}

function color(hex) {
  const [r, g, b] = hexToRgb01(hex);
  return PDFLib().rgb(r, g, b);
}

export function measureFn(o) {
  measureCtx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size}px ${fontStack(o.font)}`;
  return (s) => measureCtx.measureText(s).width;
}

// Metin kutusunu satırlara böl (ekrandaki CSS kırılımıyla aynı ölçüler)
export function layoutText(o) {
  const measure = measureFn(o);
  return wrapText(o.text || '', o.w, measure);
}

export async function flattenInto(lib, doc, { pages = null } = {}) {
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, BlendMode, LineCapStyle } = PDFLib();
  const fonts = new Map();
  const images = new Map();
  const getFont = async (o) => {
    const file = fontFile(o.font, o.bold, o.italic);
    if (!fonts.has(file)) {
      const bytes = await fontBytes(file);
      fonts.set(file, canSubset(file, bytes).then((subset) => lib.embedFont(bytes, { subset })));
    }
    return fonts.get(file);
  };
  const getImage = async (assetId) => {
    if (!images.has(assetId)) {
      const a = doc.assets.get(assetId);
      if (!a) return null;
      const bytes = dataURLToBytes(a.dataURL);
      images.set(assetId, a.dataURL.startsWith('data:image/jpeg') ? lib.embedJpg(bytes) : lib.embedPng(bytes));
    }
    return images.get(assetId);
  };

  const indices = pages || doc.pageObjs.map((_, k) => k);
  for (const i of indices) {
    const objs = doc.pageObjs[i];
    if (!objs || !objs.length) continue;
    const page = lib.getPage(i);
    const info = await doc.pageInfo(i);
    const H = info.h;
    const M = info.M;
    const notes = [];
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(M[0], M[1], M[2], M[3], M[4], M[5]));
    const Y = (y) => H - y;

    // örtüler önce
    for (const o of objs) {
      if (o.type === 'text' && o.cover) {
        const c = o.cover;
        page.drawRectangle({ x: c.x, y: Y(c.y + c.h), width: c.w, height: c.h, color: color(c.color || '#ffffff') });
      }
    }

    for (const o of objs) {
      const opacity = o.opacity != null && o.opacity < 1 ? o.opacity : undefined;
      switch (o.type) {
        case 'whiteout':
          page.drawRectangle({ x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, color: color(o.color || '#ffffff') });
          break;
        case 'redact':
          page.drawRectangle({ x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, color: PDFLib().rgb(0, 0, 0) });
          break;
        case 'rect': {
          const sw = o.sw || 0;
          page.drawRectangle({
            x: o.x + sw / 2, y: Y(o.y + o.h) + sw / 2, width: Math.max(0, o.w - sw), height: Math.max(0, o.h - sw),
            color: o.fill ? color(o.fill) : undefined, borderColor: sw ? color(o.color) : undefined, borderWidth: sw || undefined,
            opacity, borderOpacity: opacity,
          });
          break;
        }
        case 'ellipse': {
          const sw = o.sw || 0;
          page.drawEllipse({
            x: o.x + o.w / 2, y: Y(o.y + o.h / 2), xScale: Math.max(0, (o.w - sw) / 2), yScale: Math.max(0, (o.h - sw) / 2),
            color: o.fill ? color(o.fill) : undefined, borderColor: sw ? color(o.color) : undefined, borderWidth: sw || undefined,
            opacity, borderOpacity: opacity,
          });
          break;
        }
        case 'line':
        case 'arrow': {
          let end = [o.x2, o.y2];
          if (o.type === 'arrow') {
            const g = arrowGeometry(o.x1, o.y1, o.x2, o.y2, o.sw);
            end = g.lineEnd;
            const hd = g.head;
            page.drawSvgPath(`M ${hd[0]} ${hd[1]} L ${hd[2]} ${hd[3]} L ${hd[4]} ${hd[5]} Z`, { x: 0, y: H, color: color(o.color), opacity });
          }
          page.drawLine({ start: { x: o.x1, y: Y(o.y1) }, end: { x: end[0], y: Y(end[1]) }, thickness: o.sw, color: color(o.color), opacity, lineCap: LineCapStyle.Round });
          break;
        }
        case 'ink':
          for (const p of o.paths) {
            page.drawSvgPath(smoothPath(p), { x: 0, y: H, borderColor: color(o.color), borderWidth: o.sw, borderOpacity: opacity, borderLineCap: LineCapStyle.Round });
          }
          break;
        case 'markup':
          for (const r of o.rects) {
            if (o.kind === 'highlight') {
              page.drawRectangle({ x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h, color: color(o.color), opacity: o.opacity ?? 0.45, blendMode: BlendMode.Multiply });
            } else {
              const th = Math.max(0.8, r.h * 0.08);
              const top = o.kind === 'underline' ? r.y + r.h * 0.9 : r.y + r.h * 0.52;
              page.drawRectangle({ x: r.x, y: Y(top + th), width: r.w, height: th, color: color(o.color), opacity: o.opacity ?? 1 });
            }
          }
          break;
        case 'symbol': {
          const s = Math.min(o.w, o.h);
          if (o.kind === 'dot') {
            page.drawEllipse({ x: o.x + o.w / 2, y: Y(o.y + o.h / 2), xScale: s * 0.32, yScale: s * 0.32, color: color(o.color), opacity });
          } else {
            page.drawSvgPath(SYMBOL_PATHS[o.kind], { x: o.x, y: Y(o.y), scale: s, borderColor: color(o.color), borderWidth: 0.12, borderLineCap: LineCapStyle.Round, borderOpacity: opacity });
          }
          break;
        }
        case 'image': {
          const img = await getImage(o.assetId);
          if (img) page.drawImage(await img, { x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, opacity });
          break;
        }
        case 'text':
          // yedek yazı tipi yalnız gerekince gömülür
          await drawText(page, o, await getFont(o), Y, opacity, () => getFont({ font: defaultFamily(), bold: o.bold, italic: o.italic }));
          break;
        case 'note':
          notes.push(o);
          break;
        default:
          break;
      }
    }
    page.pushOperators(popGraphicsState());
    for (const n of notes) addNoteAnnot(lib, page, n, info);
  }
}

async function drawText(page, o, font, Y, opacity, getFallback = null) {
  await ensureLoaded(o.font, o.bold, o.italic);
  const lines = layoutText(o);
  const lh = o.size * LINE_HEIGHT;
  const ratio = baselineRatio(fontStack(o.font), o.bold, o.italic);
  if (o.bg) {
    page.drawRectangle({ x: o.x, y: Y(o.y + lines.length * lh), width: o.w, height: lines.length * lh, color: color(o.bg) });
  }
  const charset = new Set(font.getCharacterSet());
  let fb = null, fbSet = null;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (!line) continue;
    // Yazı tipinde glifi olmayan harfler (ör. Lucida Handwriting'de ğ, ş, İ, ı) ekrandaki gibi
    // varsayılan yazı tipiyle çizilir; orada da yoksa '?'
    const runs = [];
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      let f = font, c = ch;
      if (!charset.has(cp) && ch !== ' ') {
        if (!fb && getFallback) { fb = await getFallback(); fbSet = new Set(fb.getCharacterSet()); }
        if (fb && fb !== font && fbSet.has(cp)) f = fb; else c = '?';
      }
      const last = runs[runs.length - 1];
      if (last && last.f === f) last.s += c; else runs.push({ f, s: c });
    }
    for (const r of runs) r.w = r.f.widthOfTextAtSize(r.s, o.size);
    let x = o.x;
    if (o.align === 'center' || o.align === 'right') {
      const w = runs.reduce((a, r) => a + r.w, 0);
      x = o.align === 'center' ? o.x + (o.w - w) / 2 : o.x + o.w - w;
    }
    const baseline = o.y + ratio * o.size + k * lh;
    for (const r of runs) {
      page.drawText(r.s, { x, y: Y(baseline), size: o.size, font: r.f, color: color(o.color), opacity });
      x += r.w;
    }
  }
}

function addNoteAnnot(lib, page, n, info) {
  const { PDFName, PDFString, PDFHexString } = PDFLib();
  // görünen kutu köşelerini kullanıcı uzayına çevir
  const T = info.Ti;
  const pts = [[n.x, n.y], [n.x + 20, n.y + 20]].map(([x, y]) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]]);
  const rect = [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
  const [r, g, b] = hexToRgb01(n.color || '#ffd54f');
  const annot = lib.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: rect,
    Contents: PDFHexString.fromText(n.text || ''),
    T: PDFHexString.fromText('HermoPDF'),
    Name: 'Comment',
    C: [r, g, b],
    F: 4,
    M: PDFString.fromDate(new Date()),
  });
  const ref = lib.context.register(annot);
  page.node.addAnnot(ref);
  void PDFName;
}
