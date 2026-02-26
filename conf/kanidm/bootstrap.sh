#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------------------
# 1. Resolve project root and load environment files
# ------------------------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

KANIDM_ENV="$PROJECT_ROOT/env/kanidm.env"
OPENOBSERVE_ENV="$PROJECT_ROOT/env/openobserve.env"

if [[ ! -f "$KANIDM_ENV" ]]; then
  echo "[-] Error: Missing $KANIDM_ENV" >&2
  exit 1
fi

if [[ ! -f "$OPENOBSERVE_ENV" ]]; then
  echo "[-] Error: Missing $OPENOBSERVE_ENV" >&2
  exit 1
fi

# Export variables from the env files
set -a
source "$KANIDM_ENV"
source "$OPENOBSERVE_ENV"
set +a

# ------------------------------------------------------------------------------
# 2. Strict variable assertion
# ------------------------------------------------------------------------------
: "${KANIDM_ADMIN_PASSWORD:?Error: KANIDM_ADMIN_PASSWORD is not set in env/kanidm.env}"
: "${DEV_USER_PASSWORD:?Error: DEV_USER_PASSWORD is not set in env/kanidm.env}"
: "${ZO_OIDC_CLIENT_SECRET:?Error: ZO_OIDC_CLIENT_SECRET is not set in env/openobserve.env}"

# ------------------------------------------------------------------------------
# 3. Idempotent Provisioning
# ------------------------------------------------------------------------------
echo "==> Configuring admin credentials..."
printf "%s\n%s\n" "$KANIDM_ADMIN_PASSWORD" "$KANIDM_ADMIN_PASSWORD" | \
  docker compose exec -i kanidm kanidmd recover-account -c /etc/kanidm/server.toml admin

echo "==> Logging into Kanidm CLI..."
echo "$KANIDM_ADMIN_PASSWORD" | \
  docker compose exec -i kanidm kanidm login -H https://127.0.0.1:8443 -k -D admin

echo "==> Registering OpenObserve OIDC client..."
# Create or ignore if already exists
docker compose exec kanidm kanidm system oauth2 create \
  -H https://127.0.0.1:8443 -k \
  openobserve \
  "OpenObserve" \
  http://openobserve.localhost:8000/auth/callback || true

echo "==> Updating OpenObserve client secret from env/openobserve.env..."
docker compose exec kanidm kanidm system oauth2 set-basic-secret \
  -H https://127.0.0.1:8443 -k \
  openobserve \
  "$ZO_OIDC_CLIENT_SECRET"

docker compose exec kanidm kanidm system oauth2 add-scope-map \
  -H https://127.0.0.1:8443 -k \
  openobserve \
  idm_all_persons \
  openid email profile || true

echo "==> Creating default developer user..."
docker compose exec kanidm kanidm person create -H https://127.0.0.1:8443 -k devuser "Developer" || true
docker compose exec kanidm kanidm person email add -H https://127.0.0.1:8443 -k devuser devuser@example.com || true

printf "%s\n%s\n" "$DEV_USER_PASSWORD" "$DEV_USER_PASSWORD" | \
  docker compose exec -i kanidm kanidm person credential update-password -H https://127.0.0.1:8443 -k devuser

echo "==> Setup complete!"
