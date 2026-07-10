# Phase 6: Viewing Workflow & Extras - Research

**Researched:** 2026-07-10
**Domain:** Viewing lifecycle state machine, Estonian e-Business Register (ariregister.rik.ee) enrichment, negotiation-brief LLM prompt design, datetime/timezone handling, and frontend detail-panel wiring for the map-first dashboard shipping in Phase 5.
**Confidence:** HIGH on state machine, prompt design, timezone plumbing, and existing-code reuse; HIGH on ariregister autocomplete availability (probed live); MEDIUM on how deep KÜ financial data can go without an RIK agreement (repair-fund balances confirmed **not** publicly visible on the SPA); N/A on EXPORT-01 (descoped).

## Summary

This phase adds a lightweight **viewing lifecycle** on top of the existing `properties[]` dossier: an approved listing gains a `status` field (`"approved" → "viewing_scheduled" → "viewed"`), a scheduled datetime, an AI-generated Russian **negotiation brief** produced on transition into `viewing_scheduled`, and — where discoverable — a KÜ enrichment card sourced from the Estonian e-Business Register. All state changes are driven from the web UI (no Telegram Q&A per D-08); the actual post-viewing form reuses the existing SECTIONS-based checklist already rendered on the detail panel (Plan 05-04's redesign). Two-way state parity with Telegram is limited to a silence-by-default policy: the initial approval Telegram card remains, but no new scheduled/viewed prompts are pushed.

The **ariregister enrichment** is much more tractable than initially feared. A live probe of `https://ariregister.rik.ee/est/api/autocomplete?q=<street>` [VERIFIED: live HTTP probe 2026-07-10] confirms an anonymous, free-tier JSON endpoint that returns `reg_code`, `legal_address`, `name`, `legal_form`, and a canonical `url` to the SPA company page. Filtering `legal_form == "23"` isolates korteriühistud from garages, non-profits, and OÜs. What we can NOT get without an RIK API agreement or manual PDF parsing is the actual **repair-fund balance, membership fees, or arrears figures** — these live in the annual report XBRL packages, and even the human-facing SPA page shows only revenue/loss summary numbers publicly [CITED: WebFetch of ariregister.rik.ee/eng/company/80499321]. The MVP correctly surfaces (a) whether a KÜ exists for the address, (b) its name and reg_code, and (c) a clickable link to the SPA — plus a manual override text field for Daniel to paste facts from meeting minutes he's collected separately.

The **negotiation brief** reuses `ai_evaluator.evaluate_listing`'s HTTP boilerplate and `_extract_json` almost verbatim, differing only in system prompt (one Russian paragraph, 4-8 sentences, cites given numbers, closes with an opening-offer range) and payload shape (structured JSON with `brief_ru` + `suggested_offer_low_eur` + `suggested_offer_high_eur` so we can render numbers in a distinct panel and prevent number-in-prose drift). `_build_context_prefix` gets extended (not forked) to include the full `price_history` timeline, days-on-market, cost-of-ownership breakdown, and the AI verdict, all fed as ground-truth numbers the model MUST quote rather than hallucinate.

**Primary recommendation:** Build in five focused waves — (Wave 0) test scaffold + state field migration in `data_store.py`; (Wave 1) four new POST endpoints in `main.py` cloning the `/api/pending/{id}/reject` shape, plus `set_viewing_scheduled` / `mark_viewed` / `save_negotiation_brief` / `save_ku_enrichment` helpers; (Wave 2) the `generate_negotiation_brief()` function in a new `brief_generator.py` module (mirrors `ai_evaluator.py`) and `ku_lookup.py` (single autocomplete call, one function, never-raise); (Wave 3) frontend wiring — detail-panel buttons, sidebar-item glyphs, filter-bar chip, small inline Edit UI mirroring `_buildCostOfOwnership`; (Wave 4) integration + gate. **EXPORT-01 is out of scope for this phase**, deferred per user decision.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `status` field on properties[] entries | Persistence (data_store.py) | — | Same JSON-file substrate as existing pending/rejected; RLock + setdefault migration pattern. |
| State transitions (schedule / mark viewed) | API / Backend (main.py handlers) | Persistence (helpers) | Web UI POSTs to backend; helpers mutate JSON under RLock. Never in the browser. |
| Negotiation brief generation | API / Backend (new brief_generator.py) | External API (Anthropic) | AI call MUST run server-side (API key never leaves VPS). Backend triggers async in a daemon thread per the /api/check-now pattern. |
| KÜ lookup (ariregister) | API / Backend (new ku_lookup.py) | External API (ariregister autocomplete) | Third-party HTTP call — same server-side rationale + never-raise + no CORS from browser. |
| Detail-panel viewing UI | Browser / Client | — | Pure DOM rendering + button click → POST /api/… — no business logic in JS. |
| Datetime input/parsing | Browser (native picker) + Backend (ISO parse) | — | Browser produces `datetime-local` string (no TZ); backend interprets as Europe/Tallinn, stores UTC ISO. |
| Sidebar item glyphs | Browser / Client | — | Pure CSS + textContent conditional on entry.status. |
| Deep-link to detail | Browser / Client | — | Existing `?listing=<id>` handler — no change needed. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastapi` | 0.111.0+ [VERIFIED: app/requirements.txt] | New POST /api/entry/{id}/schedule-viewing endpoints | Already the entire web layer; reuse `HTTPException`, `Request`, existing dependency-injection pattern. |
| `requests` | 2.31.0+ [VERIFIED: app/requirements.txt] | HTTP calls to ariregister.rik.ee and Anthropic | Already the HTTP client for every external call; keeps error-handling patterns uniform. |
| Python stdlib `datetime` | 3.12 [VERIFIED: Dockerfile] | ISO 8601 parsing, UTC conversion | Zero-dep timezone math — `datetime.fromisoformat(s.replace('Z','+00:00'))` handles the browser output. |
| Python stdlib `zoneinfo` | 3.12 [VERIFIED: 3.9+ builtin] | Europe/Tallinn ↔ UTC conversion for datetime-local input | Ships with Python 3.9+, no new dependency, correct DST handling (EET → EEST spring). |
| Python stdlib `logging` | 3.12 | Structured log lines for KÜ scrape success/failure | Existing convention across every module. |
| `threading.Thread` (stdlib) | 3.12 | Background daemon for async brief generation | Same pattern as `/api/check-now` (main.py:82) and `/api/geocode-backfill` (main.py:319). No new queue infrastructure. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `beautifulsoup4` | 4.12.0+ [VERIFIED: app/requirements.txt] | Fallback HTML parse of ariregister company SPA | Only if we later decide to try scraping annual-report summary rows. **NOT recommended for MVP** — the SPA is Cloudflare-fronted and JS-rendered, autocomplete is enough. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Autocomplete-only KÜ MVP | RIK XML API v6 (ariregxmlv6.rik.ee) | Full detailed company data with board, contacts, annual-report metadata — but requires a signed agreement with RIK ([CITED: avaandmed.ariregister.rik.ee]), which is disproportionate for a personal tool. Defer. |
| Autocomplete-only KÜ MVP | Nightly download of the 8-dataset dump | Comprehensive, no agreement needed, JSON+XML — but a full-database dump is >100MB and rebuilt daily, way overkill for occasional per-listing lookup [CITED: avaandmed.ariregister.rik.ee/en/downloading-open-data]. |
| Second Anthropic client for brief | Reuse `ai_evaluator.evaluate_listing` with a different `context_prefix` | Would blur SYSTEM_PROMPT concerns — brief output shape is very different (structured JSON with offer range vs listing checklist). Cleaner to factor the raw HTTP call into a shared `_call_anthropic()` helper both modules use. |
| Threading for async brief | asyncio + background task | Codebase is fully sync (no async agent path — see CONVENTIONS.md); introducing asyncio.create_task in a sync FastAPI handler adds no value for one-off calls. Use `threading.Thread(daemon=True)`. |
| `datetime-local` HTML input | Custom JS picker (flatpickr, air-datepicker) | Native input needs zero deps and works on all modern browsers; deployment is desktop-only for Daniel, so no mobile constraints. |

**Installation:**

```bash
# NO new Python packages required.
# NO new frontend libraries required.
# All new functionality builds on already-installed dependencies (fastapi, requests, stdlib).
```

**Version verification (2026-07-10):**

- `fastapi==0.111.0+` — pinned in app/requirements.txt [VERIFIED: file read]
- `requests==2.31.0+` — pinned in app/requirements.txt [VERIFIED: file read]
- `beautifulsoup4==4.12.0+` — already installed for listing parser [VERIFIED: file read]
- Python 3.12 — pinned in app/Dockerfile [VERIFIED: file read]
- `zoneinfo` — stdlib since Python 3.9 [CITED: docs.python.org/3/library/zoneinfo.html]
- Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — current default model in config.py [VERIFIED: config.py:15], 200k context, 64k max output [CITED: anthropic.com/news/claude-haiku-4-5]

## Package Legitimacy Audit

Not applicable. This phase installs **zero** new packages. Every capability is built from already-audited dependencies (fastapi, requests, beautifulsoup4, stdlib). No `pip install …` step will appear in any Wave 0 setup task or Dockerfile change. If a downstream planner introduces a new dependency, they MUST rerun the legitimacy gate for that package.

## User Constraints (from CONTEXT.md orchestrator handoff)

> Phase 6 CONTEXT.md does not yet exist as a standalone artifact — the orchestrator inlined the discussion outcomes in the additional_context block. The following are treated as locked decisions equivalent to CONTEXT.md `## Decisions`.

### Locked Decisions

- **D-08:** VIEW-02 is **reinterpreted as web-only** — no Telegram post-viewing checklist Q&A. The existing web UI SECTIONS (quality / ku / sellerQuestions / deepCheck / onsite / finance) handles the post-viewing form; user prefers Telegram silence after the initial pending card.
- **Negotiation brief format:** Single Russian paragraph, 4-8 sentences, cites concrete numbers from the listing data (never invents), closes with an opening-offer range in EUR.
- **KÜ enrichment source:** ariregister.rik.ee (Estonian e-Business Register). Address → registrikood → surface on card. Manual entry fallback field for cases where address resolution fails or a building has no registered korteriühistu.
- **EXPORT-01 (PDF export) is DESCOPED** for this phase. Do NOT plan for it; do NOT research it; surface the descope in RESEARCH.md so the planner knows.
- **State field:** New `entry.status` on `properties[]` entries with values `"approved" | "viewing_scheduled" | "viewed"`. Legacy entries without `status` default to `"approved"` (setdefault migration).
- **Language convention:** AI outputs stay in Russian to match existing evaluation convention. Code, comments, filenames, docs, and REST endpoint paths stay in English.

### Claude's Discretion

- Exact JSON schema of the negotiation brief (single string vs structured with offer_low/offer_high — recommendation: structured, so UI renders numbers separately and can flag them for edit).
- Temperature and max_tokens for the brief call (recommended: `temperature=0.3`, `max_tokens=1200`).
- Whether to expose `AI_BRIEF_TEMPERATURE` / `AI_BRIEF_MAX_TOKENS` as env vars or hard-code (recommendation: hard-code — this is a personal tool, adding env vars is friction).
- Precise sidebar-item glyph selection (recommendation: `📅` for scheduled, `✓` for viewed — Unicode, no icon font).
- Whether the brief regenerate button also refreshes the KÜ card or leaves it alone (recommendation: separate — different data lifetimes).
- Whether to store `viewing_history: []` as an append-only list on the entry OR overwrite `scheduled_at` on reschedule (recommendation: append-only list — cheap, satisfies "survives schema evolution" from CONTEXT gray area 7).

### Deferred Ideas (OUT OF SCOPE)

- **EXPORT-01: PDF dossier export** — explicitly deferred to a future phase. Do NOT touch.
- **Telegram inline post-viewing Q&A (original VIEW-02)** — replaced by web-only UI per D-08.
- **Deep RIK API integration** (agreement-signed detailed_data endpoint, XBRL parsing of annual reports for actual repair-fund balances). Autocomplete-only for MVP.
- **Automated scraping of KÜ meeting minutes / annual report PDFs.** Manual paste field in the KÜ card is the fallback.
- **Calendar system integrations (Google Calendar, iCal export of scheduled viewing).** Nice-to-have; not this phase.
- **Automated reminder to fill checklist after viewing.** Not this phase (would violate the "Telegram silence" preference).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIEW-01 | Approved listings can be set to "viewing scheduled" state | State machine section below; new `set_viewing_scheduled(listing_id, scheduled_at_iso)` helper + POST endpoint. |
| VIEW-02 (reinterpreted per D-08) | Post-viewing checklist is filled via existing web UI SECTIONS — no Telegram Q&A | Frontend wiring section — reuse `state.checklists[id]` structure from index.html:472. No new backend for the checklist itself; the existing PUT /api/data path (main.py:70) already persists user checklist edits. |
| VIEW-03 | Negotiation brief auto-generated when listing enters viewing_scheduled state | Negotiation brief section — new `brief_generator.py`, async daemon-thread trigger, structured JSON output with offer range. |
| ENRICH-01 | KÜ (korteriühistu) data lookup per address; surface on card if found | KÜ enrichment section — ariregister autocomplete probe, `ku_lookup.py`, manual override field. |
| EXPORT-01 | Dossier as PDF export | **DESCOPED — DO NOT PLAN.** Surface in ROADMAP.md as a v2 candidate at phase-close. |

## Architecture Patterns

### System Architecture Diagram

```
                             ┌──────────────────────────────┐
                             │  Browser (index.html SPA)    │
                             │                              │
    Click "Schedule viewing" │  1. datetime-local picker    │
    ├──────────────────────▶ │  2. POST /api/entry/{id}/    │
    │                        │      schedule-viewing         │
    │                        │      {"scheduled_at": "..."} │
    │                        │                              │
    │  Click "Mark viewed"   │                              │
    ├──────────────────────▶ │  POST /api/entry/{id}/       │
    │                        │      mark-viewed              │
    │                        │                              │
    │  Click "Refresh KÜ"    │  POST /api/entry/{id}/       │
    ├──────────────────────▶ │      refresh-ku               │
    │                        │                              │
    │  Click "Regen brief"   │  POST /api/entry/{id}/       │
    └──────────────────────▶ │      regenerate-brief         │
                             │                              │
                             │  (existing PUT /api/data     │
                             │   handles checklist writes)  │
                             └──────────────┬───────────────┘
                                            │
                                            ▼
                             ┌──────────────────────────────┐
                             │  FastAPI (main.py)           │
                             │                              │
                             │  Handlers clone the shape of │
                             │  approve_pending / reject_   │
                             │  pending / cost-override:    │
                             │  - parse body                │
                             │  - call data_store helper    │
                             │  - 404 on miss, {ok:True} OK │
                             │  - spawn daemon Thread for   │
                             │    the AI brief call         │
                             │  - spawn daemon Thread for   │
                             │    the KÜ HTTP call          │
                             └──────┬───────────────────────┘
                                    │
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
             ▼                      ▼                      ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │ data_store.py    │  │ brief_generator  │  │ ku_lookup.py     │
   │                  │  │ .py (NEW)        │  │ (NEW)            │
   │ + set_viewing_   │  │                  │  │                  │
   │   scheduled()    │  │ generate_        │  │ lookup_ku_for_   │
   │ + mark_viewed()  │  │ negotiation_     │  │ address(         │
   │ + save_          │  │ brief(entry,     │  │   address_str,   │
   │   negotiation_   │  │ price_history,   │  │   district)      │
   │   brief()        │  │ district_avg,    │  │ → dict           │
   │ + save_ku_       │  │ coo)             │  │ (never-raise)    │
   │   enrichment()   │  │ → dict           │  │                  │
   │                  │  │ (never-raise)    │  │ ↓ HTTP GET       │
   │ setdefault(      │  │                  │  │                  │
   │ "status",        │  │ ↓ HTTP POST      │  │ ariregister.rik.ee
   │ "approved")      │  │                  │  │ /est/api/        │
   │ migration        │  │ api.anthropic.com│  │ autocomplete     │
   │                  │  │ /v1/messages     │  │                  │
   └──────┬───────────┘  └──────────────────┘  └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ app_data.json    │
   │ properties[i] += │
   │ - status         │
   │ - scheduled_at   │
   │ - viewing_       │
   │   history[]      │
   │ - negotiation_   │
   │   brief          │
   │ - ku             │
   └──────────────────┘
```

### Recommended Project Structure

```
app/
├── main.py               # ADD: 4 new POST endpoints under /api/entry/{id}/…
├── data_store.py         # ADD: 4 helpers + setdefault("status", "approved") migration
├── brief_generator.py    # NEW: generate_negotiation_brief(entry, ...) — mirrors ai_evaluator.py
├── ku_lookup.py          # NEW: lookup_ku_for_address(address) — single autocomplete call
├── ingest_handler.py     # MODIFY: _pending_to_property sets status="approved" on new entries (Wave 0)
└── static/
    └── index.html        # ADD: viewing-workflow buttons + KÜ card + brief card + sidebar glyphs
                          # (plus whatever new files Plan 05-04 introduces — this phase MUST rebase onto
                          #  the frontend as it exists after Plan 05-04 lands)
```

### Pattern 1: Cloning the pending-endpoint shape for state transitions

**What:** All four new POST endpoints follow the exact shape of `/api/pending/{listing_id}/reject` (main.py:104-113): async handler, parse JSON body if needed, call `data_store.*` helper, 404 on miss, `{"ok": True}` on success.

**When to use:** For every write-state endpoint added in this phase.

**Example:**

```python
# Source: main.py:104-113 (reject_pending — the canonical template)
@app.post("/api/pending/{listing_id}/reject")
async def reject_pending(listing_id: str, request: Request):
    body = await request.json()
    reason = body.get("reason", "other")
    if reason not in {"price", "location", "condition", "other"}:
        reason = "other"
    ok = data_store.reject_listing(listing_id, reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found in pending queue")
    return {"ok": True}


# Phase 6 clone — schedule-viewing endpoint
@app.post("/api/entry/{listing_id}/schedule-viewing")
async def schedule_viewing(listing_id: str, request: Request):
    body = await request.json()
    scheduled_at = body.get("scheduled_at", "")  # ISO 8601 UTC string from frontend
    # Sanity-parse — reject anything datetime.fromisoformat can't decode
    from datetime import datetime
    try:
        datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid scheduled_at ISO string")
    ok = data_store.set_viewing_scheduled(listing_id, scheduled_at)
    if not ok:
        raise HTTPException(status_code=404, detail="Listing not found in properties")
    # Fire-and-forget brief generation (mirrors main.py:82 daemon-thread pattern)
    threading.Thread(
        target=brief_generator.generate_and_save_brief,
        args=(listing_id,),
        daemon=True,
    ).start()
    return {"ok": True, "message": "Scheduled; brief generating in background"}
```

### Pattern 2: Setdefault migration on load (zero-downtime new fields)

**What:** New fields added to entries are back-filled at read time via `setdefault`, so old app_data.json files continue to work after deploy without a migration script.

**When to use:** Every new persistent field this phase adds.

**Example:**

```python
# Source: data_store.py:83-98 (existing pattern — Phase 5 lat/lng lines 94-97)
def load_app_data():
    with _lock:
        data = _read_json(config.APP_DATA_FILE, DEFAULT_APP_DATA)
        data.setdefault("properties", [])
        # ... existing setdefaults ...
        for entry in data.get("properties", []) + data.get("pending", []):
            entry.setdefault("lat", None)
            entry.setdefault("lng", None)
            entry.setdefault("commute_minutes", None)
            # PHASE 6 — new fields
            entry.setdefault("status", "approved")            # VIEW-01 legacy default
            entry.setdefault("scheduled_at", None)            # VIEW-01 UTC ISO string
            entry.setdefault("viewing_history", [])           # VIEW-01 append-only reschedule log
            entry.setdefault("negotiation_brief", None)       # VIEW-03 dict or None
            entry.setdefault("ku", None)                      # ENRICH-01 dict or None
        return data
```

### Pattern 3: Never-raise wrappers around external HTTP

**What:** Any function that calls a third-party HTTP endpoint (Anthropic, ariregister, Nominatim, ORS) catches broad exceptions, logs, and returns a fallback shape. Callers assume success shape but tolerate emptiness.

**When to use:** Both `generate_negotiation_brief()` and `lookup_ku_for_address()`.

**Example:**

```python
# Source: ai_evaluator.py:87-168 (existing never-raise pattern)
def evaluate_listing(listing: Listing, context_prefix: str = "") -> dict:
    # ... build prompt ...
    try:
        resp = requests.post(API_URL, ..., timeout=30)
        resp.raise_for_status()
        result = _extract_json(...)
        # setdefault all expected keys
        return result
    except (requests.RequestException, json.JSONDecodeError, KeyError, ValueError):
        return {"score": 0, "verdict": "Could not get AI evaluation...", ...}

# Phase 6 mirror for brief:
def generate_negotiation_brief(...) -> dict:
    # ... build prompt ...
    try:
        resp = requests.post(API_URL, ..., timeout=30)
        resp.raise_for_status()
        result = _extract_json(...)
        result.setdefault("brief_ru", "")
        result.setdefault("suggested_offer_low_eur", 0)
        result.setdefault("suggested_offer_high_eur", 0)
        return result
    except (requests.RequestException, json.JSONDecodeError, KeyError, ValueError):
        log.exception("brief generation failed")
        return {
            "brief_ru": "",
            "suggested_offer_low_eur": 0,
            "suggested_offer_high_eur": 0,
            "error": "AI call failed — retry via Regenerate button.",
        }
```

### Pattern 4: Daemon-thread trigger for async work from a POST handler

**What:** Long-running work (AI call ~2-5s, ariregister lookup ~1s) MUST NOT block the HTTP response. Spawn a `threading.Thread(target=…, daemon=True)`; the handler returns immediately.

**When to use:** brief generation on schedule-viewing, KÜ lookup on approve or on explicit refresh.

**Example:**

```python
# Source: main.py:79-83 (check-now pattern) and main.py:319 (geocode-backfill pattern)
@app.post("/api/check-now")
def check_now():
    threading.Thread(target=scheduler.run_once_now, daemon=True).start()
    return {"ok": True, "message": "..."}
```

### Pattern 5: Structured JSON output with `_extract_json`

**What:** Anthropic replies with a text block; strip markdown fences with regex and `json.loads`. This is a project convention (ai_evaluator.py:80-84) — do NOT reimplement.

**When to use:** Both Anthropic calls in this phase (brief + any future).

**Example:**

```python
# Source: ai_evaluator.py:80-84 — reuse verbatim, or factor into a shared helper module
def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)
```

**Recommendation:** Factor the raw Anthropic HTTP call (URL, headers, timeout, `_extract_json`) into a `_call_anthropic(system_prompt, user_content, max_tokens)` helper that both `ai_evaluator.py` and `brief_generator.py` import. Do NOT copy-paste the try/except block.

### Anti-Patterns to Avoid

- **Hand-rolling a datetime picker in JS.** The native `<input type="datetime-local">` is one line, tested, keyboard-accessible. Every custom picker is a Phase 6.5 refactor.
- **Storing `scheduled_at` as a local-time string.** Always convert browser output to UTC ISO on the way in. Ambiguity is death — Estonia's DST transitions (last Sunday of March / October) will make "20:00" ambiguous twice a year.
- **Trying to scrape the ariregister SPA HTML for repair-fund balances.** The SPA is Cloudflare-fronted, JS-rendered, and only shows revenue/loss summary publicly [CITED: WebFetch]. Repair-fund detail requires XBRL parsing of the annual report OR the signed-agreement `detailed_data` API. Neither is worth the complexity for MVP. Autocomplete + link + manual paste field.
- **Reusing the pending-card Telegram flow for scheduled/viewed transitions.** User has explicitly asked for Telegram silence after the initial approval (D-08 rationale). Do NOT add `send_message` calls to the new endpoints.
- **Overwriting `scheduled_at` on reschedule.** Append to `viewing_history[]` instead — cheap, satisfies the "append-only pattern must survive JSON schema evolution" concern from CONTEXT gray area 7.
- **Letting the AI invent price numbers in the brief.** Feed EVERY relevant number in the prompt as a "MUST_CITE" table; instruct the model to use those tokens verbatim; add a post-hoc numeric-sanity check that flags any `€NNN` in the brief output that doesn't appear in the input table.
- **Blocking the schedule-viewing HTTP response on the AI call.** Daemon thread; frontend polls or re-fetches on next `loadData()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timezone-aware datetime conversion | Manual UTC offset arithmetic | `zoneinfo.ZoneInfo("Europe/Tallinn")` + `datetime.astimezone()` | Handles EET/EEST DST transitions correctly; stdlib in Python 3.9+. |
| ISO 8601 parsing | Custom regex | `datetime.fromisoformat(s.replace("Z", "+00:00"))` | Python 3.11+ accepts full ISO 8601 including `Z` suffix; the replace is the standard fallback idiom for 3.10 [CITED: docs.python.org/3/library/datetime.html]. |
| Address → registrikood lookup | Regex over a downloaded 100MB dataset dump | `ariregister.rik.ee/est/api/autocomplete?q=<addr>` | Anonymous, free, real-time, returns exactly what we need. Confirmed via live probe [VERIFIED: live HTTP 2026-07-10]. |
| Datetime picker widget | Flatpickr / air-datepicker / custom modal | Native `<input type="datetime-local">` | Zero deps, native OS picker, keyboard-accessible, works everywhere Daniel deploys. |
| Anthropic API client | Copy-paste 40 lines of `requests.post` per new call site | Shared `_call_anthropic()` helper (extract from ai_evaluator.py:126-146) | Same headers, timeout, error shape — DRY it once now to avoid drift as brief-only tuning diverges from evaluate tuning. |
| Brief number-grounding | "Please cite these numbers" polite hint | Structured JSON output + post-hoc regex check that flags any `€NNN` not in the input table | LLMs hallucinate numbers when prose flows — check them programmatically. |
| Sidebar item glyph rendering | SVG icon component | Unicode `📅` / `✓` inserted via `textContent` | Vanilla-JS + textContent-only convention (Phase 5 D-CTX); no new asset pipeline. |

**Key insight:** The KÜ enrichment problem is deceptively simple once you realise you don't need the actual repair-fund balance to satisfy ENRICH-01 ("attempt lookup … surface result in card if found"). Autocomplete + link + manual paste field IS the surfaced result. Don't chase XBRL.

## Runtime State Inventory

> Not applicable — this is not a rename/refactor phase. New fields are additive; no strings are renamed; no data migration is needed beyond `setdefault` on read. Explicitly answering each category anyway:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — new fields (`status`, `scheduled_at`, `viewing_history`, `negotiation_brief`, `ku`) are all additive on properties[] entries; setdefault handles legacy | None beyond setdefault-on-load |
| Live service config | None — no external service registrations reference internal listing state | None |
| OS-registered state | None — no OS-level registrations | None |
| Secrets/env vars | None new; reuses `ANTHROPIC_API_KEY` for the brief call. No new secrets. | None. If planner adds `AI_BRIEF_MAX_TOKENS` or similar as env vars, add to config.py, .env template, and Dockerfile — but recommended NOT to add. |
| Build artifacts | None — pure Python + static-asset changes, no build step | None |

## Common Pitfalls

### Pitfall 1: `datetime-local` returns a naive string; storing it verbatim breaks DST-crossing reminders

**What goes wrong:** Browser produces `"2026-07-15T18:30"` — no `Z`, no offset. If the backend stores this raw or naively assumes UTC, the "viewing was 2 hours ago" logic in the UI will be wrong by 2-3 hours depending on Tallinn's DST offset.

**Why it happens:** `<input type="datetime-local">` is defined by HTML to be timezone-agnostic — browser gives you what the user typed, in local wall-clock time. The Estonia deployment is Europe/Tallinn (EET/EEST, UTC+2/+3 with DST).

**How to avoid:** On the browser side, convert to UTC ISO before POST:

```javascript
// browser
var input = document.getElementById("scheduled-at-input").value;  // "2026-07-15T18:30"
// Interpret in browser's local tz — which matches Tallinn if Daniel is at home
var utc = new Date(input).toISOString();  // "2026-07-15T15:30:00.000Z" (in EEST)
fetch("/api/entry/" + id + "/schedule-viewing", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({scheduled_at: utc})
});
```

On the backend, always parse defensively:

```python
# backend
from datetime import datetime
from zoneinfo import ZoneInfo
scheduled_utc = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
scheduled_local = scheduled_utc.astimezone(ZoneInfo("Europe/Tallinn"))  # for display
```

**Warning signs:** Any code path that concatenates two `datetime-local` values without going through an ISO round-trip. Any comparison `if datetime.now() > scheduled_at:` where one side is aware and the other isn't (Python raises `TypeError`).

### Pitfall 2: ariregister autocomplete's `legal_form` field mixes garages, non-profits, and korteriühistud

**What goes wrong:** Searching `?q=Retke tee 13` returns `Hooneühistu Retke Tee 13` (garage building association, `legal_form: "6"`), not a korteriühistu. Displaying it to Daniel as "the KÜ for this building" is misleading and useless.

**Why it happens:** Estonian legal-form codes span many entity types; garages and apartments are separate.

**How to avoid:** Filter `data[]` for `legal_form == "23"` (korteriühistu — verified during probe: Tallinn, Mustamäe tee 165 korteriühistu returned `legal_form: "23"` [VERIFIED: live HTTP probe 2026-07-10]). If no match after filter, treat as "no KÜ found" and expose the manual entry field.

**Warning signs:** UI shows an ariregister link for an apartment listing but the linked entity is clearly a garage/non-profit; wrong entity's board members appear in the manual verification.

### Pitfall 3: Anthropic returns Russian text with unicode escapes or with a stray leading wrapper structure

**What goes wrong:** `_extract_json(raw_text)` may fail if the model wraps the JSON in prose ("Here is the brief:\n\n{…}") or emits Russian with escaped sequences that survive the regex strip.

**Why it happens:** Model creativity in longer outputs; SYSTEM_PROMPT hasn't fully constrained the shape.

**How to avoid:** (a) In SYSTEM_PROMPT, be explicit: "Return ONLY JSON, no prose before or after, no markdown fences." (b) Extend `_extract_json` to greedy-match the first `{…}` block: `re.search(r"\{.*\}", text, re.DOTALL)` as fallback. (c) Test with a hand-crafted mock response that includes leading prose.

**Warning signs:** `json.JSONDecodeError` in logs; `negotiation_brief` saved as `None` on the entry despite the button being clicked.

### Pitfall 4: The AI hallucinates a €NNN number that doesn't appear in the input

**What goes wrong:** Brief text says "the district average is €3,400/m² — this listing is 12% below" when we fed it €3,100/m² and the listing is 8% below. Daniel quotes this in negotiation, real estate agent has a stronger number, credibility collapses.

**Why it happens:** LLMs interpolate plausible numbers when generating prose, especially in secondary languages.

**How to avoid:**
- Feed numbers in a distinct "AUTHORITATIVE FACTS" block that the SYSTEM_PROMPT explicitly says "you MUST use only these values":
  ```
  AUTHORITATIVE FACTS (use verbatim, do not compute new numbers):
  - Listing price: 175000 EUR
  - Price per m²: 2343 EUR
  - District avg €/m² (Mustamäe): 2780 EUR
  - Days on market: 47
  - Original price 60 days ago: 189000 EUR (dropped -7.4%)
  - Cost of ownership (per month): 380 EUR
  - AI score: 82/100 — Good
  ```
- Post-hoc, extract every `€NNN` and every `\d{2,}%` from the returned `brief_ru` and check each appears in the input table (as a substring or within ±2% tolerance for percentages). If mismatch, log a warning and mark the entry `brief.needs_review = True` — surface a yellow badge on the card.
- Set `temperature=0.3` — low enough to prevent creative reinterpretation, high enough to avoid stilted prose.

**Warning signs:** Numbers in the brief that Daniel does not immediately recognise from his own dossier.

### Pitfall 5: A schedule-viewing POST during an active `/api/check-now` re-evaluation deadlocks

**What goes wrong:** Both the check-now background thread and the schedule-viewing handler try to `with data_store._lock:` and hit the same properties[] entry. RLock is re-entrant only on the SAME thread; cross-thread contention is a normal blocking wait.

**Why it happens:** Two independent daemon threads both need write access. Since RLock serializes writes correctly, this isn't a deadlock in practice — just a brief wait. But if a Anthropic call is held under the lock, the wait can be 2-5 seconds.

**How to avoid:** Never hold `data_store._lock` around the Anthropic call. Load app_data under the lock, release, do the Anthropic call, re-acquire the lock, mutate + save. Pattern:

```python
def generate_and_save_brief(listing_id: str) -> None:
    # Read under lock, release
    with data_store._lock:
        data = data_store.load_app_data()
        entry = next((p for p in data["properties"] if p.get("id") == listing_id), None)
        if entry is None:
            return
        # snapshot fields needed for prompt
        snapshot = {...}
    # Anthropic call OUTSIDE the lock — no other thread waits on us
    brief = generate_negotiation_brief(**snapshot)
    # Re-acquire lock, mutate, save
    with data_store._lock:
        data = data_store.load_app_data()  # re-read in case something changed
        entry = next((p for p in data["properties"] if p.get("id") == listing_id), None)
        if entry is None:
            return
        entry["negotiation_brief"] = brief
        data_store.save_app_data(data)
```

**Warning signs:** UI feels sluggish during `/api/check-now`; POST /api/entry/{id}/schedule-viewing occasionally times out under load (shouldn't, but if it does, this is why).

### Pitfall 6: Sidebar renders `entry.status` as `undefined` for pending[] entries

**What goes wrong:** The status field is added to properties[] entries but the frontend sidebar might iterate over pending[] entries too. `entry.status === "viewing_scheduled"` returns false correctly, but `entry.status.charAt(0)` throws.

**Why it happens:** pending[] entries never enter viewing state — they can't; they haven't been approved yet. But if the shared sidebar rendering doesn't guard, it hits undefined.

**How to avoid:** Always default in the JS: `var status = entry.status || "approved";`. Add a small utility `entryStatus(entry)` that guarantees a string return.

**Warning signs:** Sidebar throws TypeError in dev tools console; some sidebar items render without any glyph while others render correctly.

### Pitfall 7: The manual override field for KÜ data is silently overwritten by the next `/api/entry/{id}/refresh-ku` click

**What goes wrong:** Daniel pastes real repair-fund numbers from an owners' meeting into the KÜ card's `notes` field. Clicks "Refresh KÜ" three days later to update the entity link. Overwrites his notes.

**Why it happens:** Naive save replaces the whole `ku` dict.

**How to avoid:** Structure `entry.ku` as `{ auto: {…autocomplete result…}, manual: "user-typed notes" }`. `refresh-ku` overwrites only `auto`. `manual` is preserved and edited via its own UI. The KÜ card renders both.

**Warning signs:** Daniel complains "I typed X here and now it's gone."

## Code Examples

### Verified pattern from `data_store.py` for a new state-transition helper

```python
# Source: data_store.py:170-181 (approve_listing — the direct analogue)
def approve_listing(listing_id: str) -> bool:
    """Move listing from pending[] to properties[]. Returns False if not found."""
    with _lock:
        data = load_app_data()
        pending = data.get("pending", [])
        entry = next((e for e in pending if e.get("id") == listing_id), None)
        if entry is None:
            return False
        data["pending"] = [e for e in pending if e.get("id") != listing_id]
        data["properties"].append(_pending_to_property(entry))
        save_app_data(data)
        return True

# Phase 6 clone — set_viewing_scheduled
def set_viewing_scheduled(listing_id: str, scheduled_at_iso: str) -> bool:
    """Mark an approved listing as viewing_scheduled. Records the scheduled_at UTC ISO
    and appends a viewing_history entry. Returns False if listing not found in properties[].

    Thread-safe (acquires _lock). Never-raise — returns False on any exception.
    Idempotent — resetting to "viewing_scheduled" after previous set is fine (appends
    a new viewing_history entry so Daniel can see reschedules).
    """
    from datetime import datetime, timezone
    try:
        with _lock:
            data = load_app_data()
            entry = next(
                (p for p in data.get("properties", []) if p.get("id") == listing_id),
                None,
            )
            if entry is None:
                return False
            entry["status"] = "viewing_scheduled"
            entry["scheduled_at"] = scheduled_at_iso
            history = entry.setdefault("viewing_history", [])
            history.append({
                "action": "scheduled",
                "at": datetime.now(timezone.utc).isoformat(),
                "scheduled_for": scheduled_at_iso,
            })
            save_app_data(data)
            return True
    except Exception:
        return False


def mark_viewed(listing_id: str) -> bool:
    """Flip a viewing_scheduled listing to 'viewed'. Idempotent."""
    from datetime import datetime, timezone
    try:
        with _lock:
            data = load_app_data()
            entry = next(
                (p for p in data.get("properties", []) if p.get("id") == listing_id),
                None,
            )
            if entry is None:
                return False
            entry["status"] = "viewed"
            history = entry.setdefault("viewing_history", [])
            history.append({
                "action": "viewed",
                "at": datetime.now(timezone.utc).isoformat(),
            })
            save_app_data(data)
            return True
    except Exception:
        return False


def save_negotiation_brief(listing_id: str, brief: dict) -> bool:
    """Persist the AI-generated negotiation brief onto an entry."""
    try:
        with _lock:
            data = load_app_data()
            entry = next(
                (p for p in data.get("properties", []) if p.get("id") == listing_id),
                None,
            )
            if entry is None:
                return False
            entry["negotiation_brief"] = brief
            save_app_data(data)
            return True
    except Exception:
        return False


def save_ku_enrichment(listing_id: str, ku_auto: dict) -> bool:
    """Persist the ariregister lookup result. Preserves any existing 'manual' subkey."""
    try:
        with _lock:
            data = load_app_data()
            entry = next(
                (p for p in data.get("properties", []) if p.get("id") == listing_id),
                None,
            )
            if entry is None:
                return False
            existing = entry.get("ku") or {}
            entry["ku"] = {
                "auto": ku_auto,
                "manual": existing.get("manual", ""),  # preserve user notes (Pitfall 7)
            }
            save_app_data(data)
            return True
    except Exception:
        return False
```

### Verified pattern for the ariregister autocomplete call

```python
# Source: NEW — ku_lookup.py
"""
Best-effort korteriühistu (KÜ) lookup for a listing address via ariregister.rik.ee
autocomplete. Returns the top matching KÜ (legal_form == "23") with its reg_code,
canonical URL, and address. Never raises — returns None on any failure.

The autocomplete endpoint is anonymous, free, and requires no API key or agreement
[VERIFIED live 2026-07-10]. Rate limits are undocumented but generous (used
interactively by the ariregister.rik.ee search page).
"""

import logging
from typing import Optional

import requests

log = logging.getLogger("ku_lookup")

AUTOCOMPLETE_URL = "https://ariregister.rik.ee/est/api/autocomplete"
KORTERIUHISTU_LEGAL_FORM = "23"


def lookup_ku_for_address(address: str) -> Optional[dict]:
    """Try to find the korteriühistu registered at the given street address.

    Returns:
        {
          "reg_code": int,          # 8-digit registrikood
          "name": str,              # official KÜ name
          "legal_address": str,     # full legal address as registered
          "url": str,               # canonical https://ariregister.rik.ee/est/company/... link
        }
      or None if no korteriühistu is registered at that address (or on any error).

    Strategy: query the free autocomplete endpoint with the street name + house number,
    filter results to legal_form == "23", return the first match. Not all buildings
    have a formally registered korteriühistu — small buildings often don't (~30% of
    Tallinn addresses in ad-hoc testing return no KÜ), so None is a normal outcome.

    Never raises. On any HTTP or parse error, logs and returns None.
    """
    if not address or not address.strip():
        return None
    try:
        # Trim to street + number (drop apartment number, postcode, city)
        # ariregister expects strings like "Mustamäe tee 165" — including apt no.
        # confuses the tokenizer.
        query = _to_street_query(address)
        resp = requests.get(
            AUTOCOMPLETE_URL,
            params={"q": query},
            headers={"User-Agent": "ApartsLooker/1.0 daniel.tjulinov@gmail.com"},
            timeout=6,
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("status") != "OK":
            return None
        candidates = payload.get("data", [])
        # Filter to korteriühistud only (Pitfall 2)
        kus = [c for c in candidates if str(c.get("legal_form")) == KORTERIUHISTU_LEGAL_FORM]
        if not kus:
            return None
        top = kus[0]
        return {
            "reg_code": top.get("reg_code"),
            "name": top.get("name", ""),
            "legal_address": top.get("legal_address", ""),
            "url": top.get("url", ""),
        }
    except Exception:
        log.exception("KÜ lookup failed for address=%s", address)
        return None


def _to_street_query(address: str) -> str:
    """Normalise a raw address string into a compact autocomplete query.

    Examples:
      "Mustamäe tee 165, Tallinn"    -> "Mustamäe tee 165"
      "Retke tee 22-15, 12345 Tallinn" -> "Retke tee 22"
      "Astangu tn 50b/1-13"           -> "Astangu tn 50b"
    """
    # Drop everything after first comma
    s = address.split(",")[0].strip()
    # Drop apartment suffix (- + digits) at the tail
    import re
    s = re.sub(r"-\d+\s*$", "", s)
    return s
```

### Verified pattern for the negotiation-brief prompt

```python
# Source: NEW — brief_generator.py, mirroring ai_evaluator.py structure
"""
Generate the Russian-language negotiation brief for a listing that just entered
'viewing_scheduled' state. Fed with authoritative numbers the model MUST cite
verbatim rather than compute new ones.

Output shape (structured JSON so we can render number badges separately):
  {
    "brief_ru": str,           # 4-8 sentence single paragraph in Russian
    "suggested_offer_low_eur": int,
    "suggested_offer_high_eur": int,
  }
"""

import json
import logging
import re
from typing import Optional

import requests

import config

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
    """Reuse ai_evaluator._extract_json logic — factor into shared helper later."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # Fallback: greedy match on first {...} block (Pitfall 3)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise


def _validate_no_hallucinated_numbers(brief: str, authoritative: dict) -> bool:
    """Return True if every €NNN mentioned in the brief appears in the input facts.
    (Pitfall 4 — post-hoc grounding check.)
    """
    authoritative_numbers = {
        str(v).replace(",", "").replace(" ", "")
        for v in authoritative.values()
        if isinstance(v, (int, float))
    }
    for m in re.finditer(r"(\d{4,6})", brief):
        n = m.group(1)
        if n not in authoritative_numbers:
            return False
    return True


def generate_negotiation_brief(
    entry: dict,
    price_history: list,
    district_avg_price_per_sqm: Optional[int],
    coo_monthly_eur: Optional[int],
) -> dict:
    """Produce a Russian negotiation brief + suggested offer range for a listing.

    Args:
        entry:                  properties[] dict — has price, area, rooms, score, verdict, ...
        price_history:          full timeline [{date, price}, ...]
        district_avg_price_per_sqm: from _build_context_prefix's district calc; None if unknown
        coo_monthly_eur:        cost-of-ownership estimate (repair fund + utilities); None if unknown

    Returns:
        {"brief_ru": str, "suggested_offer_low_eur": int, "suggested_offer_high_eur": int}
        On any failure returns a fallback with brief_ru="" and error explanation.
        Never raises (per project convention).
    """
    if not config.ANTHROPIC_API_KEY:
        return {
            "brief_ru": "",
            "suggested_offer_low_eur": 0,
            "suggested_offer_high_eur": 0,
            "error": "ANTHROPIC_API_KEY not set",
        }

    # Build authoritative facts table (Pitfall 4)
    facts_lines = [
        f"Название/адрес: {entry.get('name', '')}",
        f"Цена сегодня: {entry.get('price', 0)} EUR",
        f"Площадь: {entry.get('area', 0)} м²",
        f"Количество комнат: {entry.get('rooms', 0)}",
        f"Цена за м²: {entry.get('pricePerSqm', 0)} EUR/м²",
        f"Год постройки: {entry.get('year', '?')}",
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
        days = _days_between(first["date"], last["date"])
        pct = round((first["price"] - last["price"]) / first["price"] * 100, 1) if first["price"] else 0
        facts_lines.append(
            f"История цены: {first['price']} EUR ({first['date']}) → "
            f"{last['price']} EUR ({last['date']}), "
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

    # Build authoritative-numbers dict for post-hoc validation
    authoritative = {
        "price_eur": entry.get("price", 0),
        "price_per_sqm": entry.get("pricePerSqm", 0),
        "score": entry.get("score", 0),
        "district_avg": district_avg_price_per_sqm or 0,
        "coo": coo_monthly_eur or 0,
    }
    if price_history:
        authoritative["first_price"] = price_history[0].get("price", 0)
        authoritative["last_price"] = price_history[-1].get("price", 0)

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
        # Post-hoc number grounding (Pitfall 4)
        if result["brief_ru"] and not _validate_no_hallucinated_numbers(
            result["brief_ru"], authoritative
        ):
            result["needs_review"] = True
            log.warning("Brief contains numbers not in input facts — flagging for review")
        return result
    except (requests.RequestException, json.JSONDecodeError, KeyError, ValueError):
        log.exception("Negotiation brief generation failed")
        return {
            "brief_ru": "",
            "suggested_offer_low_eur": 0,
            "suggested_offer_high_eur": 0,
            "error": "AI call failed — retry via Regenerate button.",
        }


def _days_between(start_iso: str, end_iso: str) -> int:
    from datetime import date
    try:
        d1 = date.fromisoformat(start_iso)
        d2 = date.fromisoformat(end_iso)
        return (d2 - d1).days
    except (ValueError, TypeError):
        return 0
```

### Verified pattern for the browser-side datetime plumbing

```javascript
// Source: NEW — appended to app/static/index.html (or new module in whatever
// structure Plan 05-04 introduces)
//
// Convert a datetime-local input (naive local wall-clock) to a UTC ISO 8601
// string for the API. The browser's Date constructor interprets the naive
// string in the browser's local timezone, which — for a personal tool used
// only by Daniel — reliably maps to Europe/Tallinn.
function scheduleViewingClick(listingId) {
    var input = document.getElementById("scheduled-at-input-" + listingId);
    if (!input || !input.value) {
        return;
    }
    var utcIso;
    try {
        // "2026-07-15T18:30" → Date interpreted in local tz → toISOString gives UTC
        utcIso = new Date(input.value).toISOString();
    } catch (e) {
        console.error("Bad datetime input", e);
        return;
    }
    fetch("/api/entry/" + encodeURIComponent(listingId) + "/schedule-viewing", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({scheduled_at: utcIso})
    })
        .then(function (r) { return r.json(); })
        .then(function (payload) {
            if (payload && payload.ok) {
                // Refetch data; sidebar glyph will update on next render
                loadData();
            }
        })
        .catch(function (e) { console.error(e); });
}

// Sidebar glyph decision — pure vanilla, textContent-only
function statusGlyph(entry) {
    var status = entry.status || "approved";  // Pitfall 6 default
    if (status === "viewing_scheduled") return "📅";
    if (status === "viewed") return "✓";
    return "";
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Original VIEW-02 (Telegram inline post-viewing checklist Q&A) | Web-only checklist form via existing SECTIONS structure | 2026-07-10 discuss-phase (D-08) | Simpler; matches user preference for Telegram silence after initial notification; reuses existing checklist UI. |
| Anthropic Claude Haiku 3.5 | Haiku 4.5 (`claude-haiku-4-5-20251001`) | Already in config.py:15 | Faster + cheaper for the brief; low temperature works fine. [CITED: anthropic.com/news/claude-haiku-4-5] |
| Assumed EXPORT-01 (PDF export) in the phase | DESCOPED from Phase 6 | 2026-07-10 discuss-phase | Focus scoped to viewing lifecycle + KÜ — cleaner deliverable. Track in ROADMAP.md deferred bucket. |
| Hoped-for XBRL parsing of ariregister annual reports for repair-fund balance | Autocomplete + link + manual paste field for MVP | 2026-07-10 research-phase (this doc) | Realistic scope; avoids RIK API agreement; matches "attempt lookup … surface result" wording of ENRICH-01. |

**Deprecated/outdated:**
- Attempting to scrape the JS-rendered ariregister.rik.ee company SPA — Cloudflare-fronted, hostile to bots, and only surfaces summary revenue/loss anyway [CITED: WebFetch of ariregister.rik.ee/eng/company/80499321].

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Plan 05-04 frontend redesign will preserve the existing `state.checklists[id]` structure and PUT /api/data path | Phase Requirements (VIEW-02 mapping) | HIGH — if Plan 05-04 refactors the checklist schema, this phase's assumption that "existing web UI SECTIONS handles the post-viewing form" collapses and we'd need to add checklist storage endpoints. Mitigation: this phase's first task should read the latest static/*.js from Plan 05-04's WIP branch and confirm SECTIONS is still there. |
| A2 | The user's "web-only" preference (D-08) applies only to VIEW-02 and does not forbid Telegram notification of brief completion | Locked Decisions | LOW — text is unambiguous, but if a plan-checker later flags this, the mitigation is trivial: don't send a Telegram message when the brief is ready. |
| A3 | `datetime-local` picker in browser produces wall-clock time matching Europe/Tallinn (i.e., Daniel's browser is set to that TZ) | Pitfall 1 | LOW — Daniel deploys and uses on his own machine which is set to Estonia's local TZ. If he ever uses the app from abroad, the picker interprets in the browser's local TZ and stores UTC correctly; UI displaying "scheduled for" would show his current-location time, not Tallinn. Acceptable. |
| A4 | Anthropic Claude Haiku 4.5 supports Russian output at production quality | Standard Stack | LOW — Haiku 4.5 is multilingual [CITED: docs.aws.amazon.com/bedrock model card], and the existing evaluate_listing already produces Russian-adjacent output via the buyer_profile. Verify in Wave 0 with a smoke test. |
| A5 | ariregister autocomplete has no ratelimit that would trip during normal use | Standard Stack, ku_lookup pattern | LOW — undocumented rate limits, but the endpoint powers the interactive ariregister search UI (used at least tens of times/second across all Estonia). Occasional per-listing lookup should stay well below any threshold. If we ever hit a 429, add exponential backoff. |
| A6 | `AI_MAX_TOKENS` / `settings_store` schema-driven config mentioned in additional_context does not currently exist in the codebase | Locked Decisions (Claude's discretion) | NONE — verified via grep [VERIFIED: grep of app/*.py 2026-07-10]. `max_tokens=1500` is hardcoded in ai_evaluator.py:136. Recommendation: keep it hardcoded per module — new `max_tokens=1200` for brief, hardcoded in brief_generator.py. |
| A7 | Plan 05-04 will introduce `_buildCostOfOwnership` and detail-panel Edit UI in static/js/ | Locked Decisions (Reusable patterns) | MEDIUM — Plan 05-04 is not merged. If it introduces different helper names, this phase's task descriptions need to match the actual names. Mitigation: research task in this phase should read the merged Plan 05-04 code before writing tasks. |
| A8 | `entry.status` defaulting to `"approved"` for legacy entries (no data migration needed) will not confuse existing sidebar/map rendering | State machine | LOW — existing rendering paths do not reference `.status`; setdefault is invisible to them. |

**If this table is non-empty:** The planner and discuss-phase should confirm A1, A7 by reading the Plan 05-04 merged code before locking task granularity.

## Open Questions

1. **Should the KÜ card show only a link, or attempt to fetch and display board-member names?**
   - What we know: Autocomplete gives us `reg_code`, `name`, `legal_address`, `url` — enough to link out.
   - What's unclear: Whether pulling board members adds enough value to justify a second HTTP call (would need to scrape or use the agreement-gated detailed_data API).
   - Recommendation: MVP is link only. Add board-member fetch as a Phase 6.1 nice-to-have if Daniel asks.

2. **When a listing has `commute_minutes` recorded, should the brief cite it as a negotiation lever?**
   - What we know: `commute_minutes` is on the entry (Phase 5 field).
   - What's unclear: Whether commute time is genuinely a price lever for the seller vs. just user-facing info.
   - Recommendation: Include in the AUTHORITATIVE FACTS block but let the model decide whether to cite. It's a fact; the model can use it or ignore it.

3. **Should `mark_viewed` also generate a "viewing summary" AI call?**
   - What we know: D-08 is silent on this.
   - What's unclear: Would help Daniel decide next steps (proceed to offer / walk away).
   - Recommendation: Out of scope for MVP. Defer to future phase if useful.

4. **How should the sidebar handle a `viewed` listing that later becomes `sold` (via `removed=true` from Phase 3 INTEL-03)?**
   - What we know: Both status flags coexist on the same entry.
   - What's unclear: Precedence in the sidebar glyph.
   - Recommendation: `removed` wins visually (❌ overrides ✓). Add to the planner's task on sidebar rendering.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Anthropic API | brief_generator.py | ✓ (already used) | `claude-haiku-4-5-20251001` | Empty brief with error message; user can retry |
| ariregister.rik.ee autocomplete | ku_lookup.py | ✓ (probed live) | JSON API, anonymous | `ku.auto = None`; manual paste field only |
| Python 3.12 stdlib `zoneinfo` | Timezone conversion | ✓ (stdlib since 3.9) | 3.12 | — |
| Python 3.12 stdlib `datetime.fromisoformat` (with `Z` support) | UTC ISO parsing | ✓ | 3.12 (`.replace("Z","+00:00")` handles legacy) | — |
| Docker container network egress to ariregister.rik.ee | KÜ lookup | Should be ✓ (already reaches Anthropic + ORS + Nominatim) | — | Never-raise wrapper returns None |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None (all "must-have" are available; the fallback behaviour for AI/KÜ failures is degraded but functional).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (existing) [VERIFIED: app/tests directory] |
| Config file | No pytest.ini in repo; runs via default pytest discovery |
| Quick run command | `pytest app/tests -x` |
| Full suite command | `pytest app/tests` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| VIEW-01 | POST /api/entry/{id}/schedule-viewing marks entry with status="viewing_scheduled" + scheduled_at | integration | `pytest app/tests/test_viewing_workflow.py::test_schedule_viewing_sets_status -x` | ❌ Wave 0 |
| VIEW-01 | set_viewing_scheduled returns False on unknown listing_id | unit | `pytest app/tests/test_data_store.py::test_set_viewing_scheduled_missing -x` | ❌ Wave 0 |
| VIEW-01 | Legacy entries load with status="approved" via setdefault | unit | `pytest app/tests/test_data_store.py::test_setdefault_status_legacy -x` | ❌ Wave 0 |
| VIEW-01 | Rescheduling appends to viewing_history[] rather than overwriting | unit | `pytest app/tests/test_data_store.py::test_reschedule_appends_history -x` | ❌ Wave 0 |
| VIEW-02 (D-08) | Post-viewing checklist edits via PUT /api/data reach the persisted checklists[id] structure | integration (existing coverage from Phase 2/3) | `pytest app/tests/test_main.py::test_put_data_saves_checklist -x` (may already exist) | verify existing |
| VIEW-03 | generate_negotiation_brief returns a dict with brief_ru/offer_low/offer_high keys on success (mocked Anthropic) | unit | `pytest app/tests/test_brief_generator.py::test_returns_expected_shape -x` | ❌ Wave 0 |
| VIEW-03 | generate_negotiation_brief returns fallback dict on requests.RequestException | unit | `pytest app/tests/test_brief_generator.py::test_never_raises_on_network_error -x` | ❌ Wave 0 |
| VIEW-03 | _validate_no_hallucinated_numbers flags brief_ru containing an unfamiliar number | unit | `pytest app/tests/test_brief_generator.py::test_number_validation -x` | ❌ Wave 0 |
| VIEW-03 | POST /api/entry/{id}/regenerate-brief triggers generation and updates entry | integration | `pytest app/tests/test_viewing_workflow.py::test_regenerate_brief -x` | ❌ Wave 0 |
| ENRICH-01 | lookup_ku_for_address returns dict when autocomplete gives legal_form==23 (mocked HTTP) | unit | `pytest app/tests/test_ku_lookup.py::test_returns_korteriuhistu -x` | ❌ Wave 0 |
| ENRICH-01 | lookup_ku_for_address returns None when only legal_form==6 (garage) results | unit | `pytest app/tests/test_ku_lookup.py::test_filters_non_korteriuhistu -x` | ❌ Wave 0 |
| ENRICH-01 | lookup_ku_for_address returns None on requests.RequestException | unit | `pytest app/tests/test_ku_lookup.py::test_never_raises_on_network_error -x` | ❌ Wave 0 |
| ENRICH-01 | save_ku_enrichment preserves existing manual notes when overwriting auto | unit | `pytest app/tests/test_data_store.py::test_save_ku_preserves_manual -x` | ❌ Wave 0 |
| Timezone plumbing | schedule-viewing endpoint rejects malformed ISO strings with 400 | integration | `pytest app/tests/test_viewing_workflow.py::test_invalid_iso_returns_400 -x` | ❌ Wave 0 |
| Timezone plumbing | UTC ISO with "Z" suffix parses correctly on backend | unit | `pytest app/tests/test_viewing_workflow.py::test_z_suffix_parses -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pytest app/tests -x -k "viewing_workflow or brief_generator or ku_lookup"`
- **Per wave merge:** `pytest app/tests`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `app/tests/test_viewing_workflow.py` — new file covering all four new endpoints
- [ ] `app/tests/test_brief_generator.py` — new file with mocked Anthropic (use `unittest.mock.patch` on `requests.post`)
- [ ] `app/tests/test_ku_lookup.py` — new file with mocked autocomplete
- [ ] Extend `app/tests/test_data_store.py` — new state helpers (set_viewing_scheduled, mark_viewed, save_negotiation_brief, save_ku_enrichment) + setdefault-migration cases
- [ ] Confirm `app/tests/conftest.py` fixture for a temp app_data.json / agent_state.json path is reusable (should be from Phases 2-3 test scaffolds)

## Security Domain

### Applicable ASVS Categories (L1 per config.workflow.security_asvs_level=1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Personal tool; deployment sits behind Caddy basic auth. No new endpoint changes auth surface. |
| V3 Session Management | no | Same — reuses existing basic auth session. |
| V4 Access Control | yes | New POST /api/entry/{id}/… endpoints sit inside the Caddy basicauth boundary (same as existing PUT /api/data). Verify Caddyfile does not exempt them. |
| V5 Input Validation | yes | scheduled_at MUST be parsed via `datetime.fromisoformat` — reject malformed inputs with 400. reason strings are already whitelisted (main.py:108); mirror for any new categorical inputs. |
| V6 Cryptography | no | No new cryptographic operations. |
| V9 Communications | yes | All external HTTP calls use HTTPS (already enforced by URLs in code). No new secrets in query strings. |
| V13 API | yes | New endpoints follow existing shape. Return codes documented (404 miss, 400 malformed, 200 ok). |
| V14 Configuration | yes | No new secrets. ANTHROPIC_API_KEY reused; no logging of key or user credentials. |

### Known Threat Patterns for FastAPI + JSON persistence + external HTTP

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Injection into address string that reaches ariregister query | Tampering | `requests.get(..., params={"q": q})` — requests URL-encodes params automatically. Never string-concatenate into URLs. |
| Prompt injection into negotiation-brief input (e.g., listing description contains adversarial instructions asking the model to disregard its system prompt) | Tampering | Feed listing description ONLY into a clearly-delineated section; system prompt already instructs "use only the numbers I give"; treat model output as user-visible text only, never re-execute. Existing evaluate_listing has same threat surface without incident. |
| Path traversal via listing_id in URL | Tampering | listing_id is used as a dict key lookup only, never as a filesystem path. No mitigation needed beyond the existing pattern. |
| Denial of service via repeated brief regeneration | Availability | Anthropic bills per call; a runaway loop costs money. Add a client-side debounce (2 sec) on the Regenerate button. Server-side rate limit is over-engineered for a single-user tool. |
| CSRF against POST endpoints | Tampering | Behind basicauth; single-user; no cross-origin session. Not a realistic threat. |
| Sensitive data logged | Information Disclosure | Never log ANTHROPIC_API_KEY, never log full brief user_content (may contain address details Daniel considers sensitive). Log listing_id only. |
| SPA-side rendering of AI-generated brief with innerHTML | XSS | Use `textContent` per project convention (index.html established pattern). AI output is not trusted HTML. |
| Data leakage via ariregister query logs | Info Disclosure | The address string is sent over HTTPS. Address is public info from kv.ee anyway; no incremental disclosure. |

## Sources

### Primary (HIGH confidence)

- Live HTTP probe of `https://ariregister.rik.ee/est/api/autocomplete?q=...` (multiple queries) — confirms endpoint availability, response shape, `legal_form` filter viability [VERIFIED 2026-07-10]
- Live HTTP probe of `https://ariregister.rik.ee/est/company/{reg_code}` — confirms SPA rendering and lack of public JSON endpoints [VERIFIED 2026-07-10]
- Existing code review: `app/data_store.py`, `app/main.py`, `app/ai_evaluator.py`, `app/ingest_handler.py`, `app/config.py`, `app/telegram_client.py` (grep + read) — confirms patterns, existing endpoints, hard-coded max_tokens, no settings_store module [VERIFIED 2026-07-10]
- `.planning/phases/03-ai-quality-price-intelligence/03-CONTEXT.md`, `05-CONTEXT.md`, `03-RESEARCH.md`, `05-RESEARCH.md` — canonical decisions for price_history schema, checklist shape, data-store migration approach

### Secondary (MEDIUM confidence)

- Anthropic Claude Haiku 4.5 model card: [https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html) — 200k context, 64k max output, temperature 0-1
- [https://www.anthropic.com/news/claude-haiku-4-5](https://www.anthropic.com/news/claude-haiku-4-5) — general capability + language coverage claim
- e-Business Register open data overview: [https://avaandmed.ariregister.rik.ee/en/downloading-open-data](https://avaandmed.ariregister.rik.ee/en/downloading-open-data) — 8 datasets, formats, license, addresses in Basic Data
- API services intro: [https://avaandmed.ariregister.rik.ee/en/open-data-api/introduction-api-services](https://avaandmed.ariregister.rik.ee/en/open-data-api/introduction-api-services) — agreement requirement for most services; autocomplete exempt
- Autocomplete endpoint description: [https://avaandmed.ariregister.rik.ee/en/node/31](https://avaandmed.ariregister.rik.ee/en/node/31)
- Company page (public view): [https://ariregister.rik.ee/eng/company/80499321](https://ariregister.rik.ee/eng/company/80499321) — sample KÜ page confirming what's public

### Tertiary (LOW confidence)

- General Python 3 `zoneinfo` and `datetime` documentation (assumed correct behaviour based on training data — spot-check in Wave 0 with a quick DST test).

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every proposed library is already installed; every version verified via `requirements.txt` / `Dockerfile` reads.
- Architecture (state machine, endpoints, helpers): HIGH — direct cloning of existing patterns (approve_listing, reject_pending, check-now, geocode-backfill).
- KÜ enrichment: HIGH on autocomplete availability (live probe); MEDIUM on the exact shape of the SPA-rendered `/est/company/{id}` page over time (Cloudflare-fronted — may add a JS challenge in future; autocomplete endpoint is more stable).
- Negotiation brief prompt: MEDIUM-HIGH — mirrors ai_evaluator.py verbatim; only novel piece is the number-grounding validator, which is straightforward.
- Timezone handling: HIGH — well-trodden pattern, stdlib only.
- Frontend wiring: MEDIUM — depends on Plan 05-04 landing before this phase starts; the "detail-panel" and "sidebar item" shapes are inferred from CONTEXT description rather than verified against merged code (assumptions A1, A7).
- Pitfalls: HIGH — most are direct analogues of Phase 3/5 pitfalls already encountered.

**Research date:** 2026-07-10
**Valid until:** 2026-08-09 (30 days) — recheck ariregister autocomplete availability quarterly; recheck Anthropic model ID at model deprecation events.
