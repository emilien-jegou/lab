#!/bin/sh

set -e

# Load secrets from Docker secrets files
SURREAL_ROOT_USER="${SURREAL_ROOT_USER:-root}"  # Default to 'root' if no user is specified
SURREAL_ROOT_PASS=$(cat /run/secrets/surrealdb_root_pass)
BACKEND_USER_PASS=$(cat /run/secrets/surrealdb_backend_user_pass)

# Start SurrealDB in the background and save the process ID
/surreal start \
    --user "$SURREAL_ROOT_USER" \
    --pass "$SURREAL_ROOT_PASS" \
    --bind 0.0.0.0:6800 \
    rocksdb:/dbdata/mydatabase.db &

SURREAL_PID=$!

# Function to handle clean exit if SurrealDB fails to start
exit_if_surreal_crashed() {
  if ! kill -0 "$SURREAL_PID" 2>/dev/null; then
    echo "SurrealDB failed to start. Exiting."
    exit 1
  fi
}

# Wait for SurrealDB to be ready by checking the health endpoint
echo "Waiting for SurrealDB to be ready..."
until wget -qO- "http://localhost:6800/health" >/dev/null 2>&1; do
  sleep 2
  exit_if_surreal_crashed  # Check if SurrealDB has crashed
done

# Execute SQL commands using surreal sql
/surreal sql --endpoint http://localhost:6800 --username "$SURREAL_ROOT_USER" --password "$SURREAL_ROOT_PASS" <<EOF
DEFINE NAMESPACE IF NOT EXISTS app;
USE NAMESPACE app;
DEFINE DATABASE IF NOT EXISTS app;
USE DATABASE backend;
DEFINE USER IF NOT EXISTS backend_user ON DATABASE PASSWORD "$BACKEND_USER_PASS" ROLES EDITOR DURATION FOR SESSION 12h, FOR TOKEN 1m;
EOF

# Wait for SurrealDB to finish before exiting
wait "$SURREAL_PID"
