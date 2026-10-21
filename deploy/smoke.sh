#!/usr/bin/env bash
# =============================================================================
# SMOKE — is the thing that just started actually serving the product?
# =============================================================================
#
# Read-only. It creates no account, submits nothing and writes nothing.
#
# WHY IT IS SEPARATE FROM preflight.sh
#   preflight asks "may I start?" and runs before anything is up. This asks "did
#   it work?" and runs after. They fail at opposite ends of the same install, and
#   merging them would mean half the checks are meaningless on every run.
#
# WHAT IT DELIBERATELY CANNOT DO
#   Record audio, submit an answer, and confirm it comes back graded. That path
#   crosses the api, the worker, ffmpeg, MinIO and a paid AI vendor, and there is
#   no honest way to assert it from a shell script without creating a real
#   account and spending real money. The last section prints it as a human step
#   instead of pretending. An install is not finished until someone has done it.
#
# USAGE (on the droplet, from the repo root)
#   bash deploy/smoke.sh
#   DOMAIN=govorim.uz bash deploy/smoke.sh
#   HTTP_BASE=http://localhost:8091 HTTPS_BASE=https://localhost:8444 INSECURE_TLS=1 \
#     bash deploy/smoke.sh            # against a local stack on non-standard ports
#
# ENVIRONMENT
#   COMPOSE_FILE  default docker-compose.prod.yml
#   ENV_FILE      default .env  (read for GOVORI_SERVER_NAME; never sourced)
#   DOMAIN        default: GOVORI_SERVER_NAME from the env file
#   INSECURE_TLS  1 to accept a self-signed / staging certificate
#
# Exit 0 = the stack is serving. Non-zero = something named below is wrong.
# =============================================================================
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env}"
DB_SERVICE="${DB_SERVICE:-db}"

PASS=0; FAIL=0; WARN=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; WARN=$((WARN+1)); }
sec()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# Never `source` a production .env: it holds AI keys containing `$`, backticks
# and quotes, and sourcing would execute them.
envval() { sed -n "s/^${1}=//p" "$ENV_FILE" 2>/dev/null | head -1 | sed 's/[[:space:]]*$//'; }

DOMAIN="${DOMAIN:-$(envval GOVORI_SERVER_NAME)}"
[ -n "$DOMAIN" ] || { echo "No DOMAIN and no GOVORI_SERVER_NAME in ${ENV_FILE}." >&2; exit 2; }
HTTP_BASE="${HTTP_BASE:-http://${DOMAIN}}"
HTTPS_BASE="${HTTPS_BASE:-https://${DOMAIN}}"
K=""; [ "${INSECURE_TLS:-0}" = "1" ] && K="-k"

dc() {
  if [ -n "${ENV_FILE:-}" ] && [ -f "$ENV_FILE" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

# `curl -k` is word-split on purpose — $K is either empty or exactly "-k", and
# quoting it would pass an empty argument that curl reads as a URL.
# shellcheck disable=SC2086
code() { curl -sS $K -o /dev/null -w '%{http_code}' --max-time 20 "$@" 2>/dev/null || echo 000; }
# shellcheck disable=SC2086
body() { curl -sS $K --max-time 20 "$@" 2>/dev/null || true; }

echo "Govori smoke — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "      ${HTTP_BASE}  ·  ${HTTPS_BASE}"

# ── 1. Containers ────────────────────────────────────────────────────────────
# Checked first because everything below it would otherwise fail as "connection
# refused", which says nothing about which of six services is the problem.
sec "1. Containers"
for svc in db redis minio api worker web; do
  CTR="$(dc ps -q "$svc" 2>/dev/null || true)"
  if [ -z "$CTR" ]; then
    bad "${svc} is not running"
    continue
  fi
  STATE="$(docker inspect --format '{{.State.Status}}' "$CTR")"
  HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CTR")"
  case "${STATE}/${HEALTH}" in
    running/healthy) ok "${svc} is running and healthy" ;;
    running/none)    ok "${svc} is running (no healthcheck defined)" ;;
    running/starting) warn "${svc} is still starting — re-run in a minute" ;;
    *)               bad "${svc} is ${STATE} (health: ${HEALTH})" ;;
  esac
done
# minio-init is a one-shot (bucket + the app's own MinIO user and policy). `Exited (0)` is its healthy steady
# state, and reading it as a crash is the most common false alarm on this stack.
INIT="$(dc ps -aq minio-init 2>/dev/null || true)"
if [ -n "$INIT" ]; then
  RC="$(docker inspect --format '{{.State.ExitCode}}' "$INIT")"
  [ "$RC" = "0" ] && ok "minio-init exited 0 (one-shot bucket + app user setup — not a crash)" \
                  || bad "minio-init exited ${RC} — the audio bucket or the app's MinIO user may not exist; the api/worker would 403 on storage"
fi

# ── 2. HTTP → HTTPS ──────────────────────────────────────────────────────────
sec "2. HTTP"
C="$(code "${HTTP_BASE}/healthz")"
[ "$C" = "200" ] && ok "GET /healthz over http → 200 (nginx is alive)" \
                 || bad "GET /healthz over http → ${C}"
# The redirect must survive on :80 because ACME renewal and every bookmark start
# there. A stack whose http:// vhost stops redirecting looks fine to anyone
# already using https and breaks certificate renewal 60 days later.
LOC="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "${HTTP_BASE}/" 2>/dev/null || echo "000 ")"
case "$LOC" in
  30[18]\ https://*) ok "GET / over http → ${LOC}" ;;
  200*)              bad "GET / over http → 200: plain http is being SERVED, not redirected" ;;
  *)                 bad "GET / over http → ${LOC}" ;;
esac

# ── 3. HTTPS + the API ───────────────────────────────────────────────────────
sec "3. HTTPS and the API"
PING="$(body "${HTTPS_BASE}/api/ping")"
case "$PING" in
  *'"status":"ok"'*) ok "GET /api/ping → ${PING}" ;;
  "")                bad "GET /api/ping returned nothing — is TLS working? (INSECURE_TLS=1 to accept a self-signed cert)" ;;
  *)                 bad "GET /api/ping → ${PING}" ;;
esac

# The single most consequential line in this file. `"otp_delivery":"dev"` means
# the api is running the development OTP sender, whose fixed code 000000 logs
# ANYONE in as ANY phone number — the site looks completely healthy while having
# no authentication at all. It reaches production only via
# GOVORI_ALLOW_INSECURE_PRODUCTION, since the boot gate otherwise refuses to
# start without the Telegram values.
CFG="$(body "${HTTPS_BASE}/api/auth/config")"
case "$CFG" in
  *'"otp_delivery":"dev"'*)
      bad "GET /api/auth/config says otp_delivery=dev — the fixed code 000000 logs anyone in as any phone number. STOP: unset GOVORI_ALLOW_INSECURE_PRODUCTION, set TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME, restart the api." ;;
  *'"otp_delivery":"telegram_bot"'*)
      ok "GET /api/auth/config → ${CFG}" ;;
  *)  bad "GET /api/auth/config → ${CFG:-<empty>}" ;;
esac

# The SPA, not just any 200: nginx serves index.html as the fallback for every
# unknown path, so a broken build still answers 200 on /. The asset reference is
# what says a real bundle was built into the image.
INDEX="$(body "${HTTPS_BASE}/")"
case "$INDEX" in
  *"<!doctype html"*|*"<!DOCTYPE html"*)
      case "$INDEX" in
        *"/assets/"*) ok "GET / serves the SPA, and it references a built /assets/ bundle" ;;
        *)            bad "GET / serves HTML with no /assets/ reference — the frontend build did not land in the image" ;;
      esac ;;
  *)  bad "GET / did not return HTML" ;;
esac

# Authorised, and proven so. 401 (not 404, not 502) is the shape that says the
# hub is mapped, nginx proxies the upgrade, and the endpoint is behind auth.
C="$(code "${HTTPS_BASE}/hubs/attempts")"
case "$C" in
  401) ok "GET /hubs/attempts → 401 (the realtime hub is mapped and requires a token)" ;;
  404) warn "GET /hubs/attempts → 404 — nginx is not proxying the hub" ;;
  *)   warn "GET /hubs/attempts → ${C} (expected 401)" ;;
esac

# ── 4. TLS ───────────────────────────────────────────────────────────────────
sec "4. Certificate"
# The certificate is READ OUT of the container and parsed by the HOST's openssl.
# The obvious version — `docker exec web openssl x509 …` — cannot work: the web
# image is nginx:1.27-alpine, which ships no openssl binary. Worse than not
# working, it fails in a way that lies: the exec error text lands in both the
# issuer and the subject variable, they compare equal, and the "subject == issuer
# means self-signed" test reports a perfectly good Let's Encrypt certificate as
# self-signed. `cat` exists everywhere; parse on this side.
WEB="$(dc ps -q web 2>/dev/null || true)"
if [ -z "$WEB" ]; then
  bad "the web container is not running — cannot read the certificate"
elif ! command -v openssl >/dev/null 2>&1; then
  warn "no openssl on this host — cannot inspect the certificate. Check it from a browser instead."
else
  PEM="$(docker exec "$WEB" cat /etc/nginx/certs/fullchain.pem 2>/dev/null || true)"
  if [ -z "$PEM" ]; then
    bad "no certificate at /etc/nginx/certs/fullchain.pem inside the web container"
  else
    ISSUER="$(printf '%s\n' "$PEM" | openssl x509 -issuer -noout 2>/dev/null | sed 's/^issuer=[= ]*//')"
    SUBJ="$(printf '%s\n' "$PEM" | openssl x509 -subject -noout 2>/dev/null | sed 's/^subject=[= ]*//')"
    ENDS="$(printf '%s\n' "$PEM" | openssl x509 -enddate -noout 2>/dev/null | cut -d= -f2)"
    if [ -z "$ISSUER" ]; then
      bad "the file at /etc/nginx/certs/fullchain.pem is not a readable certificate"
    elif [ "$ISSUER" = "$SUBJ" ]; then
      # Subject == issuer rather than grepping for a CN: openssl prints the DN
      # differently on every platform, so a string match that works on a laptop
      # can silently never fire on the droplet.
      bad "the certificate is SELF-SIGNED (${SUBJ}) — browsers will reject it. That is deploy/setup-domain.sh's bootstrap placeholder; run it to get the real one."
    else
      case "$ISSUER" in
        *STAGING*|*"Fake LE"*)
          warn "the certificate is a Let's Encrypt STAGING cert (${ISSUER}) — untrusted by browsers. Re-run deploy/setup-domain.sh WITHOUT STAGING=1." ;;
        *) ok "certificate issued by ${ISSUER}, valid until ${ENDS}" ;;
      esac
    fi
  fi
fi
# Without the renewal cron HTTPS works for ~60 days and then stops at once, on a
# certificate that was renewing correctly all along but was never copied to where
# nginx reads it.
if crontab -l 2>/dev/null | grep -q 'renew-cert'; then
  ok "certificate renewal is installed in crontab"
else
  warn "no renewal cron — HTTPS will expire in ~90 days with no warning. deploy/setup-domain.sh installs it."
fi

# ── 5. Data ──────────────────────────────────────────────────────────────────
sec "5. Data"
DB_CTR="$(dc ps -q "$DB_SERVICE" 2>/dev/null || true)"
if [ -z "$DB_CTR" ]; then
  bad "the ${DB_SERVICE} service is not running"
else
  # Credentials resolved ONCE and checked. Nesting `docker exec printenv` inside
  # the query would turn a failed exec into `psql -U "" -d ""`, whose error is
  # swallowed by 2>/dev/null and reads as "no schema" — reporting a problem with
  # the database when the problem was that we never reached it.
  PG_U="$(docker exec "$DB_CTR" printenv POSTGRES_USER 2>/dev/null | tr -d '\r\n' || true)"
  PG_D="$(docker exec "$DB_CTR" printenv POSTGRES_DB   2>/dev/null | tr -d '\r\n' || true)"
  PG_P="$(docker exec "$DB_CTR" printenv POSTGRES_PASSWORD 2>/dev/null | tr -d '\r\n' || true)"
  if [ -z "$PG_U" ] || [ -z "$PG_D" ]; then
    bad "could not read POSTGRES_USER/POSTGRES_DB out of the ${DB_SERVICE} container"
  else
    DBQ() { docker exec -e PGPASSWORD="$PG_P" "$DB_CTR" \
              psql -U "$PG_U" -d "$PG_D" -A -t -c "$1" 2>/dev/null | tr -d '[:space:]'; }
    MIGS="$(DBQ 'SELECT count(*) FROM "__EFMigrationsHistory"' || true)"
    if [ -n "$MIGS" ]; then
      ok "${MIGS} EF migration(s) applied"
    else
      bad "no __EFMigrationsHistory table — the schema was never applied. Run: bash deploy/migrate.sh"
    fi
    ADM="$(DBQ "SELECT count(*) FROM users WHERE role = 'admin'" || true)"
    case "${ADM:-x}" in
      x) bad "cannot read the users table" ;;
      0) bad "ZERO admin accounts — /admin is unreachable by anyone. Run: bash deploy/bootstrap-admin.sh --phone '+998…' --name '…'" ;;
      *) ok "${ADM} admin account(s)" ;;
    esac
  fi
fi
# The audio proxy. A 403/404 FROM MINIO is the healthy answer for a bucket root
# with no anonymous policy; 502 means nginx cannot reach MinIO at all, which is
# the failure that shows up later as "every recording 404s" while every page
# renders perfectly.
BUCKET="$(envval S3_BUCKET)"
if [ -n "$BUCKET" ]; then
  C="$(code "${HTTPS_BASE}/${BUCKET}/")"
  case "$C" in
    403|404|200) ok "GET /${BUCKET}/ → ${C} (nginx reaches MinIO)" ;;
    502|504)     bad "GET /${BUCKET}/ → ${C} — nginx cannot reach MinIO. Audio and avatars would 404 while every page still renders." ;;
    *)           warn "GET /${BUCKET}/ → ${C}" ;;
  esac
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
echo
printf '==> %d passed, %d warnings, %d failed\n' "$PASS" "$WARN" "$FAIL"
cat <<EOF

Two things no script can check. Do them now, in a browser, on a phone:

  1. Register a new account with a real number. The code must arrive in Telegram.
     If it does not, nobody can sign up — and no error appears anywhere.
  2. Record and submit one answer, and wait for the grade. That is the only check
     that exercises the api, the worker, ffmpeg, MinIO and the AI chain at once.
     If it stays "processing", read:  docker compose -f ${COMPOSE_FILE} logs worker
EOF

if [ "$FAIL" -eq 0 ]; then
  printf '\n\033[32mSMOKE PASSED\033[0m — %d warning(s) above.\n' "$WARN"
  exit 0
fi
printf '\n\033[31mSMOKE FAILED\033[0m — %d item(s) above.\n' "$FAIL"
exit 1
