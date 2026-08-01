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

# Session-scoped Postgres subprocess — one pg process for the whole test run.
# port=None lets pytest-postgresql choose a free port so parallel runs never
# collide (Pitfall 8 — T-07-00-03 accepted: subprocess torn down by fixture).
#
# Guards: factories are only registered when pytest-postgresql is installed
# (Docker env). In a local env without the package, tests that request
# db_session or postgresql_db_fixture will error at SETUP time with a clear
# ImportError / skip — existing non-DB tests are unaffected.
if _PYTEST_POSTGRESQL_AVAILABLE:
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

    Wires a real Postgres database (from pytest-postgresql) to a SQLAlchemy
    engine, creates the schema via Base.metadata.create_all (skipping Alembic
    in tests per RESEARCH § Testing strategy), then yields a Session bound to
    a connection that is always rolled back on teardown.

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

    info = postgresql_db_fixture.info
    # psycopg3 DSN per D-02 — matches production driver scheme so a query
    # passing under test is guaranteed to parse under production (no password
    # needed for the local pytest-postgresql socket connection).
    conn_str = (
        f"postgresql+psycopg://{info.user}"
        f":@{info.host}:{info.port}/{info.dbname}"
    )
    engine = create_engine(conn_str)
    # Create schema from models directly (no Alembic in tests — throwaway DB).
    Base.metadata.create_all(engine)

    connection = engine.connect()
    trans = connection.begin()
    TestSession = sessionmaker(bind=connection, expire_on_commit=False)
    session = TestSession()

    # Monkeypatch SessionLocal so data_store.* shares this transaction.
    monkeypatch.setattr(db_module, "SessionLocal", TestSession)

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
