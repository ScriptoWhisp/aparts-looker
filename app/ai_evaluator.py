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

You are given data for a single listing. Return STRICTLY valid JSON (no markdown,
no ``` fences), with the following fields:

{{
  "score": <int 0-100>,
  "verdict": "<one sentence in English — the main takeaway>",
  "strengths": ["<brief>", ...],
  "concerns": ["<brief>", ...],
  "should_draft_email": <bool — true if the listing is interesting enough to contact the agent>,
  "draft_subject": "<email subject in English if should_draft_email=true, otherwise empty string>",
  "draft_body": "<email body in English, polite, concise, asking about condition, remondifond, mandatory extras (parking), viewing availability — if should_draft_email=true, otherwise empty string>"
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
            "verdict": "Could not get AI evaluation (API error) — review this listing manually.",
            "strengths": [],
            "concerns": [],
            "should_draft_email": False,
            "draft_subject": "",
            "draft_body": "",
        }
