"""
Fetches and parses a single kv.ee listing detail page.

Design note: kv.ee's HTML structure/class names aren't something we can pin
down reliably from outside (and they may change over time), so instead of
brittle CSS selectors this extracts fields with regex over the page's plain
text. That's more resilient to template tweaks - as long as the Estonian
field labels ("Tube", "Üldpind", "Ehitusaasta", ...) stay the same, which is
the site's normal-user-facing vocabulary and changes far less often than
markup.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Optional

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "et,en;q=0.8,ru;q=0.6",
}

OBJECT_ID_RE = re.compile(r"-(\d{6,8})\.html")

PRICE_RE = re.compile(r"([\d]{2,3}(?:\s\d{3})*)\s?€\s+([\d]{1,2}(?:\s\d{3})?)\s?€/m")
ROOMS_RE = re.compile(r"Tube\s*\|?\s*\n?\s*\|?\s*(\d+)")
AREA_RE = re.compile(r"Üldpind\s*\|?\s*\n?\s*\|?\s*([\d,.]+)\s*m")
YEAR_RE = re.compile(r"Ehitusaasta\s*\|?\s*\n?\s*\|?\s*(\d{4})")
CONDITION_RE = re.compile(r"Seisukord\s*\|?\s*\n?\s*\|?\s*([^\|\n]+)")
MATERIAL_RE = re.compile(r"\b(kivimaja|paneelmaja|puitmaja|palkmaja)\b", re.IGNORECASE)
FLOOR_RE = re.compile(r"[Kk]orrus\s+(\d+)\s*/\s*(\d+)")
EMAIL_RE = re.compile(r"[\w.\-]+@[\w.\-]+\.\w{2,}")
PARKING_FREE_RE = re.compile(r"parkimine\s+tasuta|parkimiskoht\s+olemas", re.IGNORECASE)
PARKING_PAID_RE = re.compile(r"parkimine\s+tasuline|parkimine\s+kohustuslik", re.IGNORECASE)
NEEDS_RENO_RE = re.compile(
    r"vajab\s+(?:kosmeetilist\s+)?(?:remonti|renoveerimist|san\.?\s*remonti)",
    re.IGNORECASE,
)
BROKER_RE = re.compile(r"Võta ühendust\s*\n+\s*([^\n]+)")

# Phase 5: coordinate extraction — three fallback patterns covering known kv.ee embedding shapes.
# Pattern 1: JSON-LD structured data (<script type="application/ld+json">)
COORD_LAT_JSONLD_RE = re.compile(r'"latitude"\s*:\s*(-?\d+\.\d+)')
COORD_LNG_JSONLD_RE = re.compile(r'"longitude"\s*:\s*(-?\d+\.\d+)')
# Pattern 2: JavaScript variable short form (e.g. {"lat":59.4203,"lng":24.7205})
COORD_LAT_SCRIPT_RE = re.compile(r'["\']lat["\']\s*:\s*(-?\d+\.\d+)')
COORD_LNG_SCRIPT_RE = re.compile(r'["\']ln[gG]["\']\s*:\s*(-?\d+\.\d+)')  # matches lng or lnG
# Pattern 3: HTML data attributes (e.g. data-lat="59.4203" data-lng="24.7205")
COORD_LAT_DATA_RE = re.compile(r'data-lat=["\'](-?\d+\.\d+)["\']')
COORD_LNG_DATA_RE = re.compile(r'data-lng=["\'](-?\d+\.\d+)["\']')


@dataclass
class Listing:
    id: str
    url: str
    title: str = ""
    price_eur: Optional[int] = None
    price_per_sqm: Optional[int] = None
    rooms: Optional[int] = None
    area_sqm: Optional[float] = None
    year_built: Optional[int] = None
    condition: str = ""
    material: str = ""
    floor: Optional[int] = None
    floor_total: Optional[int] = None
    parking: str = "unknown"  # "free" | "paid_or_mandatory" | "unknown"
    needs_renovation: bool = False
    broker_name: str = ""
    contact_email: Optional[str] = None
    description: str = ""
    image_url: str = ""
    image_count: int = 0
    raw_ok: bool = True
    lat: Optional[float] = None
    lng: Optional[float] = None


def _to_int(s: str) -> Optional[int]:
    try:
        return int(s.replace(" ", "").replace("\xa0", ""))
    except (ValueError, AttributeError):
        return None


def _to_float(s: str) -> Optional[float]:
    try:
        return float(s.replace(",", ".").replace(" ", ""))
    except (ValueError, AttributeError):
        return None


def _extract_coords(html: str) -> tuple[Optional[float], Optional[float]]:
    """Best-effort lat/lng extraction from raw HTML (not BeautifulSoup text).

    Probes three fallback patterns in order — JSON-LD structured data, script var,
    HTML data attribute — and returns the first successful match. Never raises
    (returns (None, None) on any failure). Lat/lng are validated within Estonia
    bounding box (57.5-59.7 lat, 21.7-28.2 lng) to reject false-positive matches
    of unrelated decimals in the same page.
    """
    try:
        # Pattern 1: JSON-LD structured data
        lat_m = COORD_LAT_JSONLD_RE.search(html)
        lng_m = COORD_LNG_JSONLD_RE.search(html)
        if lat_m and lng_m:
            lat, lng = float(lat_m.group(1)), float(lng_m.group(1))
            if 57.5 <= lat <= 59.7 and 21.7 <= lng <= 28.2:
                return lat, lng

        # Pattern 2: JavaScript variable short form
        lat_m = COORD_LAT_SCRIPT_RE.search(html)
        lng_m = COORD_LNG_SCRIPT_RE.search(html)
        if lat_m and lng_m:
            lat, lng = float(lat_m.group(1)), float(lng_m.group(1))
            if 57.5 <= lat <= 59.7 and 21.7 <= lng <= 28.2:
                return lat, lng

        # Pattern 3: HTML data attributes
        lat_m = COORD_LAT_DATA_RE.search(html)
        lng_m = COORD_LNG_DATA_RE.search(html)
        if lat_m and lng_m:
            lat, lng = float(lat_m.group(1)), float(lng_m.group(1))
            if 57.5 <= lat <= 59.7 and 21.7 <= lng <= 28.2:
                return lat, lng
    except Exception:
        pass
    return None, None


def extract_object_id(url: str) -> Optional[str]:
    m = OBJECT_ID_RE.search(url)
    return m.group(1) if m else None


def fetch_listing(url: str, timeout: int = 15, session: requests.Session | None = None) -> Listing:
    """Fetch and parse a single kv.ee listing page. Never raises - on
    failure returns a Listing with raw_ok=False so the caller can skip it
    without crashing the whole run."""
    obj_id = extract_object_id(url) or url
    listing = Listing(id=obj_id, url=url)

    try:
        getter = session if session else requests
        resp = getter.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException:
        listing.raw_ok = False
        return listing

    soup = BeautifulSoup(resp.text, "lxml")
    text = soup.get_text(separator="\n")

    title_tag = soup.find("h1")
    listing.title = title_tag.get_text(strip=True) if title_tag else ""

    price_m = PRICE_RE.search(text)
    if price_m:
        listing.price_eur = _to_int(price_m.group(1))
        listing.price_per_sqm = _to_int(price_m.group(2))

    rooms_m = ROOMS_RE.search(text)
    if rooms_m:
        listing.rooms = _to_int(rooms_m.group(1))

    area_m = AREA_RE.search(text)
    if area_m:
        listing.area_sqm = _to_float(area_m.group(1))

    year_m = YEAR_RE.search(text)
    if year_m:
        listing.year_built = _to_int(year_m.group(1))

    cond_m = CONDITION_RE.search(text)
    if cond_m:
        listing.condition = cond_m.group(1).strip()

    mat_m = MATERIAL_RE.search(text)
    if mat_m:
        listing.material = mat_m.group(1).lower()

    floor_m = FLOOR_RE.search(text)
    if floor_m:
        listing.floor = _to_int(floor_m.group(1))
        listing.floor_total = _to_int(floor_m.group(2))

    if PARKING_FREE_RE.search(text):
        listing.parking = "free"
    elif PARKING_PAID_RE.search(text):
        listing.parking = "paid_or_mandatory"

    listing.needs_renovation = bool(NEEDS_RENO_RE.search(text))

    broker_m = BROKER_RE.search(text)
    if broker_m:
        listing.broker_name = broker_m.group(1).strip()

    # Best-effort direct email (mainly catches FSBO ads that put an email in
    # the free-text description; most agency listings won't have one -
    # kv.ee gates those behind its own contact form / phone reveal).
    email_m = EMAIL_RE.search(text)
    if email_m and "kv.ee" not in email_m.group(0):
        listing.contact_email = email_m.group(0)

    og_image = soup.find("meta", property="og:image")
    if og_image and og_image.get("content"):
        listing.image_url = og_image["content"]

    listing.image_count = len(re.findall(r'https://img-kv\.ee/[^"\']+', resp.text))

    # Description: og:description meta tends to be the cleanest single
    # block of ad copy without nav/menu noise.
    og_desc = soup.find("meta", property="og:description")
    if og_desc and og_desc.get("content"):
        listing.description = og_desc["content"]

    # Best-effort coordinate extraction from raw HTML (not soup text — coords
    # live in script blocks that BeautifulSoup strips). Populates lat/lng when
    # a pattern matches; Plan 02 Nominatim fallback fills the remaining gaps.
    lat, lng = _extract_coords(resp.text)
    if lat is not None and lng is not None:
        listing.lat = lat
        listing.lng = lng

    return listing


def fetch_listings(urls: list[str], delay_seconds: float = 3.0) -> list[Listing]:
    """Fetch several listings with a polite delay between requests so we
    don't hammer kv.ee - this is a courtesy, not just risk-avoidance."""
    results = []
    for i, url in enumerate(urls):
        if i > 0:
            time.sleep(delay_seconds)
        results.append(fetch_listing(url))
    return results
