#!/usr/bin/env bash
# scripts/tests/proxy-origin-tls.test.sh
# Checks the shared proxy for the Cloudflare-proxied domain (owner decision 2026-11-04):
#   - site address hungrybro.pacewisdom.in, TLS from the Cloudflare Origin CA files (no ACME for it)
#   - plain HTTP redirects to HTTPS
#   - the proxy publishes exactly 80 and 443 and mounts the origin certificate read-only
#   - the Caddyfile validates with caddy validate (dummy certificate files, validation only)
#   - the deploy workflow reads EC2_HOST and DOMAIN from GitHub variables and pins the host key
set -euo pipefail
cd "$(dirname "$0")/../.."

fail() { echo "FAIL: $*" >&2; exit 1; }

CADDYFILE=proxy_server/Caddyfile
COMPOSE=proxy_server/docker-compose.yml
WF=.github/workflows/deploy.yml
HOST=hungrybro.pacewisdom.in

# --- Caddyfile ---------------------------------------------------------------
# Site block for the domain, with the origin certificate paths and nothing automatic.
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
SITE="$T/site.txt"
awk -v h="$HOST" '
  $0 ~ "^"h" \\{" { inside = 1; next }
  inside && /^\}/ { inside = 0 }
  inside { print }
' "$CADDYFILE" > "$SITE" || fail "cannot read site block"

grep -q "^$HOST {" "$CADDYFILE" || fail "Caddyfile has no site block for $HOST"
grep -q '^\s*tls /etc/caddy/origin/cert.pem /etc/caddy/origin/key.pem$' "$SITE" \
  || fail "site $HOST does not use the origin cert/key paths in tls"
grep -q 'reverse_proxy food-os-app:3000' "$SITE" || fail "site $HOST does not reverse_proxy food-os-app:3000"
grep -q 'header_up X-Real-IP {header.CF-Connecting-IP}' "$SITE" \
  || fail "site $HOST must take the client IP from CF-Connecting-IP"
if grep -Eq 'tls (internal|\{)|acme|ACME|\{\$DOMAIN\}|\{\$ACME_EMAIL\}' "$CADDYFILE"; then
  fail "Caddyfile still has automatic-certificate or env-driven site settings"
fi
if grep -Eq '^\s*email\b|auto_https|acme_ca' "$CADDYFILE"; then
  fail "Caddyfile still has global ACME settings (email, auto_https, acme_ca)"
fi

# HTTP must redirect to HTTPS (explicit block, not left to Caddy defaults).
grep -q "^http://$HOST {" "$CADDYFILE" || fail "no explicit http:// block for $HOST"
awk -v h="$HOST" '
  $0 ~ "^http://"h" \\{" { inside = 1; next }
  inside && /^\}/ { inside = 0 }
  inside { print }
' "$CADDYFILE" | grep -q "redir https://$HOST{uri} permanent" \
  || fail "http:// block does not redirect to https://$HOST"

# --- Compose -----------------------------------------------------------------
export ACME_EMAIL= DOMAIN=
pcfg=$(docker compose -f "$COMPOSE" config --format json) || fail "proxy compose does not render"
p() { echo "$pcfg" | jq -e "$1" >/dev/null || fail "proxy compose: $1"; }
p '.services.caddy.image == "caddy:2-alpine"'
p '[.services.caddy.ports[].published | tonumber] | sort == [80, 443]'
p '[.services.caddy.ports[].target | tonumber] | sort == [80, 443]'
p '(.services.caddy.environment // {} | has("ACME_EMAIL") | not)'
p '[.services.caddy.volumes[] | select(.target == "/etc/caddy/origin") | .read_only] == [true]'
p '[.services.caddy.volumes[] | select(.target == "/etc/caddy/origin") | .source] == ["/etc/caddy/origin"]'
p '(.services.caddy.networks | keys) == ["shared"]'

# --- Caddy validate (validation only, dummy certificate, never started) -----
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$HOST" \
  -keyout "$T/key.pem" -out "$T/cert.pem" >/dev/null 2>&1 || fail "cannot create dummy certificate"
set +e
vout=$(docker run --rm \
  -v "$PWD/$CADDYFILE:/etc/caddy/Caddyfile:ro" \
  -v "$T:/etc/caddy/origin:ro" \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1)
vrc=$?
set -e
[ "$vrc" -eq 0 ] && echo "$vout" | grep -q 'Valid configuration' || fail "caddy validate failed: $vout"

# --- Deploy workflow ---------------------------------------------------------
grep -q 'EC2_HOST: \${{ vars.EC2_HOST }}' "$WF" || fail "deploy.yml must read EC2_HOST from vars"
grep -q 'secrets.EC2_HOST[^_]' "$WF" && fail "deploy.yml still reads EC2_HOST from secrets"
grep -q 'secrets.DOMAIN' "$WF" && fail "deploy.yml still reads DOMAIN from secrets"
grep -q 'secrets.EC2_HOST_KEY' "$WF" || fail "deploy.yml must pin the host key from secrets.EC2_HOST_KEY"
grep -q 'StrictHostKeyChecking=yes' "$WF" || fail "deploy.yml must keep StrictHostKeyChecking=yes"
grep -q 'UserKnownHostsFile=' "$WF" || fail "deploy.yml must use a pinned known_hosts file"
grep -q 'https://\${{ vars.DOMAIN }}/api/health' "$WF" || fail "deploy.yml health check must use vars.DOMAIN"

echo "proxy origin TLS OK"
