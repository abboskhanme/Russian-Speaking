# 08 · Rewrite rejasi — Python → .NET

> **Bu hujjat `05-ROADMAP.md` ni almashtiradi.** `05` Python'ni joyida yaxshilash uchun edi;
> endi backend qayta yoziladi. `05` dagi **tartib mantig'i saqlanadi** (grader xavfsizlik to'ri
> birinchi), lekin fazalar boshqa.

**Kontekst:**
- Prod **jonli**: `govorim.uz` → `134.209.240.56`, ~50 real foydalanuvchi. Ishlab turibdi.
- Ko'chirilayotgan: 9 398 qator Python (110 endpoint, 4 Celery task) + 19 405 qator frontend.
- **Prod hech qachon to'xtamaydi** — yangi stack yonida quriladi, cutover bitta qisqa oynada.

---

## Holat — 2026-08-13

> Quyidagi jadvallar **reja** (o'zgarmaydi); bu bo'lim esa **haqiqatda nima bajarilgani**.
> Ziddiyat bo'lsa — shu bo'lim ustun. Belgilar: ✅ tugagan · 🟡 qisman · ⬜ boshlanmagan.

| Faza | Holat | Nimasi qolgan |
|---|:--:|---|
| **0 · Ma'lumot xavfsizligi** | ⬜ | Skriptlar **yozilgan** (`backup-prod.sh`, `verify-backup.sh`, `rollback-db.sh`), lekin **prodda birortasi ham ishga tushirilmagan** — hammasi droplet'ga kirishni talab qiladi. 🔴 Hamon bloklovchi: real 50 foydalanuvchining zaxirasi yo'q. |
| **1 · Xavfsizlik to'ri** | 🟡 | 1.1–1.3 ✅ — 10 fixture (`tests/characterization/fixtures/`), `Govori.Characterization` 35 test yashil, bcrypt korpusi. **1.4–1.6 ⬜ — grader golden set umuman yo'q**, demak CI'da AI regressiyasini ushlaydigan darvoza ham yo'q. |
| **2 · .NET poydevor** | 🟡 | Solution, ArchTests (35), EF database-first, 6 migratsiya, auth porti, Serilog/health, Docker image ✅. **2.5 ⬜** Testcontainers yo'q — integration testlar umumiy dev Postgres'ga ulanadi (`GOVORI_TEST_DB`). **2.7 ⬜** real prod hash bilan login isbotlanmagan — prod dump'i yo'q, ya'ni **Faza 0 ga bog'liq**. |
| **3 · Domen porti** | ✅ | 8 modul, 81 endpoint, Hangfire 4 ta recurring job, SignalR `AttemptsHub`. Faqat **3.10 o'lchovi ⬜** — TTFS p95 hech qachon o'lchanmagan (instrumentatsiya yo'q). |
| **4 · Frontend** | 🟡 | Barcha ekranlar ✅ (o'quvchi · o'qituvchi 10 ekran · admin 4 ekran), i18n uz/ru/en, Ovoz DS tokenlari, self-hosted shriftlar. **4.2 ⬜** — API tiplari **qo'lda** yozilgan (`shared/api/types.ts`), OpenAPI generatsiyasi yo'q. **4.11 ⬜** — Vitest/Playwright/`axe` yo'q; CI faqat `tsc` + `vite build`. **4.1 bundle budjeti ⬜**. |
| **5 · Cutover** | 🟡 | **Baza yarmi ✅ mashq qilingan** (55 user / 770 javob nusxasida; baseline → migratsiya → integrity → rollback). **Server yarmi ⬜** — `deploy/CUTOVER.md` dagi 1–6 qadamlar hech qachon bajarilmagan. |
| **6 · Yangi funksiyalar** | ⬜ | Faqat **6.4 F4 Placement ✅** (mehmon uchun ham). **6.5 F1 Roleplay — faqat UI stub**: `ConversationPage` statik ssenariyni o'ynatadi, backend/LLM/STT ulanmagan. 6.1 SRS UI, 6.2, 6.3, 6.6 Payments, 6.7, 6.8 — yo'q. |
| **7 · Tozalash** | 🟡 | 7.1–7.8 ✅ (7.8 — `RussianDesign/` → `docs/design/`). Qolgani: `TEACHER-PANEL-PLAN.md` + `dev-role.sh` — ular **C3/C6 mahsulot qaroriga** bog'liq. |

**Rejadan tashqari, rejada yo'q edi va bajarildi:** o'qituvchi paneli to'liq (7 faza),
admin paneli, telefon+Telegram OTP auth, guruhga qo'shilish so'rovlari, media yuklash,
`preferred_language` akkaunt sozlamasi, dev fixture yangilash skripti.

**Keyingi uchta ish, tartib bilan:** (1) Faza 0 — prod zaxirasi, chunki qolgan hamma narsa
unga bog'liq; (2) Faza 1.4–1.6 golden set, chunki AI'ga tegishdan oldin; (3) cutover.

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
