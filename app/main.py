"""
The whole server: a tiny JSON API backing the dossier frontend, plus the
static frontend itself, plus the background kv.ee-checking job - all one
process, one container.
"""

import logging
import threading

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import data_store
import scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

app = FastAPI(title="Apartment Dossier")


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
    """Manually trigger the kv.ee check instead of waiting for the schedule."""
    threading.Thread(target=scheduler.run_once_now, daemon=True).start()
    return {"ok": True, "message": "Check started in background — watch Telegram in a minute or two."}


@app.get("/api/health")
def health():
    return {"ok": True}


# Static frontend last, so it doesn't shadow the /api/* routes above.
app.mount("/", StaticFiles(directory="static", html=True), name="static")
