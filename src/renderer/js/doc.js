// Açık bir PDF belgesi: pdf.js görüntüleyici + düzenlenebilir nesne katmanı + geri al/yinele + kaydetme.
import { App } from './state.js';
import { el, uid, toast, promptBox, confirmBox, baseName, fmtBytes, busy } from './util.js';
import { getPdfjs, getViewerLib, pdfjsOpenOptions, loadPdfLib, savePdfLib, PDFLib } from './pdfcore.js';
import { renderLayer, attachLayerEvents } from './overlay.js';
import { flattenInto } from './flatten.js';
import { t } from './i18n.js';

let pageViewPatched = false;
const busToDoc = new WeakMap();

function patchPageView() {
  if (pageViewPatched) return;
  pageViewPatched = true;
  const { PDFPageView } = getViewerLib();
  const origReset = PDFPageView.prototype.reset;
  // pdf.js yakınlaştırmada sayfa div'ini temizler; bizim katmanımızı hemen geri tak (titreme olmasın)
  PDFPageView.prototype.reset = function (...args) {
    const r = origReset.apply(this, args);
    const doc = busToDoc.get(this.eventBus);
    if (doc) doc.attachLayer(this);
    return r;
  };
}

// pdf.js izin bayrakları → pdf-lib encrypt() izinleri (null = kısıtlama yok)
function permsFromPdfjs(flags) {
  if (!flags) return { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true };
  const set = new Set(flags); // pdf.js sürümüne göre dizi ya da Set
  const has = (f) => set.has(f);
  return {
    printing: !has(0x04) ? false : has(0x800) ? 'highResolution' : 'lowResolution',
    modifying: has(0x08), copying: has(0x10), annotating: has(0x20), fillingForms: has(0x100),
    contentAccessibility: has(0x200), documentAssembly: has(0x400),
  };
}
function randomOwnerPassword() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function hasEncryptMarker(bytes) {
  const pat = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  const n = bytes.length - pat.length;
  outer: for (let i = 0; i < n; i++) {
    if (bytes[i] !== 0x2f) continue;
    for (let j = 1; j < pat.length; j++) if (bytes[i + j] !== pat[j]) continue outer;
    return true;
  }
  return false;
}

export class PdfDoc {
  constructor(file) {
    this.id = uid();
    this.path = file.path || null;
    this.name = file.name || t('doc.untitled');
    this.fileSize = file.size || file.bytes?.length || 0;
    this.baseBytes = file.bytes;
    this.encryption = null; // kaydederken yeniden şifreleme bilgisi
    this.pageObjs = [];
    this.assets = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.formsModified = false;
    this.pdf = null;
    this.task = null;
    this.layers = [];
    this.pageInfoCache = new Map();
    this.textCache = new Map();
    this.selection = new Set();
    this.el = null;
  }

  // ---------------- yükleme ----------------
  static async open(file) {
    const doc = new PdfDoc(file);
    await doc.loadInitial();
    return doc;
  }

  async loadInitial() {
    const pdfjs = getPdfjs();
    let password = null;
    let perms = null; // pdf.js izin bayrakları (null = kısıtlama yok)
    const encrypted = hasEncryptMarker(this.baseBytes);
    // Parola gerekiyorsa sor
    for (let attempt = 0; ; attempt++) {
      const task = pdfjs.getDocument(pdfjsOpenOptions(this.baseBytes, password != null ? { password } : {}));
      try {
        const pdf = await task.promise;
        if (!encrypted) {
          this.task = task;
          this.pdf = pdf;
          break;
        }
        perms = await pdf.getPermissions().catch(() => null);
        await task.destroy();
        break;
      } catch (e) {
        await task.destroy().catch(() => {});
        if (e?.name === 'PasswordException') {
          const pw = await promptBox(attempt === 0 ? t('doc.passwordPrompt', { name: this.name }) : t('doc.passwordWrong'), { title: t('doc.passwordTitle'), type: 'password', ok: t('doc.open') });
          if (pw == null) throw Object.assign(new Error(t('doc.noPassword')), { cancelled: true });
          password = pw;
          continue;
        }
        throw e;
      }
    }
    if (encrypted) {
      // Düzenleyebilmek için şifreyi çöz; kaydederken aynı parolayla yeniden şifrelenir
      try {
        const lib = await loadPdfLib(this.baseBytes, password ?? '');
        const wasEncrypted = !!lib.context.isDecrypted || password != null;
        this.baseBytes = await savePdfLib(lib);
        // Koruma kayıtta korunur: aynı açma parolası (yalnız sahip parolalıysa boş) + özgün izinler.
        // Sahip parolası bilinmediği için rastgele üretilir; böylece kısıtlamalar parolasız kaldırılamaz.
        if (wasEncrypted) this.encryption = { userPassword: password ?? '', ownerPassword: randomOwnerPassword(), permissions: permsFromPdfjs(perms) };
        this.openedPassword = password;
      } catch (e) {
        console.warn('Şifre çözülemedi, salt okunur', e);
        this.readOnlyReason = t('doc.decryptFailed');
      }
      const task = pdfjs.getDocument(pdfjsOpenOptions(this.baseBytes, this.readOnlyReason && password != null ? { password } : {}));
      this.task = task;
      this.pdf = await task.promise;
    }
    this.pageObjs = Array.from({ length: this.pdf.numPages }, () => []);
    this.hookPdf();
  }

  hookPdf() {
    // pdf.js form alanlarını ilk çizerken de depolamaya yazar; yalnızca kullanıcı girişini değişiklik say
    this.pdf.annotationStorage.onSetModified = () => {
      if (this.userFormInput) { this.formsModified = true; this.markDirty(); }
    };
  }

  get numPages() { return this.pdf ? this.pdf.numPages : 0; }

  // ---------------- görüntüleyici ----------------
  mount(host) {
    patchPageView();
    const { EventBus, PDFLinkService, PDFFindController, PDFViewer, LinkTarget } = getViewerLib();
    const pdfjs = getPdfjs();
    this.el = el('div', { class: 'doc-view', dataset: { doc: this.id } });
    this.container = el('div', { class: 'viewer-container', tabindex: '0' });
    this.viewerDiv = el('div', { class: 'pdfViewer' });
    this.container.append(this.viewerDiv);
    this.el.append(this.container);
    host.append(this.el);

    this.eventBus = new EventBus();
    busToDoc.set(this.eventBus, this);
    this.linkService = new PDFLinkService({ eventBus: this.eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer' });
    this.findController = new PDFFindController({ eventBus: this.eventBus, linkService: this.linkService, updateMatchesCountOnProgress: true });
    this.viewer = new PDFViewer({
      container: this.container,
      viewer: this.viewerDiv,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      textLayerMode: 1,
      annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
      maxCanvasPixels: 2 ** 25,
      enableHWA: true,
    });
    this.linkService.setViewer(this.viewer);
    this.eventBus.on('pagesinit', () => {
      this.viewer.currentScaleValue = App.settings.defaultZoom || 'auto';
      this.viewer.getCachedPageViews?.();
      for (let i = 0; i < this.viewer.pagesCount; i++) this.attachLayer(this.viewer.getPageView(i));
      if (this.restoreView) {
        const r = this.restoreView;
        this.restoreView = null;
        if (r.scaleValue) this.viewer.currentScaleValue = r.scaleValue;
        this.viewer.currentPageNumber = Math.min(r.page, this.numPages);
        if (r.scrollTop != null) requestAnimationFrame(() => { this.container.scrollTop = r.scrollTop; this.container.scrollLeft = r.scrollLeft; });
      }
      App.emit('doc:pagesinit', this);
    });
    this.eventBus.on('pagerendered', ({ pageNumber }) => {
      const pv = this.viewer.getPageView(pageNumber - 1);
      if (pv) this.attachLayer(pv);
    });
    this.eventBus.on('pagechanging', () => App.emit('doc:page', this));
    this.eventBus.on('scalechanging', () => App.emit('doc:scale', this));
    this.eventBus.on('updatefindmatchescount', (e) => App.emit('find:count', this, e.matchesCount));
    this.eventBus.on('updatefindcontrolstate', (e) => App.emit('find:state', this, e));
    attachLayerEvents(this);
    const formInput = (e) => {
      if (!e.target.closest?.('.annotationLayer')) return;
      this.userFormInput = true;
      this.formsModified = true;
      this.markDirty();
    };
    this.container.addEventListener('input', formInput, true);
    this.container.addEventListener('change', formInput, true);
    this.setViewerDocument();
  }

  setViewerDocument() {
    this.layers = [];
    this.pageInfoCache.clear();
    this.textCache.clear();
    this.viewer.setDocument(this.pdf);
    this.linkService.setDocument(this.pdf, null);
  }

  attachLayer(pageView) {
    if (!pageView?.div) return;
    const i = pageView.id - 1;
    let layer = this.layers[i];
    if (!layer) {
      layer = el('div', { class: 'pu-layer', dataset: { page: String(i) } });
      this.layers[i] = layer;
      renderLayer(this, i);
    }
    if (layer.parentNode !== pageView.div) pageView.div.append(layer);
  }

  get currentPageIndex() { return this.viewer ? this.viewer.currentPageNumber - 1 : 0; }
  goToPage(i) {
    if (!this.viewer) return;
    const n = Math.max(1, Math.min(this.numPages, i + 1));
    // Sayfa işleminden sonra görüntüleyici yeni baytları henüz hazırlamadıysa sayfayı 'pagesinit'te uygula
    if (this.restoreView) { this.restoreView = { ...this.restoreView, page: n, scrollTop: null }; return; }
    try { this.viewer.currentPageNumber = n; } catch (e) { /* görüntüleyici hazır değil */ }
  }

  // Sayfa bilgisi: görünen çerçeve (nokta) ve PDF kullanıcı uzayına dönüşüm matrisleri
  async pageInfo(i) {
    if (this.pageInfoCache.has(i)) return this.pageInfoCache.get(i);
    const { Util } = getPdfjs();
    const page = await this.pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const T = vp.transform; // kullanıcı uzayı -> görünen (sol üst, y aşağı)
    const Ti = Util.inverseTransform(T);
    const H = vp.height;
    const M = Util.transform(Ti, [1, 0, 0, -1, 0, H]); // görünen (sol alt, y yukarı) -> kullanıcı uzayı
    const info = { w: vp.width, h: vp.height, rotate: page.rotate, view: page.view, T, Ti, M };
    this.pageInfoCache.set(i, info);
    return info;
  }
  pageInfoSync(i) {
    return this.pageInfoCache.get(i) || null;
  }

  async textContent(i) {
    if (!this.textCache.has(i)) {
      this.textCache.set(i, this.pdf.getPage(i + 1).then((p) => p.getTextContent()));
    }
    return this.textCache.get(i);
  }

  // ---------------- nesneler ----------------
  findObj(id) {
    for (let p = 0; p < this.pageObjs.length; p++) {
      const o = this.pageObjs[p].find((x) => x.id === id);
      if (o) return { page: p, obj: o };
    }
    return null;
  }

  addObj(page, obj, { select = true, label = t('doc.addObject') } = {}) {
    this.snapshot(label);
    obj.id = obj.id || uid();
    this.pageObjs[page].push(obj);
    if (select) { this.selection = new Set([obj.id]); }
    renderLayer(this, page);
    App.emit('selection', this);
    return obj;
  }

  removeObjs(ids, label = t('common.delete')) {
    if (!ids.length) return;
    this.snapshot(label);
    const pages = new Set();
    for (const id of ids) {
      const f = this.findObj(id);
      if (!f) continue;
      this.pageObjs[f.page] = this.pageObjs[f.page].filter((o) => o.id !== id);
      pages.add(f.page);
      this.selection.delete(id);
    }
    pages.forEach((p) => renderLayer(this, p));
    App.emit('selection', this);
  }

  selectedObjs() {
    return [...this.selection].map((id) => this.findObj(id)).filter(Boolean);
  }

  setSelection(ids) {
    const before = [...this.selection];
    this.selection = new Set(ids);
    const pages = new Set();
    for (const id of [...before, ...ids]) {
      const f = this.findObj(id);
      if (f) pages.add(f.page);
    }
    pages.forEach((p) => renderLayer(this, p));
    App.emit('selection', this);
  }

  addAsset(dataURL, w, h) {
    for (const [id, a] of this.assets) if (a.dataURL === dataURL) return id;
    const id = uid();
    this.assets.set(id, { dataURL, w, h });
    return id;
  }

  // ---------------- geri al / yinele ----------------
  cloneObjs() {
    return this.pageObjs.map((arr) => arr.map((o) => JSON.parse(JSON.stringify(o))));
  }

  snapshot(label, { bytes = false } = {}) {
    this.undoStack.push({ label, objs: this.cloneObjs(), bytes: bytes ? this.baseBytes : null, forms: bytes ? this.formsModified : null });
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
    this.#trimBytes();
    this.markDirty();
    App.emit('history', this);
  }

  // Bayt anlık görüntüleri bellek tüketir: en fazla 25 tane ve toplam boyut sınırı.
  // Baytı atılacak sayfa adımı ve öncesi tümüyle silinir (eski nesne düzeni güncel sayfalara uygulanmasın).
  #trimBytes() {
    const budget = Math.max(400e6, 3 * (this.baseBytes?.length || 0));
    let n = 0, total = 0;
    for (let k = this.undoStack.length - 1; k >= 0; k--) {
      const b = this.undoStack[k].bytes;
      if (!b) continue;
      total += b.length;
      if (++n > 25 || total > budget) { this.undoStack.splice(0, k + 1); break; }
    }
    n = 0; total = 0;
    for (let k = this.redoStack.length - 1; k >= 0; k--) {
      const b = this.redoStack[k].bytes;
      if (!b) continue;
      total += b.length;
      if (++n > 25 || total > budget) { this.redoStack.splice(0, k + 1); break; }
    }
  }

  // Geri al / yinele / sayfa işlemi / kaydetme sırayla çalışsın
  #queue = Promise.resolve();
  #serial(fn) {
    const p = this.#queue.then(fn, fn);
    this.#queue = p.catch(() => {});
    return p;
  }

  async undo() { return this.#serial(() => this.#travel(this.undoStack, this.redoStack, t('doc.undone'))); }
  async redo() { return this.#serial(() => this.#travel(this.redoStack, this.undoStack, t('doc.redone'))); }

  async #travel(from, to, verb) {
    const s = from.pop();
    if (!s) return;
    // Yazılan form değerleri karşı yığına giren baytlarda kalsın
    if (s.bytes) await this.bakeForms();
    to.push({ label: s.label, objs: this.cloneObjs(), bytes: s.bytes ? this.baseBytes : null });
    this.#trimBytes();
    this.pageObjs = s.objs;
    this.selection.clear();
    if (s.bytes) {
      await this.reloadBytes(s.bytes, { keepObjs: true });
    } else {
      this.layers.forEach((l, i) => l && renderLayer(this, i));
    }
    this.markDirty();
    App.emit('history', this);
    App.emit('selection', this);
    toast(`${verb}: ${s.label}`, { timeout: 1500 });
  }

  markDirty() {
    this.rev = (this.rev || 0) + 1; // kaydetme sırasında gelen düzenlemeleri fark etmek için
    if (!this.dirty) {
      this.dirty = true;
      App.emit('doc:dirty', this);
    }
  }
  markClean() {
    this.dirty = false;
    App.emit('doc:dirty', this);
  }

  // ---------------- bayt değişimi (sayfa işlemleri) ----------------
  // pdf.js'teki form değerlerini baytlara işle
  async bakeForms() {
    if (!this.formsModified) return this.baseBytes;
    const bytes = await this.pdf.saveDocument();
    this.baseBytes = bytes;
    this.formsModified = false;
    return bytes;
  }

  // fn(pdfLibDoc) yeni sayfa sırasını döndürür: her eleman eski indeks ya da null (yeni sayfa)
  async structural(label, fn, { flattenPages = null } = {}) {
    const b = busy(`${label}…`);
    try {
      return await this.#serial(() => this.#structural(label, fn, { flattenPages }));
    } finally {
      b.done();
    }
  }

  async #structural(label, fn, { flattenPages = null } = {}) {
    // Form değerleri anlık görüntüye girsin: önce işle, sonra kaydet
    await this.bakeForms();
    this.snapshot(label, { bytes: true });
    try {
      const lib = await loadPdfLib(this.baseBytes);
      const n = lib.getPageCount();
      if (flattenPages && flattenPages.some((p) => this.pageObjs[p]?.length)) {
        // Bu işlem sayfa çerçevesini değiştiriyor: o sayfalardaki düzenlemeleri önce sayfaya işle
        await flattenInto(lib, this, { pages: flattenPages });
        for (const p of flattenPages) this.pageObjs[p] = [];
      }
      const order = (await fn(lib)) || Array.from({ length: n }, (_, k) => k);
      const bytes = await savePdfLib(lib);
      const oldObjs = this.pageObjs;
      const used = new Set();
      this.pageObjs = order.map((k) => {
        if (k == null || !oldObjs[k]) return [];
        if (used.has(k)) return oldObjs[k].map((o) => ({ ...JSON.parse(JSON.stringify(o)), id: uid() }));
        used.add(k);
        return oldObjs[k];
      });
      this.selection.clear();
      await this.reloadBytes(bytes, { keepObjs: true });
      this.markDirty();
      App.emit('doc:structure', this);
      return true;
    } catch (e) {
      // başarısız: anlık görüntüyü geri çıkar
      const s = this.undoStack.pop();
      if (s) this.pageObjs = s.objs;
      throw e;
    }
  }

  async reloadBytes(bytes, { keepObjs = false } = {}) {
    const pdfjs = getPdfjs();
    const restore = this.viewer
      ? { page: this.viewer.currentPageNumber, scaleValue: this.viewer.currentScaleValue, scrollTop: this.container.scrollTop, scrollLeft: this.container.scrollLeft }
      : null;
    const task = pdfjs.getDocument(pdfjsOpenOptions(bytes));
    let pdf;
    try { pdf = await task.promise; } catch (e) { task.destroy().catch(() => {}); throw e; }
    const oldTask = this.task;
    this.baseBytes = bytes;
    this.task = task;
    this.pdf = pdf;
    this.formsModified = false;
    this.hookPdf();
    if (!keepObjs || this.pageObjs.length !== pdf.numPages) {
      const objs = this.pageObjs;
      this.pageObjs = Array.from({ length: pdf.numPages }, (_, k) => (keepObjs && objs[k]) || []);
    }
    if (this.viewer) {
      this.restoreView = restore;
      this.setViewerDocument();
    }
    oldTask && oldTask.destroy().catch(() => {});
    App.emit('doc:reloaded', this);
  }

  // ---------------- çıktı / kaydetme ----------------
  hasObjects() { return this.pageObjs.some((a) => a.length); }

  async buildBytes({ encrypt = true, flatten = true } = {}) {
    let bytes = this.baseBytes;
    if (this.formsModified) bytes = await this.pdf.saveDocument();
    const needObjs = flatten && this.hasObjects();
    const needEnc = encrypt && this.encryption;
    if (!needObjs && !needEnc && !this.forceRewrite) return bytes;
    const lib = await loadPdfLib(bytes);
    if (needObjs) await flattenInto(lib, this);
    if (needEnc) {
      // pdf-lib PDF/A belgeyi şifrelemeyi reddeder: PDF/A işaretlerini kaldır (şifreli dosya zaten PDF/A olamaz)
      try {
        lib.encrypt({ ...this.encryption });
      } catch (e) {
        if (!/PDF\/A/i.test(e.message || '')) throw e;
        const { PDFName } = PDFLib();
        lib.catalog.delete(PDFName.of('Metadata'));
        lib.catalog.delete(PDFName.of('OutputIntents'));
        lib.encrypt({ ...this.encryption });
        if (!this.pdfaWarned) { this.pdfaWarned = true; toast(t('doc.pdfaRemoved'), { type: 'warn' }); }
      }
    }
    return savePdfLib(lib);
  }

  async save({ as = false, quiet = false } = {}) {
    if (this.readOnlyReason && !as) toast(this.readOnlyReason, { type: 'warn' });
    let target = this.path;
    if (as || !target) {
      target = await window.pu.saveDialog({ defaultName: as && this.path ? t('doc.editedName', { name: baseName(this.name) }) : this.name, title: t('doc.saveAs'), defaultDir: this.path ? this.path.replace(/[\\/][^\\/]*$/, '') : undefined });
      if (!target) return false;
    }
    // Hedef başka bir sekmede açıksa: kaydedilmemiş değişiklik varsa sor, kayıttan sonra o sekmeyi kapat
    const other = App.docForPath?.(target, this);
    if (other && other.dirty && !(await confirmBox(t('doc.overwriteOther', { name: other.name }), { title: t('doc.overwrite'), ok: t('doc.overwrite'), danger: true }))) return false;
    const info = await this.#serial(async () => {
      const rev = this.rev;
      const b = busy(t('doc.saving'));
      let bytes;
      try {
        bytes = await this.buildBytes();
      } finally {
        b.done();
      }
      const r = await window.pu.writeFile(target, bytes, { recent: true });
      this.path = r.path;
      this.name = r.name;
      this.fileSize = r.size;
      this.forceRewrite = false;
      // Kaydetme sürerken yapılan düzenlemeler kaybolmasın: doküman kirli kalır, otomatik kayıt yeniden kurulur
      if (this.rev === rev) this.markClean();
      else App.emit('doc:dirty', this);
      return r;
    });
    if (other && App.docs.includes(other)) await App.closeDoc?.(other, { force: true });
    App.emit('doc:saved', this);
    if (!quiet) toast(t('doc.saved', { name: info.name, size: fmtBytes(info.size) }), { type: 'ok' });
    return true;
  }

  destroy() {
    try { this.task && this.task.destroy(); } catch (e) { /* yoksay */ }
    this.el && this.el.remove();
  }
}
