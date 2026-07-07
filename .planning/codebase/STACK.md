# Technology Stack

**Analysis Date:** 2026-07-07

## Languages

**Primary:**
- Python 3.12 - Server-side application, agent job, data processing, and scraping

**Secondary:**
- HTML/CSS/JavaScript - Static frontend dossier UI (served via FastAPI StaticFiles)

## Runtime

**Environment:**
- Python 3.12 (slim Docker image)
- Docker containerization with `docker-compose` orchestration

**Package Manager:**
- pip (Python package manager)
- Lockfile: `app/requirements.txt` (pinned versions)

## Frameworks

**Core:**
- FastAPI 0.111.0+ - Lightweight async web server for JSON API and static frontend serving
- uvicorn[standard] 0.30.0+ - ASGI server running FastAPI with live reload support

**Task Scheduling:**
- APScheduler 3.10.4+ - Background job scheduler for periodic kv.ee listing checks (interval-based)

**Web Scraping & HTTP:**
- Playwright 1.44.0+ - Headless Chromium browser to bypass Cloudflare challenge on kv.ee search pages
- requests 2.31.0+ - HTTP client for individual listing fetches, API calls to Anthropic and Telegram
- BeautifulSoup4 4.12.0+ - HTML parsing for kv.ee listing detail pages
- lxml 5.0.0+ - Fast XML/HTML parsing backend for BeautifulSoup

**Email:**
- Python standard library `imaplib` - IMAP4 SSL for Gmail Draft folder access
- Python standard library `smtplib` - SMTP for sending emails via Gmail App Password
- Python standard library `email.mime` - Email message construction

## Key Dependencies

**Critical:**
- `fastapi` - Core web framework for serving dossier API and frontend
- `playwright` - Required for Cloudflare bypass on kv.ee search; used once per check interval to harvest cookies
- `requests` - HTTP library for all external API calls (Anthropic Claude, Telegram Bot, kv.ee individual listings)

**Infrastructure:**
- `uvicorn[standard]` - Production ASGI server with uvloop for performance
- `apscheduler` - Enables in-process background job scheduling without external cron/queue services
- `beautifulsoup4` + `lxml` - Parsing kv.ee listing HTML using regex-first extraction for robustness

## Configuration

**Environment:**
- `.env` file (not committed) loaded by `docker-compose.yml`
- All secrets via environment variables: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, `ANTHROPIC_API_KEY`, `KV_SEARCH_URL`
- Threshold and filtering settings: `DRAFT_SCORE_THRESHOLD`, `MIN_IMAGES`, `MIN_ROOMS`, `MAX_PRICE_EUR`, `CHECK_INTERVAL_HOURS`

**Build:**
- `app/Dockerfile` - Single-stage Python 3.12 slim image with Playwright Chromium binary installation
- `docker-compose.yml` - Two-service stack: app (FastAPI) + Caddy (reverse proxy)

## Platform Requirements

**Development:**
- Python 3.12
- Docker + Docker Compose
- Playwright Chromium binary (installed automatically in Docker)

**Production:**
- Docker host with docker-compose
- IP: `46.62.152.9` (deployed via SSH + git pull)
- HTTPS via Caddy with automatic certificate management
- Volume mount for persistent data: `/app/data` (apartment_data volume in docker-compose)

## External API Integration Points

**Anthropic Claude:**
- HTTP POST to `https://api.anthropic.com/v1/messages`
- Model: Configurable (default: `claude-haiku-4-5-20251001`)
- Authentication: Bearer token via `ANTHROPIC_API_KEY` header

**Telegram Bot API:**
- Polling `https://api.telegram.org/bot{TOKEN}/getUpdates`
- Sending messages via `https://api.telegram.org/bot{TOKEN}/sendMessage` and `/sendPhoto`
- Authentication: Bot token in URL path

**Gmail (IMAP/SMTP):**
- IMAP4_SSL to `imap.gmail.com` for draft creation
- SMTP_SSL to `smtp.gmail.com:465` for email sending
- Authentication: Gmail account + App Password (requires 2-Step Verification enabled)

**kv.ee (Real Estate Portal):**
- Playwright-driven headless browser to bypass Cloudflare on search: `KV_SEARCH_URL`
- Cloudflare cookies harvested and reused in `requests.Session` for subsequent listing fetches
- HTTP requests with Chrome user-agent spoofing to individual listing pages

## Reverse Proxy & Web Server

**Caddy 2-alpine:**
- Runs in separate container, proxies traffic to app:8000
- Handles TLS termination (auto HTTPS via Let's Encrypt)
- Basic auth configured for dossier frontend access
- Exposes ports 80 (HTTP) and 443 (HTTPS)

---

*Stack analysis: 2026-07-07*
