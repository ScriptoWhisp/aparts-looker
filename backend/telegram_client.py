"""
Minimal Telegram Bot API client: send listing cards, poll for incoming
"/send <id>" commands from Daniel.
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


def send_pending_card(listing: Listing, evaluation: dict) -> tuple[int | None, int | None]:
    """Tiered pending notification. Returns (message_id, chat_id) or (None, None).

    Tiers:
      score >= TELEGRAM_MIN_SCORE_PHOTO (default 80): full photo card w/ buttons
      score >= TELEGRAM_MIN_SCORE_TEXT  (default 65): compact one-line text
      score below both:                                silent (dashboard only)

    Any AI-flagged high-severity risk suppresses delivery entirely regardless of
    score — user shouldn't get pinged about listings the AI already called out.

    Silence toggle: if agent_state.telegram_silenced_until is in the future,
    no card is sent (button in the dashboard sets this).
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

    # High-severity risk override — never spam listings the AI already flags.
    risks = evaluation.get("risks") or []
    high_risks = [r for r in risks if isinstance(r, dict) and r.get("severity") == "high"]
    if high_risks:
        log.info(
            "Suppressing Telegram for %s: score=%s but %d high-severity risk(s)",
            listing.id, score, len(high_risks),
        )
        return None, None

    if score < config.TELEGRAM_MIN_SCORE_TEXT:
        log.info(
            "Skipping Telegram for %s: score %s < text threshold %s",
            listing.id, score, config.TELEGRAM_MIN_SCORE_TEXT,
        )
        return None, None

    price = listing.price_eur or 0
    price_m2 = listing.price_per_sqm or 0
    rooms = listing.rooms if listing.rooms is not None else "?"
    area = listing.area_sqm if listing.area_sqm is not None else "?"

    # Photo tier: full card with keyboard.
    # Text tier: single line, no photo, but still gets verdict + a dashboard
    # link — glance-and-move-on, not glance-and-be-mystified.
    is_photo_tier = score >= config.TELEGRAM_MIN_SCORE_PHOTO

    # Build the internal dashboard deep-link (empty when WEB_BASE_URL isn't
    # configured — the frontend reads ?listing=<id> on load and jumps to the
    # detail panel).
    dashboard_url = ""
    if config.WEB_BASE_URL:
        base = config.WEB_BASE_URL.rstrip("/")
        if not base.startswith("http"):
            base = "https://" + base
        dashboard_url = f"{base}/?listing={listing.id}"

    if is_photo_tier:
        caption = (
            f"{score}/100 | {verdict} | {price:,} EUR · {price_m2:,}/m² | "
            f"{rooms} rooms · {area} m² | {listing.title or listing.url}"
        )
        buttons = [
            {"text": "Approve", "callback_data": f"approve:{listing.id}"},
            {"text": "Reject",  "callback_data": f"reject:{listing.id}"},
        ]
        if dashboard_url:
            buttons.append({"text": "Dashboard", "url": dashboard_url})
        buttons.append({"text": "kv.ee", "url": listing.url})
        reply_markup = {"inline_keyboard": [buttons]}
    else:
        # Compact text — includes the AI verdict and (when configured) the
        # dashboard deep-link so the user can click straight to the detail
        # view instead of hunting for the listing in the sidebar.
        parts = [
            f"[{score}] {listing.title or listing.id}",
            f"→ {verdict}" if verdict else "",
            f"{price:,}€ ({price_m2:,}€/m²) · {rooms}r · {area}m²",
        ]
        caption = "\n".join(p for p in parts if p)
        links = [f"kv.ee: {listing.url}"]
        if dashboard_url:
            links.append(f"dashboard: {dashboard_url}")
        caption = caption + "\n" + " · ".join(links)
        # Even text tier gets an inline keyboard when we have a dashboard URL —
        # one tap is much better than long-pressing the link.
        if dashboard_url:
            reply_markup = {"inline_keyboard": [[
                {"text": "Dashboard", "url": dashboard_url},
                {"text": "kv.ee", "url": listing.url},
            ]]}
        else:
            reply_markup = None

    try:
        if is_photo_tier and listing.image_url:
            payload = {
                "chat_id": TELEGRAM_CHAT_ID,
                "photo": listing.image_url,
                "caption": caption,
                "reply_markup": reply_markup,
            }
            resp = requests.post(f"{API_BASE}/sendPhoto", json=payload, timeout=15)
        else:
            payload = {
                "chat_id": TELEGRAM_CHAT_ID,
                "text": caption,
                "disable_web_page_preview": not is_photo_tier,
            }
            if reply_markup:
                payload["reply_markup"] = reply_markup
            resp = requests.post(f"{API_BASE}/sendMessage", json=payload, timeout=15)
        if resp.status_code == 200:
            result = resp.json().get("result", {})
            return result.get("message_id"), result.get("chat", {}).get("id")
        # Surface the failure — previously this was swallowed silently.
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


def edit_card_resolved(cq: dict, resolved_caption: str) -> None:
    """Update card caption to resolved state and remove inline keyboard (per D-08).

    Silently tolerates stale message_id or deleted Telegram messages (RESEARCH Pitfall 3).
    """
    try:
        requests.post(
            f"{API_BASE}/editMessageCaption",
            json={
                "chat_id": cq["message"]["chat"]["id"],
                "message_id": cq["message"]["message_id"],
                "caption": resolved_caption,
                "reply_markup": {"inline_keyboard": []},
            },
            timeout=15,
        )
    except (requests.RequestException, KeyError):
        pass  # never-raise — stale message_id or deleted message is acceptable


def send_rejection_prompt(cq: dict, listing_id: str) -> None:
    """Edit the card to show reason picker buttons (per D-11).

    Uses compact callback_data format rr:<reason>:<id> to fit Telegram's 64-byte limit
    (RESEARCH Risk 2). Reason enum: price / location / condition / other.
    """
    try:
        requests.post(
            f"{API_BASE}/editMessageCaption",
            json={
                "chat_id": cq["message"]["chat"]["id"],
                "message_id": cq["message"]["message_id"],
                "caption": "Why reject? Pick a reason:",
                "reply_markup": {
                    "inline_keyboard": [[
                        {"text": "Price",     "callback_data": f"rr:price:{listing_id}"},
                        {"text": "Location",  "callback_data": f"rr:location:{listing_id}"},
                        {"text": "Condition", "callback_data": f"rr:condition:{listing_id}"},
                        {"text": "Other",     "callback_data": f"rr:other:{listing_id}"},
                    ]]
                },
            },
            timeout=15,
        )
    except (requests.RequestException, KeyError):
        pass


def answer_callback_query(callback_query_id: str, text: str = "") -> None:
    """Acknowledge a callback query to dismiss the Telegram loading spinner (RESEARCH Pitfall 1).

    Must be called before any state change to give the user immediate feedback.
    """
    try:
        requests.post(
            f"{API_BASE}/answerCallbackQuery",
            json={"callback_query_id": callback_query_id, "text": text},
            timeout=10,
        )
    except requests.RequestException:
        pass
