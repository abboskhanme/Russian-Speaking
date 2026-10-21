# `deploy/` — what is in here and which one you want

Two documents, and they answer different questions. Open the wrong one and you
will do dozens of correct steps that solve a problem you do not have.

| You are… | Read |
| --- | --- |
| **building the server from nothing** — empty droplet, empty database, no users | **[`INSTALL.md`](INSTALL.md)** |
| operating it afterwards — backups, restores, renewals, a redeploy | this file, ["After the install"](#after-the-install) |
| adopting a database that **already has users in it** | [`CUTOVER.md`](CUTOVER.md) — historical; see the banner at its top |

> **Decision of 2026-08-23:** production data is **not** migrated. The server is
> built from zero. `INSTALL.md` is the live path; `CUTOVER.md` is kept because
> the knowledge in it was expensive and will be needed again the day an existing
> database has to be adopted — but it is not the path today.

---

## The install path

In order. Each is documented step by step in [`INSTALL.md`](INSTALL.md).

| Script | What it does | Safe to run any time? |
| --- | --- | --- |
| `preflight.sh` | asserts preconditions; detects **install** vs **live** and says which | yes — read-only, starts nothing |
| `migrate.sh --list` | what is applied, what is pending | yes — read-only |
| `migrate.sh` | applies pending EF migrations | deliberately, once per change |
| `bootstrap-admin.sh` | creates or promotes the **first admin** — the one account a clean database cannot make for itself | yes — idempotent, prints its plan and asks first |
| `bootstrap-admin.sh --list` | who is an admin | yes — read-only |
| `setup-domain.sh` | issues the TLS certificate and installs the renewal cron. **Brings the whole stack up** | once per domain |
| `smoke.sh` | is the running stack actually serving the product? | yes — read-only |

Two of them are worth a second look before you need them:

* **`preflight.sh` has two modes.** An empty data volume is the correct starting
  state on a clean host and a catastrophe on a serving one, so the same check
  cannot mean the same thing in both. The mode is detected from the Postgres
  volume, printed with its reason, and overridable with
  `PREFLIGHT_MODE=install|live`. When it cannot tell, it assumes `live` — the
  stricter one.
* **`bootstrap-admin.sh` creates no password.** Login is phone + a one-time code
  from the Telegram bot; `password_hash` is `NULL` for every account, including
  this one. So there is no bootstrap credential printed, stored, or left to
  rotate. See INSTALL.md step 6.

---

## After the install

These are not install steps. They are how the thing is operated once it is up,
and the first one is due the same evening.

### The nightly backup — set it up on day one

There is nothing worth protecting on the day of the install, and there is on the
day after.

```bash
install -m 0755 deploy/prod-backup-cron.sh /usr/local/bin/govori-backup
(crontab -l 2>/dev/null; echo '17 3 * * * OFFSITE_DEST=<somewhere-else> BACKUP_ALERT_WEBHOOK_URL=<alert-url> BACKUP_HEARTBEAT_URL=<heartbeat-url> /usr/local/bin/govori-backup >> /var/log/govori-backup.log 2>&1') | crontab -
```

Set `OFFSITE_DEST`. A backup that lives only on the machine it backs up shares
every failure mode with the thing it protects.

Set `BACKUP_ALERT_WEBHOOK_URL` and `BACKUP_HEARTBEAT_URL` too: the first is told
about every failed run (DB or audio), the second is pinged after every good one, so
a monitor notices when the cron stops running at all. If a URL contains `%` or `&`,
put it on its own line at the top of `crontab -e` instead (`NAME=value`, no quotes)
— cron treats `%` in the command as a newline. Which services work and how to set
them up: docs/09-DOCKER.md, "Backup va monitoring". The audio half also wants the
read-only `S3_BACKUP_ACCESS_KEY` / `S3_BACKUP_SECRET_KEY` in `.env` (env.prod.example).

### Prove a backup restores — monthly, thirty seconds

```bash
bash deploy/restore.sh --dump "$(ls -t /var/backups/govori/govori_*.dump | head -1)" \
  --audio "$(ls -td /var/backups/govori/govori_*.audio | head -1)"
```

It restores into a throwaway container, verifies it, and deletes it. It touches
nothing else. A dump nobody has restored is a hypothesis, and this is the only
thing that keeps the backups honest.

### The operations tools

| Script | What it does | Safe to run any time? |
| --- | --- | --- |
| `prod-backup-cron.sh` | the nightly backup: DB dump + audio snapshot → verify → publish → offsite → prune; alerts on failure | yes — runs from cron |
| `test-backup-cron.sh` | proves the nightly backup cannot destroy good backups | yes — local Docker only |
| `restore.sh --dump X` | proves a dump restores, in a scratch container | yes — touches nothing else |
| `restore.sh … --into-stack --yes` | **destructive** — rebuilds the live DB from a dump | no — this is the rollback |
| `rollback-db.sh` | schema-level undo, database only | no — needs `COMPOSE_FILE`, drops the database |
| `verify-backup.sh <dir>` | older, chattier inspector for a backup directory | yes |
| `backup-prod.sh` | pulls a full backup off a remote droplet over ssh | yes — read-only on the remote |
| `renew-cert.sh` | renews and deploys the certificate | yes — runs from cron |
| `ef-baseline.sh` | adopts an **already-populated** database into EF history | almost never — see below |
| `dev-refresh-fixture.sh` | refreshes the local dev fixture | local only |

### `ef-baseline.sh` — read this before you run it

It is **not** part of an install, and running it during one causes exactly the
damage it exists to prevent.

Its job is to tell EF Core "this schema already exists, mark the baseline
migration as applied without running it". That is right when adopting a database
that already has tables. On an **empty** database it writes a history row
claiming a schema that was never created — after which every real migration is
skipped as "already applied" and the first query fails on a missing table, with
the stack looking perfectly healthy.

`migrate.sh` inspects the database and tells you which of the two situations you
are in before it does anything. Believe it over any document, including this one.

It becomes the right tool again the day a populated database has to be brought
under EF's ownership — which is what [`CUTOVER.md`](CUTOVER.md) is kept for.

---

## If you write a script in here: one rule

**Never use the output of a `docker exec` without checking it.**

It does not fail loudly. It returns an empty value — and an empty value compared
against something else answers confidently and wrongly. Every check must be able
to tell **"I could not ask"** apart from **"the answer is no"**, and say which.

This is not a hypothetical. It was found four times in one evening, in scripts
that had all been read and reviewed:

* `docker exec web openssl …` — the web image is `nginx:1.27-alpine` and has no
  `openssl` binary. In `setup-domain.sh` the closing "nginx is serving: …" line
  printed `unknown` on every successful run, so the one check confirming the new
  certificate reached nginx confirmed nothing. In `renew-cert.sh` the empty
  result hit a `die`, turning every otherwise-successful renewal into a FATAL,
  twice a day, from cron. In `smoke.sh`'s first draft the exec's error text
  landed in *both* the issuer and the subject variable, they compared equal, and
  "subject == issuer means self-signed" reported a good Let's Encrypt
  certificate as self-signed.
* `preflight.sh` read the certificate with the **host's** `openssl` and never
  checked it was installed. Without it, every read is empty, the self-signed test
  is false, and the section reports *"issued by ?, not self-signed"* — a green
  PASS about a file it never opened. A missing check would have been better than
  that one: a missing check deceives nobody.
* `psql -U "$(docker exec … printenv POSTGRES_USER)"` — three unchecked execs
  nested inside a query. If one fails the query silently becomes
  `psql -U "" -d ""`, whose error `2>/dev/null` swallows, and the empty result
  reads as *"there is no schema"*. "I never reached the database" is then
  reported as "the database is empty", and the operator debugs the wrong machine.

So: resolve container values **once**, check them, and branch on the failure
explicitly. And before adding a `docker exec <image> <binary>`, confirm that
binary is actually in that image — `nginx:alpine` has no `openssl` and no `curl`
(use `wget`), `alpine` has only busybox, and `postgres:16-alpine` has the
Postgres client tools and little else.

---

## Other files here

| Path | What it is |
| --- | --- |
| `env.prod.example` | the annotated production `.env`, key by key, with why each one matters |
| `nginx/govori-prod.conf.template` | the production server block. Mounted as a **template** — the entrypoint runs `envsubst` over it so the MinIO proxy path stays in step with `S3_BUCKET` |
| `nginx/govori.conf` | the dev server block |
| `lib/compose-target.sh` | shared "which stack am I pointed at?" resolution for the scripts that can damage a live database. It refuses to guess when both compose files are present |
| `seed/` | **dev only.** Demo students and login accounts with a known password. `docker-compose.prod.yml` deliberately does not mount them; never put them on a production host |
