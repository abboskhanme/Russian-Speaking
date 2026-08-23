#!/usr/bin/env bash
# Renew the Let's Encrypt certificate and put the new one where nginx reads it.
#
# WHY THIS IS A SCRIPT AND NOT A CRON ONE-LINER
# The previous setup PRINTED a five-command shell pipeline for the operator to
# paste into root's crontab. Two things go wrong with that, and both are silent:
# the line never gets pasted, or it gets pasted and the `cp`-then-reload half
# fails while `certbot renew` keeps exiting 0. Either way nothing is wrong for 60
# days and then the site stops answering HTTPS at once, with no warning, on a
# certificate that was renewed correctly the whole time.
#
# The copy is the part that matters. certbot renews into ./certbot/conf/live/,
# but nginx serves ./nginx/certs/ — they are different directories, and a renewal
# that is not copied across changes nothing at all.
#
# INSTALL: deploy/setup-domain.sh installs the crontab entry that runs this. To do
# it by hand:
#   (crontab -l; echo "17 3,15 * * * cd $PWD && bash deploy/renew-cert.sh >> /var/log/govori-cert.log 2>&1") | crontab -
#
# Twice a day is what certbot recommends: renewal only acts inside the last 30
# days of validity, so the extra runs cost one no-op each and buy ~60 chances to
# recover from a transient failure before anything expires.
#
# Exit 0 = the certificate nginx is serving is valid and not near expiry.
set -Eeuo pipefail

DOMAIN="${DOMAIN:-govorim.uz}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
CERTS_DIR="${CERTS_DIR:-./nginx/certs}"
LIVE_DIR="${LIVE_DIR:-./certbot/conf/live/${DOMAIN}}"
# Warn when fewer than this many days remain. certbot renews at 30; if we are
# still under 21 after a renew attempt, the renewal is not working.
WARN_DAYS="${WARN_DAYS:-21}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FATAL: $*"; exit 1; }

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

log "=== govori cert renewal (${DOMAIN}) ==="
[ -f "$COMPOSE_FILE" ] || die "compose file not found: ${COMPOSE_FILE} (run from the repo root)"

# `run --rm` activates the certbot service's `tools` profile on its own, so the
# service stays out of `up -d`.
log "certbot renew"
dc run --rm certbot renew --webroot -w /var/www/certbot --quiet

[ -f "${LIVE_DIR}/fullchain.pem" ] || die "no issued certificate at ${LIVE_DIR} — run deploy/setup-domain.sh first"

# Only copy and reload when the file actually changed. A reload per cron run is
# harmless but it makes the log unreadable, and an unreadable log is how a real
# failure goes unnoticed for two months.
if cmp -s "${LIVE_DIR}/fullchain.pem" "${CERTS_DIR}/fullchain.pem" 2>/dev/null; then
  log "certificate unchanged — nothing to deploy"
else
  log "new certificate — copying to ${CERTS_DIR} and reloading nginx"
  cp "${LIVE_DIR}/fullchain.pem" "${CERTS_DIR}/fullchain.pem"
  cp "${LIVE_DIR}/privkey.pem"   "${CERTS_DIR}/privkey.pem"
  chmod 600 "${CERTS_DIR}/privkey.pem"
  # Validate BEFORE reloading: `nginx -s reload` on a broken config leaves the old
  # workers serving and returns 0, so a bad cert would look like a successful
  # renewal right up until the next restart.
  dc exec -T web nginx -t
  dc exec -T web nginx -s reload
  log "nginx reloaded"
fi

# ── The check the old one-liner never made ───────────────────────────────────
# Ask the RUNNING nginx what it is actually serving, not what is on disk. This is
# the only assertion that distinguishes "renewal ran" from "renewal worked".
#
# The certificate is read OUT of the container and parsed by the HOST's openssl.
# Running openssl INSIDE the container cannot work — the web image is
# nginx:1.27-alpine and has no openssl binary — so this line produced an empty
# END on every run and the guard below turned every otherwise-successful renewal
# into a FATAL. Twice a day, from cron, for as long as the cron had been
# installed. `cat` exists in every image.
[ -n "$(command -v openssl || true)" ] || die "openssl is not installed on this host; the renewal cannot verify what nginx is serving"
END="$(dc exec -T web cat /etc/nginx/certs/fullchain.pem 2>/dev/null \
       | openssl x509 -enddate -noout 2>/dev/null | cut -d= -f2 || true)"
[ -n "$END" ] || die "could not read the certificate nginx is serving"

END_EPOCH="$(date -u -d "$END" +%s 2>/dev/null || date -u -j -f '%b %e %T %Y %Z' "$END" +%s 2>/dev/null || echo 0)"
NOW_EPOCH="$(date -u +%s)"
if [ "$END_EPOCH" -gt 0 ]; then
  DAYS_LEFT=$(( (END_EPOCH - NOW_EPOCH) / 86400 ))
  log "nginx is serving a certificate valid until ${END} (${DAYS_LEFT} days)"
  [ "$DAYS_LEFT" -ge "$WARN_DAYS" ] \
    || die "only ${DAYS_LEFT} days left after a renewal attempt — renewal is NOT working, investigate now"
else
  log "nginx is serving a certificate valid until ${END} (could not parse the date to check the margin)"
fi

log "=== done ==="
