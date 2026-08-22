#!/usr/bin/env bash
# =============================================================================
# PREFLIGHT — everything that must be true BEFORE the cutover window opens.
# =============================================================================
#
# Read-only. It starts nothing, stops nothing and writes nothing. Run it days
# before the cutover, run it again five minutes before, and do not open the
# window until it says PREFLIGHT PASSED.
#
# WHY IT EXISTS: every check below is one that, if skipped, fails LATER — at
# 02:00, with the old stack already down, on a problem that takes longer to
# diagnose than the whole window allows. A missing .env key surfaces as a
# container that will not start. An empty data volume surfaces as a healthy
# stack with 50 users missing. A busy port 443 surfaces as "the site is down"
# after the DNS has already moved. None of them need the window to be found.
#
# USAGE (on the droplet, from the repo root):
#   bash deploy/preflight.sh
#   ENV_FILE=.env COMPOSE_FILE=docker-compose.prod.yml bash deploy/preflight.sh
#
# Exit 0 = go. Non-zero = do not open the window.
# =============================================================================
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/govori}"
MIN_FREE_GB="${MIN_FREE_GB:-8}"
MAX_BACKUP_AGE_H="${MAX_BACKUP_AGE_H:-26}"

PASS=0; FAIL=0; WARN=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; WARN=$((WARN+1)); }
sec()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# Read one key out of the env file without sourcing it — a production .env holds
# API keys with `$`, backticks and quotes in them, and `source` would execute them.
envval() { sed -n "s/^${1}=//p" "$ENV_FILE" 2>/dev/null | head -1 | sed 's/[[:space:]]*$//'; }

echo "Govori cutover preflight — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── 1. The files exist ───────────────────────────────────────────────────────
sec "1. Files"
[ -f "$COMPOSE_FILE" ] && ok "compose file: ${COMPOSE_FILE}" || bad "no ${COMPOSE_FILE} — are you in the repo root?"
if [ -f "$ENV_FILE" ]; then
  ok "env file: ${ENV_FILE}"
  # The .env is the only copy of SECRET_KEY and every AI key on this machine.
  PERM="$(stat -c%a "$ENV_FILE" 2>/dev/null || stat -f%Lp "$ENV_FILE")"
  [ "$PERM" = "600" ] && ok "${ENV_FILE} is chmod 600" \
                      || warn "${ENV_FILE} is chmod ${PERM}; run: chmod 600 ${ENV_FILE}"
else
  bad "no ${ENV_FILE} — copy deploy/env.prod.example to it and fill it in"
fi

# The nginx template is a FILE bind-mount. Docker's rule for a missing source is
# "create it" — and for a file mount it creates a DIRECTORY with that name, which
# nginx then fails to parse in a way that reads like a config syntax error.
[ -f deploy/nginx/govori-prod.conf.template ] \
  && ok "nginx template present" \
  || bad "deploy/nginx/govori-prod.conf.template is missing — the file mount would become a directory"

# ── 2. The env file is COMPLETE ──────────────────────────────────────────────
# `config` renders every ${VAR:?} guard, so this one command proves that nothing
# required is missing. It is the same failure the window would otherwise hit at
# `up -d`, found now instead.
sec "2. Configuration renders"
if [ -f "$COMPOSE_FILE" ] && [ -f "$ENV_FILE" ]; then
  if ERR="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config 2>&1 >/dev/null)"; then
    ok "docker compose config renders — no required key is missing"
  else
    bad "docker compose config FAILED:"
    printf '        %s\n' "$ERR" | head -5
  fi
fi

# ── 3. The secrets the API refuses to start without ──────────────────────────
# Mirrors Govori.Api/Startup/ProductionSecrets.cs. Duplicated on purpose: the API
# reports these only once it is running, i.e. 40 s into the window, one restart
# at a time. Here they cost nothing and arrive days early.
sec "3. Secrets the API validates at boot"
if [ -f "$ENV_FILE" ]; then
  SK="$(envval SECRET_KEY)"
  if [ -z "$SK" ]; then bad "SECRET_KEY is empty — every session token is signed with it"
  elif [ "${#SK}" -lt 32 ]; then bad "SECRET_KEY is ${#SK} chars; the API requires at least 32"
  elif printf '%s' "$SK" | grep -qiE 'change-?_?me|placeholder|example|secret-?key|insecure|dev-?secret'; then
    bad "SECRET_KEY still looks like a placeholder — anyone with the repo could mint an admin token"
  else ok "SECRET_KEY is ${#SK} chars and not a placeholder"
  fi
  # Reminder rather than a check: nothing on this machine can tell whether the
  # value MATCHES the old stack's, and that is what decides whether 50 users stay
  # logged in or are all silently signed out.
  warn "confirm by eye that SECRET_KEY equals the OLD stack's value (prod-backup/<ts>/env.txt)"

  if [ -n "$(envval TELEGRAM_BOT_TOKEN)" ] && [ -n "$(envval TELEGRAM_BOT_USERNAME)" ]; then
    ok "TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME are both set"
  else
    bad "Telegram values missing — the API refuses to start in Production, because without them the fixed OTP code 000000 logs anyone in as any phone number"
  fi

  for k in MINIO_ROOT_USER MINIO_ROOT_PASSWORD; do
    v="$(envval "$k")"
    case "$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')" in
      ""|minioadmin|minio|admin|password|root|changeme)
        bad "${k} is empty or a stock credential — every recorded answer is behind it" ;;
      *) ok "${k} is set and not stock" ;;
    esac
  done

  CORS="$(envval BACKEND_CORS_ORIGINS)"
  case "$CORS" in
    "")  ok "BACKEND_CORS_ORIGINS is empty (correct: the SPA and API share one origin)" ;;
    *\**) bad "BACKEND_CORS_ORIGINS contains a wildcard — the API refuses to boot on one" ;;
    *)   warn "BACKEND_CORS_ORIGINS is set to '${CORS}'; only needed for a split-origin deploy" ;;
  esac

  [ -z "$(envval GOVORI_ALLOW_INSECURE_PRODUCTION)" ] \
    && ok "GOVORI_ALLOW_INSECURE_PRODUCTION is unset" \
    || bad "GOVORI_ALLOW_INSECURE_PRODUCTION is SET — this disables every check above on a public host"

  TAG="$(envval IMAGE_TAG)"
  case "$TAG" in
    "")       bad "IMAGE_TAG is empty" ;;
    latest)   bad "IMAGE_TAG=latest — the tag IS the rollback; use the commit sha" ;;
    *)        ok "IMAGE_TAG=${TAG}" ;;
  esac
fi

# ── 4. The data volumes exist AND HAVE DATA IN THEM ──────────────────────────
# The check this whole file is worth writing for. `external: true` already stops
# compose from inventing an empty volume, but it cannot tell an empty volume from
# a full one — and an empty Postgres volume produces a stack that is healthy in
# every mechanical sense and missing every user.
sec "4. Data volumes"
if [ -f "$ENV_FILE" ]; then
  for pair in "PG_VOLUME:govori-pgdata:PG_VERSION" "MINIO_VOLUME:govori-miniodata:.minio.sys"; do
    var="${pair%%:*}"; rest="${pair#*:}"; def="${rest%%:*}"; marker="${rest#*:}"
    vol="$(envval "$var")"; vol="${vol:-$def}"
    if ! docker volume inspect "$vol" >/dev/null 2>&1; then
      bad "${var}=${vol} does not exist — compose will refuse to start (which is correct). Check prod-backup/<ts>/manifest.txt for the real name."
      continue
    fi
    if docker run --rm -v "${vol}:/v:ro" alpine test -e "/v/${marker}" 2>/dev/null; then
      SZ="$(docker run --rm -v "${vol}:/v:ro" alpine du -sh /v 2>/dev/null | cut -f1)"
      ok "${var}=${vol} exists and is populated (${SZ}, found ${marker})"
    else
      bad "${var}=${vol} exists but has no ${marker} — it is EMPTY. Starting on it would create a blank database that looks perfectly healthy."
    fi
  done
fi

# ── 5. TLS ───────────────────────────────────────────────────────────────────
sec "5. TLS"
if [ -f nginx/certs/fullchain.pem ] && [ -f nginx/certs/privkey.pem ]; then
  END="$(openssl x509 -enddate -noout -in nginx/certs/fullchain.pem 2>/dev/null | cut -d= -f2 || true)"
  ok "certificate present, valid until ${END:-?}"
  # Self-signed means subject == issuer. Compared that way rather than by grepping
  # for a CN, because openssl prints the DN differently on every platform
  # ("issuer= /CN=x" on LibreSSL, "issuer=CN = x" on OpenSSL 3) — a string match
  # that works on the laptop silently never fires on the droplet.
  C_SUBJ="$(openssl x509 -noout -subject -in nginx/certs/fullchain.pem 2>/dev/null | sed 's/^subject=[= ]*//' || true)"
  C_ISS="$(openssl x509 -noout -issuer -in nginx/certs/fullchain.pem 2>/dev/null | sed 's/^issuer=[= ]*//' || true)"
  if [ -n "$C_SUBJ" ] && [ "$C_SUBJ" = "$C_ISS" ]; then
    warn "the certificate is SELF-SIGNED (${C_SUBJ}) — that is the bootstrap placeholder, browsers will reject it. Run deploy/setup-domain.sh for a real one."
  else
    ok "certificate is issued by ${C_ISS:-?}, not self-signed"
  fi
else
  warn "no cert at nginx/certs/ — deploy/setup-domain.sh creates a temporary self-signed one so nginx can start, then requests the real one"
fi
[ -d certbot/www ] && ok "certbot/www exists (ACME challenge webroot)" \
                   || warn "certbot/www missing — deploy/setup-domain.sh creates it"
crontab -l 2>/dev/null | grep -q 'renew-cert.sh' \
  && ok "certificate renewal is in root's crontab" \
  || warn "no renewal cron yet — deploy/setup-domain.sh installs it. Without it HTTPS dies in ~90 days with no warning."

# ── 6. Ports ─────────────────────────────────────────────────────────────────
sec "6. Ports 80 / 443"
for p in 80 443; do
  HOLDER="$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | grep -E ":${p}->" | cut -f1 | paste -sd, - || true)"
  if [ -n "$HOLDER" ]; then
    warn "port ${p} is published by: ${HOLDER} (expected during cutover — that is the OLD stack, and it must be stopped first)"
  elif command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE ":${p}\b"; then
    bad "port ${p} is held by a non-Docker process — nginx will not be able to bind it"
  else
    ok "port ${p} is free"
  fi
done

# ── 7. Disk ──────────────────────────────────────────────────────────────────
# The droplet BUILDS the images, so it needs room for the .NET SDK image, the
# BuildKit cache and two ~900 MB runtime images, on top of the database.
sec "7. Disk"
FREE_GB="$(df -Pk / | awk 'NR==2 {printf "%d", $4/1048576}')"
[ "${FREE_GB:-0}" -ge "$MIN_FREE_GB" ] \
  && ok "${FREE_GB} GB free on / (need ${MIN_FREE_GB}+ to build the images)" \
  || bad "only ${FREE_GB} GB free on / — the build needs ${MIN_FREE_GB}+. Reclaim with: docker image prune -f && docker builder prune -f  (NEVER 'system prune -a --volumes')"

# ── 8. A backup that has been RESTORED ───────────────────────────────────────
sec "8. Backup"
LATEST="$(find "$BACKUP_DIR" -maxdepth 1 -name 'govori_*.dump' -type f 2>/dev/null | sort | tail -1 || true)"
if [ -n "$LATEST" ]; then
  AGE_H=$(( ( $(date -u +%s) - $(stat -c%Y "$LATEST" 2>/dev/null || stat -f%m "$LATEST") ) / 3600 ))
  SZ="$(stat -c%s "$LATEST" 2>/dev/null || stat -f%z "$LATEST")"
  [ "$AGE_H" -le "$MAX_BACKUP_AGE_H" ] \
    && ok "latest backup $(basename "$LATEST") is ${AGE_H}h old (${SZ} bytes)" \
    || bad "latest backup is ${AGE_H}h old — the nightly cron is not running"
  warn "a dump nobody restored is a hypothesis. Prove it: bash deploy/restore.sh --dump ${LATEST}"
else
  bad "no backup in ${BACKUP_DIR} — install the cron first: deploy/prod-backup-cron.sh"
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
echo
printf '==> %d passed, %d warnings, %d failed\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
  printf '\n\033[32mPREFLIGHT PASSED\033[0m — read the %d warning(s) above, then open the window.\n' "$WARN"
  exit 0
fi
printf '\n\033[31mPREFLIGHT FAILED\033[0m — fix the %d item(s) above. Do NOT stop the old stack yet.\n' "$FAIL"
exit 1
