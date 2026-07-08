"""
Shared pytest fixtures for app/tests/.

Fixtures:
  client         — FastAPI TestClient with INGEST_TOKEN monkeypatched to "test-token-abc".
  tmp_agent_state — Redirects config.AGENT_STATE_FILE and config.APP_DATA_FILE to temp paths
                    so tests cannot corrupt real state.
  mock_telegram  — Monkeypatches telegram_client.send_message and telegram_client.send_photo
                   with MagicMocks; also patches the in-module references in agent_job and
                   ingest_handler so tests can assert on calls.

Design notes:
  - main.py mounts StaticFiles(directory="static") using a relative path, which resolves
    relative to the process cwd. Tests that import main must either run from app/ or
    have the static dir available. We handle this by temporarily changing cwd to the
    app/ directory before the FastAPI app is created/imported.
  - data_store.load_agent_state() re-reads config.AGENT_STATE_FILE on every call, so
    monkeypatching config.AGENT_STATE_FILE before the call redirects I/O to the temp file.
"""

import os
import sys
from unittest.mock import MagicMock

import pytest

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
      ingest_handler.send_message   (in-module reference)
      ingest_handler.send_photo     (in-module reference)

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
    monkeypatch.setattr(ingest_handler, "send_message", mock_send)
    monkeypatch.setattr(ingest_handler, "send_photo", mock_photo)

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

    monkeypatch.setattr(telegram_client, "send_pending_card", mock)
    # ingest_handler uses `import telegram_client` + getattr; patch module attribute if present
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
