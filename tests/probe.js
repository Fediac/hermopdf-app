// Hızlı duman testi: uygulamayı açar, test PDF'ini yükler, ekran görüntüsü alır.
const { launch, shot, copyFixture, sleep } = require('./harness');

(async () => {
  const file = copyFixture(process.argv[2] || 'test.pdf');
  const { app, win, logs } = await launch({ args: [file] });
  try {
    await win.waitForSelector('.pdfViewer .page canvas', { timeout: 20000 });
    await sleep(1200);
    console.log('shot:', await shot(win, process.argv[3] || 'probe'));
  } catch (e) {
    console.error('HATA', e.message);
    await shot(win, 'probe-error');
  } finally {
    console.log(logs.join('\n'));
    await app.close();
  }
})();
