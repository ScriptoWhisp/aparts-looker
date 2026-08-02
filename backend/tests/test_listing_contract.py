"""
Unit tests for Listing dataclass serialisation round-trip (ARCH-01).

Coverage:
  - Listing → dataclasses.asdict() → _deserialize_listing() preserves all fields
  - A dict with an unknown extra key is silently ignored (forward-compatibility guard)
"""

import dataclasses


def test_roundtrip():
    """Listing round-trips through dataclasses.asdict() and _deserialize_listing() (ARCH-01)."""
    from kv_listing_parser import Listing  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    original = Listing(
        id="123456",
        url="https://www.kv.ee/test-123456.html",
        title="Test Apartment",
        price_eur=200000,
        rooms=3,
        area_sqm=60.0,
        image_count=10,
    )

    serialized = dataclasses.asdict(original)
    reconstructed = ingest_handler._deserialize_listing(serialized)

    assert reconstructed.id == original.id
    assert reconstructed.url == original.url
    assert reconstructed.title == original.title
    assert reconstructed.price_eur == original.price_eur
    assert reconstructed.rooms == original.rooms
    assert reconstructed.area_sqm == original.area_sqm
    assert reconstructed.image_count == original.image_count


def test_unknown_fields_ignored():
    """A dict with an unknown extra key deserialises without raising (forward-compatibility)."""
    from kv_listing_parser import Listing  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    # Start from a minimal valid Listing and add an unknown field.
    base = dataclasses.asdict(Listing(id="1", url="https://www.kv.ee/test-1.html"))
    base["future_field"] = "some_value_from_newer_scraper_client"

    listing = ingest_handler._deserialize_listing(base)

    assert listing.id == "1"
    assert not hasattr(listing, "future_field"), (
        "Unknown fields must be dropped, not attached to the Listing object"
    )
