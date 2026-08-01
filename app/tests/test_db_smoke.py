"""
RED smoke test for DB-01: Postgres engine connects and responds.

Wave 0 state: `db` module does not exist — test_engine_connects will fail with
ImportError at SETUP time (db_session fixture imports db lazily). This is the
expected RED anchor. Wave 1 lands app/db.py and makes this test GREEN.

Contract pinned:
  - db.engine.dialect.name == "postgresql"
  - db_session.execute(text("SELECT 1")).scalar() == 1
"""
import pytest


def test_engine_connects(db_session):
    """DB-01: engine uses the postgresql dialect and a live connection responds.

    Fails in Wave 0 (ImportError on db_session fixture setup — db module does not
    exist yet). Wave 1 lands app/db.py; this test goes GREEN.
    """
    from sqlalchemy import text  # noqa: PLC0415 — lazy: requires sqlalchemy in env
    import db  # noqa: PLC0415 — lazy: Wave 1 creates this module

    assert db.engine.dialect.name == "postgresql", (
        f"Expected postgresql dialect, got {db.engine.dialect.name!r}"
    )
    result = db_session.execute(text("SELECT 1")).scalar()
    assert result == 1, f"Expected SELECT 1 to return 1, got {result!r}"
