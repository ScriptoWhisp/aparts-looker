# External Integrations

**Analysis Date:** 2026-07-07

## APIs & External Services

**AI Evaluation:**
- Anthropic Claude API - AI desk-review scoring and outreach email drafting for apartment listings
  - SDK/Client: `requests` (plain HTTP POST to `https://api.anthropic.com/v1/messages`)
  - Auth: `ANTHROPIC_API_KEY` environment variable (Bearer token in x-api-key header)
  - Used by: `ai_evaluator.py` → `evaluate_listing()`
  - Model configurable: `ANTHROPIC_MODEL` env var, default `claude-haiku-4-5-20251001`
  - Max tokens per request: 1000

**Telegram Messaging:**
- Telegram Bot API - Real-time notifications of new listings with scores and summaries; command polling for "/send <id>"
  - SDK/Client: `requests` (plain HTTP POST/GET to `https://api.telegram.org/bot{TOKEN}/...`)
  - Auth: `TELEGRAM_BOT_TOKEN` environment variable (embedded in URL path)
  - Chat ID: `TELEGRAM_CHAT_ID` environment variable
  - Used by: `telegram_client.py`
  - Endpoints: `getUpdates` (polling), `sendMessage`, `sendPhoto` (with fallback to text)

**Real Estate Listings Source:**
- kv.ee Search & Detail Pages - Primary source of apartment listings in Tallinn
  - Transport: HTTP requests with Cloudflare bypass
  - Auth: None (public site, but protected by Cloudflare challenge)
  - Used by: `kv_alert_reader.py`, `kv_listing_parser.py`
  - Flow: 
    1. Playwright headless Chromium fetches search results, passes Cloudflare JS challenge
    2. Cloudflare cookies extracted from browser context
    3. Cookies reused in `requests.Session` for individual listing detail page fetches
    4. Regex-based parsing of listing HTML to extract price, rooms, area, condition, images, etc.

## Data Storage

**Databases:**
- None (file-based JSON only)

**File Storage:**
- Local filesystem only
  - App data: `{DATA_DIR}/app_data.json` - Persisted dossier properties, checklists, settings
  - Agent state: `{DATA_DIR}/agent_state.json` - Tracking seen listing IDs, pending email drafts, Telegram update offset
  - Default `DATA_DIR`: `/app/data` (Docker volume mount: `apartment_data`)

**Caching:**
- In-memory: Cloudflare cookies cached in `requests.Session` object (global `_session` in `kv_alert_reader.py`)
- None beyond that

## Authentication & Identity

**Auth Provider:**
- Custom (no centralized auth service)

**Implementation:**
- Basic HTTP auth for dossier frontend: Caddy reverse proxy enforces username/password
- Gmail App Password auth: IMAP/SMTP login with dedicated 16-char app password (requires Gmail 2-Step Verification)
- Telegram Bot Token: Simple token-based API key in environment
- Anthropic API Key: Bearer token in HTTP header
- kv.ee: No auth needed (public site, but Cloudflare bot detection bypassed via Playwright)

## Monitoring & Observability

**Error Tracking:**
- None (no external error tracking service)
- Errors logged locally via Python `logging` module
- Telegram notifications serve as operational alerts

**Logs:**
- Local stdout/stderr captured by Docker/docker-compose
- Log format: `%(asctime)s %(levelname)s %(name)s: %(message)s`
- Logger names: `app`, `scheduler`, `agent_job`, `ai_evaluator`, `kv_scraper`, `kv_listing_parser`, `gmail_client`, `telegram_client`

## CI/CD & Deployment

**Hosting:**
- VPS (IP: `46.62.152.9`)
- Deployed via SSH + manual git pull + docker compose up -d --build

**CI Pipeline:**
- GitHub Actions (`.github/workflows/deploy.yml`)
- Trigger: Push to `main` branch
- Steps:
  1. SSH to server with `SSH_PRIVATE_KEY` secret
  2. `cd /opt/aparts-looker && git pull origin main`
  3. `docker compose up -d --build`

**Secrets Required in GitHub:**
- `SSH_PRIVATE_KEY` - Deploy key for SSH access to production VPS

## Environment Configuration

**Required env vars:**

| Variable | Purpose | Example |
|----------|---------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | `123456:ABCDEfgh...` |
| `TELEGRAM_CHAT_ID` | Telegram chat/user ID to send notifications to | `987654321` |
| `GMAIL_ADDRESS` | Gmail account email | `daniel@gmail.com` |
| `GMAIL_APP_PASSWORD` | Gmail App Password (16 chars, not main password) | `abcd efgh ijkl mnop` |
| `ANTHROPIC_API_KEY` | Claude API key from console.anthropic.com | `sk-ant-...` |
| `ANTHROPIC_MODEL` | Claude model identifier | `claude-haiku-4-5-20251001` |
| `KV_SEARCH_URL` | kv.ee search URL with filters applied | `https://www.kv.ee/...?paramshere` |
| `DATA_DIR` | Directory for persistent JSON files | `/app/data` |
| `DRAFT_SCORE_THRESHOLD` | Minimum Claude score to trigger email draft | `60` |
| `MIN_IMAGES` | Minimum listing images required | `5` |
| `MIN_ROOMS` | Minimum rooms to consider | `2` |
| `MAX_PRICE_EUR` | Maximum price ceiling | `260000` |
| `CHECK_INTERVAL_HOURS` | Background job check frequency | `2` |

**Secrets location:**
- `.env` file (Docker Compose loads via `env_file: .env`)
- GitHub Actions secrets (for deploy workflow)
- `.env` is `.gitignore`'d and never committed

## Webhooks & Callbacks

**Incoming:**
- `/api/check-now` - Endpoint to manually trigger kv.ee check (POST, no auth required)

**Outgoing:**
- Telegram notifications sent to configured chat via Telegram Bot API (one-way pushes, no webhooks)
- Email drafts created in Gmail draft folder via IMAP APPEND (no callbacks)
- Emails sent via SMTP on-demand when user sends `/send <id>` command (no webhooks)

## Integration Flow (Happy Path)

```
1. Scheduler runs every CHECK_INTERVAL_HOURS
   └─> agent_job.run_check() starts

2. Fetch kv.ee listings
   ├─> kv_alert_reader.fetch_listing_urls()
   │   ├─> Playwright browser hits KV_SEARCH_URL (bypasses Cloudflare)
   │   └─> Harvest Cloudflare cookies, parse HTML for listing URLs
   └─> kv_listing_parser.fetch_listing(url) for each new URL
       └─> HTTP GET individual listing page (reuses CF cookies)

3. Filter listings (price, rooms, images)
   └─> Skip if doesn't meet MIN_IMAGES, MIN_ROOMS, MAX_PRICE_EUR

4. AI evaluation via Claude API
   └─> ai_evaluator.evaluate_listing(listing)
       ├─> POST to https://api.anthropic.com/v1/messages
       ├─> Parse JSON response with score/verdict/strengths/concerns
       └─> If score >= DRAFT_SCORE_THRESHOLD, prepare email draft

5. Store result
   └─> data_store.add_property_if_new(property)

6. If email draft prepared
   └─> gmail_client.create_draft(agent_email, subject, body)
       └─> IMAP APPEND to [Gmail]/Drafts folder

7. Notify user
   ├─> telegram_client.send_photo(listing_image, card_text)
   │   └─> POST https://api.telegram.org/bot{TOKEN}/sendPhoto
   └─> Include score, verdict, strengths, concerns, email status

8. User receives Telegram notification
   └─> If email draft: can reply "/send <id>" to trigger send_email()
       └─> SMTP send via smtp.gmail.com:465
```

---

*Integration audit: 2026-07-07*
