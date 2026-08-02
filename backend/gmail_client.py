"""
Gmail access via App Password - no Google Cloud OAuth app registration
needed. Requires 2-Step Verification enabled on the Gmail account and an
App Password generated for it (myaccount.google.com/apppasswords).

- create_draft(): saves a message into the [Gmail]/Drafts folder via IMAP
  APPEND, so it shows up in Gmail exactly like a normal draft you can
  review, edit, or delete by hand.
- send_email(): sends via SMTP, used when Daniel replies "/send <id>" in
  Telegram.
"""

import imaplib
import smtplib
import time
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

from config import GMAIL_ADDRESS, GMAIL_APP_PASSWORD, IMAP_HOST, SMTP_HOST, SMTP_PORT


def _build_message(to_email: str, subject: str, body: str) -> MIMEText:
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    return msg


def create_draft(to_email: str, subject: str, body: str) -> bool:
    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD or not to_email:
        return False
    try:
        msg = _build_message(to_email, subject, body)
        conn = imaplib.IMAP4_SSL(IMAP_HOST)
        conn.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        # Gmail's drafts folder is usually "[Gmail]/Drafts" but can be
        # localized - fall back to plain "Drafts" if the first fails.
        folder_candidates = ["[Gmail]/Drafts", "Drafts"]
        appended = False
        for folder in folder_candidates:
            try:
                typ, _ = conn.append(
                    folder,
                    r"\Draft",
                    imaplib.Time2Internaldate(time.time()),
                    msg.as_bytes(),
                )
                if typ == "OK":
                    appended = True
                    break
            except imaplib.IMAP4.error:
                continue
        conn.logout()
        return appended
    except (imaplib.IMAP4.error, OSError):
        return False


def send_email(to_email: str, subject: str, body: str) -> bool:
    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD or not to_email:
        return False
    try:
        msg = _build_message(to_email, subject, body)
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_ADDRESS, [to_email], msg.as_bytes())
        return True
    except (smtplib.SMTPException, OSError):
        return False
