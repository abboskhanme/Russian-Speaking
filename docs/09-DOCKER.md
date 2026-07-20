# 09 · Docker — .NET stack

Professional, self-contained Docker stack for the **.NET 9** rewrite. Independent of
the legacy Python `docker-compose.yml` / `.prod.yml` (own project name `govori-dotnet`,
own network + volumes).

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
| govori-db | postgres:16-alpine | localhost:5433 | Postgres 16 — birinchi ishga tushishda demo dump'dan **avtoseed** |
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

## Ma'lumot (schema) haqida — muhim

Backend **database-first**: EF Core sxemani **hech qachon yaratmaydi**. Shuning uchun:
- **Dev:** bo'sh `db` volume birinchi ishga tushganda `backups/russpeak_20260711_111407.sql.gz`
  demo dump'idan avtoseed bo'ladi (17 jadval + demo ma'lumot, Alembic head `c1d2e3f4a5b6`).
  Qayta boshlash: `down -v` → keyingi `up` yangidan seed qiladi.
- **Prod (cutover):** `db` servisini olib tashlab, `GOVORI_DB` / `ConnectionStrings__Govori`
  ni **mavjud prod bazaga** yo'naltiring (seed mount kerak emas). Hangfire o'zining
  `hangfire` sxemasini qo'shadi (additive — mavjud jadvallarga tegmaydi).

## Prod'da nima farq qiladi
- Real prod Postgres / S3 (MinIO emas) ulanadi; `S3_PUBLIC_URL` real domenga.
- Real AI kalitlari: `AZURE_SPEECH_KEY/REGION`, `GEMINI_API_KEY`, `OPENAI_API_KEY`
  (hozir STT/Grader fake/stub — kalit kelganda real provider ulanadi).
- TLS nginx'da terminatsiya qilinadi (deploy/nginx + sertifikatlar).
