# Contributing / Katkı

[English](#english) · [Türkçe](#türkçe)

---

## English

Thanks for wanting to help. HermoPDF is maintained by one person, so a few simple rules keep things manageable.

### Before you start

- **Open an issue first** for anything bigger than a small fix. Describe the problem and what you plan to do.
- The maintainer **may decline large pull requests**, even good ones, if they don't fit the direction or are too costly to review. That is not a judgment of the work; an issue first avoids wasted effort.
- Security problems: do **not** open a public issue. See [SECURITY.md](SECURITY.md).
- By taking part you agree to be respectful and assume good faith.

### Set up and run

Requirements: Windows, a current Node.js LTS, Git.

```bash
npm ci
npm start
```

### Tests

Tests drive the real app on **synthetic** documents (see `tests/make-fixtures.js` and `tests/fixtures/`).

```bash
npm run test:e2e       # end-to-end suite
npm run test:convert   # Word/PDF conversion
npm run test:claude    # Claude bridge
node tests/<name>.js   # other suites, e.g. tests/modules.js, tests/dialogs.js
```

Run the suites that touch your change, and say in the PR which ones you ran. If you fix a bug, add or extend a test that fails without the fix.

If you work on the website (`website/`), follow the `README` in that folder (the license server is not part of this repository). **Tests must generate throwaway keypairs**; never put a real private key in a test, fixture, log or commit.

### Use only synthetic PDFs

Never commit real people's documents: no real IDs, diplomas, invoices, contracts or anything with personal data. Use generated or clearly fake files. PRs that include real personal data will be closed and asked to rewrite history.

### Code style

- Follow the surrounding code. The project uses 2-space indentation, single quotes, semicolons and plain JavaScript: CommonJS in the main process (`src/main`), ES modules in the renderer (`src/renderer/js`).
- User-facing strings live in `src/renderer/locales/*.json` (11 languages; `npm run test:i18n` and `npm run i18n:check` verify them). Keep new strings consistent with the existing tone and add them to every locale; do not add a new UI language in a drive-by PR (open an issue to discuss).
- Keep functions small, comment the "why", and avoid new dependencies unless needed. Any new dependency must have a license compatible with GPL-3.0; mention it in the PR.
- Do not add network calls. The app's network behaviour is documented in the README and is part of its promise. A change that touches it needs an issue and maintainer approval first.

### Sign-off (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/) instead of a CLA. Every commit needs a `Signed-off-by` line with your real name and e-mail; `git commit -s` adds it:

```
Signed-off-by: Your Name <you@example.com>
```

By signing off you state that you have the right to submit the work under the project's open-source license (GPL-3.0).

### Pull requests

1. Fork, create a branch, make one focused change.
2. Keep the diff small. Don't mix refactors with behaviour changes.
3. Describe what changed and why, how you tested it, and screenshots (of synthetic documents) for UI changes.
4. **AI-assisted contributions are welcome** if you disclose it in the PR and you understand and have tested every line. You are responsible for it.
5. PRs that only remove or weaken the Pro license check will not be merged. The GPL lets you do that in your own fork, under a different name (see [TRADEMARKS.md](TRADEMARKS.md)).

---

## Türkçe

Yardım etmek istediğin için teşekkürler. HermoPDF tek kişi tarafından bakılıyor; birkaç basit kural işi yönetilebilir tutar.

### Başlamadan önce

- Küçük bir düzeltmeden büyük her şey için **önce bir issue aç.** Sorunu ve ne yapmayı düşündüğünü anlat.
- Bakımcı, **büyük PR'ları reddedebilir**; iyi olsalar bile yön ile uyuşmuyorsa ya da incelemesi çok pahalıysa. Bu işin değerine dair bir yargı değildir; önce issue açmak boşa emeği önler.
- Güvenlik sorunları: herkese açık issue **açma.** [SECURITY.md](SECURITY.md).
- Katılırken saygılı olmayı ve iyi niyeti varsaymayı kabul edersin.

### Kurulum ve çalıştırma

Gereksinimler: Windows, güncel Node.js LTS, Git.

```bash
npm ci
npm start
```

### Testler

Testler gerçek uygulamayı **sentetik** belgelerle çalıştırır (`tests/make-fixtures.js`, `tests/fixtures/`).

```bash
npm run test:e2e       # uçtan uca paket
npm run test:convert   # Word/PDF dönüştürme
npm run test:claude    # Claude köprüsü
node tests/<ad>.js     # diğer paketler (ör. tests/modules.js, tests/dialogs.js)
```

Değişikliğine dokunan paketleri çalıştır ve PR'da hangilerini çalıştırdığını yaz. Bir hatayı düzeltiyorsan, düzeltme olmadan başarısız olan bir test ekle ya da genişlet.

Site (`website/`) üzerinde çalışıyorsan o klasördeki `README`'yi izle (lisans sunucusu bu depoda değildir). **Testler geçici (tek kullanımlık) anahtar çifti üretmelidir;** test, fixture, günlük ya da commit içine gerçek özel anahtar asla koyma.

### Yalnız sentetik PDF

Gerçek kişilerin belgelerini commit'leme: gerçek kimlik, diploma, fatura, sözleşme ya da kişisel veri içeren hiçbir şey. Üretilmiş ya da açıkça sahte dosyalar kullan. Gerçek kişisel veri içeren PR'lar kapatılır ve geçmişin temizlenmesi istenir.

### Kod stili

- Çevredeki kodu izle. Proje 2 boşluk girinti, tek tırnak, noktalı virgül ve sade JavaScript kullanır: ana süreçte CommonJS (`src/main`), arayüzde ES modülleri (`src/renderer/js`).
- Kullanıcıya görünen metinler `src/renderer/locales/*.json` içindedir (11 dil; `npm run test:i18n` ve `npm run i18n:check` denetler). Yeni metinleri mevcut üsluba uydur ve tüm dillere ekle; başka bir değişikliğin içine gizlice yeni bir arayüz dili ekleme (önce issue aç).
- Fonksiyonlar küçük olsun, "neden"i yorumla, gerekmedikçe yeni bağımlılık ekleme. Yeni bağımlılığın lisansı GPL-3.0 ile uyumlu olmalı; PR'da belirt.
- Ağ çağrısı ekleme. Uygulamanın ağ davranışı README'de yazılıdır ve vaadin parçasıdır. Ona dokunan değişiklik için önce issue ve bakımcı onayı gerekir.

### İmza (DCO)

CLA yerine [Developer Certificate of Origin](https://developercertificate.org/) kullanıyoruz. Her commit'te gerçek adın ve e-postanla bir `Signed-off-by` satırı olmalı; `git commit -s` ekler:

```
Signed-off-by: Adın Soyadın <sen@example.com>
```

İmzalayarak, çalışmayı projenin açık kaynak lisansı (GPL-3.0) altında gönderme hakkına sahip olduğunu beyan edersin.

### Pull request

1. Fork et, dal aç, tek ve odaklı bir değişiklik yap.
2. Fark küçük kalsın. Yeniden düzenlemeyi davranış değişikliğiyle karıştırma.
3. Ne değiştiğini ve neden, nasıl test ettiğini yaz; arayüz değişikliğinde ekran görüntüsü ekle (sentetik belgelerle).
4. **Yapay zekâ destekli katkılar** PR'da belirtilirse ve her satırı anlayıp denediysen kabul edilir. Sorumluluk sende.
5. Yalnızca Pro lisans denetimini kaldıran ya da zayıflatan PR'lar birleştirilmez. GPL bunu kendi fork'unda, farklı bir adla yapmana izin verir ([TRADEMARKS.md](TRADEMARKS.md)).
