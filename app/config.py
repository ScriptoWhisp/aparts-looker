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

KV_SEARCH_URL = os.environ.get("KV_SEARCH_URL", "")

IMAP_HOST = "imap.gmail.com"
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465

DRAFT_SCORE_THRESHOLD = int(os.environ.get("DRAFT_SCORE_THRESHOLD", "60"))
MIN_ROOMS = int(os.environ.get("MIN_ROOMS", "2"))
MAX_PRICE_EUR = int(os.environ.get("MAX_PRICE_EUR", "260000"))

CHECK_INTERVAL_HOURS = float(os.environ.get("CHECK_INTERVAL_HOURS", "2"))

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
APP_DATA_FILE = os.path.join(DATA_DIR, "app_data.json")
AGENT_STATE_FILE = os.path.join(DATA_DIR, "agent_state.json")

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
