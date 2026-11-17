// Ana sayfa kahramanı: Hermes sahnesi. website/prototipler/hermes-test/index.html'den uyarlandı.
// Modlar:
//   'gl'    WebGL gökyüzü (bulut kayması + güneş ışınları) sayfa açılır açılmaz döner; tıklayınca 8 sn'lik video dokusu,
//           son kare katmanlı (plaka + kesilmiş Hermes), süzülme, altın parçacıklar ve altın PDF.
//           "Animasyonları azalt" açıksa (reduce; Windows'ta "Animasyon efektleri" kapalı): hiçbir şey kendiliğinden
//           kıpırdamaz, sahne durağan ilk karede bekler ve düğme "Hareketi oynat" der. Ziyaretçi düğmeye ya da "İndir"e
//           basarsa (kendi isteğiyle) tam sahne oynar: gökyüzü, video, süzülme, parçacıklar. Durdur düğmesi her zaman
//           görünür (WCAG 2.2.2 / 2.3.3). Video yoksa ilk kare → son kare çapraz geçiş.
//   'still' WebGL yoksa: hareket yok. Tıklayınca durağan son kare + altın PDF.
// İndirme animasyonu beklemez: kurulum dosyası yayındaysa bağlantının kendi davranışı indirmeyi hemen başlatır
// (data-file); yayın yoksa (önizleme) sayfada kalınır ve indirme sayfası gösterilir.
// Hareketi durdur düğmesi ('gl' modunda, "azalt" açıkken de): her şey olduğu yerde donar (gökyüzü, ara değerler, video, zamanlayıcılar);
// yeniden basınca kaldığı yerden sürer. Durmuşken "İndir" durağan son kareyi gösterir; sürdürünce o kare canlanır.
/*DEMO-START*/
// Test kancaları (yalnız geliştirme derlemesi, adres çubuğundan; üretimde build.mjs siler): ?timer (rAF yerine zamanlayıcı;
// gizli/arka plan penceresi için), ?motion (sistemin "azalt" ayarını yok say), ?calm ("azalt" açıkmış gibi davran),
// ?still (durağan sürümü zorla), ?nogl (WebGL yokmuş gibi), ?novideo (videoyu atla, veri tasarrufu gibi).
/*DEMO-END*/
(function () {
  'use strict';
  var sky = document.getElementById('hermes');
  if (!sky || !window.matchMedia) return;
  var $ = function (s) { return sky.querySelector(s); };
  var stage = $('.sky-stage'), frame = $('.sky-frame'), pdfEl = $('.sky-pdf');
  var btn = $('.sky-dl'), statusEl = $('.sky-status'), endEl = $('.sky-end');
  var againBtn = $('[data-sky="again"]'), closeBtn = $('[data-sky="close"]');
  var skipBtn = $('[data-sky="skip"]'), liveEl = $('.sky-live'), motionBtn = $('.sky-motion');
  if (!stage || !frame || !pdfEl || !btn) return;

  var hook = function () { return false; };
  /*DEMO-START*/
  hook = function (k) { return new RegExp('[?&]' + k + '(=|&|$)').test(location.search); };
  /*DEMO-END*/
  var W = 1280, H = 720, BASE = '/hermes/';
  var T = function (k) { return sky.getAttribute('data-t-' + k) || ''; };
  var file = sky.getAttribute('data-file') || '';
  var useTimer = hook('timer');
  var conn = navigator.connection || {};
  var skipVideo = !!conn.saveData || hook('novideo');
  var mode = hook('still') ? 'still' : 'gl';
  // Azaltılmış hareket: sahne başta durgun (aşağıda "frozen"); ziyaretçi başlatınca hareket tam ve normal hızda oynar.
  // (Eskiden burada hız/genlik kısılıyor, parçacıklar kapatılıyordu; sonuç gözle durağan bir posterdi.)
  var reduce = hook('calm') || (matchMedia('(prefers-reduced-motion: reduce)').matches && !hook('motion'));
  // Hız/genlik çarpanları. Gökyüzü zamanı = gerçek zaman × MOVE_T × SKY_T.
  var MOVE_T = 1, SKY_T = 1.3, SKY_AMP = 1.35, SKY_RAY = 1;
  var END = { bob: 1, part: 1 };
  var phone = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
  // Düşük güçlü cihaz (telefon, ≤4 çekirdek ya da ≤4 GB): bekleme halinde ~30 fps, daha az parçacık.
  var lite = phone || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4);
  if (navigator.getBattery) {
    navigator.getBattery().then(function (b) { if (b.level < 0.2 && !b.charging) skipVideo = true; }, function () {});
  }
  var mk = function (tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var veil = mk('div', 'sky-veil');
  stage.appendChild(veil);

  /* ---------- Görseller (ilk boyamada yalnız ilk.jpg; gerisi düğmeye yaklaşınca) ---------- */
  var imgs = {};
  function loadImg(name) {
    if (!imgs[name]) {
      imgs[name] = new Promise(function (res, rej) {
        var im = new Image();
        im.decoding = 'async';
        im.onload = function () { res(im); };
        im.onerror = rej;
        im.src = BASE + name;
      });
    }
    return imgs[name];
  }

  /* ---------- WebGL ---------- */
  var gl = null, glc, fxc, fx2, video, pBase, pSpr, tIlk, tPlate, tHer, tVid;
  var VS = 'attribute vec2 a_uv;uniform vec2 u_res,u_off,u_shift;uniform float u_s;varying vec2 v_uv;' +
    'void main(){vec2 fp=a_uv*vec2(' + W + '.,' + H + '.)+u_shift;vec2 sp=u_off+fp*u_s;vec2 c=sp/u_res*2.-1.;' +
    'gl_Position=vec4(c.x,-c.y,0.,1.);v_uv=a_uv;}';
  var FS_BASE = [
    'precision mediump float;varying vec2 v_uv;uniform sampler2D u_tex,u_tex2;uniform float u_t,u_fx,u_maskY,u_amp,u_ray,u_mix;uniform vec2 u_sun;',
    'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}',
    'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+vec2(7.1,3.7);a*=.5;}return v;}',
    'void main(){vec2 p=v_uv;float mask=smoothstep(u_maskY+.10,u_maskY-.06,p.y);vec2 q=p*vec2(2.6,1.6);',
    'vec2 d=vec2(fbm(q+vec2(u_t*.035,0.)),fbm(q+vec2(5.2,1.3+u_t*.028)))-.5;vec2 uv=p+d*u_amp*u_fx*mask;',
    'vec3 c=mix(texture2D(u_tex2,uv).rgb,texture2D(u_tex,uv).rgb,u_mix);vec2 r=(p-u_sun)*vec2(1.7778,1.);float ang=atan(r.y,r.x),dist=length(r);',
    'float w=smoothstep(-.15,.55,sin(ang));float a1=.5+.5*sin(ang*26.+u_t*.30+fbm(vec2(ang*3.,u_t*.05))*5.);',
    'float a2=.5+.5*sin(ang*61.-u_t*.21);float ray=pow(a1*a2,1.6)*exp(-dist*1.7)*w;',
    'float pulse=.85+.15*sin(u_t*.8)+.05*sin(u_t*2.3);vec3 gold=vec3(1.,.80,.46);',
    'c+=gold*ray*u_ray*u_fx*pulse;c+=gold*exp(-dist*7.)*.20*u_fx*pulse;gl_FragColor=vec4(min(c,vec3(1.)),1.);}'
  ].join('\n');
  var FS_SPR = 'precision mediump float;varying vec2 v_uv;uniform sampler2D u_tex;uniform float u_a;void main(){gl_FragColor=texture2D(u_tex,v_uv)*u_a;}';

  function initGL() {
    if (hook('nogl')) throw new Error('nogl');
    glc = mk('canvas'); glc.setAttribute('aria-hidden', 'true');
    gl = glc.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('webgl yok');
    var sh = function (type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    var prog = function (fs) {
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'a_uv'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
      return { p: p, u: u };
    };
    pBase = prog(FS_BASE); pSpr = prog(FS_SPR);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var mkTex = function () {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    tIlk = mkTex(); tPlate = mkTex(); tHer = mkTex(); tVid = mkTex();
    gl.bindTexture(gl.TEXTURE_2D, tVid);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([24, 25, 35]));
    fxc = mk('canvas'); fxc.setAttribute('aria-hidden', 'true');
    fx2 = fxc.getContext('2d');
    video = mk('video', 'sky-vid is-tex');
    video.muted = true; video.playsInline = true; video.preload = 'none';
    video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
    video.disablePictureInPicture = true;
    stage.insertBefore(glc, frame); stage.insertBefore(video, frame); stage.insertBefore(fxc, frame);
    glc.addEventListener('webglcontextlost', function (e) { e.preventDefault(); gl = null; toStill(); });
  }
  function upload(tex, im, rgba) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!rgba);
    gl.texImage2D(gl.TEXTURE_2D, 0, rgba ? gl.RGBA : gl.RGB, rgba ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, im);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }
  var endTex = null;   // plaka + Hermes dokuları hazır mı (söz)
  function endTextures() {
    if (!endTex) {
      endTex = Promise.all([loadImg('plaka.webp'), loadImg('hermes.webp')]).then(function (a) {
        if (mode === 'gl') { upload(tPlate, a[0], false); upload(tHer, a[1], true); }
        return a;
      });
    }
    return endTex;
  }

  if (mode === 'gl') {
    try { initGL(); } catch (e) { mode = 'still'; gl = null; }
  }

  /* ---------- Boyut: "cover" eşlemesi (CSS object-fit: cover ile aynı) ---------- */
  var cw = 1, ch = 1, dpr = 1, sc = 1, ox = 0, oy = 0;
  function resize() {
    var w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    dpr = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2);
    while (dpr > 1 && w * h * dpr * dpr > 2400000) dpr -= 0.25;
    if (mode !== 'gl') dpr = 1;
    cw = Math.round(w * dpr); ch = Math.round(h * dpr);
    if (gl) { glc.width = fxc.width = cw; glc.height = fxc.height = ch; }
    sc = Math.max(cw / W, ch / H);
    ox = (cw - W * sc) / 2; oy = (ch - H * sc) / 2;
    frame.style.transform = 'translate(' + (ox / dpr) + 'px,' + (oy / dpr) + 'px) scale(' + (sc / dpr) + ')';
    if (gl && mode === 'gl' && glReady && !running && !domEnd()) draw(vclock(), 0);
  }

  /* ---------- Ara değer ---------- */
  var S = { fx: 1, bob: 0, pdf: 0, part: 0, xf: 1 };   // xf: ilk kare → son kare çapraz geçişi (1 = son kare)
  var tws = [];
  var easeIO = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  var easeBack = function (t) { var c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  var lin = function (t) { return t; };
  function tween(k, to, ms, delay, ease) {
    return new Promise(function (res) { tws.push({ k: k, to: to, ms: ms, delay: delay || 0, ease: ease || easeIO, t0: null, from: 0, res: res }); });
  }
  function stepTw(now) {
    for (var i = tws.length - 1; i >= 0; i--) {
      var a = tws[i];
      if (a.t0 === null) { a.t0 = now + a.delay; a.from = S[a.k]; }
      var t = (now - a.t0) / a.ms;
      if (t < 0) continue;
      var u = Math.min(1, t);
      S[a.k] = a.from + (a.to - a.from) * a.ease(u);
      if (u >= 1) { tws.splice(i, 1); a.res(); }
    }
  }

  /* ---------- Durum ---------- */
  var state = 'idle';   // idle | lead | playing | end | resetting
  var herOn = false, vidFrame = false, lastVT = -1, gen = 0;
  var MODE_IDLE = { maskY: 0.54, amp: 0.0075, ray: 0.34, sun: [0.50, 0.17] };
  var MODE_END = { maskY: 0.95, amp: 0.0035, ray: 0.30, sun: [0.52, 0.08] };

  /* ---------- Parçacıklar ---------- */
  var spr = mk('canvas'); spr.width = spr.height = 64;
  (function () {
    var c = spr.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,246,205,1)'); g.addColorStop(0.22, 'rgba(255,214,120,.85)');
    g.addColorStop(0.55, 'rgba(214,166,64,.28)'); g.addColorStop(1, 'rgba(201,164,76,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  })();
  var P = [], MAXP = lite ? 260 : 520, EMIT = lite ? 0.6 : 1;
  function emit(x, y, n, o) {
    for (var i = 0; i < n && P.length < MAXP; i++) {
      var a = Math.random() * Math.PI * 2, sp = (o.speed || 0) * (0.35 + Math.random() * 0.65);
      P.push({ x: x + (Math.random() - 0.5) * (o.spread || 0), y: y + (Math.random() - 0.5) * (o.spreadY || o.spread || 0),
        vx: Math.cos(a) * sp, vy: o.up ? -(18 + Math.random() * 44) : Math.sin(a) * sp,
        life: 0, max: (o.life || 3) * (0.65 + Math.random() * 0.7), size: (o.size || 9) * (0.5 + Math.random()),
        ph: Math.random() * 6.28, drag: o.drag || 0 });
    }
  }
  var acc = { eye: 0, pdf: 0, amb: 0, far: 0 };
  var EYES = [[633, 197], [688, 194]], PDF_C = [575, 345], FAR = [641, 503];

  /* ---------- Çizim ---------- */
  var bx = 0, by = 0;
  function offsets(t) {
    var a = t * Math.PI * 2 / 3.6;
    by = -(Math.sin(a) * 4.5 + Math.sin(a * 0.47 + 1) * 1.5) * S.bob;
    bx = Math.sin(t * Math.PI * 2 / 5.3) * 1.6 * S.bob;
  }
  function drawGL(t) {
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.BLEND);
    var m = herOn ? MODE_END : MODE_IDLE;
    var tex = state === 'playing' && vidFrame ? tVid : (herOn ? tPlate : tIlk);
    var u = pBase.u;
    gl.useProgram(pBase.p);
    gl.uniform2f(u.u_res, cw, ch); gl.uniform2f(u.u_off, ox, oy); gl.uniform2f(u.u_shift, 0, 0); gl.uniform1f(u.u_s, sc);
    gl.uniform1f(u.u_t, t * SKY_T); gl.uniform1f(u.u_fx, S.fx);
    gl.uniform1f(u.u_maskY, m.maskY); gl.uniform1f(u.u_amp, m.amp * SKY_AMP); gl.uniform1f(u.u_ray, m.ray * SKY_RAY);
    gl.uniform2f(u.u_sun, m.sun[0], m.sun[1]);
    gl.uniform1f(u.u_mix, herOn ? S.xf : 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tIlk); gl.uniform1i(u.u_tex2, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.u_tex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (herOn) {
      var v = pSpr.u;
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(pSpr.p);
      gl.uniform2f(v.u_res, cw, ch); gl.uniform2f(v.u_off, ox, oy); gl.uniform2f(v.u_shift, bx, by); gl.uniform1f(v.u_s, sc);
      gl.uniform1f(v.u_a, Math.max(0, Math.min(1, S.xf)));
      gl.bindTexture(gl.TEXTURE_2D, tHer); gl.uniform1i(v.u_tex, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    }
  }
  function drawFx(t, dt) {
    fx2.setTransform(1, 0, 0, 1, 0, 0); fx2.clearRect(0, 0, cw, ch);
    var k = herOn ? S.part : 0, e;
    if (k > 0.01) {
      // gözlerden, PDF'i tutan elden ve aşağıdaki bulutlardan yükselen altın ışıltılar
      acc.eye += dt * 6 * k; acc.pdf += dt * 12 * k * S.pdf * EMIT; acc.amb += dt * 13 * k * EMIT;
      while (acc.eye > 1) { acc.eye--; e = EYES[(Math.random() * 2) | 0]; emit(e[0] + bx, e[1] + by, 1, { up: true, spread: 6, life: 3.2, size: 6 }); }
      while (acc.pdf > 1) { acc.pdf--; emit(PDF_C[0] + bx, PDF_C[1] + by + 34, 1, { up: true, spread: 110, spreadY: 60, life: 2.8, size: 7 }); }
      while (acc.amb > 1) { acc.amb--; emit(Math.random() * W, 500 + Math.random() * 220, 1, { up: true, life: 5.5, size: 6 }); }
    } else if (state === 'idle') {
      // uzaktaki Hermes'in elindeki PDF: küçük altın parıltı
      acc.far += dt * 1.6 * S.fx;
      while (acc.far > 1) { acc.far--; emit(FAR[0], FAR[1], 1, { up: true, spread: 8, life: 2.6, size: 3.2 }); }
    }
    fx2.setTransform(sc, 0, 0, sc, ox, oy);
    fx2.globalCompositeOperation = 'lighter';
    for (var i = P.length - 1; i >= 0; i--) {
      var p = P[i]; p.life += dt;
      if (p.life >= p.max) { P.splice(i, 1); continue; }
      if (p.drag) { var d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; }
      p.x += (p.vx + Math.sin(t * 1.3 + p.ph) * 9) * dt; p.y += p.vy * dt;
      var uu = p.life / p.max, al = Math.sin(Math.PI * Math.min(1, uu * 1.05)) * 0.72;
      var s = p.size * (1 + 0.35 * Math.sin(t * 5 + p.ph)) * (1 - uu * 0.3);
      fx2.globalAlpha = al; fx2.drawImage(spr, p.x - s * 2, p.y - s * 2, s * 4, s * 4);
    }
    var pulse = 0.5 + 0.5 * Math.sin(t * 2.2), j, g;
    if (herOn && k > 0.01) {
      for (j = 0; j < EYES.length; j++) {
        fx2.globalAlpha = (0.22 + 0.22 * pulse) * k; g = 34 + 10 * pulse;
        fx2.drawImage(spr, EYES[j][0] + bx - g, EYES[j][1] + by - g, g * 2, g * 2);
      }
    } else if (!herOn && state === 'idle') {
      fx2.globalAlpha = (0.45 + 0.3 * pulse) * S.fx; g = 9 + 3 * pulse;
      fx2.drawImage(spr, FAR[0] - g, FAR[1] - g, g * 2, g * 2);
    }
    fx2.globalAlpha = 1; fx2.globalCompositeOperation = 'source-over';
  }
  function updatePdf(t) {
    var a = Math.max(0, Math.min(1, S.pdf));
    var sc2 = (0.25 + 0.75 * easeBack(a)) * 0.88 * (herOn ? 1 : 0);
    var fy = Math.sin(t * 1.7) * 4 * S.bob, rot = -9 + Math.sin(t * 1.1) * 1.4 * S.bob;
    pdfEl.style.opacity = herOn ? Math.min(1, a * 1.4) : 0;
    pdfEl.style.transform = 'translate(' + bx + 'px,' + (by * 1.25 + fy) + 'px) rotate(' + rot + 'deg) scale(' + sc2 + ')';
  }
  function draw(now, dt) {
    var t = now / 1000 * MOVE_T;
    offsets(t);
    if (state === 'playing' && video.readyState >= 2 && video.currentTime !== lastVT) {
      lastVT = video.currentTime;
      upload(tVid, video, false);
      vidFrame = true;
    }
    drawGL(t); updatePdf(t); drawFx(t, dt);
  }

  /* ---------- Döngü: yalnız sahne görünürken ---------- */
  var raf = useTimer ? function (f) { setTimeout(function () { f(performance.now()); }, 16); } : function (f) { requestAnimationFrame(f); };
  var running = false, visible = true, last = 0, lastDraw = 0;
  // Hareketi durdur tercihi (tarayıcı belleği yoksa ya da engelliyse sessizce yok sayılır). "Azalt" açıksa sahne
  // durgun başlar; ziyaretçi bu sitede hareketi kendisi açtıysa ('on') o tercihi geçerli olur.
  var saved = null;
  try { saved = localStorage.getItem('sky-motion'); } catch (e) { /* yoksay */ }
  var frozen = saved === 'off' || (reduce && saved !== 'on');
  // autoFrozen: yalnız sistem ayarı yüzünden durgun (ziyaretçi henüz seçim yapmadı). Düğme "Hareketi oynat" der;
  // "İndir"e basmak da açık istek sayılır ve hareketi başlatır.
  var autoFrozen = frozen && saved !== 'off';
  // Sahne saati: durdurulmuşken ilerlemez, böylece sürdürünce her şey kaldığı yerden devam eder.
  var clockOff = 0, frozeAt = frozen ? performance.now() : 0;
  var vclock = function () { return (frozen ? frozeAt : performance.now()) - clockOff; };
  function vwait(ms) {
    var end = vclock() + ms;
    return new Promise(function (r) {
      (function chk() { var left = end - vclock(); if (left <= 0) r(); else setTimeout(chk, Math.max(16, Math.min(100, left))); })();
    });
  }
  var domEnd = function () { return sky.classList.contains('end-dom'); };   // durağan son kare gösteriliyor
  var live = function () { return visible && !frozen && !domEnd() && (useTimer || !document.hidden); };
  function loop(now) {
    if (mode !== 'gl' || !live()) { running = false; return; }
    raf(loop);
    // düşük güçlü cihazda bekleme halinde ~30 fps yeter
    if (lite && state === 'idle' && now - lastDraw < 30) return;
    var dt = Math.min(0.05, (now - last) / 1000); last = now; lastDraw = now;
    var vn = now - clockOff;
    stepTw(vn);
    draw(vn, dt);
  }
  function kick() {
    if (running || mode !== 'gl' || !glReady || !live()) return;
    running = true; last = lastDraw = performance.now(); raf(loop);
  }
  var glReady = false;
  // Donmuş ya da durağan sahnede tek kare çiz (döngü çalışmıyorken).
  function paintStill() { if (gl && mode === 'gl' && glReady && !running && !domEnd()) draw(vclock(), 0); }
  if (mode === 'gl') {
    loadImg('ilk.jpg').then(function (im) {
      if (mode !== 'gl') return;
      upload(tIlk, im, false);
      glReady = true;
      resize();
      draw(vclock(), 0);
      sky.classList.add('gl-on');
      kick();
    }, toStill);
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);
  if (window.IntersectionObserver && !useTimer) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; kick(); }).observe(sky);
  }
  document.addEventListener('visibilitychange', kick);

  function toStill() {
    mode = 'still';
    sky.classList.remove('gl-on');
    if (motionBtn) motionBtn.hidden = true;
    if (video) { try { video.pause(); } catch (e) { /* yoksay */ } }
    if (state !== 'idle') showEndStill();
  }

  /* ---------- Senaryo ---------- */
  function say(t) { statusEl.textContent = t; }
  var focusEnd = false;
  function warm() {
    if (mode === 'gl') {
      endTextures();
      if (!skipVideo && !video.getAttribute('src')) { video.preload = 'auto'; video.src = BASE + 'hermes.mp4'; video.load(); }
    } else {
      loadImg('plaka.webp'); loadImg('hermes.webp');
    }
  }
  // Ön yükleme: masaüstünde imleç/odak düğmeye gelince. Dokunmatikte (mobil veri) yalnız tıklayınca başlar.
  var coarse = matchMedia('(pointer: coarse)').matches, warmed = false;
  ['pointerenter', 'focus'].forEach(function (ev) {
    btn.addEventListener(ev, function (e) {
      if (warmed || coarse || (e && e.pointerType === 'touch')) return;
      warmed = true; warm();
    }, { passive: true });
  });

  function finishText() {
    say(file ? T('done') : T('preview'));
    var hadLive = !!liveEl && liveEl.contains(document.activeElement);
    if (liveEl) liveEl.hidden = true;
    if (againBtn) againBtn.hidden = mode !== 'gl' || frozen;
    endEl.hidden = false;
    if (focusEnd || hadLive) { focusEnd = false; (mode === 'gl' && !frozen && againBtn ? againBtn : closeBtn).focus({ preventScroll: true }); }
  }

  // Oynarken "Atla": video bekleniyorsa bitir, son kare başlamışsa hemen tamamla.
  var skipVid = null;
  function holdFor(ms) {
    return new Promise(function (res) {
      var done = false;
      var fin = function () { if (done) return; done = true; if (skipVid === fin) skipVid = null; res(true); };
      skipVid = fin;
      vwait(ms).then(fin);   // sahne saatiyle: durdurulmuşken beklemez
    });
  }
  function skip() {
    if ((state === 'lead' || state === 'playing') && skipVid) skipVid();
    else if (state === 'end' && liveEl && !liveEl.hidden) {
      gen++; tws.length = 0;
      S.fx = 1; S.bob = END.bob; S.part = END.part; S.pdf = 1; S.xf = 1;
      finishText();
    }
  }

  function playVideo(my) {
    // Sonuç true: video bitti/atlandı. false: hata, takılma, başlamadı ya da süre sınırı aşıldı (son kareye geçilir).
    return new Promise(function (res) {
      // act: durdurulmadan geçen gerçek süre (ms). Süre sınırları bununla ölçülür; durdurmak videoyu "takıldı" saydırmaz.
      var done = false, iv = 0, stallT = 0, act = 0, tick = Date.now();
      var onEnded = function () { fin(true); };
      var onFail = function () { if (!frozen) fin(false); };   // durdurulmuşken play() reddi hata değildir
      var onOk = function () { clearTimeout(stallT); stallT = 0; };
      var onStall = function () {
        if (!stallT && !video.ended) stallT = setTimeout(function () { stallT = 0; if (!frozen) fin(false); }, 3500);
      };
      var evs = { ended: onEnded, error: onFail, stalled: onStall, waiting: onStall, playing: onOk, timeupdate: onOk };
      function fin(ok) {
        if (done) return;
        done = true; if (skipVid === skipMe) skipVid = null;
        clearInterval(iv); clearTimeout(stallT);
        for (var k in evs) video.removeEventListener(k, evs[k]);
        try { video.pause(); } catch (e) { /* yoksay */ }
        res(ok);
      }
      var skipMe = function () { fin(true); };
      for (var k in evs) video.addEventListener(k, evs[k]);
      skipVid = skipMe;
      iv = setInterval(function () {
        var n = Date.now(), d = video.duration;
        if (!frozen) act += n - tick;
        tick = n;
        if (my !== gen) fin(true);
        else if (d && video.currentTime >= d - 0.03) fin(true);
        else if (act > 6000 && !video.currentTime) fin(false);   // hiç başlamadı
        else if (act / 1000 > (isFinite(d) && d > 0 ? d + 4 : 14)) fin(false);   // mutlak üst sınır
      }, 80);
      try { video.currentTime = 0; } catch (e) { /* yoksay */ }
      if (!frozen) {
        var pr = video.play();
        if (pr && pr.catch) pr.catch(onFail);
      }
    });
  }

  function start(withText) {
    var my = ++gen;
    sky.classList.add('is-on');
    endEl.hidden = true;
    say((withText && file ? T('started') + ' ' : '') + T('going'));
    warm();
    if (mode === 'gl' && autoFrozen) setFrozen(false, false);   // "azalt" açıkken İndir: ziyaretçinin kendi isteği
    if (mode !== 'gl' || frozen) { showEndStill(); return; }
    state = 'lead';
    if (liveEl) {
      liveEl.hidden = false;
      // Düğme gizlenecek; klavye odağı kaybolmasın diye "Atla"ya taşı.
      if (focusEnd && skipBtn) setTimeout(function () { if (my === gen && liveEl && !liveEl.hidden) skipBtn.focus({ preventScroll: true }); }, 80);
    }
    tween('fx', 0, skipVideo ? 900 : 450);
    var vid = skipVideo ? holdFor(900) : (state = 'playing', vidFrame = false, lastVT = -1, playVideo(my));
    var hadVideo = !skipVideo;
    Promise.all([vid, endTextures()]).then(function (r) {
      if (my !== gen) return;
      if (r[0] === false) skipVideo = true;   // video bozuk/takıldı: son kareye geç, tekrar denemeyi bırak
      // Video oynadıysa son kare zaten ekranda; oynamadıysa ilk kareden son kareye yumuşak çapraz geçiş.
      var xfade = !(hadVideo && r[0] === true && vidFrame);
      herOn = true; state = 'end'; S.bob = 0; S.pdf = 0; S.part = 0; S.fx = 0; S.xf = xfade ? 0 : 1;
      if (xfade) tween('xf', 1, 900);
      var lag = xfade ? 600 : 0;
      tween('fx', 1, 1800, lag);
      tween('bob', END.bob, 2400, lag);
      tween('part', END.part, 2200, lag + 200);
      return vwait(450 + lag).then(function () {
        if (my !== gen) return;
        tween('pdf', 1, 1100, 0, lin);
        emit(PDF_C[0], PDF_C[1], lite ? 28 : 46, { speed: 190, life: 1.7, size: 8, drag: 2.6 });
        vwait(900).then(function () { if (my === gen) finishText(); });
      });
    }, function () { if (my === gen) toStill(); });
  }

  function showEndStill() {
    var my = gen;
    state = 'end';
    Promise.all([loadImg('plaka.webp'), loadImg('hermes.webp')]).then(function (a) {
      if (my !== gen) return;
      if (!frame.querySelector('.sky-layer')) {
        a.forEach(function (im, i) {
          var el = mk('img', 'sky-layer'); el.alt = ''; el.src = im.src; el.width = W; el.height = H;
          if (i === 1) el.classList.add('sky-layer-her');
          frame.insertBefore(el, pdfEl);
        });
      }
      pdfEl.style.opacity = ''; pdfEl.style.transform = '';
      sky.classList.add('end-dom');
      finishText();
    }, function () { if (my === gen) finishText(); });
  }

  function reset() {
    gen++;
    tws.length = 0;
    herOn = false; vidFrame = false; S.fx = 1; S.bob = 0; S.pdf = 0; S.part = 0; S.xf = 1; P.length = 0;
    if (video) { video.pause(); try { video.currentTime = 0; } catch (e) { /* yoksay */ } }
    sky.classList.remove('end-dom');
    pdfEl.style.opacity = ''; pdfEl.style.transform = '';
    endEl.hidden = true;
    if (liveEl) liveEl.hidden = true;
    kick(); paintStill();
  }
  function veiled(fn) {
    if (mode !== 'gl') { fn(); return Promise.resolve(); }
    if (reduce) {
      // "azalt" açıkken kararma (flaş) yok; sahne ilk kareye yumuşakça geri döner (CSS geçişleri orada kapalı)
      if (running && herOn && !domEnd()) {
        var my = gen; tws.length = 0;
        // sekme gizlenip döngü durursa takılmasın: en geç 1,8 sn'de devam et
        return Promise.race([tween('pdf', 0, 500).then(function () { return tween('xf', 0, 900); }), wait(1800)])
          .then(function () { if (my === gen) fn(); });
      }
      fn(); return Promise.resolve();
    }
    veil.classList.add('on');
    return wait(450).then(function () { fn(); veil.classList.remove('on'); });
  }

  btn.addEventListener('click', function (e) {
    if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;   // yeni sekme vb.: tarayıcıya bırak
    // önizleme (file yok): sayfada kal. Animasyon sürerken ikinci tıklama ikinci indirme başlatmasın.
    // file varsa ve boştaysa preventDefault YOK: tarayıcı indirmeyi hemen başlatır, sayfa yerinde kalır.
    if (!file || state !== 'idle') e.preventDefault();
    if (state !== 'idle') return;
    focusEnd = document.activeElement === btn;
    start(true);
  });
  if (againBtn) againBtn.addEventListener('click', function () {
    if (state !== 'end') return;
    state = 'resetting'; focusEnd = true;
    veiled(function () { reset(); state = 'idle'; start(false); });
  });
  function close() {
    state = 'resetting';
    veiled(function () { reset(); state = 'idle'; sky.classList.remove('is-on'); say(''); btn.focus({ preventScroll: true }); });
  }
  if (closeBtn) closeBtn.addEventListener('click', function () { if (state === 'end') close(); });
  sky.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state === 'end') close(); });

  if (skipBtn) skipBtn.addEventListener('click', skip);

  /* ---------- Hareketi durdur / başlat ---------- */
  // Düğme etiketi duruma göre değişir ("Hareketi durdur" ↔ "Hareketi sürdür"; "azalt" açıkken başta "Hareketi oynat");
  // bu yüzden aria-pressed değil data-paused.
  var motionLabel = motionBtn && motionBtn.querySelector('span');
  function syncMotionBtn() {
    if (!motionBtn) return;
    motionBtn.setAttribute('data-paused', frozen ? 'true' : 'false');
    var t = motionBtn.getAttribute(frozen ? (autoFrozen ? 'data-play' : 'data-resume') : 'data-pause');
    if (motionLabel && t) motionLabel.textContent = t;
  }
  function setFrozen(v, save) {
    autoFrozen = false;
    if (v === frozen) { syncMotionBtn(); return; }
    if (v) frozeAt = performance.now(); else clockOff += performance.now() - frozeAt;
    frozen = v;
    syncMotionBtn();
    if (save) { try { localStorage.setItem('sky-motion', v ? 'off' : 'on'); } catch (e) { /* yoksay */ } }
    if (v) {
      // Her şey olduğu yerde donar: döngü bir sonraki karede durur, video duraklar, ara değerler sahne saatiyle bekler.
      if (video && !video.paused) { try { video.pause(); } catch (e) { /* yoksay */ } }
      paintStill();
      return;
    }
    if (againBtn && !endEl.hidden) againBtn.hidden = mode !== 'gl';
    if (state === 'playing' && video && skipVid && !video.ended) {
      var pr = video.play();   // kaldığı yerden
      if (pr && pr.catch) pr.catch(function () { /* playVideo izleyicisi karar verir */ });
    }
    if (mode === 'gl' && state === 'end' && domEnd()) {
      // Durmuşken gösterilen durağan son kare: aynı kareyi canlı sahneye çevir (plaka + Hermes dokuları hazır olunca).
      var my = gen;
      endTextures().then(function () {
        if (my !== gen || frozen || mode !== 'gl' || state !== 'end' || !domEnd()) return;
        herOn = true; vidFrame = false; tws.length = 0;
        S.fx = 1; S.bob = END.bob; S.part = END.part; S.pdf = 1; S.xf = 1;
        sky.classList.remove('end-dom');
        pdfEl.style.opacity = ''; pdfEl.style.transform = '';
        kick();
      }, function () { /* durağan kare kalır */ });
      return;
    }
    kick();
  }
  if (motionBtn) {
    if (mode === 'gl') motionBtn.hidden = false;
    motionBtn.removeAttribute('aria-pressed');
    syncMotionBtn();
    motionBtn.addEventListener('click', function () { if (state !== 'resetting') setFrozen(!frozen, true); });
  }

  /*DEMO-START*/
  // Test için (konsol / otomasyon)
  window.__hermes = { S: S, get state() { return state; }, get mode() { return mode; }, get frozen() { return frozen; }, get particles() { return P.length; }, start: start };
  /*DEMO-END*/
})();
