#!/usr/bin/env bash
# =============================================================================
# Apply EF Core migrations to the running stack's database.
# =============================================================================
#
# WHY THIS IS A SCRIPT AND NOT A LINE IN THE RUNBOOK
# The application deliberately does NOT migrate itself at startup — no
# Database.Migrate(), no EnsureCreated(). That is the right call for a database
# holding real users: a schema change should be a decision someone makes, not a
# side effect of a container restarting at 3am. But it leaves a gap, because the
# droplet has no .NET SDK on it, and `dotnet ef` is an SDK tool. The command that
# fills the gap is long, easy to get subtly wrong, and needed at the one moment
# nobody wants to be retyping it. So it lives here, tested, instead of in a
# document as something to copy.
#
# THE TWO SITUATIONS, AND HOW TO TELL THEM APART
#   EMPTY database (a fresh install — deploy/INSTALL.md). Nothing to do first:
#   this script applies every migration from InitialBaseline onwards and builds
#   the whole schema. deploy/ef-baseline.sh is NOT part of that path and must not
#   be run — it exists to adopt a schema that already exists, and here there is
#   nothing to adopt.
#
#   POPULATED database that EF has never seen (adopting an existing deployment —
#   deploy/CUTOVER.md). Run deploy/ef-baseline.sh FIRST: the baseline migration
#   was generated FROM that schema, so applying it for real would try to recreate
#   tables that are already there. ef-baseline.sh marks it applied without
#   running it; this script then applies everything after it.
#
# The script decides which of the two it is by looking, and says so before it
# does anything. You should not have to know in advance.
#
# USAGE (from the repo root, on the droplet)
#   bash deploy/migrate.sh --list        # read-only: what is applied, what is pending
#   bash deploy/migrate.sh               # apply pending migrations
#   TARGET_DB=scratch bash deploy/migrate.sh    # apply to another DB on the same server
#
# ENVIRONMENT
#   COMPOSE_FILE  default docker-compose.prod.yml
#   ENV_FILE      --env-file for compose (default: compose's own .env)
#   DB_SERVICE    default db
#   TARGET_DB     database name (default: POSTGRES_DB from the db service)
#   SDK_IMAGE     default mcr.microsoft.com/dotnet/sdk:9.0
# =============================================================================
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-}"
DB_SERVICE="${DB_SERVICE:-db}"
SDK_IMAGE="${SDK_IMAGE:-mcr.microsoft.com/dotnet/sdk:9.0}"
MODE="apply"

case "${1:-}" in
  --list|--dry-run) MODE="list" ;;
  "") ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

log() { printf '%s  %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die() { printf '\n\033[31mFATAL\033[0m  %s\n' "$*" >&2; exit 1; }

dc() {
  if [ -n "$ENV_FILE" ]; then docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else docker compose -f "$COMPOSE_FILE" "$@"; fi
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "${REPO_ROOT}/${COMPOSE_FILE}" ] || [ -f "$COMPOSE_FILE" ] || die "no ${COMPOSE_FILE} — run from the repo root"

# Read the credentials off the RUNNING container rather than re-deriving them
# from .env. If the two ever disagree, the container is the one that is right —
# and migrating the database the app is not using is a failure that looks
# exactly like success.
DB_CTR="$(dc ps -q "$DB_SERVICE")"
[ -n "$DB_CTR" ] || die "the ${DB_SERVICE} service is not running — start it first: docker compose -f ${COMPOSE_FILE} up -d ${DB_SERVICE}"
PGUSER_V="$(docker exec "$DB_CTR" printenv POSTGRES_USER | tr -d '\r\n')"
PGPASS_V="$(docker exec "$DB_CTR" printenv POSTGRES_PASSWORD | tr -d '\r\n')"
PGDB_V="${TARGET_DB:-$(docker exec "$DB_CTR" printenv POSTGRES_DB | tr -d '\r\n')}"
[ -n "$PGUSER_V" ] && [ -n "$PGDB_V" ] || die "could not read POSTGRES_USER/DB from the ${DB_SERVICE} container"

# The SDK container has to reach `db` by its service name, so it must join the
# stack's own network. Read it off the container instead of assuming a name —
# the network is parameterised in the compose file.
NET="$(docker inspect "$DB_CTR" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{break}}{{end}}')"
[ -n "$NET" ] || die "could not determine the stack network"

CONN="Host=${DB_SERVICE};Port=5432;Database=${PGDB_V};Username=${PGUSER_V};Password=${PGPASS_V}"

log "database : ${PGDB_V} as ${PGUSER_V}"
log "network  : ${NET}"
log "mode     : ${MODE}"

# Report what is about to happen BEFORE doing it, from the database itself. A
# migration run that says nothing about the starting state is impossible to
# audit afterwards.
APPLIED="$(docker exec -e PGPASSWORD="$PGPASS_V" "$DB_CTR" psql -U "$PGUSER_V" -d "$PGDB_V" -A -t \
  -c 'SELECT count(*) FROM "__EFMigrationsHistory"' 2>/dev/null | tr -d '[:space:]' || true)"
if [ -z "$APPLIED" ]; then
  # No history table. That is TWO different situations with opposite answers, and
  # the script used to describe both and leave the choice to whoever was reading
  # at the time. On a fresh install (deploy/INSTALL.md) the empty case is the
  # normal one, and being told to "consider ef-baseline.sh" there is an invitation
  # to fake a history row for a schema that does not exist yet — after which every
  # real migration is skipped and the first query fails on a missing table. So ask
  # the database which situation this is instead of asking the operator.
  if [ "$(docker exec -e PGPASSWORD="$PGPASS_V" "$DB_CTR" psql -U "$PGUSER_V" -d "$PGDB_V" -A -t \
            -c "SELECT to_regclass('public.users') IS NOT NULL" 2>/dev/null | tr -d '[:space:]')" = "t" ]; then
    log "WARNING: this database is POPULATED but has no __EFMigrationsHistory table."
    log "         STOP. Run deploy/ef-baseline.sh first — applying the baseline"
    log "         migration to a schema that already exists fails on its first"
    log "         CREATE TABLE. (Adopting existing data: deploy/CUTOVER.md.)"
  else
    log "this database is EMPTY — no schema, no history. That is the correct"
    log "starting point for a fresh install, and every migration below will run"
    log "for real. Do NOT run deploy/ef-baseline.sh: it exists to adopt an"
    log "already-populated database, and here there is nothing to adopt."
  fi
else
  log "migrations already applied: ${APPLIED}"
fi

# `dotnet ef` is a global tool, not part of the SDK image. Installing it and
# restoring the project graph on every run would be minutes of network each
# time, so both caches live in named volumes that survive between runs —
# which is what makes a retry after a flaky nuget.org cheap instead of another
# full download.
#
# Govori.Infrastructure is BOTH the migrations project and the startup project.
# It is the only project referencing Microsoft.EntityFrameworkCore.Design (the
# Api is not, so passing --startup-project src/Govori.Api fails outright), and it
# ships GovoriDbContextFactory, a design-time factory that reads GOVORI_DB. That
# means migrations run without constructing the Api's host at all — so they are
# not blocked by the production secrets gate, and a migration cannot be affected
# by application startup wiring.
EF_CMD="database update"
[ "$MODE" = "list" ] && EF_CMD="migrations list"

log "running: dotnet ef ${EF_CMD}"
docker run --rm --network "$NET" \
  -v "${REPO_ROOT}:/repo" \
  -v govori-nuget:/root/.nuget/packages \
  -v govori-dotnet-tools:/root/.dotnet/tools \
  -w /repo/backend-dotnet \
  -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e DOTNET_NOLOGO=1 \
  -e ConnectionStrings__Govori="$CONN" \
  -e GOVORI_DB="$CONN" \
  "$SDK_IMAGE" \
  sh -eu -c '
    export PATH="$PATH:/root/.dotnet/tools"
    command -v dotnet-ef >/dev/null 2>&1 \
      || dotnet tool install --global dotnet-ef --version 9.* >/dev/null
    dotnet ef '"$EF_CMD"' --project src/Govori.Infrastructure
  '

AFTER="$(docker exec -e PGPASSWORD="$PGPASS_V" "$DB_CTR" psql -U "$PGUSER_V" -d "$PGDB_V" -A -t \
  -c 'SELECT max(migration_id) FROM "__EFMigrationsHistory"' 2>/dev/null | tr -d '[:space:]' || true)"
echo
if [ "$MODE" = "list" ]; then
  log "no changes were made. Latest applied: ${AFTER:-none}"
else
  printf '\033[32mMIGRATED\033[0m  latest applied migration: %s\n' "${AFTER:-none}"
fi
