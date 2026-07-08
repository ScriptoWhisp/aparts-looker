# Phase 03: AI Quality & Price Intelligence - Research

**Researched:** 2026-07-08
**Domain:** Anthropic Messages API prompt engineering, JSON schema extension, price history data modelling, re-evaluation orchestration, frontend vanilla JS rendering
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Inject the top-scored 2–3 listings from `properties[]` (sorted by `score` descending) as calibration anchors. If fewer than 2 scored listings exist, skip silently.
- **D-02:** Anchor format: one short paragraph per anchor — title/address, score, key fields (price/m², rooms, area, parking, material).
- **D-03:** Anchor wording specifics are Claude's discretion (see Discretion).
- **D-04:** District price/m² average computed from ALL entries across `properties[]` and `pending[]` grouped by `district` field. Omit line if no district matches.
- **D-05:** District average injected as: `"District price/m² average ({district}, from {N} seen listings): {avg:.0f} EUR/m²"`. Wording is discretion.
- **D-06:** `evaluate_listing()` returns a new `checklist` key: flat dict `{criterion_name: "pass" | "fail" | "unknown"}`.
- **D-07:** Checklist criteria names come from reading the existing `app_data.checklists` structure — do not invent new criteria.
- **D-08:** AI-filled checklist written to `app_data.checklists[listing_id]` at evaluation time with `source: "ai"`. UI shows visual distinction.
- **D-09:** User override replaces AI value; `source` changes to `"user"`.
- **D-10 (note):** AI fills text-assessable criteria; viewing-only items remain `"unknown"`.
- **D-11:** Price history: new top-level key `price_history: {listing_id: [{date, price}, ...]}` in `app_data.json`.
- **D-12:** Record `price_eur + today's date` into `price_history[listing_id]` for every listing on every scrape run.
- **D-13:** Days-on-market = `today - price_history[listing_id][0].date`. No separate field.
- **D-14:** Price drop trigger: `(prev_price - new_price) / prev_price >= 0.05`.
- **D-15:** Approved listings: re-evaluate, update score/verdict on `properties[]` entry, send Telegram notification. Do NOT move back to pending.
- **D-16:** Pending listings: re-evaluate silently, update score/verdict/checklist. No new Telegram card.
- **D-17:** Rejected listings: re-queue only if `rejection_reason == "price"`. Create new pending entry with note.
- **D-18:** Sold/removed: mark with `removed_at` + `removed: true`. Implementation detail is discretion.

### Claude's Discretion

- Anchor format/wording in the prompt (D-03)
- Checklist criteria names/keys (D-07) — executor reads existing `checklists` structure
- District average line wording (D-05)
- Sold/removed signal mechanism (D-18) — scraper `removed: true` field vs. VPS inferring from absent IDs

### Deferred Ideas (OUT OF SCOPE)

- Price history sparkline chart (plain text list is sufficient for Phase 3)
- Explicit `removed: true` signal from scraper (executor may choose the simpler inference approach)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVAL-01 | Evaluation prompt includes 2–3 previously-approved listings with scores as calibration anchors | Section: Calibrated Scoring — anchor injection pattern, function signature |
| EVAL-02 | Evaluation output includes structured checklist: pass/fail per BUYER_PROFILE criteria assessable from listing text | Section: Structured Checklist Output — schema, storage, UI rendering |
| EVAL-03 | Evaluation prompt includes running price/m² average for listing's district | Section: District Price Context — computation, injection point |
| EVAL-04 | When a seen listing's price drops ≥5%, it is re-evaluated and re-queued | Section: Re-evaluation on Price Drop — detection flow, locking, Telegram |
| INTEL-01 | Price history recorded per listing on every scrape (date + price) | Section: Price History Storage — data model, migration, recording location |
| INTEL-02 | Listing longevity (days on market) tracked and surfaced in listing card | Section: Days-on-Market Rendering — computation, UI |
| INTEL-03 | When listing URL returns 404, marked as sold/removed in dossier with date | Section: Sold/Removed Detection |
</phase_requirements>

---

## Summary

Phase 3 adds three orthogonal capabilities to the existing `ai_evaluator → ingest_handler → data_store → frontend` pipeline. First, calibration anchors and a district price/m² line are prepended to the evaluation user-message so Claude scores against concrete reference points rather than scoring in a vacuum. Second, the evaluation response schema gains a flat `checklist` dict, which is written into `app_data.checklists[listing_id]` at pending-entry creation time with a `source: "ai"` marker. Third, price history is recorded on every scrape and drives three new behaviours: days-on-market display, price-drop re-evaluation, and removed-listing detection.

All changes are contained to five files: `ai_evaluator.py`, `ingest_handler.py`, `data_store.py`, `config.py`, and `app/static/index.html`. No new Python packages are required. The architecture remains single-process, single-lock, never-raise throughout.

The most consequential design decision is the function signature change to `evaluate_listing()`. The CONTEXT.md notes that anchors should be prepended to the `messages[0].content` user turn (not to `SYSTEM_PROMPT`) to keep the system prompt stable. This means `evaluate_listing()` must receive the anchor block and district average string as parameters, or the caller must compose the full user message and pass it in. A two-parameter extension (`evaluate_listing(listing, context_prefix="")`) is the cleanest approach consistent with existing code style.

**Primary recommendation:** Extend `evaluate_listing(listing, context_prefix="")` to accept an optional prefix string; `ingest_handler.process_ingest_batch()` builds the prefix from data_store reads before calling evaluate; `data_store` gains `price_history`, `record_price()`, `get_price_history()`, and `write_checklist()` helpers; `ingest_handler` gains `_detect_price_drop()` and `_handle_price_drop()` private functions following the never-raise pattern.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Anchor/context assembly | API/Backend (ingest_handler) | — | Anchors come from data_store; assembling them before the API call is ingest's job |
| AI evaluation call | API/Backend (ai_evaluator) | — | Already owns evaluate_listing(); gains context_prefix param only |
| Checklist write at evaluation time | API/Backend (ingest_handler) | data_store helper | ingest_handler orchestrates; data_store persists with lock |
| Price history recording | API/Backend (ingest_handler) | data_store helper | Runs on every ingest batch item, inside the existing lock |
| Price drop detection | API/Backend (ingest_handler) | — | Compare last two price_history entries; trigger re-eval inline |
| Re-evaluation dispatch (approved/pending/rejected) | API/Backend (ingest_handler) | — | Same process, same lock; no threading needed for price-drop path |
| Removed/sold detection | API/Backend (ingest_handler) | — | Runs after batch loop completes; cross-references seen_listing_ids |
| Telegram price-drop notification | API/Backend (ingest_handler → telegram_client) | — | Reuses existing send_message() |
| Price history + days-on-market display | Browser/Client (index.html JS) | — | Reads price_history from /api/data response; computes DOM-side |
| AI checklist badge rendering | Browser/Client (index.html JS) | — | Reads checklists[listing_id] entries with source=="ai"; marks visually |
| Removed listing badge | Browser/Client (index.html JS) | — | Reads removed/removed_at fields from properties[] entries |

---

## Standard Stack

### Core

No new packages required. All capabilities use the existing stack. [VERIFIED: direct codebase read]

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| requests | 2.31.0+ | Anthropic API HTTP call | Already used in ai_evaluator.py |
| Python stdlib `datetime` | 3.12 | Date stamping price history | Already used in ingest_handler.py |
| Python stdlib `threading` | 3.12 | RLock already in data_store | Already used |

### No Installation Required

`pip install` is NOT needed for Phase 3. No new dependencies. The `requirements.txt` stays unchanged. [ASSUMED — based on codebase read; no new packages identified]

---

## Architecture Patterns

### System Architecture Diagram

```
Mini PC scraper
    |
    | POST /api/ingest [listing_dicts]
    v
ingest_handler.process_ingest_batch()
    |
    |-- For EACH listing in batch:
    |     |
    |     |-- record_price(listing_id, price_eur, today)          [NEW - data_store]
    |     |
    |     |-- if listing is NEW (not in seen_listing_ids):
    |     |     |-- build context_prefix (anchors + district avg)  [NEW]
    |     |     |-- evaluate_listing(listing, context_prefix)       [MODIFIED]
    |     |     |     |-- Claude Haiku API call
    |     |     |     |-- returns {score, verdict, checklist, ...}  [MODIFIED]
    |     |     |-- add_to_pending(pending_entry)
    |     |     |-- write_checklist(listing_id, checklist, "ai")   [NEW - data_store]
    |     |     |-- send_pending_card(listing, evaluation)
    |     |
    |     |-- if listing ALREADY KNOWN (in seen_listing_ids):
    |           |-- detect_price_drop(listing_id, new_price)        [NEW]
    |                 |-- if drop >= 5%:
    |                       |-- re-evaluate (approved/pending/rejected)
    |                       |-- update properties[]/pending[]/rejected[]
    |                       |-- send Telegram notification (approved only)
    |
    |-- After batch loop: detect_removed_listings()                 [NEW]
          |-- cross-ref seen_listing_ids vs. batch listing_ids
          |-- mark removed: true + removed_at on matching entries
```

### Recommended Project Structure

```
app/
├── ai_evaluator.py      # evaluate_listing(listing, context_prefix="") — add param + checklist to schema
├── ingest_handler.py    # process_ingest_batch() — anchor assembly, price history, drop detection
├── data_store.py        # add price_history key + 4 new helper functions
├── config.py            # add PRICE_DROP_THRESHOLD env var
└── static/
    └── index.html       # add price history list, days-on-market, AI checklist badges, removed badge
```

---

## Pattern 1: Anchor Injection — User Message Prefix [ASSUMED based on CONTEXT.md code_context]

The CONTEXT.md notes anchors go into `messages[0].content` (the user turn), not into `SYSTEM_PROMPT`. This keeps the system prompt immutable and avoids polluting it with per-call data.

```python
# In ingest_handler.py — build context_prefix before calling evaluate_listing
def _build_context_prefix(listing: Listing) -> str:
    """Assemble calibration anchors + district average for the evaluation prompt.

    Returns an empty string if fewer than 2 scored properties exist (D-02).
    Never raises — returns "" on any failure (never-raise pattern).
    """
    try:
        data = data_store.load_app_data()
        props = data.get("properties", [])
        pending = data.get("pending", [])

        # Anchors: top 2-3 by score from properties[] (D-01)
        scored = sorted(
            [p for p in props if isinstance(p.get("score"), int) and p["score"] > 0],
            key=lambda p: p["score"],
            reverse=True,
        )[:3]

        if len(scored) < 2:
            anchor_block = ""
        else:
            lines = [
                "Here are listings Daniel has previously approved, with their AI scores, "
                "as calibration reference:\n"
            ]
            for i, anchor in enumerate(scored, 1):
                lines.append(
                    f"Anchor {i} — {anchor.get('name', '')} ({anchor.get('district', '')})\n"
                    f"Score: {anchor['score']}/100 | "
                    f"{anchor.get('rooms', '?')} rooms, {anchor.get('area', '?')} m², "
                    f"{anchor.get('pricePerSqm', '?')} EUR/m², "
                    f"parking: {anchor.get('material', '?')}\n"
                )
            lines.append(
                "\nUse these as reference points when scoring the new listing below.\n\n"
            )
            anchor_block = "".join(lines)

        # District average (D-04): all entries across properties[] and pending[]
        dist = listing.district if hasattr(listing, "district") else ""
        # NOTE: pending[] entries use 'price_per_sqm'; properties[] use 'pricePerSqm'
        all_entries = list(props) + list(pending)
        district_sqm = [
            e.get("price_per_sqm") or e.get("pricePerSqm")
            for e in all_entries
            if (e.get("district") or "") == dist
            and (e.get("price_per_sqm") or e.get("pricePerSqm"))
        ]
        if dist and district_sqm:
            avg = sum(district_sqm) / len(district_sqm)
            district_line = (
                f"District price/m² average ({dist}, from {len(district_sqm)} seen listings): "
                f"{avg:.0f} EUR/m²\n\n"
            )
        else:
            district_line = ""

        return anchor_block + district_line

    except Exception:
        log.exception("_build_context_prefix failed — proceeding without context")
        return ""
```

**Important:** The `Listing` dataclass (kv_listing_parser.py) does NOT have a `district` field. [VERIFIED: direct read of Listing dataclass] The district is stored on the properties[] and pending[] dict entries. For the district average calculation, use `listing.title` or parse the district from the address, OR add `district` to the `Listing` dataclass. The simplest solution: the scraper client can include a `district` field in its payload — or the VPS infers it from the kv.ee listing URL/address. For Phase 3, the district average will compute from existing stored data using the `district` field already present on properties[]/pending[] entries. The new listing being evaluated has no district until it's stored — so the district average for a new listing must be inferred from its address or omitted if unknown. This is a key gap the planner must resolve.

### Pattern 2: evaluate_listing() Signature Extension [ASSUMED — no external docs needed]

```python
# ai_evaluator.py — add context_prefix parameter
def evaluate_listing(listing: Listing, context_prefix: str = "") -> dict:
    """Returns dict with score/verdict/strengths/concerns/draft/checklist fields.

    context_prefix: optional string prepended to the user message — used to inject
    calibration anchors and district price/m² average (EVAL-01, EVAL-03).
    Defaults to empty string for backward compatibility.
    """
    listing_summary = f"""
Title/address: {listing.title}
URL: {listing.url}
Price: {listing.price_eur} EUR ({listing.price_per_sqm} EUR/m2)
...
"""
    user_content = context_prefix + listing_summary  # prefix prepended here

    # ... API call uses user_content as messages[0].content ...
```

**Schema change**: The `SYSTEM_PROMPT` must add `checklist` to the required JSON output fields:

```python
SYSTEM_PROMPT = f"""...existing content...

You are given data for a single listing. Return STRICTLY valid JSON (no markdown,
no ``` fences), with the following fields:

{{
  "score": <int 0-100>,
  "verdict": "<one sentence>",
  "strengths": [...],
  "concerns": [...],
  "should_draft_email": <bool>,
  "draft_subject": "...",
  "draft_body": "...",
  "checklist": {{
    "<criterion_key>": "pass" | "fail" | "unknown",
    ...
  }}
}}

The checklist keys and their assessability:
- price_per_sqm: assess from listing price data — "pass" if competitive (<3,000 EUR/m² for condition), "fail" if high, "unknown" if data missing
- rooms_area: assess from rooms/area data — "pass" if 3-4 rooms and 50-80 m², else "fail"
- parking: "pass" if free parking, "fail" if paid/mandatory, "unknown" if not mentioned
- renovation_potential: "pass" if renovation signals present and structurally sound, "unknown" if not mentioned
- floor: "pass" if not ground floor and not top floor with leak risk, "fail" if ground floor, "unknown" if not mentioned
- year_material: "pass" if building is post-renovation or reasonable age, "fail" if 1960s panel with no renovation signals, "unknown" if missing
- mandatory_extras: "pass" if no mandatory extras or they are reasonably priced, "fail" if mandatory extras add >10% to price
"""
```

**Token budget**: Current `max_tokens=1000`. Adding a checklist with 7 fields (each ~20 chars) adds roughly 150 tokens to the response. The anchor block for 3 properties adds ~200 tokens to the input. Total additional tokens per call: ~350. At Haiku pricing this is negligible. [ASSUMED — token estimate based on schema size]

### Pattern 3: Price History Data Model [VERIFIED: direct read of data_store.py]

Current `DEFAULT_APP_DATA`:
```python
DEFAULT_APP_DATA = {
    "properties": [...],
    "checklists": {},
    "settings": {},
    "pending": [],
    "rejected": [],
}
```

After Phase 3:
```python
DEFAULT_APP_DATA = {
    "properties": [...],
    "checklists": {},
    "settings": {},
    "pending": [],
    "rejected": [],
    "price_history": {},   # NEW: {listing_id: [{date: "YYYY-MM-DD", price: int}, ...]}
}
```

Zero-downtime migration via `setdefault` in `load_app_data()`:
```python
def load_app_data():
    with _lock:
        data = _read_json(config.APP_DATA_FILE, DEFAULT_APP_DATA)
        data.setdefault("properties", [])
        data.setdefault("checklists", {})
        data.setdefault("settings", {})
        data.setdefault("pending", [])
        data.setdefault("rejected", [])
        data.setdefault("price_history", {})   # NEW — safe on existing deploys
        return data
```

### Pattern 4: Price History Helpers [ASSUMED — follows existing data_store pattern]

```python
def record_price(listing_id: str, price_eur: int, date_str: str) -> None:
    """Append price entry for listing_id. Idempotent for same date (overwrite if same date exists).

    Called on every ingest for every listing, inside the existing _lock context.
    MUST be called while _lock is held by the caller (ingest_handler holds it for the
    full batch — callers must NOT re-acquire _lock here).
    """
    # NOTE: This helper is designed to be called while _lock is already held,
    # so it does NOT acquire _lock internally. It takes data as a parameter.

def record_price_in_data(data: dict, listing_id: str, price_eur: int, date_str: str) -> None:
    """Mutate data dict in-place. Caller holds _lock. No file I/O — caller calls save_app_data()."""
    history = data.setdefault("price_history", {}).setdefault(listing_id, [])
    if history and history[-1]["date"] == date_str:
        history[-1]["price"] = price_eur  # idempotent for same-day re-runs
    else:
        history.append({"date": date_str, "price": price_eur})


def get_price_history(listing_id: str) -> list[dict]:
    """Return price history for listing_id. Returns [] if not found. Thread-safe."""
    with _lock:
        data = load_app_data()
        return data.get("price_history", {}).get(listing_id, [])


def write_checklist_ai(listing_id: str, checklist: dict) -> None:
    """Write AI-generated checklist entries. Existing 'user' source entries are preserved.

    Checklist entry shape: {criterion_key: {result: "pass"|"fail"|"unknown", source: "ai"}}
    """
    with _lock:
        data = load_app_data()
        existing = data.setdefault("checklists", {}).setdefault(listing_id, {})
        for key, result in checklist.items():
            if isinstance(existing.get(key), dict) and existing[key].get("source") == "user":
                continue  # preserve user overrides (D-09)
            existing[key] = {"result": result, "source": "ai"}
        save_app_data(data)
```

**Critical locking note**: `ingest_handler.process_ingest_batch()` holds `data_store._lock` for the ENTIRE batch via `with data_store._lock:`. Price recording must happen inside that same lock context. The helper function must either accept `data` as a parameter (mutate in-place, caller saves) or the lock must be released and re-acquired. Given the existing pattern, the cleanest approach is to call a non-locking helper that mutates the already-loaded `data` dict in-place, then let the outer batch function call `save_app_data()` at the end of the loop iteration. [VERIFIED: direct read of ingest_handler.py lines 51-131]

### Pattern 5: Price Drop Detection — Exact Flow [VERIFIED: direct read of ingest_handler.py]

The current `process_ingest_batch()` flow:
1. Acquire `data_store._lock`
2. `load_agent_state()`
3. For each listing in batch:
   a. Deserialize
   b. Dedup check (in `seen_listing_ids`)
   c. If seen → `continue` (currently skips all known listings)
   d. Append to `seen_listing_ids`
   e. VPS filters (price, rooms, images)
   f. `evaluate_listing()`
   g. `add_to_pending()`
   h. `send_pending_card()`
4. `save_agent_state()`

**Phase 3 change**: step 3c must change from `continue` to "record price + check drop". The new flow for known listings:

```python
if dedup_key in seen_set:
    # Known listing: record price and check for drop
    if listing.price_eur:
        _record_and_check_price_drop(data, listing, today_str)
    continue  # still skip evaluation for truly unchanged listings
```

Where `_record_and_check_price_drop` is a new private function that:
1. Reads the current `price_history[listing_id]` from `data`
2. Records the new price (mutates `data` in-place)
3. If len(history) >= 2 and drop >= threshold: calls `_handle_price_drop(data, listing)`
4. Never raises

**NOTE**: `data_store.add_to_pending()` currently calls `load_app_data()` internally (re-acquires lock). This will DEADLOCK if called inside the outer `with data_store._lock:` block. [VERIFIED: direct read of data_store.py lines 109-119] The existing code calls `add_to_pending()` inside the lock block — but `data_store._lock` is an `RLock` (reentrant), so re-acquisition by the same thread is safe. [VERIFIED: data_store.py line 26: `_lock = threading.RLock()`]

### Pattern 6: Re-evaluation Dispatch [ASSUMED based on codebase patterns]

```python
def _handle_price_drop(data: dict, listing: Listing, prev_price: int, new_price: int) -> None:
    """Re-evaluate a listing whose price dropped >=5%. Mutates data in-place.

    Dispatches by current listing state:
    - In properties[] → re-evaluate, update entry, send Telegram notification (D-15)
    - In pending[] → re-evaluate silently, update entry (D-16)
    - In rejected[] with rejection_reason=="price" → re-queue as new pending entry (D-17)
    - In rejected[] with other reason → ignore (D-17)
    Never raises.
    """
    listing_id = listing.id
    pct = round((prev_price - new_price) / prev_price * 100, 1)

    # Build updated context_prefix for re-evaluation
    # (anchors and district avg, same as new listing path)
    context_prefix = _build_context_prefix(listing)

    try:
        evaluation = evaluate_listing(listing, context_prefix)
    except Exception:
        log.exception("Re-evaluation failed for %s", listing_id)
        return

    # Find listing state
    prop = next((p for p in data.get("properties", []) if p.get("id") == listing_id), None)
    pend = next((e for e in data.get("pending", []) if e.get("id") == listing_id), None)
    rej = next((e for e in data.get("rejected", []) if e.get("id") == listing_id), None)

    if prop is not None:
        # D-15: update approved listing, send notification
        prop["score"] = evaluation.get("score", prop.get("score", 0))
        prop["verdict"] = evaluation.get("verdict", prop.get("verdict", ""))
        note = f"[Price drop {pct}%, re-scored {prop['score']}/100] {prop.get('notes', '')}"
        prop["notes"] = note
        telegram_client.send_message(
            f"Price drop on {listing.title or listing_id}: "
            f"{prev_price:,} → {new_price:,} EUR (-{pct}%). "
            f"Re-scored: {prop['score']}/100."
        )
    elif pend is not None:
        # D-16: update pending silently
        pend["score"] = evaluation.get("score", pend.get("score", 0))
        pend["verdict"] = evaluation.get("verdict", pend.get("verdict", ""))
        # checklist update handled by write_checklist_ai helper after this fn returns
    elif rej is not None and rej.get("rejection_reason") == "price":
        # D-17: re-queue
        new_entry = dict(rej)
        new_entry.pop("rejection_reason", None)
        new_entry.pop("rejected_at", None)
        new_entry["score"] = evaluation.get("score", 0)
        new_entry["verdict"] = evaluation.get("verdict", "")
        new_entry["strengths"] = evaluation.get("strengths", [])
        new_entry["concerns"] = evaluation.get("concerns", [])
        new_entry["queued_at"] = datetime.now(timezone.utc).isoformat()
        new_entry["price_drop_requeue_note"] = (
            f"Previously rejected for price. Price dropped {pct}% to {new_price:,} EUR."
        )
        data.setdefault("pending", []).append(new_entry)
        data["rejected"] = [e for e in data["rejected"] if e.get("id") != listing_id]
```

### Pattern 7: Sold/Removed Detection [ASSUMED — discretion choice made here]

The CONTEXT.md gives executor discretion on D-18. The simpler approach: after the batch loop, compare the set of listing_ids received in THIS batch against all IDs in `seen_listing_ids`. Listings in `seen_listing_ids` but NOT in the current batch on two consecutive runs should be considered removed. However, the scraper only sends what it finds on the current page — page count may vary, so absence in a single batch is ambiguous.

**Simpler approach that avoids false positives**: the scraper client fetches each seen listing's URL to check for 404 and includes `{"id": ..., "removed": true}` entries in the batch for any 404s found. The VPS ingest handler then marks those listings accordingly.

**Fallback if scraper doesn't send removed signals**: VPS marks a listing as `removed: true` if it has been absent from all batches for N consecutive runs (tracked in agent_state). This is more complex.

**Recommendation for Phase 3**: add a `removed` boolean field to the scraper batch payload. If `listing.raw_ok is False` (the scraper already has this concept — `Listing.raw_ok=False` on fetch failure), then the VPS can treat `raw_ok=False` listings as 404 signals. [VERIFIED: Listing dataclass has `raw_ok: bool = True`, kv_listing_parser.py line 72]

```python
# In ingest_handler — at the end of the batch loop or as a separate pass:
def _mark_removed_listings(data: dict, batch_listing_dicts: list[dict]) -> None:
    """Mark listings with raw_ok=False as removed in properties[] or pending[]."""
    for item in batch_listing_dicts:
        if not item.get("raw_ok", True):
            listing_id = item.get("id") or extract_object_id(item.get("url", ""))
            if not listing_id:
                continue
            today_str = datetime.now(timezone.utc).date().isoformat()
            for prop in data.get("properties", []):
                if prop.get("id") == listing_id and not prop.get("removed"):
                    prop["removed"] = True
                    prop["removed_at"] = today_str
                    log.info("Listing %s marked as removed (404)", listing_id)
            for pend in data.get("pending", []):
                if pend.get("id") == listing_id and not pend.get("removed"):
                    pend["removed"] = True
                    pend["removed_at"] = today_str
```

### Pattern 8: Checklist Storage Shape [VERIFIED: direct read of index.html / data_store.py]

The existing `app_data.checklists` structure (from index.html and data_store):
- Top-level key: `listing_id` (string)
- Value: nested dict with section keys: `finance`, `quality`, `ku`, `sellerQuestions`, `deepCheck`, `onsite`
- Each section maps `item_id` → `{checked: bool, note: str, flag: bool}` (for check sections) or `{score: int, note: str}` (for score sections)

The checklist SECTIONS defined in index.html are: `quality`, `ku`, `sellerQuestions`, `deepCheck`, `onsite` (5 sections). The item IDs are generated as `{sectionKey}_{groupIndex}_{itemIndex}` (e.g., `quality_0_0`). [VERIFIED: index.html line 459]

**Critical finding**: the AI checklist criteria from D-06/D-07 are NOT the same as the existing `SECTIONS` checklist item IDs. The existing checklist is a post-viewing 5-section checklist with items like "Выписка из Kinnistusraamat актуальна" and "Стены вокруг окон". The AI can only assess text-visible criteria (price/m², rooms, parking, renovation, floor, year/material, mandatory extras). These are NOT represented as items in the existing `SECTIONS` data structure.

**Resolution**: The AI checklist is a separate sub-structure within `checklists[listing_id]`. Add an `ai_checklist` key alongside the section keys:

```python
# checklists[listing_id] after Phase 3:
{
    "finance": {...},       # existing
    "quality": {...},       # existing
    "ku": {...},            # existing
    "sellerQuestions": {}, # existing
    "deepCheck": {},        # existing
    "onsite": {},           # existing
    "ai_checklist": {       # NEW — AI pre-fill from evaluate_listing()
        "price_per_sqm":    {"result": "pass",    "source": "ai"},
        "rooms_area":       {"result": "pass",    "source": "ai"},
        "parking":          {"result": "unknown", "source": "ai"},
        "renovation_potential": {"result": "pass", "source": "ai"},
        "floor":            {"result": "fail",    "source": "ai"},
        "year_material":    {"result": "pass",    "source": "ai"},
        "mandatory_extras": {"result": "unknown", "source": "ai"},
    }
}
```

This avoids modifying the existing section structure while giving the frontend a clean place to read AI results. The `/api/data` endpoint returns `checklists` in full, so the frontend can read `checklists[id].ai_checklist` directly.

The `PUT /api/data` endpoint saves whatever the frontend sends — if the frontend includes the updated `ai_checklist` with `source: "user"` on override, that will be persisted. This preserves D-09 without any backend changes to the PUT handler.

### Pattern 9: Frontend Rendering — Days-on-Market and Price History [ASSUMED — vanilla JS pattern]

The pending tab card is built in `buildPendingCard()` (index.html ~line 1143). The dossier card is built in `renderMain()` (index.html ~line 763). Both need additions.

**Days-on-market**: computed in JS from `price_history` data returned by `/api/data`:

```javascript
// In loadData(): state now also stores price_history
state.priceHistory = parsed.price_history || {};

// Utility function
function daysOnMarket(listingId) {
    var hist = state.priceHistory[listingId];
    if (!hist || !hist.length) return null;
    var first = new Date(hist[0].date);
    var now = new Date();
    return Math.floor((now - first) / 86400000);
}

// Price history list (plain text, not chart — per deferred decision)
function priceHistoryHtml(listingId) {
    var hist = state.priceHistory[listingId];
    if (!hist || !hist.length) return "";
    // Build list using DOM methods (textContent only, no innerHTML for user data)
    // Returns a <div> element, not HTML string
}
```

**AI checklist badge**: render in the pending card and dossier card. Each AI checklist item shows result with a robot icon for `source: "ai"`:

```javascript
function aiChecklistHtml(listingId) {
    var cl = state.checklists[listingId];
    if (!cl || !cl.ai_checklist) return "";
    // Build DOM nodes using textContent
    // "pass" → green dot, "fail" → red dot, "unknown" → grey dot
    // source=="ai" → robot prefix character (e.g., "[AI]")
    // source=="user" → no prefix (user already confirmed)
}
```

**Removed badge**: check `p.removed === true` in `renderMain()` and `buildPendingCard()`:

```javascript
if (p.removed) {
    var removedBadge = document.createElement("div");
    removedBadge.textContent = "Removed from kv.ee — " + (p.removed_at || "unknown date");
    removedBadge.style.color = "var(--red)";
    // append to card
}
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting for anchors | Custom tokenizer | Trust the model | Claude handles context gracefully; just keep anchor block <500 tokens |
| AI checklist validation | Schema validator | `setdefault` + whitelist | The model returns the keys; add server-side whitelist check in ingest_handler |
| Date arithmetic for days-on-market | Custom date parser | `datetime.date.today()` + ISO 8601 subtraction | Python and JS both handle ISO 8601 strings natively |
| Price history chart | Custom chart lib | Plain text list | Deferred to Phase 5 (explicitly deferred in CONTEXT.md) |
| Thread-safe price history writes | Custom file lock | Existing `data_store._lock` (RLock) | Already established pattern; reuse |
| JSON schema enforcement for AI response | pydantic | `result.setdefault("checklist", {})` | Existing pattern; Haiku is reliable enough for 7-key schema |

**Key insight:** The entire phase is additive to existing patterns. The hardest part is the price-drop re-evaluation dispatch — but it follows the never-raise/RLock pattern already established. No new infrastructure.

---

## Common Pitfalls

### Pitfall 1: Deadlock from Double Lock Acquisition

**What goes wrong:** If `_handle_price_drop()` calls `data_store.add_to_pending()` while `process_ingest_batch()` holds `data_store._lock`, and if `_lock` were a regular `threading.Lock()`, this would deadlock.

**Why it happens:** `add_to_pending()` internally calls `load_app_data()` which acquires `_lock`.

**How to avoid:** `_lock` is `threading.RLock()` (reentrant) — same thread can re-acquire. [VERIFIED: data_store.py line 26] Confirm `RLock` stays as-is in Phase 3. Do NOT change it to `Lock`. Also: price drop helpers that mutate `data` in-place avoid the double-acquire problem entirely.

**Warning signs:** `RecursionError` or hang in tests that call `add_to_pending()` from inside `process_ingest_batch()`.

### Pitfall 2: Listing Dataclass Lacks `district` Field

**What goes wrong:** `_build_context_prefix()` tries to read `listing.district` but `Listing` has no such field. Attribute error.

**Why it happens:** The `Listing` dataclass (kv_listing_parser.py) does not include a `district` field — district is stored on the properties[] dict entry after the listing enters the dossier. [VERIFIED: direct read of Listing dataclass]

**How to avoid:** Either (a) skip district average for new listings (can't know district from kv.ee listing text reliably), or (b) add `district: str = ""` to the `Listing` dataclass and have the scraper attempt to parse it. Option (a) is simpler and correct for most cases — the district average will apply on re-evaluation once the listing is stored with a district.

**Warning signs:** `AttributeError: 'Listing' object has no attribute 'district'` in ingest logs.

### Pitfall 3: AI Returns Checklist Keys That Don't Match Expected Criteria

**What goes wrong:** The model returns `{"price": "pass"}` instead of `{"price_per_sqm": "pass"}`, or adds unexpected keys.

**Why it happens:** LLMs don't always follow exact key names even when instructed.

**How to avoid:** In `ingest_handler.py`, whitelist the 7 expected keys after `evaluate_listing()` returns:

```python
EXPECTED_CHECKLIST_KEYS = {"price_per_sqm", "rooms_area", "parking", "renovation_potential", "floor", "year_material", "mandatory_extras"}

checklist_raw = evaluation.get("checklist", {})
checklist = {k: v for k, v in checklist_raw.items() if k in EXPECTED_CHECKLIST_KEYS and v in {"pass", "fail", "unknown"}}
# Fill missing keys with "unknown"
for key in EXPECTED_CHECKLIST_KEYS:
    checklist.setdefault(key, "unknown")
```

**Warning signs:** Frontend shows unexpected AI checklist items or missing items.

### Pitfall 4: max_tokens=1000 Is Tight with Checklist Added

**What goes wrong:** Evaluation truncates mid-JSON because the checklist adds output tokens.

**Why it happens:** Current `max_tokens=1000`. Draft body can be long (200-300 tokens). Adding 7 checklist entries adds ~100-150 tokens.

**How to avoid:** Increase `max_tokens` to `1500` in the API call. At Haiku pricing this adds ~$0.0003 per call. [ASSUMED — token estimate based on schema size]

**Warning signs:** `json.JSONDecodeError` in `_extract_json()` logs — truncated JSON.

### Pitfall 5: Price History Grows Unbounded

**What goes wrong:** After months of scraping, `price_history` JSON grows large (potentially hundreds of entries per listing). `app_data.json` file size bloats.

**Why it happens:** `record_price()` appends on every scrape. At 2h intervals, one listing accumulates 12 entries/day.

**How to avoid:** Cap price history at, say, 90 entries per listing (90 days worth at daily resolution). Since the same-day dedup is already in `record_price_in_data()`, each listing gains at most one entry per day. At 90 days max, the cap is 90 entries × ~40 bytes = 3.6 KB per listing. With 100 listings that's 360 KB — manageable.

**Warning signs:** Slow `load_app_data()` calls; `app_data.json` exceeds 10 MB.

### Pitfall 6: Re-evaluation Changes Score of Already-Reviewed Listings

**What goes wrong:** Daniel approved a listing specifically because of criteria X. AI re-evaluates with new price context and now scores it differently, changing the notes and potentially confusing Daniel.

**Why it happens:** `_handle_price_drop()` for approved listings mutates `prop["score"]` and `prop["notes"]` (D-15).

**How to avoid:** Per D-15, this is intentional — Daniel needs to know the re-scored value. Make the Telegram notification prominent: include both old and new score. Also append to `notes` rather than overwriting it: `prop["notes"] = "[Price drop note] " + prop.get("notes", "")`.

**Warning signs:** Confusing Telegram messages without old/new score comparison.

### Pitfall 7: ingest_handler Holds _lock During evaluate_listing() (API Call)

**What goes wrong:** `process_ingest_batch()` holds `data_store._lock` for the ENTIRE batch, including during `evaluate_listing()` which makes a 30-second HTTP call to Anthropic. During this time, `/api/data` GET requests (from the frontend) block.

**Why it happens:** The existing lock scope covers the entire batch loop. [VERIFIED: ingest_handler.py line 51]

**How to avoid:** This is an existing issue, not new to Phase 3. The same problem exists currently. For Phase 3, the price-drop re-evaluation adds MORE locked API calls. Consider releasing the lock before evaluate_listing() and re-acquiring after. But this changes existing behavior. For now, document as known limitation: frontend will briefly pause during ingest batch processing.

**Warning signs:** Slow frontend response during ingest runs.

---

## Checklist Criteria — The 7 Text-Assessable Criteria

Based on CONTEXT.md D-07 and the `BUYER_PROFILE` in config.py, the 7 criteria assessable from listing text:

| Key | Assessment Source | Pass Condition |
|-----|------------------|----------------|
| `price_per_sqm` | `listing.price_per_sqm` | < 3,000 EUR/m² for condition |
| `rooms_area` | `listing.rooms`, `listing.area_sqm` | 3-4 rooms, 50-80 m² |
| `parking` | `listing.parking` | `"free"` |
| `renovation_potential` | `listing.needs_renovation`, `listing.condition` | renovation signals present |
| `floor` | `listing.floor`, `listing.floor_total` | not ground floor (floor >= 2) |
| `year_material` | `listing.year_built`, `listing.material` | year >= 1960, no severe panel signals |
| `mandatory_extras` | listing description text | no mandatory extras OR reasonably priced |

These map to the 7 criteria in `BUYER_PROFILE` (points 1-7 in config.py). [VERIFIED: config.py BUYER_PROFILE]

---

## Code Examples

### SYSTEM_PROMPT Checklist Addition

```python
# Source: derived from existing SYSTEM_PROMPT in ai_evaluator.py + D-06 spec
CHECKLIST_INSTRUCTION = """
Additionally, return a "checklist" field: a flat dict mapping each criterion to
"pass", "fail", or "unknown" based solely on what the listing text reveals.
Use "unknown" when the listing text is silent on a criterion.

Criteria keys (use exactly these names):
  price_per_sqm       — competitive pricing for the district/condition
  rooms_area          — 3-4 rooms, 50-80 m² target range
  parking             — free parking available
  renovation_potential — renovation signals present with structural soundness
  floor               — not ground floor
  year_material       — building age and material acceptable
  mandatory_extras    — no mandatory extras or reasonably priced
"""
```

### Price Recording in process_ingest_batch

```python
# Source: derived from ingest_handler.py process_ingest_batch() pattern
from datetime import date as _date

# Inside the for loop, before the dedup-continue:
today_str = _date.today().isoformat()  # compute once before loop
# ...
if dedup_key in seen_set:
    # Known listing: record price + check drop
    if listing.price_eur is not None:
        _record_price_in_batch_data(app_data, listing.id, listing.price_eur, today_str)
        _check_and_handle_price_drop(app_data, listing, today_str)
    continue
```

### test_price_drop_detection.py Pattern

```python
# Follows existing test_ingest.py pattern: monkeypatch evaluate_listing, seed data manually
def test_price_drop_triggers_reeval(tmp_agent_state, monkeypatch):
    import data_store
    import ingest_handler

    # Seed price history with a previous higher price
    with data_store._lock:
        data = data_store.load_app_data()
        data["price_history"]["test-1"] = [{"date": "2026-07-01", "price": 200000}]
        data["pending"].append({...})  # existing pending entry
        data_store.save_app_data(data)

    monkeypatch.setattr(ingest_handler, "evaluate_listing",
                        lambda l, ctx="": {"score": 85, "verdict": "Better now", ...})

    # Send same listing with 6% lower price (190000 / 200000 = 0.95 → 5% drop)
    ingest_handler.process_ingest_batch([{
        "id": "test-1", "url": "https://kv.ee/test-1.html",
        "price_eur": 188000,  # 6% drop
        "image_count": 10, "raw_ok": True, ...
    }])

    data = data_store.load_app_data()
    # Pending entry should have updated score
    pend = next(e for e in data["pending"] if e["id"] == "test-1")
    assert pend["score"] == 85
```

---

## Runtime State Inventory

This is a non-rename phase — no runtime state rename required. Omitted.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest (already in use) |
| Config file | none detected — pytest discovers from app/tests/ |
| Quick run command | `cd app && python -m pytest tests/ -x -q` |
| Full suite command | `cd app && python -m pytest tests/ -v` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVAL-01 | evaluate_listing() with 2 anchors sends context_prefix to API | unit | `pytest tests/test_eval_quality.py::test_anchor_injection -x` | ❌ Wave 0 |
| EVAL-01 | with <2 anchors, no prefix sent | unit | `pytest tests/test_eval_quality.py::test_anchor_skipped_below_threshold -x` | ❌ Wave 0 |
| EVAL-02 | evaluate_listing() returns checklist dict with 7 keys | unit | `pytest tests/test_eval_quality.py::test_checklist_in_response -x` | ❌ Wave 0 |
| EVAL-02 | write_checklist_ai preserves user-source entries | unit | `pytest tests/test_eval_quality.py::test_checklist_user_override_preserved -x` | ❌ Wave 0 |
| EVAL-03 | context_prefix includes district avg line when matching entries exist | unit | `pytest tests/test_eval_quality.py::test_district_avg_injected -x` | ❌ Wave 0 |
| EVAL-03 | district avg omitted when no entries for that district | unit | `pytest tests/test_eval_quality.py::test_district_avg_omitted_unknown -x` | ❌ Wave 0 |
| EVAL-04 | 5% price drop triggers re-evaluation for pending listing | unit | `pytest tests/test_price_intelligence.py::test_price_drop_reeval_pending -x` | ❌ Wave 0 |
| EVAL-04 | 4.9% drop does NOT trigger re-evaluation | unit | `pytest tests/test_price_intelligence.py::test_price_drop_below_threshold_no_reeval -x` | ❌ Wave 0 |
| EVAL-04 | price-rejected listing re-queued on 5% drop | unit | `pytest tests/test_price_intelligence.py::test_price_rejected_requeued -x` | ❌ Wave 0 |
| EVAL-04 | location-rejected listing NOT re-queued on price drop | unit | `pytest tests/test_price_intelligence.py::test_location_rejected_not_requeued -x` | ❌ Wave 0 |
| INTEL-01 | record_price appends entry on new listing | unit | `pytest tests/test_price_intelligence.py::test_record_price_new -x` | ❌ Wave 0 |
| INTEL-01 | record_price is idempotent for same date | unit | `pytest tests/test_price_intelligence.py::test_record_price_idempotent -x` | ❌ Wave 0 |
| INTEL-01 | ingest batch records price for known listing | integration | `pytest tests/test_price_intelligence.py::test_ingest_records_price_for_known -x` | ❌ Wave 0 |
| INTEL-02 | days-on-market = today - first_history_date | unit (JS: manual) | manual — verify in browser | manual |
| INTEL-03 | raw_ok=False listing marked removed in properties[] | unit | `pytest tests/test_price_intelligence.py::test_removed_listing_marked -x` | ❌ Wave 0 |
| INTEL-03 | raw_ok=False listing marked removed in pending[] | unit | `pytest tests/test_price_intelligence.py::test_removed_listing_marked_pending -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd app && python -m pytest tests/ -x -q`
- **Per wave merge:** `cd app && python -m pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `app/tests/test_eval_quality.py` — covers EVAL-01, EVAL-02, EVAL-03
- [ ] `app/tests/test_price_intelligence.py` — covers EVAL-04, INTEL-01, INTEL-03
- [ ] No new fixtures needed — existing `tmp_agent_state`, `mock_telegram`, `mock_send_pending_card` cover all test patterns

---

## Environment Availability

Step 2.6: Applicable — but all dependencies are local Python stdlib + existing packages. No external tool probing required.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 | All | ✓ | 3.12 (from Dockerfile) | — |
| requests | ai_evaluator.py | ✓ | 2.31.0+ | — |
| pytest | Tests | ✓ | detected in tests/ | — |
| Anthropic API | evaluate_listing() | ✓ (mocked in tests) | claude-haiku-4-5-20251001 | test mock |

**No missing dependencies. No new packages required.**

---

## Security Domain

`security_enforcement: true` in config.json. ASVS Level 1 applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | ingest endpoint auth unchanged |
| V3 Session Management | no | stateless API unchanged |
| V4 Access Control | no | single-user, existing auth unchanged |
| V5 Input Validation | yes | checklist keys whitelist; price value must be int; district average skipped on missing data |
| V6 Cryptography | no | no new crypto |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious `checklist` keys from AI response injected into checklists | Tampering | Whitelist EXPECTED_CHECKLIST_KEYS in ingest_handler before write |
| Anchor block containing adversarial listing titles (prompt injection) | Tampering | Anchor titles come from Daniel's own approved listings — trusted source; no external input |
| AI checklist value rendered as innerHTML | XSS | Frontend MUST use textContent only (existing convention — line 1142 of index.html confirms this pattern) |
| price_history listing_id used as object key injection | Tampering | listing_id comes from URL regex extract — already validated by extract_object_id() |
| price_eur from scraper payload: non-integer causes division by zero in drop % calc | Tampering | Guard: `if isinstance(price_eur, int) and price_eur > 0` before computing drop |

---

## Open Questions

1. **Does `Listing` need a `district` field?**
   - What we know: `Listing` dataclass has no `district` field; district is only on properties[]/pending[] entries.
   - What's unclear: how the scraper or VPS infers district for a new listing being evaluated for the first time.
   - Recommendation: For Phase 3, omit district average for truly new listings (no match in stored data). District average will apply on re-evaluation once the listing is stored. Document this in the plan.

2. **`max_tokens` increase: 1000 → 1500?**
   - What we know: checklist adds ~150 tokens to output; current cap is 1000.
   - What's unclear: whether truncation is actually observed in practice.
   - Recommendation: Increase to 1500 as a precaution. Haiku pricing impact is negligible.

3. **Scraper client: does it need a `removed: true` signal or is `raw_ok=False` sufficient?**
   - What we know: `Listing.raw_ok=False` is set on HTTP errors including 404. The scraper client sends `raw_ok` in the batch payload.
   - What's unclear: Whether the scraper currently fetches individual listing pages to check 404 for known listings, or only scrapes the search results page for new URLs.
   - Recommendation: Phase 3 can use `raw_ok=False` as the 404 signal IF the scraper checks known listing URLs on each run. If it only scrapes new URLs from search results, this approach won't work for known listings. Planner should confirm scraper behavior.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `max_tokens=1000` will be insufficient after adding checklist to schema | Pitfall 4 | Truncated JSON causes `JSONDecodeError` — mitigated by `_extract_json()` catch |
| A2 | Adding `ai_checklist` as a sub-key avoids collisions with existing SECTIONS structure | Pattern 8 | If frontend uses `ai_checklist` key for something else, conflict — check frontend JS |
| A3 | 7 criteria keys are sufficient for text-assessable BUYER_PROFILE criteria | SYSTEM_PROMPT addition | Might miss criteria; AI will mark extras as "unknown" which is safe |
| A4 | Scraper sends `raw_ok=False` for 404 listings | Sold/Removed Detection | If scraper doesn't check existing listing URLs, INTEL-03 cannot work via this mechanism |
| A5 | Token estimate: anchor block adds ~200 input tokens, checklist adds ~150 output tokens | Don't Hand-Roll | If estimate is wrong and context window is an issue, truncation occurs — but Haiku has 200K context window |
| A6 | PRICE_DROP_THRESHOLD default of 0.05 (5%) is appropriate | config.py addition | Too sensitive (many false positives) or too insensitive (misses real drops) |

---

## Sources

### Primary (HIGH confidence)

- `app/ai_evaluator.py` — direct read: SYSTEM_PROMPT structure, evaluate_listing() signature, API call, fallback dict, setdefault pattern [VERIFIED]
- `app/data_store.py` — direct read: DEFAULT_APP_DATA, RLock, load_app_data() setdefault pattern, add_to_pending() lock behavior [VERIFIED]
- `app/ingest_handler.py` — direct read: process_ingest_batch() full flow, dedup pattern, lock scope [VERIFIED]
- `app/config.py` — direct read: all env vars, BUYER_PROFILE content [VERIFIED]
- `app/kv_listing_parser.py` — direct read: Listing dataclass fields (no district field) [VERIFIED]
- `app/telegram_client.py` — direct read: send_message() signature, send_pending_card() [VERIFIED]
- `app/static/index.html` — direct read: SECTIONS structure, checklist item IDs, existing checklists shape, buildPendingCard(), renderMain() [VERIFIED]
- `app/tests/conftest.py` — direct read: fixture patterns, mock_telegram, mock_send_pending_card [VERIFIED]
- `app/tests/test_ingest.py`, `test_pending.py`, `test_heartbeat.py` — direct read: test structure and patterns [VERIFIED]
- `.planning/phases/03-ai-quality-price-intelligence/03-CONTEXT.md` — direct read: all D-NN decisions [VERIFIED]

### Secondary (MEDIUM confidence)

None — all findings are directly from codebase reads.

### Tertiary (LOW confidence)

- Token estimates (A1, A5) — derived from schema structure analysis, not empirical measurement

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages; all existing
- Architecture: HIGH — derived directly from reading all relevant source files
- Pitfalls: HIGH — most discovered from direct code inspection (RLock, lock scope, missing Listing.district field)
- Checklist storage shape: HIGH — derived from index.html SECTIONS analysis and data_store structure
- Token estimates: LOW — not empirically measured

**Research date:** 2026-07-08
**Valid until:** 2026-08-08 (stable codebase; no external deps to expire)
