# ── Stage 1: build the React frontend ────────────────────────────────────────
# Node 20 Alpine for a minimal build image.
# Output: /build/dist/ (Vite production build)
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ───────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Install postgresql-client for pg_isready used in entrypoint.sh.
# Placed before pip install for better layer caching (this layer rarely changes).
RUN apt-get update && apt-get install -y postgresql-client && rm -rf /var/lib/apt/lists/*

# Build context is the repo root — see docker-compose.yml build.context.
# Backend Python + entrypoint land at /app/; frontend static files at /app/static/.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium --with-deps

COPY backend/ .

# Frontend static assets from the React build stage (replaces the old
# COPY frontend/ ./static/ which copied the vanilla JS files).
COPY --from=frontend-build /build/dist/ ./static/

# Copy the geojson data file that was in the old frontend/ root
# (now in frontend-legacy/ for reference; the map is served from static).
COPY frontend-legacy/tallinn-districts.geojson ./static/tallinn-districts.geojson

RUN chmod +x /app/entrypoint.sh

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8000

CMD ["/app/entrypoint.sh"]
