#!/usr/bin/env bash
# =============================================================================
# PROD CUTOVER STEP — run this deliberately, by hand, once per database.
# =============================================================================
#
# WHAT THIS DOES
#   Adopts an ALREADY-POPULATED database into EF Core's migration history so EF
#   becomes the schema owner from here on. It does NOT create, alter or drop a
#   single application table — the schema already exists and stays exactly as it
#   is. All this script writes is one bookkeeping row, plus the removal of the
#   now-defunct `alembic_version` marker table.
#
# WHY IT EXISTS
#   The baseline migration (see BASELINE_ID below) was generated FROM the current
#   live schema, so its Up() would recreate a schema that is already there. On a
#   populated database `dotnet ef database update` must therefore never run: it
#   would fail on the first CREATE TABLE, and on a partially-empty database it
#   could do real damage. Instead we tell EF "this migration is already applied"
#   by inserting its row into "__EFMigrationsHistory" directly. Every FUTURE
#   migration then applies normally via `dotnet ef database update`.
#
#   Do this ONCE per environment. Afterwards this script is a no-op.
#
# WHAT IT DELIBERATELY REFUSES TO DO
#   * It will not touch a database that does not already contain the expected
#     application tables. On a genuinely empty database the correct action is
#     `dotnet ef database update`, which runs the real migration — so this
#     script bails out and tells you that instead of faking history for a schema
#     that was never created.
#   * It never runs Up(), never drops an application table, never truncates.
#
# USAGE
#   bash deploy/ef-baseline.sh --dry-run     # print the SQL, change nothing
#   bash deploy/ef-baseline.sh               # apply (idempotent)
#
#   Connection comes from the environment, defaulting to the local docker stack:
#     PGHOST (default: localhost)   PGPORT (default: 5433)
#     PGUSER (default: russpeak)    PGPASSWORD (default: russpeak)
#     PGDATABASE (default: russpeak)
#
#   Against the docker compose stack you can also skip the network entirely:
#     COMPOSE_DB_SERVICE=db bash deploy/ef-baseline.sh
#   which runs psql inside the db container instead of connecting over TCP.
#
# RE-RUNNING
#   Safe. The history row is inserted only if absent, the history table is
#   created only if absent, and alembic_version is dropped only if present. A
#   second run reports "already adopted" and exits 0 without writing anything.
# =============================================================================

set -euo pipefail

# --- The migration being adopted -------------------------------------------
# MUST match the class name under Govori.Infrastructure/Migrations/ exactly
# (timestamp prefix included) or EF will try to apply it again on next update.
BASELINE_ID="20260720140929_InitialBaseline"
# The EF Core version stamped in the history row. Cosmetic to EF's logic, but
# keep it in step with the Microsoft.EntityFrameworkCore.* package versions.
PRODUCT_VERSION="9.0.4"

# --- Connection -------------------------------------------------------------
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-russpeak}"
PGPASSWORD="${PGPASSWORD:-russpeak}"
PGDATABASE="${PGDATABASE:-russpeak}"
COMPOSE_DB_SERVICE="${COMPOSE_DB_SERVICE:-}"
export PGPASSWORD

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,52p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg (expected --dry-run)" >&2; exit 2 ;;
  esac
done

# psql wrapper: either inside the compose db container or over TCP.
psql_q() {
  if [[ -n "$COMPOSE_DB_SERVICE" ]]; then
    docker compose exec -T "$COMPOSE_DB_SERVICE" \
      psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -t -A -c "$1"
  else
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
      -v ON_ERROR_STOP=1 -t -A -c "$1"
  fi
}

if [[ -n "$COMPOSE_DB_SERVICE" ]]; then
  echo "==> Target: compose service '$COMPOSE_DB_SERVICE', database '$PGDATABASE'"
else
  echo "==> Target: $PGUSER@$PGHOST:$PGPORT/$PGDATABASE"
fi
echo "==> Baseline migration: $BASELINE_ID (EF $PRODUCT_VERSION)"

# --- GUARD: the schema must already exist -----------------------------------
# These are the application tables the baseline migration describes. If they are
# missing this is NOT a database to adopt — it is one to migrate normally.
EXPECTED_TABLES="app_settings assignments evaluations group_members groups \
notifications question_blocks questions review_items shadowing_phrases \
submissions topic_images topics transcripts users xp_events"

missing=""
present=0
for t in $EXPECTED_TABLES; do
  if [[ "$(psql_q "SELECT to_regclass('public.$t') IS NOT NULL;")" == "t" ]]; then
    present=$((present + 1))
  else
    missing="$missing $t"
  fi
done

if [[ -n "$missing" ]]; then
  cat >&2 <<EOF

REFUSING TO RUN — this database is not a candidate for baseline adoption.
Missing expected table(s):$missing
  (found $present of 16 application tables)

If this database is EMPTY, do not baseline it: let EF build it for real with
    dotnet ef database update --project src/Govori.Infrastructure
If it is populated but genuinely differs from the baseline, reconcile the schema
first — do not paper over the difference with a history row.
EOF
  exit 1
fi
echo "==> Guard passed: all 16 application tables present."

# --- The SQL ----------------------------------------------------------------
# Every statement is conditional, which is what makes re-running a no-op.
# NOTE ON NAMING: the DbContext uses UseSnakeCaseNamingConvention(), so the
# history table's COLUMNS are migration_id / product_version — not EF's default
# MigrationId / ProductVersion. The TABLE name keeps its quoted mixed case. Get
# this wrong and EF silently fails to see the row and re-applies the migration.
read -r -d '' SQL <<EOF || true
BEGIN;

-- 1. EF's bookkeeping table, shaped exactly as EF itself would create it.
CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    migration_id character varying(150) NOT NULL,
    product_version character varying(32) NOT NULL,
    CONSTRAINT "pk___ef_migrations_history" PRIMARY KEY (migration_id)
);

-- 2. Record the baseline as applied. ON CONFLICT makes a second run a no-op
--    and preserves whatever product_version was recorded the first time.
INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
VALUES ('${BASELINE_ID}', '${PRODUCT_VERSION}')
ON CONFLICT (migration_id) DO NOTHING;

-- 3. Retire the old migration marker. This table holds a single version string
--    and no application data; the schema it tracked is now owned by EF.
DROP TABLE IF EXISTS alembic_version;

COMMIT;
EOF

if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> DRY RUN — the following SQL would be executed, but nothing was changed:"
  echo
  echo "$SQL"
  echo
  echo "==> Current state (read-only):"
  echo "    __EFMigrationsHistory exists : $(psql_q "SELECT to_regclass('public.\"__EFMigrationsHistory\"') IS NOT NULL;")"
  echo "    baseline row present         : $(psql_q "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='__EFMigrationsHistory') AND EXISTS(SELECT 1 FROM \"__EFMigrationsHistory\" WHERE migration_id='${BASELINE_ID}');" 2>/dev/null || echo "f")"
  echo "    alembic_version exists       : $(psql_q "SELECT to_regclass('public.alembic_version') IS NOT NULL;")"
  exit 0
fi

# --- Apply ------------------------------------------------------------------
if [[ -n "$COMPOSE_DB_SERVICE" ]]; then
  printf '%s\n' "$SQL" | docker compose exec -T "$COMPOSE_DB_SERVICE" \
    psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q
else
  printf '%s\n' "$SQL" | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
    -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q
fi

# --- Verify -----------------------------------------------------------------
rows="$(psql_q "SELECT count(*) FROM \"__EFMigrationsHistory\";")"
has_baseline="$(psql_q "SELECT EXISTS(SELECT 1 FROM \"__EFMigrationsHistory\" WHERE migration_id='${BASELINE_ID}');")"
alembic_gone="$(psql_q "SELECT to_regclass('public.alembic_version') IS NULL;")"

echo "==> __EFMigrationsHistory rows : $rows"
echo "==> baseline row present       : $has_baseline"
echo "==> alembic_version removed    : $alembic_gone"

if [[ "$has_baseline" == "t" && "$alembic_gone" == "t" ]]; then
  echo "==> DONE. EF Core now owns this schema. Future changes ship as migrations:"
  echo "        dotnet ef migrations add <Name> --project src/Govori.Infrastructure"
  echo "        dotnet ef database update      --project src/Govori.Infrastructure"
else
  echo "!! Post-check failed — inspect the database before proceeding." >&2
  exit 1
fi
