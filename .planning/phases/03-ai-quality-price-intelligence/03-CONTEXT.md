# Phase 3: AI Quality & Price Intelligence - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Improve AI evaluation quality by injecting calibration anchors (approved listing examples with scores) and district price/m² averages into the prompt, and by adding a structured pass/fail/unknown checklist to the evaluation output. Add price intelligence: track price history per listing across scrapes, compute days-on-market from first scrape date, detect 5%+ price drops and trigger re-evaluation, and mark listings as removed when their URL 404s.

Out of scope for Phase 3:
- Additional scraper sources (Phase 4)
- Map UI / interactive visualisations (Phase 5)
- Viewing workflow / negotiation briefs (Phase 6)
- Mäkler reply assistant (future)

</domain>

<decisions>
## Implementation Decisions

### Calibration Anchors (EVAL-01)
- **D-01:** Inject the top-scored 2–3 listings from `properties[]` (sorted by `score` descending) as calibration anchors into the evaluation prompt before asking for a new score. This gives the model real reference points so it stops clustering around 70.
- **D-02:** If fewer than 2 scored listings exist in `properties[]`, skip anchors silently — evaluate without them. No fallback to the pre-seeded default listings (they have no scores).
- **D-03:** Anchor format in the prompt: for each anchor include title/address, score, key fields (price/m², rooms, area, parking, material). One short paragraph per anchor.

### District Price/m² Context (EVAL-03)
- **D-04:** Compute the running price/m² average per district dynamically from all entries across `properties[]` and `pending[]` (all seen listings, not just approved). Group by the `district` field on each listing entry.
- **D-05:** Inject the district average as a single line in the evaluation prompt: `"District average price/m² (from seen listings in {district}): {avg} EUR/m²"`. If no listings exist for the listing's district, omit the line.

### Structured Checklist Output (EVAL-02)
- **D-06:** `evaluate_listing()` returns a new `checklist` key alongside `score`/`verdict`/`strengths`/`concerns`/`draft_body`. Value is a flat dict: `{criterion_name: "pass" | "fail" | "unknown"}`. The AI fills what it can from listing text; criteria it cannot assess → `"unknown"`.
- **D-07:** The checklist criteria are derived from the existing `app_data.checklists` structure in the codebase (executor reads the existing checklist keys from app_data to determine the field names). No new criteria are invented — match whatever checklist categories are already present.
- **D-08:** AI-filled checklist items are written to `app_data.checklists[listing_id]` at evaluation time (when the listing enters pending). Each entry carries `source: "ai"` to distinguish it from user-filled post-viewing answers. UI must visually distinguish AI-filled items (e.g., robot icon or different colour).
- **D-09:** User override: if Daniel fills a checklist item manually (via existing web UI), the `source` changes to `"user"` and the AI value is replaced. AI-filled items that haven't been overridden remain tagged `"ai"`.
- **D-10 (Context note):** The checklist has two kinds of criteria — text-assessable (price/m², rooms/area match, parking, renovation potential) and viewing-only (building condition, interior finish, etc.). The AI fills text-assessable ones; viewing-only items remain `"unknown"` until a physical viewing.

### Price History Storage (INTEL-01, INTEL-02)
- **D-11:** Price history lives in a new top-level key in `app_data.json`: `price_history: {listing_id: [{date: "YYYY-MM-DD", price: 175000}, ...]}`. Clean separation — does not touch `properties[]` or `pending[]` entries.
- **D-12:** The VPS ingest endpoint records `price_eur + today's date` into `price_history[listing_id]` for **every** listing it receives on every scrape run, regardless of whether the listing is new or already known. This is what enables drop detection.
- **D-13:** Days-on-market is computed dynamically as `today - price_history[listing_id][0].date` (first scrape date). No separate `first_seen_date` field — the first price_history entry IS the first-seen record. The dossier card renders this at display time.

### Re-evaluation on Price Drop (EVAL-04) and Sold/Removed Detection (INTEL-03)
- **D-14:** Price drop trigger: after recording the new price, compare it to the previous price_history entry. If `(prev_price - new_price) / prev_price >= 0.05` (≥5% drop), trigger re-evaluation for that listing.
- **D-15:** **Approved listings** (`properties[]`): re-evaluate with updated price context, update `score`/`verdict` on the entry, and send a Telegram notification noting the price drop and new score. Do NOT move back to pending.
- **D-16:** **Pending listings** (`pending[]`): re-evaluate silently and update the pending entry's `score`/`verdict`/`checklist`. No new Telegram card — Daniel reviews the updated score when he gets to the listing.
- **D-17:** **Previously-rejected listings** (`rejected[]`): re-queue only if `rejection_reason == "price"`. Create a new pending entry with a note that it was previously rejected for price and has since dropped. Other rejection reasons (location, condition) are not affected by a price change.
- **D-18:** **Sold/removed detection**: when the scraper sends a listing whose URL returns 404, the scraper-client should include a signal for this (or the VPS ingest handler detects a missing listing from the batch). Mark the listing in `properties[]` or `pending[]` with `removed_at: "YYYY-MM-DD"` and `removed: true`. Surface in the dossier card.

### Claude's Discretion
- Anchor format/wording in the prompt (D-03) — executor picks the clearest format
- Checklist criteria names/keys (D-07) — executor reads existing `checklists` structure and matches field names
- District average line wording in prompt (D-05) — executor picks clear phrasing
- Sold/removed signal mechanism (D-18) — whether the scraper includes a `removed: true` field or the VPS infers it from absent listings across two consecutive batches; executor chooses the simpler approach

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` EVAL-01, EVAL-02, EVAL-03, EVAL-04 — AI evaluation quality requirements
- `.planning/REQUIREMENTS.md` INTEL-01, INTEL-02, INTEL-03 — Price & listing intelligence requirements

### Existing VPS Code to Modify
- `app/ai_evaluator.py` — `evaluate_listing()`, `SYSTEM_PROMPT` — add anchors, district context, and `checklist` output field
- `app/ingest_handler.py` — `process_ingest_batch()` — record price history on every known listing; detect price drops; trigger re-evaluation; mark removed listings
- `app/data_store.py` — `DEFAULT_APP_DATA`, `load_app_data()` — add `price_history: {}` top-level key; add helpers for reading/writing price history; setdefault for zero-downtime migration
- `app/config.py` — add `PRICE_DROP_THRESHOLD = float(os.environ.get("PRICE_DROP_THRESHOLD", "0.05"))` env var
- `app/static/index.html` — render price history sparkline/list, days-on-market, AI checklist indicators with `source: "ai"` visual marker, removed/sold badge

### Scraper Client (read-only reference — may need a field addition)
- `scraper-client/` — `Listing` dataclass sent to VPS; executor should check if `price_eur` is already included (it is, from Phase 1); no changes required unless removed-URL signal is added

### Phase 2 Canonical Context (data model reference)
- `.planning/phases/02-queue-approval-workflow/02-CONTEXT.md` — pending entry structure; how `checklists[listing_id]` is currently populated; `data_store._lock` usage patterns

### Architecture Reference
- `.planning/codebase/ARCHITECTURE.md` — layer diagram; price history recording lands in the ingest/agent layer
- `.planning/codebase/CONVENTIONS.md` — never-raise pattern, RLock usage, boolean return convention

No external specs referenced during discussion.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ai_evaluator.SYSTEM_PROMPT` (module-level string) — extend with anchor injection and district average; anchors prepended to the `messages[0].content` user turn, not the system prompt, to keep system stable
- `ai_evaluator.evaluate_listing(listing)` — returns dict; add `checklist` key to existing response schema; add `setdefault("checklist", {})` to the fallback dict
- `data_store.load_app_data()` / `save_app_data()` + `_lock` — reuse for price_history reads/writes; same lock pattern
- `ingest_handler.process_ingest_batch()` — the natural home for price-drop detection; receives every listing on every scrape; runs after dedup
- `telegram_client.send_message()` — reuse for price drop + re-score notifications on approved listings (D-15)

### Established Patterns
- **Never-raise:** All new handlers (price drop, re-evaluation, sold detection) catch exceptions, log, continue
- **Thread-safe JSON:** `with data_store._lock:` wraps full load → modify → save
- **setdefault migration:** `load_app_data()` uses `setdefault()` for new keys — add `data.setdefault("price_history", {})` for zero-downtime deploy
- **Boolean return:** new data_store helpers follow `-> bool` pattern

### Integration Points
- `ingest_handler.process_ingest_batch()` — price history recording + drop detection added here; runs for every listing in every batch
- `ai_evaluator.evaluate_listing()` — anchor listings and district avg passed as parameters or module-level context; executor decides signature
- `app_data.checklists[listing_id]` — AI fills this at pending-entry creation time (ingest_handler calls data_store helper after evaluate_listing)
- `app/static/index.html` — price history, days-on-market, AI checklist badges added to existing card rendering; use `.textContent` only (no innerHTML)

</code_context>

<specifics>
## Specific Ideas

- **Anchor prompt block:** "Here are listings Daniel has previously approved, with their AI scores, as calibration reference:\n\nAnchor 1 — {title}, {district}\nScore: {score} | {rooms} rooms, {area}m², {price_per_sqm} EUR/m², {parking}\n\n[...]\n\nUse these as reference points when scoring the new listing below."
- **District average line:** `"District price/m² average ({district}, from {N} seen listings): {avg:.0f} EUR/m²"`
- **Checklist item shape:** `{"price_per_sqm": {"result": "pass", "source": "ai"}}` — executor may simplify to `{"price_per_sqm": "pass"}` with a parallel `checklist_sources` dict if simpler
- **Price drop Telegram note (approved listing):** `"📉 Price drop on {title}: {old_price} → {new_price} EUR (-{pct}%). Re-scored: {new_score}/100."`
- **Removed listing badge:** `"❌ Removed from kv.ee — {date}"` shown on dossier card
- **Scraper URL pre-filter note:** The kv.ee search URL already has filters applied (rooms, price range) — listings arriving at the VPS have already passed a basic kv.ee-side filter. The VPS pre-filter (MIN_ROOMS, MAX_PRICE_EUR) is a backstop.

</specifics>

<deferred>
## Deferred Ideas

- **Price history sparkline chart** — a mini chart of price over time on the dossier card. Nice-to-have; plain text list of price entries is sufficient for Phase 3, chart can be a Phase 5 UI enhancement.
- **Scraper sends explicit `removed: true` signal** — more elegant than VPS inferring removal from absent listing IDs across batches. Deferred to executor discretion (D-18).

</deferred>

---

*Phase: 3-AI Quality & Price Intelligence*
*Context gathered: 2026-07-08*
