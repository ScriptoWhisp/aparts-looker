"""
Ingest handler: filter + evaluate + notify pipeline for listings POSTed by the mini PC scraper
client. Also stores heartbeat state consumed by plan 01-03's scheduler-tick alert checks.
Extracted from agent_job.process_new_listings() as part of Phase 1 (D-08).
"""

import logging
from dataclasses import fields as dc_fields
from datetime import datetime, timezone

import config
import data_store
from ai_evaluator import evaluate_listing
from gmail_client import create_draft
from kv_listing_parser import Listing, extract_object_id
from telegram_client import format_listing_card, send_message, send_photo

log = logging.getLogger("ingest_handler")

# Cached once at import — avoids repeated reflection calls during batch processing.
LISTING_FIELD_NAMES = frozenset(f.name for f in dc_fields(Listing))


def _deserialize_listing(data: dict) -> Listing:
    """Reconstruct a Listing from an incoming JSON dict, silently ignoring unknown keys.

    Filtering before constructing prevents TypeError when the mini PC serialises a
    Listing field that doesn't exist on the VPS copy (e.g. after a schema divergence).
    Per RESEARCH Pitfall 2.
    """
    known = {k: v for k, v in data.items() if k in LISTING_FIELD_NAMES}
    return Listing(**known)


def _listing_to_property(listing, evaluation) -> dict:
    """Convert a Listing + evaluation dict to the dossier property schema.

    Moved verbatim from agent_job._listing_to_property (Phase 1, D-08).
    Lives here alongside the code that calls it.
    """
    verdict = evaluation.get("verdict", "")
    strengths = evaluation.get("strengths", [])
    concerns = evaluation.get("concerns", [])
    score = evaluation.get("score", 0)
    notes = f"[Agent, score {score}/100] {verdict}"
    if strengths:
        notes += " Strengths: " + "; ".join(strengths) + "."
    if concerns:
        notes += " Concerns: " + "; ".join(concerns) + "."
    return {
        "id": listing.id,
        "name": listing.title or ("kv.ee #" + listing.id),
        "district": "",
        "url": listing.url,
        "price": listing.price_eur or 0,
        "area": listing.area_sqm or 0,
        "rooms": listing.rooms or 0,
        "pricePerSqm": listing.price_per_sqm or 0,
        "year": str(listing.year_built) if listing.year_built else "",
        "material": listing.material or "",
        "notes": notes,
    }


def process_ingest_batch(listing_dicts: list[dict]) -> dict:
    """Filter, dedup, evaluate, and notify for a batch of Listing dicts POSTed by the mini PC.

    Acquires data_store._lock for the full load → process → save sequence so that
    concurrent API requests (e.g. /api/check-now) cannot interleave state writes.
    Per RESEARCH Pitfall 5. Never raises — per-listing failures are logged and skipped.
    Returns {"ok": True, "processed": <batch size>}.
    """
    log.info("Ingest batch received: %d listings", len(listing_dicts))

    with data_store._lock:
        state = data_store.load_agent_state()

        for data in listing_dicts:
            try:
                listing = _deserialize_listing(data)
            except (TypeError, KeyError) as exc:
                log.warning("Malformed listing dict in ingest batch: %s", exc)
                continue

            # Dedup: compute the canonical object ID for the seen-set check.
            dedup_key = extract_object_id(listing.url) or listing.url
            if dedup_key in set(state["seen_listing_ids"]):
                continue

            # Mark as seen by appending the object ID (mirrors the original agent_job behaviour).
            state["seen_listing_ids"].append(listing.id)

            # Apply VPS-side filters (D-02 — config stays on VPS).
            if listing.price_eur and listing.price_eur > config.MAX_PRICE_EUR:
                log.info(
                    "Skipping %s — price %s > max %s",
                    listing.id, listing.price_eur, config.MAX_PRICE_EUR,
                )
                continue
            if listing.rooms and listing.rooms < config.MIN_ROOMS:
                log.info(
                    "Skipping %s — rooms %s < min %s",
                    listing.id, listing.rooms, config.MIN_ROOMS,
                )
                continue
            if listing.image_count < config.MIN_IMAGES:
                log.info(
                    "Skipping %s — only %d images (min %d), likely inactive",
                    listing.id, listing.image_count, config.MIN_IMAGES,
                )
                continue

            try:
                log.info("Evaluating listing %s: %s", listing.id, listing.title)
                evaluation = evaluate_listing(listing)
                log.info("Score: %s/100 — %s", evaluation.get("score"), evaluation.get("verdict"))

                data_store.add_property_if_new(_listing_to_property(listing, evaluation))

                card_text = format_listing_card(listing, evaluation)
                if listing.image_url:
                    send_photo(listing.image_url, card_text)
                else:
                    send_message(card_text)

                should_draft = (
                    evaluation.get("should_draft_email")
                    and evaluation.get("score", 0) >= config.DRAFT_SCORE_THRESHOLD
                )
                if should_draft and listing.contact_email:
                    subject = evaluation.get("draft_subject") or f"Inquiry about {listing.title}"
                    body = evaluation.get("draft_body") or ""
                    if create_draft(listing.contact_email, subject, body):
                        state["pending_drafts"][listing.id] = {
                            "to_email": listing.contact_email,
                            "subject": subject,
                            "body": body,
                            "url": listing.url,
                        }
            except Exception:
                log.exception("Failed to process listing %s — skipping", listing.id)

        data_store.save_agent_state(state)

    return {"ok": True, "processed": len(listing_dicts)}


def handle_heartbeat(payload: dict) -> dict:
    """Store heartbeat state for plan 01-03's scheduler-tick alert checks.

    Updates last_heartbeat_ts, last_heartbeat_listing_count, and consecutive_zero_count.
    When listing_count == 0, increments consecutive_zero_count; when > 0, resets it to 0
    (explicit reset required — per RESEARCH Pitfall 3).
    NEVER logs INGEST_TOKEN or the presented Bearer credential (per RESEARCH Security Domain).
    Returns {"ok": True}.
    """
    with data_store._lock:
        state = data_store.load_agent_state()

        ts = payload.get("timestamp") or datetime.now(timezone.utc).isoformat()
        listing_count = int(payload.get("listing_count", 0))
        source = payload.get("source", "unknown")

        state["last_heartbeat_ts"] = ts
        state["last_heartbeat_listing_count"] = listing_count

        if listing_count == 0:
            state["consecutive_zero_count"] = state.get("consecutive_zero_count", 0) + 1
        else:
            state["consecutive_zero_count"] = 0

        data_store.save_agent_state(state)

    log.info(
        "Heartbeat from %s: listing_count=%d, consecutive_zeros=%d",
        source, listing_count, state["consecutive_zero_count"],
    )
    return {"ok": True}
