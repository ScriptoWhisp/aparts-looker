"""
Ingest handler: filter + evaluate + notify pipeline for listings POSTed by the mini PC scraper
client. Also stores heartbeat state consumed by plan 01-03's scheduler-tick alert checks.
Extracted from agent_job.process_new_listings() as part of Phase 1 (D-08).

Phase 2 changes (D-03): process_ingest_batch now writes to pending[] via
data_store.add_to_pending() instead of add_property_if_new(). Telegram notification
uses send_pending_card (a lazy import via getattr — safe before Plan 02-02 ships).
The should_draft / create_draft block is removed; draft creation moves to
POST /api/draft/<id> in Plan 02-04 (D-13, D-14).
"""

import dataclasses
import logging
from dataclasses import fields as dc_fields
from datetime import datetime, timezone

import config
import data_store
import telegram_client
from ai_evaluator import evaluate_listing
from kv_listing_parser import Listing, extract_object_id

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


def _build_context_prefix(listing: Listing, data: dict) -> str:
    """Assemble calibration anchors and district price/m² line for the evaluation prompt.

    Prepends top 2–3 scored properties[] entries (sorted by score descending) as anchor
    reference points so Claude scores against concrete examples rather than in a vacuum
    (D-01, D-02, D-03, EVAL-01). Also appends a district average line when other stored
    entries share the listing's district (D-04, D-05, EVAL-03).

    Returns "" when fewer than 2 scored anchors exist (D-02) or on any exception (never-raise).
    Note: the Listing dataclass has no district field — district is inferred via getattr with
    empty-string fallback (RESEARCH Pitfall 2).
    """
    try:
        props = data.get("properties", [])
        pending = data.get("pending", [])

        # Anchors: top 2–3 properties[] entries with a positive integer score (D-01)
        scored = sorted(
            [p for p in props if isinstance(p.get("score"), int) and p["score"] > 0],
            key=lambda p: p["score"],
            reverse=True,
        )[:3]

        if len(scored) < 2:
            anchor_block = ""
        else:
            lines = [
                "Here are listings Daniel has previously approved, with their AI scores, "
                "as calibration reference:\n\n"
            ]
            for i, anchor in enumerate(scored, 1):
                lines.append(
                    f"Anchor {i} — {anchor.get('name', '')} ({anchor.get('district', '')})\n"
                    f"Score: {anchor['score']}/100 | "
                    f"{anchor.get('rooms', '?')} rooms, {anchor.get('area', '?')} m², "
                    f"{anchor.get('pricePerSqm', '?')} EUR/m², "
                    f"material: {anchor.get('material', '?')}\n\n"
                )
            lines.append("Use these as reference points when scoring the new listing below.\n\n")
            anchor_block = "".join(lines)

        # District average: collect price/m² from all stored entries matching listing's district.
        # Listing dataclass lacks district field — use getattr with empty-string default (RESEARCH Pitfall 2).
        dist = getattr(listing, "district", "")
        if dist:
            all_entries = list(props) + list(pending)
            # properties[] use camelCase (pricePerSqm); pending[] use snake_case (price_per_sqm)
            district_sqm = [
                e.get("pricePerSqm") or e.get("price_per_sqm")
                for e in all_entries
                if (e.get("district") or "") == dist
                and (e.get("pricePerSqm") or e.get("price_per_sqm"))
            ]
            if district_sqm:
                avg = sum(district_sqm) / len(district_sqm)
                district_line = (
                    f"District price/m² average ({dist}, from {len(district_sqm)} seen listings): "
                    f"{avg:.0f} EUR/m²\n\n"
                )
            else:
                district_line = ""
        else:
            district_line = ""

        return anchor_block + district_line

    except Exception:
        log.exception("_build_context_prefix failed — proceeding without context")
        return ""


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
                # Phase 3: build calibration context (anchors + district avg) before Claude call.
                # load_app_data() is safe here — data_store._lock is RLock (reentrant, D-04).
                app_data = data_store.load_app_data()
                context_prefix = _build_context_prefix(listing, app_data)
                evaluation = evaluate_listing(listing, context_prefix)
                log.info("Score: %s/100 — %s", evaluation.get("score"), evaluation.get("verdict"))

                # Build the pending entry (D-02): full Listing fields + evaluation + metadata.
                pending_entry = {
                    **dataclasses.asdict(listing),
                    "score": evaluation.get("score", 0),
                    "verdict": evaluation.get("verdict", ""),
                    "strengths": evaluation.get("strengths", []),
                    "concerns": evaluation.get("concerns", []),
                    "draft_subject": (
                        evaluation.get("draft_subject") or f"Inquiry about {listing.title}"
                    ),
                    "draft_body": evaluation.get("draft_body") or "",
                    "queued_at": datetime.now(timezone.utc).isoformat(),
                    "tg_message_id": None,
                    "tg_chat_id": None,
                }
                data_store.add_to_pending(pending_entry)

                # send_pending_card is provided by Plan 02-02. Until then, the lazy
                # getattr fallback returns (None, None) so this module ships before
                # telegram_client grows the new function (never-raise contract).
                _send_card = getattr(telegram_client, "send_pending_card", lambda l, e: (None, None))
                tg_message_id, tg_chat_id = _send_card(listing, evaluation)

                if tg_message_id is not None:
                    # Patch the stored pending entry with the Telegram message reference
                    # so edit_card_resolved can update it after approve/reject.
                    app_data = data_store.load_app_data()
                    for entry in app_data["pending"]:
                        if entry.get("id") == listing.id:
                            entry["tg_message_id"] = tg_message_id
                            entry["tg_chat_id"] = tg_chat_id
                            break
                    data_store.save_app_data(app_data)

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
