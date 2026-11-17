# Üçüncü taraf lisansları / Third-party notices

HermoPDF, GPL-3.0-or-later lisansı altında yayımlanır (bkz. `LICENSE`). Aşağıdaki bileşenler kendi lisanslarıyla dağıtılır.
HermoPDF is released under GPL-3.0-or-later (see `LICENSE`). The components below are distributed under their own licenses.

"HermoPDF" adı ve logosu marka olarak saklıdır; GPL-3.0 bu markaları kapsamaz. / The name and logo are trademarks and are not covered by the GPL.

## Üretim bağımlılıkları / Production dependencies

Bu liste `npx license-checker-rseidelsohn --production` çıktısından üretilmiştir (HermoPDF'in kendisi hariç, 43 paket).

| Paket | Sürüm | Lisans | Depo |
|---|---|---|---|
| @cantoo/fontkit | 2.0.12 | MIT | https://github.com/cantoo-scribe/fontkit |
| @cantoo/pdf-lib | 2.11.1 | MIT | https://github.com/cantoo-scribe/pdf-lib |
| @napi-rs/canvas-win32-x64-msvc | 1.0.9 | MIT | https://github.com/Brooooooklyn/canvas |
| @napi-rs/canvas | 1.0.9 | MIT | https://github.com/Brooooooklyn/canvas |
| @tesseract.js-data/eng | 1.0.0 | MIT | https://github.com/naptha/tessdata |
| @tesseract.js-data/tur | 1.0.0 | MIT | https://github.com/naptha/tessdata |
| base64-js | 1.5.1 | MIT | https://github.com/beatgammit/base64-js |
| bmp-js | 0.1.0 | MIT | https://github.com/shaozilee/bmp-js |
| brotli | 1.3.3 | MIT | https://github.com/devongovett/brotli.js |
| core-util-is | 1.0.3 | MIT | https://github.com/isaacs/core-util-is |
| culori | 4.0.2 | MIT | https://github.com/Evercoder/culori |
| dfa | 1.2.0 | MIT | https://github.com/devongovett/dfa |
| docx-preview | 0.4.1 | Apache-2.0 | https://github.com/VolodymyrBaydalka/docxjs |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| html-entities | 2.6.0 | MIT | https://github.com/mdevils/html-entities |
| idb-keyval | 6.3.0 | Apache-2.0 | https://github.com/jakearchibald/idb-keyval |
| immediate | 3.0.6 | MIT | https://github.com/calvinmetcalf/immediate |
| inherits | 2.0.4 | ISC | https://github.com/isaacs/inherits |
| is-url | 1.2.4 | MIT | https://github.com/segmentio/is-url |
| isarray | 1.0.0 | MIT | https://github.com/juliangruber/isarray |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) | https://github.com/Stuk/jszip |
| lie | 3.3.0 | MIT | https://github.com/calvinmetcalf/lie |
| node-fetch | 2.7.0 | MIT | https://github.com/bitinn/node-fetch |
| node-html-better-parser | 1.5.9 | MIT | https://github.com/Sharcoux/node-html-parser |
| opencollective-postinstall | 2.0.3 | MIT | https://github.com/opencollective/opencollective-postinstall |
| pako | 1.0.11 | (MIT AND Zlib) | https://github.com/nodeca/pako |
| pdfjs-dist | 6.3.289 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| process-nextick-args | 2.0.1 | MIT | https://github.com/calvinmetcalf/process-nextick-args |
| readable-stream | 2.3.8 | MIT | https://github.com/nodejs/readable-stream |
| regenerator-runtime | 0.13.11 | MIT | https://github.com/facebook/regenerator.git#main |
| restructure | 3.0.2 | MIT | https://github.com/devongovett/restructure |
| safe-buffer | 5.1.2 | MIT | https://github.com/feross/safe-buffer |
| setimmediate | 1.0.5 | MIT | https://github.com/YuzuJS/setImmediate |
| string_decoder | 1.1.1 | MIT | https://github.com/nodejs/string_decoder |
| tesseract.js-core | 7.0.0 | Apache-2.0 | https://github.com/naptha/tesseract.js-core |
| tesseract.js | 7.0.0 | Apache-2.0 | https://github.com/naptha/tesseract.js |
| tr46 | 0.0.3 | MIT | https://github.com/Sebmaster/tr46.js |
| tslib | 2.8.1 | 0BSD | https://github.com/Microsoft/tslib |
| util-deprecate | 1.0.2 | MIT | https://github.com/TooTallNate/util-deprecate |
| wasm-feature-detect | 1.9.0 | Apache-2.0 | https://github.com/GoogleChromeLabs/wasm-feature-detect |
| webidl-conversions | 3.0.1 | BSD-2-Clause | https://github.com/jsdom/webidl-conversions |
| whatwg-url | 5.0.0 | MIT | https://github.com/jsdom/whatwg-url |
| zlibjs | 0.3.1 | MIT | https://github.com/imaya/zlib.js |

Notlar:
- `jszip` çift lisanslıdır (MIT veya GPL-3.0-or-later); bu projede MIT seçeneği kullanılır.
- `pako` MIT ve Zlib lisanslarını birlikte taşır.
- Her paketin tam lisans metni, paketin kendi klasöründeki LICENSE dosyasında (kurulum paketinde `node_modules` altında) bulunur.

## Electron ve Chromium

Uygulama Electron üzerinde çalışır (MIT lisansı). Electron'un lisansı `LICENSE.electron.txt`, Chromium ve içerdiği tüm bileşenlerin lisansları `LICENSES.chromium.html` dosyasındadır; ikisi de electron-builder tarafından kurulum klasörüne konur.
The app runs on Electron (MIT). Electron's license is shipped as `LICENSE.electron.txt`; Chromium and its bundled components are listed in `LICENSES.chromium.html`. Both are placed in the install folder by electron-builder.

## Tesseract OCR dil verileri (traineddata)

`@tesseract.js-data/eng` ve `@tesseract.js-data/tur` paketlerindeki `*.traineddata` dosyaları Tesseract projesinden gelir ve **Apache-2.0** lisanslıdır (npm paket üstverisi MIT yazsa da veri dosyalarının lisansı Apache-2.0'dır). Tesseract OCR motoru (`tesseract.js-core`, WebAssembly) Apache-2.0'dır.

## pdf.js: CMap dosyaları

`pdfjs-dist/cmaps` altındaki CMap dosyaları Adobe tarafından yayımlanmıştır ve BSD tarzı bir lisansla dağıtılır (telif: Adobe Systems Incorporated; kaynak koda ve ikiliye yeniden dağıtım koşulu: telif bildiriminin korunması, ad/logo ile onay yasağı). pdf.js'in kendisi Apache-2.0'dır.

## pdf.js: standart yazı tipleri (standard_fonts)

`pdfjs-dist/standard_fonts` altındaki dosyalar iki gruptur; lisans metinleri aynı klasörde (`LICENSE_FOXIT`, `LICENSE_LIBERATION`) bulunur:
- **Foxit** `*.pfb` yazı tipleri: Foxit Software'in BSD tarzı lisansı.
- **Liberation Sans** `*.ttf` (Red Hat): GNU GPL v2 ve "yazı tipi istisnası" (font exception): yazı tipini bir belgeye gömmek belgenin kendisini GPL kapsamına sokmaz. Tam metin: `LICENSE_LIBERATION`.

## Yazı tipleri ve simgeler

Arayüz simgeleri `lucide-static` paketinden (ISC) türetilmiş SVG'lerdir ve `src/renderer/js/icons.js` içine gömülüdür.
