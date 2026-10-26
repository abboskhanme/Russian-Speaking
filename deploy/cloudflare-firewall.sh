#!/usr/bin/env bash
# =============================================================================
# CLOUDFLARE-FIREWALL — once govorim.uz is proxied by Cloudflare, accept web
# traffic (80/443) only from Cloudflare. Everything else still reaches SSH (22).
# =============================================================================
#
# WHY
#   Behind Cloudflare the origin's IP is the one thing that lets an attacker skip
#   Cloudflare entirely — its DDoS absorption, its WAF, and the CF-Connecting-IP
#   that nginx/cloudflare-realip.conf trusts. Closing 80/443 to everyone else makes
#   Cloudflare the only way in.
#
#   ufw ALONE DOES NOT DO THIS. Docker publishes nginx's ports by DNAT, so IPv4
#   traffic to them is FORWARDED to the container and never meets ufw's INPUT
#   rules. The rule has to live in DOCKER-USER, the chain Docker reserves for the
#   operator and never rewrites. IPv6 (no IPv6 on the compose network) is served
#   by docker-proxy on the host, which is INPUT — that half is ufw's.
#
# USAGE (on the server, as root)
#   bash deploy/cloudflare-firewall.sh            # fetch live ranges, check, apply, persist
#   bash deploy/cloudflare-firewall.sh --status   # what is in force
#   bash deploy/cloudflare-firewall.sh --off      # back to 80/443 open to all
#   (--boot is what the systemd unit runs: the saved ranges, no network needed)
#
# It refuses to apply unless http://$DOMAIN answers THROUGH Cloudflare (a cf-ray
# header). With the DNS record grey-clouded, or not yet propagated, locking the
# origin to Cloudflare would take the site down. FORCE=1 skips that check.
# =============================================================================
set -euo pipefail

die()  { echo "FATAL: $*" >&2; exit 1; }
info() { echo "==> $*"; }

DOMAIN="${DOMAIN:-govorim.uz}"
CHAIN="GOVORI-CF"
SAVE_DIR="/etc/govori"
SAVE_V4="${SAVE_DIR}/cloudflare-ips-v4"
SAVE_V6="${SAVE_DIR}/cloudflare-ips-v6"
UNIT="/etc/systemd/system/govori-cf-firewall.service"
SELF="/usr/local/sbin/govori-cf-firewall"
REALIP_CONF="${REALIP_CONF:-$(cd "$(dirname "$0")" && pwd)/nginx/cloudflare-realip.conf}"
IFACE="${IFACE:-$(ip route show default | awk '{print $5; exit}')}"

[ "$(id -u)" = 0 ] || die "run as root"
[ -n "$IFACE" ] || die "could not find the default-route interface; set IFACE="
MODE="${1:-apply}"

# A list is only used if every line is a CIDR and there are enough of them —
# a captive page or an empty body must never become the allow-list.
valid_list() {  # $1 = v4|v6, stdin = list
  local re n
  [ "$1" = v4 ] && re='^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' || re='^[0-9a-f:]+/[0-9]{1,3}$'
  n=0
  while read -r line; do
    [ -z "$line" ] && continue
    [[ "$line" =~ $re ]] || return 1
    n=$((n + 1))
  done
  [ "$n" -ge 5 ]
}

status() {
  echo "-- DOCKER-USER (IPv4, published ports):"
  iptables -S DOCKER-USER 2>/dev/null | sed 's/^/   /'
  if iptables -S "$CHAIN" >/dev/null 2>&1; then
    echo "   $CHAIN: $(iptables -S "$CHAIN" | grep -c -- '-j RETURN') Cloudflare ranges, then DROP"
  else
    echo "   $CHAIN: absent — 80/443 open to everyone"
  fi
  echo "-- ufw:"
  ufw status | grep -E '^(80|443|22)|cloudflare' | sed 's/^/   /' || true
  echo "-- unit: $(systemctl is-enabled govori-cf-firewall 2>/dev/null || echo absent)"
}

off() {
  while iptables -C DOCKER-USER -i "$IFACE" -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j "$CHAIN" 2>/dev/null; do
    iptables -D DOCKER-USER -i "$IFACE" -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j "$CHAIN"
  done
  iptables -F "$CHAIN" 2>/dev/null || true
  iptables -X "$CHAIN" 2>/dev/null || true
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw status numbered | grep -E 'cloudflare' | grep -oE '^\[ *[0-9]+\]' | tr -d '[] ' | sort -rn \
    | while read -r n; do ufw --force delete "$n" >/dev/null; done
  systemctl disable --now govori-cf-firewall >/dev/null 2>&1 || true
  info "80/443 are open to everyone again"
}

apply_lists() {  # reads $SAVE_V4 / $SAVE_V6
  # IPv4 — DOCKER-USER. Only NEW connections arriving from the internet on the
  # web ports: replies to the containers' own outbound calls (AI vendors,
  # Telegram) and container-to-container traffic are never matched.
  iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"
  while read -r cidr; do
    [ -n "$cidr" ] && iptables -A "$CHAIN" -s "$cidr" -j RETURN
  done < "$SAVE_V4"
  iptables -A "$CHAIN" -j DROP
  iptables -C DOCKER-USER -i "$IFACE" -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j "$CHAIN" 2>/dev/null \
    || iptables -I DOCKER-USER 1 -i "$IFACE" -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j "$CHAIN"
}

apply_ufw() {
  local cidr
  for cidr in $(cat "$SAVE_V4" "$SAVE_V6"); do
    ufw allow proto tcp from "$cidr" to any port 80,443 comment cloudflare >/dev/null
  done
  ufw delete allow 80/tcp >/dev/null 2>&1 || true
  ufw delete allow 443/tcp >/dev/null 2>&1 || true
}

install_unit() {
  [ "$(readlink -f "$0")" = "$SELF" ] || install -m 0755 "$0" "$SELF"
  cat > "$UNIT" <<EOF
[Unit]
Description=Govori: web ports only from Cloudflare (DOCKER-USER)
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$SELF --boot

[Install]
WantedBy=docker.service
EOF
  systemctl daemon-reload
  systemctl enable govori-cf-firewall >/dev/null 2>&1
}

case "$MODE" in
  --status) status; exit 0 ;;
  --off)    off; status; exit 0 ;;
  --boot)
    [ -s "$SAVE_V4" ] || die "no saved ranges in $SAVE_V4 — run without --boot once"
    apply_lists
    exit 0 ;;
  apply) ;;
  *) die "unknown argument: $MODE (see the header)" ;;
esac

info "fetching Cloudflare's published ranges"
V4="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4)" || die "could not fetch ips-v4"
V6="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6)" || die "could not fetch ips-v6"
printf '%s\n' "$V4" | valid_list v4 || die "ips-v4 did not look like a list of IPv4 ranges — refusing to use it"
printf '%s\n' "$V6" | valid_list v6 || die "ips-v6 did not look like a list of IPv6 ranges — refusing to use it"
echo "    $(printf '%s\n' "$V4" | grep -c /) IPv4, $(printf '%s\n' "$V6" | grep -c /) IPv6"

# nginx trusts CF-Connecting-IP only from the ranges in cloudflare-realip.conf.
# If Cloudflare has added one, visitors through it would all share that edge's address.
if [ -f "$REALIP_CONF" ]; then
  LIVE="$(printf '%s\n%s\n' "$V4" "$V6" | grep / | sort)"
  CONF="$(grep -oE '^set_real_ip_from [^;]+' "$REALIP_CONF" | awk '{print $2}' | sort)"
  [ "$LIVE" = "$CONF" ] || echo "WARN: $REALIP_CONF differs from Cloudflare's live list — update it and recreate the web container"
fi

if [ "${FORCE:-0}" != 1 ]; then
  info "checking that http://$DOMAIN answers through Cloudflare"
  curl -sS -o /dev/null -D - --max-time 15 "http://$DOMAIN/" 2>/dev/null | grep -qi '^cf-ray:' \
    || die "http://$DOMAIN did not answer through Cloudflare (no cf-ray header). Is the DNS record proxied (orange cloud) and propagated? Locking now would take the site down. FORCE=1 to override."
  echo "    yes"
fi

mkdir -p "$SAVE_DIR"
printf '%s\n' "$V4" | grep / > "$SAVE_V4"
printf '%s\n' "$V6" | grep / > "$SAVE_V6"

info "applying: DOCKER-USER (IPv4) and ufw (IPv6 and the host)"
apply_lists
apply_ufw
install_unit
status
