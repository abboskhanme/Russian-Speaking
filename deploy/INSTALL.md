# Install — a clean Ubuntu droplet to a working `https://govorim.uz`

**This is the document to follow.** It builds Govori from nothing: an empty
server, an empty database, no users. Everything is created here.

> **Not migrating anything?** Correct — nothing is migrated. Decision of
> 2026-08-23: production data is **not** carried over, the server is built from
> zero. `deploy/CUTOVER.md` solves the *other* problem (adopting an existing
> populated database) and is not part of this path. If you find yourself running
> `ef-baseline.sh`, restoring a dump, or copying an old `SECRET_KEY`, you are in
> the wrong document.

Every step below is: **the command**, **what you should see**, **what can go
wrong**. Do them in order. The order is not decoration — step 7 starts the whole
stack, which is why the database has to exist by step 5.

---

## Three rules

1. **A step that fails is a step that stops.** Every refusal in these scripts
   exists because the thing it refuses to do is worse than stopping. Do not work
   around a guard; read what it says.
2. **Nothing here is timed.** There is no window, no outage, no users waiting.
   Take an evening. Take two.
3. **Take the snapshot in step 1.** It is the only rollback that survives a
   mistake made *by* these instructions, and it takes one click.

---

## Step 0 — What you need before you touch the server

Collect these first. Three of them require an account somewhere else, and
discovering that halfway through step 2 is how an evening gets lost.

| What | Where it comes from | Needed by |
| --- | --- | --- |
| A DigitalOcean droplet | Ubuntu 24.04 LTS, **2 GB RAM minimum**, 40+ GB disk | step 1 |
| Root SSH access to it | your DO account | step 1 |
| Control of `govorim.uz` DNS | your registrar | step 3 |
| A Telegram bot token + username | [@BotFather](https://t.me/BotFather) → `/newbot` | step 2 |
| Your own phone number, on Telegram | you | step 6 |
| At least one AI key | Anthropic / Gemini / OpenAI / Azure console | step 2 |
| An email address for Let's Encrypt | you (expiry warnings go here) | step 7 |

**About the bot.** It is not optional and it is not a nicety: sign-up and login
are phone + one-time code, and the bot is the only thing that delivers the code.
If the bot token is wrong, nobody can register and nobody who is logged out can
get back in. Create it before you start, message it once yourself, and keep the
token somewhere you will still have it next year.

**About the AI keys.** At least one grader backend must work or submissions are
accepted and never graded. They can also be added later from the admin panel
without a redeploy — but then step 8's last check cannot pass, so it is easier to
have one now.

---

## Step 1 — Prepare the droplet

SSH in as root.

```bash
apt-get update && apt-get -y upgrade
```

### 1.1 Docker and the compose plugin

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

Expect a Docker version and a **compose v2** version (`Docker Compose version
v2.x`). If `docker compose version` fails but `docker-compose --version` works,
you have the old standalone v1 — nothing in this repo supports it. Install the
plugin: `apt-get install -y docker-compose-plugin`.

### 1.2 Firewall — three ports, nothing else

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

Expect `22`, `80`, `443` and nothing else. This matters more than it looks: a DO
droplet has no firewall by default, and Docker publishes ports by writing
directly into iptables — a service that published 5432 would be an
internet-facing Postgres from the second it started. `docker-compose.prod.yml`
publishes only nginx's two ports for this reason; `ufw` is the second lock on the
same door.

### 1.3 Swap — do not skip this on a small droplet

```bash
free -m                      # if the Swap row says 0, do the rest
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -m
```

Expect a Swap total of ~2048 MB.

**Why:** step 4 builds the .NET images, which is by a wide margin the most
memory-hungry thing that will ever happen on this machine. Without swap the
kernel does not slow the build down — it kills a process, and it picks the
largest one. During the build that is the compiler; afterwards it is Postgres.
"The build failed for no reason" and "the database died overnight" are the same
missing 2 GB.

### 1.4 Disk

```bash
df -h /
```

Expect **at least 15 GB free**. `preflight.sh`'s hard floor is 8 GB — that is the
point below which the build cannot finish. 15 leaves room for the BuildKit cache
and for keeping the *previous* image tag on disk, which is what makes rolling back
a two-minute `up -d` instead of a rebuild. The build itself needs the .NET SDK
image (~1 GB) and produces two ~900 MB runtime images, on top of the database and
the audio.

### 1.5 The snapshot

In the DigitalOcean panel: **Droplet → Snapshots → Take Snapshot**. Do it now,
while the machine is empty and the snapshot is small and fast.

This is the only rollback in this document that survives a mistake made *by* this
document. Read the Rollback section before you need it.

---

## Step 2 — The repo and `.env`

### 2.1 Clone

```bash
cd ~
git clone <this repository> Russian-Speaking
cd ~/Russian-Speaking
git rev-parse --short HEAD          # note this — it goes in .env as IMAGE_TAG
```

Everything from here runs **from `~/Russian-Speaking`**. All the paths in this
document are relative to it.

### 2.2 Create the env file

```bash
cp deploy/env.prod.example .env
chmod 600 .env
nano .env
```

`chmod 600` is not ceremony: this file is the only copy of the token-signing key
and every AI key on the machine.

### 2.3 Fill it in

`deploy/env.prod.example` explains every key in place. This is the short version
of what you cannot leave blank, and where each value comes from.

**Compose refuses to render without these:**

| Key | Value |
| --- | --- |
| `IMAGE_TAG` | the commit sha from 2.1 — **never** `latest`; the tag *is* your rollback |
| `GOVORI_SERVER_NAME` | `govorim.uz` |
| `POSTGRES_USER` / `POSTGRES_DB` | your choice, e.g. `govori` / `govori`. Nothing is inherited — this database does not exist yet |
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` |
| `MINIO_ROOT_USER` | your choice, but **not** `minio`/`admin`/`root` — the API refuses to start on a stock credential |
| `MINIO_ROOT_PASSWORD` | `openssl rand -base64 24` |
| `S3_APP_ACCESS_KEY` | e.g. `govori-app` — the app's own MinIO user; **not** the same as `MINIO_ROOT_USER` |
| `S3_APP_SECRET_KEY` | `openssl rand -base64 30` (MinIO caps secrets at 40 chars; this is exactly 40) — **not** the root password |
| `S3_BUCKET` | e.g. `govori-audio` |
| `S3_PUBLIC_URL` | `https://govorim.uz` — **the origin the browser uses**, https, no trailing slash |
| `SECRET_KEY` | `openssl rand -base64 48` |

**The API refuses to start without these:**

| Key | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `TELEGRAM_BOT_USERNAME` | the bot's username, **without** the `@` |

**Volumes — leave the defaults unless you have a reason:**

```
PG_VOLUME=govori-pgdata
MINIO_VOLUME=govori-miniodata
```

Three values are worth understanding rather than pasting:

* **`SECRET_KEY`** signs every session token. Generate it once, and keep a copy
  off the machine. Changing it later does not produce an error anywhere — it
  silently signs out every logged-in user at once.
* **`S3_PUBLIC_URL`** is what presigned audio URLs are *signed for*, and the
  signature covers the host name. A wrong value cannot be patched up afterwards
  by nginx or by the browser: every recording and avatar 404s while every page
  still renders perfectly, so it looks like a broken feature rather than a typo.
* **`S3_APP_ACCESS_KEY` / `S3_APP_SECRET_KEY`** are the only storage credentials
  the api and worker ever receive. `minio-init` creates that user on every start
  with a policy allowing get/put/delete/list on `S3_BUCKET` and nothing else; the
  root pair stays inside the `minio` and `minio-init` containers. The access key
  id is printed into every presigned URL, which is exactly why it must not be the
  root's. To rotate the secret: change it in `.env`, then
  `docker compose -f docker-compose.prod.yml up -d --force-recreate minio-init api worker`.

Add at least one AI key (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`,
or the `AZURE_*` set). Leave everything else blank — blank is a supported state
for every remaining key, and `deploy/env.prod.example` says so line by line.

### 2.4 Check it

```bash
bash deploy/preflight.sh
```

Expect, near the top:

```
Mode: INSTALL (detected from the 'govori-pgdata' volume) — a clean host.
```

and at the bottom `PREFLIGHT PASSED`.

* **It says `Mode: LIVE`** → the Postgres volume already holds a database. That
  is not a clean install. Find out what is on this machine before continuing.
* **It says `PREFLIGHT FAILED`** → each failure names the fix. The common ones at
  this point are a missing key in `.env` and a volume that does not exist yet
  (step 5 creates those; re-running preflight afterwards is expected).
* **Warnings about TLS, the certificate and the backup are expected here** and
  say so. Install mode knows there is no certificate and no backup yet.

---

## Step 3 — DNS, before TLS

At your registrar, create two **A** records pointing at the droplet's IP:

```
govorim.uz.        A   <droplet IP>
www.govorim.uz.    A   <droplet IP>
```

Then wait, and verify from the droplet:

```bash
apt-get install -y dnsutils
dig +short govorim.uz
dig +short www.govorim.uz
curl -s ifconfig.me; echo
```

All three must print the **same** IP.

**Do not continue to step 7 until they do.** Let's Encrypt allows five failed
authorisations per hostname per hour. Asking for a certificate before DNS has
propagated does not just fail — it locks you out of retrying for an hour.
Propagation is usually minutes and occasionally hours; it costs nothing to wait
and an evening not to.

---

## Step 4 — Build the images

Two ways. Pick one.

### 4a. Build on the droplet (simple, slow, disk-hungry)

```bash
docker compose -f docker-compose.prod.yml build
docker images | grep govori
```

Expect three images tagged with your `IMAGE_TAG`: `govori/api`, `govori/worker`,
`govori/web`.

**Cost:** ~10–20 minutes on a cold 2 GB droplet, and it pulls the .NET SDK image
(~1 GB) plus the node build image, and fills the BuildKit cache. Budget ~6 GB of
disk that you will never see in `docker images`.

If it fails on disk space:

```bash
docker image prune -f && docker builder prune -f
```

**Never `docker system prune -a --volumes`.** That deletes data volumes.

If it is killed with no error, or `Killed` appears in the output: that is the
OOM killer, and it means step 1.3 was skipped. Add the swapfile and re-run.

### 4b. Build locally, copy the images over (faster, no SDK on the droplet)

On your own machine, in the repo:

```bash
IMAGE_TAG=$(git rev-parse --short HEAD)
IMAGE_TAG=$IMAGE_TAG docker compose -f docker-compose.prod.yml build
docker save govori/api:$IMAGE_TAG govori/worker:$IMAGE_TAG govori/web:$IMAGE_TAG \
  | gzip | ssh root@<droplet IP> 'gunzip | docker load'
```

**Cost:** ~2 GB over the wire, and your laptop must be building the *same commit*
that is checked out on the droplet — `IMAGE_TAG` is the only thing tying them
together, and a mismatch produces a stack running code nobody can identify later.
Verify on the droplet:

```bash
docker images | grep govori
```

The three tags must match `IMAGE_TAG` in `.env` exactly.

---

## Step 5 — The database, from nothing

### 5.1 Create the volumes

```bash
docker volume create govori-pgdata
docker volume create govori-miniodata
docker volume ls | grep govori
```

They are declared `external: true` in the compose file, which means compose will
**not** create them for you. That is deliberate: a compose-managed volume that
does not exist yet is silently created *empty*, so a typo in a volume name would
one day start the API against a blank database and the stack would come up
looking perfectly healthy with everyone's data missing. `external: true` turns
that into "volume not found" and nothing starts.

### 5.2 Start only Postgres

```bash
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml ps
```

Expect `db` and nothing else, reaching `(healthy)` within ~30 s.

### 5.3 Apply every migration

```bash
export COMPOSE_FILE=docker-compose.prod.yml
bash deploy/migrate.sh --list        # read-only: shows what is about to happen
```

Expect a header that says, in these words:

```
this database is EMPTY — no schema, no history. That is the correct
starting point for a fresh install, and every migration below will run
for real. Do NOT run deploy/ef-baseline.sh: it exists to adopt an
already-populated database, and here there is nothing to adopt.
```

followed by every migration marked `(Pending)`. Do not memorise the count — it
grows with the product; `--list` is the authority.

Then apply them:

```bash
bash deploy/migrate.sh
```

Expect `Applying migration '…'` once per migration and:

```
MIGRATED  latest applied migration: <the last one in the list>
```

> ### `ef-baseline.sh` IS NOT USED HERE
>
> `deploy/CUTOVER.md` requires it and this document does not. Both are correct,
> for opposite databases.
>
> `ef-baseline.sh` tells EF Core "this schema already exists, mark the baseline
> migration as applied without running it". That is right when you are adopting a
> database that already has tables in it. Here the database has **nothing** in
> it, so running `ef-baseline.sh` would write a history row claiming a schema
> that was never created. Every real migration would then be skipped as "already
> applied", and the first query would fail on a missing table — with the stack
> looking completely healthy.
>
> If you have already run it by mistake: stop, do not try to repair the history
> table. Delete the volume and start step 5 again — there is nothing in it worth
> keeping yet. That is the whole advantage of doing this before there are users.
>
> ```bash
> docker compose -f docker-compose.prod.yml down
> docker volume rm govori-pgdata
> docker volume create govori-pgdata
> ```

**What can go wrong**

* *"the db service is not running"* — 5.2 did not take. `docker compose -f
  docker-compose.prod.yml logs db`.
* *A migration fails* — nothing is half-applied; EF runs each migration in its
  own transaction. Read the error, fix it, re-run. On an empty database the
  honest recovery is always to drop the volume and start over.
* *`--list` warns the database is POPULATED* — you are not on an empty volume.
  Stop and find out which database you are pointed at before writing anything.

---

## Step 6 — The first admin

**This is the step a clean install cannot do for you, and the one that has no
obvious symptom when skipped.** The `users` table is empty. Self-service sign-up
creates *students* and only students — the role is hard-coded in the sign-up path.
So the admin panel exists, works, and is reachable by nobody.

```bash
export COMPOSE_FILE=docker-compose.prod.yml
bash deploy/bootstrap-admin.sh --phone '+998 90 123 45 67' --name "Ism Familiya"
```

Use **your own real number** — the one whose Telegram you can open. It is
normalised to `+998XXXXXXXXX` for you.

The script prints what it is about to do and waits:

```
==> Database  : 0 user(s), of which 0 admin(s)
==> Action    : CREATE A NEW ACCOUNT
    new row: role=admin, is_active=true, password_hash=NULL, email=+998901234567@govori.uz

Continue? type yes:
```

Read those lines, then type `yes`. Expect:

```
CREATED   +998901234567 is now an active admin (Ism Familiya).
```

### There is no password. That is the design, not an omission.

Login is phone + a one-time code delivered by your Telegram bot. `password_hash`
is `NULL` for this account, exactly as it is for every account the app creates
itself. So this step produces **no credential**: nothing secret is printed,
nothing is stored in a file, there is no bootstrap password to rotate afterwards,
and a copy of your terminal scrollback leaks nothing. You log in the same way
every other user does, with a code that arrives on *your* phone.

**How you actually log in, the first time:**

1. Open `https://govorim.uz/` (after step 7) and choose **Kirish**.
2. Enter your number.
3. Open the Telegram bot and share your contact if it asks. The code arrives
   there.
4. The admin panel is at `/admin`.

**Notes**

* **Safe to re-run.** Same number again → `UNCHANGED  … Nothing was written.`
* **It promotes, too.** If the number already has an account (yours, from testing
  the sign-up flow), it becomes an admin and keeps its name, XP and history.
* **Adding a second admin later** is the same command with a different number.
* **Check any time:** `bash deploy/bootstrap-admin.sh --list`.
* **Do not use the dev seeds.** `deploy/seed/` contains 40 demo students and
  three login accounts with a known password. They are mounted only by the dev
  compose file and must never reach this machine. `docker-compose.prod.yml` does
  not mount them, on purpose.

---

## Step 7 — TLS

DNS must already resolve (step 3). This script brings up the **whole stack** —
which is why the database had to exist first.

### 7.1 The dry run

```bash
STAGING=1 EMAIL=you@example.com bash deploy/setup-domain.sh
```

This asks Let's Encrypt's *staging* service for an untrusted test certificate. It
is not rate-limited, so it is the safe way to find out whether the challenge path
works. Expect it to end with a certificate issued by something containing
`STAGING` or `Fake`.

If it fails at *"Self-testing the ACME challenge path"*, the problem is on this
machine and Let's Encrypt was never contacted. If it fails at
*"Requesting certificate"*, the problem is DNS or the firewall — go back to
step 3, and check `ufw status` shows 80 open.

### 7.2 The real one

```bash
EMAIL=you@example.com bash deploy/setup-domain.sh
```

Expect it to end with:

```
    nginx is serving: issuer=C = US, O = Let's Encrypt, CN = R11
    valid until:      <a date ~90 days out>
==> Done. https://govorim.uz should now be live.
```

The script installs the renewal cron itself. Confirm:

```bash
crontab -l | grep renew-cert
```

Without that line HTTPS works for ~90 days and then stops, at once, with no
warning. Test the whole renewal path now rather than in 60 days:

```bash
bash deploy/renew-cert.sh
```

Expect `certificate unchanged — nothing to deploy` and a line reporting the days
remaining.

### 7.3 Raise HSTS after a day

`.env` ships `GOVORI_HSTS_MAX_AGE=300`. That is deliberate: five minutes means a
TLS mistake is recoverable. Once HTTPS has been stable for a day:

```bash
sed -i 's/^GOVORI_HSTS_MAX_AGE=.*/GOVORI_HSTS_MAX_AGE=31536000/' .env
docker compose -f docker-compose.prod.yml up -d web
```

`preload` is deliberately never sent — it is a one-way door.

---

## Step 8 — Start everything, and prove it works

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

Expect six services `(healthy)` and `minio-init` `Exited (0)` — that last one is
a one-shot (bucket + the app's MinIO user and policy), not a crash.

Then:

```bash
bash deploy/smoke.sh
```

It checks, and names each one: every container's health, `http://` redirecting to
`https://`, `/api/ping`, that `/api/auth/config` is **not** on dev OTP delivery,
that the SPA bundle actually shipped, that the realtime hub answers 401, the
certificate's issuer and expiry, the renewal cron, that the schema is applied,
that an admin exists, and that nginx can reach MinIO.

Expect `SMOKE PASSED`.

**The one failure to stop on immediately:** if `/api/auth/config` reports
`"otp_delivery":"dev"`, the fixed code `000000` logs anyone in as any phone
number. The API refuses to start in Production without the Telegram values, so
this can only happen if `GOVORI_ALLOW_INSECURE_PRODUCTION` is set. Unset it,
restart the api, and check again.

**If `api` will not start**, read the logs first:

```bash
docker compose -f docker-compose.prod.yml logs api | head -40
```

A message beginning `Refusing to start: this host is configured for Production
but is using development or default secrets` lists exactly what is wrong in
`.env`. Fix it and `up -d` again; nothing is damaged.

### Then, by hand — the part no script can do

In a browser, on a phone:

1. **Register a brand-new account** with a real number. The code must arrive in
   Telegram. If it does not, nobody can sign up, and no error appears anywhere.
2. **Log in as the admin** from step 6 and open `/admin`.
3. **Give the platform something to practise.** A fresh install has no content
   at all — no modules, no tasks — and nothing is seeded (owner's decision,
   2026-09-29). Until this step a student sees an empty catalog and there is
   nothing to submit in step 4.
   - **Kontent → Birinchi modulni yaratish** (later **+ Yaratish**), visibility **Rasmiy (barcha o'quvchilar)**, add
     at least one task, then **Nashr qilish**. Publishing the module publishes
     its tasks. Official modules are what every student sees, including one with
     no teacher; the first `FREE_TASKS_PER_MODULE` tasks of each are free.
   - **O'qituvchilar → O'qituvchi qo'shish** — phone + name. The teacher then
     signs in with that phone via the Telegram code; there is no password. If
     the phone already belongs to a student, the panel offers to promote them.
   - **Sozlamalar → Aloqa havolalari** — the Telegram support and channel links. They
     are empty on a fresh install, and the student's Help screen and account
     deletion ("write to the admin") point at them.
4. **Record and submit one answer, and wait for the grade.** This is the only
   check that exercises the api, the worker, ffmpeg, MinIO, the AI chain and the
   audio proxy at once. If it stays "processing":
   `docker compose -f docker-compose.prod.yml logs worker`.
5. **Play the graded answer's audio.** If it 404s, `S3_PUBLIC_URL` is wrong. The
   page still looks fine, so nothing else will tell you.

The install is not finished until 1, 3 and 4 have all been done by a human.

---

## Step 9 — After the install

### 9.1 The nightly backup — do this the same evening

There is no data worth protecting on day one, and there is on day two. This is
the promise that never gets kept unless it is kept now.

```bash
install -m 0755 deploy/prod-backup-cron.sh /usr/local/bin/govori-backup
(crontab -l 2>/dev/null; echo '17 3 * * * OFFSITE_DEST=<somewhere-else> /usr/local/bin/govori-backup >> /var/log/govori-backup.log 2>&1') | crontab -
crontab -l
```

Set `OFFSITE_DEST`. A backup that lives only on the machine it backs up shares
every failure mode with the thing it protects.

Check it the next morning:

```bash
ls -lh /var/backups/govori/
tail -30 /var/log/govori-backup.log
```

**Then prove one restores.** A dump nobody has restored is a hypothesis:

```bash
bash deploy/restore.sh --dump "$(ls -t /var/backups/govori/govori_*.dump | head -1)"
```

It restores into a throwaway container, verifies, and deletes it. Touches nothing
else. Do this once a month; it is thirty seconds and it is the only thing that
keeps the backups honest.

From this point on, `deploy/preflight.sh` will detect **LIVE** mode and start
holding you to live-stack standards — a populated volume and a recent backup.
That switch is the sign the install is over.

### 9.2 Log rotation

Already configured. Every service in `docker-compose.prod.yml` uses
`json-file` with `max-size: 10m, max-file: 3`, capping the whole stack at
~210 MB. Nothing to do.

### 9.3 Watch it

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=50 api worker
```

For the first 48 hours, look at this once a day. `docker stats` will tell you
whether the memory limits in `.env` suit the droplet you actually bought.

---

## Rollback — what is real and what is not

A fresh install has no previous state to return to. Say that plainly, because
the alternative is discovering it during an incident.

**There is no "restore from the dump".** Until step 9.1 has run at least once,
no dump exists. `deploy/restore.sh` and `deploy/rollback-db.sh` are real, tested
scripts — they are just not applicable yet, because they need a backup as input.
After step 9.1 they become the real rollback; before it they are nothing.

What actually works, in order of preference:

**1. Roll the image tag back** — if a previous version's images are on the disk.

```bash
IMAGE_TAG=<previous sha> docker compose -f docker-compose.prod.yml up -d api worker web
```

No rebuild, no network, ~2 minutes. This is why `IMAGE_TAG` is a commit sha and
never `latest`. On a first install there is no previous sha, so this option only
exists from the second deploy onwards.

**2. Redo the failed step.** This is the real rollback during an install, and it
is better than it sounds — every step here is idempotent or trivially repeatable:

| Failed at | Redo |
| --- | --- |
| `.env` (step 2) | edit and re-run `preflight.sh`. Nothing has started. |
| Build (step 4) | re-run. BuildKit resumes from its cache. |
| Migrations (step 5) | `down`, `docker volume rm govori-pgdata`, recreate, start over. Nothing is lost — there is nothing in it. |
| First admin (step 6) | re-run; it is idempotent. |
| TLS (step 7) | re-run with `STAGING=1` first. Watch the hourly rate limit. |
| Smoke (step 8) | fix what it names, `up -d`, re-run. |

**3. Restore the DigitalOcean snapshot from step 1.5.** Slower, and it loses
everything written since — which during an install is nothing. It is the only
option that needs nothing on the droplet to still be working, and the only one
that undoes a mistake made *by* these instructions.

**4. Rebuild the droplet.** Before there are users this is genuinely cheap:
destroy it, create a new one, start at step 1. It is sometimes the fastest
correct answer, and it stops being available the moment real people sign up —
which is the actual deadline this document is racing.

---

## Known gaps — decide on these, do not be surprised by them

Not install bugs. They are true of the product, and the install is the moment
someone reads this, so anything surprising later gets blamed on it.

* **All authentication depends on one Telegram bot.** `GET /api/auth/config`
  returns `{"google":false,"otp_delivery":"telegram_bot"}`. If the token is
  revoked, the bot gets blocked, or access to the @BotFather account is lost,
  **nobody can register and nobody who is logged out can get back in.** One point
  of failure for all sign-in.
* **Google Sign-In is the only alternative channel, and enabling it is a rebuild,
  not a restart.** `GOOGLE_CLIENT_ID` is inlined into the frontend bundle at
  build time. Setting it in `.env` and restarting does nothing; you must
  `docker compose -f docker-compose.prod.yml build web && … up -d web`. That
  matters twice over, because it is the only way out of the point of failure
  above.
* **Sequence locking is a UI affordance, not a server rule.** A task the UI shows
  as locked still accepts a submission and grades it. The paywall *does* hold, so
  there is no revenue exposure; a determined student can only skip ahead in the
  ordering.
* **The realtime hub is server-only so far.** `/hubs/attempts` is served and
  authorised, and nginx proxies the WebSocket upgrade correctly — but the
  frontend has no SignalR client yet and polls instead. Do not remove the proxy
  config; it is finished work waiting for its client.

---

## Command index

Everything you should need, and nothing that belongs to the other document.

| Script | What it does | Safe to run any time? |
| --- | --- | --- |
| `deploy/preflight.sh` | asserts preconditions; detects install vs live | yes — read-only |
| `deploy/migrate.sh --list` | what is applied, what is pending | yes — read-only |
| `deploy/migrate.sh` | applies pending EF migrations | deliberately |
| `deploy/bootstrap-admin.sh` | creates or promotes an admin account | yes — idempotent, and asks first |
| `deploy/bootstrap-admin.sh --list` | who is an admin | yes — read-only |
| `deploy/setup-domain.sh` | issues the TLS cert, installs the renewal | once per domain |
| `deploy/renew-cert.sh` | renews and deploys the cert | yes — runs from cron |
| `deploy/smoke.sh` | is the running stack actually serving? | yes — read-only |

Backup, restore and the adopt-an-existing-database tools are **not** part of an
install. They belong to operating the thing afterwards, and they are indexed in
[`deploy/README.md`](README.md).

---

## If you get stuck

```bash
docker compose -f docker-compose.prod.yml ps          # what is up
docker compose -f docker-compose.prod.yml logs api    # why the api will not start
docker compose -f docker-compose.prod.yml logs web    # why nginx will not start
bash deploy/preflight.sh                              # what is wrong with the config
bash deploy/smoke.sh                                  # what is wrong with the running stack
```

`preflight.sh` and `smoke.sh` between them name every failure this document can
produce, in the words you would need to fix it. Run them before reading logs.
