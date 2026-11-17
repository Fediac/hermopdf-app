# HermoPDF

**Free, offline PDF editor for Windows. Open source (GPL-3.0). No account, no ads, no watermark.**

> PDF'in sahibi sensin. · *You own your PDFs.*
> No subscription. No ads. Your documents stay on your computer.

HermoPDF (formerly **PDF Usta**) edits, signs, merges, compresses and converts PDFs entirely on your own machine. Current version: **1.3.0**.

[English](#english) · [Türkçe](#türkçe)

---

## English

### What it is

A desktop PDF editor for Windows built with Electron, pdf.js, pdf-lib and tesseract.js. It works offline, needs no account, shows no ads and adds no watermark. The interface is available in 11 languages (English, Turkish, Spanish, French, German, Brazilian Portuguese, Russian, Simplified Chinese, Japanese, Korean, Arabic).

Working name notice: "HermoPDF" is a working name. Trademark clearance is not complete, so the name may change before a stable release.

### Screenshots

Screenshots are on the website: https://hermopdf.com

### Features (tested in the app)

- Edit and add text, images, shapes, highlights, notes and (visual) signatures
- Merge, split, extract, reorder, rotate and delete pages
- Compress, including **target size** ("under 1 MB")
- OCR in Turkish and English (Pro)
- **True redaction**: the content is removed from the file, not just covered
- Password protect and remove passwords
- Fill forms
- Images to PDF
- Word to PDF: uses Microsoft Word if installed, otherwise a built-in engine
- PDF to Word and to images
- Batch processing: compress, OCR, watermark, page numbers and more on many files (Pro)
- Print
- Works offline; no account

Visual signatures are **not** qualified e-signatures. There is no UDF or PAdES support.

### Download

Get the installer from **https://hermopdf.com** or from the GitHub Releases page of this repository. Every release lists the SHA-256 of the installer. Verify it before running:

```powershell
Get-FileHash .\HermoPDF-Setup-<version>.exe -Algorithm SHA256
```

The installer is **not code-signed yet**. Windows SmartScreen may warn you, and Windows 11 Smart App Control can block unsigned apps that have no reputation. The release notes explain the options; you can also build from source (below).

### Privacy and network behaviour

HermoPDF sends no telemetry or analytics. An optional update check is asked about once on the start screen. If you turn it on, it downloads a small signed file from our site at most once a day (like any web request, it reveals your IP address and the app version in standard headers). For Pro users, the same optional check also downloads a signed revocation list of refunded or charged-back licenses at most weekly. License activation works offline.

Your files are processed on your computer. We make no claim about certifications, audits or legal compliance.

### Claude connection (optional)

The "Claude connection" is optional and off by default. If you turn it on, whatever Claude reads through it (page text, page images, search results, document names) goes to Anthropic inside your own Claude conversation, under your Claude account's terms. Claude cannot overwrite files or apply redactions without your confirmation in the app. The connection is free; Claude usage counts against your own Claude plan. The bridge is a local MCP server; see [SECURITY.md](SECURITY.md) for its scope.

### Free and Pro

Reading, editing, compressing to a target size, merging, splitting, signing and basic conversions are free. **Lifetime Pro** is a one-time purchase (no subscription, no ads) that adds **OCR, batch processing and saved workflows**. **Pro features are open source too; official builds unlock them with a license. Buying one supports development.** You can build from source and use the code under the GPL-3.0; the official, named build is what the license unlocks. Details and current price: https://hermopdf.com

### Build from source

Requirements: Windows, a current Node.js LTS, Git.

```bash
git clone <repository-url>
cd <repository-folder>
npm ci          # install dependencies
npm start       # run the app (electron .)
```

Tests (use only synthetic PDFs; they run the real app):

```bash
npm run test:e2e       # end-to-end suite (tests/e2e.js)
npm run test:convert   # Word/PDF conversion checks (tests/convert.js)
npm run test:claude    # Claude bridge checks (tests/claude.js)
npm run test:i18n      # interface language checks (tests/i18n.js)
npm run test:license   # license verification checks (tests/license-unit.js, tests/license.js)
node tests/<name>.js   # other suites in tests/ (see CONTRIBUTING.md)
```

Build the Windows installer:

```bash
npm run dist    # builds the MCP bundle, then runs electron-builder (output in dist/)
```

Repository layout: `src/` (app: `main` and `renderer`), `build/` (icons, installer script), `tests/`, `tools/`, `website/` (source of the site).

**The license server is not part of this repository.** The official build unlocks Pro features with an Ed25519-signed license key issued by our license server; the app only verifies the signature offline, so no server code is needed to build, run or test the app (the tests generate throwaway keys and use a local fake server).

### How it was built

HermoPDF was developed by one person with AI coding assistants (including Anthropic's Claude), then tested with the automated suites in `tests/` and by hand on real documents. We say this up front because people ask. The code and tests are public; judge it by whether it works on your files, and please report what doesn't.

### License and trademark

The code is licensed under the **GNU General Public License v3.0** (see [LICENSE](LICENSE)). The name "HermoPDF" and the logo are **not** covered by that license; see [TRADEMARKS.md](TRADEMARKS.md). A fork must use a different name and logo.

### Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) (tests, style, DCO sign-off) and [SECURITY.md](SECURITY.md) (private vulnerability reporting). Release history: [CHANGELOG.md](CHANGELOG.md).

---

## Türkçe

### Nedir

Windows için, bilgisayarında çalışan bir PDF düzenleyici (Electron, pdf.js, pdf-lib, tesseract.js). Çevrimdışı çalışır, hesap istemez, reklam göstermez, filigran eklemez. Arayüz 11 dilde (İngilizce, Türkçe, İspanyolca, Fransızca, Almanca, Brezilya Portekizcesi, Rusça, Basitleştirilmiş Çince, Japonca, Korece, Arapça) kullanılabilir.

Çalışma adı uyarısı: "HermoPDF" çalışma adıdır. Marka taraması tamamlanmadı; kararlı sürümden önce ad değişebilir.

HermoPDF'in eski adı **PDF Usta**'dır. Güncel sürüm: **1.3.0**.

### Ekran görüntüleri

Ekran görüntüleri sitede: https://hermopdf.com

### Özellikler (programda denendi)

- Metin, görsel, şekil, vurgulama, not ve (görsel) imza ekleme/düzenleme
- Sayfa birleştirme, bölme, çıkarma, sıralama, döndürme, silme
- Sıkıştırma, **hedef boyuta** ("1 MB altına indir") dahil
- Türkçe ve İngilizce OCR (Pro)
- **Gerçek karartma:** içerik dosyadan kaldırılır, üstü kapatılmaz
- Parola koyma ve kaldırma
- Form doldurma
- Görselden PDF
- Word'den PDF: Microsoft Word kuruluysa Word, değilse yerleşik motor
- PDF'den Word ve görsele
- Toplu işlemler: birçok dosyaya küçültme, OCR, filigran, sayfa numarası ve fazlası (Pro)
- Yazdırma
- Çevrimdışı çalışır; hesap yok

Görsel imza nitelikli e-imza **değildir**. UDF ve PAdES desteği yok.

### İndirme

Kurulum dosyasını **https://hermopdf.com** ya da bu deponun GitHub Sürümler sayfasından indir. Her sürüm, kurulum dosyasının SHA-256 değerini yazar. Çalıştırmadan önce doğrula:

```powershell
Get-FileHash .\HermoPDF-Setup-<sürüm>.exe -Algorithm SHA256
```

Kurulum dosyası **henüz kod imzalı değil**. Windows SmartScreen uyarı verebilir; Windows 11'de Akıllı Uygulama Denetimi, itibarı olmayan imzasız uygulamaları engelleyebilir. Sürüm notları seçenekleri anlatır; kaynaktan da derleyebilirsin (aşağıda).

### Gizlilik ve ağ davranışı

HermoPDF telemetri ya da analitik göndermez. İsteğe bağlı güncelleme denetimi başlangıç ekranında bir kez sorulur. Açarsan günde en fazla bir kez sitemizden küçük, imzalı bir dosya indirir (her web isteği gibi IP adresini ve uygulama sürümünü standart başlıklarda gösterir). Pro kullanıcıları için aynı isteğe bağlı denetim, iade ya da itiraz edilmiş lisansların imzalı iptal listesini en çok haftada bir indirir. Lisans etkinleştirme çevrimdışı çalışır.

Dosyaların bilgisayarında işlenir. Sertifika, denetim ya da yasal uyumluluk iddiamız yoktur.

### Claude bağlantısı (isteğe bağlı)

"Claude bağlantısı" isteğe bağlıdır ve varsayılan olarak kapalıdır. Açarsan Claude'un bağlantı üzerinden okuduğu her şey (sayfa metni, sayfa görüntüleri, arama sonuçları, belge adları) kendi Claude sohbetinin içinde, Claude hesabının koşullarına göre Anthropic'e gider. Claude, uygulama içi onayın olmadan dosyanın üzerine yazamaz ve karartma uygulayamaz. Bağlantı ücretsizdir; Claude kullanımı kendi Claude planından düşer. Köprü yerel bir MCP sunucusudur; kapsamı için [SECURITY.md](SECURITY.md).

### Ücretsiz ve Pro

Okuma, düzenleme, hedef boyuta küçültme, birleştirme, bölme, imza ve temel dönüşümler ücretsizdir. **Lifetime Pro** tek seferlik bir satın almadır (abonelik yok, reklam yok); **OCR, toplu işlemler ve kayıtlı iş akışlarını** ekler. **Pro özellikleri de açık kaynaktır; resmî sürümler bunları lisansla açar. Satın almak geliştirmeye destek olur.** Kaynaktan derleyip GPL-3.0 kapsamında kullanabilirsin; lisansın açtığı şey resmî, adı olan sürümdür. Ayrıntı ve güncel fiyat: https://hermopdf.com

### Kaynaktan derleme

Gereksinimler: Windows, güncel bir Node.js LTS, Git.

```bash
git clone <depo-adresi>
cd <depo-klasörü>
npm ci          # bağımlılıkları kur
npm start       # uygulamayı çalıştır (electron .)
```

Testler (yalnız sentetik PDF kullanır; gerçek uygulamayı çalıştırır):

```bash
npm run test:e2e       # uçtan uca paket (tests/e2e.js)
npm run test:convert   # Word/PDF dönüştürme kontrolleri (tests/convert.js)
npm run test:claude    # Claude köprüsü kontrolleri (tests/claude.js)
npm run test:i18n      # arayüz dili kontrolleri (tests/i18n.js)
npm run test:license   # lisans doğrulama kontrolleri (tests/license-unit.js, tests/license.js)
node tests/<ad>.js     # tests/ içindeki diğer paketler (bkz. CONTRIBUTING.md)
```

Windows kurulum dosyası:

```bash
npm run dist    # önce MCP paketini derler, sonra electron-builder çalıştırır (çıktı dist/)
```

Depo yapısı: `src/` (uygulama: `main`, `renderer`), `build/` (ikonlar, kurulum betiği), `tests/`, `tools/`, `website/` (sitenin kaynağı).

**Lisans sunucusu bu depoda değildir.** Resmî sürüm, lisans sunucumuzun verdiği Ed25519 imzalı bir lisans anahtarıyla Pro özelliklerini açar; uygulama yalnızca imzayı çevrimdışı doğrular, bu yüzden uygulamayı derlemek, çalıştırmak ve test etmek için sunucu koduna gerek yoktur (testler tek kullanımlık anahtar üretir ve yerel sahte bir sunucu kullanır).

### Nasıl geliştirildi

HermoPDF tek kişi tarafından, yapay zekâ kodlama asistanlarıyla (Anthropic'in Claude'u dahil) geliştirildi; sonra `tests/` içindeki otomatik testlerle ve gerçek belgelerle elle denendi. İnsanlar sorduğu için baştan söylüyoruz. Kod ve testler açık; çalışıp çalışmadığına kendi dosyalarında bak, çalışmayanı bildir.

### Lisans ve marka

Kod **GNU Genel Kamu Lisansı v3.0** altındadır ([LICENSE](LICENSE)). "HermoPDF" adı ve logo bu lisansın kapsamında **değildir**: [TRADEMARKS.md](TRADEMARKS.md). Fork'lar farklı ad ve logo kullanmalıdır.

### Katkı ve güvenlik

[CONTRIBUTING.md](CONTRIBUTING.md) (testler, stil, DCO imzası) ve [SECURITY.md](SECURITY.md) (özel güvenlik bildirimi). Sürüm geçmişi: [CHANGELOG.md](CHANGELOG.md).
