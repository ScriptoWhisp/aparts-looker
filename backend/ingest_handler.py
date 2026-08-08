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
import threading
import time
from dataclasses import fields as dc_fields
from datetime import date as _date, datetime, timezone
from typing import Optional

import requests

import checklist_registry
import config
import data_store
import maa_amet_baseline
import telegram_client
from ai_evaluator import evaluate_listing
from kv_listing_parser import Listing, extract_object_id

log = logging.getLogger("ingest_handler")

# Cached once at import — avoids repeated reflection calls during batch processing.
LISTING_FIELD_NAMES = frozenset(f.name for f in dc_fields(Listing))

# Checklist whitelist constants (EVAL-02, D-06, D-07, RESEARCH Pitfall 3).
# Wave A: sourced dynamically from checklist_registry.py's ai_fillable set
# instead of a hardcoded 7-key frozenset — kept in sync automatically.
# NOTE: _whitelist_checklist()/this constant back a pass/fail/unknown re-eval
# path (_handle_price_drop -> evaluation.get("checklist", {})) that is
# currently unreachable in production — evaluate_listing() only ever returns
# "checklist_fills" (see _whitelist_checklist_fills in ai_evaluator.py), never
# a "checklist" key. Left wired (not deleted) since a test exercises it
# directly with a mocked evaluate_listing; sourcing it from the same registry
# avoids yet another hardcoded key list drifting out of sync.
EXPECTED_CHECKLIST_KEYS: frozenset = checklist_registry.get_ai_fillable_keys()
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


def _fetch_commute_minutes(lat: float, lng: float) -> Optional[int]:
    """Call ORS Matrix API for driving minutes from Veerenni 28 (config.BOLT_HQ_LAT/LNG) to one listing at (lat, lng).

    Returns None on failure (never-raise). Returns None if config.ORS_API_KEY is empty (soft skip).
    """
    if not config.ORS_API_KEY:
        return None
    payload = {
        "locations": [
            [config.BOLT_HQ_LNG, config.BOLT_HQ_LAT],  # [lon, lat] order per ORS/GeoJSON convention; DO NOT swap. See RESEARCH Pitfall 2.
            [lng, lat],  # [lon, lat] order per ORS/GeoJSON convention; DO NOT swap. See RESEARCH Pitfall 2.
        ],
        "sources": [0],
        "destinations": [1],
        "metrics": ["duration"],
    }
    headers = {
        "Authorization": f"Bearer {config.ORS_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            "https://api.openrouteservice.org/v2/matrix/driving-car",
            json=payload,
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        # ORS collapses the matrix when sources/destinations are subset — result is
        # len(sources) rows × len(destinations) cols, indexed by their POSITION in
        # the filter list (not in the full locations array). sources=[0]+destinations=[1]
        # → single-cell matrix [[X]]. Old code assumed the full 1×2 matrix and hit IndexError.
        duration_secs = resp.json()["durations"][0][0]
        if duration_secs is None:
            return None
        return max(1, round(duration_secs / 60))
    except Exception:
        log.exception("ORS matrix call failed for lat=%s lng=%s — skipping commute_minutes", lat, lng)
        return None


def _geocode_with_nominatim(query: str) -> tuple[Optional[float], Optional[float]]:
    """Geocode an address string via Nominatim. Returns (lat, lng) tuple on success or (None, None) on failure.

    Never raises. Caller is responsible for sleeping 1.1 seconds between successive calls
    per Nominatim usage policy (RESEARCH section 3).
    """
    headers = {
        # NON-NEGOTIABLE per Nominatim usage policy (RESEARCH Pitfall 4).
        "User-Agent": "ApartsLooker/1.0 daniel.tjulinov@gmail.com",
    }
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "json", "limit": 1},
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
        if not results or not isinstance(results, list):
            return (None, None)
        return (float(results[0]["lat"]), float(results[0]["lon"]))
    except Exception:
        log.exception("Nominatim geocode failed for query=%s", query)
        return (None, None)


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

        # District line: prefer Maa-amet sold-price baseline (SPEC §6) over asking-price avg.
        # Listing dataclass lacks district field — use getattr with empty-string default (RESEARCH Pitfall 2).
        dist = getattr(listing, "district", "")
        if dist:
            quarter = maa_amet_baseline.latest_quarter()
            structure = getattr(listing, "material", "") or ""
            year_built = getattr(listing, "year_built", None)
            sold_median, sold_n, bucket_label = maa_amet_baseline.get_median(
                dist, structure, year_built, quarter
            )
            if sold_median and sold_n:
                district_line = (
                    f"District median (sold): {sold_median} EUR/m² across {sold_n} transactions "
                    f"[{bucket_label}]\n\n"
                )
            else:
                # Fallback: asking-price average from stored listings.
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
            # Try to reuse an existing commute value from the stored entry so we
            # don't burn an ORS call on every price-drop re-evaluation.
            existing_commute = None
            for e in app_data.get("pending", []) + app_data.get("properties", []) + app_data.get("rejected", []):
                if e.get("id") == listing.id:
                    existing_commute = e.get("commute_minutes")
                    break
            evaluation = evaluate_listing(
                listing,
                context_prefix,
                commute_minutes=existing_commute,
                district=getattr(listing, "district", "") or "",
            )
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

    Wave 6D: also stamps viewing_history[-1].withdrawn_at so the frontend can show
    days-on-market signal for sold/withdrawn listings (SPEC §6).

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
        # Wave 6D: stamp withdrawn_at on viewing_history for shortlisted removed listings.
        # data_store.mark_listing_withdrawn handles the Postgres write (row-scoped).
        for item in batch_dicts:
            if item.get("raw_ok", True):
                continue
            listing_id = item.get("id") or extract_object_id(item.get("url", ""))
            if listing_id:
                data_store.mark_listing_withdrawn(listing_id, today_str)
    except Exception:
        log.exception("_mark_removed_listings failed — skipping")


def _dispatch_ku_lookup(listing_id: str, address: str) -> None:
    """Daemon-thread target: look up KÜ for the given address and persist the result.

    Session-scope discipline (Wave 4 audit — site #2, RESEARCH § Pitfall 2):
    HTTP call to ariregister runs OUTSIDE any DB session; save_ku_enrichment
    scopes its own session internally. No data_store._lock needed (no-op in Wave 2;
    removed in Wave 4 by audit: this function never held _lock directly).

    On no match: logs and returns without writing anything to data_store (D-13 hide-when-empty).
    On any error: logs and returns (never-raise, mirrors _mark_removed_listings).
    """
    import ku_lookup  # noqa: PLC0415 — imported here to avoid circular dependency at module scope

    try:
        # HTTP call to ariregister — OUTSIDE any DB session (session-scope discipline, Wave 4)
        ku_data = ku_lookup.lookup_ku_for_address(address)
        if ku_data is None:
            log.info("No KÜ found for %s (%s) — noop", listing_id, address)
            return
        # save_ku_enrichment scopes its own session (opens + commits + closes internally)
        data_store.save_ku_enrichment(listing_id, ku_data)
        log.info("KÜ enrichment saved for %s: %s (reg_code=%s)", listing_id, ku_data.get("name"), ku_data.get("reg_code"))
    except Exception:
        log.exception("_dispatch_ku_lookup failed for listing_id=%s address=%s", listing_id, address)


def process_ingest_batch(listing_dicts: list[dict]) -> dict:
    """Filter, dedup, evaluate, and notify for a batch of Listing dicts POSTed by the mini PC.

    Phase 7 Wave 4 (RESEARCH § Pitfall 2, site #7):
    The outer lock wrapper is REMOVED. Per-listing HTTP calls
    (Anthropic evaluate_listing, Nominatim geocode, ORS commute, Telegram send_pending_card)
    run OUTSIDE any DB session. Per-listing data_store.* writes (add_to_pending,
    write_checklist_ai) each scope their own short-lived session internally.
    The batch-end save_app_data / save_agent_state calls use the compat shim
    (Wave 5 will optimize these hot callers to row-scoped writes).

    Never raises — per-listing failures are logged and skipped.
    Returns {"ok": True, "processed": <batch size>}.

    Phase 3 (D-11, D-12): records price for every listing on every scrape run — both
    known (dedup hit) and new listings. today_str is computed once per batch so a midnight
    rollover during a large batch doesn't split the same batch's entries across two dates.
    Phase 3 (D-14, D-15, D-16, D-17, D-18): _record_and_check_price_drop replaces bare
    record_price_in_data calls; _mark_removed_listings runs post-loop.

    Wave 8B: Telegram two-pass.
    After all listings are evaluated and persisted, the batch is sorted by score descending.
    Top-N (config.TELEGRAM_PHOTO_CARDS_PER_RUN) listings at or above TELEGRAM_MIN_SCORE_PHOTO
    get a full photo card via send_pending_card(). All remaining listings at or above
    TELEGRAM_MIN_SCORE_TEXT (including photo-tier overflow) get a single digest message
    via send_digest(). Listings below both thresholds are silent (dashboard only).
    High-severity AI risk suppression is handled per-card inside send_pending_card().
    """
    log.info("Ingest batch received: %d listings", len(listing_dicts))

    state = data_store.load_agent_state()
    # Load app_data once before the loop; reload after sub-helpers that self-save
    # (add_to_pending, write_checklist_ai) so price_history mutations see their writes.
    # load_app_data() opens + closes its own session before returning the dict — no
    # session is held across the HTTP calls below (RESEARCH § Pitfall 2).
    app_data = data_store.load_app_data()
    # Single date snapshot for the entire batch (D-12, RESEARCH Pattern 5)
    today_str = _date.today().isoformat()

    # Accumulate (listing, evaluation) pairs for new listings that pass the text threshold.
    # Used by the two-pass Telegram send at the end of the batch.
    telegram_candidates: list[tuple] = []

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

        # NOTE: hard-filter enforcement removed. Scraper is the single source
        # of truth for price/rooms/images filters — it injects those as query
        # params into the kv.ee search URL so we don't fetch what we'd reject
        # anyway. If an out-of-bounds listing arrives here, it's a scraper
        # URL-builder bug — fix it there, not by adding a backend backstop
        # that would drift out of sync and cause false alarms.

        try:
            log.info("Evaluating listing %s: %s", listing.id, listing.title)
            # Compute commute + cost-of-ownership BEFORE the AI call so the
            # model has the real values and can factor them into the score.
            # These HTTP calls (_fetch_commute_minutes via ORS, cost_calculator)
            # run OUTSIDE any DB session — no session is held at this point.
            pre_commute_mins = None
            if listing.lat is not None and listing.lng is not None:
                pre_commute_mins = _fetch_commute_minutes(listing.lat, listing.lng)
            import cost_calculator
            coo = cost_calculator.compute_cost_of_ownership(
                listing.price_eur, listing.area_sqm, listing.year_built,
            )
            context_prefix = _build_context_prefix(listing, app_data)
            # Anthropic HTTP call — OUTSIDE any DB session (session-scope discipline, Wave 4)
            evaluation = evaluate_listing(
                listing,
                context_prefix,
                commute_minutes=pre_commute_mins,
                district=getattr(listing, "district", "") or "",
                cost_of_ownership=coo,
            )
            log.info("Score: %s/100 — %s", evaluation.get("score"), evaluation.get("verdict"))

            # Build the pending entry: full Listing fields + evaluation + metadata.
            # New AI schema fields (score_breakdown, risks) are carried through so
            # the frontend can render the structured breakdown. The old vague
            # ai_checklist is no longer written — deleted from the writing path
            # entirely (existing on-disk entries still readable, just not updated).
            pending_entry = {
                **dataclasses.asdict(listing),
                "score": evaluation.get("score", 0),
                "verdict": evaluation.get("verdict", ""),
                "score_breakdown": evaluation.get("score_breakdown", {}),
                "risks": evaluation.get("risks", []),
                "strengths": evaluation.get("strengths", []),
                "concerns": evaluation.get("concerns", []),  # legacy, kept for old-frontend fallback
                "ai_checklist_fills": evaluation.get("checklist_fills", {}),
                "cost_of_ownership": coo,
                "draft_subject": (
                    evaluation.get("draft_subject") or f"Inquiry about {listing.title}"
                ),
                "draft_body": evaluation.get("draft_body") or "",
                "queued_at": datetime.now(timezone.utc).isoformat(),
                "tg_message_id": None,
                "tg_chat_id": None,
            }
            # add_to_pending scopes its own session (opens + commits + closes internally)
            data_store.add_to_pending(pending_entry)

            # Persist renovation_items onto checklist.renovation_items (Wave 6C).
            # Must happen after add_to_pending so the row exists.
            reno_items = evaluation.get("renovation_items", [])
            if reno_items:
                data_store.write_renovation_items(listing.id, reno_items)

            # Reload app_data to pick up add_to_pending / write_checklist_ai writes.
            # load_app_data() opens + closes its own session — no session held here.
            app_data = data_store.load_app_data()

            # Persist coords + commute (already computed pre-evaluation above).
            # In-place mutation of app_data['pending'] entry mirrors _handle_price_drop pattern
            # (RESEARCH section 10).
            if listing.lat is not None and listing.lng is not None:
                for entry in app_data.get("pending", []):
                    if entry.get("id") == listing.id:
                        entry["lat"] = listing.lat
                        entry["lng"] = listing.lng
                        entry["commute_minutes"] = pre_commute_mins
                        break

            # Record initial price for newly-seen listing AFTER the reload so the
            # mutation lands on the same app_data dict that will be saved at loop end
            # (D-11, D-12, D-14, RESEARCH Pattern 5).
            _record_and_check_price_drop(app_data, listing, today_str)

            # Wave 8B: collect listings that qualify for at least text-tier Telegram.
            # Actual send happens in the two-pass block below, after all listings
            # are evaluated, so the top-N photo cards get priority ordering.
            score = evaluation.get("score", 0)
            if score >= config.TELEGRAM_MIN_SCORE_TEXT:
                telegram_candidates.append((listing, evaluation, score))

        except Exception:
            log.exception("Failed to process listing %s — skipping", listing.id)

    # Post-loop: mark listings with raw_ok=False as removed (D-18, INTEL-03).
    # Pass the original raw batch dicts so raw_ok signals are available.
    _mark_removed_listings(app_data, listing_dicts)

    data_store.save_agent_state(state)
    # Persist accumulated price_history mutations from this batch (D-11, D-12)
    # save_app_data uses the compat shim (Wave 5 will optimize to per-row writes)
    data_store.save_app_data(app_data)

    # ── Wave 8B: two-pass Telegram ──────────────────────────────────────────
    # Sort by score descending so the highest-signal listings get photo cards.
    telegram_candidates.sort(key=lambda t: t[2], reverse=True)

    photo_cap = config.TELEGRAM_PHOTO_CARDS_PER_RUN
    photo_tier = [t for t in telegram_candidates if t[2] >= config.TELEGRAM_MIN_SCORE_PHOTO]
    text_tier_only = [t for t in telegram_candidates if t[2] < config.TELEGRAM_MIN_SCORE_PHOTO]

    # Pass 1: send photo cards for the top-N photo-tier listings.
    photo_sent = 0
    for listing, evaluation, score in photo_tier[:photo_cap]:
        try:
            tg_message_id, tg_chat_id = telegram_client.send_pending_card(listing, evaluation)
            log.info(
                "Telegram photo card for %s (score=%s) → message_id=%s",
                listing.id, score, tg_message_id,
            )
            if tg_message_id is not None:
                photo_sent += 1
                # Patch the pending entry with the Telegram reference (best-effort reload).
                app_data_patch = data_store.load_app_data()
                for entry in app_data_patch.get("pending", []):
                    if entry.get("id") == listing.id:
                        entry["tg_message_id"] = tg_message_id
                        entry["tg_chat_id"] = tg_chat_id
                        break
                data_store.save_app_data(app_data_patch)
        except Exception:
            log.exception("Telegram photo card failed for %s", listing.id)

    # Pass 2: digest for overflow photo-tier + all text-tier-only listings.
    overflow_count = max(0, len(photo_tier) - photo_cap)
    digest_count = overflow_count + len(text_tier_only)
    if digest_count > 0:
        try:
            telegram_client.send_digest(digest_count, config.TELEGRAM_MIN_SCORE_TEXT)
            log.info(
                "Telegram digest sent: %d listings (overflow=%d, text-only=%d)",
                digest_count, overflow_count, len(text_tier_only),
            )
        except Exception:
            log.exception("Telegram send_digest failed")
    # ────────────────────────────────────────────────────────────────────────

    return {"ok": True, "processed": len(listing_dicts)}


def handle_heartbeat(payload: dict) -> dict:
    """Store heartbeat state for plan 01-03's scheduler-tick alert checks.

    Updates last_heartbeat_ts, last_heartbeat_listing_count, and consecutive_zero_count.
    When listing_count == 0, increments consecutive_zero_count; when > 0, resets it to 0
    (explicit reset required — per RESEARCH Pitfall 3).
    NEVER logs INGEST_TOKEN or the presented Bearer credential (per RESEARCH Security Domain).
    Returns {"ok": True}.

    Phase 7 Wave 4 (site #4): lock wrapper removed. agent_state.json
    is filesystem-backed (D-Discretion); load_agent_state / save_agent_state use atomic
    os.replace writes — no session concerns here. No HTTP calls in this function.
    """
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
