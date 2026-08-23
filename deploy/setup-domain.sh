#!/usr/bin/env bash
# One-time HTTPS setup for a domain via Let's Encrypt (webroot), and — the part
# that used to be missing — INSTALLING the renewal so it keeps working.
#
# PREREQUISITE: point DNS A-records for BOTH the apex and www at this server
# BEFORE running, and wait for propagation:
#     govorim.uz.      A   134.209.240.56
#     www.govorim.uz.  A   134.209.240.56
#
# Usage (on the server, from the repo root):
#     bash deploy/setup-domain.sh                 # uses defaults below
#     DOMAIN=govorim.uz EMAIL=you@mail.com bash deploy/setup-domain.sh
#     STAGING=1 bash deploy/setup-domain.sh       # test run (fake cert, no rate limit)
#     NO_CRON=1 bash deploy/setup-domain.sh       # skip installing the renewal cron
#
# RUN STAGING=1 FIRST. Let's Encrypt rate-limits failed authorisations hard (5 per
# hostname per hour), so a DNS record that has not propagated yet can lock the real
# certificate out for an hour — during the cutover window.
set -Eeuo pipefail

DOMAIN="${DOMAIN:-govorim.uz}"
EMAIL="${EMAIL:-abboskhan.me@gmail.com}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
CERTS_DIR="./nginx/certs"
LIVE_DIR="./certbot/conf/live/${DOMAIN}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

echo "==> Domain: ${DOMAIN} (+ www.${DOMAIN})   Email: ${EMAIL}"
[ -f "$COMPOSE_FILE" ] || { echo "FATAL: no ${COMPOSE_FILE} — run from the repo root"; exit 1; }

# These are BIND MOUNTS. Docker's rule for a missing mount source is "create it",
# and it creates a DIRECTORY — so a missing nginx/certs would become an empty
# directory and nginx would fail on a certificate it cannot find, which reads like
# a config error rather than a missing file. Create them properly, first.
mkdir -p "${CERTS_DIR}" ./certbot/www ./certbot/conf

# 1. nginx cannot start at all without a certificate to load, and certbot cannot
#    prove the domain without nginx serving :80. Break the cycle with a throwaway
#    self-signed cert; the real one replaces it four steps down.
if [ ! -f "${CERTS_DIR}/fullchain.pem" ]; then
  echo "==> No cert yet — generating a temporary self-signed cert so nginx can boot."
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "${CERTS_DIR}/privkey.pem" -out "${CERTS_DIR}/fullchain.pem" \
    -subj "/CN=${DOMAIN}" >/dev/null 2>&1
  chmod 600 "${CERTS_DIR}/privkey.pem"
fi

# 2. Bring the stack up so nginx serves the ACME challenge on port 80.
echo "==> Starting the stack…"
dc up -d

# Wait for nginx to actually answer rather than sleeping a fixed 5 s. On a cold
# droplet the api healthcheck has a 60 s start period, and `web` waits on it.
echo "==> Waiting for nginx to answer on :80…"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost/healthz" 2>/dev/null; then break; fi
  sleep 2
done
curl -fsS -o /dev/null "http://localhost/healthz" 2>/dev/null \
  || { echo "FATAL: nginx is not answering on :80. Check: docker compose -f ${COMPOSE_FILE} logs web"; exit 1; }
echo "    nginx is up"

# 3. Prove the ACME path reaches the shared webroot BEFORE asking Let's Encrypt.
#    A misconfigured webroot is the single most common cause of a failed
#    challenge, and finding out from LE costs one of five hourly attempts.
echo "==> Self-testing the ACME challenge path…"
PROBE="preflight-$(date +%s)"
echo "ok" > "./certbot/www/${PROBE}"
if [ "$(curl -fsS "http://localhost/.well-known/acme-challenge/${PROBE}" 2>/dev/null || true)" = "ok" ]; then
  echo "    challenge webroot is served correctly"
else
  rm -f "./certbot/www/${PROBE}"
  echo "FATAL: http://localhost/.well-known/acme-challenge/ does not serve ./certbot/www."
  echo "       Fix that before asking Let's Encrypt — a failed attempt costs one of five per hour."
  exit 1
fi
rm -f "./certbot/www/${PROBE}"

# 4. Ask Let's Encrypt for a real cert covering apex + www (HTTP-01 via webroot).
STAGING_FLAG=""
if [ "${STAGING:-0}" = "1" ]; then
  STAGING_FLAG="--staging"
  echo "==> STAGING mode: this issues an UNTRUSTED test certificate. Re-run without STAGING=1 for the real one."
fi
echo "==> Requesting certificate…"
dc run --rm certbot certonly --webroot -w /var/www/certbot \
  -d "${DOMAIN}" -d "www.${DOMAIN}" \
  --email "${EMAIL}" --agree-tos --no-eff-email ${STAGING_FLAG} --non-interactive

# 5. Publish the issued cert where nginx reads it, then reload.
#    certbot writes to ./certbot/conf/live/; nginx serves ./nginx/certs/. They are
#    different directories, and a certificate that is not copied across changes
#    nothing at all — which is the failure mode the renewal cron is built around.
echo "==> Installing cert and reloading nginx…"
cp "${LIVE_DIR}/fullchain.pem" "${CERTS_DIR}/fullchain.pem"
cp "${LIVE_DIR}/privkey.pem"   "${CERTS_DIR}/privkey.pem"
chmod 600 "${CERTS_DIR}/privkey.pem"
dc exec -T web nginx -t
dc exec -T web nginx -s reload

# 6. INSTALL the renewal, do not print it.
#    The previous version ended by echoing a five-command crontab line for the
#    operator to paste. That line either never got pasted, or got pasted and then
#    silently half-failed — `certbot renew` keeps exiting 0 while the copy-and-
#    reload half does nothing. Either way HTTPS works for ~60 days and then stops
#    at once, with no warning, on a certificate that renewed correctly all along.
if [ "${NO_CRON:-0}" = "1" ]; then
  echo "==> NO_CRON=1 — skipping renewal install. Do it by hand or HTTPS expires in ~90 days."
elif crontab -l 2>/dev/null | grep -q 'renew-cert.sh'; then
  echo "==> Renewal cron already installed."
else
  echo "==> Installing the renewal cron (twice daily; certbot only acts inside the last 30 days)…"
  CRON_LINE="17 3,15 * * * cd ${REPO_ROOT} && DOMAIN=${DOMAIN} bash deploy/renew-cert.sh >> /var/log/govori-cert.log 2>&1"
  ( crontab -l 2>/dev/null || true; echo "$CRON_LINE" ) | crontab -
  crontab -l 2>/dev/null | grep -q 'renew-cert.sh' \
    && echo "    installed: ${CRON_LINE}" \
    || { echo "FATAL: the crontab entry did not stick. Install it by hand:"; echo "  ${CRON_LINE}"; exit 1; }
fi

# 7. Report what is actually being served, not what was requested.
#
# The certificate is read OUT of the container and parsed here. The obvious
# `dc exec web openssl x509 …` cannot work — the web image is nginx:1.27-alpine
# and ships no openssl binary — so this step printed "unknown" for both lines on
# every successful run, i.e. the one check that confirms the new certificate
# actually reached nginx confirmed nothing. `cat` exists everywhere.
echo
echo "==> Verifying…"
SERVED_PEM="$(dc exec -T web cat /etc/nginx/certs/fullchain.pem 2>/dev/null || true)"
if [ -z "$SERVED_PEM" ]; then
  echo "    WARNING: could not read /etc/nginx/certs/fullchain.pem from the web container."
elif ! command -v openssl >/dev/null 2>&1; then
  echo "    (no openssl on this host — check the certificate from a browser)"
else
  SERVED_ISSUER="$(printf '%s\n' "$SERVED_PEM" | openssl x509 -issuer -noout 2>/dev/null || true)"
  SERVED_END="$(printf '%s\n' "$SERVED_PEM" | openssl x509 -enddate -noout 2>/dev/null | cut -d= -f2 || true)"
  echo "    nginx is serving: ${SERVED_ISSUER:-unreadable}"
  echo "    valid until:      ${SERVED_END:-unreadable}"
fi
echo
echo "==> Done. https://${DOMAIN} should now be live."
echo "    Renewal runs from cron; it logs to /var/log/govori-cert.log."
echo "    Test the whole renewal path without waiting 60 days:"
echo "      cd ${REPO_ROOT} && DOMAIN=${DOMAIN} bash deploy/renew-cert.sh"
