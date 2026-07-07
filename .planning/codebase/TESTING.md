# Testing

**Mapped:** 2026-07-07

---

## Current State

**No test suite exists.** There are no test files, no test framework in `requirements.txt`, and no test commands in the CI pipeline (`deploy.yml` deploys directly on push without a test step).

---

## Test Framework

- **Framework:** None installed
- **Test runner:** None configured
- **Coverage tooling:** None

---

## What Exists

| Type | Status |
|---|---|
| Unit tests | None |
| Integration tests | None |
| End-to-end tests | None |
| CI test step | None (deploy.yml: SSH deploy on push) |
| Manual smoke tests | `/api/check-now` endpoint + Telegram output |

---

## Testability Assessment

| Module | Testability | Notes |
|---|---|---|
| `config.py` | Easy | Pure env-var reads, no side effects |
| `data_store.py` | Easy | Pure JSON I/O, injectable `DATA_DIR` via env |
| `kv_listing_parser.py` | Medium | `fetch_listing()` hits network; `Listing` dataclass and regex extraction are unit-testable with fixture HTML |
| `ai_evaluator.py` | Medium | `_extract_json()` is testable; `evaluate_listing()` needs API mock |
| `telegram_client.py` | Medium | `format_listing_card()`, `extract_send_commands()` are pure; send functions need mock |
| `gmail_client.py` | Hard | IMAP/SMTP wrappers, requires real credentials or IMAP mock |
| `kv_alert_reader.py` | Hard | Playwright browser; needs playwright mock or recording |
| `agent_job.py` | Medium | `_listing_to_property()` is pure; `process_new_listings()` has many dependencies |

---

## Recommended Starting Point

If adding tests, prioritize:
1. `kv_listing_parser.py` — regex extraction is pure logic with fixture HTML as input
2. `data_store.py` — file I/O with temp directory injection
3. `ai_evaluator._extract_json()` — JSON cleanup is pure
4. `telegram_client.format_listing_card()`, `extract_send_commands()` — pure formatting functions

Suggested framework: `pytest` + `pytest-mock` for mocking external calls.

---

## CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
# Trigger: push to main
# Steps: SSH to server → git pull → docker compose up -d
# No build step, no test step, no lint step
```

Deploys directly to production on every push to `main` without any automated quality gate.
