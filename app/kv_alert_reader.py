"""
Scrapes kv.ee search results directly to find new listings.

How to get your search URL: go to kv.ee, set your filters (rooms, price,
district, etc.), click Search, then copy the full URL from the address bar
and set it as KV_SEARCH_URL in your .env.

Scrapes up to MAX_PAGES pages per run. Deduplication against already-seen
listings is handled upstream in agent_job.py via seen_listing_ids.
"""

import re
import time

import requests

from config import KV_SEARCH_URL
from kv_listing_parser import HEADERS

LISTING_URL_RE = re.compile(r"https://www\.kv\.ee/[a-z0-9\-]+-\d{6,8}\.html")
MAX_PAGES = 3


def fetch_listing_urls() -> list[str]:
    """Return all listing URLs found on the kv.ee search results page(s).
    Never raises — returns an empty list on any failure or missing config."""
    if not KV_SEARCH_URL:
        return []

    all_urls: set[str] = set()

    for page in range(MAX_PAGES):
        sep = "&" if "?" in KV_SEARCH_URL else "?"
        page_url = KV_SEARCH_URL if page == 0 else f"{KV_SEARCH_URL}{sep}pg={page + 1}"

        try:
            resp = requests.get(page_url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
        except requests.RequestException:
            break

        found = set(LISTING_URL_RE.findall(resp.text))
        if not found:
            break

        before = len(all_urls)
        all_urls.update(found)
        if len(all_urls) == before:
            break  # page added nothing new — we've hit the end

        if page < MAX_PAGES - 1:
            time.sleep(2)

    return sorted(all_urls)
