#!/usr/bin/env bash
# One-time HTTPS setup for a domain via Let's Encrypt (webroot).
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
set -euo pipefail

DOMAIN="${DOMAIN:-govorim.uz}"
EMAIL="${EMAIL:-abboskhan.me@gmail.com}"
COMPOSE="docker compose -f docker-compose.prod.yml"
CERTS_DIR="./nginx/certs"
LIVE_DIR="./certbot/conf/live/${DOMAIN}"

echo "==> Domain: ${DOMAIN} (+ www.${DOMAIN})   Email: ${EMAIL}"
mkdir -p "${CERTS_DIR}" ./certbot/www ./certbot/conf

# 1. Ensure nginx can start: if there's no cert yet, drop a temporary self-signed
#    one so the :443 server block is valid (real cert replaces it below).
if [ ! -f "${CERTS_DIR}/fullchain.pem" ]; then
  echo "==> No cert yet — generating a temporary self-signed cert so nginx can boot."
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "${CERTS_DIR}/privkey.pem" -out "${CERTS_DIR}/fullchain.pem" \
    -subj "/CN=${DOMAIN}" >/dev/null 2>&1
fi

# 2. Bring the stack up so nginx serves the ACME challenge on port 80.
echo "==> Starting the stack…"
${COMPOSE} up -d
sleep 5

# 3. Ask Let's Encrypt for a real cert covering apex + www (HTTP-01 via webroot).
STAGING_FLAG=""
[ "${STAGING:-0}" = "1" ] && STAGING_FLAG="--staging" && echo "==> STAGING mode (test cert)."
echo "==> Requesting certificate…"
${COMPOSE} run --rm certbot certonly --webroot -w /var/www/certbot \
  -d "${DOMAIN}" -d "www.${DOMAIN}" \
  --email "${EMAIL}" --agree-tos --no-eff-email ${STAGING_FLAG} --non-interactive

# 4. Publish the issued cert where nginx reads it, then reload.
echo "==> Installing cert and reloading nginx…"
cp "${LIVE_DIR}/fullchain.pem" "${CERTS_DIR}/fullchain.pem"
cp "${LIVE_DIR}/privkey.pem"   "${CERTS_DIR}/privkey.pem"
${COMPOSE} exec web nginx -s reload

echo "==> Done. https://${DOMAIN} should now be live with a trusted certificate."
echo "    Renewal: add this to root's crontab (runs twice a day):"
echo "    0 3,15 * * *  cd $(pwd) && ${COMPOSE} run --rm certbot renew --webroot -w /var/www/certbot --quiet && cp ${LIVE_DIR}/fullchain.pem ${CERTS_DIR}/ && cp ${LIVE_DIR}/privkey.pem ${CERTS_DIR}/ && ${COMPOSE} exec web nginx -s reload"
