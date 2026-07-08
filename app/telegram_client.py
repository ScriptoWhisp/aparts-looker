"""
Minimal Telegram Bot API client: send listing cards, poll for incoming
"/send <id>" commands from Daniel.
"""

from __future__ import annotations

import re

import requests

from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WEB_BASE_URL
from kv_listing_parser import Listing

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


def send_pending_card(listing: Listing, evaluation: dict) -> tuple[int | None, int | None]:
    """Send compact pending card with inline keyboard. Returns (message_id, chat_id) or (None, None).

    Caption format (D-06): {score}/100 | {verdict} | {price:,} EUR · {price_per_sqm:,}/m² |
    {rooms} rooms · {area} m² | {title or url}
    The middle-dot U+00B7 character is intentional per CONTEXT.md D-06 spec.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return None, None

    score = evaluation.get("score", 0)
    verdict = evaluation.get("verdict", "")
    price = listing.price_eur or 0
    price_m2 = listing.price_per_sqm or 0
    rooms = listing.rooms if listing.rooms is not None else "?"
    area = listing.area_sqm if listing.area_sqm is not None else "?"
    caption = (
        f"{score}/100 | {verdict} | {price:,} EUR · {price_m2:,}/m² | "
        f"{rooms} rooms · {area} m² | {listing.title or listing.url}"
    )

    reply_markup = {
        "inline_keyboard": [[
            {"text": "Approve", "callback_data": f"approve:{listing.id}"},
            {"text": "Reject",  "callback_data": f"reject:{listing.id}"},
            {"text": "More",    "url": f"https://{WEB_BASE_URL}/pending/{listing.id}"},
        ]]
    }

    try:
        if listing.image_url:
            resp = requests.post(
                f"{API_BASE}/sendPhoto",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "photo": listing.image_url,
                    "caption": caption,
                    "parse_mode": "HTML",
                    "reply_markup": reply_markup,
                },
                timeout=15,
            )
        else:
            resp = requests.post(
                f"{API_BASE}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": caption,
                    "parse_mode": "HTML",
                    "reply_markup": reply_markup,
                },
                timeout=15,
            )
        if resp.status_code == 200:
            result = resp.json().get("result", {})
            return result.get("message_id"), result.get("chat", {}).get("id")
    except requests.RequestException:
        pass
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
