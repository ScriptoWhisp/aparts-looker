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

# Live Playwright browser state — kept alive across fetch_listing_urls() and
# subsequent per-listing fetches so the same browser fingerprint + TLS handshake
# + CF cookies are used for every request. kv.ee's bot detection treats plain
# `requests` calls (even with harvested cookies) as suspicious; navigating each
# URL through page.goto keeps us on the "already solved the challenge" path.
_playwright = None
_browser = None
_context = None
_page = None


class _PlaywrightSession:
    """Adapter that mimics requests.Session.get so kv_listing_parser can be
    handed a browser-backed fetcher without changes.

    Loads each URL through the actual page.goto() (not context.request.get) so
    the TLS fingerprint + JS execution matches the one that solved the CF and
    kv.ee bot checks during warm-up. context.request uses Playwright's HTTP
    client which has a different fingerprint and gets flagged by kv.ee's own
    bot detection.
    """

    def __init__(self, page):
        self._page = page

    def get(self, url, headers=None, timeout=15):
        # Navigate the browser to the listing URL. domcontentloaded is enough —
        # we only need the HTML, not fully loaded images.
        resp = self._page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
        # If we accidentally hit a fresh CF challenge, give it a moment to solve.
        try:
            self._page.wait_for_function(
                "() => !document.title.includes('Just a moment')",
                timeout=15000,
            )
        except Exception:
            pass
        # Small settle time so lazy-loaded content (like coord JSON) is present.
        self._page.wait_for_timeout(400)
        html = self._page.content()
        status = resp.status if resp is not None else 0

        class _Resp:
            def __init__(self, status_code, text):
                self.status_code = status_code
                self.text = text

            def raise_for_status(self):
                if not (200 <= self.status_code < 400):
                    raise requests.HTTPError(f"HTTP {self.status_code}")

        return _Resp(status, html)


def get_session():
    """Return a session-like adapter that navigates the live browser page.
    None if scraping hasn't been initialised."""
    if _page is None:
        return None
    return _PlaywrightSession(_page)


def close_browser() -> None:
    """Tear down the persistent Playwright browser. Call after every batch."""
    global _playwright, _browser, _context, _page
    try:
        if _browser is not None:
            _browser.close()
    except Exception:
        log.exception("close_browser: browser close failed")
    try:
        if _playwright is not None:
            _playwright.stop()
    except Exception:
        log.exception("close_browser: playwright stop failed")
    _playwright = None
    _browser = None
    _context = None
    _page = None


def fetch_listing_urls() -> list[str]:
    """Scrape search results and return listing URLs.

    Leaves the Playwright browser open so subsequent kv_listing_parser calls
    can reuse the same browser context (get_session() returns a browser-backed
    adapter). Caller MUST invoke close_browser() when finished with the batch.
    Never raises — returns empty list on any failure or missing config.
    """
    global _playwright, _browser, _context, _page

    if not KV_SEARCH_URL:
        log.warning("KV_SEARCH_URL is not set — skipping scrape")
        return []

    all_urls: set[str] = set()

    # REUSE path: if the browser survived from a previous successful scrape,
    # skip the warm-up entirely and go straight to the search. Each fresh
    # warm-up burns some trust with kv.ee's bot detector; reusing the alive
    # session avoids that. The scraper.py caller closes the browser only when
    # a scrape genuinely fails, so a live _page here means "last run was OK".
    if _page is not None:
        log.info("Reusing existing browser session — skipping warm-up")
        try:
            return _harvest_urls_from_search(_page, all_urls)
        except Exception:
            log.exception("Reuse path failed — falling back to fresh browser")
            close_browser()

    log.info("Starting Playwright browser...")

    # User agent kept consistent between headless browser and reused session.
    # macOS UA fingerprint tends to attract less Cloudflare scrutiny than Windows.
    UA = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    )
    # Stealth init script — hides the telltale signs of a headless browser that
    # Cloudflare Turnstile probes for (navigator.webdriver, empty plugins array,
    # missing window.chrome, etc.). Runs before any page script.
    STEALTH_JS = """
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
        Object.defineProperty(navigator, 'languages', {get: () => ['et-EE', 'et', 'en-US', 'en']});
        window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
        const origQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications'
            ? Promise.resolve({state: Notification.permission})
            : origQuery(parameters)
        );
    """

    try:
        # NOTE: no `with` block — we intentionally leave the browser open so
        # per-listing fetches share the same context. Torn down by close_browser().
        _playwright = sync_playwright().start()
        # headless=False + Xvfb (via `xvfb-run` in CMD) gives us the FULL Chromium
        # binary with a real display, not the "headless-shell" trimmed binary.
        # The shell binary has a distinct TLS/JS fingerprint that kv.ee and CF
        # both detect instantly; full Chromium looks identical to a real user's
        # Chrome. This is the single highest-impact anti-detection change.
        _browser = _playwright.chromium.launch(
            headless=False,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--window-size=1920,1080",
            ],
        )
        # Real-looking browser context: viewport, locale, timezone all set
        # to values a Tallinn resident would send.
        _context = _browser.new_context(
            user_agent=UA,
            viewport={"width": 1920, "height": 1080},
            locale="et-EE",
            timezone_id="Europe/Tallinn",
            extra_http_headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "et-EE,et;q=0.9,en;q=0.8",
            },
        )
        _context.add_init_script(STEALTH_JS)
        _page = _context.new_page()
        page = _page  # local alias for readability

        # Warm-up: hit the homepage first, let Cloudflare set its cookies
        # naturally, then navigate to the search. Direct-to-search hits get
        # a harder challenge than in-session navigation.
        log.info("Warm-up: loading kv.ee homepage...")
        try:
            page.goto("https://www.kv.ee/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_function(
                "() => !document.title.includes('Just a moment')",
                timeout=45000,
            )
            page.wait_for_timeout(2500)
            log.info("Warm-up complete. Title: %s", page.title())
        except Exception as e:
            log.error("Warm-up failed: %s — CF likely blocking this network", e)
            close_browser()
            return []

        _harvest_urls_from_search(page, all_urls)

    except Exception as e:
        log.exception("Playwright scrape failed: %s", e)
        # Critical: tear down whatever Playwright state we allocated before the
        # exception, or the next call re-enters sync_playwright().start() in this
        # same thread with a leftover event loop and trips the "Sync API inside
        # asyncio loop" guard. Idempotent — safe even if only _playwright was set.
        close_browser()

    return sorted(all_urls)


def _harvest_urls_from_search(page, all_urls: set) -> list[str]:
    """Walk the search pages and populate all_urls with discovered listing URLs.

    Shared by both the fresh-browser and reuse-browser paths in fetch_listing_urls.
    Returns the sorted URL list (also mutates all_urls in place).
    """
    for i in range(MAX_PAGES):
        sep = "&" if "?" in KV_SEARCH_URL else "?"
        page_url = KV_SEARCH_URL if i == 0 else f"{KV_SEARCH_URL}{sep}pg={i + 1}"

        log.info("Fetching page %d: %s", i + 1, page_url)
        try:
            response = page.goto(page_url, wait_until="domcontentloaded", timeout=45000)
            log.info("Page %d HTTP status: %s", i + 1, response.status if response else "unknown")
            page.wait_for_function(
                "() => !document.title.includes('Just a moment')",
                timeout=45000,
            )
            page.wait_for_timeout(3000)
            log.info("Page %d title: %s", i + 1, page.title())
        except Exception as e:
            log.error("Failed to load page %d: %s", i + 1, e)
            break

        if i == 0 and _context is not None:
            cookies = _context.cookies()
            cf_cookies = [c["name"] for c in cookies if "cf" in c["name"].lower()]
            log.info("Have %d cookies (%s CF cookies) after warm-up", len(cookies), len(cf_cookies))

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

    log.info("URL discovery complete. Total unique URLs: %d (browser kept alive for per-listing fetches)", len(all_urls))
    return sorted(all_urls)
