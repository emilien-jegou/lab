#!/usr/bin/env bash

set -e

# Create the user and database for OpenWebUI
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    CREATE USER "${OPENWEBUI_DB_USER}" WITH PASSWORD '${OPENWEBUI_DB_PASSWORD}';
    CREATE DATABASE "${OPENWEBUI_DB}" OWNER "${OPENWEBUI_DB_USER}";
EOSQL

# Connect to the new database as the superuser and create the extension
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${OPENWEBUI_DB}" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;
EOSQL
