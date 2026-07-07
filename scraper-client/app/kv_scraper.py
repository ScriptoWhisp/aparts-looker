"""
kv.ee scraper for mini PC — runs on a residential IP to bypass Cloudflare.
Uses a headless Chromium browser (Playwright) for the search page JS challenge,
then harvests CF cookies and reuses them for individual listing fetches.

Plain HTTP requests are blocked by Cloudflare on VPS datacenter IPs; this module
is the mini-PC-side equivalent of the VPS kv_alert_reader.py, restructured to
run standalone without the VPS config module.

Set KV_SEARCH_URL in .env — it is read directly from os.environ.
"""

import logging
import os
import re

import requests
from playwright.sync_api import sync_playwright

KV_SEARCH_URL = os.environ.get("KV_SEARCH_URL", "")

log = logging.getLogger("kv_scraper")

LISTING_PATH_RE = re.compile(r'data-[a-z\-]+=["\'](/[a-z0-9\-]+-\d{6,8}\.html)["\']')
BASE_URL = "https://www.kv.ee"
MAX_PAGES = 3

# shared session reused across the agent job run
_session: requests.Session | None = None


def get_session() -> requests.Session | None:
    """Return the requests session with Cloudflare cookies, or None if not ready."""
    return _session


def fetch_listing_urls() -> list[str]:
    """Scrape search results, harvest CF cookies, return listing URLs.
    Never raises — returns empty list on any failure or missing config."""
    global _session

    if not KV_SEARCH_URL:
        log.warning("KV_SEARCH_URL is not set — skipping scrape")
        return []

    log.info("Starting Playwright browser...")
    all_urls: set[str] = set()

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            page = browser.new_page(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0.0.0 Safari/537.36"
                )
            )

            for i in range(MAX_PAGES):
                sep = "&" if "?" in KV_SEARCH_URL else "?"
                page_url = KV_SEARCH_URL if i == 0 else f"{KV_SEARCH_URL}{sep}pg={i + 1}"

                log.info("Fetching page %d: %s", i + 1, page_url)
                try:
                    response = page.goto(page_url, wait_until="load", timeout=30000)
                    log.info("Page %d HTTP status: %s", i + 1, response.status if response else "unknown")
                    page.wait_for_function(
                        "() => !document.title.includes('Just a moment')",
                        timeout=20000,
                    )
                    page.wait_for_timeout(3000)
                    log.info("Page %d title: %s", i + 1, page.title())
                except Exception as e:
                    log.error("Failed to load page %d: %s", i + 1, e)
                    break

                # harvest Cloudflare cookies after first page passes the challenge
                if i == 0:
                    cookies = page.context.cookies()
                    session = requests.Session()
                    session.headers.update({
                        "User-Agent": (
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/125.0.0.0 Safari/537.36"
                        ),
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "et-EE,et;q=0.9,en;q=0.8",
                        "Referer": "https://www.kv.ee/",
                    })
                    for c in cookies:
                        session.cookies.set(c["name"], c["value"], domain=c.get("domain", ""))
                    _session = session
                    cf_cookies = [c["name"] for c in cookies if "cf" in c["name"].lower()]
                    log.info("Harvested %d cookies (%s CF cookies)", len(cookies), len(cf_cookies))

                html = page.content()
                log.info("Page %d HTML size: %d bytes", i + 1, len(html))

                found = set(BASE_URL + p for p in LISTING_PATH_RE.findall(html))
                log.info("Page %d listing URLs found: %d", i + 1, len(found))

                if not found:
                    log.info("No listings on page %d — stopping pagination", i + 1)
                    break

                before = len(all_urls)
                all_urls.update(found)
                if len(all_urls) == before:
                    log.info("Page %d had no new URLs — end of results", i + 1)
                    break

            browser.close()
            log.info("Browser closed. Total unique URLs: %d", len(all_urls))

    except Exception as e:
        log.exception("Playwright scrape failed: %s", e)

    return sorted(all_urls)
