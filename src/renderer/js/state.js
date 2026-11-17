// Uygulama durumu ve basit olay yayıncısı (modüller arası döngüsel içe aktarmayı önler).
const listeners = new Map();

export const App = {
  docs: [],
  active: null,
  tool: 'select',
  settings: {},
  version: '',
  ribbonTab: 'home',
  // Yeni nesneler için varsayılan özellikler (araç seçenekleri)
  defaults: {
    text: { font: 'Arial', size: 12, color: '#111111', bold: false, italic: false, align: 'left' },
    ink: { color: '#1d4ed8', sw: 2, opacity: 1 },
    shape: { color: '#d32f2f', fill: '', sw: 2, opacity: 1 },
    highlight: { color: '#ffe14d', opacity: 0.45 },
    underline: { color: '#e53935', opacity: 1 },
    strike: { color: '#e53935', opacity: 1 },
    whiteout: { color: '#ffffff' },
    note: { color: '#ffd54f' },
    symbol: { color: '#1b5e20' },
  },
  on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev).delete(fn);
  },
  emit(ev, ...args) {
    for (const fn of listeners.get(ev) || []) {
      try { fn(...args); } catch (e) { console.error(ev, e); }
    }
  },
};

export function saveSetting(patch) {
  Object.assign(App.settings, patch);
  return window.pu.setSettings(patch);
}
