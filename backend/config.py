"""
Config for the self-hosted apartment agent + dossier server.
All secrets come from environment variables (set via .env / docker-compose).
"""

import os

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

GMAIL_ADDRESS = os.environ.get("GMAIL_ADDRESS", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
# Cap on Claude response tokens. Bumped from the historical 4000 because the
# Russian-language expanded schema plus checklist_fills was truncating on
# listings with long descriptions, causing JSON parse failures and blank
# verdicts. Editable via Settings so we can tune without a restart.
AI_MAX_TOKENS = int(os.environ.get("AI_MAX_TOKENS", "6000"))
# How much of the listing's free-text description we hand to the model.
# Longer = more context but more input tokens. 1500 was safe but often clipped
# the interesting parts of Russian-language kv.ee ads.
AI_DESCRIPTION_MAX_CHARS = int(os.environ.get("AI_DESCRIPTION_MAX_CHARS", "3000"))
ORS_API_KEY = os.environ.get("ORS_API_KEY", "")

KV_SEARCH_URL = os.environ.get("KV_SEARCH_URL", "")

IMAP_HOST = "imap.gmail.com"
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
BOLT_HQ_LAT = 59.4203  # Veerenni 28, Tallinn (Bolt HQ) — Leaflet [lat, lng] order
BOLT_HQ_LNG = 24.7205  # ORS/GeoJSON uses [lng, lat] order — see RESEARCH Pitfall 2

DRAFT_SCORE_THRESHOLD = int(os.environ.get("DRAFT_SCORE_THRESHOLD", "60"))
# MIN_IMAGES / MIN_ROOMS / MAX_PRICE_EUR were removed 2026-08-02. Filters now
# live only on the scraper (single source of truth) — see scraper-client/.env
# and the scraper's UI. Backend trusts what the scraper sends.

# Telegram tiered delivery thresholds.
#   >= PHOTO: full card with photo + inline keyboard (highest signal listings)
#   >= TEXT:  compact one-line text notification (worth a glance)
#   below both: silent — still in the dashboard, not in Telegram
# High-severity risks flagged by the AI suppress delivery regardless of score.
TELEGRAM_MIN_SCORE_PHOTO = int(os.environ.get("TELEGRAM_MIN_SCORE_PHOTO", "80"))
TELEGRAM_MIN_SCORE_TEXT = int(os.environ.get("TELEGRAM_MIN_SCORE_TEXT", "65"))

# ---- Cost-of-ownership assumptions ----
# Defaults tuned for Tallinn 2025-2026 market: 20% down, 4.5% Euribor+margin,
# 30-year term; KÜ fee heuristic split at 1990 (Soviet-era vs post-independence
# builds); central district heating; electricity+water baseline. All editable
# via env vars, and (planned) via a backend settings pane later.
COST_DOWN_PCT       = float(os.environ.get("COST_DOWN_PCT",       "20"))    # % of price as down payment
COST_INTEREST_PCT   = float(os.environ.get("COST_INTEREST_PCT",   "4.5"))   # annual rate (Euribor + margin)
COST_TERM_YEARS     = int  (os.environ.get("COST_TERM_YEARS",     "30"))    # loan term
COST_KU_RATE_OLD    = float(os.environ.get("COST_KU_RATE_OLD",    "2.0"))   # EUR/m²/mo, pre-1990
COST_KU_RATE_NEW    = float(os.environ.get("COST_KU_RATE_NEW",    "1.5"))   # EUR/m²/mo, 1990+
COST_HEATING_RATE   = float(os.environ.get("COST_HEATING_RATE",   "1.2"))   # EUR/m²/mo, year avg
COST_UTILITIES_BASE = float(os.environ.get("COST_UTILITIES_BASE", "60"))    # EUR/mo baseline (elec + water)

CHECK_INTERVAL_HOURS = float(os.environ.get("CHECK_INTERVAL_HOURS", "2"))
PRICE_DROP_THRESHOLD = float(os.environ.get("PRICE_DROP_THRESHOLD", "0.05"))

INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")
WEB_BASE_URL = os.environ.get("WEB_BASE_URL", "")
HEARTBEAT_TIMEOUT_HOURS = float(os.environ.get("HEARTBEAT_TIMEOUT_HOURS", "0"))

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
APP_DATA_FILE = os.path.join(DATA_DIR, "app_data.json")
AGENT_STATE_FILE = os.path.join(DATA_DIR, "agent_state.json")

# ---- Database (Phase 7) ----
# NEVER log DATABASE_URL — it contains POSTGRES_PASSWORD.
# Log POSTGRES_HOST / POSTGRES_DB / POSTGRES_USER only.
POSTGRES_USER     = os.environ.get("POSTGRES_USER", "aparts")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "")
POSTGRES_DB       = os.environ.get("POSTGRES_DB", "aparts_looker")
POSTGRES_HOST     = os.environ.get("POSTGRES_HOST", "postgres")
POSTGRES_PORT     = os.environ.get("POSTGRES_PORT", "5432")
# Accepts a full DATABASE_URL env var for explicit overrides (dev/staging).
DATABASE_URL      = os.environ.get(
    "DATABASE_URL",
    f"postgresql+psycopg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}",
)

BUYER_PROFILE = """
Buyer: Daniel, 22, software engineer at Bolt (Tallinn), stable income, top performer.

Finances:
- Savings: ~30,000 EUR
- Net monthly income: ~4,100 EUR
- DTI (debt-to-income) ceiling tracked: 40%
- DIY renovation budget: ~40,000 EUR — willing to buy unfinished apartments and do
  cosmetic work himself.

What matters in a desk-review of a listing:
1. Price per m² — is it competitive for the district and condition?
   (<2,500 EUR/m² excellent, 2,500–3,000 good, 3,000–3,500 acceptable, >3,500 needs
   a clear premium justification)
2. Mandatory extras (parking/storage marked "kohustuslik") genuinely raise the entry
   price — factor them into the score.
3. Year built and material — panel blocks from the 1960s–80s are fine if the building
   fund (KT) is healthy.
4. "Vajab renoveerimist" (needs renovation) is GOOD for Daniel: room to negotiate +
   DIY upside, as long as the structure is sound.
5. Floor plan / legalised replanning, if mentioned.
6. Matches typical target: 3–4 rooms, 50–80 m².
7. Free parking is a plus; paid or absent is a minus.

IMPORTANT: this is a desk-review from the listing text only, not a full 11-category
checklist evaluation (that requires a physical viewing).
"""
