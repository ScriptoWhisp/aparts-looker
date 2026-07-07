"""
Scrapes kv.ee search results using a headless Chromium browser (Playwright).
Plain HTTP requests are blocked by Cloudflare on VPS IPs; a real browser
passes the JS challenge and gets the actual page.

Set KV_SEARCH_URL in your .env to the kv.ee search URL with your filters.
How to get it: go to kv.ee, set filters, click Search, copy the address bar URL.
"""

import logging
import re

from playwright.sync_api import sync_playwright

from config import KV_SEARCH_URL

log = logging.getLogger("kv_scraper")

LISTING_URL_RE = re.compile(r"https://www\.kv\.ee/[a-z0-9\-]+-\d{6,8}\.html")
MAX_PAGES = 3


def fetch_listing_urls() -> list[str]:
    """Return all listing URLs found on the kv.ee search results page(s).
    Never raises — returns an empty list on any failure or missing config."""
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

                log.info("Fetching page %d: %s", i + 1, page_url[:80])
                try:
                    response = page.goto(page_url, wait_until="domcontentloaded", timeout=30000)
                    log.info("Page %d HTTP status: %s", i + 1, response.status if response else "unknown")
                except Exception as e:
                    log.error("Failed to load page %d: %s", i + 1, e)
                    break

                html = page.content()
                log.info("Page %d HTML size: %d bytes", i + 1, len(html))

                found = set(LISTING_URL_RE.findall(html))
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
            log.info("Browser closed. Total unique URLs collected: %d", len(all_urls))

    except Exception as e:
        log.exception("Playwright scrape failed: %s", e)

    return sorted(all_urls)
