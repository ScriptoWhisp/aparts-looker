# Directory Structure

**Mapped:** 2026-07-07

---

## Top-Level Layout

```
aparts-looker/
├── app/                        # All application code
│   ├── main.py                 # FastAPI app, entry point, API routes
│   ├── scheduler.py            # APScheduler wrapper, starts background job
│   ├── agent_job.py            # Core agent logic: scrape → evaluate → notify
│   ├── kv_alert_reader.py      # kv.ee Playwright scraper (CF bypass + URL harvest)
│   ├── kv_listing_parser.py    # Fetch & parse individual kv.ee listing pages
│   ├── ai_evaluator.py         # Anthropic Claude Haiku scoring + email drafting
│   ├── telegram_client.py      # Telegram Bot API: send cards, poll commands
│   ├── gmail_client.py         # Gmail IMAP (save draft) + SMTP (send email)
│   ├── data_store.py           # Thread-safe JSON persistence layer
│   ├── config.py               # All env-var constants + BUYER_PROFILE text
│   ├── requirements.txt        # Python dependencies
│   ├── Dockerfile              # Container image definition
│   ├── static/
│   │   └── index.html          # Entire frontend — single-file SPA (vanilla JS)
│   └── data/
│       └── .gitkeep            # Volume mount point for runtime JSON files
├── docker-compose.yml          # Service definition, env, volume mounts
├── Caddyfile                   # Reverse proxy config (TLS termination)
├── README.md
├── .env                        # Local secrets (not committed)
├── .github/
│   └── workflows/
│       └── deploy.yml          # CD: SSH deploy to server on push to main
└── .planning/                  # GSD planning artifacts (this dir)
    └── codebase/               # Codebase map documents
```

---

## Key Locations

| What | Where |
|---|---|
| Server entry point | `app/main.py` |
| Agent business logic | `app/agent_job.py` |
| Scraper (Playwright) | `app/kv_alert_reader.py` |
| Listing HTML parser | `app/kv_listing_parser.py` |
| AI evaluation | `app/ai_evaluator.py` |
| Persistence | `app/data_store.py` |
| All configuration | `app/config.py` |
| Frontend (entire UI) | `app/static/index.html` |
| Runtime data files | `app/data/` (docker volume) |
| Deployment pipeline | `.github/workflows/deploy.yml` |

---

## Naming Conventions

- Module names are `snake_case`, flat (no packages within `app/`)
- Files grouped by concern suffix: `_client.py` (external API wrappers), `_parser.py` (HTML parsing), `_store.py` (persistence)
- `kv_alert_reader.py` is a legacy name — it was originally a Gmail alert reader, now it's the Playwright scraper
- Config constants are `UPPER_SNAKE_CASE` at module level in `config.py`
- Internal helpers prefixed with `_` (e.g. `_build_message`, `_read_json`, `_lock`)

---

## Data Files at Runtime

```
app/data/
├── app_data.json     # {properties: [...], checklists: {}, settings: {}}
└── agent_state.json  # {seen_listing_ids: [], pending_drafts: {}, last_telegram_update_id: 0}
```

Both files are created on first write; fall back to hardcoded defaults if missing or corrupted.

---

## Where to Add New Code

| Task | Location |
|---|---|
| New API endpoint | `app/main.py` |
| New scraping source | New `*_reader.py` in `app/`, wire into `agent_job.py` |
| New evaluation criteria | `app/config.py` (BUYER_PROFILE), `app/ai_evaluator.py` (prompt) |
| New notification channel | New `*_client.py` in `app/`, call from `agent_job.py` |
| New persistent state field | `app/data_store.py` (DEFAULT_AGENT_STATE or DEFAULT_APP_DATA) |
| Frontend changes | `app/static/index.html` (entire UI in one file) |
