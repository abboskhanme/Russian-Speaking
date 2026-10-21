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
| govori-minio | pgsty/minio | localhost:9000 (konsol :9001) | S3 obyekt saqlash (`govori-audio` bucket) |
| govori-redis | redis:7-alpine | — (ichki) | OTP · SignalR backplane · rate-limit |
| govori-minio-init | pgsty/mc | — | Bir martalik: bucket + ilovaning MinIO foydalanuvchisi/policy'sini yaratib **darhol tugaydi** (`Exited (0)` — normal) |

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

### OpenAPI hujjati va kontrakt darvozasi (docs/08 Faza 4.2)

`backend-dotnet/openapi.json` — API ning mashina o'qiy oladigan tavsifi, **repoga commit
qilinadi**. Uni qayta yaratish:

```bash
# Hujjatni qayta yarat (avval build qilingan bo'lsin)
docker run --rm -v "$PWD":/repo -v govori-nuget:/root/.nuget/packages -w /repo/backend-dotnet \
  -e ASPNETCORE_ENVIRONMENT=Development \
  -e SECRET_KEY=openapi-emit-only-not-a-real-secret \
  mcr.microsoft.com/dotnet/sdk:9.0 \
  dotnet run --project src/Govori.Api -c Release --no-build --no-launch-profile \
    -- --emit-openapi /repo/backend-dotnet/openapi.json

# Qo'lda yozilgan TS tiplarini shu hujjatga solishtir
docker run --rm -v "$PWD/frontend":/app -v "$PWD/backend-dotnet":/backend-dotnet -w /app \
  node:22-alpine sh -c 'npm run check:contract'
```

Uchta narsa bu buyruqda ataylab shunday:

- **`SECRET_KEY` qiymati o'zini tushuntiradi.** Host kalitsiz ishga tushishdan bosh tortadi,
  lekin bu yerda hech narsa token imzolamaydi — bu **haqiqiy kalit emas** va uni hech qayerga
  nusxalash kerak emas.
- **`ASPNETCORE_ENVIRONMENT=Development` majburiy**, `--no-launch-profile` esa chiqishni
  `launchSettings.json` dan mustaqil qiladi. Sababi: profilsiz muhit `Production` bo'ladi va
  `ProductionSecrets` (to'g'ri qiladi) Telegram tokeni va bazasi yo'q host'ni qurishdan bosh
  tortadi. Hujjatning **o'zi ikkala muhitda bayt-ma-bayt bir xil** — bu faqat host qurilishi
  uchun.
- **Host quriladi, lekin ishga tushmaydi** (`app.Run()` chaqirilmaydi), ya'ni emit'ga Postgres,
  Redis yoki S3 **kerak emas** — `--network none` konteynerda ham ~1 soniyada ishlaydi.

Hujjat **deterministik**: path'lar va sxemalar tartiblangan, maydonlar e'lon tartibida. Ikki
yugurish bir xil bayt beradi, shuning uchun CI "qayta yarat + `git diff --exit-code`" qila oladi.

> **Nega `types.ts` generatsiya qilinmaydi.** `shared/api/types.ts` **qo'lda** yoziladi va shunday
> qoladi: unda generator saqlay olmaydigan bilim bor (nega `known_open_ai_models` hamon qabul
> qilinadi, nega maydon ixtiyoriy, tri-state PATCH semantikasi). Darvoza uni **almashtirmaydi** —
> u qo'lda yozilgan faylni hujjatga solishtiradi, ya'ni siljish kompilyatsiyada emas, CI da
> ushlanadi. Nima tekshiriladi va nima tekshirilmaydi — `frontend/scripts/check-contract.mjs`
> boshidagi izohda.

Development'da hujjatni `GET http://localhost:8082/openapi/v1.json` dan ham olsa bo'ladi.
**Swagger UI yo'q** — umuman qo'shilmagan, shuning uchun prodda o'chirish kerak bo'lgan narsa
ham yo'q.

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
- ⚠️ **Dump baseline'dagi sxema — undan keyingi migratsiyalar unda yo'q.** Birinchi `up`
  dan keyin ularni qo'llamasangiz, ilova ishga tushadi, `/health` yashil, lekin **har bir
  kirish 500** beradi (`column u.notifications_enabled does not exist`) — 2026-10-21 da
  aynan shunday bo'ldi. Toza volume'dan keyin bir marta:
  ```bash
  COMPOSE_FILE=docker-compose.yml COMPOSE_DB_SERVICE=db bash deploy/ef-baseline.sh
  COMPOSE_FILE=docker-compose.yml bash deploy/migrate.sh
  ```
  Keyin har yangi migratsiyada faqat `migrate.sh`. Windows'da Git Bash'dan
  `MSYS_NO_PATHCONV=1` qo'shing — aks holda Docker `-w /repo/...` ni Git papkasiga
  aylantirib yiqiladi.
- **Prod (cutover):** `db` servisini olib tashlab, `GOVORI_DB` / `ConnectionStrings__Govori`
  ni **mavjud prod bazaga** yo'naltiring (seed mount kerak emas). Hangfire o'zining
  `hangfire` sxemasini qo'shadi (additive — mavjud jadvallarga tegmaydi).
- ⚠️ **To'ldirilgan bazada `dotnet ef database update` ishlatilmaydi** — baseline
  migratsiya mavjud sxemani qaytadan yaratmoqchi bo'ladi va birinchi `CREATE TABLE` da
  yiqiladi. Bunday bazani EF tarixiga **bir marta** `deploy/ef-baseline.sh` orqali
  qabul qildiring; keyingi migratsiyalar odatdagidek qo'llanadi.

## MinIO: ilova o'z foydalanuvchisi bilan ishlaydi (root emas)

api va worker MinIO'ga **root** (`MINIO_ROOT_USER/PASSWORD`) bilan emas, `minio-init` yaratgan
ilova foydalanuvchisi bilan kiradi: `S3_APP_ACCESS_KEY` / `S3_APP_SECRET_KEY` (dev sukuti
`govori-app` / `govori-app-dev-only`). Sabab: har bir presigned URL query'sida access key id
ochiq yoziladi, root kalit esa bucket o'chirish, foydalanuvchi qo'shish, policy o'zgartirishga
qodir. `govori-app` policy faqat `S3_BUCKET` ichida Get/Put/Delete obyekt + List (va
`GetBucketLocation`) beradi — boshqa bucket, bucket yaratish/o'chirish, admin API **yo'q**.
Root juftligi faqat `minio` va `minio-init` konteynerlarida qoladi.

- `minio-init` **idempotent**: har `up` da policy'ni qayta yozadi, foydalanuvchi secret'ini
  `.env` dagiga tenglaydi, `govori-app` dan boshqa qo'lda biriktirilgan policy'larni ajratadi.
  Qayta ishga tushirish xato bermaydi.
- Secret'ni almashtirish: `.env` da o'zgartiring →
  `docker compose up -d --force-recreate minio-init api worker`.
- Integratsiya testlari `GOVORI_S3_*` env bo'lmasa `minioadmin` (root) bilan ulanadi — test
  runner'ga o'zgarish kerak emas.
- Prod'da `S3_APP_*` **majburiy** (`:?`), root'dan farq qilishi shart: `deploy/preflight.sh`,
  `minio-init` va API (`ProductionSecrets`) uchalasi rad etadi.
- `deploy/restore.sh --into-stack --minio …` MinIO volume'ini tiklagandan keyin `minio-init`
  ni qayta yuritadi: arxivda eski IAM holati (`.minio.sys`) bor, u ilova foydalanuvchisini
  o'z ichiga olmasligi yoki eski secret'ga ega bo'lishi mumkin.

## Dev'da bir bosishda kirish (`/login` dagi "Namunaviy hisoblar")

Development'da login sahifasida uchta seed hisob ro'yxati chiqadi — `student@govori.uz` ·
`teacher@govori.uz` · `admin@govori.uz` — va bittasini bosish OTP'siz kirgizadi. Sabab: bitta
telefon raqami bitta hisob, ya'ni uch rolni ketma-ket ko'rish uchun uch marta Telegram OTP kutish
kerak edi.

Bu **autentifikatsiyani chetlab o'tish**, shuning uchun u prodda *yashirilgan* emas, **mavjud
emas**. Uch mustaqil to'siq:

1. **Backend.** `GET/POST /api/auth/dev/{users,login}` faqat `environment.IsDevelopment()` bo'lganda
   `Map*` qilinadi (`Modules/Govori.Identity/DevLoginEndpoints.cs`). Prodda ular **404** —
   403 emas, chunki marshrut umuman ro'yxatdan o'tmagan. `IsProduction()` ni inkor qilish
   **ataylab** ishlatilmagan: `Staging`, nomsiz muhit va `Prod` kabi xato yozuv `!IsProduction()`
   dan o'tib ketadi. Endpoint faqat yuqoridagi uchta emailni qabul qiladi.
2. **Frontend.** Butun panel `import.meta.env.DEV` ichida, ya'ni prod build'da Rollup uni
   tashlab yuboradi. Matnlari ham `locales/*/common.json` da emas, alohida `locales/*/dev.json` da
   — `common.json` **butunligicha** to'plamga tushadi, komponent olib tashlangan bo'lsa ham.
   Tekshirish: `npm run build` dan keyin `grep -r "dev/users\|student@govori.uz" frontend/dist/`
   → **hech narsa**.
3. **Boot darvozasi.** `ProductionSecrets.HostProblems` mapping'ni boshqaradigan **ayni**
   predikatni (`DevLoginEndpoints.IsEnabled`) so'raydi va u Production'da "yoqilgan" desa,
   host **ishga tushmaydi**. Bugun bu o'lik kod — 1-qatlam buzilgan kun uchun qo'yilgan.

Endpointlar `ExcludeFromDescription()` qilingan, ya'ni `openapi.json` **o'zgarmaydi**: hujjat
prod yuzasini tasvirlaydi va ikkala muhitda bayt-ma-bayt bir xil qoladi.

> **Nega dev stack'ning frontend'i endi `NODE_ENV=development` bilan quriladi.** `import.meta.env.DEV`
> `NODE_ENV` ga bog'langan, `--mode` ga emas (`vite build` `--mode development` bilan ham
> NODE_ENV=production qo'yadi — o'lchandi). Ilgari `docker-compose.yml` **prod** to'plamini
> serverda ko'rsatardi, ya'ni har qanday dev asbob aynan o'zi kerak bo'lgan joyda yo'q edi.
> `frontend/Dockerfile` dagi `BUILD_NODE_ENV` ARG **sukut bo'yicha `production`** —
> `docker-compose.prod.yml` hech narsa uzatmaydi va qat'iy javobni oladi; dev compose esa
> `development` deb yozadi.

## Backup va monitoring (prod)

### Tungi backup endi audioni ham oladi

`deploy/prod-backup-cron.sh` (droplet'da root cron'idan, INSTALL.md 9.1) har kecha **ikki
mustaqil faza** bajaradi:

| Faza | Natija (`/var/backups/govori/`) | Tekshiruv |
|---|---|---|
| DB | `govori_<ts>.dump` + `.meta` | hajm ≥ `MIN_BYTES`, `pg_restore --list` TOC bo'sh emas, real foydalanuvchi > 0 |
| Audio | `govori_<ts>.audio/<bucket>/…` + `.backup-meta` | `mc ls` ro'yxati bilan solishtiriladi (≤1% farq), 0 baytli fayl yo'q |

- Audio avval `.audio-mirror/` ishchi nusxaga `mc mirror` qilinadi (faqat o'zgarganlar
  ko'chadi), keyin **hard-link snapshot** (`cp -al`) sifatida muzlatiladi — har tungi snapshot
  faqat o'sha kuni yangi bo'lgan fayllarcha joy oladi. Retention DB bilan bir xil:
  `KEEP_DAYS` (7), kamida bittasi doim qoladi.
- **Prod ma'lumotiga hech narsa yozilmaydi.** Kalit read-only, `mc mirror` faqat backup
  papkasiga yozadi. `--remove` faqat **ishchi nusxada** ishlaydi: audio — biometrik ma'lumot,
  90 kunlik saqlash siyosati bor (docs/02 §2.8), cheksiz saqlaydigan backup uni buzardi.
  O'chirilgan obyekt baribir `KEEP_DAYS` davomida oldingi snapshot'larda turadi. `mc` faylni
  vaqtinchalik nom bilan yozib rename qiladi, ya'ni qayta yozilgan obyekt eski snapshot'dagi
  baytlarga tegmaydi (test 7 buni tekshiradi).
- Bucket bo'sh ro'yxat qaytarsa-yu, oldingi backup'da fayl bo'lsa — **rad etadi** (bo'sh
  bucket'ni backup ustiga ko'chirmaydi).
- Bir faza yiqilsa ikkinchisi baribir ishlaydi (audio buzilsa ham DB dump chiqadi), lekin
  skript `exit 1` qiladi va alert yuboradi.
- `OFFSITE_DEST` berilsa audio ham u yerga **o'chirishsiz** sync qilinadi (`<dest>/audio/`).
  Offsite'dagi eski audioni tozalash — o'sha saqlash joyining lifecycle qoidasi (masalan S3
  lifecycle 90 kun); skript u yerda hech narsa o'chirmaydi.

### Yangi env o'zgaruvchilar

| O'zgaruvchi | Qayerda | Nima |
|---|---|---|
| `S3_BACKUP_ACCESS_KEY` / `S3_BACKUP_SECRET_KEY` | `.env` | Backup'ning **read-only** MinIO foydalanuvchisi (policy `govori-backup`: bucket'da faqat List + Get). `minio-init` yaratadi. Bo'sh bo'lsa backup app kalitiga qaytadi va har kecha WARN yozadi. Root va app juftligidan farq qilishi shart |
| `SENTRY_DSN` | `.env` (faqat `api`) | Sentry-mos xato hisoboti. **Bo'sh = o'chiq**: SDK umuman ulanmaydi, tarmoqqa hech narsa chiqmaydi |
| `BACKUP_ALERT_WEBHOOK_URL` | cron qatori | Har qanday muvaffaqiyatsizlikda (DB yoki audio) POST. Bo'sh bo'lsa logga baland WARN, backup baribir ishlaydi |
| `BACKUP_HEARTBEAT_URL` | cron qatori | Faqat **muvaffaqiyatli** yugurishdan keyin GET — dead-man's switch |
| `BACKUP_AUDIO` | cron (ixtiyoriy) | `0` audioni o'tkazib yuboradi (har kecha WARN). Sukut `1` |
| `MINIO_CONTAINER`, `GOVORI_ENV_FILE`, `MC_IMAGE` | cron (ixtiyoriy) | Sukut: compose label `com.docker.compose.service=minio` bo'yicha topiladi; `.env` — o'sha konteynerning compose ishchi papkasidan |

### Egasining qiladigan ishlari (bir martalik)

**1. Read-only backup foydalanuvchisi.**
```bash
# .env ga:
S3_BACKUP_ACCESS_KEY=govori-backup
S3_BACKUP_SECRET_KEY=$(openssl rand -base64 30)     # qiymatni yozing, buyruqni emas
docker compose -f docker-compose.prod.yml up -d --force-recreate minio-init
docker compose -f docker-compose.prod.yml logs minio-init | tail -3
#   → "backup user 'govori-backup' holds only policy govori-backup (read-only)"
```
Keyin cron'ni yangi skript bilan qayta o'rnating: `install -m 0755 deploy/prod-backup-cron.sh
/usr/local/bin/govori-backup` (INSTALL.md 9.1).

**2. Alert + heartbeat — yangi vendor hisobisiz ham ishlaydi.** Webhook umumiy: JSON body
`{"text": …, "content": …}` POST qilinadi, Telegram URL'i esa avtomatik form sifatida.

| Variant | `BACKUP_ALERT_WEBHOOK_URL` | `BACKUP_HEARTBEAT_URL` |
|---|---|---|
| **Telegram** (bor bot) | `https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>` | — |
| **healthchecks.io** (bepul) | `https://hc-ping.com/<uuid>/fail` | `https://hc-ping.com/<uuid>` |
| Slack / Discord / Mattermost | incoming webhook URL | — |

Tavsiya — ikkalasi birga: Telegram'ga darhol xabar **va** healthchecks.io'da check (Period
1 kun, Grace 2 soat). Faqat heartbeat "cron umuman ishlamay qoldi / droplet o'chdi"ni
ushlaydi — buni hech qanday skript o'zi xabar qila olmaydi. Telegram `chat_id`: botga
`/start` yozing, keyin `https://api.telegram.org/bot<TOKEN>/getUpdates` dagi `chat.id`.

URL'larni cron'ga qo'yish: `crontab -e` ning **eng tepasiga** alohida qatorlar (`NAME=value`,
qo'shtirnoqsiz) — cron buyruq ichidagi `%` ni yangi qator deb tushunadi:
```
BACKUP_ALERT_WEBHOOK_URL=https://hc-ping.com/<uuid>/fail
BACKUP_HEARTBEAT_URL=https://hc-ping.com/<uuid>
17 3 * * * OFFSITE_DEST=<boshqa-joy> /usr/local/bin/govori-backup >> /var/log/govori-backup.log 2>&1
```
Tekshirish: `BACKUP_ALERT_WEBHOOK_URL=… MIN_BYTES=999999999999 /usr/local/bin/govori-backup`
— DB fazasi ataylab yiqiladi va xabar kelishi kerak (eski backup'larga tegilmaydi).

**3. Uptime tekshiruvi (tashqi).** UptimeRobot / Better Stack / healthchecks.io'ning HTTP
monitori, har 5 daqiqa:

| URL | Nimani isbotlaydi |
|---|---|
| `https://govorim.uz/api/ping` → `{"status":"ok"}` (keyword `ok`) | nginx + TLS + api jonli. Autentifikatsiyasiz, bazaga tegmaydi — arzon |
| `https://govorim.uz/health/ready` → `Healthy` (keyword `Healthy`, aks holda 503 `Unhealthy`) | api Postgres, Redis va MinIO'ga yeta oladi — "api tirik, lekin so'rovga xizmat qila olmaydi" holatini faqat shu ushlaydi |
| `https://govorim.uz/healthz` | faqat nginx (api'ni tekshirmaydi) |

Tavsiya: uptime monitorni `/health/ready` ga qo'ying (1–5 daqiqada bir). Javobda faqat holat
so'zi bor — probe tafsiloti (connection string, vendor xatosi) loglarda qoladi.

**4. Sentry (ixtiyoriy).** sentry.io yoki self-hosted GlitchTip'da loyiha oching, DSN ni
`.env` ga `SENTRY_DSN=` qilib yozing, `docker compose -f docker-compose.prod.yml up -d api`.
Boot logida `Error reporting (SENTRY_DSN): on` chiqadi. Faqat **ishlov berilmagan request
exception**lari yuboriladi; request body, header'lar (Authorization, Cookie), query string
(SignalR `access_token`), foydalanuvchi (id/IP/email) va breadcrumb'lar **yuborilmaydi**,
exception matnidagi token/kalit/parol shakllari `[redacted]` qilinadi
(`Govori.Api/Startup/ErrorReporting.cs`, `ErrorReportingTests`). Worker'da Sentry yo'q.

### Audioni tiklash

```bash
SNAP=$(ls -td /var/backups/govori/govori_*.audio | head -1)
bash deploy/restore.sh --audio "$SNAP"                         # faqat tekshiradi, hech narsaga tegmaydi
bash deploy/restore.sh --audio "$SNAP" --into-stack --yes      # bucket'ga qaytaradi
bash deploy/restore.sh --dump <f>.dump --audio "$SNAP" --into-stack --yes   # DB + audio birga
```

- `--audio` **qo'shuvchi (additive)**: bucket'da yo'q obyektlar qaytariladi; bor obyekt
  o'chirilmaydi va **ustiga yozilmaydi** (`--remove` ham, `--overwrite` ham yo'q). Backup'dan
  keyin yozilgan yozuvlar saqlanib qoladi. Ikkala tomonda turlicha bo'lgan obyekt uchun `mc`
  "Overwrite not allowed" deb yozadi — bu kutilgan, jonli versiya qoladi.
- Faqat `--audio` berilsa api/worker to'xtatilmaydi va baza tushirilmaydi. Root kalit faqat
  `minio-init` konteyneri orqali ishlatiladi.
- Snapshot'dagi fayllar soni `.backup-meta` dagi `files=` ga teng bo'lmasa tiklash rad etiladi.
- Butun volume'ni **almashtirish** (IAM holati bilan) — eski yo'l: `--minio <minio.tgz>`
  (`deploy/backup-prod.sh` arxivi). `--minio` va `--audio` birga berilmaydi.
- Bucket boshqa joyga ko'chgan bo'lsa (masalan offsite'dan), papkani `<snapshot>/<bucket>/`
  ko'rinishiga keltiring — `.backup-meta` bo'lmasa ichidagi yagona papka bucket deb olinadi.

### Testlar

```bash
# Linux host'da to'g'ridan-to'g'ri:
bash deploy/test-backup-cron.sh
# Docker Desktop'da (Windows/Mac) — skript temp papkalarni qo'shni konteynerlarga mount qiladi,
# shuning uchun daemon bilan bir xil yo'lni ko'radigan Linux konteyner ichidan:
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp/govori-bt:/tmp/govori-bt -e TMPDIR=/tmp/govori-bt \
  -v "$PWD":/repo:ro -w /repo docker:27.5.1-cli \
  sh -c 'apk add -q bash coreutils findutils grep curl diffutils && bash deploy/test-backup-cron.sh'
```
47 ta tekshiruv: DB himoyalari (1–4), **haqiqiy prod `minio-init`** yaratgan read-only
foydalanuvchi yoza/o'chira olmasligi (5), to'liq backup + heartbeat (6), hard-link
snapshot'lar keyingi mirror'dan buzilmasligi (7), noto'g'ri kalit → alert + DB baribir
chiqadi (8), bo'shatilgan bucket rad etiladi (9), `restore.sh --audio` additive tiklash
(10), kam faylli snapshot rad etiladi (11), audio retention (12), kutilmagan buyruq xatosi fazani to'xtatadi (13). Hammasi scratch
project/volume/tarmoqda — dev stack'ga tegmaydi.

## Content-Security-Policy (faqat prod nginx)

Tokenlar `localStorage` da turadi, shuning uchun CSP — XSS bo'lgan kunda sessiyani o'g'irlatmaydigan
oxirgi devor. U **faqat** `deploy/nginx/govori-prod.conf.template` da: siyosat matni faylning
boshidagi `map $host $govori_csp { … }` da **bir marta** yozilgan, header esa server darajasida va
`add_header` ni qayta e'lon qiladigan har bir location'da (`/assets/`, SPA `/`) takrorlanadi —
nginx `add_header` ni merge qilmaydi (fayldagi "Security headers" izohi). Bucket location'ning
o'z `sandbox` CSP'si bor va unga ilova CSP'si **qo'shilmaydi**. Dev stack (`govori.conf`, :8081)
CSP yubormaydi.

- **Enforce ↔ report-only:** `.env` da `GOVORI_CSP_HEADER=Content-Security-Policy-Report-Only`,
  keyin `docker compose -f docker-compose.prod.yml up -d frontend`. Sukut bo'yicha
  `Content-Security-Policy` (enforce). Report-only'da brauzer faqat konsolga yozadi — report
  yig'uvchi endpoint yo'q, ya'ni bu faqat "bloklamaslik" rejimi, kuzatuv emas.
- **Yangi origin qo'shish:** uni faqat kerakli **bitta** direktivaga yozing (masalan audio uchun
  CDN → `media-src`), `default-src` ni kengaytirmang. `script-src` ga `'unsafe-inline'` /
  `'unsafe-eval'` hech qachon qo'shilmaydi: Vite build'ida inline skript yo'q, React
  `style={{…}}` CSSOM orqali ketadi va CSP'ga tegmaydi.
- **Tekshirish:** prod build'ni shu template bilan `govori-net` da ko'taring va sahifalarni headless
  Chromium'da oching — konsolda `Refused to …` / `securitypolicyviolation` **nol** bo'lishi kerak:

```bash
docker run -d --name govori-csp-test --network govori-net \
  -v "$PWD/deploy/nginx/govori-prod.conf.template":/etc/nginx/templates/default.conf.template:ro \
  -v "$PWD/certs-test":/etc/nginx/certs:ro -v "$PWD/frontend/dist":/usr/share/nginx/html:ro \
  -e NGINX_ENVSUBST_FILTER='^GOVORI_' -e GOVORI_SERVER_NAME=govori-csp-test \
  -e GOVORI_S3_BUCKET=govori-audio -e GOVORI_HSTS_MAX_AGE=0 \
  -e GOVORI_CSP_HEADER=Content-Security-Policy nginx:1.27-alpine
docker exec govori-csp-test nginx -t
```

`certs-test/` — bir martalik self-signed juftlik (`openssl req -x509 -nodes -newkey rsa:2048
-subj /CN=govori-csp-test -keyout privkey.pem -out fullchain.pem`). Dev'ning presigned audio
URL'lari `http://localhost:9000` ga qaraydi, shuning uchun bu sinovda ular cross-origin —
prodda esa `S3_PUBLIC_URL` = apex domen va CSP'da allaqachon bor.

Favicon / OG rasm / `robots.txt` / `manifest.webmanifest` — `frontend/public/` da; PNG/ICO
fayllar `frontend/public/favicon.svg` dan `frontend/scripts/render-brand-assets.mjs` bilan
yaratiladi (Playwright image ichida, buyruq skript boshida).

## Prod'da nima farq qiladi
- Real prod Postgres / S3 (MinIO emas) ulanadi; `S3_PUBLIC_URL` real domenga.
- Real AI kalitlari: `AZURE_SPEECH_KEY/REGION`, `GEMINI_API_KEY`, `OPENAI_API_KEY`
  (hozir STT/Grader fake/stub — kalit kelganda real provider ulanadi).
- TLS nginx'da terminatsiya qilinadi (deploy/nginx + sertifikatlar).
