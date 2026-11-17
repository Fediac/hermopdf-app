// Genel yardımcılar: DOM, bildirimler, iletişim kutuları, ilerleme göstergesi, sağ tık menüsü.
import { icon } from './icons.js';
import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function baseName(name) {
  return String(name || 'belge').replace(/\.pdf$/i, '');
}

// "1-3, 5, 8-" gibi sayfa aralıklarını 0 tabanlı indekslere çevirir
export function parseRanges(str, total) {
  const out = new Set();
  const s = String(str || '').replace(/\s+/g, '');
  if (!s) return [];
  for (const part of s.split(/[,;]/)) {
    if (!part) continue;
    const m = /^(\d*)-(\d*)$/.exec(part);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : total;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= total) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const i = parseInt(part, 10);
      if (i >= 1 && i <= total) out.add(i - 1);
    } else {
      throw new Error(t('common.badRange', { part }));
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function rangesToText(indices) {
  const a = [...indices].sort((x, y) => x - y);
  const parts = [];
  for (let i = 0; i < a.length; i++) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    parts.push(i === j ? `${a[i] + 1}` : `${a[i] + 1}-${a[j] + 1}`);
    i = j;
  }
  return parts.join(', ');
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
export function dataURLToBytes(url) {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function canvasToBlob(canvas, type = 'image/png', q) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(t('common.imageCreateFailed')))), type, q));
}
export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(t('common.imageReadFailed')));
    img.src = src;
  });
}

export async function copyImageToClipboard(blobOrCanvas) {
  let blob = blobOrCanvas;
  if (blobOrCanvas instanceof HTMLCanvasElement) blob = await canvasToBlob(blobOrCanvas, 'image/png');
  if (blob.type !== 'image/png') {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    blob = await canvasToBlob(c, 'image/png');
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (e) {
    // pencere odakta değilse tarayıcı panosu reddeder; ana süreç üzerinden yaz
    await window.pu.writeClipboardImage(new Uint8Array(await blob.arrayBuffer()));
  }
}

// ---------------- bildirim ----------------
export function toast(msg, { type = 'info', timeout = 3500, action } = {}) {
  let host = $('#toasts');
  if (!host) { host = el('div', { id: 'toasts' }); document.body.append(host); }
  const ic = { ok: 'circle-check', error: 'circle-x', warn: 'triangle-alert', info: 'info' }[type] || 'info';
  const t = el('div', { class: `toast ${type}`, html: `${icon(ic)}<span></span>` });
  // IPC hatalarının ham önekini gösterme
  t.querySelector('span').textContent = String(msg).replace(/Error invoking remote method '[^']+': (Error: )?/g, '');
  if (action) {
    const b = el('button', { class: 'toast-act', text: action.label, onclick: () => { action.run(); t.remove(); } });
    t.append(b);
  }
  t.addEventListener('click', (e) => { if (e.target === t || e.target.tagName === 'SPAN') t.remove(); });
  host.append(t);
  if (timeout) setTimeout(() => t.classList.add('out'), timeout);
  if (timeout) setTimeout(() => t.remove(), timeout + 300);
  return t;
}

// ---------------- iletişim kutuları ----------------
let modalDepth = 0;
const modalStack = []; // açık pencereler, en üstteki sonda
export function modal({ title, body, buttons = [], width = 460, onOpen, className = '', dismissible = true }) {
  return new Promise((resolve) => {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: `modal ${className}`, style: { width: typeof width === 'number' ? `${width}px` : width }, role: 'dialog' });
    const head = el('div', { class: 'modal-head' }, el('h3', { text: title || '' }), el('button', { class: 'icon-btn modal-x', title: t('common.close'), html: icon('x') }));
    const content = el('div', { class: 'modal-body' });
    if (typeof body === 'string') content.innerHTML = body;
    else if (body) content.append(body);
    const foot = el('div', { class: 'modal-foot' });
    let done = false;
    const token = {};
    const prevFocus = document.activeElement;
    const close = (val) => {
      if (done) return;
      done = true;
      modalDepth--;
      const si = modalStack.indexOf(token);
      if (si >= 0) modalStack.splice(si, 1);
      syncBusy();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      backdrop.classList.add('out');
      setTimeout(() => backdrop.remove(), 120);
      resolve(val);
    };
    const api = { close, box, content, foot };
    for (const b of buttons) {
      const btn = el('button', { class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`, text: b.label });
      if (b.id) btn.dataset.id = b.id;
      btn.addEventListener('click', async () => {
        if (b.run) {
          const r = await b.run(api);
          if (r === false) return;
          close(r === undefined ? b.value : r);
        } else close(b.value);
      });
      foot.append(btn);
    }
    const onKey = (e) => {
      // İç içe pencerelerde tuşlara yalnız en üstteki yanıt verir
      if (modalStack[modalStack.length - 1] !== token) return;
      if (backdrop.parentNode && e.key === 'Escape' && dismissible) { e.preventDefault(); e.stopImmediatePropagation(); close(undefined); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        const inBox = box.contains(e.target);
        // Pencere dışındaki (arkadaki şerit) odaklı düğme Enter ile yeniden tıklanmasın
        if (inBox && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON')) return;
        const p = buttons.findIndex((b) => b.primary);
        if (p >= 0 || !inBox) { e.preventDefault(); e.stopImmediatePropagation(); }
        if (p >= 0 && !e.repeat) foot.children[p].click();
      }
    };
    head.querySelector('.modal-x').addEventListener('click', () => close(undefined));
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissible) backdrop.dataset.down = '1'; });
    backdrop.addEventListener('mouseup', (e) => { if (e.target === backdrop && backdrop.dataset.down) close(undefined); delete backdrop.dataset.down; });
    box.append(head, content);
    if (buttons.length) box.append(foot);
    backdrop.append(box);
    document.body.append(backdrop);
    modalStack.push(token);
    modalDepth++;
    syncBusy();
    document.addEventListener('keydown', onKey, true);
    onOpen && onOpen(api);
    const first = box.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=color]), textarea, select');
    if (first) setTimeout(() => { first.focus(); first.select && first.select(); }, 30);
    else {
      // Alan yoksa odağı pencereye al: arkadaki düğme odakta kalmasın
      const pi = buttons.findIndex((b) => b.primary);
      const target = pi >= 0 ? foot.children[pi] : box;
      if (target === box) box.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  });
}
export const isModalOpen = () => modalDepth > 0;

export function confirmBox(message, { title = t('common.confirm'), ok = t('common.ok'), cancel = t('common.cancel'), danger = false } = {}) {
  return modal({ title, body: el('p', { class: 'modal-msg', text: message }), buttons: [{ label: cancel, value: false }, { label: ok, value: true, primary: true, danger }] }).then((v) => !!v);
}

export function choiceBox(message, choices, { title = t('common.choice') } = {}) {
  return modal({ title, body: el('p', { class: 'modal-msg', text: message }), buttons: choices.map((c) => ({ label: c.label, value: c.value, primary: c.primary, danger: c.danger })) });
}

export function promptBox(message, { title = t('common.input'), value = '', placeholder = '', type = 'text', ok = t('common.ok') } = {}) {
  const input = el('input', { class: 'input', type, value, placeholder });
  const body = el('div', {}, message ? el('label', { class: 'field-label', text: message }) : null, input);
  return modal({ title, body, buttons: [{ label: t('common.cancel'), value: null }, { label: ok, primary: true, run: () => input.value }] });
}

// ---------------- ilerleme ----------------
export function progress(title) {
  const bar = el('div', { class: 'progress-fill' });
  const text = el('div', { class: 'progress-text', text: '' });
  let cancelled = false;
  const cancelBtn = el('button', { class: 'btn small', text: t('common.abort'), onclick: () => { cancelled = true; cancelBtn.disabled = true; cancelBtn.textContent = t('common.aborting'); } });
  const box = el('div', { class: 'modal progress-modal' },
    el('div', { class: 'modal-head' }, el('h3', { text: title })),
    el('div', { class: 'modal-body' }, el('div', { class: 'progress-track' }, bar), el('div', { class: 'progress-row' }, text, cancelBtn)));
  const backdrop = el('div', { class: 'modal-backdrop progress-backdrop' }, box);
  document.body.append(backdrop);
  modalDepth++;
  syncBusy();
  return {
    set(p, msg) {
      if (p != null) bar.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
      if (msg != null) text.textContent = msg;
    },
    get cancelled() { return cancelled; },
    check() { if (cancelled) throw new CancelError(); },
    close() { if (backdrop.parentNode) { backdrop.remove(); modalDepth--; syncBusy(); } },
  };
}
export class CancelError extends Error {
  constructor() { super(t('common.aborted')); this.cancelled = true; }
}
export async function withProgress(title, fn) {
  const p = progress(title);
  try {
    return await fn(p);
  } finally {
    p.close();
  }
}

// ---------------- meşgul göstergesi ----------------
// Uzun süren işlemlerde uygulamanın donmuş gibi görünmesini engeller.
// Kural: bir iletişim kutusu ya da sistem penceresi (aç/kaydet/klasör) açıkken gösterge görünmez —
// kullanıcı o an karar veriyordur ve katman pencerenin düğmelerini kapatırdı (Görsel → PDF'te
// "İşlem sürüyor" katmanı pencerenin üstünde kalıp uygulamayı kilitli gösteriyordu).
// Engel kalkınca iş hâlâ sürüyorsa kısa bir gecikmeyle yeniden görünür.
const BUSY_DELAY = 400;
let busyEl = null;
let busyTimer = null;
const busyJobs = [];
export const isBusy = () => busyJobs.length > 0;
let sysDialogs = 0;
let unblockedAt = 0;
let wasBlocked = false;
const busyBlocked = () => modalDepth > 0 || sysDialogs > 0;
function syncBusy() {
  clearTimeout(busyTimer);
  busyTimer = null;
  const now = performance.now();
  const blocked = busyBlocked();
  if (wasBlocked && !blocked) unblockedAt = now;
  wasBlocked = blocked;
  const dueAt = (j) => Math.max(j.start, unblockedAt) + BUSY_DELAY;
  const due = blocked ? [] : busyJobs.filter((j) => now >= dueAt(j));
  if (!due.length) {
    if (busyEl) { busyEl.remove(); busyEl = null; }
  } else {
    const label = due[due.length - 1].label;
    if (!busyEl) {
      busyEl = el('div', { class: 'busy-overlay' }, el('div', { class: 'busy-box' },
        el('div', { class: 'busy-spinner' }), el('div', { class: 'busy-label', text: label })));
      document.body.append(busyEl);
    } else busyEl.querySelector('.busy-label').textContent = label;
  }
  if (!blocked && due.length < busyJobs.length) {
    const next = Math.min(...busyJobs.filter((j) => !due.includes(j)).map(dueAt));
    busyTimer = setTimeout(syncBusy, Math.max(0, next - now) + 5);
  }
}
// preload, sistem penceresi açılıp kapanınca bu olayları gönderir
window.addEventListener('pu:sysdialog-open', () => { sysDialogs++; syncBusy(); });
window.addEventListener('pu:sysdialog-close', () => { sysDialogs = Math.max(0, sysDialogs - 1); syncBusy(); });
export const isBusyVisible = () => !!busyEl;

export function busy(label = t('common.working')) {
  const job = { label, start: performance.now() };
  busyJobs.push(job);
  syncBusy();
  return {
    set(text) { job.label = text; if (busyEl && busyJobs[busyJobs.length - 1] === job) busyEl.querySelector('.busy-label').textContent = text; },
    done() {
      const k = busyJobs.indexOf(job);
      if (k < 0) return;
      busyJobs.splice(k, 1);
      syncBusy();
    },
  };
}
export async function withBusy(label, fn) {
  const b = busy(label);
  try {
    await nextFrame();
    return await fn(b);
  } finally {
    b.done();
  }
}

// ---------------- sağ tık menüsü ----------------
let openMenu = null;
export function closeMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
}
export function contextMenu(x, y, items) {
  closeMenu();
  const m = el('div', { class: 'ctx-menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(el('div', { class: 'ctx-sep' })); continue; }
    if (it.header) { m.append(el('div', { class: 'ctx-header', text: it.header })); continue; }
    const b = el('button', { class: `ctx-item ${it.danger ? 'danger' : ''}`, disabled: it.disabled, html: `${icon(it.icon || 'dot', it.icon ? '' : 'blank')}<span></span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}` });
    b.querySelector('span').textContent = it.label;
    b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.run && it.run(); });
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 6)}px`;
  m.style.top = `${Math.min(y, innerHeight - r.height - 6)}px`;
  openMenu = m;
  return m;
}
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// Açılır menü (düğmeye bağlı)
export function dropdown(anchor, items) {
  const r = anchor.getBoundingClientRect();
  return contextMenu(r.left, r.bottom + 4, items);
}

// Form satırı yardımcıları
export function field(label, input, hint) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), input, hint ? el('span', { class: 'field-hint', text: hint }) : null);
}
export function select(options, value) {
  const s = el('select', { class: 'input' });
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label });
    if (String(o.value) === String(value)) opt.selected = true;
    s.append(opt);
  }
  return s;
}
