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

You are given data for a single listing. Return STRICTLY valid JSON (no markdown,
no ``` fences), with the following fields:

{{
  "score": <int 0-100>,
  "verdict": "<one sentence in English — the main takeaway>",
  "strengths": ["<brief>", ...],
  "concerns": ["<brief>", ...],
  "should_draft_email": <bool — true if the listing is interesting enough to contact the agent>,
  "draft_subject": "<email subject in English if should_draft_email=true, otherwise empty string>",
  "draft_body": "<email body in English, polite, concise, asking about condition, remondifond, mandatory extras (parking), viewing availability — if should_draft_email=true, otherwise empty string>",
  "checklist": {{
    "price_per_sqm":        "pass" | "fail" | "unknown",
    "rooms_area":           "pass" | "fail" | "unknown",
    "parking":              "pass" | "fail" | "unknown",
    "renovation_potential": "pass" | "fail" | "unknown",
    "floor":                "pass" | "fail" | "unknown",
    "year_material":        "pass" | "fail" | "unknown",
    "mandatory_extras":     "pass" | "fail" | "unknown"
  }}
}}

For the "checklist" field, assess each criterion from the listing text only.
Use exactly these key names. Use "unknown" when the listing text does not address the criterion.

Criterion guidance:
  price_per_sqm       — competitive pricing: "pass" if < ~3000 EUR/m² for the condition, "fail" if high, "unknown" if data missing
  rooms_area          — "pass" if 3–4 rooms and 50–80 m², "fail" if outside target range, "unknown" if data missing
  parking             — "pass" if free parking included, "fail" if paid/mandatory extra cost, "unknown" if not mentioned
  renovation_potential — "pass" if renovation signals present and structurally sound, "unknown" if not mentioned
  floor               — "pass" if not ground floor (floor >= 2), "fail" if ground floor, "unknown" if not mentioned
  year_material       — "pass" if building age/material is acceptable, "fail" if 1960s panel with no renovation signals, "unknown" if missing
  mandatory_extras    — "pass" if no mandatory extras or they are reasonably priced, "fail" if mandatory extras add >10% to price, "unknown" if not mentioned
"""


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def evaluate_listing(listing: Listing, context_prefix: str = "") -> dict:
    """Returns a dict with score/verdict/strengths/concerns/draft fields.
    On any failure, returns a safe fallback dict with score=0 so the
    listing still gets a (minimal) Telegram notification rather than
    silently vanishing.

    context_prefix: optional string prepended to the user message — used to inject
    calibration anchors and district price/m² average per D-01/D-04. Defaults to
    empty string for backward compatibility with existing callers.
    """

    listing_summary = f"""
Title/address: {listing.title}
URL: {listing.url}
Price: {listing.price_eur} EUR ({listing.price_per_sqm} EUR/m2)
Rooms: {listing.rooms}
Area: {listing.area_sqm} m2
Year built: {listing.year_built}
Material: {listing.material}
Condition (stated): {listing.condition}
Floor: {listing.floor}/{listing.floor_total}
Parking: {listing.parking}
Renovation needed (text signals): {listing.needs_renovation}
Description: {listing.description[:1500]}
"""
    # Phase 3: prepend context_prefix to user turn (anchors + district avg per D-01/D-04)
    user_content = context_prefix + listing_summary

    if not ANTHROPIC_API_KEY:
        return {
            "score": 0,
            "verdict": "ANTHROPIC_API_KEY not set — evaluation unavailable.",
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
                "max_tokens": 1500,  # increased from 1000 — plan 03-02 adds checklist output (~150 tokens)
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

        result.setdefault("score", 0)
        result.setdefault("verdict", "")
        result.setdefault("strengths", [])
        result.setdefault("concerns", [])
        result.setdefault("should_draft_email", False)
        result.setdefault("draft_subject", "")
        result.setdefault("draft_body", "")
        result.setdefault("checklist", {})
        return result

    except (requests.RequestException, json.JSONDecodeError, KeyError, ValueError):
        return {
            "score": 0,
            "verdict": "Could not get AI evaluation (API error) — review this listing manually.",
            "strengths": [],
            "concerns": [],
            "should_draft_email": False,
            "draft_subject": "",
            "draft_body": "",
            "checklist": {},
        }
