"""
Sends a listing's scraped data to Claude for desk-review scoring against
Daniel's actual buying criteria (config.BUYER_PROFILE), and - if the score
clears the threshold - a drafted outreach email to the agent.

Uses the plain Anthropic Messages API (api.anthropic.com) with your own
ANTHROPIC_API_KEY. This is a personal automation script, unrelated to
claude.ai - you need your own API key from console.anthropic.com and a
small amount of prepaid credit. At Haiku pricing this evaluates each new
listing for a fraction of a cent.
"""

import json
import re

import requests

from config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL, BUYER_PROFILE
from kv_listing_parser import Listing

API_URL = "https://api.anthropic.com/v1/messages"

SYSTEM_PROMPT = f"""Ты помогаешь Daniel оценивать объявления о продаже квартир в
Таллинне (kv.ee) по методике его текущего поиска. Вот его профиль и критерии:

{BUYER_PROFILE}

Тебе дают данные одного объявления. Верни СТРОГО валидный JSON (без markdown-
разметки, без ```), со следующими полями:

{{
  "score": <int 0-100>,
  "verdict": "<одно предложение на русском - главный вывод>",
  "strengths": ["<кратко>", ...],
  "concerns": ["<кратко>", ...],
  "should_draft_email": <bool - true если объект достаточно интересен, чтобы стоило писать маклеру>,
  "draft_subject": "<subject на английском, если should_draft_email=true, иначе пустая строка>",
  "draft_body": "<текст письма маклеру на английском, вежливый, короткий, с вопросами о состоянии, remondifond, обязательных доп.расходах (паркинг), готовности к просмотру - если should_draft_email=true, иначе пустая строка>"
}}
"""


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def evaluate_listing(listing: Listing) -> dict:
    """Returns a dict with score/verdict/strengths/concerns/draft fields.
    On any failure, returns a safe fallback dict with score=0 so the
    listing still gets a (minimal) Telegram notification rather than
    silently vanishing."""

    listing_summary = f"""
Адрес/заголовок: {listing.title}
URL: {listing.url}
Цена: {listing.price_eur} EUR ({listing.price_per_sqm} EUR/m2)
Комнат: {listing.rooms}
Площадь: {listing.area_sqm} m2
Год постройки: {listing.year_built}
Материал: {listing.material}
Состояние (заявлено): {listing.condition}
Этаж: {listing.floor}/{listing.floor_total}
Парковка: {listing.parking}
Признаки "нужен ремонт" в тексте: {listing.needs_renovation}
Описание: {listing.description[:1500]}
"""

    if not ANTHROPIC_API_KEY:
        return {
            "score": 0,
            "verdict": "ANTHROPIC_API_KEY не настроен - оценка недоступна.",
            "strengths": [],
            "concerns": [],
            "should_draft_email": False,
            "draft_subject": "",
            "draft_body": "",
        }

    try:
        resp = requests.post(
            API_URL,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 1000,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": listing_summary}],
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        text_blocks = [b["text"] for b in data.get("content", []) if b.get("type") == "text"]
        raw_text = "\n".join(text_blocks)
        result = _extract_json(raw_text)

        result.setdefault("score", 0)
        result.setdefault("verdict", "")
        result.setdefault("strengths", [])
        result.setdefault("concerns", [])
        result.setdefault("should_draft_email", False)
        result.setdefault("draft_subject", "")
        result.setdefault("draft_body", "")
        return result

    except (requests.RequestException, json.JSONDecodeError, KeyError, ValueError):
        return {
            "score": 0,
            "verdict": "Не удалось получить оценку от AI (ошибка API) - проверь листинг вручную.",
            "strengths": [],
            "concerns": [],
            "should_draft_email": False,
            "draft_subject": "",
            "draft_body": "",
        }
