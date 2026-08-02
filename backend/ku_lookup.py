"""
Best-effort korteriühistu (KÜ) lookup for a listing address via ariregister.rik.ee
autocomplete. Returns the top matching KÜ (legal_form == "23") with its reg_code,
canonical URL, and address. Never raises — returns None on any failure.

Design: D-11 (ENRICH-01) — anonymous, free, no API key or agreement required.
Endpoint probed live 2026-07-10. Rate limits are undocumented but generous
(used interactively by the ariregister.rik.ee search page).

Pitfall 2: autocomplete mixes garages (legal_form "6"), non-profits, OÜs, etc.
Filter strictly to legal_form == "23" to isolate korteriühistud.

Pitfall 5: this module has NO data_store dependency. The dispatcher in ingest_handler
is the caller that bridges lookup → save_ku_enrichment. Never hold data_store._lock
across the HTTP call — the dispatcher acquires the lock only to read the address and
to save the result.
"""

import logging
import re
from typing import Optional

import requests

log = logging.getLogger("ku_lookup")

AUTOCOMPLETE_URL = "https://ariregister.rik.ee/est/api/autocomplete"
KORTERIUHISTU_LEGAL_FORM = "23"
_USER_AGENT = "ApartsLooker/1.0 daniel.tjulinov@gmail.com"


def lookup_ku_for_address(address: str) -> Optional[dict]:
    """Try to find the korteriühistu registered at the given street address.

    Returns:
        {
          "reg_code": int,          # 8-digit registrikood
          "name": str,              # official KÜ name
          "legal_address": str,     # full legal address as registered
          "url": str,               # canonical https://ariregister.rik.ee/... link
        }
      or None if no korteriühistu found at that address (or on any error).

    Strategy: query the free autocomplete endpoint with the normalised street name +
    house number, filter results to legal_form == "23", return the first match.
    Not all buildings have a formally registered korteriühistu — small buildings
    often don't (~30% of Tallinn addresses), so None is a normal outcome.

    Never raises. On any HTTP or parse error, logs with log.exception and returns None.
    """
    if not address or not address.strip():
        return None
    try:
        query = _to_street_query(address)
        resp = requests.get(
            AUTOCOMPLETE_URL,
            params={"q": query},
            headers={"User-Agent": _USER_AGENT},
            timeout=6,
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("status") != "OK":
            return None
        candidates = payload.get("data", [])
        # Filter to korteriühistud only (Pitfall 2 — drop garages, OÜs, etc.)
        kus = [c for c in candidates if str(c.get("legal_form")) == KORTERIUHISTU_LEGAL_FORM]
        if not kus:
            return None
        top = kus[0]
        return {
            "reg_code": top.get("reg_code"),
            "name": top.get("name", ""),
            "legal_address": top.get("legal_address", ""),
            "url": top.get("url", ""),
        }
    except Exception:
        log.exception("KÜ lookup failed for address=%s", address)
        return None


def _to_street_query(address: str) -> str:
    """Normalise a raw address string into a compact autocomplete query.

    ariregister expects strings like "Mustamäe tee 165" — including an apartment
    number confuses the tokenizer and returns no results.

    Examples:
      "Mustamäe tee 165, Tallinn"      -> "Mustamäe tee 165"
      "Retke tee 22-15, 12345 Tallinn" -> "Retke tee 22"
      "Astangu tn 50b/1-13"            -> "Astangu tn 50b/1"
    """
    # Drop everything after the first comma (city / postcode fragment)
    s = address.split(",")[0].strip()
    # Drop apartment suffix: trailing "-" followed by one or more digits
    s = re.sub(r"-\d+\s*$", "", s)
    return s
