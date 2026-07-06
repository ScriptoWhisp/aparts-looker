"""
Minimal Telegram Bot API client: send listing cards, poll for incoming
"/send <id>" commands from Daniel.
"""

import re

import requests

from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
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
