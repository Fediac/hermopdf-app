// Meşgul göstergesi kuralları: uzun işte görünür; iletişim kutusu ya da sistem penceresi açıkken gizlenir,
// kapanınca iş sürüyorsa geri gelir; iş bitince kaybolur.
const { launch, sleep } = require('./harness');

(async () => {
  const { app, win } = await launch();
  const results = [];
  const check = (name, ok) => { results.push(ok); console.log(`${ok ? '✔' : '✘'} ${name}`); };
  const visible = () => win.evaluate(() => !!document.querySelector('.busy-overlay'));
  await sleep(600);
  await win.evaluate(async () => { window.__u = await import('app://pu/src/renderer/js/util.js'); });

  await win.evaluate(() => { window.__b = window.__u.busy('Uzun iş…'); });
  await sleep(150);
  check('ilk 400 ms içinde görünmez (kısa işlerde yanıp sönmez)', !(await visible()));
  await sleep(400);
  check('uzun işte görünür', await visible());

  await win.evaluate(() => { window.__m = window.__u.modal({ title: 'Soru', body: 'Devam?', buttons: [{ label: 'Tamam', primary: true, value: 1 }] }); });
  await sleep(100);
  check('iletişim kutusu açılınca gizlenir', !(await visible()));
  await win.locator('.modal .modal-foot button', { hasText: 'Tamam' }).click();
  await sleep(150);
  check('kutu kapanır kapanmaz hemen geri gelmez', !(await visible()));
  await sleep(450);
  check('iş sürüyorsa geri gelir', await visible());

  await win.evaluate(() => window.dispatchEvent(new Event('pu:sysdialog-open')));
  await sleep(50);
  check('sistem penceresi açılınca gizlenir', !(await visible()));
  await sleep(700);
  check('sistem penceresi açıkken gizli kalır', !(await visible()));
  await win.evaluate(() => window.dispatchEvent(new Event('pu:sysdialog-close')));
  await sleep(500);
  check('sistem penceresi kapanınca geri gelir', await visible());

  await win.evaluate(() => window.__b.done());
  await sleep(50);
  check('iş bitince kaybolur', !(await visible()));

  const p = await win.evaluate(() => { window.__p = window.__u.progress('İlerleme'); return 1; });
  void p;
  await win.evaluate(() => { window.__b2 = window.__u.busy('x'); });
  await sleep(600);
  check('ilerleme penceresi açıkken gösterge çıkmaz (İptal tıklanabilir)', !(await visible()));
  await win.evaluate(() => { window.__p.close(); window.__b2.done(); });

  console.log(`${results.filter(Boolean).length}/${results.length} kontrol başarılı`);
  await app.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})();
