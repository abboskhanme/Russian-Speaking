# Cutover runbook — Python/Alembic stack → .NET stack

> **Status: the DATABASE half is rehearsed and green. The SERVER half is not, and
> cannot be until someone with prod access runs step 1.**
>
> Everything below marked ✅ was actually executed and verified locally against a
> production-SHAPED copy (real schema, 55 users, 770 answers, 768 evaluations).
> Everything marked ⛔ needs the droplet and has never been run.

Live target: `134.209.240.56` / `govorim.uz`. Roughly 50 real users whose data
exists in exactly one place.

---

## What was rehearsed, and what it proved

A copy was built to match the live database's assumed state — full schema and
data, `alembic_version` present, **no** `__EFMigrationsHistory`, and the four
post-baseline objects removed so the migrations had to genuinely apply:

| Step | Result |
| --- | --- |
| `ef-baseline.sh --dry-run` | ✅ guard passed (16 tables found), printed its SQL, changed nothing |
| `ef-baseline.sh` | ✅ adopted the populated DB into EF history; dropped `alembic_version`; **no application table touched** |
| `dotnet ef database update` | ✅ applied all 4 post-baseline migrations to a live-data schema |
| Data integrity | ✅ 55 users / 770 submissions / 768 evaluations / 9 groups / 45 questions — identical before and after |
| Safe defaults | ✅ all 55 users came out with `notifications_enabled = true`, i.e. nobody's behaviour changed |
| Full integration suite against the migrated copy | ✅ 51/51 |
| `rollback-db.sh` | ✅ restored the pre-cutover dump: data intact, EF history gone, `alembic_version` back, new columns gone |

**The caveat that matters:** the starting schema was *assumed*, not read off the
live server. If prod has drifted from what this repo believes, the first honest
signal will be `ef-baseline.sh`'s own guard refusing to run. Do not force past it.

---

## Sequence

### 1 ⛔ Backups first — blocking, read-only on prod
```bash
./deploy/backup-prod.sh          # pg_dump -Fc + MinIO volume + .env, pulled OFF the droplet
./deploy/verify-backup.sh        # restore into an empty Postgres, COUNT REAL USERS, check hash format
```
Do not proceed until `verify-backup.sh` prints `PASS`. A backup nobody has
restored is a hope, not a backup. Also take a DigitalOcean snapshot (one button,
covers the volumes the scripts do not) and copy the dump **off the droplet**.

### 2 ⛔ Read the real layout
`backup-prod.sh` already prints it into `manifest.txt`: container names, volume
names, compose directory, TLS expiry, existing backups. Every later step depends
on these, and none of them are guessed anywhere in this repo.

### 3 ⛔ Rehearse on the real dump
Restore the verified prod dump locally and re-run the table above against it. This
replaces the *assumed* starting schema with the real one — it is the step that
turns the rehearsal from "probably" into "yes".

### 4 ⛔ Cutover (~30 min, low-traffic window)
```bash
# a. stop the OLD stack's web+api (keep its DB up)
# b. final pg_dump -Fc  ← this is the file rollback-db.sh will use
# c. bash deploy/ef-baseline.sh --dry-run     # read it. then without --dry-run
# d. dotnet ef database update                # applies the 4 migrations
# e. bring up the .NET stack pointed at the same database
# f. smoke: login, a student's home, a teacher's Obzor, one recording end to end
```

### 5 ⛔ If anything is wrong
```bash
# stop api + worker FIRST — they reconnect mid-restore otherwise
./deploy/rollback-db.sh --dump <final-dump> --yes
# then start the OLD stack, not the new one
```

### 6 ⛔ After
Leave the old stack **stopped but present** for two weeks. Watch error rates for
48 hours. Only then start Faza 7 cleanup.

---

## Known gaps to decide BEFORE cutting over

- **No admin UI.** The admin backend has 12 endpoints and there is a finished
  design, but the app has zero `/admin` routes — an admin who signs in lands in the
  teacher panel. If administering the live product through a UI matters on day one,
  this is a blocker; if `psql` and the API are acceptable for a while, it is not.
- **Prod may not be running this repo's frontend at all** (see the project notes).
  Confirm what is actually deployed before assuming the cutover only swaps a
  backend.
- **`SECRET_KEY` continuity.** Tokens are HS256 signed with it. If the .NET stack
  starts with a different key, every logged-in user is silently logged out. Carry
  the existing value across, or accept a forced re-login and say so.
- **MinIO/audio.** The new stack mints presigned URLs against its own configured
  endpoint. It must point at the SAME bucket and be reachable under the public
  hostname, or audio and avatars 404 while the pages themselves look fine.
