"""
Minimal Telegram Bot API client: send listing cards (notifier only — Wave 6B),
poll for incoming "/send <id>" commands from Daniel.

Wave 6B: Telegram is a notifier surface only.  Approve/Reject inline keyboard
buttons have been removed.  Every card now carries a single "Open Inbox" deep-link
button that routes directly to the Inbox tab (`#inbox`).  All triage happens in the
web app.  Callback_query processing (approve:/reject:/rr:) has been deleted from
agent_job.py — if a stale pre-deploy card triggers a callback, answer_callback_query
returns a user-friendly message and no state is mutated.

Wave 8B: Two-message flow per scrape run.
  1. Full photo card(s) for the top hit(s) (score >= TELEGRAM_MIN_SCORE_PHOTO).
     Caption format: "{score} · {title}\n{price} € · {area} m² · {district}\n\n{verdict}\n\nOpen in Aparts Looker ↗"
     No inline_keyboard at all — the deep-link is in the caption body.
  2. Digest follow-up ("N more above X today. Open inbox ↗") for anything that
     qualified for text-tier but was not sent as a photo card, including overflow
     when photo-tier hits exceed TELEGRAM_PHOTO_CARDS_PER_RUN (default 3).

  process_ingest_batch() in ingest_handler.py orchestrates the two-pass logic;
  send_pending_card() now handles photo-tier only; send_digest() handles the digest.
  Text-tier per-listing sends removed entirely.
"""

from __future__ import annotations

import logging
import re

import requests

import config
from config import (
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
)
# WEB_BASE_URL and TELEGRAM_MIN_SCORE_* NOT imported by name — read via
# config.X inside send_pending_card so runtime settings edits (via
# /api/settings) take effect without a process restart.
from kv_listing_parser import Listing

log = logging.getLogger("telegram_client")

API_BASE = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

SEND_CMD_RE = re.compile(r"^/send\s+(\d{6,8})\b")


def send_message(text: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        requests.post(
            f"{API_BASE}/sendMessage",
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": False,
            },
            timeout=15,
        )
    except requests.RequestException:
        pass


def send_photo(photo_url: str, caption: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        resp = requests.post(
            f"{API_BASE}/sendPhoto",
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "photo": photo_url,
                "caption": caption,
                "parse_mode": "HTML",
            },
            timeout=15,
        )
        if resp.status_code != 200:
            # Photo URL might be unreachable/invalid - fall back to a
            # plain text message so the listing still gets through.
            send_message(caption)
    except requests.RequestException:
        send_message(caption)


def format_listing_card(listing: Listing, evaluation: dict) -> str:
    score = evaluation.get("score", 0)
    verdict = evaluation.get("verdict", "")
    strengths = evaluation.get("strengths", [])
    concerns = evaluation.get("concerns", [])

    lines = [
        f"<b>{listing.title or listing.url}</b>",
        f"Score: <b>{score}/100</b>",
        f"{verdict}",
        "",
        f"Price: {listing.price_eur} EUR ({listing.price_per_sqm} EUR/m2)",
        f"Rooms: {listing.rooms} | Area: {listing.area_sqm} m2",
        f"Year: {listing.year_built} | Floor: {listing.floor}/{listing.floor_total}",
        f"Parking: {listing.parking}",
    ]

    if strengths:
        lines.append("")
        lines.append("👍 " + "; ".join(strengths))
    if concerns:
        lines.append("👎 " + "; ".join(concerns))

    lines.append("")
    lines.append(listing.url)

    if evaluation.get("should_draft_email"):
        if listing.contact_email:
            lines.append("")
            lines.append(
                f"✉️ Email to agent drafted and saved in Gmail drafts.\n"
                f"Reply <code>/send {listing.id}</code> to send it now."
            )
        else:
            lines.append("")
            lines.append(
                "✉️ No direct agent email — only the kv.ee contact form. "
                "Draft text below, paste it into the form at the link above:"
            )
            lines.append("")
            lines.append(f"<i>{evaluation.get('draft_body', '')}</i>")

    return "\n".join(lines)


def get_new_updates(last_update_id: int) -> tuple[list[dict], int]:
    """Poll Telegram for new messages since last_update_id.
    Returns (updates, new_last_update_id)."""
    if not TELEGRAM_BOT_TOKEN:
        return [], last_update_id
    try:
        resp = requests.get(
            f"{API_BASE}/getUpdates",
            params={"offset": last_update_id + 1, "timeout": 0},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        updates = data.get("result", [])
        new_last = last_update_id
        for u in updates:
            new_last = max(new_last, u.get("update_id", new_last))
        return updates, new_last
    except requests.RequestException:
        return [], last_update_id


def extract_send_commands(updates: list[dict]) -> list[str]:
    """Pulls listing ids out of any '/send <id>' text messages."""
    ids = []
    for u in updates:
        msg = u.get("message", {})
        text = msg.get("text", "") or ""
        m = SEND_CMD_RE.match(text.strip())
        if m:
            ids.append(m.group(1))
    return ids


def _telegram_is_silenced() -> tuple[bool, str]:
    """Return (silenced, iso_expiry) — is Telegram in the manual silence window?

    Looks at agent_state.telegram_silenced_until (ISO timestamp). Lazy import
    of data_store keeps this module load-order-independent.
    """
    try:
        import data_store
        from datetime import datetime, timezone as _tz
        state = data_store.load_agent_state()
        until = state.get("telegram_silenced_until")
        if not until:
            return False, ""
        deadline = datetime.fromisoformat(until.replace("Z", "+00:00"))
        if deadline > datetime.now(_tz.utc):
            return True, until
    except Exception:
        pass
    return False, ""


def _build_inbox_url() -> str:
    """Return the Inbox deep-link URL (WEB_BASE_URL + /#inbox), or "" if not configured.

    Read via config.WEB_BASE_URL at call time (not import time) so hot-edits via
    /api/settings take effect without a restart.
    """
    if not config.WEB_BASE_URL:
        return ""
    base = config.WEB_BASE_URL.rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    return f"{base}/#inbox"


def send_pending_card(listing: Listing, evaluation: dict) -> tuple[int | None, int | None]:
    """Send a photo-tier card for a single listing.  Returns (message_id, chat_id) or (None, None).

    Wave 8B: photo-tier only.  Text-tier per-listing sends removed — those are
    now rolled into a single digest message via send_digest().

    Eligibility check (score >= TELEGRAM_MIN_SCORE_PHOTO) is the CALLER's responsibility
    (ingest_handler.process_ingest_batch performs the two-pass sort). This function still
    guards against missing credentials, silence, and high-severity AI risks.

    Caption format (per Daniel's mockup, frame 4):
      {score} · {title}
      {price} € · {area} m² · {district}

      {verdict}

      Open in Aparts Looker ↗   <- only when WEB_BASE_URL is set; omitted otherwise

    No inline_keyboard.  The deep-link is inside the caption body.
    If listing.image_url is set, sendPhoto is used; otherwise sendMessage fallback.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return None, None

    silenced, until = _telegram_is_silenced()
    if silenced:
        log.info(
            "Telegram silenced until %s — suppressing card for %s", until, listing.id,
        )
        return None, None

    score = evaluation.get("score", 0)
    verdict = evaluation.get("verdict", "")

    # High-severity risk override — never ping listings the AI already called out.
    risks = evaluation.get("risks") or []
    high_risks = [r for r in risks if isinstance(r, dict) and r.get("severity") == "high"]
    if high_risks:
        log.info(
            "Suppressing Telegram for %s: score=%s but %d high-severity risk(s)",
            listing.id, score, len(high_risks),
        )
        return None, None

    price = listing.price_eur or 0
    area = listing.area_sqm if listing.area_sqm is not None else "?"
    district = getattr(listing, "district", "") or ""

    # Build caption per Daniel's mockup (frame 4).
    title_str = listing.title or listing.url
    line1 = f"{score} · {title_str}"
    line2_parts = [f"{price:,} €", f"{area} m²"]
    if district:
        line2_parts.append(district)
    line2 = " · ".join(line2_parts)
    caption_parts = [line1, line2, "", verdict]
    inbox_url = _build_inbox_url()
    if inbox_url:
        caption_parts.extend(["", f"Open in Aparts Looker ↗\n{inbox_url}"])

    caption = "\n".join(caption_parts)

    # No inline_keyboard in Wave 8B — deep-link lives in caption body.
    try:
        if listing.image_url:
            payload = {
                "chat_id": TELEGRAM_CHAT_ID,
                "photo": listing.image_url,
                "caption": caption,
                "parse_mode": "Markdown",
            }
            resp = requests.post(f"{API_BASE}/sendPhoto", json=payload, timeout=15)
            if resp.status_code != 200:
                # Photo URL unreachable — fall back to text so listing still surfaces.
                payload_fallback = {
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": caption,
                    "parse_mode": "Markdown",
                    "disable_web_page_preview": True,
                }
                resp = requests.post(f"{API_BASE}/sendMessage", json=payload_fallback, timeout=15)
        else:
            payload = {
                "chat_id": TELEGRAM_CHAT_ID,
                "text": caption,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            }
            resp = requests.post(f"{API_BASE}/sendMessage", json=payload, timeout=15)

        if resp.status_code == 200:
            result = resp.json().get("result", {})
            return result.get("message_id"), result.get("chat", {}).get("id")
        try:
            body = resp.json()
        except Exception:
            body = resp.text[:200]
        log.error(
            "Telegram send_pending_card HTTP %s: %s (listing=%s)",
            resp.status_code, body, listing.id,
        )
    except requests.RequestException as exc:
        log.error("Telegram send_pending_card request failed: %s (listing=%s)", exc, listing.id)
    return None, None


def send_digest(count: int, threshold: int) -> None:
    """Send the 'N more above X today. Open inbox' digest follow-up message.

    Called once per scrape run after all photo cards have been sent, for listings
    that qualified for text tier (score >= TELEGRAM_MIN_SCORE_TEXT) but were not
    sent as a full photo card — either because their score was below photo-tier,
    or because they were overflow when the photo-card cap (TELEGRAM_PHOTO_CARDS_PER_RUN)
    was reached.

    "today" semantics (Wave 8B — MVP option a):
      count = overflow from *this scrape run only* (not an Inbox-cumulative count).
      May send "3 more above 75 today" in the morning and "2 more above 75 today"
      at noon — each is self-contained per-scrape and accurate to that run.
    # TODO: switch to Inbox-cumulative counting when we track sent-digest state per day.

    No message is sent when count <= 0 or Telegram is not configured/silenced.
    """
    if count <= 0:
        return
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return

    silenced, until = _telegram_is_silenced()
    if silenced:
        log.info("Telegram silenced until %s — suppressing digest", until)
        return

    inbox_url = _build_inbox_url()
    text = f"{count} more above {threshold} today."
    if inbox_url:
        text += f" [Open inbox]({inbox_url})"

    try:
        resp = requests.post(
            f"{API_BASE}/sendMessage",
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": text,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            },
            timeout=15,
        )
        if resp.status_code != 200:
            try:
                body = resp.json()
            except Exception:
                body = resp.text[:200]
            log.error("Telegram send_digest HTTP %s: %s", resp.status_code, body)
    except requests.RequestException as exc:
        log.error("Telegram send_digest request failed: %s", exc)


def answer_callback_query(callback_query_id: str, text: str = "") -> None:
    """Acknowledge a Telegram callback query and dismiss the loading spinner.

    Wave 6B: callback_query processing (approve/reject/rr) has been removed from
    agent_job.py.  This function is kept so that stale cards (sent before deploy)
    that receive a tap get a friendly reply rather than a 404.  The text shown to
    the user should explain that triage moved to the dashboard.
    """
    try:
        requests.post(
            f"{API_BASE}/answerCallbackQuery",
            json={"callback_query_id": callback_query_id, "text": text},
            timeout=10,
        )
    except requests.RequestException:
        pass


def handle_stale_callback(cq: dict) -> None:
    """Reply to a stale approve/reject/rr callback from a pre-Wave-6B card.

    Triage has moved to the web Inbox.  We acknowledge the tap with a
    user-visible notification so the loading spinner disappears and the user
    understands why nothing happened — best-effort, never raises.
    """
    cq_id = cq.get("id", "")
    try:
        answer_callback_query(
            cq_id,
            "Triage moved to the dashboard — tap Open Inbox on newer cards.",
        )
    except Exception:
        pass  # never-raise


# ---------------------------------------------------------------------------
# Deprecated helpers — kept as no-ops so any lingering import sites don't crash
# ---------------------------------------------------------------------------

def edit_card_resolved(cq: dict, resolved_caption: str) -> None:  # noqa: ARG001
    """Removed in Wave 6B — Telegram is notifier-only; no card editing needed."""
    pass


def send_rejection_prompt(cq: dict, listing_id: str) -> None:  # noqa: ARG001
    """Removed in Wave 6B — rejection happens in the web Inbox, not Telegram."""
    pass
