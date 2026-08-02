"""Read-side data routes: /api/data, /api/pending, /api/health.

These are the "safe" read-heavy endpoints that serve the dossier frontend's
initial page load and status polling. PUT /api/data is also here (it writes the
top-level properties blob but lives conceptually alongside GET /api/data).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.requests import Request
from fastapi.responses import JSONResponse

import data_store

log = logging.getLogger("app")

router = APIRouter()


@router.get("/api/data")
def get_data():
    return data_store.load_app_data()


@router.put("/api/data")
async def put_data(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict) or "properties" not in payload:
        return JSONResponse({"error": "expected an object with a 'properties' field"}, status_code=400)
    data_store.save_app_data(payload)
    return {"ok": True}


@router.get("/api/health")
def health():
    return {"ok": True}


@router.get("/api/pending")
def get_pending():
    return {"pending": data_store.load_pending()}
