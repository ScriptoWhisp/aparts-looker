---
phase: 1
slug: scraper-architecture-split
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-08
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (not yet installed — Wave 0 installs) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `pytest app/tests/ -x -q` |
| **Full suite command** | `pytest app/tests/ -v` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest app/tests/ -x -q`
- **After every plan wave:** Run `pytest app/tests/ -v`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | ARCH-01 | — | scraper-client/ runs without VPS deps | manual | docker build scraper-client/ && exit 0 | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | ARCH-01 | — | Listing fields serialise/deserialise | unit | `pytest app/tests/test_listing_contract.py -x -q` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | ARCH-02 | — | /api/ingest rejects missing token 401 | unit | `pytest app/tests/test_ingest.py::test_missing_auth -x -q` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | ARCH-02 | — | /api/ingest rejects wrong token 401 | unit | `pytest app/tests/test_ingest.py::test_wrong_token -x -q` | ❌ W0 | ⬜ pending |
| 1-02-03 | 02 | 1 | ARCH-03 | — | /api/ingest processes listings, no Playwright import | unit | `pytest app/tests/test_ingest.py::test_ingest_batch -x -q` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | ARCH-04 | — | /api/heartbeat stores timestamp in agent_state | unit | `pytest app/tests/test_heartbeat.py::test_heartbeat_stored -x -q` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 2 | ARCH-04 | — | zero-listing alert fires after 2 consecutive zeros | unit | `pytest app/tests/test_heartbeat.py::test_zero_listing_alert -x -q` | ❌ W0 | ⬜ pending |
| 1-03-03 | 03 | 2 | ARCH-04 | — | offline alert fires after timeout elapsed | unit | `pytest app/tests/test_heartbeat.py::test_offline_alert -x -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/tests/__init__.py` — empty, makes tests/ a package
- [ ] `app/tests/conftest.py` — shared fixtures (FastAPI test client, mock agent_state)
- [ ] `app/tests/test_listing_contract.py` — stubs for ARCH-01 serialisation round-trip
- [ ] `app/tests/test_ingest.py` — stubs for ARCH-02/ARCH-03 ingest auth + batch processing
- [ ] `app/tests/test_heartbeat.py` — stubs for ARCH-04 heartbeat storage, zero alert, offline alert
- [ ] `pytest`, `httpx` — add to app/requirements.txt (Wave 0)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker container runs on mini PC, completes scrape cycle | ARCH-01 | Requires real Docker Desktop + kv.ee network access | Build scraper-client image, run `docker compose up`, verify logs show scrape attempt and POST to /api/ingest |
| VPS never launches Playwright after split | ARCH-03 | Runtime check on deployed system | `grep -r "playwright" app/` after removing kv_alert_reader.py import; confirm no browser process in VPS container |
| Telegram alert received when scraper goes silent | ARCH-04 | Live Telegram bot + real wait time | Stop scraper container, wait > 2×CHECK_INTERVAL_HOURS+0.5h, verify Telegram message arrives |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
