# Changelog / Değişiklik Günlüğü

Biçim [Keep a Changelog](https://keepachangelog.com/) düzenindedir; sürümler [Semantic Versioning](https://semver.org/) anlayışını izler. Her sürümde önce İngilizce, sonra Türkçe yazılır.
Tarihler YYYY-MM-DD.
1.0.0 - 1.2.0 sürümleri kimseye dağıtılmamış dahili derlemelerdir; aşağıdaki özellik listeleri güncel ücretsiz/Pro ayrımını göstermez, bu ayrım için 1.3.0 satırlarına ve README'ye bak.

---

## [1.3.0] - 2026-11-18

### English
- **Renamed: PDF Usta is now HermoPDF** (development builds used other short-lived names). Settings and the Pro license from either old name are migrated automatically; old folders are left untouched. (Trademark clearance is not complete.)
- **Claude connection (new, optional, off by default).** Claude Desktop can use the app through a local MCP server. Whatever Claude reads (page text, page images, search results, document names) goes to Anthropic inside your own Claude conversation. Claude cannot overwrite files or apply redactions without an in-app confirmation.
- **Pro license infrastructure (new).** One-time Lifetime Pro with Ed25519-signed license keys, verified offline; a license server and a website for purchase, recovery and revocation of refunded or charged-back licenses. No subscription, no ads, no nag pop-ups (the upgrade window only opens when you click a Pro feature).
- **OCR and batch processing are Pro features.** Reading, editing, compressing to a target size, merging, splitting, signing and basic conversions stay free. Compression's "scan mode" (pages to images) is not OCR and stays free.
- **Saved workflows (Kayıtlı iş akışları) (new, Pro).** Save a batch recipe once and run it any time.
- **Optional update check (new).** Asked once on the start screen; if enabled, downloads a small signed file from our site at most once a day. For Pro users the same optional check also downloads a signed revocation list at most weekly. No telemetry.
- **Source released under GPL-3.0.** The name "HermoPDF" and the logo are reserved (see TRADEMARKS.md).
- Documentation: README, CONTRIBUTING, SECURITY and TRADEMARKS added.

### Türkçe
- **Ad değişti: PDF Usta artık HermoPDF** (geliştirme sürümlerinde kısa ömürlü başka adlar kullanıldı). İki eski adın ayarları ve Pro lisansı kendiliğinden taşınır; eski klasörlere dokunulmaz. (Marka taraması tamamlanmadı.)
- **Claude bağlantısı (yeni, isteğe bağlı, varsayılan kapalı).** Claude Desktop, uygulamayı yerel bir MCP sunucusu üzerinden kullanabilir. Claude'un okuduğu her şey (sayfa metni, sayfa görüntüleri, arama sonuçları, belge adları) kendi Claude sohbetinin içinde Anthropic'e gider. Claude, uygulama içi onay olmadan dosyanın üzerine yazamaz ve karartma uygulayamaz.
- **Pro lisans altyapısı (yeni).** Tek seferlik Lifetime Pro; Ed25519 imzalı lisans anahtarları çevrimdışı doğrulanır; satın alma, kurtarma ve iade/itiraz edilmiş lisansların iptali için bir lisans sunucusu ve web sitesi. Abonelik yok, reklam yok, sıkıştırıcı pencere yok (yükseltme penceresi yalnızca bir Pro özelliğine tıklayınca açılır).
- **OCR ve toplu işlemler Pro özelliğidir.** Okuma, düzenleme, hedef boyuta küçültme, birleştirme, bölme, imza ve temel dönüşümler ücretsiz kalır. Küçültmedeki "tarama modu" (sayfayı görüntüye çevirme) OCR değildir, ücretsizdir.
- **Kayıtlı iş akışları (yeni, Pro).** Toplu işlem tarifini bir kez kaydet, istediğin zaman çalıştır.
- **İsteğe bağlı güncelleme denetimi (yeni).** Başlangıç ekranında bir kez sorulur; açılırsa günde en fazla bir kez sitemizden küçük, imzalı bir dosya indirir. Pro kullanıcıları için aynı denetim en çok haftada bir imzalı iptal listesini de indirir. Telemetri yok.
- **Kaynak kod GPL-3.0 ile açıldı.** "HermoPDF" adı ve logo saklıdır (bkz. TRADEMARKS.md).
- Belgeler: README, CONTRIBUTING, SECURITY ve TRADEMARKS eklendi.

---

## [1.2.0] - 2026-11-08

### English
- **Deep bug hunt: 41 bugs found, confirmed and fixed over two rounds.** The most important ones:
  - Form data from a deleted page stayed in the file.
  - A password-protected PDF lost its protection when saved.
  - Esc closed all nested dialogs at once instead of one.
  - Edits made while saving were lost.
  - After a crash the window did not close.
  - Turkish characters showed as "?" in watermarks.
- Three small edge cases were noted but not fixed (for example the emoji font).
- Test coverage: 90 end-to-end test steps plus 10 checks pass on the development build.

### Türkçe
- **Derin hata avı: iki turda 41 hata bulundu, doğrulandı ve düzeltildi.** En önemlileri:
  - Silinen sayfadaki form bilgisi dosyada kalıyordu.
  - Parolalı PDF kaydedilince korumasını kaybediyordu.
  - Esc iç içe pencerelerin hepsini birden kapatıyordu.
  - Kaydederken yapılan düzenleme kayboluyordu.
  - Çökme sonrası pencere kapanmıyordu.
  - Filigranda Türkçe harfler "?" görünüyordu.
- Üç küçük kenar durum not edildi, düzeltilmedi (örneğin emoji yazı tipi).
- Test: geliştirme sürümünde 90 uçtan uca test adımı ve 10 kontrol geçti.

---

## [1.1.0] - 2026-10-01

### English
- **Word to PDF (new).** Uses Microsoft Word's own engine when Word is installed, otherwise a built-in engine. Supports .docx, .doc, .rtf and .odt, multiple files and drag and drop.
- **Images to PDF is faster:** about 2.5 times, and the interface freeze on large images dropped from about 1.4 s to about 0.35 s. Transparent PNG, WEBP, BMP and GIF are supported.
- Fixed: the "Processing" overlay could stay on top and lock the app during images to PDF. No overlay appears while a file dialog is open anymore.
- 57 automated test steps pass on the development and the installed build.

### Türkçe
- **Word'den PDF (yeni).** Word kuruluysa Word'ün kendi motoru, değilse yerleşik motor. .docx, .doc, .rtf ve .odt, çoklu dosya ve sürükle-bırak desteklenir.
- **Görselden PDF hızlandı:** yaklaşık 2,5 kat; büyük görsellerde arayüz donması yaklaşık 1,4 sn'den yaklaşık 0,35 sn'ye indi. Saydam PNG, WEBP, BMP ve GIF desteklenir.
- Düzeltme: görselden PDF sırasında "İşlem sürüyor" katmanı üstte kalıp uygulamayı kilitleyebiliyordu. Dosya seçme penceresi açıkken artık hiçbir katman çıkmıyor.
- Geliştirme ve kurulu sürümde 57 otomatik test adımı geçti.

---

## [1.0.0] - 2026-09-18

### English
- First installer. Edit and add text, signatures, OCR, compression, password protection, merge and split pages.
- Fixed: the app froze when several PDFs were opened in a row from Explorer.

### Türkçe
- İlk kurulum dosyası. Metin ekleme/düzenleme, imza, OCR, sıkıştırma, parola koruması, sayfa birleştirme ve bölme.
- Düzeltme: Explorer'dan art arda PDF açılınca uygulama donuyordu.
