"""
Composition root: wires all route modules, applies middleware, mounts static frontend.

Route modules:
  routes_data         — /api/listings, /api/settings history, /api/agent-state, /api/ku-lookup
  routes_entries      — /api/entry/{id}/schedule-viewing, mark-viewed, regenerate-brief,
                        refresh-ku, cost-override (POST+DELETE), /api/listings/{id}/checklist
  routes_pending_flow — /api/pending/{id}/approve, reject
  routes_admin        — /api/check-now, /api/listings/all (DELETE), /api/listings/{id} (DELETE),
                        reevaluate, debug, backfill-costs, backfill-commutes, settings,
                        telegram/status, telegram/silence
  routes_ingest       — /api/ingest, /api/heartbeat, /api/draft/{id}
  routes_geo          — /api/isochrone, /api/refresh-isochrone, /api/districts, /api/geocode-backfill
  routes_feedback     — /api/feedback (POST/GET), /api/feedback/{id} (GET/PATCH/DELETE),
                        /api/feedback/{id}/screenshot
"""

from __future__ import annotations

import logging
import threading
import time  # re-exported for test introspection (test_commute patches main.time.sleep)

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

import scheduler
import settings_store
import routes_data
import routes_entries
import routes_pending_flow
import routes_admin
import routes_ingest
import routes_geo
import routes_feedback
from routes_admin import backfill_costs, backfill_commutes  # re-exported for test introspection

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

app = FastAPI(title="Apartment Dossier")


@app.middleware("http")
async def _no_cache_static(request, call_next):
    """Force browsers to always refetch HTML/JS/CSS during dev.

    We iterate on frontend files often; the default ETag-based revalidation
    still lets browsers hold stale copies through soft refreshes, which has
    repeatedly hidden CSS changes. no-store bypasses that entirely. API
    responses already opt out of caching by default; adding the header to
    them is harmless.
    """
    response = await call_next(request)
    path = request.url.path
    if (
        path == "/"
        or path.endswith((".html", ".js", ".css", ".json", ".geojson"))
    ):
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.on_event("startup")
def on_startup():
    settings_store.load_overrides()  # apply persisted runtime settings before anything reads config.X
    scheduler.start()


app.include_router(routes_data.router)
app.include_router(routes_entries.router)
app.include_router(routes_pending_flow.router)
app.include_router(routes_admin.router)
app.include_router(routes_ingest.router)
app.include_router(routes_geo.router)
app.include_router(routes_feedback.router)

# Static frontend last, so it doesn't shadow the /api/* routes above.
app.mount("/", StaticFiles(directory="static", html=True), name="static")
