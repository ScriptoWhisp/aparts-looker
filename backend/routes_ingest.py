"""Ingest and heartbeat endpoints: /api/ingest, /api/heartbeat (machine-token auth),
and /api/draft/{listing_id} (browser-side, no ingest token required).

The _verify_ingest_token dependency is co-located here with the endpoints that use
it. main.py previously owned the dependency, but it belongs alongside its consumers.
"""

from __future__ import annotations

import logging
from typing import Optional

import config
import data_store
import gmail_client
import ingest_handler
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.requests import Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

log = logging.getLogger("app")

router = APIRouter()

# ---------------------------------------------------------------------------
# Auth dependency (ingest token)
# ---------------------------------------------------------------------------

# HTTPBearer with auto_error=False so a missing Authorization header yields credentials=None
# (which _verify_ingest_token handles as 403) rather than FastAPI's default 403 with a
# differently-worded detail string. Keeps the error schema uniform for all auth failures.
_bearer = HTTPBearer(auto_error=False)


def _verify_ingest_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
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


# ---------------------------------------------------------------------------
# Ingest + heartbeat (require ingest token)
# ---------------------------------------------------------------------------

@router.post("/api/ingest", dependencies=[Depends(_verify_ingest_token)])
async def ingest(request: Request) -> dict:
    """Receive a batch of parsed Listing JSON dicts from the mini PC scraper.

    The async handler reads the body; the sync helper acquires data_store._lock
    for the full filter → evaluate → notify → save sequence (RESEARCH Pitfall 5).
    """
    payload = await request.json()
    if not isinstance(payload, list):
        return JSONResponse({"error": "expected a JSON array of listings"}, status_code=400)
    return ingest_handler.process_ingest_batch(payload)


@router.post("/api/heartbeat", dependencies=[Depends(_verify_ingest_token)])
async def heartbeat(request: Request) -> dict:
    """Receive a heartbeat from the mini PC scraper and store state for alert checks."""
    payload = await request.json()
    if not isinstance(payload, dict):
        return JSONResponse({"error": "expected a JSON object"}, status_code=400)
    return ingest_handler.handle_heartbeat(payload)


# ---------------------------------------------------------------------------
# Draft creation (browser-side, no ingest token)
# ---------------------------------------------------------------------------

@router.post("/api/draft/{listing_id}")
def create_draft_endpoint(listing_id: str) -> dict:
    """Create a Gmail draft for an approved listing and queue it into pending_drafts.

    Opt-in only — never called automatically on approval (D-13, T-02-DRAFT-AUTO).
    draft_body / draft_subject / contact_email come from the pre-computed evaluation
    stored on the properties[] entry at approval time (D-15, _pending_to_property).

    Returns:
      {"ok": true}                          — draft created and queued
      {"ok": false, "reason": "no_email"}   — listing has no contact email (RESEARCH Risk 5)
      404                                   — listing_id not found in properties[]
    """
    entry = data_store.get_approved_listing(listing_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Listing not found")

    contact_email = entry.get("contact_email", "")
    if not contact_email:
        return {"ok": False, "reason": "no_email"}

    subject = entry.get("draft_subject") or f"Inquiry about {entry.get('name', listing_id)}"
    body = entry.get("draft_body", "")

    ok = gmail_client.create_draft(contact_email, subject, body)
    if ok:
        state = data_store.load_agent_state()
        state["pending_drafts"][listing_id] = {
            "to_email": contact_email,
            "subject": subject,
            "body": body,
            "url": entry.get("url", ""),
        }
        data_store.save_agent_state(state)

    return {"ok": ok}
