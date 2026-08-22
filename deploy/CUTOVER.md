# Cutover runbook — Python/Alembic stack → .NET stack

**Target:** `134.209.240.56` / `govorim.uz` · ~50 real users whose data exists in
exactly one place.

You are reading this because you are about to replace the backend of a live
product. Everything below is written to be **copy-pasted in order**, with a check
after each step and a way back from every one of them.

---

## Before you start — three rules

1. **Nothing in Part 1 causes downtime.** You can do it over several evenings.
   Only Part 3 touches the live site, and it is ~30 minutes.
2. **A step that fails is a step that stops.** Do not work around a guard. Every
   refusal in these scripts exists because the thing it refuses to do is worse
   than stopping.
3. **You can always go back.** Part 4 is the rollback, and it is rehearsed. Read
   it before you need it, not while you need it.

If you get lost mid-window: **stop, run Part 4.1, start the old stack.** A
postponed cutover costs an evening. A half-finished one costs the data.

---

## Part 0 — What is actually changing

| | Before | After |
| --- | --- | --- |
| Backend | Python/FastAPI + Celery | .NET 9 (`api` + `worker`) |
| Schema owner | Alembic | EF Core |
| Database | Postgres 16 — **the same volume, the same rows** | unchanged |
| Audio | MinIO — **the same volume** | unchanged |
| Compose file | `docker-compose.prod.yml` (old) | `docker-compose.prod.yml` (this repo) |

The database and the audio are **not migrated, copied or converted**. The new
stack starts against the volumes the old stack was already using. That is why
the volume names matter more than anything else in this document.

---

# Part 1 — Days before (no downtime, nothing changes)

## 1.1 Get a backup, and prove it restores

```bash
cd ~/Russian-Speaking            # wherever this repo is checked out locally
./deploy/backup-prod.sh
```

Expect a new `prod-backup/<UTC timestamp>/` containing `db.dump`, `minio.tgz`,
`env.txt`, `manifest.txt`, `row_counts.csv`, and a printed row-count table.

**Now prove the dump is real.** A backup nobody has restored is a hypothesis:

```bash
./deploy/restore.sh \
  --dump  prod-backup/<ts>/db.dump \
  --minio prod-backup/<ts>/minio.tgz \
  --compare-to prod-backup/<ts>/row_counts.csv
```

This restores into a throwaway container and deletes it. It touches nothing else.

Expected ending:

```
VERIFIED  db.dump — NN tables, NN real users, schema alembic:xxxx, NNN stored objects
This backup is proven, not assumed.
```

**STOP if:** it says `FATAL`, or `real users` is 0, or any table is reported
`MISSING`. `DIFF` lines are usually fine — `row_counts.csv` holds planner
estimates, and the live database kept taking writes between the dump and the
count. `MISSING` never is.

Also take a **DigitalOcean snapshot** (one button, in the droplet's panel). It
covers things these scripts do not, and it is the only rollback that survives a
mistake made *by* these scripts.

## 1.2 Read the real layout

```bash
cat prod-backup/<ts>/manifest.txt
```

Write down, from the `--- volumes ---` and `--- containers ---` sections:

* the **Postgres data volume name** → goes in `.env` as `PG_VOLUME`
* the **MinIO data volume name** → goes in `.env` as `MINIO_VOLUME`
* the **compose directory** on the droplet
* free disk (`--- disk ---`) and RAM (`--- memory ---`)

Nothing in this repo guesses these. Everything later depends on them.

## 1.3 The one migration real data can refuse

`AddUsersPhoneUniqueIndex` creates a UNIQUE index on `users.phone`. Nothing
enforced that before, so duplicates may exist — and if they do, `database update`
stops dead, mid-window.

Run this against the **restored copy** (or the live database; it is read-only):

```sql
SELECT phone, count(*), array_agg(id ORDER BY created_at) AS ids
FROM users WHERE phone IS NOT NULL
GROUP BY phone HAVING count(*) > 1;
```

* **Zero rows** → nothing to do, continue.
* **Any rows** → login resolves the *oldest* match, so the newer rows are
  accounts nobody has been able to reach by phone. Decide per row (merge, clear
  the phone, or deactivate) and apply it to the **live database before the
  window**, not during it.

## 1.4 Rehearse the migration on the real dump

Restore the verified dump locally, then run the real sequence against it:

Bring up a **local** stack pointed at a copy of the real data, then run the exact
sequence the window will run:

```bash
# 1. put the real dump into a local stack (NOT the droplet)
COMPOSE_FILE=docker-compose.yml bash deploy/restore.sh \
  --dump prod-backup/<ts>/db.dump --into-stack --yes

# 2. count what you have BEFORE
docker compose exec -T db psql -U russpeak -d russpeak -c \
  "SELECT 'users' t, count(*) FROM users
   UNION ALL SELECT 'submissions', count(*) FROM submissions
   UNION ALL SELECT 'evaluations', count(*) FROM evaluations;"

# 3. the real sequence
COMPOSE_FILE=docker-compose.yml COMPOSE_DB_SERVICE=db bash deploy/ef-baseline.sh --dry-run
COMPOSE_FILE=docker-compose.yml COMPOSE_DB_SERVICE=db bash deploy/ef-baseline.sh
COMPOSE_FILE=docker-compose.yml bash deploy/migrate.sh

# 4. count again — and diff it against step 2
```

The three counts must be **identical** before and after. `ef-baseline.sh` writes
one bookkeeping row and drops `alembic_version`; `migrate.sh` applies migrations
that add columns and indexes. Neither should move a single row.

This step replaces an *assumed* starting schema with the real one. It is what
turns "probably" into "yes" — and it is the only place you will find out, at zero
cost, that something in prod has drifted from what this repo believes.

## 1.5 Fill in the production `.env`

On the droplet, in the checkout of this repo:

```bash
cp deploy/env.prod.example .env
chmod 600 .env
$EDITOR .env
```

Copy the values marked REQUIRED out of `prod-backup/<ts>/env.txt` (the old
stack's `.env`). Two lines decide whether the cutover is invisible or not:

* **`SECRET_KEY`** — carry it across **verbatim**. Access tokens are HS256-signed
  with it. A different value silently signs out all ~50 users, with no error
  anywhere.
* **`PG_VOLUME` / `MINIO_VOLUME`** — the names from the manifest. These are
  declared `external: true`, so a wrong name means "volume not found" and nothing
  starts. That is the safe failure; the unsafe one is a stack that boots on a
  blank database and looks perfectly healthy.

Also set `IMAGE_TAG` to the commit you are deploying:

```bash
git rev-parse --short HEAD          # put this value in .env as IMAGE_TAG
```

## 1.6 Preflight

```bash
bash deploy/preflight.sh
```

It writes nothing and starts nothing. Expected ending:

```
==> NN passed, N warnings, 0 failed

PREFLIGHT PASSED — read the N warning(s) above, then open the window.
```

**Do not continue while it says FAILED.** Each failure is a problem that would
otherwise surface at 02:00 with the old stack already down.

Warnings you should expect right now: ports 80/443 busy (that is the old stack),
the certificate being self-signed or absent, and no renewal cron yet.

## 1.7 Build the images — *before* the window

This is the slow part (~10 min on a cold droplet) and there is no reason for it
to be inside the window.

```bash
docker compose -f docker-compose.prod.yml build
docker images | grep govori
```

Expect three images tagged with your `IMAGE_TAG`: `govori/api`, `govori/worker`,
`govori/web`.

If the build fails on disk space:

```bash
docker image prune -f && docker builder prune -f
```

Never `docker system prune -a --volumes` — it deletes the data volumes.

---

# Part 2 — TLS (can be done before the window)

Only if HTTPS is not already set up, or the certificate is the self-signed
placeholder. Requires DNS A-records for `govorim.uz` **and** `www.govorim.uz`
pointing at the droplet.

```bash
STAGING=1 bash deploy/setup-domain.sh     # dry run: untrusted test cert, no rate limit
bash deploy/setup-domain.sh               # the real one
```

Run the staging one first. Let's Encrypt allows five failed authorisations per
hostname per hour, and un-propagated DNS can lock you out for an hour.

The script self-tests the ACME webroot before calling Let's Encrypt, installs the
renewal cron itself, and ends by printing what nginx is *actually* serving:

```
    nginx is serving: issuer=C = US, O = Let's Encrypt, CN = R11
    valid until:      <date ~90 days out>
```

Check the renewal is installed — without it HTTPS dies in ~90 days with no
warning:

```bash
crontab -l | grep renew-cert
```

Test the whole renewal path now rather than discovering it in 60 days:

```bash
bash deploy/renew-cert.sh
```

Expect `certificate unchanged — nothing to deploy` and a line reporting the
days remaining.

---

# Part 3 — The window (~30 minutes, low traffic)

Have a second terminal open with the rollback (Part 4) already on screen.

### 3.1 Final preflight

```bash
bash deploy/preflight.sh
```

Must say **PREFLIGHT PASSED**. If it does not, close the window; nothing has
changed yet.

### 3.2 Stop the OLD stack's web and api — keep its database up

From the **old** stack's compose directory (from the manifest):

```bash
cd <old compose dir>
docker compose -f docker-compose.prod.yml stop web backend worker
docker compose -f docker-compose.prod.yml ps
```

Check: `db`, `redis`, `minio` still `Up`; `web`/`backend`/`worker` `Exited`.
The site is now down. This is the start of the outage.

### 3.3 The final dump — this is the file rollback uses

```bash
DB_CTR=$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1)
docker exec -e PGPASSWORD="$(docker exec $DB_CTR printenv POSTGRES_PASSWORD)" $DB_CTR \
  pg_dump -U "$(docker exec $DB_CTR printenv POSTGRES_USER)" \
          -d "$(docker exec $DB_CTR printenv POSTGRES_DB)" \
          -Fc --no-owner --no-acl > ~/cutover-final.dump
ls -lh ~/cutover-final.dump
```

Then **prove it before relying on it** (~30 s):

```bash
cd ~/Russian-Speaking
bash deploy/restore.sh --dump ~/cutover-final.dump
```

Must end in `VERIFIED … NN real users`.

**STOP if it does not.** Restart the old stack (`docker compose -f
docker-compose.prod.yml start web backend worker`) and try again another night.
Without this file you have no rollback.

### 3.4 Stop the old database

```bash
cd <old compose dir>
docker compose -f docker-compose.prod.yml down          # NO -v. Never -v.
docker volume ls | grep -E 'pg|postgres|minio'
```

Check: the volumes from the manifest are **still listed**. `down -v` would delete
them; that is why the flag is never used here.

### 3.5 Start ONLY the database, and check you are on the right volume

```bash
cd ~/Russian-Speaking
docker compose -f docker-compose.prod.yml up -d db

# Reads the credentials out of the running container, so it works whatever
# your .env says and needs nothing exported into your shell.
DB=$(docker compose -f docker-compose.prod.yml ps -q db)
docker exec -e PGPASSWORD="$(docker exec $DB printenv POSTGRES_PASSWORD)" $DB \
  psql -U "$(docker exec $DB printenv POSTGRES_USER)" \
       -d "$(docker exec $DB printenv POSTGRES_DB)" \
       -c "SELECT count(*) AS users FROM users;"
```

**The count must be the real one (~50).**

**STOP if it is 0 or the table does not exist.** That means the stack is on the
wrong (or an empty) volume. Do not start the api — it would create a schema and
the stack would come up perfectly healthy with everyone's data missing. Fix
`PG_VOLUME` in `.env` against the manifest, `docker compose -f
docker-compose.prod.yml down`, and repeat this step.

### 3.6 Adopt the database into EF Core

```bash
# Both compose files live in this directory, so the script will REFUSE to run
# until you say which stack you mean. That refusal is the point — it drops
# alembic_version, and doing that to the wrong database is not recoverable by
# re-running anything.
export COMPOSE_FILE=docker-compose.prod.yml

COMPOSE_DB_SERVICE=db bash deploy/ef-baseline.sh --dry-run   # read the SQL it prints
COMPOSE_DB_SERVICE=db bash deploy/ef-baseline.sh             # apply
```

It prints the compose file and the database it resolved before doing anything —
read those two lines. The database name comes from the RUNNING container, so it
is right whatever the old stack was configured with; set `PGDATABASE` / `PGUSER`
only if you deliberately want to override it.

It writes one bookkeeping row and drops `alembic_version`. It touches no
application table, and it refuses to run against a database that does not already
contain the expected tables. Re-running it is safe — it reports "already adopted".

**If it refuses with "found 0 of 16 application tables"**, it is not talking to
your database. Check `COMPOSE_FILE`, `PGDATABASE` and `PGUSER` above. Do not
force past this — the guard is the only thing standing between a wrong target and
a history row that lies about what the schema contains.

**After this point the old Python stack can no longer run**, because
`alembic_version` is gone. From here, rollback means Part 4.2, not Part 4.1.

### 3.7 Apply the post-baseline migrations

The application deliberately does not migrate itself, and the droplet has no .NET
SDK. This script runs the EF tooling in a container against the running stack:

```bash
bash deploy/migrate.sh --list       # read-only: what is applied, what is pending
bash deploy/migrate.sh              # apply
```

Expected ending:

```
MIGRATED  latest applied migration: 20260817113509_AddRoleplayTables
```

**If `--list` warns that there is no `__EFMigrationsHistory` table**, step 3.6 did
not take. Go back and run it — applying the baseline migration to an existing
schema will fail on the first `CREATE TABLE`.

**If a migration fails**, the most likely cause is duplicate `users.phone` rows
(step 1.3). The database is not corrupt — EF applies each migration in a
transaction. Fix the duplicates and re-run, or go to Part 4.2.

### 3.8 Start the new stack

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

Expect six services, all `(healthy)`, and `minio-init` `Exited (0)` — that one is
a one-shot bucket creation, not a crash.

**If `api` will not start**, read the logs first:

```bash
docker compose -f docker-compose.prod.yml logs api | head -40
```

A message beginning `Refusing to start: this host is configured for Production
but is using development or default secrets` lists exactly what is wrong in
`.env`. Fix and `up -d` again; nothing is damaged.

### 3.9 Smoke test — in this order

```bash
curl -fsS  http://localhost/healthz                     # nginx alive
curl -fsSk https://localhost/api/ping                    # {"status":"ok"}
curl -fsSk https://localhost/api/auth/config             # must NOT say "otp_delivery":"dev"
curl -fsS  -o /dev/null -w '%{http_code}\n' http://govorim.uz/    # 301
curl -fsS  https://govorim.uz/ | head -c 200             # the SPA's index.html
```

`"otp_delivery":"dev"` means the Telegram values are missing and the fixed code
`000000` would log anyone in as any phone number. Treat it as a stop.

Then **in a browser**, and this is the part no script can do:

1. Log in as a real user — they should **not** be asked to log in again if they
   had a session (that is the `SECRET_KEY` check).
2. A student's home screen — their history and XP are there.
3. A teacher's Obzor.
4. **Play a graded answer's audio.** This is the MinIO check: if it 404s, the
   page still looks fine, so nothing else will tell you.
5. **Record and submit one answer end to end** and wait for it to be graded.
   That exercises the api, the worker, ffmpeg, the AI chain and SignalR at once.

### 3.10 Watch for ten minutes

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=50 api worker
```

Then leave it. You are done.

---

# Part 4 — Rollback

Two different failures, two different rollbacks. Pick by asking: **has the schema
changed?**

## 4.1 The app is wrong, the data is fine (fastest — ~2 min)

Symptoms: a page is broken, a feature misbehaves, the api crash-loops. The
database is intact.

Go back to the previous image without rebuilding — the old image is still on the
disk, which is why `IMAGE_TAG` is a commit sha and never `latest`:

```bash
cd ~/Russian-Speaking
IMAGE_TAG=<previous sha> docker compose -f docker-compose.prod.yml up -d api worker web
docker compose -f docker-compose.prod.yml ps
```

Or stop the new stack entirely and bring the old one back:

```bash
docker compose -f docker-compose.prod.yml down          # NO -v
cd <old compose dir> && docker compose -f docker-compose.prod.yml up -d
```

Note the old Python stack cannot read a database that has had the post-baseline
migrations applied cleanly in every case — if you have passed step 3.6, use 4.2.

## 4.2 The data or the schema is wrong (~5 min)

This is what `~/cutover-final.dump` from step 3.3 is for.

```bash
cd ~/Russian-Speaking
bash deploy/restore.sh --dump ~/cutover-final.dump --into-stack --yes
```

The script stops `api` and `worker` itself first — they hold pooled connections
and would otherwise both block the drop and write into the half-restored
database. It verifies the dump in a throwaway container **before** touching
anything, so an unreadable dump aborts with the live database untouched.

Expected ending:

```
RESTORED  NN users are back in <db>.
```

Then bring the **old** stack up, not the new one:

```bash
docker compose -f docker-compose.prod.yml down          # NO -v
cd <old compose dir> && docker compose -f docker-compose.prod.yml up -d
```

Check in a browser that a real user can log in, then go to bed.

## 4.3 The audio is wrong

```bash
bash deploy/restore.sh \
  --dump  ~/cutover-final.dump \
  --minio prod-backup/<ts>/minio.tgz \
  --into-stack --yes
```

The MinIO volume is wiped and re-extracted, not merged — extracting over a live
tree would leave objects the backup does not contain and a bucket matching
neither state.

## 4.4 Everything is wrong

Restore the DigitalOcean snapshot from 1.1. It is slower and loses anything
written since, but it needs nothing on the droplet to still be working.

---

# Part 5 — After

* **Leave the old stack stopped but present for two weeks.** Do not delete its
  images or volumes. `docker compose down` without `-v` is enough.
* **Watch error rates for 48 hours.**
* **Confirm the nightly backup runs against the NEW stack.** It discovers the
  Postgres container by name pattern, so it should just work — but check, the
  morning after:

  ```bash
  ls -lh /var/backups/govori/
  cat /var/backups/govori/govori_*.dump.meta | tail -5
  tail -30 /var/log/govori-backup.log
  ```

  If the cron is not installed yet:

  ```bash
  install -m 0755 deploy/prod-backup-cron.sh /usr/local/bin/govori-backup
  (crontab -l 2>/dev/null; echo '17 3 * * * /usr/local/bin/govori-backup >> /var/log/govori-backup.log 2>&1') | crontab -
  ```

  Set `OFFSITE_DEST` in that cron's environment. A backup that lives only on the
  machine it backs up shares every failure mode with the thing it protects.

* **Restore a backup once a month.** Thirty seconds, and it is the only thing
  that keeps the backups honest:

  ```bash
  bash deploy/restore.sh --dump "$(ls -t /var/backups/govori/govori_*.dump | head -1)"
  ```

* Only then start Faza 7 cleanup.

---

# Part 6 — Reference

## What must be in `.env` before the window

Names only — the full annotated list with the reasoning is `deploy/env.prod.example`.

**Required — compose refuses to render without these:**
`IMAGE_TAG` · `GOVORI_SERVER_NAME` · `POSTGRES_USER` · `POSTGRES_PASSWORD` ·
`POSTGRES_DB` · `MINIO_ROOT_USER` · `MINIO_ROOT_PASSWORD` · `S3_BUCKET` ·
`S3_PUBLIC_URL` · `SECRET_KEY`

**Required — the API refuses to *start* without these:**
`TELEGRAM_BOT_TOKEN` · `TELEGRAM_BOT_USERNAME` (their absence selects dev OTP
delivery, whose fixed code `000000` logs anyone in as any phone number)

**Must match the manifest, or you start on the wrong data:**
`PG_VOLUME` · `MINIO_VOLUME`

**Optional:** `GOOGLE_CLIENT_ID` (note: baked into the frontend bundle at BUILD
time — changing it needs `build web`, not a restart) · the AI keys · the Faza 6
flags · the memory limits.

## Known gaps to decide on before cutting over

These are not cutover bugs. Most are true of production **today** — they are
listed because the cutover is the moment someone reads this document, and
because after it, anything surprising will be blamed on the migration.

### Blocking-ish — decide before you go

* **Sign-up depends entirely on the Telegram bot. There is no fallback.**
  `GET /api/auth/config` returns `{"google":false,"otp_delivery":"telegram_bot"}`.
  If the bot token is revoked, the bot gets blocked, or access to the @BotFather
  account is lost, **nobody can register and nobody who is logged out can get back
  in.** One point of failure for all authentication. This is already the case in
  production — the cutover neither creates nor fixes it — but the owner should
  know it before choosing a window.

* **Google Sign-In is the only alternative channel, and turning it on is not a
  config change.** `GOOGLE_CLIENT_ID` is inlined into the frontend bundle at
  BUILD time (`VITE_GOOGLE_CLIENT_ID`). Setting it in `.env` and restarting does
  nothing: you must `docker compose -f docker-compose.prod.yml build web` and
  `up -d web`. That matters twice over, because it is the only way out of the
  point of failure above — and it takes a rebuild, not a restart, to reach.

* **Prod may not be running this repo's frontend at all.** Confirm what is
  actually deployed before assuming the cutover only swaps a backend.

### Documented behaviour, so nobody calls it a regression later

* **Sequence locking is a UI affordance, not a server rule.** A task the UI shows
  as `locked: true` still accepts `POST /api/submissions` — measured: **201**, and
  it grades normally. The **paywall does hold** (402), so there is no revenue
  exposure; a determined student can only skip ahead in the ordering. Write it
  down now, because after the cutover this will look like something the migration
  broke.

* **The realtime hub is server-only so far.** The backend serves
  `/hubs/attempts` and it is `[Authorize]`d (verified: 401 without a token), and
  the production nginx proxies the WebSocket upgrade correctly. But the frontend
  has **no SignalR client** — it polls `GET /api/submissions/{id}` instead. So the
  WebSocket path is real, tested and currently serving nobody. Do not "fix" or
  remove the proxy config: it is finished work waiting for its client. Do not
  test the hub from a browser and conclude realtime is broken.

### Operational

* **`S3_PUBLIC_URL` must be the public https origin** (`https://govorim.uz`), not
  the internal MinIO address. Presigned URLs are signed over the Host header, so
  a wrong value cannot be patched up afterwards — audio and avatars 404 while
  every page still renders normally.
* **The droplet builds the images itself.** Budget disk for the .NET SDK image,
  the BuildKit cache and two ~900 MB runtime images on top of the database.
* **`ef-baseline.sh` and `rollback-db.sh` now refuse to guess which stack they
  are pointed at.** With both compose files in the repo root they stop and ask for
  `COMPOSE_FILE`, rather than silently picking the dev one. Both print the compose
  file, the database and the user they resolved before they touch anything — read
  those lines; they are the last chance to notice you are aimed at the wrong stack.

## Command index

| Script | What it does | Safe to run any time? |
| --- | --- | --- |
| `deploy/preflight.sh` | asserts the cutover's preconditions | yes — read-only |
| `deploy/backup-prod.sh` | pulls a full backup off the droplet | yes — read-only on prod |
| `deploy/restore.sh --dump X` | proves a dump restores, in a scratch container | yes — touches nothing else |
| `deploy/restore.sh … --into-stack --yes` | **destructive** — rebuilds the live DB from a dump | no — this is the rollback |
| `deploy/verify-backup.sh <dir>` | older, chattier inspector for a backup directory | yes |
| `deploy/ef-baseline.sh` | adopts a populated DB into EF history | once, deliberately |
| `deploy/rollback-db.sh` | schema-level undo, database only | no — mid-window rollback (needs `COMPOSE_FILE`) |
| `deploy/setup-domain.sh` | issues the TLS cert and installs renewal | once per domain |
| `deploy/renew-cert.sh` | renews and deploys the cert | yes — runs from cron |
| `deploy/prod-backup-cron.sh` | the nightly backup | yes — runs from cron |
| `deploy/test-backup-cron.sh` | proves the nightly backup cannot destroy good backups | yes — local Docker only |
