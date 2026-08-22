#!/usr/bin/env bash
# =============================================================================
# RESTORE — turn a backup back into a running Govori.
# =============================================================================
#
# A backup nobody has restored is a hypothesis. This script is how the hypothesis
# gets tested, and it is the same code path that runs on the day it is needed —
# deliberately, because a rehearsal that exercises different code proves nothing
# about the real thing.
#
# TWO MODES. The safe one is the DEFAULT:
#
#   --verify-only   (default)  Restore into a throwaway Postgres container, count
#                              what came back, and delete the container. Reads the
#                              backup, writes nothing anywhere else. Run this on a
#                              schedule; run it before you trust any dump.
#
#   --into-stack --yes         DESTRUCTIVE. Drop the live database and rebuild it
#                              from the dump, and optionally overwrite the MinIO
#                              volume. Verify-only runs FIRST and a failure aborts
#                              before anything is touched — you must never wipe a
#                              working database for a dump that turns out to be
#                              unreadable.
#
# WHICH SCRIPT DO I WANT?
#   deploy/restore.sh      disaster recovery: "the data is gone / wrong, put the
#                          backup back", including the audio in MinIO.
#   deploy/rollback-db.sh  cutover rollback: "the migration went badly, undo the
#                          schema change", database only, mid-window.
#   deploy/verify-backup.sh  the older, chattier read-only inspector for a
#                          backup-prod.sh directory. --verify-only supersedes it
#                          for a single dump file.
#
# USAGE
#   deploy/restore.sh --dump /var/backups/govori/govori_20260823_031700Z.dump
#   deploy/restore.sh --dump prod-backup/<ts>/db.dump --minio prod-backup/<ts>/minio.tgz
#   deploy/restore.sh --dump <f> --compare-to prod-backup/<ts>/row_counts.csv
#   deploy/restore.sh --dump <f> --minio <f> --into-stack --yes
#
# ENVIRONMENT
#   COMPOSE_FILE   compose file for --into-stack   (default docker-compose.prod.yml)
#   ENV_FILE       --env-file for that compose     (default: compose's own .env)
#   DB_SERVICE     postgres service name           (default db)
#   MINIO_SERVICE  minio service name              (default minio)
#   APP_SERVICES   stopped during a restore        (default "api worker")
#   PG_IMAGE       image used for the scratch DB   (default postgres:16-alpine)
#
# Exit 0 means the dump restored and contains real data. There is no partial pass.
# =============================================================================
set -Eeuo pipefail
shopt -s inherit_errexit 2>/dev/null || true

DUMP=""
MINIO_TGZ=""
COMPARE_TO=""
MODE="verify"
CONFIRMED=0

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
# On the droplet the prod values live in `.env` and compose picks them up on its
# own, so this stays empty there. It exists so the destructive path can be
# REHEARSED on a machine whose `.env` belongs to a different stack — a rollback
# script that can only be exercised against production is not a rollback script.
ENV_FILE="${ENV_FILE:-}"
DB_SERVICE="${DB_SERVICE:-db}"
MINIO_SERVICE="${MINIO_SERVICE:-minio}"
APP_SERVICES="${APP_SERVICES:-api worker}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"

log()  { printf '%s  %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die()  { printf '\n\033[31mFATAL\033[0m  %s\n' "$*" >&2; exit 1; }
ok()   { printf '  \033[32mOK\033[0m    %s\n' "$*"; }

# `set -e` on its own exits SILENTLY, which in a restore script is the worst
# possible manner of death: the operator sees a truncated log, a zero-length
# explanation and a non-zero code, at 2am, and cannot tell whether the backup is
# bad or the script is. Name the line.
trap 'rc=$?; printf "\n\033[31mABORTED\033[0m  %s failed at line %s (exit %s). Nothing further was attempted.\n" "$(basename "$0")" "$LINENO" "$rc" >&2' ERR

usage() { sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump)        DUMP="${2:?--dump needs a file}"; shift 2 ;;
    --minio)       MINIO_TGZ="${2:?--minio needs a file}"; shift 2 ;;
    --compare-to)  COMPARE_TO="${2:?--compare-to needs a file}"; shift 2 ;;
    --verify-only) MODE="verify"; shift ;;
    --into-stack)  MODE="stack"; shift ;;
    --yes)         CONFIRMED=1; shift ;;
    -h|--help)     usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

[[ -n "$DUMP" ]] || { echo "✗ --dump <file> is required" >&2; usage; }
[[ -f "$DUMP" ]] || die "dump not found: $DUMP"
DUMP="$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")"   # absolute, for docker cp
[[ -z "$MINIO_TGZ" || -f "$MINIO_TGZ" ]] || die "minio archive not found: $MINIO_TGZ"
[[ -z "$MINIO_TGZ" ]] || MINIO_TGZ="$(cd "$(dirname "$MINIO_TGZ")" && pwd)/$(basename "$MINIO_TGZ")"

SIZE="$(wc -c < "$DUMP" | tr -d ' ')"
# A truncated dump restores "successfully" into an almost-empty database, which is
# the worst outcome available: it looks like it worked.
(( SIZE >= 10000 )) || die "dump is only ${SIZE} bytes — that is not a backup"

# ─────────────────────────────────────────────────────────────────────────────
# Phase 1 — VERIFY. Always runs, in both modes.
#
# The scratch container is the point: it proves the archive is readable and full
# without asking the live database to take the risk. In --into-stack this is the
# gate, not a formality — it is what stops a drop-and-restore from running against
# a dump that pg_restore cannot parse.
# ─────────────────────────────────────────────────────────────────────────────
CTR="govori-restore-verify-$$"
SCRATCH_VOL=""
cleanup_verify() {
  docker rm -f "$CTR" >/dev/null 2>&1 || true
  [[ -n "$SCRATCH_VOL" ]] && docker volume rm -f "$SCRATCH_VOL" >/dev/null 2>&1 || true
}
trap cleanup_verify EXIT

echo
log "=== verify: ${DUMP} (${SIZE} bytes) ==="

log "booting a scratch Postgres (${PG_IMAGE})"
docker run -d --name "$CTR" \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_USER=verify -e POSTGRES_DB=verify \
  "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CTR" pg_isready -U verify -q 2>/dev/null && break
  sleep 1
done
docker exec "$CTR" pg_isready -U verify -q 2>/dev/null || die "the scratch Postgres never became ready"

log "pg_restore into the scratch database"
docker cp "$DUMP" "$CTR:/tmp/db.dump" >/dev/null
# --no-owner --no-acl: the dumps are taken that way, and role/extension noise is
# expected. Real failures are caught by the content checks below rather than by
# pg_restore's exit code, which is non-zero for warnings a restore survives.
docker exec "$CTR" pg_restore -U verify -d verify --no-owner --no-acl /tmp/db.dump \
  > /dev/null 2>/tmp/govori-restore-$$.err || true
RESTORE_ERRS="$(grep -cE '^pg_restore: error' "/tmp/govori-restore-$$.err" 2>/dev/null || true)"
rm -f "/tmp/govori-restore-$$.err"

# Query the scratch copy. It NEVER propagates failure: a missing table is an
# expected answer here ("this dump predates that migration"), not a crash, and
# under `set -e` an unguarded psql error would kill the script mid-report with no
# explanation. Empty output is the signal; every caller checks for it.
q() { docker exec "$CTR" psql -U verify -d verify -A -t -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null | tr -d '\r' || true; }

docker exec "$CTR" psql -U verify -d verify -q -c "ANALYZE" >/dev/null 2>&1 || true

TABLES="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" | tr -d '[:space:]')"
[[ "${TABLES:-0}" -gt 0 ]] || die "the restored database has no tables — the dump is empty or unreadable"
ok "${TABLES} tables restored (${RESTORE_ERRS:-0} pg_restore errors)"

# The check that is about THIS product rather than about Postgres: a dump with a
# perfect header and no real users is a perfect backup of nothing. Same demo/test
# filter as deploy/prod-backup-cron.sh, on purpose — one definition of "real".
USERS="$(q "SELECT count(*) FROM users WHERE email IS NULL OR (email NOT LIKE '%@demo.uz' AND email NOT LIKE '%@test.uz')" | tr -d '[:space:]')"
[[ -n "$USERS" && "$USERS" -gt 0 ]] || die "the restored database has ${USERS:-no} real users — this is not a usable backup"
ok "${USERS} real users (excluding @demo.uz / @test.uz)"

# Password hashes are the only reason those users can still log in. BCrypt.Net-Next
# verifies $2a$/$2b$/$2y$; anything else means the accounts are unreachable even
# though the rows are present, which a row count alone would call success.
#
# Aggregated inside SQL rather than with GROUP BY + shell paste: `GROUP BY 1` over
# an expression that already contains count(*) is not valid SQL, and the resulting
# error arrives as an empty string that reads exactly like "no users have a hash".
HASHES="$(q "SELECT string_agg(fmt || '=' || n, ' ' ORDER BY n DESC)
             FROM (SELECT COALESCE(substring(password_hash from 1 for 4), '(none)') AS fmt,
                          count(*) AS n
                   FROM users GROUP BY 1) s" || true)"
ok "password hash formats: ${HASHES:-unreadable}"

# EF Core owns the schema now, but a dump taken before deploy/ef-baseline.sh
# adopted the database still carries the legacy alembic marker. Report whichever
# is actually present — the answer tells you which cutover step this dump predates.
EF_VER="$(q 'SELECT max(migration_id) FROM "__EFMigrationsHistory"' | tr -d '[:space:]')"
AL_VER="$(q 'SELECT max(version_num) FROM alembic_version' | tr -d '[:space:]')"
if   [[ -n "$EF_VER" ]]; then SCHEMA="ef:${EF_VER}"
elif [[ -n "$AL_VER" ]]; then SCHEMA="alembic:${AL_VER}"
else                          SCHEMA="unknown"
fi
ok "schema version: ${SCHEMA}"

echo
log "row counts in the restored copy:"
docker exec "$CTR" psql -U verify -d verify -A -F',' -t \
  -c "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY n_live_tup DESC" \
  | sed 's/^/      /'

# Comparing against the counts recorded when the dump was taken is the only way to
# see a SHORTFALL. "Users: 55" looks fine until you know it was 550.
if [[ -n "$COMPARE_TO" ]]; then
  [[ -f "$COMPARE_TO" ]] || die "--compare-to file not found: $COMPARE_TO"
  echo
  log "comparing against ${COMPARE_TO}"
  MISSING=0
  DRIFTED=0
  while IFS=',' read -r tbl want; do
    tbl="${tbl//[[:space:]]/}"
    want="${want//[[:space:]]/}"
    [[ -z "$tbl" ]] && continue
    # The CSV is data, not a script. Anything that is not a plain identifier is
    # skipped rather than interpolated into SQL.
    [[ "$tbl" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ "$want" =~ ^[0-9]+$ ]] || continue
    (( want == 0 )) && continue

    # Resolve the schema instead of assuming `public`. Hangfire creates its ten
    # tables in a `hangfire` schema, so an unqualified count(*) reports every one
    # of them as MISSING — nine red lines on a perfectly good dump, which is how
    # an operator learns to ignore this report.
    schema="$(q "SELECT table_schema FROM information_schema.tables
                 WHERE table_name = '${tbl}' AND table_type = 'BASE TABLE'
                 ORDER BY (table_schema = 'public') DESC LIMIT 1" | tr -d '[:space:]')"
    if [[ -z "$schema" ]]; then
      printf '  \033[31mMISSING\033[0m  %-26s expected %s rows, the table is not in the dump\n' "$tbl" "$want"
      MISSING=$((MISSING + 1))
      continue
    fi
    got="$(q "SELECT count(*) FROM \"${schema}\".\"${tbl}\"" | tr -d '[:space:]')"
    if [[ "${got:-x}" != "$want" ]]; then
      printf '  \033[33mDIFF\033[0m     %-26s recorded %-8s restored %s\n' "$tbl" "$want" "${got:-?}"
      DRIFTED=$((DRIFTED + 1))
    fi
  done < "$COMPARE_TO"

  # The two findings mean different things and must not be summarised together.
  # A MISSING table is always real: the dump does not contain it. A DIFF often is
  # not — row_counts.csv holds pg_stat_user_tables' PLANNER ESTIMATES, which drift
  # from the exact count until the next ANALYZE, and the live database also kept
  # taking writes between the dump and the count. Treating an estimate mismatch as
  # a failure would make this check cry wolf on every healthy backup.
  if (( MISSING > 0 )); then
    die "${MISSING} recorded table(s) are absent from this dump — it is not a complete backup"
  fi
  if (( DRIFTED == 0 )); then
    ok "every recorded table is present and matches exactly"
  else
    ok "all recorded tables present; ${DRIFTED} differ from the recorded ESTIMATE (expected for a live database — check the magnitudes above, not the exact numbers)"
  fi
fi

# ── audio ─────────────────────────────────────────────────────────────────────
AUDIO_N=0
if [[ -n "$MINIO_TGZ" ]]; then
  echo
  log "verifying the MinIO archive"
  SCRATCH_VOL="govori-restore-minio-$$"
  docker volume create "$SCRATCH_VOL" >/dev/null
  docker run --rm -i -v "${SCRATCH_VOL}:/data" alpine sh -c 'tar xzf - -C /data' < "$MINIO_TGZ"

  # Counted by xl.meta, NOT by filename extension. MinIO's backend does not store
  # an object as a file called `answer.webm` — it creates a DIRECTORY with that
  # name holding `xl.meta` plus the data parts. So `find -type f -name '*.webm'`
  # returns 0 on a completely intact archive, which is the worst possible way to
  # be wrong: the check whose entire job is to say whether the students' recordings
  # survived reports "no audio found" every single time, and gets ignored.
  # `.minio.sys` is excluded because its internal objects use the same layout.
  AUDIO_N="$(docker run --rm -v "${SCRATCH_VOL}:/data:ro" alpine \
    sh -c "find /data -mindepth 2 -type f -name xl.meta -not -path '*/.minio.sys/*' | wc -l" | tr -d '[:space:]')"
  [[ "${AUDIO_N:-0}" -gt 0 ]] || die "the MinIO archive extracts but contains no objects — wrong volume?"
  ok "${AUDIO_N} stored objects in the archive (audio + avatars)"
  docker volume rm -f "$SCRATCH_VOL" >/dev/null 2>&1 || true
  SCRATCH_VOL=""
fi

cleanup_verify
trap - EXIT

echo
printf '\033[32mVERIFIED\033[0m  %s — %s tables, %s real users, schema %s%s\n' \
  "$(basename "$DUMP")" "$TABLES" "$USERS" "$SCHEMA" \
  "$([[ -n "$MINIO_TGZ" ]] && echo ", ${AUDIO_N} stored objects")"

if [[ "$MODE" == "verify" ]]; then
  echo "This backup is proven, not assumed. Nothing outside the scratch container was touched."
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Phase 2 — RESTORE INTO THE LIVE STACK. Destructive from here down.
# ─────────────────────────────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────────────────────────────────────"
echo " --into-stack: this DROPS the live database and rebuilds it from the dump."
[[ -n "$MINIO_TGZ" ]] && echo " It will also REPLACE the entire MinIO volume with the archive."
echo " Compose file : ${COMPOSE_FILE}"
echo "─────────────────────────────────────────────────────────────────────────"

[[ -f "$COMPOSE_FILE" ]] || die "compose file not found: ${COMPOSE_FILE} (set COMPOSE_FILE=)"
(( CONFIRMED == 1 )) || die "refusing to continue without --yes"

dc() {
  if [[ -n "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

PGUSER_V="$(dc exec -T "$DB_SERVICE" printenv POSTGRES_USER | tr -d '\r\n')"
PGDB_V="$(dc exec -T "$DB_SERVICE" printenv POSTGRES_DB | tr -d '\r\n')"
[[ -n "$PGUSER_V" && -n "$PGDB_V" ]] || die "could not read POSTGRES_USER/DB from the ${DB_SERVICE} service — is the stack up?"
log "target: database '${PGDB_V}' as '${PGUSER_V}'"

# The api and the worker hold pooled connections and reconnect on loss. Left
# running they will (a) block DROP DATABASE forever and (b) write into the
# half-restored database the moment it reappears.
log "stopping ${APP_SERVICES} so nothing writes during the restore"
# shellcheck disable=SC2086   # APP_SERVICES is a deliberate word-split list
dc stop ${APP_SERVICES}

if [[ -n "$MINIO_TGZ" ]]; then
  MINIO_CTR="$(dc ps -q "$MINIO_SERVICE")"
  [[ -n "$MINIO_CTR" ]] || die "no ${MINIO_SERVICE} container — cannot locate its data volume"
  MINIO_VOL="$(docker inspect "$MINIO_CTR" \
    --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
  [[ -n "$MINIO_VOL" ]] || die "the ${MINIO_SERVICE} container has no named volume at /data"
  log "minio volume: ${MINIO_VOL} — stopping the service before overwriting it"
  dc stop "$MINIO_SERVICE"
  # Wipe first: extracting over a live tree would MERGE, leaving objects the
  # backup does not contain and a bucket that matches neither state.
  docker run --rm -v "${MINIO_VOL}:/data" alpine sh -c 'rm -rf /data/..?* /data/.[!.]* /data/*' || true
  docker run --rm -i -v "${MINIO_VOL}:/data" alpine sh -c 'tar xzf - -C /data' < "$MINIO_TGZ"
  log "minio volume restored; starting ${MINIO_SERVICE}"
  dc up -d "$MINIO_SERVICE"
fi

psql_t() { dc exec -T "$DB_SERVICE" psql -U "$PGUSER_V" "$@"; }

log "terminating remaining connections to ${PGDB_V}"
psql_t -d postgres -q -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PGDB_V}' AND pid <> pg_backend_pid();" >/dev/null

log "dropping and recreating ${PGDB_V}"
psql_t -d postgres -q -c "DROP DATABASE IF EXISTS \"${PGDB_V}\";"
psql_t -d postgres -q -c "CREATE DATABASE \"${PGDB_V}\" OWNER \"${PGUSER_V}\";"

log "restoring"
dc exec -T "$DB_SERVICE" pg_restore -U "$PGUSER_V" -d "$PGDB_V" --no-owner --no-acl < "$DUMP" || true

RESTORED_USERS="$(psql_t -d "$PGDB_V" -A -t -c "SELECT count(*) FROM users" | tr -d '[:space:]')"
[[ "${RESTORED_USERS:-0}" -gt 0 ]] || die "the live database came back with no users — DO NOT start the app; investigate"
log "restored: ${RESTORED_USERS} users"

log "starting ${APP_SERVICES}"
# shellcheck disable=SC2086
dc up -d ${APP_SERVICES}

echo
printf '\033[32mRESTORED\033[0m  %s users are back in %s.\n' "$RESTORED_USERS" "$PGDB_V"
echo "Now check by hand: log in as a real user, open a graded attempt, play its audio."
