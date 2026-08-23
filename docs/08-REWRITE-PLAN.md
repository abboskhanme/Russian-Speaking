# 08 · Rewrite rejasi — Python → .NET

> **Bu hujjat `05-ROADMAP.md` ni almashtiradi.** `05` Python'ni joyida yaxshilash uchun edi;
> endi backend qayta yoziladi. `05` dagi **tartib mantig'i saqlanadi** (grader xavfsizlik to'ri
> birinchi), lekin fazalar boshqa.

**Kontekst:**
- Prod **jonli**: `govorim.uz` → `134.209.240.56`, ~50 real foydalanuvchi. Ishlab turibdi.
- Ko'chirilayotgan: 9 398 qator Python (110 endpoint, 4 Celery task) + 19 405 qator frontend.
- **Prod hech qachon to'xtamaydi** — yangi stack yonida quriladi, cutover bitta qisqa oynada.

---

## Holat — 2026-08-23

> Quyidagi jadvallar **reja** (o'zgarmaydi); bu bo'lim esa **haqiqatda nima bajarilgani**.
> Ziddiyat bo'lsa — shu bo'lim ustun. Belgilar: ✅ tugagan · 🟡 qisman · ⬜ boshlanmagan.
> Qolgan ishning **ketma-ketligi** uchun → `10-YAKUNIY-ISH-REJASI.md`.
>
> O'lchangan baza: `dotnet build Govori.sln -c Release` **0 warning / 0 error** · to'rtala suite
> **316 passed, 0 failed** (4 opt-in skipped; 2026-08-17 da 237 edi) · frontend `npm run build`
> yashil, **155 vitest**, bundle **119.7 / 180 KB gz** · **14 Playwright testi** uchala rol uchun,
> `axe` **critical 0** · jonli baholash quvuri uchidan-uchiga **10.1s** (maqsad p95 < 20s).

| Faza | Holat | Nimasi qolgan |
|---|:--:|---|
| **0 · Ma'lumot xavfsizligi** | 🟡 | **0.5 ✅ va endi tiklash ham ✅** — `deploy/prod-backup-cron.sh` (zaxira) va **`deploy/restore.sh`** (tiklash) yozildi va **haqiqatan sinaldi**: dev dump → toza konteyner → 21 jadval, har biri aynan mos; buzuvchi yo'l (`--into-stack`) alohida tashlab yuboriladigan stack'da 55 user + 11 MinIO obyektini qaytardi. Yo'l-yo'lakay `verify-backup.sh` dagi **haqiqiy xato** tuzatildi: MinIO obyektni FAYL emas KATALOG qilib saqlagani uchun u har sog'lom zaxirada "audio topilmadi" deb yolg'on ogohlantirardi — o'quvchi yozuvlari saqlanganini aytadigan yagona tekshiruv edi. Qolgani **droplet'ga kirishni talab qiladi**: 0.1–0.4, 0.6, 0.7. ✅ **Bloklovchi emas** (2026-08-23, egasining qarori): prod ma'lumoti ko'chirilmaydi, server noldan quriladi — ya'ni asrab qolinadigan 50 foydalanuvchi yo'q va zaxira **kritik yo'lda emas**. Skriptlar saqlanadi va o'rnatishning **ertasiga** kerak bo'ladi: `deploy/README.md` §"After the install". |
| **1 · Xavfsizlik to'ri** | 🟡 | 1.1–1.6 ✅. 2026-08-23 da qayta yugurtirildi: grader **golden set o'tdi**, **jonli vendor smoke 3/3**. ⬜ **STT yarmi**: 40 ta real klip — sun'iy audio bilan to'ldirilmadi, sababi `tests/golden/grader/README.md` da. |
| **2 · .NET poydevor** | ✅ | **2.5 ✅**. **2.7 — mavzudan chiqdi** (2026-08-23): "real prod hash bilan login" ko'chiriladigan foydalanuvchilar bo'lgandagina mavzu edi. Toza bazada hech kimning hash'i yo'q, va login umuman parolsiz — telefon + Telegram OTP, `password_hash` NULL. |
| **3 · Domen porti** | ✅ | **3.4 ✅** · **3.10 ✅** — jonli o'lchov qayta qurilgan stack'da **10.1s**. ⚠️ **Aniqlashtirish:** "fonema+prosodiya" va'dasi haqiqatga mos emas. Azure'ning xom javobi o'lchandi: unscripted rejimda fonema **ballari** keladi, **nomlari bo'sh** (455 yozuvning 455 tasi), va `PronunciationAssessment` aggregate umuman qaytmaydi, ya'ni `EnableProsodyAssessment` e'tiborsiz qoladi. Kod to'g'ri — bu vendor cheklovi. **Yakuniy o'lchov (6.2):** scripted rejim ham yordam bermaydi va `en-US` bilan A/B qilib isbotlandi — bu **lokal cheklovi**, so'rov shakli emas. Oqibati Faza 6.2 da: F2 boshqa asosga ko'chirildi. |
| **4 · Frontend** | 🟡 | Admin AI-probe UI ✅ · **ErrorBoundary ✅** — ilgari umuman yo'q edi, ya'ni har render xatosi oq ekran berardi; endi ikki daraja (ildiz + marshrut), ichkisi Suspense ichida shuning uchun lazy chunk yuklanmasa ham ushlaydi · chiqish endi refresh tokenni serverga bekor qilishga beradi ✅. **4.11 ✅** — **155 Vitest**, Playwright **uchala rol** uchun (o'quvchi · o'qituvchi · admin) + auth chekka holatlari + mobil viewport, `axe` critical **0**. **4.1 ✅** — bundle **119.7 / 180 KB gz**. **4.2 ⬜** — API tiplari hamon qo'lda, OpenAPI hujjati yo'q. |
| **5 · Noldan o'rnatish** *(ilgari "Cutover")* | 🟡 | **Yo'l almashdi** (2026-08-23): ma'lumot ko'chirilmaydi, server **noldan** quriladi. Yangi asosiy hujjat **`deploy/INSTALL.md`** — toza droplet'dan `https://govorim.uz` gacha 9 qadam. `deploy/CUTOVER.md` **o'chirilmadi**, lekin kritik yo'ldan chiqarildi (yuqorisida ogohlantirish; mavjud bazani EF ga qabul qilish kerak bo'lgan kun uchun saqlanadi). `ef-baseline.sh` **ishlatilmaydi** — sxema EF migratsiyalaridan noldan quriladi. Yangi: `deploy/bootstrap-admin.sh` (toza bazada **birinchi admin** — o'z-o'zidan ro'yxatdan o'tish har doim `student` yaratadi), `deploy/smoke.sh`, `preflight.sh` da **install/live rejimlari**. **Lokal simulyatsiya to'liq yashil**: bo'sh volume → barcha migratsiyalar → birinchi admin → 6 servis healthy → smoke. **Server yarmi ⬜** — egasisiz bajarilmaydi. |
| **6 · Yangi funksiyalar** | 🟡 | **6.4 ✅ · 6.1 ✅ · 6.5 ✅** (ikkalasi flag ortida, sukut bo'yicha o'chiq). **6.8 — aslida ✅ edi**: achievement backend `ProfileService.BuildAchievements` da **21 nishon** bilan allaqachon qurilgan, birlik testlari bor va jonli tekshirildi; `achievements` jadvali **kerak emas** — nishonlar saqlanmaydi, hisoblanadi. **6.7 ✅** — «Mashq ber» tugmasi ishlaydi (`class_insights_enabled`, sukut o'chiq). **`class_insights` jadvali qo'shilmadi** va **xarita ham qo'lda yozilmadi**: bazadagi haqiqiy `corrections.type` lug'ati atigi bir necha hodisa nomidan iborat (`word_order` · `grammar` · `lexical` · `pronunciation_hint` · `style` · `relevance`) va birortasi mavzu emas, `questions` da esa faqat `topic`/`level` bor — ya'ni `word_order → "Еда и вкусы"` degan jadval sof taxmin bo'lardi. Xato turini topshiriq bilan bog'laydigan **yagona o'lchangan** dalil baholangan javoblarning o'zida: sinf shu xatoda aynan **qaysi promptlarda** qoqilgan. Shuning uchun mashq — shu xato eng ko'p sodir bo'lgan (hali chop etilgan) savol, va u **faqat o'sha xatoni qilgan** o'quvchilarga, **tasdiq modalidan keyin** biriktiriladi. Chegara: kamida **3 ta turli o'quvchi** — F6 ning va'dasi "12 o'quvchi qoqildi", bitta o'quvchi sinf naqshi emas; chegaradan past qator ko'rinaveradi, faqat tugmasi o'chiq. **6.2 ✅** — «Tovushlar mashqi» (`phoneme_drill_enabled`, sukut o'chiq). F2 ning dastlabki asosi noto'g'ri edi va **funksiya boshqa asosga ko'chirildi**. Scripted rejim ham ru-RU uchun fonema **nomlarini bermaydi**: bir xil so'rov `en-US` ga yuborilganda 14/14 nomlangan IPA qaytadi, `ru-RU` da 0/11 — Microsoft hujjati ham fonema nomini `en-US`/`zh-CN`, bo'g'in va prosodiyani esa faqat `en-US` uchun va'da qiladi. Ya'ni «sizning ы tovushingiz 62 ball» — bu mahsulot ayta olmaydigan gap. Shuning uchun drill **ballni emas, oqibatni** ko'rsatadi: minimal juftlikda «qaysi egizakni eshitdi?» aynan o'sha fonema hukmi, lekin o'quvchi darhol tuzata oladigan shaklda — «sichqoncha so'radingiz, ayiqcha dedingiz». Bu vendor inventaridan mustaqil. **Ikkita tanish o'tishi bor va ular almashtirilmaydi**: hukm **unscripted** o'tishdan olinadi, chunki scripted rejimda `Lexical` **reference'ni qaytaradi** (6/6 o'lchandi) — ya'ni scripted javobning matni `transcript-must-stay-faithful` buzilishi bo'lardi va u **hech qayerda saqlanmaydi**. Scripted o'tish faqat pozitsion ballar uchun va **faqat o'quvchi xato qilganda** yuguradi (to'g'ri javobda tashxis qilinadigan narsa yo'q, va shu tufayli hisob foydalanish bilan emas, **xato bilan** o'sadi). IPA nomlari **bizning kontentimiz**, Azure pozitsiyalariga indeks bo'yicha bog'lanadi, va moslik **ish vaqtida** tekshiriladi: sonlar mos kelmasa butun massiv tashlanadi — noto'g'ri tovushga yorliq yopishtirgandan ko'ra hech narsa ko'rsatmagan yaxshi. Fonema tafsiloti hamma joyda **bezak**: Azure hech narsa qaytarmasa ham, vendor yiqilsa ham, moslik buzilsa ham hukm **to'liq** chiqadi. Kontent — **6 ta juftlik**, har biri jonli vendorga tekshirilgan; `цех/чех` rad etildi (Azure benuqson `цех` ni «тех» deb eshitdi, ya'ni drill to'g'ri aytgan o'quvchini ayblagan bo'lardi), o'rniga `цвет/свет`. Yon ta'sir: jonli yugurish `AzureSpeechSttBackend` da **har bir so'z balli `null`** ekanini ochdi — Azure `AccuracyScore` ni so'zning o'ziga tekis yozadi, kod esa faqat ichma-ich `PronunciationAssessment` ni o'qirdi (bu faylning NBest darajasida allaqachon hujjatlashtirgan muammosining bir qavat pastdagi ko'rinishi). Tuzatildi. **6.3 ✅** — «Bugungi 5 daqiqa» (`daily_five_enabled`, sukut o'chiq). Yangi kontent turi emas, **yig'uvchi**: isinish `shadowing_phrases` dan, vazifa Catalog'ning `next_task_id` sidan, drill mavjud SRS navbatidan. **Yangi jadval qo'shilmadi** — bugungi progress mavjud qatorlardan hisoblanadi (`submissions` bugungi urinish, javob berilgan `review_items`); isinishning izi umuman qolmaydi va u brauzerda, kun kaliti bilan eslanadi (uni eslash uchun jadval qo'shish — hech kim so'ramaydigan fakt uchun migratsiya, zaxira va tozalash sotib olish bo'lardi). Modul ham qo'shilmadi: `Govori.Practice` ichida, chunki Practice→Catalog yagona ruxsat etilgan chegara va bu `GetStudentModulesAsync` ni (ketma-ket qulf + freemium pozitsiyasi) qayta yozmaslikka imkon berdi. **Barqarorlik mahsulot talabi**: sessiya kun davomida o'zgarmaydi — iboralar (o'quvchi, mahalliy kun) urug'i bilan deterministik tanlanadi, vazifa esa javob berilgandan keyin o'sha kungi birinchi urinishga qadaladi (aks holda topshiriq tugagan zahoti karta boshqa mashqqa almashardi). Kun — **o'quvchining kuni** (`tz_offset`), UTC emas. SRS bo'sh bo'lsa yoki `review_drill_enabled` o'chiq bo'lsa drill bosqichi "0 ta element" deb emas, **umuman** ko'rinmaydi. Yangi xarajat yo'li ham, ikkinchi XP yo'li ham yo'q: sessiya mavjud endpointlarga yo'naltiradi va o'zi mukofot bermaydi. **6.6 ⬜** (tashqi bog'liqlik: Payme/Click). |
| **7 · Tozalash** | 🟡 | 7.1–7.8 ✅. 7.9 — **C3/C6 mahsulot qaroriga** bog'liq. |

### Kontrast — o'lchangan, ikki bosqichda

`serious/color-contrast` **680 → 0**, bitta shart bilan.

1. A11y ishi 680 dan **16** ga tushirdi (22 ekran × 2 mavzu × 2 viewport = 88 skan). Asosiy qaror:
   `--faint` qayta bo'yalmadi, u **matn tokeni bo'lishdan to'xtadi** — 73 iste'molchisidan 59 tasi
   `<Text color="faint">` edi, ya'ni so'z. So'zlar `--muted` ga ko'chdi, `--faint` dekoratsiya uchun
   qoldi (aria-hidden glif, qulf/chevron, o'chirilgan OTP — WCAG 1.4.3 nofaol boshqaruvlarni istisno qiladi).
2. **To'la navbat bilan** qayta skanerlash yana bitta **mustaqil sababni** ochdi: Analitika "hero"
   kartasi light mavzudagi **yagona qorong'i sirt**, va uning lokal kulrangi hech qachon o'z foni
   bo'yicha o'lchanmagan edi (4.17:1). Tuzatildi (`9ab3c37`). Bu faqat to'la ma'lumotda ko'rinadi —
   bir qatorli navbat yigirma to'rt qatorli navbat ko'rsatadigan narsani yashiradi.

**Shundan keyin qolgan har bir buzilish bitta sababga tegishli:** brend to'ldirishi ustidagi oq matn
(`#fffdfb` on `#ed622a` = **3.24:1**). Node soni ma'lumot hajmiga qarab o'sadi, sabab esa bitta.
**Isbotlandi:** `--primary` ni `oklch(0.580 0.181 40)` (#cf4500) ga tushirish 4 ta o'qituvchi ekranida
**29 → 0** beradi. Dark mavzu allaqachon 0 (uning `--primary-on` i qora siyoh, 7.12:1).
Bu bitta qatorlik **brend qarori** va u egasiniki — shuning uchun qilinmadi.
Brend **matn** uchun `--primary-ink` (#b93f02, 4.65:1) allaqachon qo'shilgan; to'ldirishlar,
logotip va grafika **tegilmagan**.

### Prodga tayyorlik — 2026-08-23 kechasida qo'shilgan qattiqlashtirish

- **Prod noto'g'ri sirlar bilan ishga tushmaydi.** `TELEGRAM_BOT_TOKEN` yo'q bo'lsa prod dev OTP
  jo'natuvchisini olardi, ya'ni qat'iy kod `000000` bilan **har kim har qanday raqam sifatida kirardi**
  va stack sog'lom ko'rinardi. `.env.example` SECRET_KEY bilan esa repo'ni o'qigan har kim admin
  tokeni yasardi. Endi barcha muammolar bir vaqtda ro'yxatlanadi va exit code 1.
- **CORS**: yo'qligi = o'chiq (bir xil origin — to'g'ri prod shakli); wildcard **rad etiladi**,
  jimgina pasaytirilmaydi.
- **Refresh token bekor qilinadi** (Redis deny-list, kalit = token hash'i, fail-closed, per-token).
  Ilgari `/logout` serverda **hech narsa** qilmasdi. Yo'l-yo'lakay: refresh endi foydalanuvchi mavjud
  va faol ekanini tekshiradi — bloklangan hisob 7 kun yashamaydi.
- **Vendor timeout'lari**: STT'da umuman yo'q edi (default 100s × 2 backend = osilgan worker).
  Endi STT 45s, grader 60s. Nozik joy test bilan qotirildi: `HttpClient.Timeout`
  `TaskCanceledException` tashlaydi, ya'ni zanjirning "bekor qilish → fallback qilma" qoidasi uni
  yutib yuborishi mumkin edi.
- **Pul sarflovchi yo'llarda shift**: `submit_audio` 60/soat · `placement_submit` 30/soat ·
  `admin_probe` 10/soat, hammasi **user id bo'yicha** (bir sinf bitta IP ortida bir-birini bloklamasin).
- **`/health/ready`** stub emas — Postgres + Redis + S3 ni tekshiradi; liveness ataylab tekshirmaydi.
- **Log floodi to'xtatildi**: bitta `GET /api/profile/stats` prod konfiguratsiyasida **5 396 bayt**
  log yozardi (EF har SQL ni to'liq matni bilan). Prod'da endi Warning; dev'da Information (o'sha
  yerda maqsad shu). Ustiga compose'da log rotatsiyasi 10m × 3 **har servisda**.
- **Muhit endi aniq aytiladi**: ikkala image `…_ENVIRONMENT=Production` ni pishirib qo'yadi (image
  uchun to'g'ri default), dev compose esa uni ustidan yozmasdi — ya'ni dev Production sifatida
  ishlardi va `appsettings.Development.json` hech qachon yuklanmasdi.
- **Cutover minalari**: `ef-baseline.sh` va `rollback-db.sh` `-f` siz `docker compose` chaqirardi,
  ya'ni droplet'da ikkala compose fayl yonma-yon turganda **dev faylini** tanlardi; ular yana
  `PGUSER`/`PGDATABASE` ni **dev nomiga** qaytarardi. Ikkalasi ham rollback skriptlari — ya'ni aynan
  hamma narsa noto'g'ri ketgan paytda ishga tushadi. Endi tanlov bo'lsa **rad etadi**, va nima
  o'chirilishini tasdiqdan **oldin** chop etadi.
- **Sertifikat yangilanishi**: `setup-domain.sh` cron qatorini faqat **chop etardi**, va o'sha qator
  yarim ishlardi (certbot `certbot/conf/live/` ga yozadi, nginx `nginx/certs/` dan o'qiydi) — ya'ni
  HTTPS ~60 kun ishlab, keyin **birdan** o'lardi. O'rnatiladigan va ishlaydigan holatga keltirildi.

**Rejadan tashqari, rejada yo'q edi va bajarildi:** o'qituvchi paneli to'liq (7 faza),
admin paneli, telefon+Telegram OTP auth, guruhga qo'shilish so'rovlari, media yuklash,
`preferred_language` akkaunt sozlamasi, dev fixture yangilash skripti.

**2026-08-17 da topilgan va tuzatilgan ikkita jimgina xato** — ikkalasi ham faqat jonli
ilovaga haqiqiy ruscha nutq yuborilgani uchun ko'rindi, kodni o'qib emas:

1. `docker-compose.yml` AI kalitlarini konteynerlarga **umuman uzatmagan**. Provayderlar stub
   bo'lgan davrda ahamiyati yo'q edi; zanjir haqiqiy bo'lgan zahoti — to'g'ri `.env` bilan ham
   ilova hech narsani baholay olmaydi va bu **kod bug'iga o'xshab ko'rinadi**.
2. Azure **unscripted** rejimda ballarni boshqa shaklda qaytaradi: `PronScore` o'rniga bitta
   `AccuracyScore`, va u `NBest[0].PronunciationAssessment` ichida emas, **`NBest[0]` ning
   o'zida** tekis yotadi. Backend faqat ichma-ich shaklni o'qigan, shuning uchun har bir real
   javobda `transcripts.pronunciation` NULL bo'lgan va **C5 jimgina 5 mezon o'rniga 4 mezonga
   tushgan**. Hech qanday xato chiqmagan. Smoke testi ham o'tgan — sukunatga baho baribir
   kelmaydi. Tuzatilgandan keyin: matn 95, talaffuz 73, band **90.6** — ya'ni aynan
   `(95×4 + 73)/5`, C5 formulasi nihoyat beshinchi mezonini oldi.

**Admin panel AI sozlamalari — 2026-08-17 kengaytmasi.** Egasining talabi: *"ai turi,
modeli, va api keyni joylashtirish boshqarish mumkin bo'lsin, eng oxirgi holat bilan
ishlasin"*. Uchta alohida bo'shliq bor edi:

1. **Ikkita grader va bitta STT backend panelda umuman yo'q edi.** OpenAI kaliti va
   modeli, Azure OpenAI endpoint/deployment/api-version/kaliti, Whisper modeli — hammasi
   `Spec` da, hammasi backend tomonidan o'qiladi, va hech biri ekranda yo'q. Yagona yo'l —
   env o'zgaruvchisi va qayta deploy. `openai_grader_model` esa kontraktda **butunlay**
   yo'q edi.
2. **Model ro'yxatlari qattiq edi.** Ertaga chiqadigan modelni tanlab bo'lmasdi. Endi
   ro'yxatlar — **taklif**, cheklov emas: maydonga istalgan model id yoziladi.
3. 🔴 **Saqlangan qiymat 30 soniyagacha kuchga kirmasdi.** `AppSettingsCache` — jarayonga
   xos snapshot, va u faqat **yozgan** jarayonda tozalanardi. Panel API orqali yozadi,
   baholash esa **Worker** da ishlaydi. Ya'ni kalit qo'yilib saqlangandan keyin ham
   pipeline yarim daqiqagacha eski konfiguratsiyada ishlardi — va **o'chirilgan** kalit
   ham o'sha vaqt davomida ishlashda davom etardi. Hech qanday xato chiqmasdi: admin
   saqlaydi, tekshirish uchun topshiriq yuboradi, eski natijani ko'radi va panelni buzuq
   deb o'ylaydi.

Endi invalidatsiya Redis pub/sub orqali barcha jarayonlarga tarqaladi. **Faqat signal**
uzatiladi — snapshot jarayonda qoladi, chunki u har bir topshiriqda o'qiladi va har
baholash uchun tarmoq so'rovi yomon savdo bo'lardi. Redis yo'qligi xato emas: eski
TTL xatti-harakatiga tushadi, u ham to'g'ri edi — shunchaki sekinroq.

Isbot: zanjir panel API orqali `openai` ga o'zgartirildi va darhol topshiriq yuborildi →
Worker `gpt-4o-mini-2024-07-18` bilan baholadi. Zanjir tozalandi, yana darhol →
`gemini-3.1-flash-lite`. Ilgari ikkalasi ham Gemini bo'lardi. Regressiya testi ham bor:
tuzatish olib tashlansa — qizil.

Bundan tashqari `POST /api/admin/settings/ai/test` — har bir backendga bitta haqiqiy
minimal so'rov. Ilgari noto'g'ri kalit **jimgina va kech** yiqilardi: zanjir uni shunchaki
o'tkazib yuborardi, birinchi alomat esa o'quvchining topshirig'i boshqa vendor tomonidan
baholanishi edi.

**Keyingi uchta ish, tartib bilan:** (1) **noldan o'rnatish** — `deploy/INSTALL.md`, egasi bilan
(Faza 0 endi bloklovchi emas: 2026-08-23 qarori bo'yicha prod ma'lumoti ko'chirilmaydi);
(2) golden set uchun 40 ta real klip; (3) o'rnatishdan keyin — kundalik zaxira va monitoring.

---

## Faza 0 · Ma'lumot xavfsizligi — 🟡 **bloklovchi EMAS** *(2026-08-23 da o'zgardi)*

> **Bu bo'lim endi kritik yo'lda emas — egasining qarori bilan.**
>
> **Qaror (2026-08-23):** prod ma'lumoti **ko'chirilmaydi**, server **noldan** quriladi.
> Ya'ni asrab qolinishi kerak bo'lgan 50 foydalanuvchi yo'q, va "zaxirasiz prodga tegib
> bo'lmaydi" bloklovchisi **o'z-o'zidan yo'qoldi** — chunki tegiladigan prod ma'lumoti yo'q.
>
> **Nima o'zgarmadi:** zaxira baribir kerak — faqat **oldin** emas, **keyin**. Server ishga
> tushgan kuni ma'lumot yo'q; ertasiga bor. Shuning uchun `deploy/INSTALL.md` 9.1-qadami
> kundalik zaxira cron'ini **o'sha kechaning o'zida** o'rnatishni talab qiladi, va
> `preflight.sh` `live` rejimga o'tgach zaxira yo'qligini yana FAIL deb ko'rsata boshlaydi.
>
> Quyidagi 0.1–0.7 jadvali **tarixiy** — u mavjud prod ma'lumotini qutqarish uchun yozilgan.
> Skriptlar (`backup-prod.sh`, `restore.sh`, `verify-backup.sh`, `prod-backup-cron.sh`,
> `rollback-db.sh`) **saqlanadi va sinalgan**; ularning o'rni endi `deploy/README.md`
> §"After the install".

| # | Ish | DoD |
|---|---|---|
| **0.1** | `deploy/backup-prod.sh` — `pg_dump -Fc` + **MinIO volume** + `.env` → shu mashinaga | Fayllar bor, hajmi > 0 |
| **0.2** | `deploy/verify-backup.sh` — bo'sh Postgres'ga tiklash, **real foydalanuvchilarni sanash**, hash formatini tekshirish | `PASS` chiqadi |
| **0.3** | DigitalOcean **snapshot** (bir tugma, hamma narsani qamraydi) | Panelda ko'rinadi |
| **0.4** | Nusxani **droplet'dan tashqariga** (bulut/tashqi disk) | Ikkinchi joyda bor |
| **0.5** | 🔴 **Prod backup bug'ini tuzatish**: `set -o pipefail` + hajm tekshiruvi + **faqat tasdiqlangandan keyin o'chirish** + offsite | Sun'iy buzilgan dump bilan tekshirilgan |
| 0.6 | `docker volume ls` → aniq nomlarni yozib olish → yangi compose'da `name:` pinlash | Hujjatda |
| 0.7 | TLS muddatini tekshirish (`setup-domain.sh:53` cron'ni **o'rnatmaydi**, faqat chop etadi) | Sana ma'lum, cron o'rnatilgan |

**Nega birinchi:** foydalanuvchining birinchi talabi — *"baza malumotlari o'chib ketmasligi kerak"*.
Zaxirasiz bu talabni bajarib bo'lmaydi — faqat umid qilish mumkin. Bu 1 soatlik ish.

---

## Faza 1 · Xavfsizlik to'ri — *~1 hafta*

> `05-ROADMAP` ning eng to'g'ri qarori: **AI himoyasi birinchi.** U kuchda qoladi va
> **kengaytiriladi** — endi nafaqat grader, balki **butun port** himoyaga muhtoj.

| # | Ish | DoD |
|---|---|---|
| **1.1** | **Characterization fixture'lari** (`07 §7.6`, C1–C10) — JSON etalonlar | ✅ 10 ta fixture fayl, repoga commit qilingan |
| 1.2 | Fixture'lar **muzlatilgan etalon** maqomiga o'tadi — egasi `Govori.Characterization` | ✅ C# testlari yashil |
| **1.3** | **bcrypt korpusi**: prod'dan real hashlar (anonimlashtirilgan) → fixture | ✅ Hash + parol juftlari |
| 1.4 | **Grader golden set**: 40 klip + `expected.yaml` (docs/02 §2.7) | Fayl bor, rozilik hujjatlashtirilgan |
| 1.5 | Grader golden set testi — real API, sekin marshrut | Lokalda ishlaydi |
| 1.6 | CI: golden < 90% → PR bloklanadi | Sun'iy regressiya bilan tekshirilgan |

**Nega:** auditning xulosasi — *"the port cannot be validated against this suite"* (13 test,
5 funksiya). Characterization testlarisiz "to'g'ri ko'chirdim" degan da'voning **asosi yo'q**.

---

## Faza 2 · .NET poydevor — *~1.5 hafta*

| # | Ish | DoD |
|---|---|---|
| 2.1 | Solution skeleti (`07 §7.2`), project reference'lar | `dotnet build` yashil |
| 2.2 | `Govori.ArchTests` — chegaralar (NetArchTest) | Qasddan buzilgan reference build'ni yiqitadi |
| **2.3** | **EF Core scaffold** — tiklangan prod dump'dan (`database-first`) | Model **aynan** prod sxemasiga mos |
| 2.4 | Enum/JSONB/TIMESTAMPTZ/snake_case mapping (`07 §7.4` tuzoqlar) | Integration test: har jadvalga read+write |
| 2.5 | Testcontainers — haqiqiy Postgres | `dotnet test` konteynerni ko'taradi |
| **2.6** | **Auth port**: BCrypt.Net-Next + JWT HS256 | 🔴 **C1/C2 characterization testlari yashil** |
| ~~2.7~~ | ~~**Real prod hash bilan login testi**~~ — **mavzudan chiqdi (2026-08-23)**: ko'chiriladigan hash yo'q, server noldan quriladi. Login parolsiz (telefon + Telegram OTP, `password_hash` NULL); parolsiz admin kirishi lokal simulyatsiyada uchidan-uchiga sinaldi | — |
| 2.8 | Serilog + OpenTelemetry + `/health`, `/health/ready` | `/metrics` chiqadi |
| 2.9 | Docker image (Azure Speech native deps: `libasound2`, `libssl3`) | Konteynerda ishlaydi |

---

## Faza 3 · Domen porti (parity) — *~4 hafta*

> Tartib: **eng ko'p ishlatiladigan → eng kam**. Har domen tugagach — characterization + integration yashil.

| # | Domen | Endpoint | Nozik joylar |
|---|---|---|---|
| 3.1 | **Identity** | 10 | Google OAuth (tokeninfo), OTP (Redis, fail-**closed**), rate limit (fail-**open**) |
| 3.2 | **Catalog** | 32 | `blocks/student` — **ikki qatlamli qulf** (ketma-ketlik + freemium). Eng murakkab query |
| 3.3 | **Practice** | 10 | Freemium gate (C4). 402 faqat submit'da |
| **3.4** | **Assessment** | — | 🔴 **Pipeline**. Resume-from-transcript, 5 breaker, `_with_pron`, orfoepiya jarimasi (C5) |
| 3.5 | **Classroom** | 22 | Guruh, assignment, gradebook. ⚠️ S1 roster bug'i tuzatiladi |
| 3.6 | **Engagement** | 8 | Leaderboard (SQL rank), XP, streak, SRS |
| 3.7 | **Administration** | 16 | `app_settings` 30s cache + `None`/`""`/qiymat **tri-state** semantikasi |
| 3.8 | **Guest** | 3 | Demo — auth'siz, rate limit muhim |
| 3.9 | Hangfire: 4 ta task + beat (stuck, orphan, test cleanup) | | `task_acks_late` semantikasi |
| 3.10 | **SignalR** — `/attempts/{id}/events` | | TTFS p95 < 20s (o'lchanadi) |

**Chiqish sharti:** 110 endpoint parity + barcha characterization testlar yashil.

---

## Faza 4 · Frontend — *~4 hafta*

| # | Ish | DoD |
|---|---|---|
| 4.1 | FSD skeleti + `boundaries` lint + lazy (3 bundle) | Student initial JS ≤ 180KB gz (CI budget) |
| 4.2 | **OpenAPI → TS klient** generatsiyasi | Qo'lda yozilgan API tipi **yo'q** |
| 4.3 | `shared/styles/tokens.css` — Ovoz DS (mockupdan **aynan**) | Dark mode toggle ishlaydi |
| 4.4 | Onest + JetBrains Mono — **self-hosted** (mockup CDN ishlatadi; prodda yaramaydi) | LCP regress yo'q |
| 4.5 | `shared/ui/` + Radix + Storybook | 100% komponent |
| 4.6 | **`Mascot` (5 mood) + waveform-og'iz + `Recorder`** | Yadro o'zaro ta'siri |
| 4.7 | `i18next` + `locales/{uz,ru,en}` — 2085 kalit ko'chiriladi + ICU plural (ru) | `«2 балла»` to'g'ri |
| 4.8 | Ekranlar: Home · Practice · **AI Suhbat** · Progress · Profile (**5 nav**) | Mockupga mos |
| 4.9 | O'qituvchi (10 ekran, `compact` density) | |
| 4.10 | Admin (9 ekran) | |
| 4.11 | Vitest + Playwright golden path + `axe` | 0 critical |

---

## Faza 5 · Noldan o'rnatish — *~1 kun*

> **2026-08-23 da qayta yozildi.** Ilgari bu "Cutover" edi: jonli Python stack'ini
> ma'lumotni asrab qolgan holda .NET ga almashtirish. Egasining qarori bilan **prod
> ma'lumoti ko'chirilmaydi** — server noldan quriladi. Ya'ni nusxa ustida mashq,
> `ef-baseline.sh`, eski stack'ni ikki hafta saqlash, "dump'dan tiklash" rollback'i —
> **hech biri bu yo'lda emas**. Eski reja `deploy/CUTOVER.md` da saqlanadi.
>
> Asosiy hujjat: **`deploy/INSTALL.md`**.

| # | Ish | DoD |
|---|---|---|
| **5.1** | `deploy/INSTALL.md` — toza droplet'dan `https://govorim.uz` gacha | ✅ Har qadam: buyruq → kutilayotgan natija → nima noto'g'ri bo'lishi mumkin |
| **5.2** | **Lokal toza o'rnatish simulyatsiyasi** — bo'sh volume → migratsiyalar → birinchi admin → stack → smoke | ✅ Alohida stack'da uchidan-uchiga yashil |
| **5.3** | `deploy/bootstrap-admin.sh` — **birinchi admin** (toza bazada o'z-o'zidan ro'yxatdan o'tish har doim `student` yaratadi, ya'ni admin panelga yo'l yo'q) | ✅ Parolsiz (telefon+OTP), idempotent, bajarishdan oldin rejasini chop etadi va `--yes` talab qiladi |
| **5.4** | `preflight.sh` → **install/live rejimlari**; `deploy/smoke.sh` | ✅ Bo'sh volume `install` da PASS, `live` da FAIL |
| **5.5** | 🎯 **O'rnatish** (egasi bilan, droplet'da) | ⬜ Smoke yashil + Telegram kodi keladi + bitta javob baholanadi |
| **5.6** | Kundalik zaxira cron'i — **o'sha kechaning o'zida** | ⬜ `INSTALL.md` 9.1 |
| 5.7 | 48 soat kuzatuv | ⬜ Xato darajasi normal |

---

## Faza 6 · Yangi funksiyalar — *~5 hafta*

> Foydalanuvchi tanlovi: **yangi funksiyalar rewrite bilan birga.**
> Arxitektor tuzatishi: **feature flag ortida quriladi**, cutover ularni **kutmaydi**.
> Sabab: cutover funksiyalarga bog'lansa — u hech qachon sodir bo'lmaydi. Deploy ≠ release.

| # | Feature | Yangi jadval | Faza |
|---|---|---|---|
| 6.1 | **F5 · Xato-replay drill (SRS UI)** | — (`ReviewItem` **bor**) | 3 kun |
| 6.2 | **F2 · Fonema drill + minimal juftliklar** ✅ | `minimal_pairs`, `drills` | 1 hafta |
| 6.3 | **F3 · Kunlik 5 daqiqa** ✅ | — (yangi jadval **kerak emas**) | 4 kun |
| 6.4 | **F4 · Placement test** | — | 4 kun |
| **6.5** | **F1 · Roleplay / AI Suhbat** 🎯 | `scenarios`, `roleplay_turns` | 2 hafta |
| 6.6 | **Payments** (admin dizaynida bor) | `plans`, `entitlements`, `subscriptions` | 2 hafta |
| 6.7 | **F6 · Sinf insaytlari** ✅ | — (`class_insights` **kerak emas**) | 1 hafta |
| 6.8 | Achievement backend | `achievements` | 3 kun |

---

## Faza 7 · Tozalash

> Foydalanuvchi talabi: *"eski holatidagi keraksiz fayllarni o'chirib tashlab ket"*.
> **Qoida: faqat cutover muvaffaqiyatli bo'lgach + 2 hafta barqarorlikdan keyin.**

| # | Nima | Qachon |
|---|---|---|
| 7.1 | Eski backend'ning binary scheduler holati (git'da kuzatilgan edi) | ✅ Bajarildi |
| 7.2 | `.env.prod` — **o'lik fayl**, hech qayerdan reference qilinmagan, chalg'ituvchi | ✅ O'chirilgan |
| 7.3 | `Project design/` — eski prototip (2823 q. JSX) | ✅ O'chirilgan |
| 7.4 | `DEPLOY.md` — **noto'g'ri serverni** tasvirlaydi (Azure+DuckDNS, prod esa DO+govorim.uz) | ✅ O'chirilgan; o'rnini `deploy/CUTOVER.md` + `09-DOCKER.md` egalladi |
| 7.5 | `ARCHITECTURE.md`, `PROJECT_OVERVIEW.md`, `UPGRADE_PLAN.md` → `docs/legacy/` | ✅ `aea6de8` da o'chirilgan (`docs/legacy/` yaratilmadi — tarixi git'da) |
| 7.6 | `frontend/src/components/{ui,govori}.tsx`, violet `@theme` | ✅ Bajarildi — FSD skeleti bilan |
| 7.7 | **Eski backend'ni repodan olib tashlash** (tarixi git'da qoladi) | ✅ Bajarildi — `backend-dotnet/` yagona backend |
| 7.8 | `RussianDesign/` → `docs/design/` (tartibga solinadi) | ✅ Bajarildi — `mockups/` + `screenshots/`, barcha havolalar yangilandi |
| 7.9 | `TEACHER-PANEL-PLAN.md` + `dev-role.sh` | ⬜ **C3/C6 qaroridan keyin** — fayl shu qaror uchun turibdi |

> ⚠️ **Xotira:** *prod build not from repo* — jonli serverda repo git tarixida yo'q frontend
> ishlayotgani qayd etilgan. **O'chirishdan oldin prodda nima ishlayotgani tekshiriladi.**

---

## Vaqt va ketma-ketlik

```
Faza 0 ─ MA'LUMOT XAVFSIZLIGI (1 soat)        🟡 bloklovchi EMAS (2026-08-23)
   ↓
Faza 1 ─ Characterization + golden set (1 hafta)   ← bularsiz port ko'r-ko'rona
   ↓
Faza 2 ─ .NET poydevor + AUTH (1.5 hafta)     ← auth isbotlanadi
   ↓
Faza 3 ─ Domen porti (4 hafta) ──────┐
   ↓                                  │ (parallel bo'lishi mumkin)
Faza 4 ─ Frontend (4 hafta) ◄─────────┘
   ↓
Faza 5 ─ NOLDAN O'RNATISH (1 kun) — deploy/INSTALL.md
   ↓
Faza 6 ─ Yangi funksiyalar (5 hafta, flag ortida)
   ↓
Faza 7 ─ Tozalash
```

**Jami: ~14–16 hafta** (Faza 3 ∥ 4 bo'lsa ~12).
Bu **1 dev + Claude Code** uchun. Majburiyat emas — tartib uchun.

---

## Xavflar

| Xavf | Ehtimol | Ta'sir | Yumshatish |
|---|:---:|:---:|---|
| ~~🔴 **Prod ma'lumoti yo'qoladi (backup yo'q)**~~ | — | — | **Mavzudan chiqdi (2026-08-23)**: prod ma'lumoti ko'chirilmaydi. O'rniga yangi xavf: **yangi** ma'lumot birinchi kecha zaxirasiz qoladi → `INSTALL.md` 9.1, o'rnatish kechasining o'zida |
| 🔴 Backup skripti jimgina yiqilib, yaxshilarini o'chiradi | **Yuqori** | **Halokatli** | Faza 0.5 |
| Volume orphan (papka nomi o'zgarsa) | O'rta | Yuqori | `name:` pin / `external: true` |
| Port xatti-harakati jimgina siljiydi | **Yuqori** | Yuqori | **Characterization testlar (Faza 1)** |
| ~~50 foydalanuvchi login qila olmaydi~~ | — | — | **Mavzudan chiqdi**: ko'chiriladigan foydalanuvchi yo'q. O'rniga yangi xavf: **birinchi admin yaratilmasa `/admin` ga hech kim kira olmaydi** (ro'yxatdan o'tish har doim `student` yaratadi) → `deploy/bootstrap-admin.sh`; `preflight.sh` va `smoke.sh` adminsiz holatni FAIL qiladi |
| Cutover funksiyalarni kutib cho'ziladi | **Yuqori** | Yuqori | **Feature flag** — deploy ≠ release |
| AI grader regressiyasi | Yuqori | Yuqori | Golden set (Faza 1) |
| Gemini .NET SDK yo'q | Aniq | O'rta | REST + `IGraderProvider` |
| TLS muddati tugaydi → sayt o'chadi | O'rta | Yuqori | Faza 0.7 |
| Roleplay AI xarajati portlaydi | O'rta | Yuqori | Turn limiti, kunlik byudjet, arzon model |

---

## Har faza uchun DoD

- [ ] `docker compose up --build` — barcha servis `healthy`
- [ ] Migratsiyalar `up` **va** `down` ishlaydi
- [ ] **Characterization testlar yashil** (port hech narsani buzmadi)
- [ ] `dotnet test` + `tsc` + `vite build` yashil; bundle budget buzilmadi
- [ ] Playwright golden path yashil · `axe` 0 critical
- [ ] Mobil (375px) + desktop (1440px) + **dark mode** tekshirildi
- [ ] `docs/` yangilandi (kod hujjatga mos)
- [ ] **Prod ma'lumoti hamon butun** (row count tekshiruvi)
</content>
