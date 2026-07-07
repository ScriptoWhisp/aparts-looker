<!-- GSD:project-start source:PROJECT.md -->

## Project

**Aparts Looker**

A personal apartment-hunting automation system for Daniel's Tallinn apartment search. It scrapes Estonian real estate portals, evaluates listings with AI against Daniel's specific buying criteria, manages a review queue with Telegram + web UI, and sends drafts to real estate agents on his approval. The goal is to eliminate manual portal-checking and make sure no good listing slips through unnoticed.

**Core Value:** Every new listing that meets Daniel's criteria gets evaluated, queued, and surfaced to him before he has to manually look — and the best ones get an email to the agent drafted and ready.

### Constraints

- **Scraping**: datacenter IPs are blocked by kv.ee Cloudflare — residential IP (home mini PC) required for scraping
- **Scale**: single user, low request volume — JSON file persistence is fine, no DB migration needed yet
- **AI cost**: Claude Haiku pricing is a fraction of a cent per listing — cost not a constraint
- **Email**: Gmail App Password, no Google Cloud OAuth needed
- **Mini PC OS**: Windows or macOS — scraper must run without Linux-only tooling

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- Python 3.12 - Server-side application, agent job, data processing, and scraping
- HTML/CSS/JavaScript - Static frontend dossier UI (served via FastAPI StaticFiles)

## Runtime

- Python 3.12 (slim Docker image)
- Docker containerization with `docker-compose` orchestration
- pip (Python package manager)
- Lockfile: `app/requirements.txt` (pinned versions)

## Frameworks

- FastAPI 0.111.0+ - Lightweight async web server for JSON API and static frontend serving
- uvicorn[standard] 0.30.0+ - ASGI server running FastAPI with live reload support
- APScheduler 3.10.4+ - Background job scheduler for periodic kv.ee listing checks (interval-based)
- Playwright 1.44.0+ - Headless Chromium browser to bypass Cloudflare challenge on kv.ee search pages
- requests 2.31.0+ - HTTP client for individual listing fetches, API calls to Anthropic and Telegram
- BeautifulSoup4 4.12.0+ - HTML parsing for kv.ee listing detail pages
- lxml 5.0.0+ - Fast XML/HTML parsing backend for BeautifulSoup
- Python standard library `imaplib` - IMAP4 SSL for Gmail Draft folder access
- Python standard library `smtplib` - SMTP for sending emails via Gmail App Password
- Python standard library `email.mime` - Email message construction

## Key Dependencies

- `fastapi` - Core web framework for serving dossier API and frontend
- `playwright` - Required for Cloudflare bypass on kv.ee search; used once per check interval to harvest cookies
- `requests` - HTTP library for all external API calls (Anthropic Claude, Telegram Bot, kv.ee individual listings)
- `uvicorn[standard]` - Production ASGI server with uvloop for performance
- `apscheduler` - Enables in-process background job scheduling without external cron/queue services
- `beautifulsoup4` + `lxml` - Parsing kv.ee listing HTML using regex-first extraction for robustness

## Configuration

- `.env` file (not committed) loaded by `docker-compose.yml`
- All secrets via environment variables: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, `ANTHROPIC_API_KEY`, `KV_SEARCH_URL`
- Threshold and filtering settings: `DRAFT_SCORE_THRESHOLD`, `MIN_IMAGES`, `MIN_ROOMS`, `MAX_PRICE_EUR`, `CHECK_INTERVAL_HOURS`
- `app/Dockerfile` - Single-stage Python 3.12 slim image with Playwright Chromium binary installation
- `docker-compose.yml` - Two-service stack: app (FastAPI) + Caddy (reverse proxy)

## Platform Requirements

- Python 3.12
- Docker + Docker Compose
- Playwright Chromium binary (installed automatically in Docker)
- Docker host with docker-compose
- IP: `46.62.152.9` (deployed via SSH + git pull)
- HTTPS via Caddy with automatic certificate management
- Volume mount for persistent data: `/app/data` (apartment_data volume in docker-compose)

## External API Integration Points

- HTTP POST to `https://api.anthropic.com/v1/messages`
- Model: Configurable (default: `claude-haiku-4-5-20251001`)
- Authentication: Bearer token via `ANTHROPIC_API_KEY` header
- Polling `https://api.telegram.org/bot{TOKEN}/getUpdates`
- Sending messages via `https://api.telegram.org/bot{TOKEN}/sendMessage` and `/sendPhoto`
- Authentication: Bot token in URL path
- IMAP4_SSL to `imap.gmail.com` for draft creation
- SMTP_SSL to `smtp.gmail.com:465` for email sending
- Authentication: Gmail account + App Password (requires 2-Step Verification enabled)
- Playwright-driven headless browser to bypass Cloudflare on search: `KV_SEARCH_URL`
- Cloudflare cookies harvested and reused in `requests.Session` for subsequent listing fetches
- HTTP requests with Chrome user-agent spoofing to individual listing pages

## Reverse Proxy & Web Server

- Runs in separate container, proxies traffic to app:8000
- Handles TLS termination (auto HTTPS via Let's Encrypt)
- Basic auth configured for dossier frontend access
- Exposes ports 80 (HTTP) and 443 (HTTPS)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Lowercase with underscores: `agent_job.py`, `kv_listing_parser.py`, `telegram_client.py`
- Service/module files describe their primary purpose: `config.py`, `data_store.py`, `scheduler.py`
- No package `__init__.py` files — modules imported directly by relative/absolute paths
- Lowercase with underscores: `fetch_listing()`, `format_listing_card()`, `load_app_data()`
- Private functions prefixed with underscore: `_extract_json()`, `_read_json()`, `_write_json()`, `_build_message()`
- Functions are descriptive and verb-based: `send_message()`, `get_session()`, `extract_send_commands()`
- Lowercase with underscores: `new_urls`, `last_update_id`, `pending_drafts`, `last_telegram_update_id`
- Constants in UPPERCASE: `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `API_BASE`, `MAX_PAGES`
- Module-level constants prefixed with regex patterns when appropriate: `PRICE_RE`, `ROOMS_RE`, `EMAIL_RE`
- Loop variables use descriptive names when non-trivial: `for listing_id in listing_ids:` (not `i`)
- Type hints used throughout: `url: str`, `listing: Listing`, `state: dict`, `timeout: int`
- Optional types: `Optional[int]`, `Optional[str]`
- Union types with pipe operator: `requests.Session | None`
- Return type hints on all functions: `-> dict`, `-> None`, `-> bool`, `-> list[str]`
- PascalCase: `Listing` (defined as dataclass in `kv_listing_parser.py`)
- Field names in dataclass use lowercase: `price_eur`, `area_sqm`, `year_built`, `contact_email`

## Code Style

- No explicit formatter configured — follows PEP 8 by convention
- 4-space indentation (Python standard)
- Line length appears to follow ~100-120 character soft limit (lines stay manageable)
- No trailing whitespace
- Two blank lines between top-level functions/classes, one blank line between methods
- No `.pylintrc`, `.flake8`, or `pyproject.toml` with lint rules detected
- Style follows PEP 8 implicitly through manual discipline
- Type hints enforced throughout (aids in runtime validation)
- Module-level docstrings present on all major files: `"""Module purpose and design notes."""`
- Function docstrings used selectively for complex/critical functions:
- Most simple utility functions lack docstrings (names are self-documenting)

## Import Organization

- No path aliases used
- All imports are direct module names or explicit relative imports
- Example: `from config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL, BUYER_PROFILE`
- One blank line separates import groups

## Error Handling

- **Graceful degradation (never-raise pattern):**
- **Logging exceptions:**
- **Guard clauses:**
- **Boolean fallback:**

## Logging

- `log.info()`: Normal operational flow — counts, progress, decision points
- `log.warning()`: Recoverable issues or skipped items
- `log.error()`: Errors during operation
- `log.exception()`: Caught exceptions with full traceback

## Comments

- **Design notes in module docstrings:** Explain *why* the approach was chosen
- **Complex regex patterns:** Brief explanation of what is matched
- **Non-obvious control flow:** Why we're doing something unexpected
- **Workarounds:** Why a workaround exists and what it addresses

## Function Design

- Functions are small and focused — mostly 1-30 lines
- Largest functions are orchestrators (`run_check()` = 14 lines, `fetch_listing_urls()` = 70 lines)
- Short functions aid readability and testing (e.g., `send_message()` = 12 lines, `extract_send_commands()` = 10 lines)
- Functions take explicit parameters, rarely globals
- When accessing config, it's explicit: `import config` and `config.MAX_PRICE_EUR`
- Defaults used sparingly; most parameters are required
- Example: `fetch_listing(url: str, timeout: int = 15, session: requests.Session | None = None)`
- Most functions return something specific, not None
- Fallback returns used instead of raising (never-raise pattern):
- Tuples for multiple return values: `get_new_updates() -> tuple[list[dict], int]`

## Module Design

- No explicit `__all__` declaration
- Public functions and classes are those without leading underscore
- Private functions prefixed with underscore: `_extract_json()`, `_read_json()`, `_to_int()`, `_build_message()`
- None used — all modules are imported directly by name
- `config.py` acts as single source of truth for configuration constants
- Minimized but used where appropriate:
- Explicitly documented in module docstrings why globals are necessary
- Layered imports (one-way dependency graph):

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## Overview

## Layers

```

```

## Data Flow — Primary Check Path

## Key Abstractions

| Abstraction | File | Role |
|---|---|---|
| `Listing` dataclass | `kv_listing_parser.py` | Parsed listing fields, single source of truth across layers |
| `data_store` module | `data_store.py` | Thread-safe JSON I/O shared between web routes and agent |
| `_session` (module-level) | `kv_alert_reader.py` | CF-cookie-bearing requests session reused within an agent run |
| `config` module | `config.py` | All env-var constants + buyer profile text |

## Entry Points

| Entry | Trigger |
|---|---|
| `uvicorn main:app` | Docker container start (web server) |
| `scheduler.start()` | FastAPI `@app.on_event("startup")` |
| `run_check()` | APScheduler interval + `POST /api/check-now` |

## Concurrency Model

- One `threading.RLock` in `data_store` serializes all JSON reads/writes
- APScheduler configured `max_instances=1, coalesce=True` — no overlapping runs
- `/api/check-now` spawns `run_check()` in a daemon thread to avoid blocking the HTTP response
- Single-user scale; no async I/O in the agent path (all synchronous)

## Configuration Surface

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `KV_SEARCH_URL`
- `MIN_IMAGES`, `MIN_ROOMS`, `MAX_PRICE_EUR`, `DRAFT_SCORE_THRESHOLD`
- `CHECK_INTERVAL_HOURS`, `DATA_DIR`

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
