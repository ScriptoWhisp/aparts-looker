#!/usr/bin/env bash
# app/entrypoint.sh — runs at container start.
# Order matters: pg readiness → schema migration → data migration → uvicorn.
#
# set -e: if any step fails, the container exits immediately and Docker
# restarts it (restart: unless-stopped), making the failure visible in logs.
set -e

# Postgres readiness — depends_on service_healthy in docker-compose.yml already
# gates container start, but this loop is cheap defence in depth against a
# temporary network hiccup between the two containers after the healthcheck
# passes (pool_pre_ping in db.py is the third layer).
echo "Waiting for Postgres at ${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}..."
until pg_isready \
    -h "${POSTGRES_HOST:-postgres}" \
    -p "${POSTGRES_PORT:-5432}" \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    >/dev/null 2>&1; do
    sleep 1
done
echo "Postgres ready."

echo "Applying Alembic migrations..."
alembic upgrade head

echo "Migrating legacy JSON if present (idempotent)..."
python migrate_from_json.py

echo "Starting uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8000
