// HermoPDF site: menü, kopyala düğmeleri, çerezsiz sayaç (GoatCounter, yalnız yapılandırılmışsa).
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');
  var cfg = {};
  try { cfg = JSON.parse(document.getElementById('site-config').textContent); } catch (e) { /* yapılandırma yok */ }
  window.UX = { cfg: cfg };

  // Mobil menü
  var header = document.querySelector('.site-header');
  var btn = header && header.querySelector('.menu-btn');
  if (btn) {
    var setOpen = function (open) {
      header.classList.toggle('nav-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    btn.addEventListener('click', function () { setOpen(!header.classList.contains('nav-open')); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('nav-open')) { setOpen(false); btn.focus(); }
    });
    header.querySelectorAll('.site-nav a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
  }

  // Tema düğmesi (üst bar). Varsayılan: sistem tercihi. Elle seçim localStorage'da ('light' | 'dark');
  // sistemle aynı olan seçim kaydedilmez, yani sayfa yeniden sistemi izler. data-theme ilk boyamadan önce
  // <head>'deki küçük betikle konur (build.mjs → jsClassScript).
  var themeBtn = document.querySelector('.theme-btn');
  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var sysTheme = function () { return mqDark && mqDark.matches ? 'dark' : 'light'; };
  var curTheme = function () { return root.getAttribute('data-theme') || sysTheme(); };
  var syncTheme = function () {
    var cur = curTheme();
    if (themeBtn) {
      var lbl = themeBtn.getAttribute(cur === 'dark' ? 'data-to-light' : 'data-to-dark');
      themeBtn.setAttribute('aria-label', lbl);
      themeBtn.setAttribute('title', lbl);
      themeBtn.setAttribute('data-cur', cur);
    }
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.setAttribute('content', cur === 'dark' ? '#15161d' : '#F2E4C8');
    });
  };
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = curTheme() === 'dark' ? 'light' : 'dark';
      try {
        if (next === sysTheme()) localStorage.removeItem('theme'); else localStorage.setItem('theme', next);
      } catch (e) { /* gizli pencere vb.: yalnız bu sayfada geçerli */ }
      if (next === sysTheme()) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', next);
      syncTheme();
    });
  }
  if (mqDark && mqDark.addEventListener) mqDark.addEventListener('change', syncTheme);
  syncTheme();

  // Kopyala: <button data-copy="hedef-id">
  var tt = cfg.t || {};
  var labels = { ok: tt.copied || 'Copied', fail: tt.copyFail || 'Select and copy manually' };
  window.UX.copyText = function (text, button) {
    var orig = button ? button.getAttribute('data-label') || button.textContent : '';
    if (button && !button.getAttribute('data-label')) button.setAttribute('data-label', orig);
    var done = function (ok) {
      if (!button) return;
      button.textContent = ok ? labels.ok : labels.fail;
      setTimeout(function () { button.textContent = button.getAttribute('data-label'); }, 1800);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else { done(false); }
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    var el = document.getElementById(b.getAttribute('data-copy'));
    if (el) window.UX.copyText(el.textContent.trim(), b);
  });

  // ---------- Dil ----------
  // Tercih localStorage 'lang' anahtarında. Dil bağlantısına tıklamak tercihi kaydeder; <head>'deki küçük betik,
  // dışarıdan gelinen sayfanın tercih edilen dilde çevirisi varsa ilk boyamadan önce oraya geçer.
  var store = function (k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* gizli pencere */ }
    return null;
  };
  var curLang = root.getAttribute('lang') || 'en';
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-lang]');
    if (a) store('lang', a.getAttribute('data-lang'));
  });

  // Dil seçici: aranabilir açılır liste (details/summary; JS yoksa da açılır ve bağlantılar çalışır).
  var menu = document.querySelector('.lang-menu');
  if (menu) {
    var det = menu.querySelector('details'), sum = menu.querySelector('summary');
    var q = menu.querySelector('.lang-q'), empty = menu.querySelector('.lang-empty');
    var links = Array.prototype.slice.call(menu.querySelectorAll('.lang-list a'));
    var norm = function (s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); };
    var visible = function () { return links.filter(function (a) { return !a.parentNode.hidden; }); };
    var filter = function () {
      var v = norm(q.value), n = 0;
      links.forEach(function (a) { var ok = !v || a.getAttribute('data-k').indexOf(v) > -1; a.parentNode.hidden = !ok; if (ok) n++; });
      empty.hidden = n > 0;
    };
    det.addEventListener('toggle', function () {
      if (!det.open) return;
      q.value = ''; filter();
      // Fareyle açılınca arama kutusuna, dokunmatikte klavye açılmasın diye seçili dile odaklan.
      var cur = menu.querySelector('.lang-list a[aria-current]');
      if (matchMedia('(pointer: fine)').matches) q.focus(); else if (cur) cur.focus();
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    });
    q.addEventListener('input', filter);
    menu.addEventListener('keydown', function (e) {
      if (!det.open) return;
      var vis = visible(), i = vis.indexOf(document.activeElement);
      if (e.key === 'Escape') { det.open = false; sum.focus(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { (vis[i + 1] || vis[0] || q).focus(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { (i > 0 ? vis[i - 1] : q).focus(); e.preventDefault(); }
      else if (e.key === 'Enter' && document.activeElement === q && vis.length) { e.preventDefault(); vis[0].click(); }
    });
    document.addEventListener('click', function (e) { if (det.open && !menu.contains(e.target)) det.open = false; });
    menu.addEventListener('focusout', function (e) { if (det.open && e.relatedTarget && !menu.contains(e.relatedTarget)) det.open = false; });
  }

  // İlk ziyaret: tarayıcı dili desteklenen başka bir dilse bir kez öneri göster (yönlendirme yok).
  // Metinler küçük bir JSON'dan, sayfa yüklendikten sonra boşta gelir; ilk boyamayı geciktirmez, sabit konumlu olduğu için sayfa kaymaz.
  function suggestLang() {
    if (store('lang') || !cfg.suggest || !window.fetch) return;
    var avail = {};
    document.querySelectorAll('a[data-lang]').forEach(function (a) { avail[a.getAttribute('data-lang')] = a.getAttribute('href'); });
    var codes = Object.keys(avail), lc = {};
    codes.forEach(function (c) { lc[c.toLowerCase()] = c; });
    var pick = null, prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < prefs.length && !pick; i++) {
      var p = String(prefs[i]).toLowerCase(), pri = p.split('-')[0];
      pick = lc[p] || (pri === 'zh' ? 'zh-Hans' : pri === 'pt' ? 'pt-BR' : lc[pri]) || null;
      if (pick && !avail[pick]) pick = null;
    }
    if (!pick || pick === curLang) return;
    fetch(cfg.suggest).then(function (r) { return r.json(); }).then(function (d) {
      var m = d[pick];
      if (!m || document.querySelector('.lang-toast')) return;
      var box = document.createElement('div');
      box.className = 'lang-toast'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', m.text);
      box.setAttribute('lang', pick); box.setAttribute('dir', m.dir || 'ltr');
      var p = document.createElement('p'); p.textContent = m.text;
      var row = document.createElement('div'); row.className = 'row';
      var go = document.createElement('a'); go.className = 'btn btn-primary btn-sm'; go.href = avail[pick];
      go.setAttribute('hreflang', pick); go.setAttribute('data-lang', pick); go.textContent = m.go;
      var stay = document.createElement('button'); stay.type = 'button'; stay.className = 'btn btn-ghost btn-sm'; stay.textContent = m.stay;
      stay.addEventListener('click', function () { store('lang', curLang); box.remove(); });
      row.appendChild(go); row.appendChild(stay); box.appendChild(p); box.appendChild(row);
      document.body.appendChild(box);
    }).catch(function () { /* öneri yalnız kolaylık */ });
  }
  var idle = window.requestIdleCallback || function (f) { setTimeout(f, 600); };
  if (document.readyState === 'complete') idle(suggestLang); else window.addEventListener('load', function () { idle(suggestLang); });

  // GoatCounter: çerez yok, yalnız yol (sorgu dizesi asla gönderilmez).
  window.UX.count = function () {};
  if (cfg.goatcounter && /^[a-z0-9-]+$/.test(cfg.goatcounter)) {
    window.goatcounter = { no_onload: true };
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://gc.zgo.at/count.js';
    s.setAttribute('data-goatcounter', 'https://' + cfg.goatcounter + '.goatcounter.com/count');
    s.onload = function () {
      if (!window.goatcounter || !window.goatcounter.count) return;
      window.goatcounter.count({ path: location.pathname });
      window.UX.count = function (name) { try { window.goatcounter.count({ path: name, title: name, event: true }); } catch (e) { /* yoksay */ } };
    };
    document.head.appendChild(s);
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-gc]');
      if (a) window.UX.count(a.getAttribute('data-gc'));
    });
  }
})();
