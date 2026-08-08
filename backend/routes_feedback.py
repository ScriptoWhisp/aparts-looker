"""In-app feedback / bug-report routes.

Product model: a floating button on every screen captures a screenshot +
console log tail + comment and stores it in Postgres (`feedback` table). A
dedicated Feedback tab lets Daniel browse reports and share an id/URL with
Claude, who fetches `GET /api/feedback/{id}` (+ `/screenshot`) to reproduce
and fix, then `PATCH`es status to `fixed`.

All paths are under /api/feedback[...].
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone as _tz
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.requests import Request
from fastapi.responses import Response
from sqlalchemy import desc
from sqlalchemy.exc import SQLAlchemyError

import db
from models import Feedback, FEEDBACK_STATUSES, FEEDBACK_TYPES

log = logging.getLogger("app")

router = APIRouter()

MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024  # 2 MB
MAX_COMMENT_CHARS = 2000
MAX_CONSOLE_LOG_ENTRIES = 50
MAX_CONSOLE_LOG_ARG_CHARS = 500


def _parse_id(feedback_id: str) -> UUID:
    try:
        return UUID(feedback_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Feedback not found")


def _sanitize_console_logs(raw: str) -> list:
    """Parse + defensively sanitize the console_logs JSON string.

    Never trusts the client fully even though the frontend ring buffer
    already caps entries: re-caps to MAX_CONSOLE_LOG_ENTRIES, coerces every
    arg to a string truncated at MAX_CONSOLE_LOG_ARG_CHARS so a malicious or
    buggy client can't smuggle huge payloads or non-serializable object refs
    into JSONB storage.
    """
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="console_logs must be valid JSON")
    if not isinstance(parsed, list):
        raise HTTPException(status_code=422, detail="console_logs must be a JSON array")

    sanitized = []
    for entry in parsed[-MAX_CONSOLE_LOG_ENTRIES:]:
        if not isinstance(entry, dict):
            continue
        args = entry.get("args", [])
        if not isinstance(args, list):
            args = [args]
        safe_args = [str(a)[:MAX_CONSOLE_LOG_ARG_CHARS] for a in args]
        sanitized.append({
            "ts": str(entry.get("ts") or "")[:64],
            "level": str(entry.get("level") or "log")[:16],
            "args": safe_args,
        })
    return sanitized


def _serialize(row: Feedback, include_comment: bool = True) -> dict:
    return {
        "id": str(row.id),
        "type": row.type,
        "comment": row.comment if include_comment else (row.comment or "")[:200],
        "url": row.url,
        "viewport": row.viewport,
        "user_agent": row.user_agent,
        "console_logs": row.console_logs or [],
        "has_screenshot": row.screenshot is not None,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ---------------------------------------------------------------------------
# POST /api/feedback — submit a new report (multipart/form-data)
# ---------------------------------------------------------------------------

@router.post("/api/feedback")
async def create_feedback(
    type: str = Form(...),
    comment: str = Form(...),
    url: str = Form(""),
    viewport: Optional[str] = Form(None),
    user_agent: Optional[str] = Form(None),
    console_logs: Optional[str] = Form(None),
    screenshot: Optional[UploadFile] = File(None),
) -> dict:
    """Accept a feedback report. Screenshot is optional; max 2 MB PNG."""
    if type not in FEEDBACK_TYPES:
        raise HTTPException(status_code=422, detail=f"type must be one of {sorted(FEEDBACK_TYPES)}")

    comment = (comment or "").strip()
    if not comment:
        raise HTTPException(status_code=422, detail="comment must not be empty")
    if len(comment) > MAX_COMMENT_CHARS:
        raise HTTPException(status_code=422, detail=f"comment must be <= {MAX_COMMENT_CHARS} chars")

    logs = _sanitize_console_logs(console_logs or "[]")

    screenshot_bytes: Optional[bytes] = None
    screenshot_mime: Optional[str] = None
    if screenshot is not None and screenshot.filename:
        screenshot_bytes = await screenshot.read()
        if len(screenshot_bytes) > MAX_SCREENSHOT_BYTES:
            raise HTTPException(status_code=413, detail="screenshot exceeds 2 MB limit")
        screenshot_mime = screenshot.content_type or "image/png"

    try:
        with db.SessionLocal() as db_:
            row = Feedback(
                type=type,
                comment=comment,
                url=(url or "")[:8192],
                viewport=(viewport or None),
                user_agent=(user_agent or None),
                console_logs=logs,
                screenshot=screenshot_bytes,
                screenshot_mime=screenshot_mime,
                status="open",
            )
            db_.add(row)
            db_.commit()
            db_.refresh(row)
            feedback_id = row.id
            created_at = row.created_at
    except SQLAlchemyError:
        log.exception("create_feedback failed")
        raise HTTPException(status_code=500, detail="DB error")

    return {
        "id": str(feedback_id),
        "created_at": created_at.isoformat() if created_at else None,
    }


# ---------------------------------------------------------------------------
# GET /api/feedback — list, most recent first, optional status/type filters
# ---------------------------------------------------------------------------

@router.get("/api/feedback")
def list_feedback(status: Optional[str] = None, type: Optional[str] = None) -> dict:
    if status is not None and status not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {sorted(FEEDBACK_STATUSES)}")
    if type is not None and type not in FEEDBACK_TYPES:
        raise HTTPException(status_code=422, detail=f"type must be one of {sorted(FEEDBACK_TYPES)}")

    try:
        with db.SessionLocal() as db_:
            q = db_.query(Feedback)
            if status is not None:
                q = q.filter(Feedback.status == status)
            if type is not None:
                q = q.filter(Feedback.type == type)
            rows = q.order_by(desc(Feedback.created_at)).all()
            items = [_serialize(r, include_comment=False) for r in rows]
    except SQLAlchemyError:
        log.exception("list_feedback failed")
        raise HTTPException(status_code=500, detail="DB error")

    return {"feedback": items, "count": len(items)}


# ---------------------------------------------------------------------------
# GET /api/feedback/{id} — full details (screenshot bytes excluded)
# ---------------------------------------------------------------------------

@router.get("/api/feedback/{feedback_id}")
def get_feedback(feedback_id: str) -> dict:
    fid = _parse_id(feedback_id)
    try:
        with db.SessionLocal() as db_:
            row = db_.get(Feedback, fid)
            if row is None:
                raise HTTPException(status_code=404, detail="Feedback not found")
            return _serialize(row, include_comment=True)
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("get_feedback failed for %s", feedback_id)
        raise HTTPException(status_code=500, detail="DB error")


# ---------------------------------------------------------------------------
# GET /api/feedback/{id}/screenshot — PNG bytes
# ---------------------------------------------------------------------------

@router.get("/api/feedback/{feedback_id}/screenshot")
def get_feedback_screenshot(feedback_id: str) -> Response:
    fid = _parse_id(feedback_id)
    try:
        with db.SessionLocal() as db_:
            row = db_.get(Feedback, fid)
            if row is None or row.screenshot is None:
                raise HTTPException(status_code=404, detail="No screenshot stored")
            return Response(
                content=row.screenshot,
                media_type=row.screenshot_mime or "image/png",
            )
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("get_feedback_screenshot failed for %s", feedback_id)
        raise HTTPException(status_code=500, detail="DB error")


# ---------------------------------------------------------------------------
# PATCH /api/feedback/{id} — update status and/or comment
# ---------------------------------------------------------------------------

@router.patch("/api/feedback/{feedback_id}")
async def patch_feedback(feedback_id: str, request: Request) -> dict:
    fid = _parse_id(feedback_id)
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Body must be a JSON object")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    new_status = body.get("status")
    new_comment = body.get("comment")

    if new_status is not None and new_status not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {sorted(FEEDBACK_STATUSES)}")
    if new_comment is not None:
        new_comment = str(new_comment).strip()
        if not new_comment:
            raise HTTPException(status_code=422, detail="comment must not be empty")
        if len(new_comment) > MAX_COMMENT_CHARS:
            raise HTTPException(status_code=422, detail=f"comment must be <= {MAX_COMMENT_CHARS} chars")

    try:
        with db.SessionLocal() as db_:
            row = db_.get(Feedback, fid)
            if row is None:
                raise HTTPException(status_code=404, detail="Feedback not found")
            if new_status is not None:
                row.status = new_status
            if new_comment is not None:
                row.comment = new_comment
            row.updated_at = datetime.now(_tz.utc)
            db_.commit()
            db_.refresh(row)
            return _serialize(row, include_comment=True)
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("patch_feedback failed for %s", feedback_id)
        raise HTTPException(status_code=500, detail="DB error")


# ---------------------------------------------------------------------------
# DELETE /api/feedback/{id}
# ---------------------------------------------------------------------------

@router.delete("/api/feedback/{feedback_id}")
def delete_feedback(feedback_id: str) -> dict:
    fid = _parse_id(feedback_id)
    try:
        with db.SessionLocal() as db_:
            row = db_.get(Feedback, fid)
            if row is None:
                raise HTTPException(status_code=404, detail="Feedback not found")
            db_.delete(row)
            db_.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except SQLAlchemyError:
        log.exception("delete_feedback failed for %s", feedback_id)
        raise HTTPException(status_code=500, detail="DB error")
