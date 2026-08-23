#!/usr/bin/env bash
# =============================================================================
# PREFLIGHT — everything that must be true BEFORE you start the stack.
# =============================================================================
#
# Read-only. It starts nothing, stops nothing and writes nothing.
#
# WHY IT EXISTS: every check below is one that, if skipped, fails LATER — with
# the site already down or half-installed, on a problem that takes longer to
# diagnose than the step it belongs to. A missing .env key surfaces as a
# container that will not start. A data volume that is empty when it should not
# be surfaces as a stack that is healthy in every mechanical sense and missing
# every user. A busy port 443 surfaces as "the site is down". None of them need
# the deploy to be found.
#
# ── TWO MODES, BECAUSE "EMPTY" MEANS OPPOSITE THINGS ─────────────────────────
#   install  A first install onto a clean host (deploy/INSTALL.md). The data
#            volumes are SUPPOSED to be empty, there is no backup yet and no
#            certificate yet. Reporting those as failures would send the
#            operator hunting for a problem that is not there — and, worse,
#            teach them that a red line in this script is normal.
#   live     A stack that is already serving (a redeploy, or adopting an
#            existing deployment — deploy/CUTOVER.md). An empty data volume here
#            is the single most expensive thing this script can catch, and a
#            missing nightly backup is a real finding.
#
#   The mode is DETECTED from the Postgres volume and printed. Override with
#   PREFLIGHT_MODE=install|live. When detection cannot tell (no docker, no env
#   file), it falls back to `live` — the stricter of the two, because a check
#   that fires when it need not costs a minute, and one that stays quiet when it
#   should not costs the database.
#
# USAGE (from the repo root):
#   bash deploy/preflight.sh
#   PREFLIGHT_MODE=install bash deploy/preflight.sh
#   ENV_FILE=.env COMPOSE_FILE=docker-compose.prod.yml bash deploy/preflight.sh
#
# Exit 0 = go. Non-zero = fix something first.
# =============================================================================
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/govori}"
MIN_FREE_GB="${MIN_FREE_GB:-8}"
MAX_BACKUP_AGE_H="${MAX_BACKUP_AGE_H:-26}"
MIN_SWAP_MB="${MIN_SWAP_MB:-1024}"
DB_SERVICE="${DB_SERVICE:-db}"

PASS=0; FAIL=0; WARN=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; WARN=$((WARN+1)); }
sec()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# Read one key out of the env file without sourcing it — a production .env holds
# API keys with `$`, backticks and quotes in them, and `source` would execute them.
envval() { sed -n "s/^${1}=//p" "$ENV_FILE" 2>/dev/null | head -1 | sed 's/[[:space:]]*$//'; }

echo "Govori preflight — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Which situation is this? ─────────────────────────────────────────────────
# Detected rather than asked, because the operator who most needs the right
# answer is the one least sure which mode they are in. The Postgres volume is the
# evidence: a volume that does not exist, or exists with no PG_VERSION in it, has
# never held a database — so this cannot be a live stack, whatever anyone typed.
PG_VOL_NAME="$(envval PG_VOLUME)"; PG_VOL_NAME="${PG_VOL_NAME:-govori-pgdata}"
detect_mode() {
  command -v docker >/dev/null 2>&1 || { echo live; return; }
  docker volume inspect "$PG_VOL_NAME" >/dev/null 2>&1 || { echo install; return; }
  docker run --rm -v "${PG_VOL_NAME}:/v:ro" alpine test -e /v/PG_VERSION >/dev/null 2>&1 \
    && echo live || echo install
}
if [ -n "${PREFLIGHT_MODE:-}" ]; then
  MODE="$PREFLIGHT_MODE"; MODE_WHY="set explicitly via PREFLIGHT_MODE"
else
  MODE="$(detect_mode)"; MODE_WHY="detected from the '${PG_VOL_NAME}' volume"
fi
case "$MODE" in
  install) printf 'Mode: \033[1mINSTALL\033[0m (%s) — a clean host. Empty data volumes, no backup and no\n      certificate yet are all EXPECTED here; see deploy/INSTALL.md.\n' "$MODE_WHY" ;;
  live)    printf 'Mode: \033[1mLIVE\033[0m (%s) — a stack that already holds data. Empty volumes and a\n      stale backup are real failures here.\n' "$MODE_WHY" ;;
  *)       echo "PREFLIGHT_MODE must be 'install' or 'live', not '${MODE}'." >&2; exit 2 ;;
esac
echo "      Override with: PREFLIGHT_MODE=install|live bash deploy/preflight.sh"

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
  # value is the RIGHT one, and that is what decides whether logged-in users stay
  # logged in or are all silently signed out. What "right" means differs by mode,
  # so the reminder does too — telling a first-time installer to compare against
  # an old stack that does not exist is how a warning gets trained out of someone.
  if [ "$MODE" = install ]; then
    warn "SECRET_KEY is new. Keep a copy somewhere you will still have next year: changing it later silently signs out every logged-in user, with no error anywhere."
  else
    warn "confirm by eye that SECRET_KEY is unchanged from what this stack was last started with — a different value signs every user out, silently"
  fi

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

  # S3_PUBLIC_URL is what presigned URLs are SIGNED FOR, and SigV4 covers the
  # Host header — so a wrong value cannot be rewritten afterwards by nginx or by
  # the client. It fails as "every audio file and avatar 404s" while every page
  # still renders perfectly, which reads as a broken feature rather than a typo.
  PUB="$(envval S3_PUBLIC_URL)"
  case "$PUB" in
    "")            bad "S3_PUBLIC_URL is empty" ;;
    */)            bad "S3_PUBLIC_URL ends with a slash ('${PUB}') — presigned URLs would carry a double slash" ;;
    http://*)      bad "S3_PUBLIC_URL is http (${PUB}); the site is https, and the signed host must match exactly" ;;
    *minio*|*localhost*|*127.0.0.1*)
                   bad "S3_PUBLIC_URL points at an internal address (${PUB}) — it must be the origin the BROWSER uses" ;;
    https://*)     ok "S3_PUBLIC_URL=${PUB}" ;;
    *)             bad "S3_PUBLIC_URL is not an https origin: ${PUB}" ;;
  esac

  # Catch the copy-paste directly: comparing against the shipped examples finds a
  # secret that survived from a template even when it looks random enough to pass
  # the length and placeholder checks above.
  for ex in .env.example deploy/env.prod.example; do
    [ -f "$ex" ] || continue
    EXV="$(sed -n 's/^SECRET_KEY=//p' "$ex" 2>/dev/null | head -1)"
    if [ -n "$EXV" ] && [ "$EXV" = "$SK" ]; then
      bad "SECRET_KEY is byte-for-byte the value in ${ex} — anyone with the repo can mint an admin token"
    fi
  done
fi

# ── 3b. The environment name, in the compose file itself ─────────────────────
# Not read from .env: docker-compose.prod.yml hardcodes these, and that is the
# point of checking. This single value decides whether the API's own secrets gate
# runs at all — on anything but Production it silently accepts dev OTP delivery,
# stock MinIO credentials and a placeholder signing key. The Worker is a generic
# host and reads the OTHER name, so both must be present or half the stack runs
# unguarded.
sec "3b. Environment name (Production, on both hosts)"
if [ -f "$COMPOSE_FILE" ] && [ -f "$ENV_FILE" ]; then
  RENDERED="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config 2>/dev/null || true)"
  for svc in api worker; do
    for var in ASPNETCORE_ENVIRONMENT DOTNET_ENVIRONMENT; do
      VAL="$(printf '%s' "$RENDERED" | awk -v s="  ${svc}:" -v v="$var" '
        $0 == s {inside=1; next}
        /^  [a-z]/ && $0 != s {inside=0}
        inside && $1 == v":" {print $2; exit}')"
      if [ "$VAL" = "Production" ]; then ok "${svc}: ${var}=Production"
      elif [ -z "$VAL" ];      then bad "${svc}: ${var} is NOT SET — that host would not be in Production"
      else                          bad "${svc}: ${var}=${VAL}, not Production — the secrets gate is disabled on that host"
      fi
    done
  done
fi

# ── 4. The data volumes ──────────────────────────────────────────────────────
# The check this whole file is worth writing for. `external: true` already stops
# compose from inventing an empty volume, but it cannot tell an empty volume from
# a full one — and in LIVE mode an empty Postgres volume produces a stack that is
# healthy in every mechanical sense and missing every user.
#
# In INSTALL mode the verdicts INVERT: empty is the expected and correct state,
# and the only real failure is a volume that does not exist at all, because
# `external: true` means compose will not create it for you.
sec "4. Data volumes"
if [ -f "$ENV_FILE" ]; then
  for pair in "PG_VOLUME:govori-pgdata:PG_VERSION" "MINIO_VOLUME:govori-miniodata:.minio.sys"; do
    var="${pair%%:*}"; rest="${pair#*:}"; def="${rest%%:*}"; marker="${rest#*:}"
    vol="$(envval "$var")"; vol="${vol:-$def}"
    if ! docker volume inspect "$vol" >/dev/null 2>&1; then
      if [ "$MODE" = install ]; then
        bad "${var}=${vol} does not exist. It is declared 'external: true', so compose will NOT create it — that is deliberate. Create it once:  docker volume create ${vol}"
      else
        bad "${var}=${vol} does not exist — compose will refuse to start (which is correct). Check the volume name against the running stack."
      fi
      continue
    fi
    if docker run --rm -v "${vol}:/v:ro" alpine test -e "/v/${marker}" 2>/dev/null; then
      SZ="$(docker run --rm -v "${vol}:/v:ro" alpine du -sh /v 2>/dev/null | cut -f1)"
      if [ "$MODE" = install ]; then
        warn "${var}=${vol} already contains data (${SZ}, found ${marker}). On a FIRST install this volume should be empty — you are re-running an install over an existing one. That is safe (migrations are idempotent) but it is not a clean slate; make sure it is the state you want."
      else
        ok "${var}=${vol} exists and is populated (${SZ}, found ${marker})"
      fi
    else
      if [ "$MODE" = install ]; then
        ok "${var}=${vol} exists and is empty — the correct starting point for a fresh install"
      else
        bad "${var}=${vol} exists but has no ${marker} — it is EMPTY. Starting on it would create a blank database that looks perfectly healthy."
      fi
    fi
  done
fi

# ── 4b. Is the schema there, and is there anyone who can administer it? ──────
# Informational, and only possible once Postgres is running — so it is skipped
# silently before that. It exists because the two questions it answers are the
# two a fresh install gets wrong in ways nothing else reports: a stack started
# before deploy/migrate.sh serves 500s from a perfectly healthy-looking api, and
# a stack with no admin row has an admin panel nobody on earth can open (sign-up
# always creates a student — Govori.Identity/AuthService.cs).
sec "4b. Database contents"
DB_CTR="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$DB_SERVICE" 2>/dev/null || true)"
if [ -z "$DB_CTR" ]; then
  ok "the '${DB_SERVICE}' service is not running yet — nothing to check (that is normal before the first start)"
else
  # Resolve the credentials ONCE and check them, rather than nesting three
  # unchecked `docker exec printenv` calls inside every query. If an exec fails,
  # its output is empty and the query would silently become `psql -U "" -d ""` —
  # which fails, gets swallowed by 2>/dev/null, and reads as "no schema". The
  # difference between "there is no schema" and "I could not ask" is the entire
  # value of this section.
  PG_U="$(docker exec "$DB_CTR" printenv POSTGRES_USER 2>/dev/null | tr -d '\r\n' || true)"
  PG_D="$(docker exec "$DB_CTR" printenv POSTGRES_DB   2>/dev/null | tr -d '\r\n' || true)"
  PG_P="$(docker exec "$DB_CTR" printenv POSTGRES_PASSWORD 2>/dev/null | tr -d '\r\n' || true)"
  DBQ() { docker exec -e PGPASSWORD="$PG_P" "$DB_CTR" \
            psql -U "$PG_U" -d "$PG_D" -A -t -c "$1" 2>/dev/null | tr -d '[:space:]'; }
  if [ -z "$PG_U" ] || [ -z "$PG_D" ]; then
    warn "could not read POSTGRES_USER/POSTGRES_DB out of the ${DB_SERVICE} container — skipping the schema and admin checks rather than guessing at them"
    MIGS="skip"
  else
    MIGS="$(DBQ 'SELECT count(*) FROM "__EFMigrationsHistory"' || true)"
  fi
  if [ "$MIGS" = skip ]; then
    :
  elif [ -z "$MIGS" ]; then
    if [ "$MODE" = install ]; then
      warn "no schema yet (no __EFMigrationsHistory). That is expected before INSTALL.md step 5 — apply it with: bash deploy/migrate.sh"
    else
      bad "the database has NO __EFMigrationsHistory table. A live stack cannot be in this state; see deploy/migrate.sh, which will tell you which situation you are in."
    fi
  else
    ok "${MIGS} EF migration(s) applied (list them: bash deploy/migrate.sh --list)"
    ADMINS="$(DBQ "SELECT count(*) FROM users WHERE role = 'admin'" || true)"
    case "${ADMINS:-x}" in
      x) warn "could not count admins — the users table is not readable" ;;
      0) bad "there are ZERO admin accounts. Nobody can open /admin, and self-service sign-up only ever creates students. Fix it: bash deploy/bootstrap-admin.sh --phone '+998…' --name '…'" ;;
      *) ok "${ADMINS} admin account(s) exist" ;;
    esac
  fi
fi

# ── 5. TLS ───────────────────────────────────────────────────────────────────
sec "5. TLS"
if [ -f nginx/certs/fullchain.pem ] && [ -f nginx/certs/privkey.pem ]; then
  # Guarded on openssl being present, because the failure without it is not
  # "cannot tell" — it is a PASS. Every read below would return empty, the
  # subject == issuer test would be false, and the script would report "issued
  # by ?, not self-signed" about a file it never managed to open.
  if ! command -v openssl >/dev/null 2>&1; then
    warn "certificate present, but there is no openssl on this host to inspect it — apt-get install -y openssl, or check it from a browser"
  else
  END="$(openssl x509 -enddate -noout -in nginx/certs/fullchain.pem 2>/dev/null | cut -d= -f2 || true)"
  # Self-signed means subject == issuer. Compared that way rather than by grepping
  # for a CN, because openssl prints the DN differently on every platform
  # ("issuer= /CN=x" on LibreSSL, "issuer=CN = x" on OpenSSL 3) — a string match
  # that works on the laptop silently never fires on the droplet.
  C_SUBJ="$(openssl x509 -noout -subject -in nginx/certs/fullchain.pem 2>/dev/null | sed 's/^subject=[= ]*//' || true)"
  C_ISS="$(openssl x509 -noout -issuer -in nginx/certs/fullchain.pem 2>/dev/null | sed 's/^issuer=[= ]*//' || true)"
  if [ -z "$C_SUBJ" ] || [ -z "$C_ISS" ]; then
    bad "nginx/certs/fullchain.pem exists but openssl cannot parse it as a certificate"
  elif [ "$C_SUBJ" = "$C_ISS" ]; then
    ok "certificate present, valid until ${END:-?}"
    warn "the certificate is SELF-SIGNED (${C_SUBJ}) — that is the bootstrap placeholder, browsers will reject it. Run deploy/setup-domain.sh for a real one."
  else
    ok "certificate present, valid until ${END:-?}, issued by ${C_ISS} (not self-signed)"
  fi
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
    if [ "$MODE" = install ]; then
      warn "port ${p} is published by: ${HOLDER}. On a clean host nothing should hold it — find out what that container is before nginx tries to bind it."
    else
      warn "port ${p} is published by: ${HOLDER} (normal if that is this stack's own nginx; a problem if it is a different stack)"
    fi
  elif command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE ":${p}\b"; then
    bad "port ${p} is held by a non-Docker process — nginx will not be able to bind it"
  else
    ok "port ${p} is free"
  fi
done

# ── 7. Disk ──────────────────────────────────────────────────────────────────
# The droplet BUILDS the images, so it needs room for the .NET SDK image, the
# BuildKit cache and two ~900 MB runtime images, on top of the database.
sec "7. Disk and swap"
FREE_GB="$(df -Pk / | awk 'NR==2 {printf "%d", $4/1048576}')"
if [ "${FREE_GB:-0}" -ge "$MIN_FREE_GB" ]; then
  ok "${FREE_GB} GB free on / (need ${MIN_FREE_GB}+ to build the images)"
else
  bad "only ${FREE_GB} GB free on / — the build needs ${MIN_FREE_GB}+. Reclaim with: docker image prune -f && docker builder prune -f  (NEVER 'system prune -a --volumes')"
fi

# Swap, because the .NET SDK build is the single most memory-hungry thing that
# ever happens on this host and a 1–2 GB droplet ships with none. Without swap
# the kernel does not slow the build down, it kills a process — and the one it
# picks is whichever is largest at that moment, which during a build is the
# compiler and afterwards is Postgres. `free` is Linux-only; on anything else
# this is not a meaningful question, so it is skipped rather than guessed at.
if command -v free >/dev/null 2>&1; then
  SWAP_MB="$(free -m | awk '/^Swap:/ {print $2}')"
  if [ "${SWAP_MB:-0}" -ge "$MIN_SWAP_MB" ]; then
    ok "${SWAP_MB} MB of swap"
  elif [ "${SWAP_MB:-0}" -eq 0 ]; then
    warn "NO SWAP. On a 1–2 GB droplet the .NET build gets OOM-killed rather than slowed down. Add 2 GB:  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab"
  else
    warn "only ${SWAP_MB} MB of swap; ${MIN_SWAP_MB}+ is safer while the images build"
  fi
else
  ok "not a Linux host — skipping the swap check"
fi

# ── 8. A backup that has been RESTORED ───────────────────────────────────────
# In INSTALL mode there is nothing to back up yet and no cron installed, so the
# absence of a dump is a to-do rather than a failure. It stays visible as a
# warning on purpose: "set the nightly backup up tomorrow" is the promise that
# never gets kept, and this line is the only thing that keeps asking.
sec "8. Backup"
LATEST="$(find "$BACKUP_DIR" -maxdepth 1 -name 'govori_*.dump' -type f 2>/dev/null | sort | tail -1 || true)"
if [ -n "$LATEST" ]; then
  AGE_H=$(( ( $(date -u +%s) - $(stat -c%Y "$LATEST" 2>/dev/null || stat -f%m "$LATEST") ) / 3600 ))
  SZ="$(stat -c%s "$LATEST" 2>/dev/null || stat -f%z "$LATEST")"
  if [ "$AGE_H" -le "$MAX_BACKUP_AGE_H" ]; then
    ok "latest backup $(basename "$LATEST") is ${AGE_H}h old (${SZ} bytes)"
  else
    bad "latest backup is ${AGE_H}h old — the nightly cron is not running"
  fi
  warn "a dump nobody restored is a hypothesis. Prove it: bash deploy/restore.sh --dump ${LATEST}"
elif [ "$MODE" = install ]; then
  warn "no backup in ${BACKUP_DIR} yet — expected before the first install, but it is the FIRST thing to do once the site is up. INSTALL.md step 9 installs the nightly cron (deploy/prod-backup-cron.sh)."
else
  bad "no backup in ${BACKUP_DIR} — install the cron first: deploy/prod-backup-cron.sh"
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
echo
printf '==> mode %s · %d passed, %d warnings, %d failed\n' "$MODE" "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
  if [ "$MODE" = install ]; then
    printf '\n\033[32mPREFLIGHT PASSED\033[0m — read the %d warning(s) above, then continue with deploy/INSTALL.md.\n' "$WARN"
  else
    printf '\n\033[32mPREFLIGHT PASSED\033[0m — read the %d warning(s) above, then continue.\n' "$WARN"
  fi
  exit 0
fi
printf '\n\033[31mPREFLIGHT FAILED\033[0m — fix the %d item(s) above before starting anything.\n' "$FAIL"
exit 1
