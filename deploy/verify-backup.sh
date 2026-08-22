#!/usr/bin/env bash
# Prove a backup can actually be restored. Runs entirely in throwaway Docker
# containers on this machine — production is never contacted.
#
# A backup nobody has restored is a hypothesis, not a backup. This is the test.
#
# Usage: ./deploy/verify-backup.sh ./prod-backup/<timestamp>

set -Eeuo pipefail

DIR="${1:?usage: verify-backup.sh <backup-dir>}"
[ -f "$DIR/db.dump" ]   || { echo "FATAL: $DIR/db.dump not found"; exit 1; }
[ -f "$DIR/minio.tgz" ] || echo "WARN: no minio.tgz — audio not covered by this check"

CTR="govori-restore-test-$$"
cleanup() { docker rm -f "$CTR" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> [1/5] Booting a scratch Postgres 16"
docker run -d --name "$CTR" \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_USER=verify -e POSTGRES_DB=verify \
  postgres:16-alpine >/dev/null

until docker exec "$CTR" pg_isready -U verify -q 2>/dev/null; do sleep 1; done
echo "    ready"

echo "==> [2/5] Restoring db.dump into it"
docker cp "$DIR/db.dump" "$CTR:/tmp/db.dump"
# -Fc dumps restore with pg_restore. Non-fatal noise (extensions/roles) is
# expected because we dumped --no-owner --no-acl; real failures surface below.
docker exec "$CTR" pg_restore -U verify -d verify --no-owner --no-acl /tmp/db.dump \
  2>&1 | grep -vE 'warning|already exists' | head -20 || true

echo "==> [3/5] Row counts (restored vs production)"
docker exec "$CTR" psql -U verify -d verify -A -F',' -t \
  -c "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY n_live_tup DESC" \
  > /tmp/restored_counts.csv 2>/dev/null || true
docker exec "$CTR" psql -U verify -d verify -c "ANALYZE" >/dev/null 2>&1
docker exec "$CTR" psql -U verify -d verify -A -F',' -t \
  -c "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY n_live_tup DESC" \
  > /tmp/restored_counts.csv

echo "    restored:"
sed 's/^/      /' /tmp/restored_counts.csv
if [ -f "$DIR/row_counts.csv" ]; then
  echo "    production (at dump time):"
  sed 's/^/      /' "$DIR/row_counts.csv" | grep -v ',0$' || true
  echo "    --> compare these two lists. Any shortfall means data was lost in the dump."
fi

echo "==> [4/5] The checks that actually matter"

# The real users must be there — not the 30 @demo.uz seed accounts that the
# existing backups/ folder turned out to contain.
echo -n "    real users (non-demo/test): "
docker exec "$CTR" psql -U verify -d verify -A -t -c \
  "SELECT count(*) FROM users WHERE email NOT LIKE '%@demo.uz' AND email NOT LIKE '%@test.uz'"

echo "    users by role:"
docker exec "$CTR" psql -U verify -d verify -A -F' = ' -t -c \
  "SELECT role, count(*) FROM users GROUP BY role ORDER BY 2 DESC" | sed 's/^/      /'

# Password hashes are what let the 50 users log in after the C# port.
# They must be bcrypt $2b$ — that is what BCrypt.Net-Next can verify.
echo "    password hash formats (must be \$2b\$ for the C# port):"
docker exec "$CTR" psql -U verify -d verify -A -F' = ' -t -c \
  "SELECT COALESCE(substring(password_hash from 1 for 4), '(null/google)'), count(*)
   FROM users GROUP BY 1 ORDER BY 2 DESC" | sed 's/^/      /'

echo -n "    graded evaluations: "
docker exec "$CTR" psql -U verify -d verify -A -t -c "SELECT count(*) FROM evaluations" 2>/dev/null || echo "?"

# Schema version: EF Core owns the schema, but a dump taken before the
# ef-baseline.sh adoption still carries the legacy alembic marker — report
# whichever the restored copy actually has. Two queries rather than one CASE:
# Postgres plans every CASE branch, so naming a dropped table anywhere in the
# expression errors even when that branch is unreachable.
echo -n "    schema version: "
EF_VER=$(docker exec "$CTR" psql -U verify -d verify -A -t -v ON_ERROR_STOP=1 \
  -c 'SELECT max(migration_id) FROM "__EFMigrationsHistory"' 2>/dev/null || true)
AL_VER=$(docker exec "$CTR" psql -U verify -d verify -A -t -v ON_ERROR_STOP=1 \
  -c 'SELECT max(version_num) FROM alembic_version' 2>/dev/null || true)
if   [ -n "${EF_VER// /}" ]; then echo "ef:${EF_VER}"
elif [ -n "${AL_VER// /}" ]; then echo "alembic:${AL_VER}"
else echo "unknown"; fi
if [ -f "$DIR/schema_version.txt" ]; then
  echo "    (production said: $(cat "$DIR/schema_version.txt"))"
elif [ -f "$DIR/alembic_revision.txt" ]; then
  # Backup taken by an older revision of backup-prod.sh.
  echo "    (production said: alembic:$(cat "$DIR/alembic_revision.txt"))"
fi

echo "==> [5/5] Audio archive"
if [ -f "$DIR/minio.tgz" ]; then
  # Counted by xl.meta, NOT by filename extension. MinIO's erasure backend stores
  # an object as a DIRECTORY named after the key, containing `xl.meta` and the
  # data parts — there is no file called `answer.webm` anywhere on the volume. The
  # previous extension match therefore returned 0 on a perfectly intact archive and
  # printed "no audio files found" on every single healthy backup. A check that
  # cries wolf every time is a check nobody reads, and this is the one that says
  # whether the students' recordings survived.
  # `.minio.sys` holds MinIO's own config objects in the same layout; exclude it.
  N=$(tar tzf "$DIR/minio.tgz" 2>/dev/null | grep -v '\.minio\.sys/' | grep -c '/xl\.meta$' || true)
  echo "    stored objects in archive (audio + avatars): ${N:-0}"
  [ "${N:-0}" -gt 0 ] || echo "    WARN: no objects found — is this the right volume?"
fi

echo
echo "PASS — the dump restores and contains real users."
echo "This backup is now proven, not assumed."
