"""
kv.ee scraper client for mini PC.
Runs continuously, POSTs fully-parsed Listing JSON to VPS /api/ingest
and /api/heartbeat after each run.

The VPS handles filtering, AI evaluation, Telegram notifications, and
dossier storage. This client only scrapes, parses, and delivers raw data.
"""

import dataclasses
import logging
import os
import time
from datetime import datetime, timezone

import requests as http

from kv_scraper import fetch_listing_urls, get_session
from kv_listing_parser import fetch_listing

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("scraper")

# Mandatory env vars — KeyError at boot if missing so misconfiguration is loud
VPS_INGEST_URL = os.environ["VPS_INGEST_URL"]
INGEST_TOKEN = os.environ["INGEST_TOKEN"]
INTERVAL_HOURS = float(os.environ.get("CHECK_INTERVAL_HOURS", "2"))


def _post(path: str, payload) -> None:
    """POST JSON payload to a VPS endpoint. Never raises — logs and returns on failure."""
    try:
        resp = http.post(
            f"{VPS_INGEST_URL}{path}",
            headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
    except http.RequestException as exc:
        log.error("POST %s failed: %s", path, exc)


def run_once() -> int:
    """Run one scrape cycle. Returns total URL count for the run."""
    urls = fetch_listing_urls()
    log.info("Found %d listing URLs", len(urls))

    listings = []
    session = get_session()
    for url in urls:
        listing = fetch_listing(url, session=session)
        if listing.raw_ok:
            listings.append(dataclasses.asdict(listing))

    if listings:
        _post("/api/ingest", listings)

    # Heartbeat sent unconditionally — even when zero listings found.
    # This lets the VPS distinguish "scraper dead" from "scraper alive but 0 URLs"
    # (required for ARCH-04 consecutive-zero alert logic in plan 01-03).
    _post("/api/heartbeat", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "listing_count": len(urls),
        "source": "kv.ee",
    })

    return len(urls)


def main() -> None:
    log.info("Scraper starting. Interval: %.1fh. VPS: %s", INTERVAL_HOURS, VPS_INGEST_URL)
    while True:
        try:
            run_once()
        except Exception:
            log.exception("run_once failed — sleeping and retrying")
        time.sleep(INTERVAL_HOURS * 3600)


if __name__ == "__main__":
    main()
