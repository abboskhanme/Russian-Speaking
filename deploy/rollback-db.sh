#!/usr/bin/env bash
# =============================================================================
# CUTOVER ROLLBACK — restore a database from a pre-cutover pg_dump.
# =============================================================================
#
# This is the "undo" half of the cutover, and it is the reason the cutover is
# allowed to happen at all: a migration you cannot reverse is a bet, not a plan.
#
# It is DESTRUCTIVE by design — it drops the target database and rebuilds it from
# the dump — so it refuses to run without an explicit --yes, and it verifies the
# dump before touching anything.
#
# REHEARSED, not theoretical: this script is the scripted form of a drill that was
# run end to end on a production-SHAPED copy (real schema, 55 users, 770 answers):
#   prod-shaped copy → ef-baseline.sh → 4 migrations → restore this dump
# and the restored database came back byte-for-byte in the state that mattered —
# 55 users, 770 answers, no __EFMigrationsHistory, alembic_version present, and
# the post-baseline columns gone.
#
# USAGE
#   ./deploy/rollback-db.sh --dump prod-backup/<ts>/db.dump --yes
#
#   Target (defaults to the local docker stack):
#     COMPOSE_DB_SERVICE=db          run psql/pg_restore inside that container
#     PGDATABASE (default russpeak)  PGUSER (default russpeak)
#     PGHOST/PGPORT/PGPASSWORD       when connecting over TCP instead
#
# ORDER OF OPERATIONS ON A REAL ROLLBACK
#   1. STOP the application first (api + worker), or its connections will be
#      terminated mid-write and it will keep reconnecting into a half-dropped DB.
#   2. Run this.
#   3. Start the OLD stack, not the new one.
# =============================================================================
set -Eeuo pipefail

DUMP=""
CONFIRMED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP="${2:-}"; shift 2 ;;
    --yes)  CONFIRMED=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

DB="${PGDATABASE:-russpeak}"
USER="${PGUSER:-russpeak}"
SVC="${COMPOSE_DB_SERVICE:-}"

[[ -n "$DUMP" ]] || { echo "✗ --dump <file> is required" >&2; exit 2; }
[[ -f "$DUMP" ]] || { echo "✗ dump not found: $DUMP" >&2; exit 2; }

SIZE=$(wc -c < "$DUMP" | tr -d ' ')
# A truncated dump restores "successfully" into an almost-empty database, which is
# the worst possible outcome: it looks like it worked. Refuse anything implausible.
if (( SIZE < 10000 )); then
  echo "✗ dump is only ${SIZE} bytes — that is not a real backup. Refusing." >&2
  exit 1
fi

if [[ -n "$SVC" ]]; then
  psql_run()    { docker compose exec -T "$SVC" psql -U "$USER" "$@"; }
  restore_run() { docker compose exec -T "$SVC" pg_restore -U "$USER" -d "$DB" --no-owner; }
else
  psql_run()    { psql -U "$USER" "$@"; }
  restore_run() { pg_restore -U "$USER" -d "$DB" --no-owner; }
fi

echo "==> Target database : $DB"
echo "==> Dump            : $DUMP (${SIZE} bytes)"
echo "==> Current contents (about to be REPLACED):"
psql_run -d "$DB" -c "SELECT 'users' t, count(*) FROM users UNION ALL SELECT 'submissions', count(*) FROM submissions;" 2>/dev/null \
  || echo "    (could not read — the database may already be broken, which is fine here)"

if (( CONFIRMED == 0 )); then
  echo
  echo "✗ Refusing to continue without --yes."
  echo "  This DROPS the database '$DB' and rebuilds it from the dump."
  echo "  Stop the api + worker FIRST, or they will reconnect mid-restore."
  exit 1
fi

echo "==> Terminating other connections to $DB"
psql_run -d postgres -q -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();" >/dev/null

echo "==> Dropping and recreating $DB"
psql_run -d postgres -q -c "DROP DATABASE $DB;"
psql_run -d postgres -q -c "CREATE DATABASE $DB OWNER $USER;"

echo "==> Restoring"
restore_run < "$DUMP"

echo "==> Restored contents:"
psql_run -d "$DB" -c "
SELECT 'users' t, count(*)::text v FROM users
UNION ALL SELECT 'submissions', count(*)::text FROM submissions
UNION ALL SELECT 'EF history table', (SELECT count(*)::text FROM information_schema.tables WHERE table_name = '__EFMigrationsHistory')
UNION ALL SELECT 'alembic_version table', (SELECT count(*)::text FROM information_schema.tables WHERE table_name = 'alembic_version');"

echo "✓ Rollback complete. Start the OLD stack now — not the new one."
