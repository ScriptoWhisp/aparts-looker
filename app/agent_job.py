"""
The periodic scheduler tick — telegram command polling and (added in Phase 1 plan 03) heartbeat/zero-listing checks.
Scraping moved to the mini PC client (Phase 1, plan 01) and is invoked via POST /api/ingest, not from here.
"""

import logging

import data_store
from gmail_client import send_email
from telegram_client import (
    extract_send_commands,
    get_new_updates,
    send_message,
)

log = logging.getLogger("agent_job")


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


def run_check() -> None:
    """Entry point called by the scheduler on each tick. Never raises -
    logs and moves on, so one bad run doesn't kill the background job."""
    log.info("Running scheduler tick...")
    state = data_store.load_agent_state()
    try:
        process_send_commands(state)
    except Exception:
        log.exception("agent_job.run_check failed")
    finally:
        data_store.save_agent_state(state)
    log.info("Tick complete.")
