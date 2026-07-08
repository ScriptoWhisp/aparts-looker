"""
The whole server: a tiny JSON API backing the dossier frontend, plus the
static frontend itself, plus the background kv.ee-checking job - all one
process, one container.
"""

import logging
import threading

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles

import config
import data_store
import ingest_handler
import scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

app = FastAPI(title="Apartment Dossier")

# HTTPBearer with auto_error=False so a missing Authorization header yields credentials=None
# (which _verify_ingest_token handles as 403) rather than FastAPI's default 403 with a
# differently-worded detail string. Keeps the error schema uniform for all auth failures.
_bearer = HTTPBearer(auto_error=False)


def _verify_ingest_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    """FastAPI dependency — raises 403 if the token does not match INGEST_TOKEN.

    Fail-closed: if INGEST_TOKEN is not configured (empty string), every request
    is rejected with 403 rather than accidentally opening the endpoint.
    NEVER logs the token value or the presented credential (T-01-04).
    """
    if not config.INGEST_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ingest not configured",
        )
    if credentials is None or credentials.credentials != config.INGEST_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid token",
        )


@app.on_event("startup")
def on_startup():
    scheduler.start()


@app.get("/api/data")
def get_data():
    return data_store.load_app_data()


@app.put("/api/data")
async def put_data(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict) or "properties" not in payload:
        return JSONResponse({"error": "expected an object with a 'properties' field"}, status_code=400)
    data_store.save_app_data(payload)
    return {"ok": True}


@app.post("/api/check-now")
def check_now():
    """Manually trigger the scheduler tick instead of waiting for the schedule."""
    threading.Thread(target=scheduler.run_once_now, daemon=True).start()
    return {"ok": True, "message": "Scheduler tick started in background — watch Telegram in a moment."}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/pending")
def get_pending():
    return {"pending": data_store.load_pending()}


@app.post("/api/pending/{listing_id}/approve")
def approve_pending(listing_id: str):
    ok = data_store.approve_listing(listing_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}


@app.post("/api/pending/{listing_id}/reject")
async def reject_pending(listing_id: str, request: Request):
    body = await request.json()
    reason = body.get("reason", "other")
    if reason not in {"price", "location", "condition", "other"}:
        reason = "other"
    ok = data_store.reject_listing(listing_id, reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}


@app.post("/api/ingest", dependencies=[Depends(_verify_ingest_token)])
async def ingest(request: Request) -> dict:
    """Receive a batch of parsed Listing JSON dicts from the mini PC scraper.

    The async handler reads the body; the sync helper acquires data_store._lock
    for the full filter → evaluate → notify → save sequence (RESEARCH Pitfall 5).
    """
    payload = await request.json()
    if not isinstance(payload, list):
        return JSONResponse({"error": "expected a JSON array of listings"}, status_code=400)
    return ingest_handler.process_ingest_batch(payload)


@app.post("/api/heartbeat", dependencies=[Depends(_verify_ingest_token)])
async def heartbeat(request: Request) -> dict:
    """Receive a heartbeat from the mini PC scraper and store state for alert checks."""
    payload = await request.json()
    if not isinstance(payload, dict):
        return JSONResponse({"error": "expected a JSON object"}, status_code=400)
    return ingest_handler.handle_heartbeat(payload)


# Static frontend last, so it doesn't shadow the /api/* routes above.
app.mount("/", StaticFiles(directory="static", html=True), name="static")
