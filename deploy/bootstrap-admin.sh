#!/usr/bin/env bash
# =============================================================================
# FIRST ADMIN — the one account a freshly installed Govori cannot create itself.
# =============================================================================
#
# WHY THIS EXISTS
#   On a database built from scratch (deploy/INSTALL.md) the `users` table is
#   empty, and there is no way to fill the gap from inside the product:
#   self-service sign-up is phone + OTP, and Govori.Identity/AuthService.cs
#   hard-codes `Role = UserRole.Student` for every account it creates. So the
#   admin panel is reachable only by someone who is already an admin, and on a
#   clean install nobody is. That is a real chicken-and-egg, and it is the one
#   step of a fresh install that has no script — until this one.
#
# WHY IT CREATES NO PASSWORD
#   Because there is no password to create. Login is phone + one-time code
#   delivered by the Telegram bot; `password_hash` is NULL for every account the
#   app itself makes, and email/password login no longer exists. So this script
#   writes a row and stops. Nothing secret is printed, nothing secret is stored,
#   there is no bootstrap credential to rotate afterwards, and a copy of the
#   install log leaks nothing. The owner then logs in the ordinary way, with the
#   code that arrives on THEIR Telegram — which is a stronger guarantee than any
#   password this script could have generated and echoed to a terminal.
#
# WHY IT IS SAFE TO RE-RUN
#   Existing phone  -> promoted to admin and re-activated (UPDATE).
#   New phone       -> inserted as an active admin (INSERT).
#   Same phone twice-> the second run reports "already an admin" and writes
#                      nothing. There is no state to get half-way through.
#
# USAGE (on the droplet, from the repo root, AFTER deploy/migrate.sh)
#   COMPOSE_FILE=docker-compose.prod.yml \
#     bash deploy/bootstrap-admin.sh --phone '+998 90 123 45 67' --name "Ism Familiya"
#
#   bash deploy/bootstrap-admin.sh --list        # read-only: who is an admin now
#
# ENVIRONMENT
#   COMPOSE_FILE   which stack. REQUIRED when both compose files are present —
#                  this writes to a live database, so it refuses to guess.
#   ENV_FILE       --env-file for compose. Default: compose's own `.env`, which on
#                  the droplet IS the production env file. Set it only when the
#                  stack was started with a different one.
#   DB_SERVICE     compose service name of Postgres (default: db)
# =============================================================================
set -Eeuo pipefail

DB_SERVICE="${DB_SERVICE:-db}"
ENV_FILE="${ENV_FILE:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=deploy/lib/compose-target.sh
. "${REPO_ROOT}/deploy/lib/compose-target.sh"

PHONE_RAW=""
FULL_NAME=""
MODE="create"
CONFIRMED=0

die()  { printf '\n\033[31mFATAL\033[0m  %s\n' "$*" >&2; exit 1; }
note() { printf '    %s\n' "$*"; }

usage() {
    cat >&2 <<'EOF'
usage:
  deploy/bootstrap-admin.sh --phone '+998901234567' --name "Ism Familiya" [--yes]
  deploy/bootstrap-admin.sh --list

  --yes  skip the confirmation prompt (required when stdin is not a terminal)

  COMPOSE_FILE=docker-compose.prod.yml must be set when the repo root holds both
  a dev and a prod compose file.
EOF
    exit 2
}

while [ $# -gt 0 ]; do
    case "$1" in
        --phone) PHONE_RAW="${2:-}"; shift 2 || usage ;;
        --name)  FULL_NAME="${2:-}"; shift 2 || usage ;;
        --list)  MODE="list"; shift ;;
        --yes)   CONFIRMED=1; shift ;;
        -h|--help) usage ;;
        *) echo "unknown argument: $1" >&2; usage ;;
    esac
done

# ── Phone normalisation ──────────────────────────────────────────────────────
# A byte-for-byte port of Govori.Contracts/PhoneNumbers.NormalizeUz: strip every
# non-digit, drop a leading 998, require exactly 9 national digits, emit
# +998XXXXXXXXX. It has to be the SAME canonical form the app writes, because
# login looks the account up by exact string match on `phone` — a row stored as
# `998901234567` or `+998 90 123 45 67` would be an admin account that can never
# log in, and the failure would look like "the OTP is wrong".
normalize_uz() {
    local digits
    digits="$(printf '%s' "$1" | tr -cd '0-9')"
    case "$digits" in 998*) digits="${digits#998}" ;; esac
    [ "${#digits}" -eq 9 ] || return 1
    printf '+998%s\n' "$digits"
}

# ── Resolve the target ───────────────────────────────────────────────────────
resolve_compose_file || exit 1

dc() {
    if [ -n "$ENV_FILE" ]; then docker compose --env-file "$ENV_FILE" -f "$GOVORI_COMPOSE_FILE" "$@"
    else docker compose -f "$GOVORI_COMPOSE_FILE" "$@"; fi
}

DB_CTR="$(dc ps -q "$DB_SERVICE" 2>/dev/null || true)"
[ -n "$DB_CTR" ] || die "the '${DB_SERVICE}' service is not running under ${GOVORI_COMPOSE_FILE}.
        Start it first:  docker compose -f ${GOVORI_COMPOSE_FILE} up -d ${DB_SERVICE}"

PGUSER_V="$(docker exec "$DB_CTR" printenv POSTGRES_USER | tr -d '\r\n')"
PGPASS_V="$(docker exec "$DB_CTR" printenv POSTGRES_PASSWORD | tr -d '\r\n')"
PGDB_V="$(docker exec "$DB_CTR" printenv POSTGRES_DB | tr -d '\r\n')"
[ -n "$PGUSER_V" ] && [ -n "$PGDB_V" ] || die "could not read POSTGRES_USER/POSTGRES_DB from the ${DB_SERVICE} container"

echo "==> Database: ${PGDB_V} as ${PGUSER_V}  (container ${DB_CTR:0:12})"

# psql -v ON_ERROR_STOP=1 so a failed statement is a failed script. Without it
# psql exits 0 after printing the error, and a bootstrap that silently did
# nothing is worse than one that stopped: the operator moves on to "log in as
# admin" and hits a plain student account.
#
# Values reach SQL as psql variables interpolated with :'name', never spliced
# into the string here. psql does the quoting, so an apostrophe in a surname
# ("Sa'dulla") is a name and not a syntax error — and no argument to this script
# can become SQL.
#
# THE SQL ARRIVES ON STDIN, NEVER VIA -c. Measured, not assumed: `psql -v ph=x -c
# "SELECT :'ph'"` hands the string straight to the server unlexed and fails with
# `syntax error at or near ":"`, while the identical query on stdin interpolates
# correctly. Every query below therefore uses a heredoc — including the ones with
# no variables in them today, so that adding one later cannot silently reopen it.
#
# -F is set to a tab because the row-shaped query returns a user's full_name, and
# psql's default -A separator is `|` — a character a name may legitimately contain
# and a tab is not.
psql_q() {
    docker exec -i -e PGPASSWORD="$PGPASS_V" "$DB_CTR" \
        psql -v ON_ERROR_STOP=1 -U "$PGUSER_V" -d "$PGDB_V" -X -q -A -t -F "$(printf '\t')" "$@"
}

# ── The schema has to be there first ─────────────────────────────────────────
# Ordering guard, not paranoia: on a fresh install this script and deploy/
# migrate.sh are two consecutive steps, and running them the other way round
# gives "relation users does not exist" — which reads like a broken script
# rather than a skipped step.
HAVE_USERS="$(psql_q <<'SQL'
SELECT to_regclass('public.users') IS NOT NULL;
SQL
)"
[ "$HAVE_USERS" = "t" ] || die "there is no 'users' table in ${PGDB_V} yet.
        Apply the schema first:  bash deploy/migrate.sh
        (INSTALL.md step 5 comes before step 6 for exactly this reason.)"

COUNTS="$(psql_q <<'SQL'
SELECT count(*), count(*) FILTER (WHERE role = 'admin') FROM users;
SQL
)"
IFS=$'\t' read -r TOTAL ADMINS <<<"$COUNTS"

if [ "$MODE" = "list" ]; then
    echo "==> ${TOTAL} user(s), ${ADMINS} admin(s):"
    docker exec -i -e PGPASSWORD="$PGPASS_V" "$DB_CTR" \
        psql -v ON_ERROR_STOP=1 -U "$PGUSER_V" -d "$PGDB_V" -X <<'SQL'
SELECT phone, full_name, is_active, created_at FROM users WHERE role = 'admin' ORDER BY created_at;
SQL
    exit 0
fi

[ -n "$PHONE_RAW" ] || die "--phone is required. It must be the owner's REAL number: the login code
        is delivered to that number's Telegram account, and nothing else opens
        the admin panel."
[ -n "$FULL_NAME" ] || die "--name is required (it is shown in the panel and on graded work)."

PHONE="$(normalize_uz "$PHONE_RAW")" \
    || die "'${PHONE_RAW}' is not a valid Uzbek number. Nine national digits, e.g. +998901234567."

EMAIL="${PHONE}@govori.uz"

# ── Say what is about to happen, BEFORE it happens ───────────────────────────
# Same rule as deploy/rollback-db.sh: the operator gets to read the target and
# the verb before anything is written, not after. This one writes to whichever
# database the running stack points at, and on the droplet that is the live one —
# "an existing account is about to change role" is exactly the sentence someone
# needs to see while they can still say no.
EXISTING="$(psql_q -v ph="$PHONE" <<'SQL'
SELECT full_name, role::text, is_active::text FROM users WHERE phone = :'ph';
SQL
)"

echo "==> Phone     : ${PHONE}   (normalised from '${PHONE_RAW}')"
echo "==> Name      : ${FULL_NAME}"
echo "==> Database  : ${TOTAL} user(s), of which ${ADMINS} admin(s)"
if [ -n "$EXISTING" ]; then
    # `is_active::text` yields 'true'/'false', NOT psql's unaligned 't'/'f' — the
    # cast is what makes the printed line readable, and comparing against 't' here
    # silently mislabels an account that is already an admin as one about to be
    # changed. Found by running the script twice, which is the only way to see it.
    IFS=$'\t' read -r EX_NAME EX_ROLE EX_ACTIVE <<<"$EXISTING"
    if [ "$EX_ROLE" = "admin" ] && [ "$EX_ACTIVE" = "true" ]; then
        echo "==> Action    : NOTHING — this account is already an active admin"
        note "current: name='${EX_NAME}'  role=${EX_ROLE}  is_active=${EX_ACTIVE}"
    else
        echo "==> Action    : MODIFY AN EXISTING ACCOUNT"
        note "current: name='${EX_NAME}'  role=${EX_ROLE}  is_active=${EX_ACTIVE}"
        note "it will become role=admin, is_active=true. Its name, XP, history and"
        note "submissions are NOT touched, and --name is ignored for an existing row."
    fi
else
    echo "==> Action    : CREATE A NEW ACCOUNT"
    note "new row: role=admin, is_active=true, password_hash=NULL, email=${EMAIL}"
fi
# `[ … ] && note …` would be a landmine under `set -e`: on a FRESH install ADMINS
# is 0, the test fails, the && list returns 1, and the script exits before doing
# the one thing it exists for. An `if` cannot do that.
if [ "$ADMINS" -gt 0 ]; then
    note "NOTE: this database already has ${ADMINS} admin(s). Adding another is fine — this is how you add a second one."
fi

if [ "$CONFIRMED" -eq 0 ]; then
    if [ -t 0 ]; then
        printf '\nContinue? type yes: '
        read -r REPLY_RAW
        [ "$REPLY_RAW" = "yes" ] || die "not confirmed — nothing was written."
    else
        die "refusing to continue without --yes (stdin is not a terminal, so there is
        nobody to ask). Re-read the lines above, then append --yes to the command."
    fi
fi

# ── The one collision the upsert cannot arbitrate ────────────────────────────
# `email` is NOT NULL + UNIQUE and is DERIVED from the phone, so a SECOND account
# can hold {this phone}@govori.uz while wearing a different number: a phone change
# keeps the original placeholder email, on purpose (AuthService documents this).
# Recycled numbers are the only way to reach it, and it needs a human decision
# rather than a guess — so it is checked first and reported by name, instead of
# arriving as a bare "duplicate key value violates unique constraint".
EMAIL_OWNER="$(psql_q -v em="$EMAIL" -v ph="$PHONE" <<'SQL'
SELECT coalesce(phone, '(no phone)') FROM users WHERE email = :'em' AND phone IS DISTINCT FROM :'ph';
SQL
)"
[ -z "$EMAIL_OWNER" ] || die "another account already holds the derived email ${EMAIL}, on phone ${EMAIL_OWNER}.
        That happens when ${PHONE} was used by an older account that has since
        moved to a different number. Decide what that account should be (rename
        its email, or make THAT account the admin with --phone ${EMAIL_OWNER})
        before re-running. Nothing has been written."

# ── The write ────────────────────────────────────────────────────────────────
# One statement, one transaction, three outcomes, reported by name. Written as a
# single INSERT ... ON CONFLICT rather than SELECT-then-branch because two
# operators (or one operator and a re-run) racing on the same phone must not be
# able to produce two rows: `phone` carries a UNIQUE index and this lets Postgres
# arbitrate. The index is PARTIAL (20260813093156_AddUsersPhoneUniqueIndex:
# `filter: phone IS NOT NULL`), so the conflict target has to repeat that
# predicate — `ON CONFLICT (phone)` alone infers no index here and fails outright.
#
# The columns not named are covered by DB defaults from the baseline migration
# (xp, streaks, created_at/updated_at); is_active has NO default, which is why it
# is set explicitly — the app does the same.
RESULT="$(psql_q -v em="$EMAIL" -v ph="$PHONE" -v nm="$FULL_NAME" <<'SQL'
WITH ins AS (
    INSERT INTO users (id, email, password_hash, full_name, role, is_active, phone, preferred_language)
    VALUES (gen_random_uuid(), :'em', NULL, :'nm', 'admin', true, :'ph', 'uz')
    ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE
        SET role = 'admin',
            is_active = true,
            updated_at = now()
        WHERE users.role IS DISTINCT FROM 'admin' OR users.is_active IS DISTINCT FROM true
    RETURNING (xmax = 0) AS inserted
)
SELECT COALESCE((SELECT CASE WHEN inserted THEN 'created' ELSE 'promoted' END FROM ins), 'unchanged');
SQL
)"

echo
case "$RESULT" in
    created)
        printf '\033[32mCREATED\033[0m   %s is now an active admin (%s).\n' "$PHONE" "$FULL_NAME" ;;
    promoted)
        printf '\033[32mPROMOTED\033[0m  the existing account on %s is now an active admin.\n' "$PHONE"
        note "Its original full_name was kept — this script does not overwrite a real user's name." ;;
    unchanged)
        printf '\033[32mUNCHANGED\033[0m %s was already an active admin. Nothing was written.\n' "$PHONE" ;;
    *)
        die "unexpected result from the database: '${RESULT}'" ;;
esac

cat <<EOF

Log in with it:
  1. open https://<your domain>/  and choose "Kirish"
  2. enter ${PHONE}
  3. the code arrives in Telegram, from your bot — open the bot and share the
     contact if it asks. There is no password anywhere in this flow.
  4. the admin panel is at /admin

If the code never arrives, the problem is the bot, not this row:
  docker compose -f ${GOVORI_COMPOSE_FILE} exec api curl -fsS localhost:8080/api/auth/config
  # "otp_delivery":"telegram_bot"  -> the bot is configured; check TELEGRAM_BOT_TOKEN is the
  #                                   token for the SAME bot as TELEGRAM_BOT_USERNAME
  # "otp_delivery":"dev"           -> STOP. The stack is accepting the fixed code 000000 from
  #                                   anyone, for any phone. Fix .env and restart the api.

Check any time with:
  COMPOSE_FILE=${GOVORI_COMPOSE_FILE} bash deploy/bootstrap-admin.sh --list
EOF
