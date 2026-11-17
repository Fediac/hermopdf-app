// "Lisansımı kaybettim" sayfasının e-posta yolu: POST /v1/license/recover {email}. Sunucu her zaman aynı yanıtı verir;
// biz de e-postanın kayıtlı olup olmadığını asla söylemeyiz. Yanıttaki X-Mail başlığı yalnız sunucuda e-posta
// gönderiminin kurulu olup olmadığını söyler (adresle ilgisi yok); kurulu değilse kullanıcıyı anahtar yoluna yönlendiririz.
// Freemius anahtarıyla anahtarı sayfada alma yolu claim.js'tedir.
(function () {
  'use strict';
  var cfg = (window.UX && window.UX.cfg) || {};
  var en = cfg.lang !== 'tr';   // Türkçe dışındaki her dilde İngilizce iletiler
  var M = en ? {
    sent: 'Done. If there is an active license for this address, we have e-mailed it. Check your inbox and spam folder in a few minutes.',
    noMail: 'Sending by e-mail is not available yet. Please use your Freemius license key above to get your HermoPDF key right on this page.',
    bad: 'Please enter a valid e-mail address.',
    limited: 'Too many requests. Please wait a few minutes and try again.',
    network: 'Could not reach the license server. Check your connection and try again.',
    sending: 'Sending…'
  } : {
    sent: 'Tamam. Bu adrese bağlı etkin bir lisans varsa e-postayla gönderdik. Birkaç dakika içinde gelen kutunu ve istenmeyen klasörünü kontrol et.',
    noMail: 'E-postayla gönderim henüz açık değil. HermoPDF anahtarını bu sayfada hemen almak için yukarıdaki Freemius lisans anahtarı yolunu kullan.',
    bad: 'Geçerli bir e-posta adresi yaz.',
    limited: 'Çok fazla istek oldu. Birkaç dakika bekleyip tekrar dene.',
    network: 'Lisans sunucusuna ulaşılamadı. Bağlantını kontrol edip tekrar dene.',
    sending: 'Gönderiliyor…'
  };
  var apiBase = cfg.apiBase;
  /*DEMO-START*/
  if (cfg.demoAllowed && new URLSearchParams(location.search).get('demo') === '1') apiBase = cfg.devApiBase;
  /*DEMO-END*/
  var form = document.getElementById('recover-form');
  var input = document.getElementById('recover-email');
  var status = document.getElementById('recover-status');
  var button = form && form.querySelector('button[type=submit]');
  if (!form) return;
  var say = function (t, cls) { status.textContent = t; status.className = 'status ' + (cls || ''); };
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = (input.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say(M.bad, 'err'); input.focus(); return; }
    button.disabled = true;
    say(M.sending);
    fetch(apiBase + '/v1/license/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email }),
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (r) {
      if (r.status === 429) say(M.limited, 'err');
      else if (r.ok && r.headers.get('X-Mail') === '0') say(M.noMail, 'err');
      else if (r.ok) { say(M.sent, 'ok'); form.reset(); }
      else say(M.network, 'err');
    }).catch(function () { say(M.network, 'err'); })
      .then(function () { button.disabled = false; });
  });
})();
