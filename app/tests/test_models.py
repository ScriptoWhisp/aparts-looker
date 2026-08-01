"""
RED tests for DB-02: Listing ORM model shape and Postgres-specific type behaviour.

Wave 0 state: `models` module does not exist — every test here will fail with
ImportError at SETUP time (db_session fixture imports db lazily; `from models import
Listing` inside each test body fails with ModuleNotFoundError). Wave 1 lands
app/models.py and makes all three tests GREEN.

Contracts pinned (D-03 hybrid schema, D-04 status ENUM, D-05 VARCHAR PK):
  1. Listing round-trip: scalar fields + JSONB blobs preserve exact values through
     a commit → db_session.get round-trip.
  2. ENUM rejection: an unknown status value raises sqlalchemy.exc.DataError at flush.
  3. JSONB mutation convention: in-place .append() is silently ignored; explicit
     reassignment is required (Pitfall 1 from 07-RESEARCH.md).
"""
import pytest


def test_listing_roundtrip(db_session):
    """DB-02: a Listing row preserves scalar + JSONB fields through a full round-trip.

    Creates a row, flushes, re-fetches via db_session.get, and asserts every field
    matches. Verifies D-03 (JSONB columns) and D-05 (VARCHAR PK).

    Fails in Wave 0: db_session fixture fails (db module missing) OR
    `from models import Listing` raises ModuleNotFoundError.
    """
    from models import Listing  # noqa: PLC0415 — lazy: Wave 1 creates this module

    row = Listing(
        id="test-roundtrip-1",
        url="https://kv.ee/test/1",
        price_eur=200000,
        area_sqm=60.0,
        rooms=3,
        district="Mustamäe",
        status="pending",
        cost_of_ownership={"monthly_total_eur": 1200, "breakdown": {"utilities": 200}},
        viewing_history=[{"action": "scheduled", "at": "2026-08-01T10:00:00Z"}],
    )
    db_session.add(row)
    db_session.flush()

    fetched = db_session.get(Listing, "test-roundtrip-1")

    assert fetched is not None, "Row should be retrievable after flush"
    assert fetched.id == "test-roundtrip-1"
    assert fetched.url == "https://kv.ee/test/1"
    assert fetched.price_eur == 200000
    assert fetched.area_sqm == 60.0
    assert fetched.rooms == 3
    assert fetched.district == "Mustamäe"
    assert fetched.status == "pending"
    # JSONB blobs must round-trip without mutation
    assert fetched.cost_of_ownership == {"monthly_total_eur": 1200, "breakdown": {"utilities": 200}}
    assert fetched.viewing_history == [{"action": "scheduled", "at": "2026-08-01T10:00:00Z"}]


def test_status_enum_rejects_invalid(db_session):
    """DB-02: Postgres native ENUM rejects an unknown status value at flush.

    Asserts that inserting a row with status='not_a_real_status' raises
    sqlalchemy.exc.DataError (Postgres error: invalid input value for enum
    listing_status). Verifies D-04.

    Fails in Wave 0: db_session fixture fails (db module missing) OR
    `from models import Listing` raises ModuleNotFoundError.
    """
    import sqlalchemy.exc  # noqa: PLC0415 — lazy: requires sqlalchemy in env
    from models import Listing  # noqa: PLC0415

    row = Listing(
        id="test-invalid-status",
        status="not_a_real_status",
    )
    db_session.add(row)

    with pytest.raises(sqlalchemy.exc.DataError):
        db_session.flush()


def test_jsonb_mutation_requires_reassign(db_session):
    """DB-02 / Pitfall 1: in-place JSONB .append() is silently dropped; reassign is required.

    Procedure:
      1. Insert a row with viewing_history=[{"e": 1}], commit.
      2. Fetch the row in a new query, mutate in place (.append), commit.
      3. Fetch again — the second event must be ABSENT (documents Pitfall 1).
      4. Fetch again, reassign the whole list, commit.
      5. Fetch again — the second event must NOW be present.

    This test pins down the convention all data_store.* writers must follow.

    Fails in Wave 0: db_session fixture fails (db module missing) OR
    `from models import Listing` raises ModuleNotFoundError.
    """
    from models import Listing  # noqa: PLC0415

    # --- Step 1: insert with one event, commit ---
    row = Listing(
        id="test-jsonb-mutation",
        status="pending",
        viewing_history=[{"e": 1}],
    )
    db_session.add(row)
    db_session.commit()

    # --- Step 2: fetch via a fresh query, mutate in-place, commit ---
    row2 = db_session.get(Listing, "test-jsonb-mutation")
    assert row2 is not None
    row2.viewing_history.append({"e": 2})  # in-place mutation — Pitfall 1
    db_session.commit()

    # --- Step 3: re-fetch — second event must be ABSENT (SQLAlchemy did not detect the mutation) ---
    db_session.expire(row2)
    row3 = db_session.get(Listing, "test-jsonb-mutation")
    assert row3 is not None
    assert len(row3.viewing_history) == 1, (
        "In-place .append() should be silently ignored — "
        f"got {row3.viewing_history!r} (Pitfall 1 violation if len > 1)"
    )

    # --- Step 4: reassign the whole list, commit ---
    new_history = list(row3.viewing_history)
    new_history.append({"e": 2})
    row3.viewing_history = new_history
    db_session.commit()

    # --- Step 5: re-fetch — second event must NOW be present ---
    db_session.expire(row3)
    row4 = db_session.get(Listing, "test-jsonb-mutation")
    assert row4 is not None
    assert len(row4.viewing_history) == 2, (
        f"Explicit reassignment should persist — got {row4.viewing_history!r}"
    )
    assert row4.viewing_history[1] == {"e": 2}
