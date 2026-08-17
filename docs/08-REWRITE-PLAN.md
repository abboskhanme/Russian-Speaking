# 08 · Rewrite rejasi — Python → .NET

> **Bu hujjat `05-ROADMAP.md` ni almashtiradi.** `05` Python'ni joyida yaxshilash uchun edi;
> endi backend qayta yoziladi. `05` dagi **tartib mantig'i saqlanadi** (grader xavfsizlik to'ri
> birinchi), lekin fazalar boshqa.

**Kontekst:**
- Prod **jonli**: `govorim.uz` → `134.209.240.56`, ~50 real foydalanuvchi. Ishlab turibdi.
- Ko'chirilayotgan: 9 398 qator Python (110 endpoint, 4 Celery task) + 19 405 qator frontend.
- **Prod hech qachon to'xtamaydi** — yangi stack yonida quriladi, cutover bitta qisqa oynada.

---

## Holat — 2026-08-17

> Quyidagi jadvallar **reja** (o'zgarmaydi); bu bo'lim esa **haqiqatda nima bajarilgani**.
> Ziddiyat bo'lsa — shu bo'lim ustun. Belgilar: ✅ tugagan · 🟡 qisman · ⬜ boshlanmagan.
> Qolgan ishning **ketma-ketligi** uchun → `10-YAKUNIY-ISH-REJASI.md`.

| Faza | Holat | Nimasi qolgan |
|---|:--:|---|
| **0 · Ma'lumot xavfsizligi** | ⬜ | **0.5 ning kod qismi ✅** — `deploy/prod-backup-cron.sh` prod cron'ining o'rnini bosadi (`pipefail`, hajm + `pg_restore --list` tekshiruvi, real foydalanuvchi sanog'i, atomik `mv`, offsite, va **shartli** retention), `deploy/test-backup-cron.sh` buni 11 ta assertion bilan isbotlaydi. Qolgani — **droplet'ga kirishni talab qiladi**: 0.1–0.4, 0.6, 0.7 va skriptni prodga o'rnatish. 🔴 Hamon bloklovchi: real 50 foydalanuvchining zaxirasi yo'q. |
| **1 · Xavfsizlik to'ri** | 🟡 | 1.1–1.3 ✅. **1.4 ✅** — `tests/golden/grader/` (18 keys + 8 tartib tekshiruvi). **1.5 ✅** — runner real zanjirga uriladi, ikki yugurishda 98% va 99%. **1.6 ✅** — `.github/workflows/ci.yml` da alohida `golden` job; kalitsiz jimgina o'tmaydi, yiqiladi. ⬜ **STT yarmi**: 40 ta real klip — sun'iy audio bilan to'ldirilmadi, sababi `tests/golden/grader/README.md` da. |
| **2 · .NET poydevor** | 🟡 | **2.5 ✅** — har yugurishda alohida `govori_it_*` bazasi (EF migratsiyalaridan quriladi, `FORCE` bilan o'chiriladi); Testcontainers **emas**, sababi kodda yozilgan (net9 SDK konteyneri → tasodifiy **host** porti, `localhost` unga yetmaydi). **2.7 ⬜** — prod dump'iga, ya'ni **Faza 0 ga** bog'liq. |
| **3 · Domen porti** | ✅ | **3.4 ✅ — AI zanjiri ulandi**: Anthropic (rasmiy SDK) · Gemini · OpenAI/Azure OpenAI graderlar, Azure Speech (unscripted, `Lexical`) · Whisper STT, `app_settings` dan tartib + kalitlar, 19 birlik test + jonli smoke. **3.10 ✅** — TTFS o'lchanadi (`Submission.CreatedAt` dan), jonli o'lchov **~10.5s** (maqsad p95 < 20s). |
| **4 · Frontend** | 🟡 | Admin **Sozlamalar** ekrani zanjir tahrirchisi, Claude bo'limi va **Funksiyalar** bo'limini oldi ✅. **4.11 ✅** — 120 Vitest + Playwright golden path + `axe` (0 critical). **4.1 ✅** — bundle budjeti CI'da: 114.3 / 180 KB gz. **4.2 ⬜** — API tiplari hamon qo'lda, OpenAPI hujjati umuman yo'q. |
| **5 · Cutover** | 🟡 | O'zgarishsiz. **Server yarmi ⬜** — jonli prodga tegadi, egasisiz bajarilmaydi. |
| **6 · Yangi funksiyalar** | 🟡 | **6.4 ✅** · **6.1 ✅** Xato-replay drill (`/review`, SRS zinapoyasi endi haqiqatan ko'tariladi) · **6.5 ✅** AI Suhbat (`/chat`) — haqiqiy STT + grader zanjiri, ssenariy beat'lari orasida relevantlik bo'yicha yo'naltirish. Ikkalasi ham **flag ortida, sukut bo'yicha o'chiq**, admin panelda **Funksiyalar** bo'limidan boshqariladi. 6.2, 6.3, 6.6, 6.7, 6.8 — ⬜. |
| **7 · Tozalash** | 🟡 | 7.1–7.8 ✅. 7.9 — **C3/C6 mahsulot qaroriga** bog'liq, texnik ish emas. |

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

**Keyingi uchta ish, tartib bilan:** (1) Faza 0 — prod zaxirasi **egasi bilan**, chunki qolgan
hamma narsa unga bog'liq; (2) golden set uchun 40 ta real klip; (3) cutover.

---

## Faza 0 · Ma'lumot xavfsizligi — 🔴 **BLOKLOVCHI**

> **Hech narsa yozilmasdan oldin.** Auditda topilgan: **prod backup mavjud emas.**
> `backups/` — lokal demo ma'lumot (34 foydalanuvchi, 30 tasi `@demo.uz`). Real 50 foydalanuvchi
> dunyoda **bitta joyda**: `134.209.240.56` dagi `postgres-data` volume ichida.

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
| 2.7 | **Real prod hash bilan login testi** | 50 foydalanuvchi kira oladi (isbotlangan) |
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

## Faza 5 · Cutover — *~1 hafta*

| # | Ish | DoD |
|---|---|---|
| 5.1 | Yangi stack prod DB **nusxasiga** ulanadi, read-only smoke | Bir hafta barqaror |
| **5.2** | **Cutover mashqi** — nusxa ustida, to'liq, **kamida 2 marta** | Rollback ham mashq qilingan |
| 5.3 | Additive migratsiya (**faqat `CREATE TABLE`**) | `ALTER`/`DROP` yo'q — ko'rib chiqilgan |
| 5.4 | Rollback skripti + sinovi | Eski stack qayta ko'tariladi |
| **5.5** | 🎯 **Cutover** (~30 daq, kam faollik) — `07 §7.10` | Smoke yashil |
| 5.6 | Eski stack 2 hafta **o'chirilgan holda turadi** | O'chirilmaydi |
| 5.7 | 48 soat kuzatuv | Xato darajasi normal |

---

## Faza 6 · Yangi funksiyalar — *~5 hafta*

> Foydalanuvchi tanlovi: **yangi funksiyalar rewrite bilan birga.**
> Arxitektor tuzatishi: **feature flag ortida quriladi**, cutover ularni **kutmaydi**.
> Sabab: cutover funksiyalarga bog'lansa — u hech qachon sodir bo'lmaydi. Deploy ≠ release.

| # | Feature | Yangi jadval | Faza |
|---|---|---|---|
| 6.1 | **F5 · Xato-replay drill (SRS UI)** | — (`ReviewItem` **bor**) | 3 kun |
| 6.2 | **F2 · Fonema drill + minimal juftliklar** | `minimal_pairs`, `drills` | 1 hafta |
| 6.3 | **F3 · Kunlik 5 daqiqa** | — | 4 kun |
| 6.4 | **F4 · Placement test** | — | 4 kun |
| **6.5** | **F1 · Roleplay / AI Suhbat** 🎯 | `scenarios`, `roleplay_turns` | 2 hafta |
| 6.6 | **Payments** (admin dizaynida bor) | `plans`, `entitlements`, `subscriptions` | 2 hafta |
| 6.7 | **F6 · Sinf insaytlari** | `class_insights` | 1 hafta |
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
Faza 0 ─ MA'LUMOT XAVFSIZLIGI (1 soat)        🔴 BLOKLOVCHI
   ↓
Faza 1 ─ Characterization + golden set (1 hafta)   ← bularsiz port ko'r-ko'rona
   ↓
Faza 2 ─ .NET poydevor + AUTH (1.5 hafta)     ← auth isbotlanadi
   ↓
Faza 3 ─ Domen porti (4 hafta) ──────┐
   ↓                                  │ (parallel bo'lishi mumkin)
Faza 4 ─ Frontend (4 hafta) ◄─────────┘
   ↓
Faza 5 ─ CUTOVER (1 hafta)
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
| 🔴 **Prod ma'lumoti yo'qoladi (backup yo'q)** | **Yuqori** | **Halokatli** | **Faza 0. Hoziroq.** |
| 🔴 Backup skripti jimgina yiqilib, yaxshilarini o'chiradi | **Yuqori** | **Halokatli** | Faza 0.5 |
| Volume orphan (papka nomi o'zgarsa) | O'rta | Yuqori | `name:` pin / `external: true` |
| Port xatti-harakati jimgina siljiydi | **Yuqori** | Yuqori | **Characterization testlar (Faza 1)** |
| 50 foydalanuvchi login qila olmaydi | Past | **Halokatli** | bcrypt/JWT isbotlangan + Faza 2.7 |
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
