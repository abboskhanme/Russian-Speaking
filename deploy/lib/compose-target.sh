#!/usr/bin/env bash
# Shared target resolution for the two scripts that can damage a live database:
# deploy/ef-baseline.sh and deploy/rollback-db.sh.
#
# WHY THIS FILE EXISTS
# Both scripts used to call bare `docker compose exec`. With no `-f`, Compose
# picks the first file it finds — and on the droplet `docker-compose.yml` (dev)
# and `docker-compose.prod.yml` sit side by side in the same directory, so the
# DEV file wins. Both scripts also defaulted PGUSER/PGDATABASE to the dev name
# `russpeak`.
#
# Neither of those is a loud failure. They are a rollback script, run under
# pressure, by someone who has probably skipped a line of the runbook, quietly
# pointing at the wrong stack and the wrong database. `rollback-db.sh` drops the
# database it is aimed at. It is the last safety net, so it is the one place a
# wrong guess is least acceptable.
#
# The rule here is one sentence: NEVER CHOOSE SILENTLY. Given a choice, this
# refuses and says exactly what to type. Given no choice, it says out loud what
# it picked.
#
# Sourced, not executed. Callers use:
#   resolve_compose_file          -> sets GOVORI_COMPOSE_FILE, prints it
#   compose_db_env <service>      -> prints "user<TAB>database" read off the container

# ── Which compose file? ──────────────────────────────────────────────────────
# COMPOSE_FILE is honoured first because Compose itself honours it, so a caller
# that exports it gets the same answer from this script and from any docker
# command they run by hand next to it.
resolve_compose_file() {
    if [ -n "${COMPOSE_FILE:-}" ]; then
        if [ ! -f "$COMPOSE_FILE" ]; then
            echo "✗ COMPOSE_FILE=${COMPOSE_FILE} does not exist (are you in the repo root?)" >&2
            return 1
        fi
        GOVORI_COMPOSE_FILE="$COMPOSE_FILE"
        echo "==> Compose file: ${GOVORI_COMPOSE_FILE}  (from COMPOSE_FILE)"
        return 0
    fi

    local found=()
    local f
    for f in docker-compose.prod.yml docker-compose.yml compose.prod.yaml compose.yaml; do
        [ -f "$f" ] && found+=("$f")
    done

    case ${#found[@]} in
        0)
            echo "✗ No compose file here. Run this from the repo root, or set COMPOSE_FILE." >&2
            return 1
            ;;
        1)
            GOVORI_COMPOSE_FILE="${found[0]}"
            echo "==> Compose file: ${GOVORI_COMPOSE_FILE}  (the only one present)"
            return 0
            ;;
        *)
            # The droplet case. Refusing costs five seconds; guessing can cost the
            # database. Print the exact command rather than the rule.
            {
                echo "✗ REFUSING TO GUESS: ${#found[@]} compose files are present here —"
                printf '      %s\n' "${found[@]}"
                echo ""
                echo "  Bare \`docker compose\` picks one of these for you, and the scripts that"
                echo "  source this file WRITE TO a live database — one of them drops it. Say which:"
                echo ""
                echo "      export COMPOSE_FILE=docker-compose.prod.yml   # the live stack"
                echo "      export COMPOSE_FILE=docker-compose.yml        # the local dev stack"
                echo ""
            } >&2
            return 1
            ;;
    esac
}

# ── Which database, and as whom? ─────────────────────────────────────────────
# Read off the RUNNING container rather than defaulted to the dev names. If the
# container and the caller's environment ever disagree, the container is the one
# that is right — and operating on the database the application is NOT using is a
# failure that looks exactly like success.
# Prints "user<TAB>database"; returns non-zero if the service is not running.
compose_db_env() {
    local svc="$1" ctr
    ctr="$(docker compose -f "$GOVORI_COMPOSE_FILE" ps -q "$svc" 2>/dev/null)" || true
    [ -n "$ctr" ] || {
        echo "✗ service '${svc}' is not running under ${GOVORI_COMPOSE_FILE}." >&2
        echo "  Start it first:  docker compose -f ${GOVORI_COMPOSE_FILE} up -d ${svc}" >&2
        return 1
    }
    printf '%s\t%s\n' \
        "$(docker exec "$ctr" printenv POSTGRES_USER | tr -d '\r\n')" \
        "$(docker exec "$ctr" printenv POSTGRES_DB   | tr -d '\r\n')"
}
