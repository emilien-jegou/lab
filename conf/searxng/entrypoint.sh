#!/usr/bin/env sh

set -e

# Construct the full Valkey URL from the environment variable
VALKEY_URL="valkey://:${VALKEY_PASSWORD}@valkey:6379/0"

sed "s#VALKEY_URL_PLACEHOLDER#${VALKEY_URL}#g" /etc/searxng/settings.template.yml > /etc/searxng/settings.yml

echo "Successfully configured Valkey URL. Starting SearXNG..."

exec /usr/local/searxng/entrypoint.sh "$@"
