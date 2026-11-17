// Ana sayfa: hedef boyuta küçültme hareketli görseli (build.mjs {{demo:...}}; dosyalar tools/compress-demo.mjs).
// - Video yalnız görünür olunca yüklenir ve oynar, görünmezken durur (önce poster: sonuç ekranının durağan karesi).
// - "Animasyonları azalt" açıksa ya da üstteki "Hareketi durdur" basılıysa (tercih: localStorage 'sky-motion')
//   kendiliğinden oynamaz; poster kalır. Köşedeki düğme ile ziyaretçi her zaman durdurup başlatabilir.
(function () {
  'use strict';
  var figs = document.querySelectorAll('[data-demo]');
  if (!figs.length) return;
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var heroBtn = document.querySelector('.sky-motion');
  function heroFrozen() {
    if (heroBtn && (heroBtn.getAttribute('aria-pressed') === 'true' || heroBtn.getAttribute('data-paused') === 'true')) return true;
    try { return localStorage.getItem('sky-motion') === 'off'; } catch (e) { return false; }
  }
  function autoOff() { return (reduce && reduce.matches) || heroFrozen(); }

  Array.prototype.forEach.call(figs, function (fig) {
    var video = fig.querySelector('.demo-video');
    var btn = fig.querySelector('.demo-toggle');
    if (!video || !btn || typeof video.play !== 'function') return;
    var visible = false;
    var userChoice = null; // null: kendiliğinden; 'play' / 'pause': ziyaretçi düğmeye bastı
    function wanted() { return visible && (userChoice ? userChoice === 'play' : !autoOff()); }
    function sync() {
      var on = wanted();
      btn.setAttribute('aria-pressed', on ? 'false' : 'true');
      btn.setAttribute('data-paused', on ? 'false' : 'true');
      if (on) {
        if (!video.getAttribute('src')) { video.setAttribute('src', video.getAttribute('data-src')); video.preload = 'auto'; }
        var p = video.play();
        if (p && p.catch) p.catch(function () { fig.classList.remove('is-playing'); btn.setAttribute('aria-pressed', 'true'); btn.setAttribute('data-paused', 'true'); });
      } else {
        try { video.pause(); } catch (e) { /* yoksay */ }
        fig.classList.remove('is-playing');
      }
    }
    video.addEventListener('playing', function () { if (wanted()) fig.classList.add('is-playing'); });
    video.addEventListener('error', function () { fig.classList.remove('is-playing'); btn.hidden = true; });
    btn.hidden = false;
    btn.addEventListener('click', function () {
      userChoice = btn.getAttribute('aria-pressed') === 'true' ? 'play' : 'pause';
      if (userChoice === 'play') visible = true;
      sync();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        visible = es[es.length - 1].isIntersecting;
        sync();
      }, { threshold: 0.35 }).observe(fig);
    } else { visible = true; sync(); }
    if (reduce && reduce.addEventListener) reduce.addEventListener('change', sync);
    if (heroBtn && window.MutationObserver) new MutationObserver(sync).observe(heroBtn, { attributes: true, attributeFilter: ['aria-pressed', 'data-paused'] });
    sync();
  });
})();
