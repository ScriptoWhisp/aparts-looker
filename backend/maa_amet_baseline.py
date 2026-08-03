"""
Maa-amet sold-price baseline lookup module.

Loads the CSV at module import time from backend/reference_data/maa_amet_baseline.csv.
Provides get_median() which returns the finest-grain sold-price bucket for a
given (district, structure, decade_built, quarter) tuple.

Fallback hierarchy (finest → coarsest):
  1. (district, structure, decade_built)  ← pre-war brick in Kalamaja
  2. (district, any,       decade_built)  ← any structure, same decade
  3. (district, any,       any)           ← all apartments in district

A bucket is only returned if n_transactions >= 5.

Reload policy: module-level load at import. Container restart picks up new CSV.
To add hot-reload, check os.path.getmtime(CSV_PATH) and re-parse on change —
not implemented here because a weekly manual pull + container restart is the
documented refresh procedure (docs/maa-amet-refresh.md).

SPEC §6 reference:
  - No live API, no X-Road.
  - Manual quarterly pull from Maa-amet price statistics query environment.
  - File: backend/reference_data/maa_amet_baseline.csv
"""

import csv
import logging
import os
from typing import Optional

log = logging.getLogger("maa_amet_baseline")

# Path relative to this module's location.
_CSV_PATH = os.path.join(os.path.dirname(__file__), "reference_data", "maa_amet_baseline.csv")

# Minimum transactions for a bucket to be usable.
_MIN_TRANSACTIONS = 5

# In-memory index: (district, structure, decade_str, quarter) → (median_eur_sqm, n_transactions)
# Empty string for structure/decade means "any" (the widest fallback tier).
_index: dict[tuple[str, str, str, str], tuple[int, int]] = {}
_loaded = False


def _load() -> None:
    """Parse CSV into _index at module import time. Never raises."""
    global _index, _loaded
    if _loaded:
        return
    _loaded = True

    if not os.path.exists(_CSV_PATH):
        log.warning("maa_amet_baseline: CSV not found at %s — sold-price baseline disabled", _CSV_PATH)
        return

    try:
        with open(_CSV_PATH, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(row for row in f if not row.strip().startswith("#"))
            for row in reader:
                district = (row.get("district") or "").strip()
                structure = (row.get("structure") or "").strip()
                decade = (row.get("decade_built") or "").strip()
                quarter = (row.get("quarter") or "").strip()
                try:
                    median = int(row.get("median_eur_sqm") or 0)
                    n = int(row.get("n_transactions") or 0)
                except (ValueError, TypeError):
                    continue
                if not district or not quarter or median <= 0:
                    continue
                key = (district, structure, decade, quarter)
                _index[key] = (median, n)

        log.info("maa_amet_baseline: loaded %d rows from %s", len(_index), _CSV_PATH)
    except Exception:
        log.exception("maa_amet_baseline: failed to load CSV — sold-price baseline disabled")
        _index = {}


def _decade_str(year_built: Optional[int]) -> str:
    """Return the decade string matching CSV convention, e.g. 1977 → '1970'."""
    if not year_built or not isinstance(year_built, int):
        return ""
    return str((year_built // 10) * 10)


def get_median(
    district: str,
    structure: str,
    year_built: Optional[int],
    quarter: str,
) -> tuple[Optional[int], Optional[int], str]:
    """Return the finest sold-price bucket for the given parameters.

    Args:
        district:   Tallinn linnaosa name (e.g. 'Kalamaja').
        structure:  Building load-bearing material (e.g. 'brick', 'panel', 'wood').
                    Pass '' or None when unknown.
        year_built: Year of first use (e.g. 1934). Converted to decade for lookup.
                    Pass None when unknown.
        quarter:    Target quarter in YYYY-QN format (e.g. '2026-Q2').
                    If the exact quarter is not in the index, the function returns
                    (None, None, 'no comparable sales').

    Returns:
        (median_eur_sqm, n_transactions, bucket_label)
        bucket_label describes what was matched, e.g. 'Q2-2026 pre-war brick'.
        Returns (None, None, 'no comparable sales') when no bucket reaches n>=5.
    """
    if not _loaded:
        _load()

    if not district or not quarter:
        return None, None, "no comparable sales"

    dist = district.strip()
    struct = (structure or "").strip()
    decade = _decade_str(year_built)

    # Helper: look up a single key and enforce n>=5.
    def _lookup(d: str, s: str, dec: str) -> Optional[tuple[int, int]]:
        val = _index.get((d, s, dec, quarter))
        if val and val[1] >= _MIN_TRANSACTIONS:
            return val
        return None

    # Tier 1: exact (district, structure, decade)
    if struct and decade:
        hit = _lookup(dist, struct, decade)
        if hit:
            era = _era_label(year_built)
            label = f"{quarter} {era} {struct}"
            return hit[0], hit[1], label

    # Tier 2: (district, any structure, decade)
    if decade:
        hit = _lookup(dist, "", decade)
        if hit:
            era = _era_label(year_built)
            label = f"{quarter} {era}"
            return hit[0], hit[1], label

    # Tier 3: (district, any structure, any decade)
    hit = _lookup(dist, "", "")
    if hit:
        label = f"{quarter} all types"
        return hit[0], hit[1], label

    return None, None, "no comparable sales"


def _era_label(year_built: Optional[int]) -> str:
    """Human-friendly era label for a year, e.g. 1934 → 'pre-war'."""
    if not year_built or not isinstance(year_built, int):
        return ""
    if year_built < 1941:
        return "pre-war"
    if year_built < 1960:
        return "post-war"
    if year_built < 1991:
        return "Soviet-era"
    return "modern"


def latest_quarter() -> str:
    """Return the most recent quarter present in the index, or '' if empty."""
    if not _loaded:
        _load()
    quarters = set(k[3] for k in _index)
    if not quarters:
        return ""
    # Sort lexicographically: '2026-Q2' > '2025-Q4' — works for YYYY-QN format.
    return sorted(quarters)[-1]


# Load eagerly at import so first request is not slow.
_load()
