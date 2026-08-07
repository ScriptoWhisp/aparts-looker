# Apartment Server — everything in one place

One server, one process, one data file. The web dossier and the background
agent that monitors kv.ee both read and write the same `data/` folder —
no manual sync, no separate storage artefacts.

What's inside:
- **FastAPI backend** (`app/main.py`) — serves the page and a small JSON API
  (`GET/PUT /api/data`).
- **Background scheduler** (APScheduler, inside the same process) — every
  `CHECK_INTERVAL_HOURS` hours it checks kv.ee, sends to Telegram, prepares
  Gmail drafts, and appends any new listings directly to the shared data file
  that the frontend reads.
- **Caddy** — HTTPS + basic auth in front of everything, so your finances and
  correspondence aren't sitting on the internet in plain text.

## 1. Server setup

Any VPS with Docker and Docker Compose (Hetzner, DigitalOcean, Contabo —
doesn't matter, grab the cheapest, nothing heavy is needed here). On a fresh
Ubuntu 22.04/24.04:

```bash
curl -fsSL https://get.docker.com | sh
```

(installs both Docker and the Compose plugin)

## 2. Domain (recommended) or bare IP

**With a domain** (simpler and cleaner): point an A record for your domain or
subdomain at the server's IP. You can get a domain for next to nothing on
Namecheap/Porkbun etc., or use a free subdomain (DuckDNS and similar).

**Without a domain**: in `Caddyfile` replace the domain block with:
```
:443 {
	tls internal
	basicauth { daniel <hash> }
	reverse_proxy app:8000
}
```
The browser will complain about a self-signed certificate (click "proceed
anyway") — encryption still works, just not through a publicly trusted CA.

## 3. Copy files to the server

Clone the repo on the server (recommended):
```bash
git clone git@github.com:ScriptoWhisp/aparts-looker.git /opt/aparts-looker
```
Or copy with `scp -r`. Keep the repo private if you ever commit secrets.

## 4. Configure secrets

```bash
cp .env.example .env
nano .env
```

Fill in:
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — create a bot via @BotFather
  (`/newbot`), then open `https://api.telegram.org/bot<TOKEN>/getUpdates`
  after sending the bot a message to find your `chat.id`.
- `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` — enable 2FA on Gmail
  (myaccount.google.com/security), then create an App Password
  (myaccount.google.com/apppasswords).
- `ANTHROPIC_API_KEY` — from console.anthropic.com, add a couple of dollars
  of credit (Haiku is very cheap per call).

## 5. Set the site password

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your_password_here'
```

Paste the hash into `Caddyfile` in place of `<PASTE_HASH_HERE>`, and update
the domain (or use the no-domain variant from step 2).

## 6. Start

```bash
docker compose up -d --build
```

Open `https://your-domain` — you'll see the dossier with the pre-loaded
listings. Login: `daniel`, password: whatever you set in step 5.

## 7. kv.ee e-agent

On kv.ee set up your search filter and click "Telli e-agent" — alert emails
with new listings will be sent to the same Gmail address the agent reads via
IMAP.

## 8. Verify everything works

- Click "Check kv.ee now" in the UI — a Telegram message should arrive within
  a minute (if anything matching was found).
- `docker compose logs -f app` — watch live output.

## The `/send <id>` Telegram command

When the agent sends a listing with a prepared email to the agent, reply
`/send <id>` — on the next check (or after "Check now") the email will be
sent via Gmail.

## Backups

All data lives in the `apartment_data` Docker volume (`app_data.json` and
`agent_state.json`). Back up with:

```bash
docker compose exec app tar -czf - -C /app/data . > backup-$(date +%F).tar.gz
```

## Updating the code

```bash
git pull
docker compose up -d --build
```

The `data/` volume is untouched — only the code is updated.

## Cost

- Cheapest VPS: €3–5/month (Hetzner CX22, Contabo VPS S, etc.)
- Domain: ~€10/year, or a free subdomain
- Anthropic API (Haiku): fractions of a cent per listing, so 1€ per 100 listings
- Telegram, Gmail: free
