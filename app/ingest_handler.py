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
from datetime import date as _date, datetime, timezone

import config
import data_store
import telegram_client
from ai_evaluator import evaluate_listing
from kv_listing_parser import Listing, extract_object_id

log = logging.getLogger("ingest_handler")

# Cached once at import — avoids repeated reflection calls during batch processing.
LISTING_FIELD_NAMES = frozenset(f.name for f in dc_fields(Listing))

# Checklist whitelist constants (EVAL-02, D-06, D-07, RESEARCH Pitfall 3).
# Canonical 7 text-assessable criterion keys and their allowed values.
EXPECTED_CHECKLIST_KEYS: frozenset = frozenset({
    "price_per_sqm",
    "rooms_area",
    "parking",
    "renovation_potential",
    "floor",
    "year_material",
    "mandatory_extras",
})
ALLOWED_CHECKLIST_VALUES: frozenset = frozenset({"pass", "fail", "unknown"})


def _deserialize_listing(data: dict) -> Listing:
    """Reconstruct a Listing from an incoming JSON dict, silently ignoring unknown keys.

    Filtering before constructing prevents TypeError when the mini PC serialises a
    Listing field that doesn't exist on the VPS copy (e.g. after a schema divergence).
    Per RESEARCH Pitfall 2.
    """
    known = {k: v for k, v in data.items() if k in LISTING_FIELD_NAMES}
    return Listing(**known)


def _whitelist_checklist(raw: dict) -> dict:
    """Return a fully-populated 7-key checklist dict from an AI-returned raw checklist.

    - Drops unknown keys (RESEARCH Pitfall 3, T-03-04, T-03-05).
    - Coerces invalid values to "unknown" so callers always get all 7 keys with valid values.
    - Never raises — wraps body in try/except; returns 7-key all-"unknown" dict on any error.
    (EVAL-02, D-07, D-08, RESEARCH Pitfall 3)
    """
    try:
        result = {}
        for key in EXPECTED_CHECKLIST_KEYS:
            value = raw.get(key)
            result[key] = value if isinstance(value, str) and value in ALLOWED_CHECKLIST_VALUES else "unknown"
        return result
    except Exception:
        log.exception("_whitelist_checklist failed — returning all-unknown checklist")
        return {key: "unknown" for key in EXPECTED_CHECKLIST_KEYS}


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


def _record_and_check_price_drop(app_data: dict, listing: Listing, today_str: str) -> None:
    """Record a new price entry and trigger re-evaluation when a >= 5% drop is detected.

    Replaces the bare data_store.record_price_in_data call in both the dedup-hit and new-listing
    branches of process_ingest_batch. The caller must hold data_store._lock.

    Same-day idempotency: if the last history entry's date matches today_str the function
    still records (overwrites) but does NOT trigger drop detection — avoids self-triggering
    within a single batch run (D-14, T-03-14, RESEARCH Pattern 5).

    Never raises — wraps body in try/except per never-raise convention.
    """
    try:
        if not (isinstance(listing.price_eur, int) and listing.price_eur > 0):
            return

        # Capture history BEFORE recording so we can compare against the previous entry.
        history = app_data.get("price_history", {}).get(listing.id, [])

        # Detect a valid previous entry on a different date (same-day = no-op for drop detection).
        prev_entry = None
        if history and history[-1]["date"] != today_str:
            prev_entry = history[-1]

        # Record the new price (mutates app_data in place; caller saves).
        data_store.record_price_in_data(app_data, listing.id, listing.price_eur, today_str)

        # Trigger drop detection only when previous entry exists and is a valid price.
        if (
            prev_entry is not None
            and isinstance(prev_entry.get("price"), int)
            and prev_entry["price"] > 0
            and (prev_entry["price"] - listing.price_eur) / prev_entry["price"] >= config.PRICE_DROP_THRESHOLD
        ):
            _handle_price_drop(app_data, listing, prev_entry["price"], listing.price_eur)

    except Exception:
        log.exception("_record_and_check_price_drop failed for %s — skipping", listing.id)


def _handle_price_drop(app_data: dict, listing: Listing, prev_price: int, new_price: int) -> None:
    """Re-evaluate a listing after a significant price drop and dispatch by its current state.

    Dispatch rules (D-15, D-16, D-17, RESEARCH Pattern 6):
    - Approved (in properties[]): re-evaluate, update score/verdict, PREPEND price-drop note to
      existing notes, send Telegram notification.
    - Pending (in pending[]): re-evaluate silently, update score/verdict/strengths/concerns and
      refresh the AI checklist via write_checklist_ai. No Telegram.
    - Rejected with rejection_reason=='price': re-evaluate, construct new pending entry, move
      from rejected[] to pending[], send Telegram notification.
    - Rejected with any other reason: silently untouched.

    Never raises — wraps body in try/except. The evaluate_listing call has its own inner guard
    so a network failure logs without corrupting state (RESEARCH Pitfall 7).
    """
    try:
        context_prefix = _build_context_prefix(listing, app_data)

        try:
            evaluation = evaluate_listing(listing, context_prefix)
        except Exception:
            log.exception(
                "_handle_price_drop: evaluate_listing failed for %s — aborting drop dispatch",
                listing.id,
            )
            return

        pct = round((prev_price - new_price) / prev_price * 100, 1)
        new_score = evaluation.get("score", 0)

        # --- Approved listing in properties[] ---
        prop_entry = next((e for e in app_data.get("properties", []) if e.get("id") == listing.id), None)
        if prop_entry is not None:
            prop_entry["score"] = new_score
            prop_entry["verdict"] = evaluation.get("verdict", "")
            # PREPEND price-drop note — do not overwrite existing notes (RESEARCH Pitfall 6, T-03-16).
            prop_entry["notes"] = (
                f"[Price drop {pct}%, re-scored {new_score}/100] "
                + (prop_entry.get("notes") or "")
            )
            telegram_client.send_message(
                f"Price drop on {listing.title or listing.id}: "
                f"{prev_price:,} -> {new_price:,} EUR (-{pct}%). "
                f"Re-scored: {new_score}/100."
            )
            return

        # --- Pending listing in pending[] ---
        pending_entry = next(
            (e for e in app_data.get("pending", []) if e.get("id") == listing.id), None
        )
        if pending_entry is not None:
            pending_entry["score"] = new_score
            pending_entry["verdict"] = evaluation.get("verdict", "")
            pending_entry["strengths"] = evaluation.get("strengths", [])
            pending_entry["concerns"] = evaluation.get("concerns", [])
            # Refresh AI checklist (D-16) — write_checklist_ai acquires _lock (RLock, re-entrant safe).
            data_store.write_checklist_ai(
                listing.id,
                _whitelist_checklist(evaluation.get("checklist", {})),
            )
            # No Telegram for pending re-evaluation (D-16 — silent update).
            return

        # --- Rejected listing: re-queue only if reason == "price" (D-17) ---
        rejected_entry = next(
            (e for e in app_data.get("rejected", []) if e.get("id") == listing.id),
            None,
        )
        if rejected_entry is not None and rejected_entry.get("rejection_reason") == "price":
            new_pending = dict(rejected_entry)
            new_pending.pop("rejection_reason", None)
            new_pending.pop("rejected_at", None)
            new_pending["score"] = new_score
            new_pending["verdict"] = evaluation.get("verdict", "")
            new_pending["strengths"] = evaluation.get("strengths", [])
            new_pending["concerns"] = evaluation.get("concerns", [])
            new_pending["queued_at"] = datetime.now(timezone.utc).isoformat()
            new_pending["price_drop_requeue_note"] = (
                f"Previously rejected for price. Price dropped {pct}% to {new_price:,} EUR."
            )
            app_data["pending"].append(new_pending)
            # Remove from rejected[] (T-03-18 — rebuilds list without the re-queued entry).
            app_data["rejected"] = [e for e in app_data["rejected"] if e.get("id") != listing.id]
            telegram_client.send_message(
                f"Previously price-rejected {listing.title or listing.id} re-queued: "
                f"{prev_price:,} -> {new_price:,} EUR (-{pct}%). Now: {new_score}/100."
            )
            return

        # Rejected with any other reason — silently untouched (D-17).

    except Exception:
        log.exception("_handle_price_drop failed for %s — skipping", listing.id)


def _mark_removed_listings(app_data: dict, batch_dicts: list[dict]) -> None:
    """Mark listings with raw_ok=False as removed on their dossier or pending entry.

    Called after the batch loop completes, before save (D-18, INTEL-03).
    Only marks existing entries — does not create new removed entries (T-03-13).
    Never raises — wraps body in try/except per never-raise convention.
    """
    try:
        today_str = _date.today().isoformat()
        for item in batch_dicts:
            if item.get("raw_ok", True):
                continue  # raw_ok=True or missing — listing is still active
            listing_id = item.get("id") or extract_object_id(item.get("url", ""))
            if not listing_id:
                continue
            for entry in app_data.get("properties", []):
                if entry.get("id") == listing_id and not entry.get("removed"):
                    entry["removed"] = True
                    entry["removed_at"] = today_str
                    log.info("Marked properties entry %s as removed", listing_id)
            for entry in app_data.get("pending", []):
                if entry.get("id") == listing_id and not entry.get("removed"):
                    entry["removed"] = True
                    entry["removed_at"] = today_str
                    log.info("Marked pending entry %s as removed", listing_id)
    except Exception:
        log.exception("_mark_removed_listings failed — skipping")


def process_ingest_batch(listing_dicts: list[dict]) -> dict:
    """Filter, dedup, evaluate, and notify for a batch of Listing dicts POSTed by the mini PC.

    Acquires data_store._lock for the full load → process → save sequence so that
    concurrent API requests (e.g. /api/check-now) cannot interleave state writes.
    Per RESEARCH Pitfall 5. Never raises — per-listing failures are logged and skipped.
    Returns {"ok": True, "processed": <batch size>}.

    Phase 3 (D-11, D-12): records price for every listing on every scrape run — both
    known (dedup hit) and new listings. today_str is computed once per batch so a midnight
    rollover during a large batch doesn't split the same batch's entries across two dates.
    Phase 3 (D-14, D-15, D-16, D-17, D-18): _record_and_check_price_drop replaces bare
    record_price_in_data calls; _mark_removed_listings runs post-loop.
    """
    log.info("Ingest batch received: %d listings", len(listing_dicts))

    with data_store._lock:
        state = data_store.load_agent_state()
        # Load app_data once before the loop; reload after sub-helpers that self-save
        # (add_to_pending, write_checklist_ai) so price_history mutations see their writes.
        app_data = data_store.load_app_data()
        # Single date snapshot for the entire batch (D-12, RESEARCH Pattern 5)
        today_str = _date.today().isoformat()

        for raw_dict in listing_dicts:
            try:
                listing = _deserialize_listing(raw_dict)
            except (TypeError, KeyError) as exc:
                log.warning("Malformed listing dict in ingest batch: %s", exc)
                continue

            # Dedup: compute the canonical object ID for the seen-set check.
            dedup_key = extract_object_id(listing.url) or listing.url
            if dedup_key in set(state["seen_listing_ids"]):
                # Known listing — record price and check for drop (D-12, D-14, RESEARCH Pattern 5)
                _record_and_check_price_drop(app_data, listing, today_str)
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
                # app_data already loaded; _lock is RLock so re-entrant reads inside helpers are safe.
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
                # Phase 3: persist AI checklist (EVAL-02, D-08). Whitelist before write to
                # guard against non-canonical keys/values from the model (RESEARCH Pitfall 3).
                # write_checklist_ai acquires _lock internally; safe because _lock is RLock
                # (reentrant — same thread can re-enter, RESEARCH Pitfall 1).
                data_store.write_checklist_ai(
                    listing.id,
                    _whitelist_checklist(evaluation.get("checklist", {})),
                )

                # send_pending_card is provided by Plan 02-02. Until then, the lazy
                # getattr fallback returns (None, None) so this module ships before
                # telegram_client grows the new function (never-raise contract).
                _send_card = getattr(telegram_client, "send_pending_card", lambda l, e: (None, None))
                tg_message_id, tg_chat_id = _send_card(listing, evaluation)

                # Reload app_data to pick up add_to_pending / write_checklist_ai writes.
                # Also apply the Telegram message_id patch in the same reload so we have a
                # single consistent state to mutate price_history into (D-12).
                app_data = data_store.load_app_data()
                if tg_message_id is not None:
                    # Patch the stored pending entry with the Telegram message reference
                    # so edit_card_resolved can update it after approve/reject.
                    for entry in app_data["pending"]:
                        if entry.get("id") == listing.id:
                            entry["tg_message_id"] = tg_message_id
                            entry["tg_chat_id"] = tg_chat_id
                            break

                # Record initial price for newly-seen listing AFTER the reload so the
                # mutation lands on the same app_data dict that will be saved at loop end
                # (D-11, D-12, D-14, RESEARCH Pattern 5).
                _record_and_check_price_drop(app_data, listing, today_str)

            except Exception:
                log.exception("Failed to process listing %s — skipping", listing.id)

        # Post-loop: mark listings with raw_ok=False as removed (D-18, INTEL-03).
        # Pass the original raw batch dicts so raw_ok signals are available.
        _mark_removed_listings(app_data, listing_dicts)

        data_store.save_agent_state(state)
        # Persist accumulated price_history mutations from this batch (D-11, D-12)
        data_store.save_app_data(app_data)

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
