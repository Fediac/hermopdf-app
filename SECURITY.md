# Security Policy / Güvenlik Politikası

[English](#english) · [Türkçe](#türkçe)

---

## English

### Reporting a vulnerability (privately, please)

Do **not** open a public issue for a security problem. Use one of:

1. **GitHub private vulnerability reporting**: the "Report a vulnerability" button under the repository's *Security* tab (preferred).
2. **E-mail:** `northlightstudios25@gmail.com`. Put "SECURITY" in the subject. Do not attach real personal documents; use synthetic files.

Please include: what you found, steps to reproduce, the version, and the impact you see. A short proof of concept is enough.

### What to expect

This is a one-person project, so these are goals, not guarantees:

- We aim to **acknowledge within 7 days** and give a first assessment within 14 days.
- We aim to fix confirmed high-severity issues quickly and publish a fix release; lower severity may wait for the next release.
- We prefer **coordinated disclosure**: please give us up to 90 days before going public, and tell us if you plan to publish sooner.
- We credit reporters in the release notes if you want to be named. There is no bug bounty.
- We will not take legal action against good-faith research that stays within this policy: test on your own installation and your own accounts, do not access other people's data, do not degrade the service for others.

### Supported versions

Only the **latest release** receives security fixes. Pre-release or modified builds are not supported.

### Scope

In scope:

| Area | Examples |
|---|---|
| **The desktop app** (`src/`) | Crashes or memory problems from crafted PDFs, unsafe file handling, path traversal, IPC/preload exposure, code execution, **redaction that leaves removed content recoverable**, encryption/password features that do not protect as described |
| **License server** (hosted service; its code is not in this repository) | Webhook signature verification bypass, replay or duplicate fulfilment, claiming or recovering another buyer's license, e-mail enumeration through `/v1/license/recover`, rate-limit bypass, CORS misconfiguration, injection, leaking secrets or private keys, forging or tampering with the revocation list |
| **License keys and signed files** | Forging a valid license key, bypassing signature checks on license keys, the update manifest or the revocation list, key-format weaknesses (format `UPRO1`, `UREV1`, `UUPD1`) |
| **MCP bridge (Claude connection)** | Another local process or user connecting to the bridge, bypassing the in-app confirmation for overwriting files or applying redactions, reading documents without the user turning the connection on, path or prompt injection that lets a document's content trigger actions |
| **Website** (`website/`) | XSS, open redirects on the download or checkout flow, tampering with download links or hashes |

Out of scope:

- Windows SmartScreen or Smart App Control warnings about the **unsigned installer** (known; documented on the release page).
- Bypassing or removing the Pro license check **in your own fork or build**. The code is GPL-3.0; that is allowed (see [TRADEMARKS.md](TRADEMARKS.md) for naming).
- Issues that need physical access to an unlocked machine, or an attacker who already has administrator rights on it.
- Vulnerabilities in third-party services we depend on (our payment provider, Cloudflare, Resend, GitHub): report those to the vendor.
- Denial of service through volumetric traffic, spam, social engineering, or missing best-practice headers with no demonstrated impact.
- Findings that apply only to the Claude connection after the user deliberately turned it on and gave Claude access, and that merely restate the documented behaviour that Claude can read the documents it is shown.

### Keys

Private signing keys (license, update manifest) are **never** stored in this repository. If you believe a private key has leaked, report it as critical immediately.

---

## Türkçe

### Güvenlik açığı bildirme (lütfen özel olarak)

Güvenlik sorunu için herkese açık issue **açma.** Şunlardan birini kullan:

1. **GitHub özel güvenlik bildirimi:** deponun *Security* sekmesindeki "Report a vulnerability" düğmesi (tercih edilen).
2. **E-posta:** `northlightstudios25@gmail.com`. Konuya "SECURITY" yaz. Gerçek kişisel belge ekleme; sentetik dosya kullan.

Şunları yaz: ne buldun, nasıl tekrarlanır, sürüm, gördüğün etki. Kısa bir kanıt örneği yeter.

### Ne beklemeli

Bu tek kişilik bir proje; bunlar garanti değil, hedeftir:

- **7 gün içinde yanıt vermeyi,** 14 gün içinde ilk değerlendirmeyi hedefleriz.
- Doğrulanmış yüksek ciddiyetli sorunları hızlı düzeltip düzeltme sürümü çıkarmayı hedefleriz; düşük ciddiyetliler sonraki sürüme kalabilir.
- **Koordineli açıklamayı** tercih ederiz: kamuya açmadan önce 90 güne kadar süre ver; daha erken yayınlayacaksan bildir.
- İstersen sürüm notlarında adını anarız. Ödül programı yok.
- Bu politika içinde kalan iyi niyetli araştırmaya karşı hukuki yola gitmeyiz: kendi kurulumunda ve kendi hesaplarında dene, başkalarının verisine erişme, başkaları için hizmeti bozma.

### Desteklenen sürümler

Güvenlik düzeltmesi yalnızca **son sürüme** gelir. Ön sürüm ya da değiştirilmiş derlemeler desteklenmez.

### Kapsam

Kapsam içinde:

| Alan | Örnekler |
|---|---|
| **Masaüstü uygulaması** (`src/`) | Hazırlanmış PDF'lerle çökme/bellek sorunları, güvensiz dosya işleme, yol atlatma, IPC/preload açığı, kod çalıştırma, **silinmiş içeriğin geri alınabildiği karartma**, anlatıldığı gibi korumayan parola/şifreleme |
| **Lisans sunucusu** (barındırılan hizmet; kodu bu depoda değildir) | Webhook imza doğrulamasını atlatma, tekrar oynatma ya da çift teslimat, başka alıcının lisansını alma/kurtarma, `/v1/license/recover` ile e-posta keşfi, hız sınırı atlatma, CORS hatası, enjeksiyon, sır ya da özel anahtar sızması, iptal listesini sahteleme/değiştirme |
| **Lisans anahtarları ve imzalı dosyalar** | Geçerli lisans anahtarı üretme, lisans anahtarı/güncelleme bildirimi/iptal listesi imza kontrolünü atlatma, anahtar biçimi zayıflıkları (`UPRO1`, `UREV1`, `UUPD1`) |
| **MCP köprüsü (Claude bağlantısı)** | Başka bir yerel işlemin ya da kullanıcının köprüye bağlanması, dosya üzerine yazma ya da karartma uygulama için uygulama içi onayın atlatılması, kullanıcı bağlantıyı açmadan belge okunması, belge içeriğinin eylem tetiklemesine yol açan yol/komut enjeksiyonu |
| **Web sitesi** (`website/`) | XSS, indirme ya da ödeme akışında açık yönlendirme, indirme bağlantılarının ya da hash'lerin değiştirilmesi |

Kapsam dışı:

- **İmzasız kurulum dosyası** için Windows SmartScreen / Akıllı Uygulama Denetimi uyarıları (bilinen; sürüm sayfasında anlatılıyor).
- **Kendi fork'unda ya da derlemende** Pro lisans denetimini atlatmak veya kaldırmak. Kod GPL-3.0'dır, buna izin var (adlandırma için [TRADEMARKS.md](TRADEMARKS.md)).
- Kilidi açık bir makineye fiziksel erişim ya da zaten yönetici hakkı olan saldırgan gerektiren durumlar.
- Bağımlı olduğumuz üçüncü taraf hizmetlerin açıkları (ödeme sağlayıcımız, Cloudflare, Resend, GitHub): bunları ilgili şirkete bildir.
- Yoğun trafikle hizmeti aksatma, spam, sosyal mühendislik ya da gösterilmiş etkisi olmayan eksik başlık önerileri.
- Yalnızca kullanıcının Claude bağlantısını bilerek açıp Claude'a erişim verdiği durumlara ait olan ve Claude'un kendisine gösterilen belgeleri okuyabildiği şeklindeki belgelenmiş davranışı tekrarlayan bulgular.

### Anahtarlar

Özel imza anahtarları (lisans, güncelleme bildirimi) bu depoda **asla** tutulmaz. Bir özel anahtarın sızdığını düşünüyorsan hemen kritik olarak bildir.
