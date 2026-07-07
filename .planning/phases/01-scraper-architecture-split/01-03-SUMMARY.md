---
phase: 01-scraper-architecture-split
plan: "03"
subsystem: agent-health-monitoring
tags: [heartbeat, alerts, pytest, testing, arch-04]
status: complete

dependency_graph:
  requires:
    - 01-02  # handle_heartbeat writes state this plan reads
  provides:
    - check_heartbeat_timeout
    - check_consecutive_zeros
    - pytest test suite (13 tests across 3 files)
  affects:
    - app/agent_job.py (run_check wired with 2 new checks)
    - app/requirements.txt (adds pytest, httpx)

tech_stack:
  added:
    - pytest>=8.0.0 (test runner)
    - httpx>=0.27.0 (FastAPI TestClient dependency)
  patterns:
    - TDD RED/GREEN cycle (Task 1 = RED scaffold, Task 2 = GREEN implementation)
    - 24h alert cooldown via last_scraper_alert_sent_at state field
    - Fail-open cooldown parse (_alert_cooldown_ok returns True on parse error)
    - None-baseline guard in check_heartbeat_timeout (RESEARCH Pitfall 4)
    - APScheduler job-conflict workaround via monkeypatched scheduler.start in conftest

key_files:
  modified:
    - app/agent_job.py
    - app/requirements.txt
  created:
    - app/tests/__init__.py
    - app/tests/conftest.py
    - app/tests/test_ingest.py
    - app/tests/test_heartbeat.py
    - app/tests/test_listing_contract.py

decisions:
  - "check_heartbeat_timeout and check_consecutive_zeros share a single cooldown field (last_scraper_alert_sent_at) so only one alert fires per 24h regardless of which condition triggered first"
  - "_alert_cooldown_ok is fail-open (returns True on parse error) — over-alerting preferred over missing real outage"
  - "conftest.py monkeypatches scheduler.start to a no-op to prevent APScheduler ConflictingIdError across test sessions (scheduler is a module singleton)"

metrics:
  duration_seconds: 322
  completed_date: "2026-07-08"
  tasks_completed: 2
  files_changed: 7
---

# Phase 01 Plan 03: Heartbeat Alert Checks and Pytest Scaffold Summary

**One-liner:** Heartbeat offline/zero-listing Telegram alerts with 24h cooldown wired into run_check, backed by a 13-test pytest suite covering ARCH-01 through ARCH-04.

---

## What Was Built

### New functions in app/agent_job.py

**`_alert_cooldown_ok(state: dict, now: datetime) -> bool`**
Returns True when `last_scraper_alert_sent_at` is None or older than 24 hours. Fail-open: any parse error returns True (over-alerting preferred over silent outage). Used by both check functions to gate re-firing.

**`check_heartbeat_timeout(state: dict) -> None`**
Fires a Telegram alert when the scraper has gone silent beyond the threshold. Threshold: `HEARTBEAT_TIMEOUT_HOURS` if > 0, otherwise `CHECK_INTERVAL_HOURS * 2 + 0.5` (D-10 formula). None-baseline guard returns early when `last_heartbeat_ts` is None (RESEARCH Pitfall 4). Sets `state["last_scraper_alert_sent_at"]` on fire; run_check's finally block persists it.

**`check_consecutive_zeros(state: dict) -> None`**
Fires a Telegram alert when `consecutive_zero_count >= 2` (ARCH-04). Sets `state["last_scraper_alert_sent_at"]` on fire. Both checks call `send_message()` directly; the outer `run_check` try/except swallows any exception per the never-raise pattern.

**Updated `run_check()`:**
```python
try:
    process_send_commands(state)
    check_heartbeat_timeout(state)
    check_consecutive_zeros(state)
except Exception:
    log.exception("agent_job.run_check failed")
finally:
    data_store.save_agent_state(state)
```

### Pytest scaffold

**app/tests/conftest.py** — three fixtures:
- `client`: FastAPI TestClient with `INGEST_TOKEN="test-token-abc"` and `scheduler.start` no-op to prevent APScheduler `ConflictingIdError`
- `tmp_agent_state`: redirects `config.AGENT_STATE_FILE` and `config.APP_DATA_FILE` to temp paths
- `mock_telegram`: monkeypatches `send_message` and `send_photo` in `telegram_client`, `agent_job`, and `ingest_handler`

**app/tests/test_ingest.py** — 4 tests (ARCH-02, ARCH-03):
- `test_missing_auth`: POST without Authorization → 403
- `test_wrong_token`: POST with wrong token → 403
- `test_ingest_batch`: POST with valid token + mocked `evaluate_listing` → 200, Telegram called
- `test_no_playwright_import`: static AST analysis confirms `ingest_handler.py` has no `playwright`, `kv_alert_reader`, or `kv_scraper` imports

**app/tests/test_heartbeat.py** — 7 tests (ARCH-04):
- `test_heartbeat_stored`: POST heartbeat → `last_heartbeat_ts` and `consecutive_zero_count` stored
- `test_zero_count_increments`: two zero-count POSTs → `consecutive_zero_count == 2`
- `test_zero_count_resets`: zero then non-zero POST → `consecutive_zero_count == 0`
- `test_zero_listing_alert`: `consecutive_zero_count=2` + `check_consecutive_zeros()` → send_message called with "0 listings"
- `test_offline_alert`: stale heartbeat (100h ago) + `check_heartbeat_timeout()` → send_message called with "offline"
- `test_no_alert_when_no_baseline`: `last_heartbeat_ts=None` + `check_heartbeat_timeout()` → send_message NOT called
- `test_alert_cooldown`: `last_scraper_alert_sent_at` 5h ago + both checks → send_message NOT called

**app/tests/test_listing_contract.py** — 2 tests (ARCH-01):
- `test_roundtrip`: `Listing` → `dataclasses.asdict()` → `_deserialize_listing()` round-trip preserves all fields
- `test_unknown_fields_ignored`: dict with unknown key → deserializes without raising, unknown field dropped

---

## Pytest Output

```
platform darwin -- Python 3.11.1, pytest-9.1.1, pluggy-1.6.0
collected 13 items

app/tests/test_heartbeat.py::test_heartbeat_stored PASSED                [  7%]
app/tests/test_heartbeat.py::test_zero_count_increments PASSED           [ 15%]
app/tests/test_heartbeat.py::test_zero_count_resets PASSED               [ 23%]
app/tests/test_heartbeat.py::test_zero_listing_alert PASSED              [ 30%]
app/tests/test_heartbeat.py::test_offline_alert PASSED                   [ 38%]
app/tests/test_heartbeat.py::test_no_alert_when_no_baseline PASSED       [ 46%]
app/tests/test_heartbeat.py::test_alert_cooldown PASSED                  [ 53%]
app/tests/test_ingest.py::test_missing_auth PASSED                       [ 61%]
app/tests/test_ingest.py::test_wrong_token PASSED                        [ 69%]
app/tests/test_ingest.py::test_ingest_batch PASSED                       [ 76%]
app/tests/test_ingest.py::test_no_playwright_import PASSED               [ 84%]
app/tests/test_listing_contract.py::test_roundtrip PASSED                [ 92%]
app/tests/test_listing_contract.py::test_unknown_fields_ignored PASSED   [100%]

======================== 13 passed, 3 warnings in 0.48s ========================
```

13 passed, 0 skipped, 0 failed.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] APScheduler ConflictingIdError across test sessions**
- **Found during:** Task 1, first test run
- **Issue:** `main.py`'s `@app.on_event("startup")` calls `scheduler.start()` each time a new `TestClient` context is entered. APScheduler registers job id `kv_check` on the first call; the second call raises `ConflictingIdError` because the scheduler is a module-level singleton shared across all tests.
- **Fix:** Added `monkeypatch.setattr(sched_module, "start", lambda: None)` in the `client` fixture in `conftest.py`. Tests that need the scheduler behavior directly call `data_store` and `agent_job` functions without going through the HTTP layer.
- **Files modified:** `app/tests/conftest.py`
- **Commit:** 8c43021

**2. [Rule 3 - Blocking] pytest import at end of test_heartbeat.py**
- **Found during:** Task 1, first test collection
- **Issue:** `@pytest.mark.skip` decorators were used before `import pytest` at the bottom of the file, causing `NameError: name 'pytest' is not defined` during collection.
- **Fix:** Moved `import pytest` to the top of `test_heartbeat.py`.
- **Files modified:** `app/tests/test_heartbeat.py`
- **Commit:** 8c43021

### Deviations from RESEARCH Pattern 3 reference

The RESEARCH Pattern 3 reference implementation used `datetime.fromisoformat(last_ts_str.rstrip("Z"))` to handle the trailing "Z". The production implementation uses `datetime.fromisoformat(last_ts_str)` directly and handles naive datetimes by replacing `tzinfo=timezone.utc`. Python 3.11+ `fromisoformat` accepts the "Z" suffix; the approach is robust for the project's Python 3.12 Docker runtime.

---

## VPS End-to-End Verification

Manual end-to-end test (consecutive zero-listing alert on deployed VPS) is deferred to the `/gsd-verify-work` step for Phase 1. This requires the mini PC scraper client from plan 01-01 to be running and sending heartbeats.

---

## Known Stubs

None. All check functions are fully wired and tested.

---

## Threat Flags

No new network endpoints or auth paths introduced. The two new check functions are in-process scheduler-tick operations reading from agent_state.json. T-01-07, T-01-08, and T-01-09 from the plan's threat register were addressed:
- T-01-07 (alert spam via forged heartbeats): mitigated by Bearer token on /api/heartbeat (plan 01-02) + 24h cooldown
- T-01-08 (cooldown parse failure): mitigated by fail-open in _alert_cooldown_ok
- T-01-09 (alert message content): accepted — messages contain only timestamps and generic diagnostics

## Self-Check: PASSED

- app/agent_job.py exists: FOUND
- app/tests/__init__.py exists: FOUND
- app/tests/conftest.py exists: FOUND
- app/tests/test_ingest.py exists: FOUND
- app/tests/test_heartbeat.py exists: FOUND
- app/tests/test_listing_contract.py exists: FOUND
- Task 1 commit 8c43021: FOUND
- Task 2 commit 21f283f: FOUND
- 13 tests passed, 0 skipped, 0 failed: CONFIRMED
