/* global docx */
// Dahili Word → PDF motoru (ana süreçteki gizli pencerede çalışır).
// docx-preview belgeyi Word'ün son kaydettiği sayfa sonlarına göre sayfalara ayırır. Sayfa sonu bilgisi olmayan
// (başka programlarla üretilmiş) belgelerde tek "sayfa" birkaç sayfa boyunda olur; burada her sayfayı gerçek
// yüksekliğe sabitleyip taşan paragrafları (satır satır), tabloları (satır satır) ve diğer blokları yeni
// sayfalara taşıyoruz. Üst/alt bilgi her sayfada tekrarlanır. Sonunda her sayfa boyutu için @page kuralı yazılır.
'use strict';

const MAX_PAGES = 3000;
const EPS = 1;

const kids = (node, tag) => [...node.children].filter((c) => c.tagName === tag);

// Sayfada içeriğin inebileceği en alt nokta (alt bilgi boşluğa sığmıyorsa onun üstü)
function limitOf(page) {
  const cs = getComputedStyle(page);
  let bottom = page.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom);
  const footer = kids(page, 'FOOTER')[0];
  if (footer) {
    const mb = parseFloat(getComputedStyle(footer).marginBottom) || 0; // negatif: alt boşluğun içine yerleşir
    bottom = Math.min(bottom, bottom - mb - footer.getBoundingClientRect().height);
  }
  return bottom;
}

const blocksOf = (page) => kids(page, 'ARTICLE').flatMap((art) => [...art.children].map((el) => ({ art, el })));

// Paragrafı taşan ilk satırdan ikiye böl; sığan satır yoksa null
function splitParagraph(p, limit) {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const bottomAt = (node, i) => { range.setStart(node, i); range.setEnd(node, i + 1); return range.getBoundingClientRect().bottom; };
  let node;
  let seenText = false;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    if (!len) continue;
    if (bottomAt(node, len - 1) <= limit + EPS) { if (node.data.trim()) seenText = true; continue; }
    let lo = 0, hi = len - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bottomAt(node, mid) > limit + EPS) hi = mid; else lo = mid + 1;
    }
    if (!seenText && !node.data.slice(0, lo).trim()) return null; // ilk satır bile sığmıyor
    range.setStart(node, lo);
    range.setEnd(p, p.childNodes.length);
    const rest = p.cloneNode(false);
    rest.append(range.extractContents());
    p.classList.add('pu-split');
    rest.classList.add('pu-cont');
    return rest;
  }
  return null;
}

// Tabloyu taşan ilk satırdan böl; sığan satır yoksa null
function splitTable(table, limit) {
  const body = table.tBodies[0] || table;
  const rows = [...body.children].filter((r) => r.tagName === 'TR');
  const heads = rows.filter((r) => r.dataset.puHeader);
  const k = rows.findIndex((r) => r.getBoundingClientRect().bottom > limit + EPS);
  if (k <= heads.length) return null; // başlıktan sonra hiç satır sığmıyor: tablo bütün olarak taşınsın
  const rest = table.cloneNode(false);
  for (const cg of kids(table, 'COLGROUP')) rest.append(cg.cloneNode(true));
  const restBody = body === table ? rest : rest.appendChild(body.cloneNode(false));
  for (const h of heads) restBody.append(h.cloneNode(true)); // Word gibi: başlık satırı her sayfada tekrarlanır
  for (const r of rows.slice(k)) restBody.append(r);
  return rest;
}

const isHeading = (el) => el && el.tagName === 'P' && /_(heading|title|ba[sş]l[ıi]k)/i.test(el.className) && el.getBoundingClientRect().height < 80;

function newPageFrom(page) {
  const next = page.cloneNode(false);
  const header = kids(page, 'HEADER')[0];
  if (header) next.append(header.cloneNode(true));
  return next;
}

// Tek sayfayı sığdır; taşan kısım için yeni sayfa döndür (yoksa null)
function paginate(page) {
  const limit = limitOf(page);
  const blocks = blocksOf(page);
  const visible = blocks.filter((b) => b.el.getBoundingClientRect().height > 0);
  const i = visible.findIndex((b) => b.el.getBoundingClientRect().bottom > limit + EPS);
  if (i < 0) return null;
  const { art, el } = visible[i];
  let head = null; // yeni sayfanın başına gelecek parça
  let from = el; // bu blok ve sonrası taşınır
  if (el.tagName === 'P') head = splitParagraph(el, limit);
  else if (el.tagName === 'TABLE') head = splitTable(el, limit);
  if (head) from = el.nextElementSibling;
  else if (i === 0) {
    // Sayfaya tek başına sığmayan blok (çok büyük görsel vb.): burada bırak, sonrasını taşı
    from = el.nextElementSibling;
  } else if (i > 1 && visible[i - 1].art === art && isHeading(visible[i - 1].el)) from = visible[i - 1].el; // başlık, altındaki metinden ayrılmasın
  // Taşınacak bir şey var mı?
  const arts = kids(page, 'ARTICLE');
  const after = arts.slice(arts.indexOf(art) + 1);
  if (!head && !from && !after.some((a) => a.children.length)) return null;
  const next = newPageFrom(page);
  const cont = art.cloneNode(false);
  if (head) cont.append(head);
  for (let n = from; n;) { const x = n.nextElementSibling; cont.append(n); n = x; }
  next.append(cont);
  for (const a of after) next.append(a);
  const footer = kids(page, 'FOOTER')[0];
  if (footer) next.append(footer.cloneNode(true));
  page.after(next);
  return next;
}

// ---------------- sayfa numarası alanları ----------------
// docx-preview alan kodlarını (PAGE, NUMPAGES) çizmiyor; Word'ün önbellekteki değeri de her sayfada aynı.
// Üst/alt bilgi XML'inde bu alanları bir işaretle değiştirip sayfalama bitince gerçek numarayı yazıyoruz.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MARK = { PAGE: 'P', NUMPAGES: 'N', SECTIONPAGES: 'N' };

function markerRun(doc, rPr, text) {
  const r = doc.createElementNS(W, 'w:r');
  if (rPr) r.append(rPr.cloneNode(true));
  const t = doc.createElementNS(W, 'w:t');
  t.textContent = text;
  r.append(t);
  return r;
}

function rewriteFields(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return xml;
  let changed = false;
  for (const f of [...doc.getElementsByTagNameNS(W, 'fldSimple')]) {
    const m = MARK[(f.getAttributeNS(W, 'instr') || f.getAttribute('w:instr') || '').trim().split(/\s+/)[0].toUpperCase()];
    if (!m) continue;
    f.replaceWith(markerRun(doc, f.getElementsByTagNameNS(W, 'rPr')[0], m));
    changed = true;
  }
  for (const p of [...doc.getElementsByTagNameNS(W, 'p')]) {
    let state = 0; // 0 dışarıda, 1 komut, 2 sonuç
    let instr = '';
    let group = [];
    for (const r of [...p.getElementsByTagNameNS(W, 'r')]) {
      for (const c of [...r.children]) {
        const type = c.localName === 'fldChar' ? (c.getAttributeNS(W, 'fldCharType') || c.getAttribute('w:fldCharType')) : null;
        if (type === 'begin') { state = 1; instr = ''; group = []; }
        if (!state) continue;
        if (!group.includes(r)) group.push(r);
        if (c.localName === 'instrText' && state === 1) instr += c.textContent;
        if (type === 'separate') state = 2;
        if (type === 'end') {
          const m = MARK[instr.trim().split(/\s+/)[0].toUpperCase()];
          if (m) {
            group[0].before(markerRun(doc, group[0].getElementsByTagNameNS(W, 'rPr')[0], m));
            group.forEach((g) => g.remove());
            changed = true;
          }
          state = 0;
          group = [];
        }
      }
    }
  }
  return changed ? new XMLSerializer().serializeToString(doc) : xml;
}

// Gövdedeki her tablonun (belge sırasıyla) "başlık satırı olarak tekrarla" işaretli ilk satır sayısı
function headerRowCounts(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const on = (el) => el && !/^(0|false|off)$/i.test(el.getAttributeNS(W, 'val') || el.getAttribute('w:val') || '');
  return [...doc.getElementsByTagNameNS(W, 'tbl')].map((tbl) => {
    let n = 0;
    for (const tr of [...tbl.children].filter((c) => c.localName === 'tr')) {
      const trPr = [...tr.children].find((c) => c.localName === 'trPr');
      if (!trPr || !on([...trPr.children].find((c) => c.localName === 'tblHeader'))) break;
      n++;
    }
    return n;
  });
}

async function prepareDocx(data) {
  const zip = await window.JSZip.loadAsync(data);
  let changed = false;
  let headers = [];
  for (const name of Object.keys(zip.files)) {
    if (/^word\/document\.xml$/i.test(name)) {
      try { headers = headerRowCounts(await zip.file(name).async('string')); } catch (e) { /* yoksay */ }
    }
    if (!/^word\/(header|footer)\d*\.xml$/i.test(name)) continue;
    const xml = await zip.file(name).async('string');
    const neu = rewriteFields(xml);
    if (neu !== xml) { zip.file(name, neu); changed = true; }
  }
  return { data: changed ? await zip.generateAsync({ type: 'arraybuffer' }) : data, headers };
}

function markHeaderRows(out, headers) {
  const tables = [...out.querySelectorAll('section.docx > article table')];
  if (tables.length !== headers.length) return; // eşleşme güvenilir değilse dokunma
  tables.forEach((t, i) => {
    const body = t.tBodies[0] || t;
    [...body.children].filter((r) => r.tagName === 'TR').slice(0, headers[i]).forEach((r) => { r.dataset.puHeader = '1'; });
  });
}

function fillPageNumbers(pages) {
  const total = String(pages.length);
  pages.forEach((page, i) => {
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.data.includes('')) n.data = n.data.split(MARK.PAGE).join(String(i + 1)).split(MARK.NUMPAGES).join(total);
    }
  });
}

window.renderDocx = async (url) => {
  const { data, headers } = await prepareDocx(await (await fetch(url)).arrayBuffer());
  const out = document.getElementById('out');
  await docx.renderAsync(data, out, null, {
    className: 'docx', inWrapper: true, hideWrapperOnPrint: true, ignoreWidth: false, ignoreHeight: false, ignoreFonts: false,
    breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true, renderFootnotes: true,
    renderEndnotes: true, renderComments: false, renderChanges: false, renderAltChunks: false, useBase64URL: true, experimental: true,
  });
  await document.fonts.ready;
  await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
  markHeaderRows(out, headers);

  const extra = document.createElement('style');
  extra.textContent = `
    p.pu-cont::before { content: none !important; counter-increment: none !important; }
    p.pu-cont { list-style-type: none !important; text-indent: 0 !important; margin-top: 0 !important; padding-top: 0 !important; counter-set: none !important; }
    p.pu-split { margin-bottom: 0 !important; padding-bottom: 0 !important; }`;
  document.head.append(extra);

  // Sayfaları gerçek yüksekliğe sabitle ve taşanları böl
  let split = 0;
  let page = out.querySelector('section.docx');
  while (page) {
    const h = page.style.minHeight;
    if (h) page.style.height = h;
    const next = h ? paginate(page) : null;
    if (next) split++;
    if (out.querySelectorAll('section.docx').length > MAX_PAGES) break;
    page = page.nextElementSibling && page.nextElementSibling.matches('section.docx') ? page.nextElementSibling : null;
  }

  // Her sayfa boyutu için adlandırılmış @page
  const pages = [...out.querySelectorAll('section.docx')];
  const names = new Map();
  let css = '';
  for (const p of pages) {
    const w = p.style.width || '595.3pt';
    const h = p.style.minHeight || '841.9pt';
    const key = `${w} ${h}`;
    if (!names.has(key)) {
      const n = `pu${names.size}`;
      names.set(key, n);
      css += `@page ${n} { size: ${w} ${h}; margin: 0; }\n`;
      if (names.size === 1) css += `@page { size: ${w} ${h}; margin: 0; }\n`;
    }
    p.style.page = names.get(key);
    p.style.height = `calc(${h} - 1px)`;
    p.style.minHeight = '0';
  }
  const ps = document.createElement('style');
  ps.textContent = css;
  document.head.append(ps);
  fillPageNumbers(pages);
  return { pages: pages.length, split, sizes: [...names.keys()] };
};
