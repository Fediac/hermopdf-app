// İmza: çiz / yaz / görselden (arka planı otomatik temizlenir), kayıtlı imzalar; damgalar.
import { App, saveSetting } from './state.js';
import { $, $$, el, toast, modal, uid, blobToDataURL, loadImage } from './util.js';
import { icon } from './icons.js';
import { handFonts, fontStack, ensureLoaded, textFonts } from './fonts.js';
import { setTool } from './tools.js';
import { t, locale } from './i18n.js';

const INK = ['#111111', '#1a3c9c', '#0d47a1', '#b71c1c'];

// Görselin boş (şeffaf) kenarlarını kırp
function trimCanvas(c, pad = 6) {
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// ---------------- çizim alanı ----------------
function drawPad(state) {
  const wrap = el('div', { class: 'sig-pad' });
  const cv = el('canvas');
  wrap.append(cv, el('div', { class: 'baseline' }), el('div', { class: 'ph', text: t('signature.padHint') }));
  const strokes = [];
  let cur = null;
  const DPR = 2;
  const resize = () => {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    cv.width = Math.round(r.width * DPR);
    cv.height = Math.round(r.height * DPR);
    redraw();
  };
  const redraw = () => {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const s of strokes) paintStroke(ctx, s);
    if (cur) paintStroke(ctx, cur);
    wrap.querySelector('.ph').hidden = strokes.length > 0 || !!cur;
  };
  const paintStroke = (ctx, s) => {
    ctx.strokeStyle = state.color;
    ctx.fillStyle = state.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const p = s.pts;
    if (p.length === 1) {
      ctx.beginPath(); ctx.arc(p[0].x * DPR, p[0].y * DPR, (state.width * DPR) / 2, 0, 7); ctx.fill();
      return;
    }
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.lineWidth = state.width * DPR * b.w;
      ctx.beginPath();
      ctx.moveTo((a.mx ?? a.x) * DPR, (a.my ?? a.y) * DPR);
      ctx.quadraticCurveTo(a.x * DPR, a.y * DPR, mid.x * DPR, mid.y * DPR);
      ctx.stroke();
      b.mx = mid.x; b.my = mid.y;
    }
  };
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = pos(e);
    cur = { pts: [{ ...p, w: 1, t: e.timeStamp }] };
    redraw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!cur) return;
    for (const ce of e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) {
      const p = pos(ce);
      const last = cur.pts[cur.pts.length - 1];
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      if (dist < 0.8) continue;
      const v = dist / Math.max(1, ce.timeStamp - last.t);
      // hızlı çizgi incelir, basınç varsa kullanılır
      const pressure = ce.pressure && ce.pointerType === 'pen' ? 0.5 + ce.pressure : 1;
      const w = Math.max(0.45, Math.min(1.3, (1.25 - v * 0.35) * pressure));
      cur.pts.push({ ...p, w: last.w * 0.6 + w * 0.4, t: ce.timeStamp });
    }
    redraw();
  });
  const end = () => { if (cur) { strokes.push(cur); cur = null; redraw(); state.onChange?.(); } };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  return {
    el: wrap, resize, redraw,
    clear() { strokes.length = 0; redraw(); },
    undo() { strokes.pop(); redraw(); },
    isEmpty: () => !strokes.length,
    toCanvas() { cur = null; redraw(); return trimCanvas(cv, 8); },
  };
}

// ---------------- yazılı imza ----------------
async function typedCanvas(text, family, color) {
  await ensureLoaded(family, false, false, 120);
  const size = 150;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${size}px ${fontStack(family)}`;
  const w = ctx.measureText(text).width;
  c.width = Math.ceil(w + size); c.height = Math.ceil(size * 1.9);
  const x = c.getContext('2d');
  x.font = `${size}px ${fontStack(family)}`;
  x.fillStyle = color;
  x.textBaseline = 'middle';
  x.fillText(text, size / 2, c.height / 2);
  return trimCanvas(c, 10);
}

// ---------------- görselden imza ----------------
async function imageSignatureCanvas(dataURL, { threshold = 200, recolor = null } = {}) {
  const img = await loadImage(dataURL);
  const max = 1600;
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  const rc = recolor ? [parseInt(recolor.slice(1, 3), 16), parseInt(recolor.slice(3, 5), 16), parseInt(recolor.slice(5, 7), 16)] : null;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // açık renkli (kağıt) pikselleri şeffaf yap, kenarları yumuşak geçişle
    const a = lum >= threshold ? 0 : Math.min(255, ((threshold - lum) / Math.max(1, threshold - 60)) * 255);
    d[i + 3] = Math.min(d[i + 3], a);
    if (rc) { d[i] = rc[0]; d[i + 1] = rc[1]; d[i + 2] = rc[2]; }
  }
  ctx.putImageData(id, 0, 0);
  return trimCanvas(c, 6);
}

// ---------------- iletişim kutusu ----------------
export async function signatureDialog(d, anchor, { initials = false } = {}) {
  const saved = (App.settings.signatures || []).filter((s) => !!s.initials === initials);
  const state = { tab: saved.length ? 'saved' : 'draw', color: INK[0], width: 2.6 };
  const tabs = el('div', { class: 'sig-tabs' });
  const body = el('div');
  const saveChk = el('input', { type: 'checkbox', checked: true });
  const saveLine = el('label', { class: 'checkline' }, saveChk, initials ? t('signature.saveInitials') : t('signature.saveSignature'));
  const pad = drawPad(state);
  const typeInput = el('input', { class: 'input', placeholder: initials ? t('signature.initialsPh') : t('signature.namePh'), value: App.settings.lastSigName || '' });
  let typeFont = handFonts()[0]?.family || 'Segoe Script';
  const typeGrid = el('div', { class: 'sig-type-preview' });
  let imgData = null;
  const imgPreview = el('div', { class: 'sig-img-drop', html: `${icon('upload')}<div>${t('signature.imgPick')}</div><small class="muted">${t('signature.imgNote')}</small>` });
  const thr = el('input', { type: 'range', min: 120, max: 245, value: 200 });
  const recolor = el('input', { type: 'checkbox' });
  let chosenSaved = null;

  const colorRow = () => el('div', { class: 'sig-colors' }, el('span', { class: 'muted', text: t('signature.color') }), ...INK.map((c) => {
    const b = el('button', { class: `color-dot ${c === state.color ? 'on' : ''}`, style: { background: c } });
    b.onclick = () => { state.color = c; $$('.sig-colors .color-dot').forEach((x) => x.classList.toggle('on', x === b)); pad.redraw(); renderType(); if (imgData) renderImg(); };
    return b;
  }));

  const renderType = () => {
    const fonts = handFonts().length ? handFonts() : textFonts().slice(0, 4);
    typeGrid.replaceChildren(...fonts.map((f) => {
      const b = el('button', { class: f.family === typeFont ? 'on' : '', style: { fontFamily: fontStack(f.family), color: state.color }, title: f.family, text: typeInput.value || (initials ? 'M.D.' : t('signature.titleSignature')) });
      b.onclick = () => { typeFont = f.family; renderType(); };
      return b;
    }));
  };
  typeInput.addEventListener('input', renderType);

  const renderImg = async () => {
    if (!imgData) return;
    const c = await imageSignatureCanvas(imgData, { threshold: +thr.value, recolor: recolor.checked ? state.color : null });
    imgPreview.replaceChildren(c ? el('img', { src: c.toDataURL('image/png') }) : el('div', { text: t('signature.imgNone') }));
  };
  imgPreview.onclick = async () => {
    const files = await window.pu.openFilesDialog({ title: t('signature.imgDialog'), multi: false, filters: [{ name: t('signature.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
    if (!files.length) return;
    const f = files[0];
    const mime = /png$/i.test(f.name) ? 'image/png' : 'image/jpeg';
    imgData = await blobToDataURL(new Blob([f.bytes], { type: mime }));
    renderImg();
  };
  thr.addEventListener('input', renderImg);
  recolor.addEventListener('change', renderImg);

  const renderSaved = () => {
    const list = (App.settings.signatures || []).filter((s) => !!s.initials === initials);
    if (!list.length) return el('div', { class: 'empty-note', text: t('signature.noSaved') });
    return el('div', { class: 'sig-saved' }, list.map((s) => {
      const item = el('div', { class: 'sig-item', title: t('signature.clickToPlace') }, el('img', { src: s.dataURL }));
      const del = el('button', { class: 'del', title: t('common.delete'), html: icon('trash-2') });
      del.onclick = (e) => {
        e.stopPropagation();
        saveSetting({ signatures: (App.settings.signatures || []).filter((x) => x.id !== s.id) });
        show('saved');
      };
      item.append(del);
      item.onclick = () => { chosenSaved = s; api?.close('saved'); };
      return item;
    }));
  };

  const show = (tab) => {
    state.tab = tab;
    tabs.replaceChildren(...[['saved', t('signature.tabSaved')], ['draw', t('signature.tabDraw')], ['type', t('signature.tabType')], ['image', t('signature.tabImage')]].map(([k, label]) => {
      const b = el('button', { class: k === tab ? 'on' : '', text: label });
      b.onclick = () => show(k);
      return b;
    }));
    if (tab === 'saved') body.replaceChildren(renderSaved());
    if (tab === 'draw') {
      const tools = el('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '8px' } }, colorRow(),
        el('label', { class: 'checkline', style: { margin: 0 } }, t('signature.thickness'), (() => { const r = el('input', { type: 'range', min: 1, max: 6, step: 0.2, value: state.width }); r.oninput = () => { state.width = +r.value; pad.redraw(); }; return r; })()),
        el('div', { class: 'row' }, (() => { const b = el('button', { class: 'btn small', html: `${icon('undo-2')}${t('signature.undo')}` }); b.onclick = () => pad.undo(); return b; })(), (() => { const b = el('button', { class: 'btn small', html: `${icon('eraser')}${t('signature.clear')}` }); b.onclick = () => pad.clear(); return b; })()));
      body.replaceChildren(pad.el, tools, saveLine);
      requestAnimationFrame(pad.resize);
    }
    if (tab === 'type') { renderType(); body.replaceChildren(typeInput, typeGrid, colorRow(), saveLine); setTimeout(() => typeInput.focus(), 20); }
    if (tab === 'image') body.replaceChildren(imgPreview, el('div', { class: 'row', style: { marginTop: '10px' } }, el('label', { class: 'checkline' }, t('signature.threshold'), thr), el('label', { class: 'checkline' }, recolor, t('signature.recolor'))), colorRow(), saveLine);
  };
  let api = null;
  show(state.tab);
  const res = await modal({
    title: initials ? t('signature.titleInitials') : t('signature.titleSignature'), width: 640, className: 'sig-modal',
    body: el('div', {}, tabs, body),
    onOpen: (a) => { api = a; },
    buttons: [{ label: t('common.cancel') }, { label: t('signature.place'), primary: true, run: async () => {
      if (state.tab === 'saved') { if (!chosenSaved) { toast(t('signature.pickSaved'), { type: 'warn' }); return false; } return 'saved'; }
      let c = null;
      if (state.tab === 'draw') { if (pad.isEmpty()) { toast(t('signature.drawFirst'), { type: 'warn' }); return false; } c = pad.toCanvas(); }
      if (state.tab === 'type') { if (!typeInput.value.trim()) { toast(t('signature.typeName'), { type: 'warn' }); return false; } c = await typedCanvas(typeInput.value.trim(), typeFont, state.color); saveSetting({ lastSigName: typeInput.value.trim() }); }
      if (state.tab === 'image') { if (!imgData) { toast(t('signature.pickImage'), { type: 'warn' }); return false; } c = await imageSignatureCanvas(imgData, { threshold: +thr.value, recolor: recolor.checked ? state.color : null }); }
      if (!c) { toast(t('signature.createFailed'), { type: 'error' }); return false; }
      return { canvas: c, save: saveChk.checked };
    } }],
  });
  if (!res) return;
  let sig;
  if (res === 'saved') sig = chosenSaved;
  else {
    sig = { id: uid(), dataURL: res.canvas.toDataURL('image/png'), w: res.canvas.width, h: res.canvas.height, initials };
    if (res.save) saveSetting({ signatures: [...(App.settings.signatures || []), sig].slice(-20) });
  }
  placeSignature(d, sig, initials);
}

function placeSignature(d, sig, initials) {
  const assetId = d.addAsset(sig.dataURL, sig.w, sig.h);
  setTool('place', { place: { assetId, w: sig.w, h: sig.h, kind: 'signature', label: initials ? t('signature.titleInitials') : t('signature.titleSignature'), defaultW: initials ? 60 : 150 } });
  toast(initials ? t('signature.placeHintInitials') : t('signature.placeHintSignature'), { timeout: 4500 });
}

// ---------------- damgalar ----------------
const stamps = () => [
  [t('signature.stampApproved'), '#2e7d32'], [t('signature.stampRejected'), '#c62828'], [t('signature.stampDraft'), '#546e7a'], [t('signature.stampConfidential'), '#c62828'], [t('signature.stampPaid'), '#2e7d32'],
  [t('signature.stampReviewed'), '#1565c0'], [t('signature.stampTrueCopy'), '#1565c0'], [t('signature.stampCopy'), '#6a1b9a'], [t('signature.stampUrgent'), '#ef6c00'],
];

async function stampCanvas(text, color, { date = true, sub = '' } = {}) {
  await ensureLoaded('Arial', true, false, 60);
  const scale = 4;
  const MAX_W = 320 * scale; // damga çok uzamasın; gerekirse yazı küçülür/satır atlar
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const lines = [];
  if (date) lines.push(new Date().toLocaleDateString(locale()));
  if (sub && sub.trim()) lines.push(sub.trim());
  const sfs = 11 * scale;
  // Ana yazıyı sığdır: önce küçült, hâlâ sığmıyorsa kelimelerden böl
  let fs = 26 * scale;
  const measure = (t, size) => { x.font = `bold ${size}px ${fontStack('Arial')}`; return x.measureText(t).width; };
  const padX = 16 * scale, padY = 9 * scale;
  const avail = MAX_W - padX * 2;
  let mainLines = [String(text || '').trim() || t('signature.stampFallback')];
  while (fs > 11 * scale && measure(mainLines[0], fs) > avail) fs -= scale;
  if (measure(mainLines[0], fs) > avail) {
    const words = mainLines[0].split(/\s+/);
    const out = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (measure(cand, fs) > avail && cur) { out.push(cur); cur = w; } else cur = cand;
    }
    if (cur) out.push(cur);
    mainLines = out.slice(0, 3);
  }
  const mainW = Math.max(...mainLines.map((l) => measure(l, fs)));
  x.font = `bold ${sfs}px ${fontStack('Arial')}`;
  const subW = Math.max(0, ...lines.map((l) => x.measureText(l).width));
  const edge = 3 * scale; // çerçevenin dışında kalan boşluk
  const W = Math.min(MAX_W, Math.max(mainW, subW) + padX * 2) + edge * 2;
  const mainH = mainLines.length * fs * 1.12;
  const H = mainH + (lines.length ? lines.length * sfs * 1.35 + 4 * scale : 0) + padY * 2 + edge * 2;
  c.width = Math.ceil(W); c.height = Math.ceil(H);
  const y = c.getContext('2d');
  const lw = 3.2 * scale, r = 8 * scale;
  y.strokeStyle = color; y.fillStyle = color; y.lineWidth = lw;
  const rr = (o) => { y.beginPath(); y.roundRect(edge + o, edge + o, c.width - 2 * (edge + o), c.height - 2 * (edge + o), Math.max(2, r - o / 2)); y.stroke(); };
  rr(lw / 2); y.lineWidth = scale; rr(lw + 3 * scale);
  y.textAlign = 'center'; y.textBaseline = 'top';
  y.font = `bold ${fs}px ${fontStack('Arial')}`;
  mainLines.forEach((l, i) => y.fillText(l, c.width / 2, edge + padY + i * fs * 1.12));
  y.font = `bold ${sfs}px ${fontStack('Arial')}`;
  lines.forEach((l, i) => y.fillText(l, c.width / 2, edge + padY + mainH + 4 * scale + i * sfs * 1.35));
  return c;
}

export async function stampDialog(d) {
  const dateChk = el('input', { type: 'checkbox', checked: true });
  const sub = el('input', { class: 'input', placeholder: t('signature.stampSubPh') });
  const custom = el('input', { class: 'input', placeholder: t('signature.stampCustomPh') });
  const colorIn = el('input', { type: 'color', class: 'color-pick', value: '#1565c0' });
  const grid = el('div', { class: 'stamp-grid' });
  const customPrev = el('div', { class: 'stamp-custom-prev', text: t('signature.stampPreviewHint') });
  let api;
  let chosen = null;

  const renderGrid = async () => {
    const items = [];
    for (const [name, col] of stamps()) {
      const c = await stampCanvas(name, col, { date: dateChk.checked, sub: sub.value });
      const b = el('button', { class: 'stamp-item', title: t('signature.stampPick', { name }) }, el('img', { src: c.toDataURL('image/png') }));
      b.onclick = () => { chosen = c; api.close({ canvas: c }); };
      items.push(b);
    }
    grid.replaceChildren(...items);
  };
  const renderCustom = async () => {
    const txt = custom.value.trim();
    if (!txt) { customPrev.replaceChildren(document.createTextNode(t('signature.stampPreviewHint'))); return; }
    const c = await stampCanvas(txt.toLocaleUpperCase(locale()), colorIn.value, { date: dateChk.checked, sub: sub.value });
    customPrev.replaceChildren(el('img', { src: c.toDataURL('image/png') }));
  };
  dateChk.addEventListener('change', () => { renderGrid(); renderCustom(); });
  sub.addEventListener('input', () => { renderGrid(); renderCustom(); });
  custom.addEventListener('input', renderCustom);
  colorIn.addEventListener('input', renderCustom);
  await renderGrid();

  const res = await modal({
    title: t('signature.stampTitle'), width: 660,
    onOpen: (a) => { api = a; },
    body: el('div', {},
      el('p', { class: 'muted', style: { marginTop: 0 }, text: t('signature.stampIntro') }),
      el('div', { class: 'row', style: { marginBottom: '10px' } }, el('label', { class: 'checkline', style: { margin: 0 } }, dateChk, t('signature.stampDate')), sub),
      grid,
      el('div', { class: 'stamp-custom' },
        el('div', { style: { flex: 1 } },
          el('div', { class: 'field-label', text: t('signature.stampOwn') }),
          el('div', { class: 'row' }, custom, colorIn),
          el('div', { class: 'field-hint', text: t('signature.stampOwnHint') })),
        customPrev)),
    buttons: [{ label: t('common.cancel') }, { label: t('signature.stampUseOwn'), primary: true, run: async () => {
      if (!custom.value.trim()) { toast(t('signature.stampPickOrType'), { type: 'warn' }); return false; }
      return { canvas: await stampCanvas(custom.value.trim().toLocaleUpperCase(locale()), colorIn.value, { date: dateChk.checked, sub: sub.value }) };
    } }],
  });
  if (!res?.canvas) return;
  const c = res.canvas;
  const assetId = d.addAsset(c.toDataURL('image/png'), c.width, c.height);
  setTool('place', { place: { assetId, w: c.width, h: c.height, kind: 'stamp', label: t('signature.stampTitle'), defaultW: (c.width / 4) * 0.9 } });
  toast(t('signature.stampPlaceHint'), { timeout: 3000 });
  void chosen;
}
