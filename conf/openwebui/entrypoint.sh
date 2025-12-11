#!/bin/sh

# This script acts as a wrapper to dynamically build the DATABASE_URL
# from other environment variables provided by the env_files.
set -e

export DATABASE_URL="postgresql://${OPENWEBUI_DB_USER}:${OPENWEBUI_DB_PASSWORD}@db:5432/${OPENWEBUI_DB}"
export PGVECTOR_DB_URL="postgresql://${OPENWEBUI_DB_USER}:${OPENWEBUI_DB_PASSWORD}@db:5432/${OPENWEBUI_DB}"


exec "$@"
