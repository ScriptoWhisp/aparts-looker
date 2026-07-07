# Coding Conventions

**Analysis Date:** 2026-07-07

## Naming Patterns

**Files:**
- Lowercase with underscores: `agent_job.py`, `kv_listing_parser.py`, `telegram_client.py`
- Service/module files describe their primary purpose: `config.py`, `data_store.py`, `scheduler.py`
- No package `__init__.py` files — modules imported directly by relative/absolute paths

**Functions:**
- Lowercase with underscores: `fetch_listing()`, `format_listing_card()`, `load_app_data()`
- Private functions prefixed with underscore: `_extract_json()`, `_read_json()`, `_write_json()`, `_build_message()`
- Functions are descriptive and verb-based: `send_message()`, `get_session()`, `extract_send_commands()`

**Variables:**
- Lowercase with underscores: `new_urls`, `last_update_id`, `pending_drafts`, `last_telegram_update_id`
- Constants in UPPERCASE: `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `API_BASE`, `MAX_PAGES`
- Module-level constants prefixed with regex patterns when appropriate: `PRICE_RE`, `ROOMS_RE`, `EMAIL_RE`
- Loop variables use descriptive names when non-trivial: `for listing_id in listing_ids:` (not `i`)

**Types:**
- Type hints used throughout: `url: str`, `listing: Listing`, `state: dict`, `timeout: int`
- Optional types: `Optional[int]`, `Optional[str]`
- Union types with pipe operator: `requests.Session | None`
- Return type hints on all functions: `-> dict`, `-> None`, `-> bool`, `-> list[str]`

**Classes & Dataclasses:**
- PascalCase: `Listing` (defined as dataclass in `kv_listing_parser.py`)
- Field names in dataclass use lowercase: `price_eur`, `area_sqm`, `year_built`, `contact_email`

## Code Style

**Formatting:**
- No explicit formatter configured — follows PEP 8 by convention
- 4-space indentation (Python standard)
- Line length appears to follow ~100-120 character soft limit (lines stay manageable)
- No trailing whitespace
- Two blank lines between top-level functions/classes, one blank line between methods

**Linting:**
- No `.pylintrc`, `.flake8`, or `pyproject.toml` with lint rules detected
- Style follows PEP 8 implicitly through manual discipline
- Type hints enforced throughout (aids in runtime validation)

**Docstrings:**
- Module-level docstrings present on all major files: `"""Module purpose and design notes."""`
- Function docstrings used selectively for complex/critical functions:
  - `fetch_listing()`: Documents never-raise pattern and fallback behavior
  - `add_property_if_new()`: Briefly explains return value
  - `evaluate_listing()`: Explains fallback strategy on API failure
- Most simple utility functions lack docstrings (names are self-documenting)

## Import Organization

**Order:**
1. Standard library imports: `logging`, `json`, `os`, `threading`, `re`, `time`, `imaplib`, `smtplib`, etc.
2. Third-party library imports: `fastapi`, `requests`, `beautifulsoup4`, `dataclasses`, `playwright`, `apscheduler`
3. Local/relative imports: `import config`, `import data_store`, `from ai_evaluator import ...`

**Path Aliases:**
- No path aliases used
- All imports are direct module names or explicit relative imports
- Example: `from config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL, BUYER_PROFILE`

**Blank line rule:**
- One blank line separates import groups

## Error Handling

**Patterns:**
- **Graceful degradation (never-raise pattern):**
  - `evaluate_listing()` catches `(requests.RequestException, json.JSONDecodeError, KeyError, ValueError)` and returns fallback `{"score": 0, "verdict": "Could not get AI evaluation..."}`
  - `fetch_listing()` catches `requests.RequestException`, sets `raw_ok=False`, returns partial Listing object
  - `fetch_listing_urls()` catches generic `Exception`, logs, returns empty list
  - Used liberally in background jobs and I/O-heavy functions (`kv_alert_reader.py`, `telegram_client.py`, `gmail_client.py`)

- **Logging exceptions:**
  - Use `log.exception()` to capture full traceback: `log.exception("agent_job.run_check failed")`
  - Use `log.error()` for errors without full context: `log.error("Failed to load page %d: %s", i + 1, e)`
  - Use `log.warning()` for recoverable issues: `log.warning("Failed to fetch listing: %s", url)`

- **Guard clauses:**
  - Early exit pattern common in handlers:
    ```python
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    ```
  - Used to avoid nested try blocks

- **Boolean fallback:**
  - Functions return `False` (not `None`) on recoverable errors to distinguish from partial success:
    - `create_draft()` returns `bool`
    - `send_email()` returns `bool`
    - `add_property_if_new()` returns `bool` (added=True, already exists=False)

## Logging

**Framework:** Python standard `logging` module

**Logger creation pattern:**
```python
log = logging.getLogger(__name__)  # or specific name like "app", "agent_job"
```

**Logging levels used:**
- `log.info()`: Normal operational flow — counts, progress, decision points
  - Example: `log.info("Scraped %d total URLs from kv.ee", len(new_urls))`
  - Example: `log.info("Score: %s/100 — %s", evaluation.get('score'), evaluation.get('verdict'))`
- `log.warning()`: Recoverable issues or skipped items
  - Example: `log.warning("Failed to fetch listing: %s", url)`
  - Example: `log.warning("KV_SEARCH_URL is not set — skipping scrape")`
- `log.error()`: Errors during operation
  - Example: `log.error("Failed to load page %d: %s", i + 1, e)`
- `log.exception()`: Caught exceptions with full traceback
  - Example: `log.exception("agent_job.run_check failed")`

**Configuration:** `main.py` sets up logging on startup:
```python
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
```

## Comments

**When to Comment:**
- **Design notes in module docstrings:** Explain *why* the approach was chosen
  - Example: `ai_evaluator.py` explains that Anthropic API is used directly, not claude.ai
  - Example: `kv_listing_parser.py` explains why regex is used instead of CSS selectors (resilience to markup changes)
  - Example: `data_store.py` explains why threading.RLock is used instead of a database (simplicity at scale)
- **Complex regex patterns:** Brief explanation of what is matched
  - Example: `NEEDS_RENO_RE = re.compile(...)  # Matches renovation keywords`
- **Non-obvious control flow:** Why we're doing something unexpected
  - Example: `# Photo URL might be unreachable/invalid - fall back to a plain text message`
  - Example: `# don't fire instantly on every container restart`
  - Example: `# Gmail's drafts folder is usually "[Gmail]/Drafts" but can be localized`
- **Workarounds:** Why a workaround exists and what it addresses
  - Example: `# deep copy` (not just `default`)

**Inline comments:** Minimal — prefer self-documenting code (clear variable names, small functions)

**JSDoc/TSDoc:** Not used (Python codebase)

## Function Design

**Size:**
- Functions are small and focused — mostly 1-30 lines
- Largest functions are orchestrators (`run_check()` = 14 lines, `fetch_listing_urls()` = 70 lines)
- Short functions aid readability and testing (e.g., `send_message()` = 12 lines, `extract_send_commands()` = 10 lines)

**Parameters:**
- Functions take explicit parameters, rarely globals
- When accessing config, it's explicit: `import config` and `config.MAX_PRICE_EUR`
- Defaults used sparingly; most parameters are required
- Example: `fetch_listing(url: str, timeout: int = 15, session: requests.Session | None = None)`

**Return Values:**
- Most functions return something specific, not None
- Fallback returns used instead of raising (never-raise pattern):
  - Return empty list: `return []`
  - Return empty dict: `return {}`
  - Return False: `return False`
  - Return partial object: Listing with `raw_ok=False`
- Tuples for multiple return values: `get_new_updates() -> tuple[list[dict], int]`

## Module Design

**Exports:**
- No explicit `__all__` declaration
- Public functions and classes are those without leading underscore
- Private functions prefixed with underscore: `_extract_json()`, `_read_json()`, `_to_int()`, `_build_message()`

**Barrel Files:**
- None used — all modules are imported directly by name
- `config.py` acts as single source of truth for configuration constants

**Global State:**
- Minimized but used where appropriate:
  - `data_store.py`: `_lock = threading.RLock()` — single process-wide lock for file access
  - `kv_alert_reader.py`: `_session: requests.Session | None = None` — shared session reused across agent job run
- Explicitly documented in module docstrings why globals are necessary

**Module interdependencies:**
- Layered imports (one-way dependency graph):
  - `config.py` — no dependencies (pure constants)
  - `data_store.py` — depends on `config`
  - Other service modules (`telegram_client`, `gmail_client`, `kv_listing_parser`) — depend on `config`, no cross-dependencies
  - `ai_evaluator.py` — depends on `config`, `kv_listing_parser.Listing`
  - `agent_job.py` — orchestrates: imports all service modules
  - `scheduler.py` — wraps `agent_job.run_check()`
  - `main.py` — entry point: imports `data_store`, `scheduler`

---

*Convention analysis: 2026-07-07*
