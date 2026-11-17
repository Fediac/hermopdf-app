// HermoPDF anahtarını sunucudan alır (POST /v1/license/claim) ve sayfada gösterir. İki sayfada çalışır:
//  - "Satın alma tamamlandı" (#claim[data-auto]): Freemius ödeme penceresinin geri çağrısının sessionStorage'a
//    yazdığı bilgilerle (checkout.js) kendiliğinden ister. Sahiplik kanıtı: Freemius kullanıcısının public_key'i
//    (sunucu Freemius API'siyle doğrular, yalnız satın almadan sonraki 24 saat).
//  - "Lisansımı kaybettim": yalnız form. Kanıt: Freemius'un alıcıya verdiği kendi lisans anahtarı.
// Freemius'un kendi sayfasında (hosted checkout) satın alanlar sitemize geri dönmez: onlar da bu formu kullanır.
// Yanıtlar: 200 anahtar · 202 Freemius'a ulaşılamadı, kısa süre yeniden dene · 404 tek tip "bulunamadı" ·
// 503 sunucu şu an doğrulayamıyor · 429 çok deneme.
(function () {
  'use strict';
  var cfg = (window.UX && window.UX.cfg) || {};
  var en = cfg.lang !== 'tr';   // Türkçe dışındaki her dilde İngilizce iletiler
  var M = en ? {
    wait: 'Preparing your HermoPDF license key…',
    waitLong: 'Still checking your purchase with Freemius, this can take a moment…',
    ask: 'Paste the license key Freemius gave you for this purchase. We check it and show your HermoPDF key here.',
    autoFail: 'We could not confirm the purchase automatically. Paste the license key Freemius gave you for this purchase.',
    notFound: 'No active HermoPDF purchase matches this key. Check that you pasted the whole key. Refunded or cancelled purchases do not get a key.',
    timeout: 'Freemius did not answer in time. Please try again in a few minutes.',
    unavailable: 'We cannot check purchases right now. Please try again later or write to us.',
    network: 'Could not reach the license server. Check your connection and try again.',
    limited: 'Too many attempts. Please wait an hour and try again.',
    badKey: 'Paste the whole key, without spaces.',
    demo: 'Demo mode: talking to the local test server'
  } : {
    wait: 'HermoPDF lisans anahtarın hazırlanıyor…',
    waitLong: 'Satın alman Freemius ile doğrulanıyor, bu biraz sürebilir…',
    ask: 'Bu satın alma için Freemius\'un sana verdiği lisans anahtarını yapıştır. Kontrol edip HermoPDF anahtarını burada gösteririz.',
    autoFail: 'Satın almanı kendiliğinden doğrulayamadık. Bu satın alma için Freemius\'un sana verdiği lisans anahtarını yapıştır.',
    notFound: 'Bu anahtarla eşleşen etkin bir HermoPDF satın alması yok. Anahtarın tamamını yapıştırdığından emin ol. İade edilen ya da iptal edilen satın almalara anahtar verilmez.',
    timeout: 'Freemius zamanında yanıt vermedi. Birkaç dakika sonra tekrar dene.',
    unavailable: 'Şu an satın almaları doğrulayamıyoruz. Biraz sonra tekrar dene ya da bize yaz.',
    network: 'Lisans sunucusuna ulaşılamadı. Bağlantını kontrol edip tekrar dene.',
    limited: 'Çok fazla deneme oldu. Bir saat bekleyip tekrar dene.',
    badKey: 'Anahtarın tamamını, boşluksuz yapıştır.',
    demo: 'Demo modu: yerel test sunucusuyla konuşuyor'
  };
  var $ = function (id) { return document.getElementById(id); };
  var show = function (id, on) { var el = $(id); if (el) el.hidden = !on; };
  var card = $('claim');
  if (!card) return;

  var apiBase = cfg.apiBase;
  var demo = false;
  var params = new URLSearchParams(location.search);
  var proof = null;   // ödeme penceresinden gelen kanıt (yalnız satın alma tamamlandı sayfasında)
  var SKEY = 'ux-claim';
  var auto = card.hasAttribute('data-auto');

  if (auto) {
    try {
      var saved = JSON.parse(sessionStorage.getItem(SKEY) || 'null');
      if (saved && saved.v === 2 && Date.now() - (saved.t || 0) < 30 * 60 * 1000) proof = saved;
    } catch (e) { /* özel pencere */ }
  }

  /*DEMO-START*/
  // Yalnız geliştirme derlemesinde vardır (node build.mjs --dev). Üretim derlemesi bu bloğu siler.
  if (cfg.demoAllowed && params.get('demo') === '1') {
    demo = true;
    apiBase = cfg.devApiBase;
    if (auto && params.get('license_id')) {
      proof = { license_id: params.get('license_id'), user_id: params.get('user_id') || '', email: params.get('email') || '', user_public_key: params.get('pk') || '' };
    }
    var db = $('claim-demo');
    if (db) { db.hidden = false; db.textContent = M.demo + ' (' + apiBase + ').'; }
  }
  /*DEMO-END*/

  // Adres çubuğunda hiçbir bilgi kalmasın (geçmiş, ekran paylaşımı).
  if (location.search) { try { history.replaceState(null, '', location.pathname + (demo ? '?demo=1' : '')); } catch (e) { /* yoksay */ } }

  var form = $('claim-form');
  var keyIn = $('claim-fskey');
  var msg = $('claim-form-msg');

  function askKey(text, isError) {
    show('claim-wait', false);
    show('claim-ok', false);
    show('claim-form', true);
    msg.textContent = text || M.ask;
    msg.className = 'status' + (isError ? ' err' : '');
    if (isError && keyIn) keyIn.focus();
  }

  function success(data) {
    show('claim-wait', false);
    show('claim-form', false);
    show('claim-ok', true);
    try { sessionStorage.removeItem(SKEY); } catch (e) { /* yoksay */ }
    var key = String(data.license_key || '');
    $('claim-key').textContent = key;
    var em = $('claim-email');
    if (em) em.textContent = data.email || '';
    show('claim-email-row', !!data.email);
    var name = /^[\w.-]+\.hermopdflicense$/.test(data.file_name || '') ? data.file_name : 'hermopdf-pro.hermopdflicense';
    var a = $('claim-dl');
    a.href = URL.createObjectURL(new Blob([key + '\n'], { type: 'application/octet-stream' }));
    a.setAttribute('download', name);
    $('claim-file-name').textContent = name;
    if (form) form.reset();
    if (window.UX.count) window.UX.count('license-shown');
    $('claim-ok').focus();
  }

  var delays = [1500, 2500, 4000, 6000, 8000, 10000, 10000, 10000];
  var started = 0;
  var busy = false;

  function attempt(body, fromCheckout, i) {
    if (Date.now() - started > 3000) $('claim-wait-text').textContent = M.waitLong;
    fetch(apiBase + '/v1/license/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (r) {
      if (r.status === 200) return r.json().then(function (d) { busy = false; success(d); });
      if (r.status === 202) return retry(body, fromCheckout, i, M.timeout);
      busy = false;
      if (r.status === 404) return askKey(fromCheckout ? M.autoFail : M.notFound, !fromCheckout);
      if (r.status === 429) return askKey(M.limited, true);
      if (r.status === 503) return askKey(fromCheckout ? M.autoFail : M.unavailable, !fromCheckout);
      return askKey(M.unavailable, true);
    }).catch(function () {
      if (i >= 2) { busy = false; return askKey(M.network, true); }
      return retry(body, fromCheckout, i, M.network);
    });
  }
  function retry(body, fromCheckout, i, lastMsg) {
    if (i >= delays.length) { busy = false; return askKey(lastMsg, true); }
    setTimeout(function () { attempt(body, fromCheckout, i + 1); }, delays[i]);
  }
  function start(body, fromCheckout) {
    if (busy) return;
    busy = true;
    show('claim-form', false);
    show('claim-ok', false);
    show('claim-wait', true);
    $('claim-wait-text').textContent = M.wait;
    started = Date.now();
    attempt(body, fromCheckout, 0);
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var k = (keyIn.value || '').trim();
      if (!/^[\x21-\x7e]{16,128}$/.test(k)) { msg.textContent = M.badKey; msg.className = 'status err'; keyIn.focus(); return; }
      start({ fs_license_key: k }, false);
    });
  }

  if (proof && proof.license_id && proof.user_id && proof.email && proof.user_public_key) {
    start({ license_id: proof.license_id, user_id: proof.user_id, email: proof.email, user_public_key: proof.user_public_key }, true);
  } else {
    show('claim-wait', false);
    show('claim-form', true);
    msg.textContent = M.ask;
  }
})();
