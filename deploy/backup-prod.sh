#!/usr/bin/env bash
# Pull a COMPLETE, VERIFIED backup of production off the droplet.
#
# Read-only on the server: it runs pg_dump, tars the MinIO volume, and copies .env.
# Nothing on production is written, restarted, or deleted.
#
# Usage:  ./deploy/backup-prod.sh
# Output: ./prod-backup/<UTC timestamp>/{db.dump,minio.tgz,env.txt,manifest.txt}

set -Eeuo pipefail

HOST="${PROD_HOST:-root@134.209.240.56}"
TS="$(date -u +%Y%m%d_%H%M%SZ)"
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/prod-backup/${TS}"

mkdir -p "$OUT"
echo "==> Backing up ${HOST} into ${OUT}"

# ---------------------------------------------------------------------------
# 0. Discover the real project/volume/container names. Never assume.
# ---------------------------------------------------------------------------
echo "==> [0/5] Discovering stack layout"
ssh "$HOST" 'bash -s' <<'REMOTE' | tee "$OUT/manifest.txt"
  set -euo pipefail
  echo "--- host ---";        hostname; uptime | tr -s ' '
  echo "--- disk ---";        df -h / | tail -1
  echo "--- memory ---";      free -m | sed -n 2p
  echo "--- containers ---";  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
  echo "--- volumes ---";     docker volume ls --format '{{.Name}}'
  echo "--- compose dir ---"; ls -d ~/*/ 2>/dev/null || true
  echo "--- db container ---"
  docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1
  echo "--- existing backups on prod ---"
  find / -name 'russpeak_*.sql.gz' -type f 2>/dev/null | head -20 | while read -r f; do
    printf '%s\t%s bytes\n' "$f" "$(stat -c%s "$f" 2>/dev/null || echo ?)"
  done
  echo "--- tls expiry ---"
  find / -name fullchain.pem -path '*certs*' 2>/dev/null | head -1 | while read -r c; do
    openssl x509 -enddate -noout -in "$c" 2>/dev/null || true
  done
REMOTE

DB_CTR="$(ssh "$HOST" "docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1")"
[ -n "$DB_CTR" ] || { echo "FATAL: no postgres container found"; exit 1; }
echo "==> postgres container: ${DB_CTR}"

# ---------------------------------------------------------------------------
# 1. Postgres — custom format (-Fc): compressed, selective restore, parallelizable.
#    The current cron writes plain SQL that can only load into an empty DB.
# ---------------------------------------------------------------------------
echo "==> [1/5] pg_dump (custom format)"
ssh "$HOST" "docker exec -e PGPASSWORD=\"\$(docker exec ${DB_CTR} printenv POSTGRES_PASSWORD)\" ${DB_CTR} \
  pg_dump -U \"\$(docker exec ${DB_CTR} printenv POSTGRES_USER)\" \
          -d \"\$(docker exec ${DB_CTR} printenv POSTGRES_DB)\" \
          -Fc --no-owner --no-acl" > "$OUT/db.dump"

# Fail loudly on a truncated dump — this is exactly the bug in the current cron.
DB_SIZE=$(stat -f%z "$OUT/db.dump" 2>/dev/null || stat -c%s "$OUT/db.dump")
[ "$DB_SIZE" -gt 10000 ] || { echo "FATAL: db.dump is only ${DB_SIZE} bytes — dump failed"; exit 1; }
echo "    db.dump = ${DB_SIZE} bytes"

# ---------------------------------------------------------------------------
# 2. MinIO — every student recording. pg_dump does NOT cover this.
# ---------------------------------------------------------------------------
echo "==> [2/5] MinIO volume (all audio)"
MINIO_VOL="$(ssh "$HOST" "docker volume ls --format '{{.Name}}' | grep minio | head -1")"
[ -n "$MINIO_VOL" ] || { echo "FATAL: no minio volume found"; exit 1; }
echo "    volume: ${MINIO_VOL}"
ssh "$HOST" "docker run --rm -v ${MINIO_VOL}:/data:ro alpine tar czf - -C /data ." > "$OUT/minio.tgz"

MINIO_SIZE=$(stat -f%z "$OUT/minio.tgz" 2>/dev/null || stat -c%s "$OUT/minio.tgz")
[ "$MINIO_SIZE" -gt 1000 ] || { echo "FATAL: minio.tgz is only ${MINIO_SIZE} bytes"; exit 1; }
echo "    minio.tgz = ${MINIO_SIZE} bytes"

# ---------------------------------------------------------------------------
# 3. .env — the only copy of every production secret. Losing SECRET_KEY logs
#    out every user; losing the AI keys means re-issuing all of them.
# ---------------------------------------------------------------------------
echo "==> [3/5] .env"
COMPOSE_DIR="$(ssh "$HOST" "dirname \$(find / -name docker-compose.prod.yml -not -path '*/node_modules/*' 2>/dev/null | head -1)")"
ssh "$HOST" "cat ${COMPOSE_DIR}/.env" > "$OUT/env.txt" 2>/dev/null || echo "WARN: .env not readable"
chmod 600 "$OUT/env.txt" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 4. Record the schema version — the contract any restore must match.
#
# EF Core owns the schema (see deploy/ef-baseline.sh). A database that has not
# been adopted yet still carries the old alembic_version marker, so read
# whichever exists and NEVER let a missing table abort the backup: this script
# runs `set -Eeuo pipefail`, and an unguarded SELECT against a dropped table
# would kill the run at step 4 of 5 — losing the row counts below and failing
# exactly when a migration is in flight and the backup matters most.
# ---------------------------------------------------------------------------
echo "==> [4/5] Schema version + row counts"
# Two separate queries with a shell fallback, NOT one CASE expression: Postgres
# parses every branch of a CASE at plan time, so naming a dropped table in an
# unreachable branch still errors with "relation does not exist".
ssh "$HOST" "
  run_sql() {
    docker exec -e PGPASSWORD=\"\$(docker exec ${DB_CTR} printenv POSTGRES_PASSWORD)\" ${DB_CTR} \
      psql -U \"\$(docker exec ${DB_CTR} printenv POSTGRES_USER)\" \
           -d \"\$(docker exec ${DB_CTR} printenv POSTGRES_DB)\" -A -t -v ON_ERROR_STOP=1 -c \"\$1\" 2>/dev/null
  }
  ef=\"\$(run_sql 'SELECT max(migration_id) FROM \\\"__EFMigrationsHistory\\\"')\"
  if [ -n \"\$ef\" ]; then
    echo \"ef:\$ef\"
  else
    al=\"\$(run_sql 'SELECT max(version_num) FROM alembic_version')\"
    if [ -n \"\$al\" ]; then echo \"alembic:\$al\"; else echo unknown; fi
  fi
" > "$OUT/schema_version.txt" || echo "unknown" > "$OUT/schema_version.txt"

# Row counts: the ground truth we verify every future migration against.
ssh "$HOST" "docker exec -e PGPASSWORD=\"\$(docker exec ${DB_CTR} printenv POSTGRES_PASSWORD)\" ${DB_CTR} \
  psql -U \"\$(docker exec ${DB_CTR} printenv POSTGRES_USER)\" \
       -d \"\$(docker exec ${DB_CTR} printenv POSTGRES_DB)\" -A -F',' -t \
       -c \"SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC\"" \
  > "$OUT/row_counts.csv"

echo "==> [5/5] Done."
echo
echo "    ${OUT}"
ls -lh "$OUT"
echo
echo "    Schema version: $(cat "$OUT/schema_version.txt")"
echo "    Row counts:"
sed 's/^/      /' "$OUT/row_counts.csv"
echo
echo "NEXT: verify the dump actually restores — a backup is a hypothesis until you do."
echo "      ./deploy/verify-backup.sh ${OUT}"
