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
import logging
import re
from typing import Optional

import requests

import checklist_registry
import config
from config import ANTHROPIC_API_KEY, BUYER_PROFILE
from kv_listing_parser import Listing

log = logging.getLogger("ai_evaluator")

API_URL = "https://api.anthropic.com/v1/messages"

# Whitelist of manual-checklist item keys the AI is allowed to auto-fill.
# Kept in sync with the prompt's checklist_fills section — anything the model
# returns outside this set is dropped defensively.
VALID_RENO_KEYS = frozenset({
    "kitchen_full", "bathroom_full", "windows", "floors",
    "rewire", "heating", "cosmetic",
})

# Wave A: sourced dynamically from checklist_registry.py (~96-item registry)
# instead of a hardcoded 13-key set. Any item with ai_fillable=True there is
# eligible — see checklist_registry.CHECKLIST_REGISTRY.
AI_FILLABLE_CHECKLIST_KEYS = checklist_registry.get_ai_fillable_keys()


def _validate_renovation_items(raw) -> list:
    """Validate and sanitise the AI-produced renovation_items array.

    - Drops any item with an unknown key.
    - Ensures applies is true/false/None (drops malformed).
    - Ensures confidence is 1/2/3 (clamps to 1 on invalid).
    - Truncates note to 60 chars.
    - Returns empty list on any structural failure — never crashes evaluate flow.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        log.warning("renovation_items is not a list: %r — treating as empty", type(raw).__name__)
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        key = item.get("key")
        if key not in VALID_RENO_KEYS:
            log.warning("renovation_items: unknown key %r — dropped", key)
            continue
        applies = item.get("applies")
        if applies not in (True, False, None):
            log.warning("renovation_items[%s].applies is %r — treated as null", key, applies)
            applies = None
        confidence = item.get("confidence")
        if confidence not in (1, 2, 3):
            confidence = 1
        qty = item.get("qty")
        if qty is not None:
            try:
                qty = float(qty)
            except (TypeError, ValueError):
                qty = None
        note = item.get("note")
        if note is not None:
            note = str(note)[:60]
        out.append({
            "key": key,
            "applies": applies,
            "confidence": confidence,
            "qty": qty,
            "note": note,
        })
    return out


def _whitelist_checklist_fills(raw: dict) -> dict:
    """Keep only allow-listed keys with non-empty string values."""
    if not isinstance(raw, dict):
        return {}
    out = {}
    for k, v in raw.items():
        if k in AI_FILLABLE_CHECKLIST_KEYS and isinstance(v, str) and v.strip():
            out[k] = v.strip()
    return out


def _build_checklist_fills_schema_block() -> str:
    """Render the checklist_fills JSON-schema lines for every ai_fillable
    registry item, in registry order. Replaces the old hardcoded 13-line block
    so the prompt always matches checklist_registry.py without manual sync."""
    lines = []
    for item in checklist_registry.get_ai_fillable_items():
        hint = f" — {item.hint}" if item.hint else ""
        lines.append(
            f'    "{item.key}": "<RUSSIAN — {item.label_ru}{hint}; empty string '
            f'if the listing text does not explicitly say>",'
        )
    return "\n".join(lines)


_CHECKLIST_FILLS_SCHEMA_BLOCK = _build_checklist_fills_schema_block()

SYSTEM_PROMPT = f"""You help Daniel evaluate apartment listings in Tallinn (kv.ee)
against his current search criteria. His profile and criteria:

{BUYER_PROFILE}

SCORING RUBRIC — use the full range, do not cluster around 70:
  0–30  : Skip entirely. Sold/reserved/incomplete listing, wrong area, way over budget,
           basement or ground floor with no upside, or data is missing/contradictory.
  31–49 : Poor fit. Serious red flags (extreme price/m², structural concerns, no parking
           in a bad location, known problematic building).
  50–64 : Below average. Passes basic filters but has notable drawbacks that make it
           an unlikely choice unless nothing better is available.
  65–74 : Average. Meets most criteria, no standout strengths or fatal flaws.
           Worth keeping an eye on but not urgent.
  75–84 : Good. Clear value — competitive price/m², good condition signals, decent
           location, parking included, or strong renovation upside. Should view soon.
  85–94 : Very good. Multiple strong signals — low price/m², great location, included
           parking + storage, healthy building, good floor. Prioritise viewing.
  95–100: Exceptional. Rare combination of price, location, condition, and extras.
           Contact agent immediately.

OUTPUT LANGUAGE — critical:
  All natural-language field values (verdict, score_breakdown[*].reason,
  risks[*].text, risks[*].mitigation, strengths[*], checklist_fills[*],
  draft_subject, draft_body) MUST be written in RUSSIAN.
  Field NAMES stay in English (they are keys). Verdict openers stay in English
  ("Worth viewing IF", "Skip because", "Prioritise —") so downstream code can
  parse them, but the rest of the sentence continues in Russian.
  Enum values stay English: severity (low/medium/high), category (financial/legal/
  physical/location/data). Numbers are numbers.

Return STRICTLY valid JSON (no markdown, no ``` fences), with this exact shape:

{{
  "score": <int 0-100 — MUST equal the sum of score_breakdown[*].points>,
  "verdict": "<one sentence — MUST start with 'Worth viewing IF …', 'Skip because …', or 'Prioritise — …' followed by a specific condition, IN RUSSIAN after the opener>",
  "score_breakdown": {{
    "location":    {{"points": <int 0-25>, "max": 25, "reason": "<RUSSIAN — cite specific district, commute minutes, or noise/transit fact>"}},
    "price_value": {{"points": <int 0-25>, "max": 25, "reason": "<RUSSIAN — MUST cite €/m² number and compare to district avg or anchor listing>"}},
    "condition":   {{"points": <int 0-20>, "max": 20, "reason": "<RUSSIAN — MUST cite year built, renovation year, or specific system update>"}},
    "layout":      {{"points": <int 0-15>, "max": 15, "reason": "<RUSSIAN — MUST cite room count and m² and comment on ratio>"}},
    "extras":      {{"points": <int 0-15>, "max": 15, "reason": "<RUSSIAN — MUST cite parking / storage / balcony status and any mandatory add-on cost>"}}
  }},
  "risks": [
    {{
      "severity": "low" | "medium" | "high",
      "category": "financial" | "legal" | "physical" | "location" | "data",
      "text": "<RUSSIAN — specific to THIS listing, cite exact numbers or phrases>",
      "mitigation": "<RUSSIAN — what would offset it — or null if none>"
    }}
    // 0-5 items, ranked severity descending
  ],
  "strengths": ["<RUSSIAN — specific to THIS property>", ...],
  "checklist_fills": {{
    // Auto-fill values for specific manual checklist items when the listing text
    // EXPLICITLY provides the answer. Return an empty string for items where the
    // listing does NOT clearly say. Do NOT infer, guess, or invent facts.
    // Keys must be from this exact allow-list (from checklist_registry.py):
{_CHECKLIST_FILLS_SCHEMA_BLOCK}
  }},
  "should_draft_email": <bool — true if score >= 65 and no high-severity blockers>,
  "draft_subject": "<RUSSIAN — email subject if should_draft_email=true, else empty string>",
  "draft_body": "<RUSSIAN — polite email body asking about condition, remondifond, mandatory extras, viewing availability — if should_draft_email=true, else empty string>",
  "renovation_items": [
    // One entry per renovation line-item that is relevant to this listing.
    // Omit items you cannot form any opinion about — prefer a short list over guessing.
    {{
      "key": "<one of: kitchen_full | bathroom_full | windows | floors | rewire | heating | cosmetic>",
      "applies": true | false | null,
      "confidence": 1 | 2 | 3,
      "qty": <number or null>,
      "note": "<short RU/EE string ≤60 chars explaining evidence, or null>"
    }}
    // applies: true = definitely needs this work; false = confirmed NOT needed
    //          (e.g. renovated 2020, mentioned in listing); null = unknown / can't tell.
    // confidence: 1 = guess (age/context only), 2 = photo/text signal, 3 = explicit mention.
    // qty: only for per-unit or per-m² items where you can estimate count/area.
    //      Use null otherwise (client falls back to 1 for flat-rate items, area_sqm for per-m²).
    // CRITICAL: NEVER invent a euro figure. Only classify applies/qty.
    //           Client-side code multiplies qty × rate from user settings.
    // key MUST be exactly one of the 7 keys listed above — no variations.
  ]
}}

HARD RULES — non-negotiable:

1. Every 'reason' field MUST cite at least one concrete number or fact from the listing
   (€/m², year, area, floor, district, commute min). Reasons without a number are rejected.

2. BANNED PHRASES in any reason, verdict, risk.text, or strengths — they are meaningless:
   Russian equivalents to avoid: "выгодная цена", "хороший вариант", "престижный район",
   "отличное соотношение", "перспективный объект", "современные удобства".

3. Every risk.text MUST reference this specific property. Bad: "верхний этаж — риск
   протечек крыши". Good: "5-й этаж из 5, год ремонта крыши в описании не указан,
   дом 1966 г. — требует проверки".

4. Verdict MUST use one of these three openers (English) followed by a specific
   condition (Russian):
   - "Worth viewing IF <specific condition>" — e.g. "Worth viewing IF цена снизится до 200k€"
   - "Skip because <specific dealbreaker>" — e.g. "Skip because 4200 €/м² на 40% выше медианы Kesklinn"
   - "Prioritise — <specific standout>" — e.g. "Prioritise — 2400 €/м² в Kesklinn с паркингом — редкость"

5. score_breakdown.points MUST sum EXACTLY to score. Category maxes are fixed:
   25 + 25 + 20 + 15 + 15 = 100. Do not change them.

6. If data for a category is missing, cap that category at 50% of max and put
   'DATA GAP: <what is missing>' (in Russian) at the start of the reason.

7. Return maximum 5 risks, minimum 0. Rank by severity descending. If a risk has
   no obvious mitigation, use null (not the string 'None' or 'нет').

8. Return maximum 4 strengths, minimum 0. Only include items that would positively
   affect a decision — do not pad the list.

9. checklist_fills: fill ONLY items where the listing text explicitly provides the
   answer. For anything not covered by the listing, return an empty string "".
   Do NOT invent nearby shops, heating types, or noise levels the description
   does not mention. Empty is the correct answer when unsure.

10. renovation_items: classify only the 7 line-items listed in the schema.
    - If the listing shows photos of a renovated kitchen, set kitchen_full applies=false confidence=2.
    - If the listing says "vajab renoveerimist" (needs renovation) with no details,
      set cosmetic applies=true confidence=1 and floors applies=null confidence=1.
    - If year_built < 1980 and electrical is not mentioned, set rewire applies=null confidence=1.
    - NEVER write a euro amount in any note field.
    - Return an empty array [] if you genuinely cannot form any opinion on any item.
"""


def _extract_json(text: str) -> dict:
    """Pull the first complete JSON object out of Claude's response.

    Claude occasionally wraps output in ```json ... ``` fences, and sometimes
    appends a trailing prose paragraph ("Note: I based this on…") that made
    a plain json.loads fail with 'Extra data'. Using raw_decode lets us keep
    the first valid object and ignore anything after it.
    """
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # Find the first '{' — Claude might emit a short intro before the JSON.
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object found in AI response")
    obj, _end = json.JSONDecoder().raw_decode(text[start:])
    return obj


def evaluate_listing(
    listing: Listing,
    context_prefix: str = "",
    commute_minutes: Optional[int] = None,
    district: str = "",
    cost_of_ownership: Optional[dict] = None,
) -> dict:
    """Returns a dict with score/verdict/strengths/concerns/draft fields.
    On any failure, returns a safe fallback dict with score=0 so the
    listing still gets a (minimal) Telegram notification rather than
    silently vanishing.

    context_prefix:  optional string prepended to the user message — used to inject
                     calibration anchors and district price/m² average per D-01/D-04.
    commute_minutes: pre-computed ORS driving time from Bolt HQ (Veerenni 28) — passed
                     in so the AI does not speculate about "no commute data available"
                     and dock points for a value we already have.
    district:        Tallinn district name extracted from the listing title (e.g.,
                     "Kesklinn", "Põhja-Tallinn") — passed in for the same reason.
    """
    commute_line = (
        f"Driving commute to Bolt HQ (Veerenni 28): {commute_minutes} min"
        if commute_minutes is not None
        else "Driving commute to Bolt HQ (Veerenni 28): not yet computed"
    )
    district_line = (
        f"District: {district}"
        if district
        else "District: not extracted from title"
    )

    if cost_of_ownership:
        b = cost_of_ownership.get("breakdown", {})
        a = cost_of_ownership.get("assumptions", {})
        cost_line = (
            f"Estimated monthly cost of ownership: {cost_of_ownership.get('monthly_total_eur')} EUR "
            f"({cost_of_ownership.get('cost_per_sqm_eur')} EUR/m²/mo). "
            f"Breakdown: mortgage {b.get('mortgage')} · KÜ {b.get('ku_fee')} · "
            f"heating {b.get('heating')} · utilities {b.get('utilities')}. "
            f"Assumptions: {a.get('down_pct')}% down, {a.get('interest_pct')}% rate, "
            f"{a.get('term_years')}y term"
        )
    else:
        cost_line = "Estimated monthly cost of ownership: not computed (missing price or area)"

    listing_summary = f"""
Title/address: {listing.title}
URL: {listing.url}
{district_line}
{commute_line}
{cost_line}
Price: {listing.price_eur} EUR ({listing.price_per_sqm} EUR/m2)
Rooms: {listing.rooms}
Area: {listing.area_sqm} m2
Year built: {listing.year_built}
Material: {listing.material}
Energy class: {getattr(listing, 'energy_class', '') or 'not stated'}
Condition (stated): {listing.condition}
Floor: {listing.floor}/{listing.floor_total}
Parking: {listing.parking}
Renovation needed (text signals): {listing.needs_renovation}
Description: {listing.description[:config.AI_DESCRIPTION_MAX_CHARS]}

IMPORTANT: The 'District', 'Driving commute to Bolt HQ', and 'Estimated monthly
cost of ownership' values above are computed externally by this system. Do NOT
dock points for these being 'unstated in the listing' — you have the
authoritative value here. Cite the monthly cost when discussing affordability
in the price_value reason.
"""
    # Phase 3: prepend context_prefix to user turn (anchors + district avg per D-01/D-04)
    user_content = context_prefix + listing_summary

    if not ANTHROPIC_API_KEY:
        return _fallback_result("Skip because ANTHROPIC_API_KEY is not set — evaluation unavailable.")

    try:
        resp = requests.post(
            API_URL,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": config.ANTHROPIC_MODEL,
                "max_tokens": config.AI_MAX_TOKENS,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_content}],
            },
            timeout=45,
        )
    except requests.RequestException as exc:
        log.error("AI evaluation network error for %s: %s", listing.id, exc)
        return _fallback_result(f"Skip because AI request failed: {exc}")

    if resp.status_code != 200:
        # Surface Anthropic errors (rate limit, invalid model, oversize prompt, etc.)
        # so future runs can be diagnosed instead of showing a generic fallback.
        try:
            err_body = resp.json()
        except ValueError:
            err_body = resp.text[:400]
        log.error(
            "AI evaluation HTTP %s for %s: %s", resp.status_code, listing.id, err_body,
        )
        detail = ""
        if isinstance(err_body, dict):
            detail = err_body.get("error", {}).get("message") or str(err_body)[:200]
        else:
            detail = str(err_body)[:200]
        return _fallback_result(
            f"Skip because Anthropic returned HTTP {resp.status_code}: {detail}"
        )

    try:
        data = resp.json()
        text_blocks = [b["text"] for b in data.get("content", []) if b.get("type") == "text"]
        raw_text = "\n".join(text_blocks)
        # If Claude ran out of tokens the JSON is guaranteed to be broken —
        # surface it clearly instead of masking it as a generic parse error so
        # we know to bump AI_MAX_TOKENS in the Settings tab.
        if data.get("stop_reason") == "max_tokens":
            log.warning(
                "AI evaluation for %s hit max_tokens=%d — response truncated, "
                "consider raising AI_MAX_TOKENS in Settings",
                listing.id, config.AI_MAX_TOKENS,
            )
        result = _extract_json(raw_text)
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        log.error(
            "AI evaluation JSON parse failed for %s: %s. Raw response head: %s",
            listing.id, exc, (raw_text[:500] if "raw_text" in dir() else "<no text>"),
        )
        return _fallback_result(f"Skip because AI output was not valid JSON: {exc}")

    result.setdefault("score", 0)
    result.setdefault("verdict", "")
    result.setdefault("score_breakdown", {})
    result.setdefault("risks", [])
    result.setdefault("strengths", [])
    result.setdefault("should_draft_email", False)
    result.setdefault("draft_subject", "")
    result.setdefault("draft_body", "")
    # Sanitise checklist_fills — drop anything outside the allow-list or empty.
    result["checklist_fills"] = _whitelist_checklist_fills(result.get("checklist_fills", {}))
    # Validate renovation_items — never crash; bad output → empty list.
    raw_reno = result.get("renovation_items")
    result["renovation_items"] = _validate_renovation_items(raw_reno)
    if raw_reno is not None and not result["renovation_items"] and raw_reno:
        log.warning(
            "AI returned renovation_items but all items were invalid/dropped for %s", listing.id
        )
    return result


def _fallback_result(verdict: str) -> dict:
    """Empty-shell result used when the model can't be reached. Keeps every field
    in the new schema so the frontend can render a graceful zero-state."""
    return {
        "score": 0,
        "verdict": verdict,
        "score_breakdown": {},
        "risks": [],
        "strengths": [],
        "checklist_fills": {},
        "renovation_items": [],
        "should_draft_email": False,
        "draft_subject": "",
        "draft_body": "",
    }
