"""
Shared pytest fixtures for app/tests/.

Fixtures:
  client              — FastAPI TestClient with INGEST_TOKEN monkeypatched to "test-token-abc".
  tmp_agent_state     — Redirects config.AGENT_STATE_FILE and config.APP_DATA_FILE to temp paths
                        so tests cannot corrupt real state.
  mock_telegram       — Monkeypatches telegram_client.send_message and telegram_client.send_photo
                        with MagicMocks; also patches the in-module references in agent_job and
                        ingest_handler so tests can assert on calls.
  db_session          — Yields a SQLAlchemy Session bound to a per-test savepoint that ALWAYS
                        rolls back on teardown. Backed by a per-session Postgres subprocess via
                        pytest-postgresql. Also monkeypatches db.SessionLocal so any code calling
                        data_store.* shares the same rolled-back transaction. Wave 0: importing
                        db / models fails (ModuleNotFoundError) — tests that request db_session
                        will error at collection with a clear ImportError until Wave 1 lands.

Design notes:
  - main.py mounts StaticFiles(directory="static") using a relative path, which resolves
    relative to the process cwd. Tests that import main must either run from app/ or
    have the static dir available. We handle this by temporarily changing cwd to the
    app/ directory before the FastAPI app is created/imported.
  - data_store.load_agent_state() re-reads config.AGENT_STATE_FILE on every call, so
    monkeypatching config.AGENT_STATE_FILE before the call redirects I/O to the temp file.
  - db_session imports db and models lazily (inside the fixture body) so Wave 0 tests fail
    with a clean ImportError rather than breaking the entire conftest at import time.
"""

import os
import sys
from unittest.mock import MagicMock

import pytest

try:
    from pytest_postgresql import factories as _pp_factories
    _PYTEST_POSTGRESQL_AVAILABLE = True
except ImportError:  # not installed in local dev without Docker venv
    _pp_factories = None  # type: ignore[assignment]
    _PYTEST_POSTGRESQL_AVAILABLE = False

# Resolve the app/ directory so imports and static-file paths work regardless of
# where pytest is invoked from.
APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

# Change cwd to app/ so StaticFiles(directory="static") resolves correctly.
# This must happen before main.py is imported (the mount happens at module scope).
os.chdir(APP_DIR)


@pytest.fixture
def tmp_agent_state(monkeypatch, tmp_path):
    """Redirect data_store I/O to temp files so tests cannot corrupt real state.

    Sets config.AGENT_STATE_FILE to <tmpdir>/agent_state.json and
    config.APP_DATA_FILE to <tmpdir>/app_data.json.
    Yields the tmp_path directory so callers can read/seed the state file.
    """
    import config  # noqa: PLC0415 — local import after sys.path setup

    state_file = tmp_path / "agent_state.json"
    app_data_file = tmp_path / "app_data.json"

    monkeypatch.setattr(config, "AGENT_STATE_FILE", str(state_file))
    monkeypatch.setattr(config, "APP_DATA_FILE", str(app_data_file))

    yield tmp_path


@pytest.fixture
def client(monkeypatch, tmp_agent_state):
    """FastAPI TestClient with INGEST_TOKEN set to 'test-token-abc'.

    Depends on tmp_agent_state so each test gets an isolated data directory.

    APScheduler registers a job with id 'kv_check' on every scheduler.start()
    call. Because main.py is a module singleton, the scheduler is shared across
    all tests in a session. Monkeypatching scheduler.start to a no-op prevents
    the ConflictingIdError that would otherwise surface when the second test
    creates a TestClient — the @app.on_event("startup") handler fires again and
    tries to add the same job a second time.
    """
    import config  # noqa: PLC0415
    import scheduler as sched_module  # noqa: PLC0415

    monkeypatch.setattr(config, "INGEST_TOKEN", "test-token-abc")
    monkeypatch.setattr(sched_module, "start", lambda: None)

    from fastapi.testclient import TestClient  # noqa: PLC0415
    from main import app  # noqa: PLC0415

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def mock_telegram(monkeypatch):
    """Monkeypatch Telegram send functions across all modules that import them.

    Patches:
      telegram_client.send_message
      telegram_client.send_photo
      agent_job.send_message        (in-module reference)

    Yields a namespace with .send_message and .send_photo attributes so tests
    can assert on call counts and arguments.
    """
    import types

    mock_send = MagicMock(return_value=None)
    mock_photo = MagicMock(return_value=None)

    import telegram_client  # noqa: PLC0415
    import agent_job  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(telegram_client, "send_message", mock_send)
    monkeypatch.setattr(telegram_client, "send_photo", mock_photo)
    monkeypatch.setattr(agent_job, "send_message", mock_send)

    ns = types.SimpleNamespace(send_message=mock_send, send_photo=mock_photo)
    yield ns


@pytest.fixture
def mock_send_pending_card(monkeypatch):
    """Monkeypatch send_pending_card to return (42, -100) without real Telegram API calls.

    Patches:
      telegram_client.send_pending_card
      ingest_handler.send_pending_card   (in-module reference after Task 3 lands)

    Yields the MagicMock so tests can assert on call counts and arguments.
    """
    mock = MagicMock(return_value=(42, -100))

    import telegram_client  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    # Use raising=False so the fixture works before Plan 02-02 ships send_pending_card.
    monkeypatch.setattr(telegram_client, "send_pending_card", mock, raising=False)
    if hasattr(ingest_handler, "send_pending_card"):
        monkeypatch.setattr(ingest_handler, "send_pending_card", mock)

    yield mock


@pytest.fixture
def mock_gmail(monkeypatch):
    """Monkeypatch gmail_client.create_draft to return True without IMAP calls.

    Patches:
      gmail_client.create_draft
      main.gmail_client.create_draft  (if main.py imports gmail_client as a module)

    Yields the MagicMock so tests can assert on call counts and arguments.
    """
    import gmail_client  # noqa: PLC0415

    mock = MagicMock(return_value=True)
    monkeypatch.setattr(gmail_client, "create_draft", mock)

    try:
        from importlib import import_module  # noqa: PLC0415
        main_mod = import_module("main")
        monkeypatch.setattr(main_mod.gmail_client, "create_draft", mock)
    except (ImportError, AttributeError):
        pass  # main.py may not import gmail_client yet — safe to skip

    yield mock


# ---------------------------------------------------------------------------
# pytest-postgresql fixtures — per-session Postgres subprocess, per-test
# rollback isolation (Pitfall 8 in 07-RESEARCH.md).
#
# Wave 0 note: the `db_session` fixture body imports `db` and `Base` lazily.
# Those modules do not exist until Wave 1. Any test that requests `db_session`
# will therefore fail with a clean ImportError at SETUP time (not at collection
# time), which is the expected RED state for Wave 0. No other tests are affected.
# ---------------------------------------------------------------------------

# Postgres fixture strategy — two modes:
#
# A) Running inside Docker compose (POSTGRES_HOST env var is set):
#    Use `postgresql_noproc` to connect to the already-running postgres service.
#    No subprocess spawn needed — pg_ctl / pg_config not required.
#
# B) Running locally (no POSTGRES_HOST, no pytest-postgresql):
#    Provide skip stubs so collection succeeds and non-DB tests are unaffected.
#
# Guards: factories are only registered when pytest-postgresql is installed.
# Detect Docker compose environment: POSTGRES_USER is injected via env_file
# in docker-compose.yml. When running locally without Docker, POSTGRES_USER
# is typically not set (tests fall back to subprocess Postgres spawning).
# POSTGRES_HOST defaults to "postgres" (Docker compose service name); fall back
# to checking POSTGRES_USER as the primary signal so no extra env var is needed.
_IN_DOCKER = bool(os.environ.get("POSTGRES_USER"))

if _PYTEST_POSTGRESQL_AVAILABLE and _IN_DOCKER:
    # Connect to the compose postgres service directly.
    _pg_host = os.environ.get("POSTGRES_HOST", "postgres")
    _pg_port = int(os.environ.get("POSTGRES_PORT", "5432"))
    _pg_user = os.environ.get("POSTGRES_USER", "aparts")
    _pg_pass = os.environ.get("POSTGRES_PASSWORD", "")
    _pg_db   = os.environ.get("POSTGRES_DB", "aparts_looker")

    # Use a dedicated test database ("tests") separate from production
    # ("aparts_looker") so the janitor can create/drop it freely.
    # DatabaseJanitor creates the test DB, runs tests, then drops it.
    postgresql_proc_fixture = _pp_factories.postgresql_noproc(
        host=_pg_host,
        port=_pg_port,
        user=_pg_user,
        password=_pg_pass,
        dbname="tests",
    )
    postgresql_db_fixture = _pp_factories.postgresql("postgresql_proc_fixture")

elif _PYTEST_POSTGRESQL_AVAILABLE:
    # Local dev with a Postgres subprocess managed by pytest-postgresql.
    # port=None lets pytest-postgresql choose a free port so parallel runs never
    # collide (Pitfall 8 — T-07-00-03 accepted: subprocess torn down by fixture).
    postgresql_proc_fixture = _pp_factories.postgresql_proc(port=None)
    postgresql_db_fixture = _pp_factories.postgresql("postgresql_proc_fixture")

else:
    # Provide stub fixtures so pytest can collect the test files without aborting.
    # They raise ImportError at runtime so the failure message is clear.
    @pytest.fixture(scope="session")
    def postgresql_proc_fixture():
        pytest.skip("pytest-postgresql not installed — DB tests require Docker env")

    @pytest.fixture
    def postgresql_db_fixture(postgresql_proc_fixture):
        pytest.skip("pytest-postgresql not installed — DB tests require Docker env")


@pytest.fixture
def db_session(postgresql_db_fixture, monkeypatch):
    """SQLAlchemy Session with per-test BEGIN + SAVEPOINT + ROLLBACK isolation.

    Two modes:
      Docker (POSTGRES_USER set): uses the compose postgres service via
        config.DATABASE_URL. Schema already exists (created by Alembic in
        entrypoint.sh). Each test wraps its work in a SAVEPOINT that rolls
        back on teardown so the production schema stays intact.
      Local dev (pytest-postgresql subprocess): builds DSN from
        postgresql_db_fixture.info, creates schema via create_all, wraps each
        test in a transaction that rolls back.

    Monkeypatches db.SessionLocal so any data_store.* call executed under this
    fixture operates on the same connection / transaction.

    Teardown order: session.close() → trans.rollback() → connection.close() →
    engine.dispose() — never raises (never-raise pattern).
    """
    # Lazy imports so Wave 0 module-missing produces an ImportError at SETUP
    # time (clear RED signal) rather than a conftest-wide collection failure.
    from sqlalchemy import create_engine  # noqa: PLC0415
    from sqlalchemy.orm import sessionmaker  # noqa: PLC0415
    import db as db_module  # noqa: PLC0415  — Wave 1 creates this module
    from db import Base  # noqa: PLC0415

    if _IN_DOCKER:
        # Docker mode: connect to the already-migrated compose service DB.
        # Schema already exists from Alembic migrations in entrypoint.sh.
        import config as _cfg  # noqa: PLC0415
        conn_str = _cfg.DATABASE_URL
        engine = create_engine(conn_str, pool_pre_ping=True)
        with engine.begin() as ddl_conn:
            Base.metadata.create_all(ddl_conn)  # no-op if schema already exists
    else:
        # Local dev mode: connect to the subprocess Postgres from the fixture.
        info = postgresql_db_fixture.info
        _pw = getattr(info, "password", "") or ""
        _pw_part = f":{_pw}" if _pw else ""
        conn_str = (
            f"postgresql+psycopg://{info.user}{_pw_part}"
            f"@{info.host}:{info.port}/{info.dbname}"
        )
        engine = create_engine(conn_str)
        with engine.begin() as ddl_conn:
            Base.metadata.create_all(ddl_conn)

    connection = engine.connect()
    trans = connection.begin()

    # Per-test isolation: TRUNCATE the listings table at the START of each test
    # (inside the outer transaction that gets rolled back on teardown). This ensures
    # tests see a clean slate even if a prior test left committed rows in the DB
    # (e.g. from a test that doesn't use db_session, or from a debug session).
    # TRUNCATE … RESTART IDENTITY resets serial sequences too.
    # The TRUNCATE itself is part of `trans` and is rolled back at teardown,
    # restoring any pre-test rows that were present before the test started.
    try:
        from sqlalchemy import text as _sa_text  # noqa: PLC0415
        connection.execute(_sa_text("TRUNCATE TABLE listings RESTART IDENTITY CASCADE"))
    except Exception:
        pass  # Table may not exist yet (pre-migration) — safe to skip

    # Wave 2 note: data_store.* functions call db_.commit() after every write.
    # To prevent that commit from ending `trans` (which would invalidate the
    # connection for subsequent data_store calls in the same test), we patch
    # SessionLocal to return sessions that run INSIDE a SAVEPOINT. Each
    # session's commit() flushes to the savepoint rather than the outer
    # transaction, so `trans.rollback()` at teardown still reverts everything.
    #
    # Pattern: each TestSession() call joins the existing connection and
    # immediately begins a nested transaction (SAVEPOINT) whose commit() is
    # a no-op to the outer transaction. A new nested transaction is started
    # after each commit so the session remains usable for the rest of the test.
    #
    # Reference: https://docs.sqlalchemy.org/en/20/orm/session_transaction.html
    #   #joining-a-session-into-an-external-transaction-the-test-teardown-use-case

    from sqlalchemy.orm import Session  # noqa: PLC0415

    class NestedSession(Session):
        """Session that stays inside `trans` (the outer fixture transaction).

        - On init: calls begin_nested() to open a SAVEPOINT on the shared connection.
        - On commit(): commits the SAVEPOINT and immediately opens a new one so
          the session is still usable for subsequent calls in the same test.
        - On close(): expunges ORM objects WITHOUT releasing the shared connection.
          data_store calls db_.close() in every finally block; without this override,
          close() would call _close_impl(invalidate=False) which releases the
          connection back to the pool, making the next make_session() call fail with
          ResourceClosedError because `trans` is still "active" but the conn is gone.
        """

        def commit(self):  # type: ignore[override]
            # Flush to SAVEPOINT (not the outer transaction).
            super().commit()
            # Reopen a SAVEPOINT so the session is usable for the next operation.
            if self.is_active:
                self.begin_nested()

        def rollback(self):  # type: ignore[override]
            # Roll back only to our SAVEPOINT.
            super().rollback()
            if self.is_active:
                self.begin_nested()

        def close(self):  # type: ignore[override]
            # Expunge ORM objects but do NOT release the shared connection.
            # Calling super().close() would invoke _close_impl(invalidate=False)
            # which disconnects the session from the bound connection, causing
            # ResourceClosedError on the next SessionLocal() call in the same test.
            self.expunge_all()

    def _make_session() -> NestedSession:
        """Factory: create a NestedSession bound to the shared connection."""
        sess = NestedSession(bind=connection, expire_on_commit=False)
        sess.begin_nested()
        return sess

    session = _make_session()

    # Monkeypatch SessionLocal so data_store.* shares this transaction.
    # IMPORTANT: data_store.py does `from db import SessionLocal` at import time,
    # which binds the name `SessionLocal` directly in the data_store module namespace.
    # Patching db_module.SessionLocal only affects NEW callers that do `db.SessionLocal()`.
    # We must ALSO patch `data_store.SessionLocal` (the module-local binding) so that
    # every `db_ = SessionLocal()` inside data_store functions uses the test factory.
    monkeypatch.setattr(db_module, "SessionLocal", _make_session)
    import data_store as _data_store_module  # noqa: PLC0415
    if hasattr(_data_store_module, "SessionLocal"):
        monkeypatch.setattr(_data_store_module, "SessionLocal", _make_session)

    yield session

    # Teardown — unconditional rollback; never-raise pattern.
    try:
        session.close()
    except Exception:
        pass
    try:
        trans.rollback()
    except Exception:
        pass
    try:
        connection.close()
    except Exception:
        pass
    try:
        engine.dispose()
    except Exception:
        pass
