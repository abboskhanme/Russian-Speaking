# 09 · Docker — .NET stack

Professional, self-contained Docker stack for the **.NET 9** backend. It owns its own
project name (`govori-dotnet`), network and volumes, so it never collides with any other
stack running on the same host.

## Ishga tushirish

```bash
cp .env.example .env      # birinchi marta: SECRET_KEY va (ixtiyoriy) GOOGLE_CLIENT_ID to'ldiring
docker compose up -d --build
```

Birinchi build bir necha daqiqa (Api + Worker `dotnet publish`, frontend `vite build`).
Keyingi `up`lar tez (cache).

## Servislar va portlar

| Container | Image | Host port | Nima |
|---|---|---|---|
| **govori-web** | `govori/web:dev` | **http://localhost:8081** | nginx — SPA + `/api` va `/hubs` (SignalR WS) proxy → api |
| **govori-api** | `govori/api:dev` | http://localhost:8082 | ASP.NET Core — `/api/*`, `/hubs/attempts`, `/health`, `/metrics` |
| govori-worker | `govori/worker:dev` | — (ichki) | Hangfire server + recurring maintenance job'lar |
| govori-db | postgres:16-alpine | localhost:`${DB_PORT}` | Postgres 16 — birinchi ishga tushishda demo dump'dan **avtoseed** |
| govori-minio | minio/minio | localhost:9000 (konsol :9001) | S3 obyekt saqlash (`govori-audio` bucket) |
| govori-redis | redis:7-alpine | — (ichki) | OTP · SignalR backplane · rate-limit |
| govori-minio-init | minio/mc | — | Bir martalik: bucket yaratib **darhol tugaydi** (`Exited (0)` — normal) |

**Foydalanish:** brauzerda **http://localhost:8081** oching.

Portlar `.env` orqali sozlanadi (`API_PORT`, `FRONTEND_PORT`, `DB_PORT`, `MINIO_API_PORT`)
— shu mashinada boshqa stack'lar bilan to'qnashmaslik uchun.

## Holatni ko'rish / log / to'xtatish

```bash
docker compose ps           # holat (hammasi healthy bo'lishi kerak)
docker compose logs -f api   # api loglari (Serilog JSON)
docker compose down          # to'xtatish (ma'lumot saqlanadi)
docker compose down -v       # to'xtatish + BAZANI TOZALASH (qayta seed bo'ladi)
```

> **`DB_PORT` to'qnashuvi.** Bu mashinada boshqa loyihalarning Postgres konteynerlari
> doimiy ishlab turadi va bo'sh host porti vaqt o'tishi bilan siljiydi (5433 → 5434 →
> 5435). `Bind for 0.0.0.0:PORT failed` xatosini ko'rsangiz, `docker ps` bilan portni kim
> ushlab turganini toping va `.env` dagi `DB_PORT` ni o'zgartiring. **Ilovaning o'zi host
> portidan foydalanmaydi** — konteynerlar `govori-net` ustida 5432 orqali gaplashadi, ya'ni
> bu faqat Mac'dan `psql` qilishga ta'sir qiladi.

## Build va test

Host'dagi `dotnet` **8.0**, hamma loyiha esa **net9.0** — ya'ni hostda hech narsa qurilmaydi.
Hammasi SDK konteynerida bajariladi. `govori-nuget` volume'i paketlarni saqlaydi, chunki
NuGet bu yerda vaqti-vaqti bilan yetib bo'lmaydigan bo'lib qoladi va keshsiz har restore
noldan boshlanadi.

```bash
# Backend build — DoD: 0 warning, 0 error
docker run --rm --network govori-net \
  -v "$PWD":/repo -v govori-nuget:/root/.nuget/packages \
  -w /repo/backend-dotnet mcr.microsoft.com/dotnet/sdk:9.0 \
  dotnet build Govori.sln -c Release

# To'rtala suite
docker run --rm --network govori-net \
  -v "$PWD":/repo -v govori-nuget:/root/.nuget/packages \
  -w /repo/backend-dotnet \
  -e ConnectionStrings__Postgres="Host=db;Port=5432;Database=russpeak;Username=russpeak;Password=russpeak" \
  mcr.microsoft.com/dotnet/sdk:9.0 dotnet vstest \
    tests/Govori.UnitTests/bin/Release/net9.0/Govori.UnitTests.dll \
    tests/Govori.ArchTests/bin/Release/net9.0/Govori.ArchTests.dll \
    tests/Govori.Characterization/bin/Release/net9.0/Govori.Characterization.dll \
    tests/Govori.IntegrationTests/bin/Release/net9.0/Govori.IntegrationTests.dll
```

Uchta nozik joy, uchalasi ham vaqt yo'qotgan:

- **Repo ILDIZI mount qilinadi, `backend-dotnet/` emas.** Unit va Characterization suite'lari
  `tests/characterization/fixtures` ni ildizdan o'qiydi; faqat `backend-dotnet/` mount qilinsa
  ~44 test soxta yiqiladi.
- **`dotnet test` bu muhitda jim qoladi** (exit 0, bo'sh log). `dotnet vstest` ishlating.
- **Integration suite'ga `--env-file .env` BERMANG.** Real `.env` `TELEGRAM_BOT_TOKEN` va AI
  kalitlarini beradi, ya'ni OTP yetkazish `dev` dan `telegram_bot` ga o'tadi va quvur
  kechiktirish o'rniga baholaydi — 5 ta test kod regressiyasiga o'xshab yiqiladi, aslida esa
  emas.

Integration testlari har yugurishda o'zining `govori_it_*` bazasini EF migratsiyalaridan
quradi va tugagach `WITH (FORCE)` bilan o'chiradi, ya'ni **dev bazaga tegmaydi** va ikkita
parallel yugurish bir-birini buzmaydi.

Uchta Unit testi **ataylab o'tkazib yuboriladi** (SKIPPED) va faqat so'ralganda yuguradi —
ikkalasi ham real vendorga uriladi va pul sarflaydi:

```bash
# Grader golden set (docs/08 Faza 1.4–1.6 darvozasi) va jonli vendor smoke
... -e GOVORI_GOLDEN=1  --env-file .env ... --tests:GraderMeetsTheGoldenSet
... -e GOVORI_LIVE_AI=1 --env-file .env ... --testcasefilter:"FullyQualifiedName~LiveVendorSmokeTests"
```

### Frontend

```bash
docker run --rm -v "$PWD/frontend":/app -w /app node:22-alpine sh -c 'npm run build'         # check:tokens + tsc + vite
docker run --rm -v "$PWD/frontend":/app -w /app node:22-alpine sh -c 'npm test'              # vitest
docker run --rm -v "$PWD/frontend":/app -w /app node:22-alpine sh -c 'npm run check:budget'  # ≤180KB gz
```

### E2E (Playwright + axe) — stack ishlab turgan holda

```bash
docker run --rm --network govori-net --ipc=host \
  -v "$PWD/frontend":/w -v "$PWD/.env":/repo/.env:ro -w /w \
  -e GOVORI_ENV_FILE=/repo/.env \
  -e E2E_STUDENT_ID=$(docker exec govori-db psql -U russpeak -d russpeak -tAc \
      "select id from users where email='student@govori.uz'" | tr -d '[:space:]') \
  -e E2E_ADMIN_ID=$(docker exec govori-db psql -U russpeak -d russpeak -tAc \
      "select id from users where email='admin@govori.uz'" | tr -d '[:space:]') \
  mcr.microsoft.com/playwright:v1.62.1-jammy npx playwright test
```

**`--ipc=host` ixtiyoriy emas.** Docker konteynerga 64MB `/dev/shm` beradi va Chromium
renderer xotirasini o'sha yerda saqlaydi; suite bir necha spec'ga o'sgach u tugaydi va
`Target crashed` **o'sha paytda ishlayotgan ixtiyoriy chaqiruvdan** otiladi — ya'ni har
yugurishda **boshqa** test yiqiladi. Bu aynan "beqaror, retry qo'shaylik" deb noto'g'ri
tashxis qo'yiladigan shakl. O'lchangan: flagsiz 2.4 daqiqa va 3 ta tasodifiy yiqilish,
flag bilan 6 soniya va 0.

## Ma'lumot (schema) haqida — muhim

Sxema egasi — **EF Core migratsiyalari** (baseline migratsiyadan boshlab). Konteyner
ishga tushganda sxema **avtomatik yaratilmaydi**; migratsiyalar ataylab qo'lda qo'llanadi.
Shuning uchun:
- **Dev:** bo'sh `db` volume birinchi ishga tushganda `backups/russpeak_20260711_111407.sql.gz`
  demo dump'idan avtoseed bo'ladi (17 jadval + demo ma'lumot — prod sxemasining nusxasi).
  Qayta boshlash: `down -v` → keyingi `up` yangidan seed qiladi.
- **Prod (cutover):** `db` servisini olib tashlab, `GOVORI_DB` / `ConnectionStrings__Govori`
  ni **mavjud prod bazaga** yo'naltiring (seed mount kerak emas). Hangfire o'zining
  `hangfire` sxemasini qo'shadi (additive — mavjud jadvallarga tegmaydi).
- ⚠️ **To'ldirilgan bazada `dotnet ef database update` ishlatilmaydi** — baseline
  migratsiya mavjud sxemani qaytadan yaratmoqchi bo'ladi va birinchi `CREATE TABLE` da
  yiqiladi. Bunday bazani EF tarixiga **bir marta** `deploy/ef-baseline.sh` orqali
  qabul qildiring; keyingi migratsiyalar odatdagidek qo'llanadi.

## Prod'da nima farq qiladi
- Real prod Postgres / S3 (MinIO emas) ulanadi; `S3_PUBLIC_URL` real domenga.
- Real AI kalitlari: `AZURE_SPEECH_KEY/REGION`, `GEMINI_API_KEY`, `OPENAI_API_KEY`
  (hozir STT/Grader fake/stub — kalit kelganda real provider ulanadi).
- TLS nginx'da terminatsiya qilinadi (deploy/nginx + sertifikatlar).
