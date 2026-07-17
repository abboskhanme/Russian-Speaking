# 07 · Arxitektura v3 — .NET

> **Bu hujjat `02-ARCHITECTURE-V2.md` ning backend qismini almashtiradi.**
> `02` FastAPI/SQLAlchemy/Celery uchun yozilgan edi; backend endi **C# / .NET 9**.
> `02` dagi domen chegaralari g'oyasi **saqlanadi** — faqat til va vositalar o'zgaradi.
> `03-DESIGN-SYSTEM.md` va `04-UX-FLOWS.md` **kuchda qoladi** (dizayn tildan mustaqil).

---

## 7.1 Nima uchun .NET — va nimaga tegmaydi

Bu qaror foydalanuvchi tomonidan qabul qilingan. Arxitektor sifatida uni **xavfsiz** qilish
mening ishim. Halol baho:

**.NET haqiqatan yutadigan joylar (auditdagi muammolarga to'g'ridan-to'g'ri javob):**

| Auditdagi muammo | .NET yechimi |
|---|---|
| **K8** — sinxron DB, `async` yo'q, har so'rov threadpool'ni bloklaydi; 1000+ o'quvchida muammo | `async/await` — birinchi sinf. "Yuzlab bir vaqtdagi foydalanuvchi" talabiga to'g'ridan-to'g'ri javob. |
| **K7** — domen chegarasi yo'q, linter bilan majburlash kerak edi | Chegara **kompilyator** bilan majburlanadi: `Catalog` loyihasi `Practice` ni ko'rmaydi, chunki project reference yo'q. Linter emas — **build xatosi**. |
| **K9** — SSE va'da qilingan, polling yozilgan | **SignalR** — SSE dan kuchliroq, tayyor, reconnect/backplane bilan. |
| **K10** — testlar yo'q | **Testcontainers** — har integration test uchun haqiqiy Postgres. |
| Kuzatuv yo'q | **OpenTelemetry** — .NET da o'rnatilgan, qo'shimcha ish deyarli yo'q. |
| Tiplar frontend bilan mos emas | **OpenAPI → TypeScript** generatsiya. Kontrakt bitta manbadan. |

**Halol narx (bilib turib to'laymiz):**

| Yo'qotish | Ta'sir | Yumshatish |
|---|---|---|
| **Gemini uchun rasmiy .NET SDK yo'q** | O'rta | Gemini REST API sodda. `IGraderProvider` ortiga yashiriladi (A4 qarori baribir shuni talab qiladi). |
| Azure Speech SDK Linux'da native kutubxona talab qiladi | Past | Docker image'ga `libasound2`, `libssl3`, `ca-certificates` — hozirgi Python image'da ham xuddi shu. |
| **9 398 qator yetuk Python qayta yoziladi** | **Yuqori** | Faza 1 — *characterization testlar*. Bu yagona himoya. §7.6 |
| `resume-from-transcript`, breaker, scoring — auditda "yetuk muhandislik" deb baholangan | **Yuqori** | Ular **qayta o'ylanmaydi** — bir xil semantika bilan ko'chiriladi. Testlar buni isbotlaydi. |

> **O'zgarmas qoida:** rewrite = **til almashtirish**, mahsulot xatti-harakatini qayta ixtiro qilish emas.
> Har bir "yaxshilash" g'oyasi cutover'dan **keyin**ga qoladi. Bitta vaqtda bitta o'zgaruvchi.

---

## 7.2 Yechim tuzilishi

```
backend/                        ← .NET 9 solution (eski Python `backend/` arxivga ko'chadi)
├── Govori.sln
├── src/
│   ├── Govori.Api/             ASP.NET Core host · endpointlar · DI · auth · SignalR hub
│   ├── Govori.Worker/          Hangfire host — grading pipeline (ex-Celery)
│   ├── Govori.Contracts/       DTO'lar → OpenAPI → frontend TS klienti
│   ├── Govori.Domains/
│   │   ├── Govori.Identity/        User, auth, Google, OTP, rollar
│   │   ├── Govori.Catalog/         Module (QuestionBlock), Task (Question), Topic, Scenario
│   │   ├── Govori.Practice/        Attempt (Submission), freemium gate
│   │   ├── Govori.Assessment/      Transcript, Evaluation, pipeline/, scoring
│   │   ├── Govori.Coaching/        ReviewItem (SRS), Drill, MinimalPair
│   │   ├── Govori.Classroom/       Group, Assignment, Gradebook, insights
│   │   ├── Govori.Engagement/      Xp, Streak, Achievement, Leaderboard, Notification
│   │   ├── Govori.Billing/         Plan, Entitlement, Payme/Click   ← YANGI (admin dizaynida bor)
│   │   └── Govori.Administration/  AppSetting, ops
│   ├── Govori.Platform/        tashqi dunyo — biznes qoidasi YO'Q
│   │   ├── Govori.Platform.Stt/       ISttProvider · Azure · Whisper
│   │   ├── Govori.Platform.Grader/    IGraderProvider · Gemini · OpenAI · AzureOpenAI
│   │   ├── Govori.Platform.Storage/   IObjectStorage · S3/MinIO
│   │   ├── Govori.Platform.Messaging/ email · telegram
│   │   └── Govori.Platform.Media/     Pexels
│   └── Govori.Infrastructure/  EF Core DbContext · migratsiyalar · repozitoriylar
└── tests/
    ├── Govori.Characterization/  ← Python xatti-harakatini qotiradi. FAZA 1. Eng muhim.
    ├── Govori.UnitTests/
    ├── Govori.IntegrationTests/  Testcontainers: haqiqiy Postgres + Redis + MinIO
    ├── Govori.GoldenSet/         AI grader regressiyasi (docs/02 §2.7)
    └── Govori.ArchTests/         NetArchTest — chegaralarni CI'da isbotlaydi
```

**Chegara qoidalari — kompilyator majburlaydi:**
- `Govori.<Domain>` boshqa domenning **modeliga** reference qilmaydi. Faqat `.Contracts` yoki event.
- `Govori.Platform.*` **hech qachon** `Govori.Domains.*` ga reference qilmaydi (bir tomonlama).
- `Govori.Api` yupqa: parse → service → serialize. Endpointda `DbContext` **yo'q**.
- `Govori.ArchTests` bularni CI'da isbotlaydi — reference qo'shib bo'lmaydi, build yiqiladi.

---

## 7.3 Texnologik qarorlar

| Mavzu | Qaror | Sabab |
|---|---|---|
| Runtime | **.NET 9**, C# 13 | LTS-ga yaqin, `async` yetuk |
| API | **ASP.NET Core Minimal APIs** + endpoint guruhlari | Yupqa, tez, OpenAPI avtomatik |
| ORM | **EF Core 9 + Npgsql** | Postgres uchun eng yetuk |
| **Sxema** | **Database-first** — prod dump'dan `dotnet ef dbcontext scaffold` | ⚠️ Eng muhim qaror. §7.4 |
| Parol | **BCrypt.Net-Next** | Mavjud `$2b$12$` hashlarni **o'zgarishsiz** tekshiradi |
| Token | **JWT HS256**, bir xil `SECRET_KEY` | Mavjud sessiyalar uzilmaydi |
| Fon ishlari | **Hangfire** (Postgres storage) | Celery+beat o'rniga. Dashboard bor, yangi infra kerak emas |
| Real-time | **SignalR** | Polling → real natija (F7). Redis backplane |
| Validatsiya | **FluentValidation** | Pydantic o'rniga |
| Mapping | **Qo'lda** (AutoMapper YO'Q) | Aniq, debug qilinadigan |
| Test | **xUnit + Testcontainers + WireMock.NET** | Haqiqiy Postgres, mock provider |
| Kuzatuv | **OpenTelemetry + Serilog** | Trace: HTTP → Hangfire → Azure/Gemini |
| Kontrakt | **OpenAPI → TS klient** (`kiota` yoki `openapi-typescript`) | Frontend tiplari backenddan |
| Rate limit | **ASP.NET Core RateLimiter** + Redis | `core/ratelimit.py` semantikasi saqlanadi (fail-open!) |

---

## 7.4 Ma'lumot strategiyasi — **eng muhim bo'lim**

**Qaror (foydalanuvchi tanlovi): sxema cutover'da O'ZGARMAYDI.**

```
┌─ Mavjud 20+ jadval ──────────────────────────┐
│  users, questions, question_blocks,          │  ← TEGILMAYDI. Nom ham, ustun ham.
│  submissions, transcripts, evaluations,      │     EF Core bularga MOSLASHADI,
│  groups, assignments, xp_events, ...         │     aksincha emas.
└──────────────────────────────────────────────┘
┌─ Yangi funksiyalar uchun YANGI jadvallar ────┐
│  scenarios, roleplay_turns,                  │  ← FAQAT QO'SHISH.
│  drills, minimal_pairs,                      │     Additive migratsiya = xavfsiz.
│  entitlements, subscriptions, payments       │     Rollback = jadvalni tashlab ketish.
└──────────────────────────────────────────────┘
```

**Qoidalar:**
1. **Cutover migratsiyasi faqat `CREATE TABLE`.** Hech qanday `ALTER`, `RENAME`, `DROP`.
2. **`Submission` → `Attempt` renomi CUTOVER'DA QILINMAYDI.** C# da klass nomi `Attempt`
   bo'lishi mumkin, lekin `[Table("submissions")]` — jadval o'sha. Rename keyin, alohida,
   2 bosqichli migratsiya bilan (docs/02 §2.3).
3. **Alembic tarixi saqlanadi.** EF Core baseline `c1d2e3f4a5b6` (prod head) dan boshlanadi.
   `alembic_version` jadvaliga **tegilmaydi** — rollback uchun Python backend ishlay olishi kerak.
4. **EF Core sxemani hech qachon o'zi yaratmaydi.** `EnsureCreated()` **taqiqlanadi**.
   Faqat aniq, ko'rib chiqilgan migratsiyalar.
5. **Har migratsiya prod dump nusxasida sinovdan o'tadi**, keyin prodda.

**EF Core mapping tuzoqlari (auditdan):**

| Tuzoq | Yechim |
|---|---|
| **Native PG enum'lar** (`user_role`, `question_type`, `submission_status`) | `NpgsqlDataSourceBuilder.MapEnum<UserRole>("user_role")` — nom **aynan** mos kelishi shart |
| **`snake_case`** ustun nomlari | `EFCore.NamingConventions` → `UseSnakeCaseNamingConvention()` |
| **JSONB** (`word_timestamps`, `pronunciation`, `feedback`, `corrections`) | `.HasColumnType("jsonb")` + `System.Text.Json`. ⚠️ Python `json` bilan bir xil serializatsiya |
| **UUID PK, klient tomonda generatsiya** (`uuid.uuid4()`) | `.ValueGeneratedNever()` + C# da `Guid.CreateVersion7()` EMAS — `Guid.NewGuid()` (v4, bir xil) |
| **TIMESTAMPTZ** | `DateTime` EMAS → **`DateTimeOffset`** yoki `DateTime` + `UtcNow`. Npgsql `Kind=Utc` talab qiladi |
| `updated_at onupdate=now()` | Python-tomonda edi → EF Core `SaveChanges` interceptor |
| `password_hash` **nullable** (Google akkauntlar) | Login'da `null` tekshiruvi **verify'dan oldin** — aks holda zaiflik |

---

## 7.5 Auth — cutover'ning eng nozik joyi

**Isbotlangan (`backend/app/core/security.py` o'qildi):**

```python
bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt())   # → $2b$12$...
jwt.encode({"sub", "type", "iat", "exp"}, SECRET_KEY, "HS256")   # claim'lar shu, boshqa yo'q
```

**C# ekvivalenti — majburiy detallar:**

```csharp
// Parol — mavjud hashlar o'zgarishsiz tekshiriladi
BCrypt.Net.BCrypt.Verify(password, hash);          // $2b$12$ ni o'qiydi
BCrypt.Net.BCrypt.HashPassword(password, 12);      // yangi hashlar ham $2b$12$

// ⚠️ 72-BAYT KESISH: Python BAYTni kesadi, belgini emas.
// Kirill parolda 72-bayt chegarasi belgi o'rtasiga tushsa — digest farq qiladi.
var bytes = Encoding.UTF8.GetBytes(password);
var truncated = bytes.AsSpan(0, Math.Min(72, bytes.Length));

// JWT — mavjud tokenlar qabul qilinishi uchun
options.TokenValidationParameters = new() {
    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey)), // base64 EMAS
    ValidateIssuer   = false,   // token'da `iss` yo'q
    ValidateAudience = false,   // token'da `aud` yo'q
    ValidateLifetime = true,
    ClockSkew        = TimeSpan.Zero,   // .NET default 5 daqiqa — python-jose'da 0
};
JwtSecurityTokenHandler.DefaultInboundClaimTypeMap.Clear();  // `sub` → `sub` bo'lib qolsin
```

**⚠️ Rol token'da YO'Q.** Har so'rovda DB'dan `User` o'qiladi va `role` + `is_active` tekshiriladi
(`deps.py:30-32`). Faqat claim'ga tayangan port: (a) bloklangan foydalanuvchini 30 daqiqa
ichkarida qoldiradi, (b) rol o'zgarishini ko'rmaydi. **DB o'qish saqlanishi shart.**

**Chiqish sharti (DoD):** prod dump nusxasidan **haqiqiy foydalanuvchi hash'i** bilan C# login
testi o'tadi. Bu Faza 2 ning yakuniy testi.

---

## 7.6 Characterization testlar — portning yagona himoyasi

**Muammo:** hozirgi Python testlari — 1 fayl, 13 test, 5 funksiya. Auditning xulosasi:
*"the port cannot be validated against this suite"*. Ya'ni C# ni "to'g'ri ko'chirdim" deb
aytishga **asos yo'q**.

**Yechim:** Python'ni qayta yozishdan **oldin**, uning xatti-harakatini testga qotiramiz.
Keyin C# **aynan o'sha testlardan** o'tadi.

| # | Nima qotiriladi | Nega aynan bu |
|---|---|---|
| C1 | `hash_password`/`verify_password` + prod'dan olingan **real hash korpusi** | Xato = 50 foydalanuvchi qulflanadi |
| C2 | JWT encode/decode bayt-darajasida moslik | Xato = hamma sessiya uziladi |
| C3 | `effective_band`, `rolling_avg` (oxirgi 10), `best_band` | Har foydalanuvchi ko'radigan raqam |
| C4 | `needs_premium` — public/group × premium × index matritsasi | Paywall. Xato = pul yoki g'azab |
| C5 | `_with_pron` + orfoepiya jarimasi: `(x*4+pron)/5 - min(n*4, 20)` | Ball arifmetikasi |
| C6 | `_drop_cosmetic_corrections` normalizatsiyasi | Auditda: "correctness guard, not a nicety" |
| C7 | `_reference_match` (shadowing, `completeness >= 50` gate) | Shadowing bahosi |
| C8 | `xp_for_band`: `<27 → 0`, else `round(pct/4)` | Gamifikatsiya |
| C9 | `task_index` tartibi `(sort_order, created_at)` | Freemium pozitsiyasi shunga bog'liq |
| C10 | `normalize_uz_phone` | Ro'yxatdan o'tish |

**Usul:** har biri uchun Python'da parametrlashtirilgan test → JSON fixture (kirish → kutilgan chiqish)
→ C# xUnit **o'sha JSON fixture'ni** o'qiydi. Bitta haqiqat manbai, ikki til.

```
tests/characterization/
├── fixtures/            ← Python generatsiya qiladi, C# iste'mol qiladi
│   ├── bcrypt_corpus.json      (prod hashlar, anonimlashtirilgan)
│   ├── jwt_vectors.json
│   ├── scoring_cases.json
│   ├── freemium_matrix.json
│   └── ...
├── python/test_characterize.py  ← fixture'ni generatsiya qiladi VA tasdiqlaydi
└── (C# tomoni: tests/Govori.Characterization/)
```

> Bu **Faza 1**. Kod yozishdan oldin. Bularsiz rewrite — ko'r-ko'rona.

---

## 7.7 Grading pipeline — C# da

Semantika **o'zgarmaydi** (auditda "mature engineering decision" deb baholangan):

```
Attempt(pending)
   ├─ RESUME CHECK: Transcript bormi? → BOR: STT'ni O'TKAZIB YUBOR (pul tejaladi)
   ├─ Stage 1  transcribe    → Transcript      [Azure STT | Whisper]
   ├─ Stage 2  pronounce     → WordScores      [Azure PA]     (skip: roleplay)
   ├─ Stage 3  orthoepy      → OrthoepyFlags   [Gemini audio] (best-effort, flag bilan)
   ├─ Stage 4  analyze       → RubricScores    [Grader]       (skip: shadowing/drill)
   ├─ Stage 5  score         → level_score = max(0, (x*4+pron)/5 - min(n*4, 20))
   └─ Stage 6  award         → XP, streak, SRS, events
```

**Ko'chirishda saqlanadigan nozikliklar (auditdan):**
- **Lazy audio yuklash** — resume'da S3'dan yuklamaslik uchun closure/`Lazy<T>`.
- **`Evaluation` DELETE-then-INSERT** — `submission_id` unique, retry to'qnashadi.
- **Terminal vs retry:** `SoftTimeLimitExceeded`/`CircuitOpenError` → **retry YO'Q** (bir xil devorga urilamiz).
- **5 ta mustaqil breaker** — `gemini_besteffort` alohida, toki orfoepiya kvotasi **grader**ning
  zanjirini uzmasin. Bu nozik va ataylab shunday.
- **Azure PA doim `reference_text=""`** — hatto shadowing'da ham. Reference bersak, recognizer
  target'ni "eshitadi". Taqqoslash **o'z kodimizda** (`_reference_match`).
- **`Lexical`, `Display` emas** — o'quvchi aslida nima deganini ko'rsatish uchun.
  (Xotira: *transcript must stay faithful*.)
- `_drop_cosmetic_corrections` — STT tinish belgisi bermaydi, model esa "tuzatgisi" keladi.

**O'zgaradigan (ataylab):**
- Celery → **Hangfire**; `task_acks_late` → Hangfire avtomatik retry.
- Breaker holati **per-process** edi (`--concurrency=2` → 2 ta holat). C# da ham singleton =
  per-process. **Redis'ga ko'chirish — keyingi faza** (xatti-harakat o'zgarishi, cutover'da emas).
- Polling → **SignalR** (F7). Bu yagona UX o'zgarishi va u qo'shimcha, buzuvchi emas.

---

## 7.8 Xavfsizlik — auditda topilgan, port'da tuzatiladigan

| # | Muammo | Manba | Port'da |
|---|---|---|---|
| S1 | `create_assignments` da **roster filtri yo'q** — istalgan o'qituvchi istalgan o'quvchiga topshiriq bera oladi | `engagement.py:400-404` | ✅ Tuzatiladi (`create_reviews` da filtr **bor** — nomuvofiqlik) |
| S2 | `FREE_ATTEMPT_LIMIT` **serverda umuman yo'q**, faqat frontendda → istalgan klient chetlab o'tadi | `config.py:100` | ⚠️ **Qaror kerak**: serverda joriy qilamizmi yoki o'chiramizmi? |
| S3 | Refresh token **7 kun bekor qilib bo'lmaydi** — store yo'q, `jti` yo'q, rotatsiya yo'q | `auth.py:210-219` | ✅ `jti` + Redis denylist qo'shiladi |
| S4 | `GET /admin/settings/reveal/{key}` — **xom sirlarni** API orqali qaytaradi | `admin_settings.py:145` | ✅ Audit log + qayta ko'rib chiqish |
| S5 | SMTP sozlanmagan bo'lsa — ro'yxatdan o'tish **email tasdiqlashsiz** o'tadi, OTP **ochiq logga** yoziladi | `auth.py:109`, `email.py:20` | ✅ Prod'da fail-closed |
| S6 | `_update_streak` `date.today()` — **server vaqti**, foydalanuvchi zonasi emas | `gamification.py:67` | ✅ Foydalanuvchi TZ |
| S7 | Audio — **biometrik ma'lumot**, saqlash siyosati yo'q | — | ✅ 90 kun + S3 lifecycle (docs/02 §2.8) |
| S8 | `nginx.conf` — HSTS yo'q, `server_name _` | `nginx/nginx.conf` | ✅ |
| S9 | `.dockerignore` yo'q → `.env` va `backups/` build context'ga ketadi | — | ✅ |

**Saqlanadigan (ataylab shunday, buzmang):**
- Rate limiter **fail-open** (Redis o'lsa API o'lmasin) — `ratelimit.py:52`.
- OTP **fail-closed** (Redis o'lsa kod tasdiqlanmasin) — `otp.py:5`.
- Rate limit identity: `u:{sub}` yoki `ip:{...}` — 20-30 o'quvchi bitta NAT ortida bo'lgani uchun.

---

## 7.9 Ishonchlilik va kuzatuv

| Qatlam | Maqsad |
|---|---|
| Log | Serilog JSON + `trace_id`, `attempt_id` har qatorda |
| Trace | OpenTelemetry: HTTP → Hangfire → Azure/Gemini uzluksiz span |
| Metrika | `attempt_grade_duration_seconds`, `ai_cost_usd_total{provider}`, `stage_failures_total{stage}` |
| Alert | TTFS p95 > 40s · stage failure > 5% · kunlik AI xarajat > $X · **backup muvaffaqiyatsiz** |
| Backup | `pg_dump -Fc` + **MinIO** + **offsite** + **haftalik restore-drill** (avtomatik) |

> **`Evaluation.llm_model` bugun `GEMINI_MODEL` deb hardcode qilingan** (`tasks.py:266`) — Azure yoki
> OpenAI baholaganda ham. Mavjud qatorlar provider bo'yicha ishonchsiz. Port'da haqiqiy provider
> yoziladi + `cost_usd` + `prompt_version` (docs/02 §2.7 uchun shart).

---

## 7.10 Cutover strategiyasi

**Strangler Fig EMAS.** Sabab: ikki til bitta sxemaga (ikki ORM, ikki migratsiya tarixi) —
50 foydalanuvchi uchun bu murakkablik foydadan qimmat.

**Parallel qurish + boshqariladigan oyna:**

```
1. Yangi stack YONIDA quriladi (yangi port, yangi compose service)
2. Prod DB nusxasiga ulanadi (read-only smoke)          ← hafta davomida
3. Rehearsal: to'liq cutover mashqi, nusxa ustida       ← kamida 2 marta
4. Oyna (~30 daq, kam faollik vaqtida):
     a. Eski stack STOP (yozuv to'xtaydi)
     b. pg_dump -Fc (oxirgi nuqta)                       ← rollback nuqtasi
     c. Additive migratsiya (faqat CREATE TABLE)
     d. Yangi stack START, smoke testlar
     e. Yashil → DNS/nginx yangi backend'ga
     f. Qizil → ROLLBACK: eski stack START (sxema mos, chunki faqat qo'shildi)
5. Eski stack 2 hafta o'chirilgan holda TURADI (o'chirilmaydi)
```

**Rollback nima uchun ishlaydi:** migratsiya faqat qo'shgani uchun eski Python kodi yangi
jadvallarni **ko'rmaydi va e'tibor bermaydi**. Sxema u uchun hamon to'g'ri. Rollback =
`docker compose up` eski fayl bilan. Bu — sxemani o'zgartirmaslik qarorining asosiy mevasi.

**⚠️ Volume tuzog'i:** Docker volume nomi papka nomidan olinadi (`russpeak_postgres-data`).
Yangi papkaga clone qilish → **yangi bo'sh volume**, ilova "ishlaydi", baza bo'sh.
**Yangi compose faylida `name:` aniq pinlanadi yoki volume `external: true` qilinadi.**

---

## 7.11 Frontend — qisqacha (to'liq: `03` + `04`)

`02 §2.5` dagi FSD saqlanadi. Yagona o'zgarish: **tiplar backenddan generatsiya qilinadi.**

```
frontend/src/
├── app/          providers · router (lazy, rol bo'yicha 3 bundle) · layouts
├── processes/    answer-task · roleplay-session · onboarding
├── pages/        yupqa (≤150 qator)
├── widgets/      ScoreCard · PronunciationCard · ClassInsightBoard
├── features/     record-audio · submit-attempt · assign-task
├── entities/     user · task · module · attempt · evaluation
└── shared/
    ├── ui/       ← YAGONA DS (Ovoz). ui.tsx + govori.tsx O'CHADI
    ├── api/      ← OpenAPI'dan GENERATSIYA QILINADI (qo'lda yozilmaydi)
    ├── lib/      query keys · i18n · a11y
    └── styles/   tokens.css (@theme) · base.css
```

**Dizayn manbasi:** `RussianDesign/Govori/*.dc.html` — tokenlar `03-DESIGN-SYSTEM.md` ga
**aynan mos** (tekshirildi: `--primary:oklch(0.665 0.185 40)`, Onest, JetBrains Mono).

**⚠️ Tuzatish:** `03 §3.8` o'quvchi uchun **3** elementli nav va'da qiladi. Mockup **5** ta beradi:
`Home · Practice · AI Suhbat · Progress · Profile` (mockup sarlavhasi: "5 menyu").
**Mockup g'olib** — u yangiroq va foydalanuvchi yaratgan. `03 §3.8` shunga tuzatiladi.

---

## 7.12 Dizayndan kelib chiqqan YANGI backend talablari

Mockuplarda bor, hozirgi backendda **umuman yo'q**:

| Ekran | Kerak bo'ladigan domen |
|---|---|
| Student · **AI Suhbat (Chat)** | `Scenario`, `RoleplayTurn` — turn-based ovozli suhbat (F1) |
| Teacher · **Create: Ssenariy** | Ssenariy CRUD |
| Admin · **Payments** | `Plan`, `Entitlement`, `Subscription`, Payme/Click webhook |
| Admin · **Groups**, **Teacher Detail** | Mavjud domenlar kengaytiriladi |

Bularning hammasi **yangi jadval** = additive = xavfsiz. Cutover'da **feature flag ortida
o'chiq** turadi, tayyor bo'lgach yoqiladi.
</content>
