"""
RED test for DB-03: Alembic baseline migration produces a schema that matches Base.metadata.

Wave 0 state: `app/alembic/` directory does not exist — test_alembic_head_matches_metadata
fails with FileNotFoundError or alembic CommandError at the point where Alembic
tries to locate the migration scripts. Wave 1 lands app/alembic/ and makes this test GREEN.

Contract pinned:
  - `alembic upgrade head` against a fresh pytest-postgresql DB succeeds.
  - `MigrationContext.configure(...).compare_metadata(Base.metadata)` returns an empty diff
    (i.e. Alembic head == model schema, no drift).
"""
import os
import pytest


# Absolute path to the app/ directory — needed to resolve alembic.ini and the
# script_location. conftest.py already os.chdir(APP_DIR) but absolute paths are safer.
APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def test_alembic_head_matches_metadata(postgresql_db_fixture):
    """DB-03: alembic upgrade head produces a schema identical to Base.metadata.

    Steps:
      1. Build a postgresql+psycopg DSN from the pytest-postgresql fixture.
      2. Create an Alembic Config pointing at APP_DIR/alembic (script_location).
      3. Run `alembic upgrade head`.
      4. Compare the live schema against Base.metadata — assert empty diff.

    Fails in Wave 0: app/alembic/ does not exist, so Alembic raises
    CommandError("Can't locate revision identified by 'head'") or similar.
    Also fails if pytest-postgresql is not installed (fixture skips).
    Wave 1 creates alembic/ + initial revision; test goes GREEN.
    """
    from alembic.config import Config  # noqa: PLC0415 — lazy: requires alembic in env
    from alembic import command  # noqa: PLC0415
    from alembic.migration import MigrationContext  # noqa: PLC0415
    from alembic.autogenerate import compare_metadata  # noqa: PLC0415
    from db import Base  # noqa: PLC0415 — lazy: Wave 1 creates this module
    from sqlalchemy import create_engine  # noqa: PLC0415

    # Build the DB URL — use the compose service URL in Docker mode so we
    # test against the same DB that the app uses; use the pytest-postgresql
    # fixture URL in local dev mode (throwaway subprocess DB).
    import sys as _sys  # noqa: PLC0415
    _in_docker = bool(os.environ.get("POSTGRES_USER"))
    if _in_docker:
        import config as _cfg  # noqa: PLC0415
        db_url = _cfg.DATABASE_URL
    else:
        info = postgresql_db_fixture.info
        _pw = getattr(info, "password", "") or ""
        _pw_part = f":{_pw}" if _pw else ""
        db_url = (
            f"postgresql+psycopg://{info.user}{_pw_part}"
            f"@{info.host}:{info.port}/{info.dbname}"
        )

    alembic_cfg = Config()
    alembic_cfg.set_main_option("script_location", os.path.join(APP_DIR, "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)

    # Run migrations on the fresh DB
    command.upgrade(alembic_cfg, "head")

    # Compare live schema vs ORM metadata — must be empty (no drift)
    engine = create_engine(db_url)
    with engine.connect() as conn:
        migration_ctx = MigrationContext.configure(conn)
        diff = compare_metadata(migration_ctx, Base.metadata)

    assert diff == [], (
        f"Alembic head differs from Base.metadata — schema drift detected:\n{diff}"
    )
