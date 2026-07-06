"""
Reads kv.ee's own "Telli e-agent" (saved-search email alert) messages from
Gmail via IMAP, and pulls out the listing URLs they contain.

Why read email instead of scraping the search-results page ourselves?
kv.ee already provides this as an official feature for exactly this use
case - no bot-detection risk, no pagination/sorting logic to maintain, and
it respects whatever search filters you configured directly on their site.

Setup required once: on kv.ee, build your search (rooms/price/district/etc.)
and click "Telli e-agent" / "Salvesta otsing" to start receiving alert
emails at the Gmail address this script reads.
"""

import email
import imaplib
import re
from email.header import decode_header

from config import GMAIL_ADDRESS, GMAIL_APP_PASSWORD, IMAP_HOST, KV_ALERT_SENDER

LISTING_URL_RE = re.compile(r"https://www\.kv\.ee/[a-z0-9\-]+-\d{6,8}\.html")


def _decode(value) -> str:
    if not value:
        return ""
    parts = decode_header(value)
    out = []
    for text, enc in parts:
        if isinstance(text, bytes):
            out.append(text.decode(enc or "utf-8", errors="ignore"))
        else:
            out.append(text)
    return "".join(out)


def _get_body_text(msg) -> str:
    if msg.is_multipart():
        chunks = []
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype in ("text/plain", "text/html"):
                try:
                    payload = part.get_payload(decode=True)
                    charset = part.get_content_charset() or "utf-8"
                    chunks.append(payload.decode(charset, errors="ignore"))
                except (TypeError, AttributeError):
                    continue
        return "\n".join(chunks)
    else:
        try:
            payload = msg.get_payload(decode=True)
            charset = msg.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="ignore")
        except (TypeError, AttributeError):
            return ""


def fetch_new_listing_urls(last_processed_uid: int) -> tuple[list[str], int]:
    """Returns (new_listing_urls, highest_uid_seen). Never raises past
    connection issues - returns empty results so the run can continue."""
    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
        return [], last_processed_uid

    try:
        conn = imaplib.IMAP4_SSL(IMAP_HOST)
        conn.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        conn.select("INBOX")

        search_criteria = f'(FROM "{KV_ALERT_SENDER}" UID {last_processed_uid + 1}:*)'
        status, data = conn.uid("search", None, search_criteria)
        if status != "OK" or not data or not data[0]:
            conn.logout()
            return [], last_processed_uid

        uids = [int(u) for u in data[0].split()]
        # UID SEARCH with "UID N:*" can include N itself even if already
        # processed - filter defensively.
        uids = [u for u in uids if u > last_processed_uid]
        if not uids:
            conn.logout()
            return [], last_processed_uid

        all_urls: set[str] = set()
        max_uid = last_processed_uid

        for uid in uids:
            status, msg_data = conn.uid("fetch", str(uid), "(RFC822)")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)
            body = _get_body_text(msg)
            urls = LISTING_URL_RE.findall(body)
            all_urls.update(urls)
            max_uid = max(max_uid, uid)

        conn.logout()
        return sorted(all_urls), max_uid

    except (imaplib.IMAP4.error, OSError):
        return [], last_processed_uid
