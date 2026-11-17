// Windows yazı tipleri: ekranda @font-face ile aynı dosya kullanılır, PDF'e aynı dosya gömülür (Türkçe karakterler sorunsuz).
let families = [];
const bytesCache = new Map();

export function initFonts(list) {
  families = list || [];
  const css = [];
  for (const f of families) {
    const variants = [
      [0, 'normal', 'normal'], [1, 'bold', 'normal'], [2, 'normal', 'italic'], [3, 'bold', 'italic'],
    ];
    for (const [i, weight, style] of variants) {
      if (!f.files[i]) continue;
      css.push(`@font-face{font-family:"${cssName(f.family)}";src:url("app://pu/sysfonts/${f.files[i]}") format("truetype");font-weight:${weight};font-style:${style};font-display:block}`);
    }
  }
  const st = document.createElement('style');
  st.id = 'pu-fonts';
  st.textContent = css.join('\n');
  document.head.append(st);
}

export const cssName = (family) => `PU ${family}`;
export const fontStack = (family) => `"${cssName(family)}", "${family}", Arial, sans-serif`;
export const fontFamilies = () => families;
export const handFonts = () => families.filter((f) => f.hand);
export const textFonts = () => families.filter((f) => !f.hand);
export const hasFamily = (name) => families.some((f) => f.family === name);
export const defaultFamily = () => (hasFamily('Arial') ? 'Arial' : families[0]?.family || 'Arial');

export function fontFile(family, bold, italic) {
  const f = families.find((x) => x.family === family) || families.find((x) => x.family === defaultFamily());
  if (!f) return null;
  const idx = (bold ? 1 : 0) + (italic ? 2 : 0);
  return f.files[idx] || (bold && f.files[1]) || f.files[0];
}

export async function fontBytes(file) {
  if (!bytesCache.has(file)) bytesCache.set(file, window.pu.readFont(file));
  return bytesCache.get(file);
}

// Yazı tipinin görsel olarak yüklendiğinden emin ol (canvas ölçümü için)
export async function ensureLoaded(family, bold, italic, size = 16) {
  try {
    await document.fonts.load(`${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px "${cssName(family)}"`);
  } catch (e) { /* yoksay */ }
}

// Mevcut PDF yazı tipi adından en yakın aileyi tahmin et
export function guessFamily(pdfFontName = '', cssFallback = '') {
  const n = `${pdfFontName} ${cssFallback}`.toLowerCase();
  const pick = (name) => (hasFamily(name) ? name : null);
  if (/times|serif(?!.*sans)|minion|garamond|georgia|cambria|book/.test(n) && !/sans/.test(n)) return pick(/georgia/.test(n) ? 'Georgia' : 'Times New Roman') || defaultFamily();
  if (/courier|mono|consol/.test(n)) return pick(/consol/.test(n) ? 'Consolas' : 'Courier New') || defaultFamily();
  if (/calibri|carlito/.test(n)) return pick('Calibri') || defaultFamily();
  if (/segoe/.test(n)) return pick('Segoe UI') || defaultFamily();
  if (/verdana/.test(n)) return pick('Verdana') || defaultFamily();
  if (/tahoma/.test(n)) return pick('Tahoma') || defaultFamily();
  return defaultFamily();
}
