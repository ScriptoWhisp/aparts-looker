"""
The periodic scheduler tick — telegram command polling and (added in Phase 1 plan 03) heartbeat/zero-listing checks.
Scraping moved to the mini PC client (Phase 1, plan 01) and is invoked via POST /api/ingest, not from here.
"""

import logging
from datetime import datetime, timezone

import config
import data_store
from config import TELEGRAM_CHAT_ID
from gmail_client import send_email
from telegram_client import (
    extract_send_commands,
    get_new_updates,
    send_message,
)

log = logging.getLogger("agent_job")


def process_pending_action(cq: dict) -> None:
    """Dispatch an inline keyboard button tap from Telegram. Never raises — never-raise pattern.

    Flow per D-09:
      - answer_callback_query FIRST (dismiss loading spinner, RESEARCH Pitfall 1)
      - chat_id guard (T-02-CQ-SPOOF mitigation)
      - compact callback_data parsing: "approve:<id>", "reject:<id>", "rr:<reason>:<id>"
      - approve / reject state transitions via data_store (T-02-DOUBLE-TAP idempotency)
      - edit_card_resolved updates the card caption and removes buttons (D-08)
    """
    from telegram_client import answer_callback_query, edit_card_resolved, send_rejection_prompt  # lazy import

    # Chat-id guard: only process updates from Daniel's chat (RESEARCH Security Domain, T-02-CQ-SPOOF)
    chat_id = cq.get("message", {}).get("chat", {}).get("id")
    if str(chat_id) != str(TELEGRAM_CHAT_ID):
        log.warning("callback_query from unknown chat_id %s — ignored", chat_id)
        return

    # Acknowledge immediately to prevent loading spinner (RESEARCH Pitfall 1)
    answer_callback_query(cq.get("id", ""))

    try:
        data_str = cq.get("data", "")
        # Compact format: "approve:<id>", "reject:<id>", "rr:<reason>:<id>"
        parts = data_str.split(":", 2)
        action = parts[0] if parts else ""

        if action == "approve":
            listing_id = parts[1]
            ok = data_store.approve_listing(listing_id)
            resolved_text = (
                f"✅ Approved — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
                if ok else "✅ Already processed"
            )
            edit_card_resolved(cq, resolved_text)

        elif action == "reject":
            # Two-step flow (D-10): show reason picker first; reject_listing runs when rr: arrives
            listing_id = parts[1]
            send_rejection_prompt(cq, listing_id)

        elif action == "rr":
            # reject_reason: rr:<reason>:<id>
            reason = parts[1]
            listing_id = parts[2]
            if reason not in {"price", "location", "condition", "other"}:
                reason = "other"
            ok = data_store.reject_listing(listing_id, reason)
            resolved_text = (
                f"❌ Rejected: {reason.capitalize()} — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
                if ok else "❌ Already processed"
            )
            edit_card_resolved(cq, resolved_text)

    except Exception:
        log.exception("process_pending_action failed for callback_query id=%s", cq.get("id"))


def process_send_commands(state: dict) -> None:
    updates, new_last_update_id = get_new_updates(state["last_telegram_update_id"])
    listing_ids = extract_send_commands(updates)
    state["last_telegram_update_id"] = new_last_update_id

    for listing_id in listing_ids:
        draft = state["pending_drafts"].get(listing_id)
        if not draft:
            send_message(
                f"No prepared email found for {listing_id} — "
                f"it may have had no direct email address, or it was already sent."
            )
            continue
        ok = send_email(draft["to_email"], draft["subject"], draft["body"])
        if ok:
            send_message(f"✅ Email for listing {listing_id} sent to the agent.")
            del state["pending_drafts"][listing_id]
        else:
            send_message(f"⚠️ Failed to send email for listing {listing_id}.")

    # New: dispatch callback_query events (inline keyboard button taps) from Daniel
    for update in updates:
        cq = update.get("callback_query")
        if cq:
            process_pending_action(cq)


def _alert_cooldown_ok(state: dict, now: datetime) -> bool:
    """Return True when no alert has been sent in the last 24 hours (RESEARCH Open Question 2).

    Fail-open: returns True on any parse failure so a real outage is never silently swallowed.
    """
    last = state.get("last_scraper_alert_sent_at")
    if last is None:
        return True
    try:
        parsed = datetime.fromisoformat(last)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return (now - parsed).total_seconds() / 3600 >= 24
    except (ValueError, TypeError):
        return True  # fail-open — better to double-alert than to miss a real outage


def check_heartbeat_timeout(state: dict) -> None:
    """Fire a Telegram alert if the scraper has gone silent longer than the threshold.

    Idempotent within a 24h cooldown window (per RESEARCH Open Question 2).
    Returns silently on any parse failure — never re-raises inside run_check's try block.

    Threshold logic (D-10):
      - If HEARTBEAT_TIMEOUT_HOURS > 0 use it directly (explicit env-var override).
      - Otherwise fall back to CHECK_INTERVAL_HOURS * 2 + 0.5 (grace period formula).
    No-baseline guard: returns immediately when last_heartbeat_ts is None so a fresh VPS
    restart before the first mini PC scrape does not fire a spurious alert (RESEARCH Pitfall 4).
    """
    last_ts_str = state.get("last_heartbeat_ts")
    if last_ts_str is None:
        return  # no baseline yet — don't alert until first heartbeat arrives

    try:
        last_ts = datetime.fromisoformat(last_ts_str)
    except (ValueError, TypeError):
        log.warning("check_heartbeat_timeout: could not parse last_heartbeat_ts=%r", last_ts_str)
        return  # never-raise

    now = datetime.now(timezone.utc)
    if last_ts.tzinfo is None:
        last_ts = last_ts.replace(tzinfo=timezone.utc)

    elapsed_hours = (now - last_ts).total_seconds() / 3600
    threshold = config.HEARTBEAT_TIMEOUT_HOURS if config.HEARTBEAT_TIMEOUT_HOURS > 0 else config.CHECK_INTERVAL_HOURS * 2 + 0.5

    if elapsed_hours <= threshold:
        return

    if not _alert_cooldown_ok(state, now):
        log.info("Skipping offline alert — cooldown active")
        return

    send_message(
        f"Scraper offline — last heartbeat: {last_ts_str} "
        f"({int(elapsed_hours)}h ago). Check the mini PC."
    )
    state["last_scraper_alert_sent_at"] = now.isoformat()
    log.warning("Scraper heartbeat overdue by %.1fh (threshold %.1fh)", elapsed_hours, threshold)


def check_consecutive_zeros(state: dict) -> None:
    """Fire a Telegram alert if the scraper reported zero listings for 2+ consecutive runs (ARCH-04).

    Cooldown-gated by _alert_cooldown_ok to prevent alert fatigue (RESEARCH Open Question 2).
    Sets state['last_scraper_alert_sent_at'] on send; run_check's finally block persists it.
    """
    count = state.get("consecutive_zero_count", 0)
    if count < 2:
        return

    last_ts = state.get("last_heartbeat_ts", "unknown")
    now = datetime.now(timezone.utc)

    if not _alert_cooldown_ok(state, now):
        log.info("Skipping zero-listing alert — cooldown active")
        return

    send_message(
        f"Scraper returned 0 listings for {count} consecutive runs. "
        f"Last heartbeat: {last_ts}. kv.ee may be blocking or the search URL returned no results."
    )
    state["last_scraper_alert_sent_at"] = now.isoformat()
    log.warning("Zero-listing alert: %d consecutive empty runs", count)


def run_check() -> None:
    """Entry point called by the scheduler on each tick. Never raises -
    logs and moves on, so one bad run doesn't kill the background job."""
    log.info("Running scheduler tick...")
    state = data_store.load_agent_state()
    try:
        process_send_commands(state)
        check_heartbeat_timeout(state)
        check_consecutive_zeros(state)
    except Exception:
        log.exception("agent_job.run_check failed")
    finally:
        data_store.save_agent_state(state)
    log.info("Tick complete.")
