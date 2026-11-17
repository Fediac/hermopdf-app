// Fiyat sayfası: Freemius Checkout (satıcı: Freemius, Merchant of Record). Betik yalnız site.json → freemius.checkoutEnabled
// true ise yüklenir; false iken düğme devre dışıdır ve "yakında" gösterir (hiçbir dış istek yapılmaz).
// Yalnız genel (public) anahtar kullanılır; gizli anahtar siteye asla girmez. Fiyat sayfaya derleme sırasında yazılır (site.json → pro).
(function () {
  'use strict';
  var cfg = (window.UX && window.UX.cfg) || {};
  var f = cfg.freemius || {};
  var t = cfg.t || {};
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-buy]'));
  var statusEls = Array.prototype.slice.call(document.querySelectorAll('[data-buy-status]'));
  var setStatus = function (x) { statusEls.forEach(function (s) { s.textContent = x || ''; }); };

  var configured = f.checkoutEnabled === true && f.productId && f.planId && /^pk_[a-z0-9]+$/i.test(f.publicKey || '');

  if (!configured) {
    buttons.forEach(function (b) {
      b.setAttribute('aria-disabled', 'true'); b.disabled = true;
      if (t.buyComingSoon) b.textContent = t.buyComingSoon;
    });
    setStatus(t.buyComingSoonNote);
    return;
  }

  var successUrl = new URL(cfg.successPath || '/', location.origin).href;
  var handler = null;
  var pending = false;

  function openCheckout() {
    if (!handler) { pending = true; setStatus(t.buyLoading); return; }
    setStatus('');
    if (window.UX.count) window.UX.count('checkout-open');
    var opts = {
      name: 'HermoPDF',
      licenses: 1,
      // Freemius Checkout JS geri çağrısı (resmî tip: freemius-checkout-js CheckoutResponse.ts):
      // data.user = {id, email, public_key, ...}, data.purchase = {license_id, plan_id, ...}. İmzalı/gizli bir alan yok;
      // sunucu bu bilgileri Freemius API'siyle doğrular (user.public_key = sahiplik kanıtı, yalnız ilk 24 saat).
      // Bilgiler yalnız bu sekmeye özel sessionStorage'a yazılır; adres çubuğuna asla.
      purchaseCompleted: function (data) {
        var u = (data && data.user) || {};
        var p = (data && data.purchase) || {};
        try {
          sessionStorage.setItem('ux-claim', JSON.stringify({
            v: 2, license_id: String(p.license_id || ''), user_id: String(u.id || ''),
            email: u.email || '', user_public_key: u.public_key || '', t: Date.now()
          }));
        } catch (e) { /* özel pencere */ }
        if (window.UX.count) window.UX.count('checkout-completed');
      },
      success: function () { location.href = successUrl; } // "Got it"e basılınca (purchaseCompleted'dan sonra)
    };
    // Türkçe sayfa: Türkiye fiyatı kuponu (TR399, 6,99 -> 3,99 $) otomatik uygulanır ve gizlenir.
    // Resmî seçenekler: coupon, hide_coupon (freemius.com/help/documentation/checkout/freemius-checkout-buy-button/).
    if (document.documentElement.lang === 'tr' && f.couponTR) { opts.coupon = f.couponTR; opts.hide_coupon = true; }
    handler.open(opts);
  }

  buttons.forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); openCheckout(); }); });

  var s = document.createElement('script');
  s.src = 'https://checkout.freemius.com/js/v1/';
  s.async = true;
  s.onload = function () {
    try {
      handler = new window.FS.Checkout({
        product_id: String(f.productId),
        plan_id: String(f.planId),
        public_key: f.publicKey,
        image: location.origin + '/img/logo-512.png',
        language: cfg.checkoutLocale || 'auto'
      });
      if (pending) { pending = false; openCheckout(); }
    } catch (e) { setStatus(t.buyFailed); }
  };
  s.onerror = function () { setStatus(t.buyFailed); };
  document.head.appendChild(s);
})();
