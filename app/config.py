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

KV_ALERT_SENDER = os.environ.get("KV_ALERT_SENDER", "noreply@kv.ee")

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
Покупатель: Daniel, 22 года, инженер-программист в Bolt (Таллинн), стабильный доход,
топ-перформер на работе.

Финансы:
- Накопления: ~30 000 EUR
- Чистый доход в месяц: ~4 100 EUR
- Порог DTI (debt-to-income), который отслеживается: 40%
- Бюджет на ремонт своими руками: ~40 000 EUR - готов покупать неремонтированные
  квартиры и делать косметику сам.

Что важно при первичной (desk-review) оценке объявления:
1. Цена за м² - конкурентно ли для района и состояния (<2500 EUR/m² отлично,
   2500-3000 хорошо, 3000-3500 нормально, >3500 нужно обосновывать премию)
2. Обязательные доп. расходы (паркинг/кладовка "mandatory") реально увеличивают
   цену входа - считай это в оценке
3. Год постройки и материал - панельки 1960-80х это нормально если КТ в порядке
4. "Vajab renoveerimist" - это ХОРОШО для Daniel (пространство для торга + DIY),
   если структурно объект в порядке
5. Планировка/легализация перепланировки, если упоминается
6. Соответствие типичным целевым 3-4 комнатам, 50-80 m²
7. Бесплатная парковка - плюс; платная или отсутствующая - минус

ВАЖНО: это только desk-review по тексту объявления, не полная 11-категорийная
чек-лист оценка (та требует физического просмотра).
"""
