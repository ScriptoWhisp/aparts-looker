"""Legacy field-name aliases from the pre-Phase-1 JSON schema.

Early listings were stored with frontend-style keys (`name`, `price`, `area`,
`year`, `pricePerSqm`, `notes`). Phase 1+ code uses the canonical Listing
column names (`title`, `price_eur`, `area_sqm`, `year_built`, `price_per_sqm`,
`description`). This module is the single source of truth for that mapping.

Three call sites apply it:
  - data_store._dict_to_listing_fields (every write path)
  - migrate_from_json._entry_to_row (one-shot legacy JSON loader)
  - main._normalize_entry_for_listing (in-memory dict reshaping for legacy reads)

When all pre-Phase-1 records have been re-scraped with new keys, this module
becomes unused and can be deleted along with the three call sites.
"""

LEGACY_ALIASES: dict[str, str] = {
    "name": "title",
    "price": "price_eur",
    "pricePerSqm": "price_per_sqm",
    "area": "area_sqm",
    "year": "year_built",
    "notes": "description",
}
