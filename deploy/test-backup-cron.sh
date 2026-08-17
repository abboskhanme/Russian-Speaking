#!/usr/bin/env bash
# Proves `prod-backup-cron.sh` refuses to destroy good backups when the dump is bad.
#
# The defect this guards against is not hypothetical: the cron it replaces created a
# ~20-byte "backup" whenever pg_dump failed, then deleted a genuine week-old one on
# the next line — every night, silently, until nothing real was left. A fix to that
# is worth exactly as much as the test that shows it holds, so this script builds a
# throwaway Postgres, feeds the backup script a database that CANNOT produce a valid
# dump, and asserts the old backups are still there afterwards.
#
# Runs entirely in local Docker. Production is never contacted.
#
# Usage: ./deploy/test-backup-cron.sh

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${HERE}/prod-backup-cron.sh"
CTR="govori-backup-test-$$"
WORK="$(mktemp -d)"

PASS=0
FAIL=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL + 1)); }

cleanup() { docker rm -f "$CTR" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> Booting a scratch Postgres 16 (${CTR})"
docker run -d --name "$CTR" \
  -e POSTGRES_PASSWORD=t -e POSTGRES_USER=t -e POSTGRES_DB=t \
  postgres:16-alpine >/dev/null
until docker exec "$CTR" pg_isready -U t -q 2>/dev/null; do sleep 1; done

psql_t() { docker exec -e PGPASSWORD=t "$CTR" psql -U t -d t -q -c "$1" >/dev/null; }

# A database big enough to clear the size floor, with real (non-demo) users, so the
# happy path is genuinely happy rather than passing by accident.
#
# The filler has to be INCOMPRESSIBLE. `repeat('x', 4000)` looks like a big row and
# is not one: pg_dump -Fc compresses it to nothing, the dump lands under the size
# floor, and the happy-path case fails for a reason that has nothing to do with the
# behaviour under test. Random hex is the cheap way to buy real bytes.
echo "==> Seeding a plausible database"
psql_t "CREATE EXTENSION IF NOT EXISTS pgcrypto"
psql_t "CREATE TABLE users (id serial primary key, email text, blob text)"
# gen_random_bytes is VOLATILE, so it is evaluated once PER ROW. That matters: an
# aggregate subquery here would be evaluated once for the whole INSERT, every row
# would carry identical bytes, and pg_dump would compress the lot back under the
# floor — making the happy-path case fail for a reason unrelated to what is tested.
# (gen_random_bytes caps at 1024 bytes per call, hence the concatenation.)
psql_t "INSERT INTO users (email, blob)
        SELECT 'user' || g || '@govorim.uz',
               encode(gen_random_bytes(1024), 'base64') || encode(gen_random_bytes(1024), 'base64') ||
               encode(gen_random_bytes(1024), 'base64') || encode(gen_random_bytes(1024), 'base64') ||
               encode(gen_random_bytes(1024), 'base64') || encode(gen_random_bytes(1024), 'base64') ||
               encode(gen_random_bytes(1024), 'base64') || encode(gen_random_bytes(1024), 'base64')
        FROM generate_series(1, 60) g"
psql_t "INSERT INTO users (email, blob)
        SELECT 'seed' || g || '@demo.uz', 'x' FROM generate_series(1, 30) g"

run_backup() {   # run_backup <backup-dir> [extra env assignments…]
  local dir="$1"; shift
  env DB_CONTAINER="$CTR" BACKUP_DIR="$dir" KEEP_DAYS=7 OFFSITE_DEST="" "$@" \
    bash "$SCRIPT" >"${WORK}/last.log" 2>&1
}

count_dumps() { find "$1" -maxdepth 1 -name 'govori_*.dump' -type f 2>/dev/null | wc -l | tr -d ' '; }

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "==> 1. Happy path: a real database produces a real, verified backup"
D1="${WORK}/case1"; mkdir -p "$D1"
if run_backup "$D1"; then
  [ "$(count_dumps "$D1")" = "1" ] && ok "published exactly one dump" || bad "expected 1 dump, got $(count_dumps "$D1")"
  DUMP="$(find "$D1" -name 'govori_*.dump' | head -1)"
  SZ="$(stat -f%z "$DUMP" 2>/dev/null || stat -c%s "$DUMP")"
  [ "$SZ" -ge 100000 ] && ok "dump is ${SZ} bytes, above the floor" || bad "dump is only ${SZ} bytes"
  grep -q 'real_users=60' "${DUMP}.meta" \
    && ok "meta counts 60 real users, excluding the 30 @demo.uz seeds" \
    || bad "meta reports $(grep real_users "${DUMP}.meta" 2>/dev/null || echo nothing) — the demo filter is wrong"
  find "$D1" -maxdepth 1 -name '.staging-*' | grep -q . \
    && bad "staging directory survived a successful run" \
    || ok "staging cleaned up"
else
  bad "the happy path exited non-zero"; sed 's/^/      /' "${WORK}/last.log"
fi

# ─────────────────────────────────────────────────────────────────────────────
# The real test. An old, GOOD backup is sitting in the directory and is old enough
# for the retention window to want it gone. The dump then fails. The old backup must
# survive: that is the whole difference between this script and the one it replaces.
echo
echo "==> 2. Failed dump must NOT delete the existing good backup"
D2="${WORK}/case2"; mkdir -p "$D2"
GOOD="${D2}/govori_20200101_000000Z.dump"
head -c 200000 /dev/urandom > "$GOOD"
printf 'bytes=200000\nreal_users=50\n' > "${GOOD}.meta"
touch -t 200001010000 "$GOOD"          # 20+ years old: far outside KEEP_DAYS=7

# Force the dump to be rejected by raising the size floor above any dump this
# database can produce. Same code path as a truncated pg_dump: the guard fires,
# the script dies, and retention is never reached.
if run_backup "$D2" MIN_BYTES=999999999; then
  bad "the script exited 0 on a dump it should have rejected"
else
  ok "rejected the undersized dump (exit non-zero)"
fi
[ -f "$GOOD" ] && ok "the 20-year-old good backup is STILL THERE" || bad "the good backup was deleted — this is the original bug"
[ "$(count_dumps "$D2")" = "1" ] && ok "no fake backup was published" || bad "a rejected dump reached the final name"
find "$D2" -maxdepth 1 -name '.staging-*' | grep -q . \
  && bad "a failed run left staging behind for a later run to mistake for a backup" \
  || ok "failed run left nothing behind"

# ─────────────────────────────────────────────────────────────────────────────
# A structurally perfect dump of a database with no real users is a perfect backup
# of nothing. The repo's own `backups/` folder is exactly that mistake.
echo
echo "==> 3. A dump with no real users is refused"
psql_t "UPDATE users SET email = 'x' || id || '@demo.uz'"
D3="${WORK}/case3"; mkdir -p "$D3"
touch "${D3}/govori_20200101_000000Z.dump"
if run_backup "$D3"; then
  bad "accepted a database whose only users are @demo.uz seeds"
else
  ok "refused a users-table containing nothing but seed accounts"
fi
psql_t "UPDATE users SET email = 'user' || id || '@govorim.uz' WHERE id <= 60"

# ─────────────────────────────────────────────────────────────────────────────
# Retention is allowed to prune — but only after everything above has passed, and
# never down to zero.
echo
echo "==> 4. Retention prunes old backups on a GOOD run, and never to zero"
D4="${WORK}/case4"; mkdir -p "$D4"
OLD="${D4}/govori_20200101_000000Z.dump"
: > "$OLD"; touch -t 200001010000 "$OLD"
if run_backup "$D4"; then
  [ -f "$OLD" ] && bad "the stale backup survived a fully verified run" || ok "pruned the stale backup"
  [ "$(count_dumps "$D4")" = "1" ] && ok "the fresh verified backup remains" || bad "retention emptied the directory"
else
  bad "case 4 run failed"; sed 's/^/      /' "${WORK}/last.log"
fi

echo
printf '==> %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
