# Concerns

**Mapped:** 2026-07-07

---

## Summary

Personal automation tool, single-user — most concerns are acceptable tradeoffs at this scale. The main risks are external dependency fragility (Cloudflare bypass, regex parser) and the complete absence of a test suite.

---

## Issues by Severity

### High

**No test suite**
- Zero automated tests; deploys go straight to production on every push
- Risk: regressions in scraper/evaluator logic are only caught when Telegram goes quiet
- Mitigation: Add pytest with fixture HTML for `kv_listing_parser` at minimum

**Cloudflare bypass is fragile**
- `kv_alert_reader.py` uses Playwright to pass the Cloudflare JS challenge
- Cloudflare regularly updates its bot detection; the bypass may break silently
- When broken: `fetch_listing_urls()` returns empty list, no error surfaced to user beyond log
- Mitigation: Add a Telegram alert when zero listings are returned for 2+ consecutive runs

**Regex-based HTML parsing**
- `kv_listing_parser.py` extracts all listing fields via regex over page text
- kv.ee Estonian field labels (`Tube`, `Üldpind`, `Ehitusaasta`) could change
- When broken: fields return `None` silently; `price_eur=None` causes the listing to pass the price filter (no upper bound check on `None`)
- Mitigation: Add integration test fixtures from real listing HTML snapshots

---

### Medium

**Deprecated FastAPI startup hook**
- `@app.on_event("startup")` is deprecated since FastAPI 0.93 in favour of `lifespan` context managers
- Non-breaking currently but will eventually be removed
- File: `app/main.py:23`

**`ai_evaluator.py` uses raw HTTP instead of Anthropic SDK**
- Direct `requests.post` to `api.anthropic.com` — no retries, no prompt caching, no SDK-level error normalisation
- Any 5xx from Anthropic silently returns `score=0`, which could incorrectly suppress a good listing
- Mitigation: Switch to `anthropic` SDK with `with_options(max_retries=2)`

**Module name mismatch: `kv_alert_reader.py`**
- Originally a Gmail alert reader; now contains the Playwright scraper
- Confusing name misleads future contributors about what the module does
- Low risk but creates onboarding friction

**`contact_email` extraction is best-effort**
- The first email regex match in listing text is used as the agent's email
- If the listing text contains kv.ee's own support email first, it will be used incorrectly
- Partially mitigated by `and "kv.ee" not in email_m.group(0)` check in `kv_listing_parser.py:157`

---

### Low

**JSON file persistence (intentional tradeoff)**
- `app_data.json` and `agent_state.json` are fine for single-user but not concurrent writers
- Single `threading.RLock` is correct and sufficient at this scale
- Risk would emerge if a second user or process wrote to the same files

**`.env` file in repo root**
- `.env` is listed in `.gitignore` but exists on disk with real secrets
- If accidentally committed, all secrets (Telegram, Gmail, Anthropic) would be exposed
- Mitigation: Confirm `.env` stays in `.gitignore`; rotate credentials if ever committed

**No rate limiting on `/api/check-now`**
- Anyone who can reach the endpoint can spam `run_check()` in parallel
- `max_instances=1` in APScheduler only applies to the scheduled job, not to manually-spawned threads
- At current (localhost/Caddy behind auth) deployment this is acceptable

**`Listing.raw_ok=False` listings are skipped silently**
- If a fetch fails (network error, 4xx), the listing is logged as a warning but not retried
- A listing that fails on one run will be in `seen_listing_ids` and never retried
- File: `app/agent_job.py:83-85` — `state["seen_listing_ids"].append(listing.id)` happens before the `raw_ok` check

---

## Technical Debt

| Item | File | Effort |
|---|---|---|
| Rename `kv_alert_reader.py` → `kv_scraper.py` | `kv_alert_reader.py` + all imports | Low |
| Replace `@app.on_event` with `lifespan` | `main.py` | Low |
| Switch to Anthropic SDK | `ai_evaluator.py` | Medium |
| Add pytest suite for pure-function modules | New `tests/` dir | Medium |
| Add Telegram alert on empty scrape runs | `agent_job.py` | Low |
| Guard `seen_listing_ids.append` until after `raw_ok` check | `agent_job.py:83` | Low |

---

## Security Notes

- All secrets via env vars — correct pattern, no hardcoded credentials
- Cloudflare cookie harvesting is only used for read-only listing fetches
- Gmail App Password scope is narrow (IMAP Drafts append + SMTP send)
- Frontend (`index.html`) uses `fetch()` against same-origin API — no CORS issues
- No authentication on the FastAPI endpoints; relies on Caddy/network-level access control
