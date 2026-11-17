# HermoPDF web sitesi

HermoPDF'in resmî sitesi: ürünün tek dağıtım ve tanıtım kanalı. Statik bir site; çalışma anında hiçbir çerçeve yok. Küçük, bağımlılıksız bir Node betiği (`build.mjs`) `src/` klasöründeki şablon ve metinlerden `dist/` klasörünü üretir.

- Türkçe: `/` · İngilizce: `/en/` (her sayfanın `hreflang` çifti ve dil düğmesi var)
- 20 sayfa × 2 dil + 2 adet 404 sayfası
- Web fontu yok (sistem yazıları), CSS sayfaya gömülü, toplam JavaScript birkaç KB
- Açık ve koyu tema: varsayılan sistem tercihi, üst bardaki güneş/ay düğmesiyle elle seçim (`<html data-theme>`, localStorage), 360 px genişlikte yatay kaydırma yok
- Ana sayfa kahramanı: Hermes sahnesi (`src/js/hermes.js`, görseller/video `src/static/hermes/`). WebGL gökyüzü, "İndir"e basınca 8 sn video + altın PDF; "animasyonları azalt" açıksa sahne durgun başlar, sağ üst düğme "Hareketi oynat" der; düğmeye ya da "İndir"e basınca tam hareket (gökyüzü, süzülme, parçacıklar) oynar. WebGL yoksa durağan son kare. Test kancaları: `?timer` (gizli pencere), `?motion`, `?calm` (azalt açıkmış gibi), `?still`, `?nogl`, `?novideo`. Kurulum dosyası yayında değilken (yer tutucu) düğme indirme yerine önizleme mesajı gösterir.
- Gereken: Node 18 veya üstü. `npm install` gerekmez.

## Hızlı başlangıç

```powershell
cd website
node build.mjs          # üretim derlemesi → dist/
node serve.mjs          # http://127.0.0.1:4173 (Cloudflare _headers ve _redirects kurallarını da uygular)
node tools/check.mjs    # ikinci pencerede: tüm sayfaları, bağlantıları, JSON-LD'yi, sitemap'i, hreflang'i denetler
```

`npm run build`, `npm run build:dev`, `npm run serve`, `npm run check`, `npm run images`, `npm run shots` kısayolları da var.

## Klasör yapısı

```
website/
  build.mjs              derleyici (şablon motoru, sitemap, robots, _headers/CSP, _redirects, JSON-LD)
  serve.mjs              yerel önizleme sunucusu
  package.json           yalnız kısayollar; bağımlılık yok
  src/
    config/site.json     TEK yapılandırma yeri: alan adı, API adresi, Freemius ödeme, Pro fiyatı, sürüm bilgisi, sahip bilgisi
    pages.json           sayfa kaydı: her sayfanın TR ve EN adresi, hangi betikleri yüklediği
    content/
      strings.json       menü, alt bilgi gibi ortak kısa metinler (tr / en)
      tr/<sayfa>.html    Türkçe sayfa metinleri
      en/<sayfa>.html    İngilizce sayfa metinleri
      demo-numbers.json  küçültme önce/sonra sayıları (tools/shots.mjs doldurur)
    partials/            üst bar, alt bilgi, maskot, logo, CTA bandı, ikonlar
    css/site.css         tüm stil (derlemede sayfaya gömülür)
    js/                  site.js (her sayfa), checkout.js (fiyat), claim.js (satın alma sonrası), recover.js
    img/                 og-tr.png, og-en.png, logo, ikon, shots/ (ekran görüntüleri)
    static/              olduğu gibi kopyalanan dosyalar (favicon.svg, ileride updates/latest.json)
  tools/
    make-images.mjs      OG kartları, ikonlar ve ekran görüntüsü yer tutucuları (Edge ile çizer)
    shots.mjs            uygulamanın kendisinden gerçek ekran görüntüleri + küçültme sayıları
    check.mjs            uçtan uca site denetimi
```

## Metinleri düzenlemek

Her sayfa iki dosyadır: `src/content/tr/<id>.html` ve `src/content/en/<id>.html`. Dosyanın en üstünde bir meta bloğu var:

```html
<!--meta
{
  "title": "PDF Küçültme Programı: 1 MB Altına, Yüklemeden | HermoPDF",
  "description": "Arama sonuçlarında görünen açıklama (70-160 karakter).",
  "ogTitle": "İsteğe bağlı: paylaşım kartı başlığı"
}
-->
```

Altında düz HTML gövde gelir. Derleyici şu etiketleri çözer:

| Etiket | Ne yapar |
|---|---|
| `{{url:compress}}` | O sayfanın bu dildeki adresi (`/pdf-kucultme/` ya da `/en/compress-pdf-to-1mb/`). Sayfa adresini asla elle yazma. |
| `{{url:home#features}}` | Adres + çapa |
| `{{cfg:release.version}}` | `site.json`'dan değer (HTML'e güvenli kaçışla) |
| `{{t:ctaDownload}}` | `strings.json`'dan ortak metin |
| `{{> cta}}` | `src/partials/cta.html` parçasını ekler |
| `{{shot:ad\|alt metin\|altyazı}}` | `src/img/shots/ad.png` görselini doğru en/boy oranı ve tembel yüklemeyle ekler. Alt metin zorunlu. |
| `{{numbers}}` | `demo-numbers.json`'daki önce/sonra kutusu (boşsa üretimde hiçbir şey basmaz) |

Kurallar (derleyici bunları denetler ve hata verir):

- **`style="..."` kullanma.** Güvenlik politikası (CSP) satır içi stili engeller; `site.css`'e sınıf ekle.
- Her sayfanın başlığı ve açıklaması tekil olmalı.
- Bilinmeyen etiket, eksik çeviri anahtarı, eksik sayfa ya da alt metinsiz görsel derlemeyi durdurur.
- SSS sayfasındaki `<details class="faq"><summary>Soru</summary><div class="faq-a">Cevap</div></details>` yapısı aynen korunmalı; Google için FAQPage verisi buradan üretilir.

Yeni sayfa eklemek: `pages.json`'a `"id": { "tr": "/adres/", "en": "/en/address/" }` ekle, iki içerik dosyasını yaz, gerekirse alt bilgiye `{{url:id}}` bağlantısı koy. Bir sayfanın adresini değiştirirsen eski adres için `build.mjs` içindeki `_redirects` listesine 301 ekle.

Rakip karşılaştırmaları (`home`, `compare` sayfaları) `docs/research/pazarlama-arastirmasi.md`'deki kaynaklı bulgulara dayanır ve tarihlidir (`site.json` → `compareDate`). Fiyat/özellik değişirse metni ve tarihi birlikte güncelle; kaynağı olmayan iddia ekleme.

## Derleme modları

| Komut | Ne zaman | Fark |
|---|---|---|
| `node build.mjs` | yayın | `?demo=1` kodu JS'ten **tamamen silinir**, CSP yalnız gerçek API'ye izin verir, HSTS ve `upgrade-insecure-requests` açık |
| `node build.mjs --dev` | yerel deneme | satın alma sonrası ve lisans kurtarma sayfaları `?demo=1` ile `http://127.0.0.1:8787` yerel lisans sunucusuyla konuşur |
| `node build.mjs --config yol.json` | deneme | başka bir yapılandırmayla derle (ör. checkoutEnabled:true ile CSP testi) |

Cloudflare'a **yalnız** `node build.mjs` çıktısı yüklenmeli.

### Satın alma akışını uçtan uca yerelde denemek (demo modu)

1. Lisans sunucusu (`server/`): `.dev.vars` içine `ALLOWED_ORIGINS=http://127.0.0.1:4173,http://localhost:4173` ekle, sonra `npm run dev` (ayrıntı: `server/README.md`).
2. Site: `node build.mjs --dev` ve `node serve.mjs`.
3. En kolayı: `node tools/qa-flow.mjs` (wrangler'sız; sunucu kodu bellek içi D1 ve sahte Freemius API ile çalışır, akışı Edge'de dener). Yerel `wrangler dev` ile denemek istersen (Paddle simülatörü Freemius'ta çalışmaz) sahte imzalı `payment.created` gönder ve `http://127.0.0.1:4173/tr/lisansimi-kaybettim/?demo=1` sayfasına o olaydaki `objects.license.secret_key`'i yapıştır.

Gerçek akışta e-posta ve kanıtlar **asla adres çubuğuna yazılmaz**: ödeme tamamlandığında ödeme ekranından gelen bilgi sekmeye özel `sessionStorage`'a konur, anahtar gösterilince silinir.

## Görseller

- `node tools/make-images.mjs` — `og-tr.png`, `og-en.png` (1200×630), `apple-touch-icon.png`, `logo-512.png` ve eksik ekran görüntüleri için yer tutucular üretir. Bilgisayardaki Microsoft Edge'i kullanır; `playwright-core` uygulama deposundan salt okunur yüklenir, hiçbir şey indirilmez. `--force` OG ve ikonları yeniden çizer (gerçek ekran görüntülerine dokunmaz).
- `node tools/shots.mjs` — **uygulamanın kendisinden** gerçek ekran görüntüleri alır: başlangıç ekranı, metin düzenleme, imza, karartma, hedef boyut küçültme penceresi + sonuç, OCR, toplu işlem. Uygulamayı `tests/harness.js` ile aynı biçimde (`PDFUSTA_TEST=1`, geçici `PDFUSTA_USERDATA`) başlatır ve yalnız `PDFUsta/tests/fixtures` içindeki sentetik belgeleri geçici bir klasöre kopyalayıp kullanır. Küçültmenin gerçek önce/sonra boyutlarını `src/content/demo-numbers.json`'a yazar. Uygulama üzerindeki işler bitince çalıştır, sonra `node build.mjs`.
  - Tek bir görüntü: `node tools/shots.mjs kucultme`
  - Hangi görüntülerin hâlâ yer tutucu olduğu `src/img/shots/.placeholders.json`'da tutulur; derleme bunlar için uyarı verir.
  - Arayüz değiştiyse (düğme adları vb.) betikteki seçicileri `PDFUsta/tests/e2e.js` ve `e2e2.js` ile karşılaştır.
- `node tools/compress-demo.mjs [dil ...]` — ana sayfadaki "hedef boyuta küçültme" hareketli görseli: uygulamayı her dilde (11 dil) çalıştırır, Hermes örnek PDF'ini (Edge ile o dilde üretilir) gerçekten 0,5 MB hedefiyle küçültür ve ekranı kaydeder → `src/static/demo/kucultme.<dil>.mp4` (sessiz, ~7 sn döngü) + `.webp` (durağan poster: sonuç ekranı) + `src/content/demo-compress.json` (gerçek önce/sonra baytları). Gerekenler: PATH'te `ffmpeg`, Edge. Şablonda `{{demo:kucultme|<eski shot etiketi>}}`; dosya yoksa eski ekran görüntüsü gösterilir. Oynatma `js/demo.js`: görünürken oynar, "animasyonları azalt" ya da üstteki "Hareketi durdur" açıkken poster kalır, köşedeki düğmeyle durdurulur/başlatılır.

## Yapılandırma: yayından önce doldurulacak yer tutucular

Hepsi `src/config/site.json` içinde. İçinde `PLACEHOLDER` geçen bir değer kaldıkça sitenin en üstünde "Önizleme" şeridi görünür.

| Alan | Şu an | Ne yazılmalı |
|---|---|---|
| `siteUrl` | `https://hermopdf.com` | Alınan gerçek alan adı (marka teyidinden sonra) |
| `apiBase` | `https://api.hermopdf.com` | Lisans sunucusunun adresi (CSP de buna göre üretilir) |
| `githubUrl` | herkese açık deponun adresi | Gerçek depo |
| `contactEmail` | (dolu, çalışan adres) | Destek, gizlilik, iade ve koşul sayfalarındaki tek iletişim adresi (ödeme sağlayıcısı (Freemius) onayı için iletişim iki tıkta bulunmalı) |
| `goatcounter` | boş | GoatCounter site kodu (ör. `hermopdf`); boşken sayaç hiç yüklenmez |
| `freemius.checkoutEnabled` | `false` | Gerçek ödemeyi açan bayrak. false iken düğme "Yakında" gösterir, Freemius betiği yüklenmez |
| `freemius.productId / planId / pricingId / publicKey` | 45325 / 79873 / 120529 / `pk_...` | Freemius ürünü, Pro (Lifetime) planı ve **genel** anahtar. Gizli anahtar (`sk_...`) asla buraya yazılmaz |
| `pro.price`, `pro.priceTR`, `pro.currency` | 6.99 / 3.99 USD | Pro fiyatı TEK burada; `{{price:pro}}` (diğer ülkeler) ve `{{price:proTR}}` (yalnız Türkçe sayfa, lansman fiyatı) |
| `freemius.couponTR` | TR399 | Freemius kuponu (sabit 3 $ indirim, kişi başı 1, 500 kullanım, süresiz); Türkçe sayfada `coupon`+`hide_coupon` ile otomatik uygulanır |
| `release.*` | 1.2.0, yer tutucu SHA-256 | Her sürümde: sürüm, tarih, dosya adı, GitHub Releases bağlantısı, boyut (MB), kurulu boyut, `certutil -hashfile <exe> SHA256` çıktısı, VirusTotal rapor adresi |
| `owner.legalName`, `owner.address` | yer tutucu | Freemius satıcı kaydındakiyle **birebir aynı** yasal ad ve görünür adres (yasal sayfalarda geçer) |
| `legalUpdated`, `compareDate` | 8 Kasım 2026 | Yasal metinler ya da karşılaştırma değişince güncelle |

### Freemius notları (ödeme)

- Satıcı: Freemius (Merchant of Record). Betik `https://checkout.freemius.com/js/v1/` yalnız fiyat sayfasında ve yalnız `freemius.checkoutEnabled` true ise yüklenir (`src/js/checkout.js`); `new FS.Checkout({product_id, plan_id, public_key, image})` + `handler.open({name, licenses:1, purchaseCompleted, success})`.
- Sandbox modu sunucu tarafında imzalı jeton ister; bu sitede sandbox imzası üretilmez, yalnız canlı overlay hazırdır.
- CSP (fiyat sayfası): `script-src` ve `frame-src` için `checkout.freemius.com`, `style-src` için `'unsafe-inline'` (betik satır içi stil ekliyor). Betiğin kaynağında fetch/XHR yok; bu yüzden `connect-src`/`img-src` genişletilmedi. Resmî belgede CSP listesi yok: **canlıya almadan önce gerçek bir ödeme açılışında konsolda CSP hatası olmadığını kontrol et**, gerekirse `build.mjs` → `csp()`.
- İade: 14 gün koşulsuz (Freemius). Destek adresi şimdilik `contactEmail`; `support@hermopdf.com` sonra eklenecek.
- Lisans teslimi (17 Kas 2026): ödeme penceresinin `purchaseCompleted` geri çağrısı `license_id`, `user.id`, `user.email`, `user.public_key`'i sekmeye özel `sessionStorage`'a yazar (adres çubuğuna asla); "Satın alma tamamlandı" sayfası (`claim.js`) bunlarla sunucunun `claim` ucunu çağırır, anahtarı kopyala/indir düğmeleri ve "şimdi kaydet" uyarısıyla gösterir. Olmazsa (ya da Freemius'un kendi ödeme sayfasından alındıysa, sitemize dönüş yok) müşteri Freemius'un verdiği lisans anahtarını formda yapıştırır; "Lisansımı kaybettim" sayfası da aynı formu (claim.js) + e-posta yolunu (recover.js; sunucuda e-posta kurulu değilse dürüstçe "henüz açık değil" der) içerir. Güvenlik tasarımı: `server/README.md` > claim.
- Yerel deneme: `node build.mjs --dev`, `node serve.mjs`, `node tools/qa-flow.mjs` (gerçek Edge, sahte Freemius API + atılabilir anahtarlar, ekran görüntüleri `qa/flow-*.png`). Demo adresi: `/tr/satin-alma-tamamlandi/?demo=1&license_id=..&user_id=..&email=..&pk=..`.

### Güncelleme bildirimi dosyası

Uygulamanın isteğe bağlı güncelleme denetimi `<siteUrl>/updates/latest.json` dosyasını okur. Bu dosyayı sahip **çevrimdışı** imzalar (`release-2026a` anahtarı) ve `src/static/updates/latest.json` olarak koyar; derleme olduğu gibi kopyalar ve 5 dakikalık önbellek başlığı ekler. Özel anahtarlar asla bu depoya girmez.

## Cloudflare Pages'e yayınlama (sahibin adımı)

1. Cloudflare'da bir Pages projesi aç (ör. `hermopdf`).
2. Ya Git'e bağla: derleme komutu `cd website && node build.mjs`, çıktı klasörü `website/dist`, ortam değişkeni `NODE_VERSION=20`.
   Ya da elle yükle: `node build.mjs` sonra `npx wrangler pages deploy website/dist --project-name hermopdf`.
3. Özel alan adını bağla; HTTPS otomatik gelir. `_headers` dosyası HSTS'yi (1 yıl) zaten açar.
4. Cloudflare'ın sayfaya **betik enjekte eden** özelliklerini kapalı tut: Rocket Loader, E-posta adresi gizleme (Email Obfuscation), otomatik Web Analytics enjeksiyonu, Zaraz. Sıkı CSP bunları engeller ve konsolda hata çıkar.
5. Yayından sonra: `https://<alan-adı>/sitemap.xml`'i Google Search Console'a ekle.

## Yayına almadan önce kontrol listesi

- [ ] Marka adı teyit edildi, alan adı alındı; `siteUrl` ve `apiBase` güncellendi.
- [ ] `site.json`'da hiç `PLACEHOLDER` kalmadı (sitenin üstündeki "Önizleme" şeridi kayboldu).
- [ ] `node tools/shots.mjs` çalıştırıldı; `.placeholders.json` boş; `demo-numbers.json` gerçek sayılarla dolu ve sayılar sayfada mantıklı görünüyor.
- [ ] İndirme sayfası: gerçek sürüm, boyut, SHA-256 (kendi bilgisayarında `certutil` ile doğruladın), VirusTotal raporu, GitHub Releases bağlantısı çalışıyor.
- [ ] Gizlilik politikası, kullanım koşulları ve iade politikası sahip ve bir hukukçu tarafından gözden geçirildi; üstteki "Taslak" kutuları kaldırıldı (`strings.json` → `draftLegal` kullanan satırlar).
- [ ] Gizlilik politikasındaki ağ davranışı, uygulamanın **son** sürümüyle birebir aynı (güncelleme denetimi sıklığı, iade listesi, telemetri yok). Uygulama değiştiyse metni güncelle.
- [ ] "Nasıl geliştiriliyor" paragrafı (Açık kaynak sayfası) sahibin onayladığı ifadeyle duruyor.
- [ ] Lisans etkinleştirme adımları (Satın alma tamamlandı sayfası) uygulamadaki gerçek menü adlarıyla eşleşiyor; `.hermopdflicense` dosya biçimi uygulamanın beklediği biçim.
- [ ] Freemius ödeme ekranında (canlı, checkoutEnabled:true) gerçek bir açılış denemesi: ödeme ekranı açılıyor, işlem bitince satın alma tamamlandı sayfası anahtarı gösteriyor, e-posta geliyor, iade sonrası lisans iptal listesinde.
- [ ] Lisans sunucusunun `ALLOWED_ORIGINS` değeri sitenin gerçek kökenini içeriyor.
- [ ] Karşılaştırma tablosundaki fiyatlar ve iddialar yayın günü yeniden kontrol edildi, `compareDate` güncellendi.
- [ ] `node build.mjs` (üretim) + `node serve.mjs` + `node tools/check.mjs` → "Sorun yok."
- [ ] Telefonda (360 px) ve koyu temada birkaç sayfaya bakıldı.
- [ ] GoatCounter kodu girildiyse gizlilik politikası onu anlatıyor (anlatıyor); girilmediyse ilgili paragrafı kaldırmayı düşün.

## Diller (12 Kasım 2026)

- 11 dil: en, tr, es, fr, de, pt-BR, ru, zh-Hans, ja, ko, ar (ar sağdan sola). Liste: `src/content/languages.json`.
- Adresler: İngilizce kökte (`/`, `/download/`), Türkçe `/tr/` altında (`/tr/indir/`), diğerleri kendi önekiyle ve İngilizce adres parçasıyla (`/es/download/`, `/zh/`, `/pt-br/`). Eski adresler (`/indir/`, `/fiyat`, `/en/...`) `_redirects` ile 301 yönlenir; uygulamanın `/fiyat` ve `/destek` bağlantıları çalışır.
- Metinler: `src/content/strings/<dil>.json` (eksik anahtar İngilizceye düşer). Sayfalar: `src/content/<dil>/<id>.html`. Bir dilde sayfa yoksa İngilizce içerik o dilin üst/alt menüsüyle gösterilir; üstte not, `noindex`, canonical İngilizce sürüm, site haritasında yok. Yasal sayfalarda "İngilizce sürüm geçerlidir" notu çıkar.
- Bugün çevrilmiş: en + tr tam; diğer 9 dilde metinler + ana sayfa + 404.
- Dil seçimi: sağ üstte aranabilir liste (dil adları kendi dilinde; Türkçe "alm" yazınca Deutsch çıkar). İlk ziyarette tarayıcı dili farklıysa sağ altta bir kez öneri çıkar (yönlendirme yok); seçim `localStorage.lang`'a yazılır ve sonraki ziyaretlerde dışarıdan gelinen sayfa ilk boyamadan önce o dile geçer.
- Ekran görüntüleri dile göre: `img/shots/<ad>.<dil>.png` → (tr dışı diller) `<ad>.en.png` → `<ad>.png`. Bugünkü `<ad>.png` dosyaları Türkçe arayüzlü; İngilizce arayüz görüntüleri gelince `<ad>.en.png` olarak eklenir, kod değişmez.