'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
// Sistem penceresi (aç/kaydet/klasör) açıkken arayüz bunu bilsin: meşgul göstergesi pencereyi kapatmasın
const dlg = (ch) => async (...args) => {
  window.dispatchEvent(new Event('pu:sysdialog-open'));
  try { return await ipcRenderer.invoke(ch, ...args); } finally { window.dispatchEvent(new Event('pu:sysdialog-close')); }
};
const sub = (ch, fn) => {
  if (typeof fn !== 'function') return () => {};
  const listener = (e, payload) => fn(payload);
  ipcRenderer.on(ch, listener);
  return () => ipcRenderer.removeListener(ch, listener);
};

contextBridge.exposeInMainWorld('pu', {
  ready: inv('app:ready'),
  setSettings: inv('settings:set'),
  setTheme: inv('theme:set'),
  openPdfDialog: dlg('dialog:openPdf'),
  openFilesDialog: dlg('dialog:openFiles'),
  readPdf: inv('file:readPdf'),
  exists: inv('file:exists'),
  saveDialog: dlg('dialog:save'),
  folderDialog: dlg('dialog:folder'),
  writeFile: inv('file:write'),
  writeInFolder: inv('file:writeInFolder'),
  stat: inv('file:stat'),
  showItem: inv('shell:showItem'),
  openPath: inv('shell:openPath'),
  addRecent: inv('recent:add'),
  removeRecent: inv('recent:remove'),
  printImages: dlg('print:images'),
  officeInfo: inv('office:info'),
  officeToPdf: inv('office:toPdf'),
  setTitle: inv('win:setTitle'),
  fullscreen: inv('win:fullscreen'),
  readFont: inv('fonts:read'),
  writeClipboardImage: inv('clipboard:writeImage'),
  log: inv('app:log'),
  openLog: inv('app:openLog'),
  confirmClose: inv('app:confirmClose'),
  // Arayüz dili: boot → { lang }, set(kod) → kalıcı kaydeder (ana süreç pencereleri de bu dili kullanır)
  i18n: {
    boot: inv('i18n:boot'),
    set: inv('i18n:set'),
  },
  // Claude bağlantısı (yerel MCP köprüsü)
  claude: {
    status: inv('claude:status'),
    setEnabled: inv('claude:setEnabled'),
    openBundle: inv('claude:openBundle'),
    checkPath: inv('claude:checkPath'),
    reply: inv('claude:reply'),
  },
  // Kayıtlı iş akışları: klasördeki PDF'leri listele; çıktıyı var olan dosyanın üzerine yazmadan kaydet
  workflow: {
    pickFolder: dlg('workflow:pickFolder'),
    write: inv('workflow:write'),
  },
  // Pro lisansı (doğrulama ana süreçte yapılır)
  license: {
    status: inv('license:status'),
    activate: (text) => ipcRenderer.invoke('license:activate', typeof text === 'string' ? text.slice(0, 64 * 1024) : ''),
    importFile: dlg('license:importFile'),
    remove: inv('license:remove'),
    onChange: (fn) => sub('license:changed', fn),
  },
  // İsteğe bağlı güncelleme bildirimi (istekler yalnızca ana süreçten, yalnızca izin varsa)
  update: {
    getPrefs: inv('update:getPrefs'),
    setPrefs: (p) => ipcRenderer.invoke('update:setPrefs', { updateCheck: !!(p && p.updateCheck === true) }),
    checkNow: inv('update:checkNow'),
    openDownload: inv('update:openDownload'),
    onAvailable: (fn) => sub('update:available', fn),
  },
  // Sitemizin sabit sayfaları: 'pricing' | 'support'
  openSite: (kind) => ipcRenderer.invoke('site:open', kind === 'pricing' || kind === 'support' ? kind : ''),
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return ''; }
  },
  on: (ch, fn) => {
    const allowed = ['open-files', 'close-request', 'claude:call', 'claude:cancel', 'claude:clients'];
    if (!allowed.includes(ch)) return () => {};
    const listener = (e, ...args) => fn(...args);
    ipcRenderer.on(ch, listener);
    return () => ipcRenderer.removeListener(ch, listener);
  },
});
