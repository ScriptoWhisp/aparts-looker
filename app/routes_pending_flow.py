"""Pending-queue flow routes: approve and reject a pending listing.

These two endpoints drive the core review loop: Daniel sees a pending card and
either approves it (moves to properties[], fires KÜ lookup) or rejects it with
a reason (price / location / condition / other).
"""

from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, HTTPException
from fastapi.requests import Request

import data_store
import ingest_handler

log = logging.getLogger("app")

router = APIRouter()


@router.post("/api/pending/{listing_id}/approve")
def approve_pending(listing_id: str):
    ok = data_store.approve_listing(listing_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    # Fire-and-forget KÜ lookup (D-12: fires once on pending → approved transition)
    # Phase 7 Wave 4 (site #3, RESEARCH § Pitfall 2): lock wrapper removed.
    # get_approved_listing scopes its own session and returns a plain dict snapshot;
    # the daemon thread is spawned with plain string args — no session is passed to it.
    entry = data_store.get_approved_listing(listing_id)
    address = (entry.get("address", "") or "") if entry is not None else ""
    if address:
        threading.Thread(
            target=ingest_handler._dispatch_ku_lookup,
            args=(listing_id, address),
            daemon=True,
        ).start()
    else:
        log.info("approve_pending: no address on %s — skipping KÜ lookup", listing_id)
    return {"ok": True}


@router.post("/api/pending/{listing_id}/reject")
async def reject_pending(listing_id: str, request: Request):
    body = await request.json()
    reason = body.get("reason", "other")
    if reason not in {"price", "location", "condition", "other"}:
        reason = "other"
    ok = data_store.reject_listing(listing_id, reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}
