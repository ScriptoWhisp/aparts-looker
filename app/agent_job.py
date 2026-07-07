"""
The periodic kv.ee check, adapted from the original GitHub-Actions version to
run in-process on a schedule and write straight into the shared data_store
instead of separate state files. Same logic, one less moving part.
"""

import logging

import config
import data_store
from ai_evaluator import evaluate_listing
from gmail_client import create_draft, send_email
from kv_alert_reader import fetch_listing_urls
from kv_listing_parser import fetch_listing, extract_object_id
from telegram_client import (
    extract_send_commands,
    format_listing_card,
    get_new_updates,
    send_message,
    send_photo,
)

log = logging.getLogger("agent_job")


def _listing_to_property(listing, evaluation):
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


def process_new_listings(state: dict) -> None:
    new_urls = fetch_listing_urls()
    log.info("Scraped %d total URLs from kv.ee", len(new_urls))

    seen = set(state["seen_listing_ids"])
    fresh_urls = [u for u in new_urls if (extract_object_id(u) or u) not in seen]
    log.info("%d URLs already seen, %d new to process", len(new_urls) - len(fresh_urls), len(fresh_urls))

    for url in fresh_urls:
        log.info("Fetching listing: %s", url)
        listing = fetch_listing(url)
        if not listing.raw_ok:
            log.warning("Failed to fetch listing: %s", url)
            continue

        state["seen_listing_ids"].append(listing.id)

        if listing.price_eur and listing.price_eur > config.MAX_PRICE_EUR:
            log.info("Skipping %s — price %s > max %s", listing.id, listing.price_eur, config.MAX_PRICE_EUR)
            continue
        if listing.rooms and listing.rooms < config.MIN_ROOMS:
            log.info("Skipping %s — rooms %s < min %s", listing.id, listing.rooms, config.MIN_ROOMS)
            continue

        log.info("Evaluating listing %s: %s", listing.id, listing.title)
        evaluation = evaluate_listing(listing)
        log.info("Score: %s/100 — %s", evaluation.get('score'), evaluation.get('verdict'))
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


def run_check() -> None:
    """Entry point called by the scheduler on each tick. Never raises -
    logs and moves on, so one bad run doesn't kill the background job."""
    log.info("Running kv.ee check...")
    state = data_store.load_agent_state()
    try:
        process_send_commands(state)
        process_new_listings(state)
    except Exception:
        log.exception("agent_job.run_check failed")
    finally:
        data_store.save_agent_state(state)
    log.info("Check complete.")
