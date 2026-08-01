"""
Generate the Russian-language negotiation brief for a listing that just entered
'viewing_scheduled' state. Fed with authoritative numbers the model MUST cite
verbatim rather than compute new ones (D-05, 06-RESEARCH.md § Code Examples).

Output shape (structured JSON so numbers can be rendered separately):
  {
    "brief_ru": str,           # 4-8 sentence single paragraph in Russian
    "suggested_offer_low_eur": int,
    "suggested_offer_high_eur": int,
  }

Phase 7 Wave 4 rewrite (DB-08):
  generate_and_save_brief now uses SQLAlchemy session-scope discipline instead
  of data_store._lock. The three-step pattern (RESEARCH § Pitfall 2):
    1. Open session → snapshot fields → CLOSE session (connection returned to pool).
    2. Call generate_negotiation_brief() OUTSIDE any session (Anthropic HTTP, 2-5s).
    3. Reopen session → save brief → commit → close session.
  data_store._lock wrappers are removed; Postgres provides per-row atomicity.

Pitfall 4: _validate_no_hallucinated_numbers post-hoc check flags any 4-6
digit number in brief_ru not present in the authoritative input facts. Sets
needs_review=True on the result so the frontend shows a warning badge.
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

import requests

import config
from db import SessionLocal
from models import Listing

log = logging.getLogger("brief_generator")

API_URL = "https://api.anthropic.com/v1/messages"

SYSTEM_PROMPT = """Ты помогаешь Даниилу подготовиться к просмотру квартиры в Таллине
и вести переговоры о цене.

СТРОГИЕ ПРАВИЛА:
1. Верни СТРОГО валидный JSON. Никакого markdown, никаких ``` ограждений, никакого
   текста до или после JSON.
2. Используй ТОЛЬКО те числа, которые я предоставлю в блоке "AUTHORITATIVE FACTS".
   Не вычисляй новые числа. Не округляй. Не оценивай на глаз.
3. Один абзац на русском. 4-8 предложений. Плотный, деловой, без воды.
4. Заверши абзац диапазоном стартового предложения (в EUR), обоснованным на реальных
   рычагах: цена ниже/выше средней по району, days-on-market, история снижений,
   выявленные слабости.
5. Диапазон стартового предложения также верни отдельно как suggested_offer_low_eur
   и suggested_offer_high_eur (целые числа EUR).

Схема ответа:
{
  "brief_ru": "<абзац на русском, 4-8 предложений>",
  "suggested_offer_low_eur": <int>,
  "suggested_offer_high_eur": <int>
}
"""


def _extract_json(text: str) -> dict:
    """Pull the first complete JSON object out of Claude's response.

    Reuses ai_evaluator._extract_json logic: strips markdown fences, finds the
    first '{', uses raw_decode to ignore trailing prose. Falls back to a greedy
    re.search on the full text if raw_decode fails (Pitfall 3 — Russian text may
    include a stray leading wrapper).
    """
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # Find the first '{' — Claude might emit a short intro before the JSON.
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object found in AI response")
    try:
        obj, _end = json.JSONDecoder().raw_decode(text[start:])
        return obj
    except json.JSONDecodeError:
        # Fallback: greedy match on first {...} block (Pitfall 3)
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise


def _validate_no_hallucinated_numbers(brief: str, authoritative_facts: str) -> bool:
    """Return True if every 4-6 digit number in brief appears in the input facts text.

    Pitfall 4: LLMs interpolate plausible numbers in prose. This post-hoc check
    extracts every 4-6 digit sequence from brief_ru and verifies each one also
    appears verbatim in the authoritative facts block the model was fed.

    The authoritative set is derived from the raw facts text (not a curated dict)
    so year_built, ISO-date year components, and all price/price_per_sqm/district
    numbers are covered without having to enumerate them by field. Prevents the
    'year 1970 always flags needs_review' cry-wolf noted by cross-AI review.
    """
    authoritative_numbers = set(re.findall(r"\d{4,6}", authoritative_facts))
    for m in re.finditer(r"(\d{4,6})", brief):
        if m.group(1) not in authoritative_numbers:
            return False
    return True


def _days_between(start_iso: str, end_iso: str) -> int:
    """Return number of days between two ISO date strings (YYYY-MM-DD). Returns 0 on error."""
    from datetime import date
    try:
        d1 = date.fromisoformat(start_iso)
        d2 = date.fromisoformat(end_iso)
        return (d2 - d1).days
    except (ValueError, TypeError):
        return 0


def generate_negotiation_brief(
    entry: dict,
    price_history: list,
    district_avg_price_per_sqm: Optional[int],
    coo_monthly_eur: Optional[int],
) -> dict:
    """Produce a Russian negotiation brief + suggested offer range for a listing.

    Pure function — no data_store dependency. Designed to be called OUTSIDE any
    data_store._lock context (Pitfall 5). Can be called from tests with mocked
    requests.post.

    Args:
        entry:                      properties[] dict with price, area, rooms, score, verdict, ...
        price_history:              [{date, price}, ...] timeline, oldest first
        district_avg_price_per_sqm: from price-intelligence district calc; None if unknown
        coo_monthly_eur:            cost-of-ownership estimate; None if unknown

    Returns:
        {"brief_ru": str, "suggested_offer_low_eur": int, "suggested_offer_high_eur": int}
        On any failure returns fallback with brief_ru="" and error key (never raises).
    """
    if not config.ANTHROPIC_API_KEY:
        return {
            "brief_ru": "",
            "suggested_offer_low_eur": 0,
            "suggested_offer_high_eur": 0,
            "error": "ANTHROPIC_API_KEY not set",
        }

    # Build authoritative facts table (Pitfall 4 — feed concrete numbers model MUST cite)
    facts_lines = [
        f"Название/адрес: {entry.get('name', entry.get('title', ''))}",
        f"Цена сегодня: {entry.get('price', entry.get('price_eur', 0))} EUR",
        f"Площадь: {entry.get('area', entry.get('area_sqm', 0))} м²",
        f"Количество комнат: {entry.get('rooms', 0)}",
        f"Цена за м²: {entry.get('pricePerSqm', entry.get('price_per_sqm', 0))} EUR/м²",
        f"Год постройки: {entry.get('year', entry.get('year_built', '?'))}",
        f"Материал: {entry.get('material', '?')}",
        f"AI-оценка: {entry.get('score', 0)}/100",
        f"AI-вердикт: {entry.get('verdict', '')}",
    ]
    if district_avg_price_per_sqm:
        facts_lines.append(
            f"Средняя цена м² по району ({entry.get('district', '?')}): "
            f"{district_avg_price_per_sqm} EUR/м²"
        )
    if coo_monthly_eur:
        facts_lines.append(f"Ежемесячная стоимость владения (оценка): {coo_monthly_eur} EUR")
    if price_history and len(price_history) >= 2:
        first = price_history[0]
        last = price_history[-1]
        days = _days_between(str(first.get("date", "")), str(last.get("date", "")))
        first_price = first.get("price", 0)
        last_price = last.get("price", 0)
        pct = round((first_price - last_price) / first_price * 100, 1) if first_price else 0
        facts_lines.append(
            f"История цены: {first_price} EUR ({first.get('date', '')}) → "
            f"{last_price} EUR ({last.get('date', '')}), "
            f"{'снижение' if pct > 0 else 'повышение'} на {abs(pct)}% за {days} дней"
        )
        facts_lines.append(f"Дней на рынке: {days}")

    facts_block = "AUTHORITATIVE FACTS (используй только эти числа):\n" + "\n".join(
        f"- {line}" for line in facts_lines
    )

    user_content = (
        facts_block
        + "\n\nСоставь абзац для подготовки к просмотру и переговоров."
    )

    try:
        resp = requests.post(
            API_URL,
            headers={
                "x-api-key": config.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": config.ANTHROPIC_MODEL,
                "max_tokens": 1200,  # ~4-8 sentences Russian + JSON overhead
                "temperature": 0.3,  # low: prose that grounds on given numbers
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_content}],
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        text_blocks = [b["text"] for b in data.get("content", []) if b.get("type") == "text"]
        raw_text = "\n".join(text_blocks)
        result = _extract_json(raw_text)
        result.setdefault("brief_ru", "")
        result.setdefault("suggested_offer_low_eur", 0)
        result.setdefault("suggested_offer_high_eur", 0)
        # Post-hoc number grounding (Pitfall 4) — every 4-6 digit number in the
        # brief must also appear in the facts block the model saw.
        if result["brief_ru"] and not _validate_no_hallucinated_numbers(
            result["brief_ru"], facts_block
        ):
            result["needs_review"] = True
            log.warning(
                "Brief for listing %s contains numbers not in input facts — flagging for review",
                entry.get("id", "?"),
            )
        return result
    except (requests.RequestException, json.JSONDecodeError, KeyError, ValueError):
        log.exception("Negotiation brief generation failed for listing %s", entry.get("id", "?"))
        return {
            "brief_ru": "",
            "suggested_offer_low_eur": 0,
            "suggested_offer_high_eur": 0,
            "error": "AI call failed — retry via Regenerate button.",
        }


def generate_and_save_brief(listing_id: str) -> None:
    """Daemon-thread target: generate a negotiation brief and persist it.

    Phase 7 Wave 4 (DB-08) — session-scope discipline (RESEARCH § Pitfall 2):
      1. Open session → load Listing row → snapshot to plain dict → CLOSE session.
         (DB connection returned to pool before any HTTP call.)
      2. Call generate_negotiation_brief() OUTSIDE any session (Anthropic HTTP, 2-5s).
      3. Reopen session → set row.negotiation_brief → commit → close session.

    data_store._lock wrappers removed: Postgres per-row atomicity replaces the
    no-op nullcontext shim that Wave 2 left in place (Wave 4 removes the semantics).

    Never raises — any exception is logged and the thread exits silently.
    The entry remains unchanged if generation fails (error brief stored instead).
    """
    try:
        # Step 1: session-scoped snapshot (session released when 'with' block exits)
        with SessionLocal() as db_:
            row = db_.get(Listing, listing_id)
            if row is None:
                log.warning("generate_and_save_brief: listing %s not found", listing_id)
                return
            # Snapshot all fields needed for the prompt — plain dict, no ORM refs.
            # After the 'with' block the session is closed and the connection is
            # returned to the pool BEFORE the Anthropic HTTP call starts.
            snapshot = {
                "id": row.id,
                "url": row.url,
                # Legacy aliases so facts_lines in generate_negotiation_brief picks up values
                "name": row.name or row.title or "",
                "title": row.title or "",
                "price": row.price_eur,
                "price_eur": row.price_eur,
                "pricePerSqm": row.price_per_sqm,
                "price_per_sqm": row.price_per_sqm,
                "area": row.area_sqm,
                "area_sqm": row.area_sqm,
                "rooms": row.rooms,
                "year": row.year_built,
                "year_built": row.year_built,
                "material": row.material,
                "score": row.score,
                "verdict": row.verdict,
                "district": row.district or "",
                "cost_of_ownership": row.cost_of_ownership or {},
            }
            price_history = list(row.price_history or [])
            # Compute district avg €/m² via a peer query — scoped to THIS session,
            # no HTTP inside. Excludes the listing itself so the comparison is against
            # peer listings (mirrors ingest_handler._build_context_prefix, D-04/D-05).
            district = snapshot.get("district") or ""
            if district:
                peers = db_.query(Listing).filter(
                    Listing.district == district,
                    Listing.id != listing_id,
                    Listing.price_per_sqm.isnot(None),
                ).all()
                district_avg = (
                    round(sum(p.price_per_sqm for p in peers) / len(peers))
                    if peers else None
                )
            else:
                district_avg = None
        # Session closed here — connection returned to pool before HTTP call.

        coo_monthly_eur = None
        coo = snapshot.get("cost_of_ownership")
        if isinstance(coo, dict):
            coo_monthly_eur = coo.get("monthly_total_eur")

        # Step 2: HTTP call OUTSIDE any DB session (DB-08 — Pitfall 2 pattern)
        brief = generate_negotiation_brief(snapshot, price_history, district_avg, coo_monthly_eur)

        # Step 3: reopen session and save
        with SessionLocal() as db_:
            row = db_.get(Listing, listing_id)
            if row is not None:
                row.negotiation_brief = brief
                row.negotiation_brief_generated_at = datetime.now(timezone.utc).isoformat()
                db_.commit()

        log.info(
            "Brief generated for listing %s (needs_review=%s)",
            listing_id,
            brief.get("needs_review", False),
        )
    except Exception:
        log.exception("generate_and_save_brief: unexpected error for listing %s", listing_id)
