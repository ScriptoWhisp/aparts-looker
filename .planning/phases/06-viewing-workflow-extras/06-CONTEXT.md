# Phase 6: Viewing Workflow & Extras - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn an approved listing into a viewing workflow: schedule a viewing, generate an AI negotiation brief on transition, let Daniel mark it "viewed" and fill the existing FULL_CHECKLIST in the web UI. Attempt best-effort korteriühistu (KÜ / remondifond) enrichment from Estonia's public e-Business Register and surface what's found on the detail card.

Not delivered in Phase 6 (deliberately descoped in discussion):
- **PDF export (EXPORT-01)** — dropped from scope; can revisit later.
- **Post-viewing Telegram checklist prompt (part of VIEW-02)** — no Telegram interaction after viewing; checklist stays a web-only surface.
- Additional scraper sources (Phase 4, still deferred).
- Any offer-tracking / decision workflow beyond marking a listing "viewed".

</domain>

<decisions>
## Implementation Decisions

### Viewing State Model (VIEW-01)

- **D-01:** Add `entry.status = "approved" | "viewing_scheduled" | "viewed"` to each `properties[]` entry (existing bucket — no new top-level list). Default for legacy entries is `"approved"` via a `setdefault` in `load_app_data()`. Matches the existing `rejection_reason` pattern on `rejected[]` entries — everything about a listing stays in one place, filters just check the field.
- **D-02:** `entry.viewing = {scheduled_at, brief, brief_generated_at, brief_source}` holds the current viewing record. `scheduled_at` is a full ISO datetime (not date-only) so downstream timers can fire at a precise moment.
- **D-03:** After Daniel taps "Mark viewed", `entry.status` flips to `"viewed"`. Enables a "walked but not decided" filter and a future decide/offer phase. No auto-transition — silence beats a wrong state change if the viewing is postponed.
- **D-04:** One viewing at a time on the entry. When a new viewing is scheduled after a previous one completes, the current `entry.viewing` is pushed into `entry.viewing_history[]` (append-only) and the new one takes its place. Rare in practice but not lossy when it happens.

### Negotiation Brief (VIEW-03)

- **D-05:** Pure-Claude free-form single paragraph. No structured sections, no bullet talking-points list — just a well-written 4-8 sentence paragraph that weaves in the listing's age, price trajectory (from `price_history[]`), how the €/m² compares to the district running average (Phase 3 D-04 helper), any renovation/parking signals, and a suggested opening offer range with reasoning. The AI receives the raw context (listing fields, price_history, district avg) so numbers stay grounded, but the output is prose not JSON.
- **D-06:** Trigger: auto-generate on the `approved → viewing_scheduled` transition (backend, one Anthropic call). Result stored on `entry.viewing.brief` with `brief_generated_at`. A "Regenerate brief" button on the detail card triggers a fresh call on demand (for use when the price drops or Daniel wants a second opinion). Every regeneration overwrites the field.
- **D-07:** Rendered only in the detail-panel — a dedicated "Negotiation brief" section below the AI Verdict block and above the cost-of-ownership card. Not sent to Telegram (per user: keep Telegram to the initial scrape notification only).

### Post-Viewing Flow (VIEW-02, reinterpreted)

- **D-08:** No Telegram interaction after viewing. The "prompt Daniel to fill the 11-category checklist inline" in the roadmap is reinterpreted as "let Daniel fill the existing web-UI FULL_CHECKLIST unassisted". No new Telegram bot dialog, no callback_query dispatcher extension for checklist Q&A.
- **D-09:** A "Mark viewed" button appears on the detail panel once `now >= entry.viewing.scheduled_at`. Clicking it POSTs a status transition to the backend (`entry.status = "viewed"`). The existing checklist UI (`window.FULL_CHECKLIST`, `checklists[listing_id].manual_checklist`) is already accessible on the same detail panel — no new UI plumbing needed for the checklist itself.
- **D-10:** Scheduling entry point: a "Schedule viewing" button on the detail panel for entries with `status = "approved"`. Opens a small inline datetime picker (native `<input type="datetime-local">` — no new dependency). On submit, POSTs to `/api/entry/{id}/schedule-viewing` which sets `entry.status = "viewing_scheduled"`, `entry.viewing.scheduled_at`, and kicks off brief generation in a background thread (mirrors the `/api/check-now` pattern).

### KÜ / Remondifond Enrichment (ENRICH-01)

- **D-11:** Best-effort scrape of the Estonian e-Business Register (`ariregister.rik.ee`) — no API key. For each approved listing, try to resolve the address → registered korteriühistu → latest majandusaasta aruanne (annual report). Extract whatever we can parse deterministically: KÜ monthly fee, repair-fund balance, arrears. Everything wrapped in the never-raise pattern; a failed lookup is a no-op, not an error.
- **D-12:** Trigger: fires once when a listing moves `pending → approved` (address is stable and Daniel has expressed interest). Result cached on `entry.ku_data = {looked_up_at, source_url, monthly_fee_eur, repair_fund_balance_eur, arrears_eur, raw_notes}` (all optional — any subset may be present). A "Refresh KÜ data" button on the detail panel lets Daniel force a re-fetch on demand.
- **D-13:** Rendered as a compact card in the detail panel, similar visual weight to the cost-of-ownership card. When nothing was found, the section is hidden entirely (no empty state — noise is worse than absence). Section header shows the `looked_up_at` timestamp so Daniel knows how fresh the data is.

### PDF Export (EXPORT-01) — Descoped

- **D-14:** Dropped from Phase 6 in discussion. Not implemented. Kept in Deferred Ideas below.

### Claude's Discretion

- The exact wording/tone of the negotiation-brief system prompt (D-05) — executor picks. Constraint: single-paragraph output, cites concrete numbers, includes an offer range.
- Where the "Schedule viewing" and "Mark viewed" buttons sit visually within the detail panel — executor picks placement based on the current layout (probably near the existing Approve/Reject/Draft-email row).
- Which HTML parser strategy for `ariregister.rik.ee` (regex vs BeautifulSoup CSS selectors) — executor picks based on how brittle the target page turns out to be. First-pass suggestion: BeautifulSoup with a small fallback if selectors change.
- Whether the KÜ lookup runs synchronously in the approval handler or is dispatched to a background thread — executor picks. Small enough that sync is fine, but if the registry site is slow, a thread mirrors the `/api/check-now` pattern.
- Whether legacy `properties[]` entries need a bulk-backfill endpoint for KÜ data or just wait for the "Refresh" button — executor decides based on how many exist.
- Sidebar / overview map badges for the new statuses (e.g. a small calendar icon for `viewing_scheduled`, a checkmark for `viewed`) — executor picks; not scope-critical.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` VIEW-01, VIEW-02, VIEW-03 — viewing state, post-viewing checklist, negotiation brief (note: VIEW-02 reinterpreted as web-only in D-08)
- `.planning/REQUIREMENTS.md` ENRICH-01 — korteriühistu (KT/remondifond) lookup
- `.planning/REQUIREMENTS.md` EXPORT-01 — dropped from Phase 6 per discussion; do not implement

### Existing VPS Code to Modify
- `app/data_store.py` — `load_app_data()` `setdefault` migration for `status`, `viewing`, `viewing_history`, `ku_data` fields on `properties[]` entries; new helpers along the lines of `set_viewing_scheduled(listing_id, scheduled_at, brief)`, `mark_viewed(listing_id)`, `update_ku_data(listing_id, data)`
- `app/main.py` — new endpoints: `POST /api/entry/{id}/schedule-viewing`, `POST /api/entry/{id}/mark-viewed`, `POST /api/entry/{id}/regenerate-brief`, `POST /api/entry/{id}/refresh-ku` (all follow the existing `cost-override` pattern from Phase 3.5 for lock+update+save)
- `app/ai_evaluator.py` — new function `generate_negotiation_brief(entry, price_history, district_avg) -> str` (or module: `negotiation_brief.py`); reuses `config.ANTHROPIC_MODEL` and the runtime-editable `AI_MAX_TOKENS` / `AI_DESCRIPTION_MAX_CHARS` settings
- New module `ku_lookup.py` — scrapes `ariregister.rik.ee`; called from the approval handler in `data_store.approve_listing` (or a wrapper in `main.py`)
- `app/static/index.html` + `app/static/js/detail-panel.js` — new "Negotiation brief" and "KÜ data" sections; "Schedule viewing" / "Mark viewed" / "Regenerate brief" / "Refresh KÜ" buttons; datetime picker for scheduling

### Existing Data & Patterns from Prior Phases
- `.planning/phases/03-ai-quality-price-intelligence/03-CONTEXT.md` — `price_history[]` structure (D-11/D-13), district avg helper (D-04/D-05), `checklists[id].manual_checklist` shape (D-08/D-09)
- `.planning/phases/05-map-overview-ui/05-CONTEXT.md` — detail-panel layout, sidebar item schema; how status filters should surface `viewing_scheduled` / `viewed`
- `app/static/index.html` `window.FULL_CHECKLIST` + `window.TEXT_ITEM_KEYS` — the 40+ item checklist Daniel fills post-viewing; already wired up in `detail-panel.js`, no new UI needed for the checklist itself

### External Data Sources
- `https://ariregister.rik.ee` — Estonian e-Business Register public search; researcher must probe the search + annual-report pages to see what selectors are stable
- `https://api.anthropic.com/v1/messages` — Claude (already configured with `ANTHROPIC_API_KEY`, hot-reload model via Settings tab); used for negotiation brief generation

### Architecture Reference
- `.planning/codebase/ARCHITECTURE.md` — layer diagram; new state transitions and KÜ scrape land in the agent + persistence layers
- `.planning/codebase/CONVENTIONS.md` — never-raise, RLock via `data_store._lock`, setdefault migrations

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `data_store.approve_listing(listing_id)` — natural hook to also trigger the KÜ lookup on approval
- `data_store._lock` — same RLock guards the new state transitions
- `ai_evaluator.evaluate_listing()` — the "call Claude with a rich JSON prompt" pattern is already there; extract the HTTP boilerplate for reuse in `generate_negotiation_brief()`
- `ingest_handler._build_context_prefix()` — computes district avg + calibration anchors; the same helper can feed the brief prompt
- `main.py` `_find_entry_any()` + the `cost-override` handler shape (from Phase 3.5) — direct template for the four new per-entry POST endpoints
- `detail-panel.js` `_buildCostOfOwnership(coo, entry)` + the inline Edit/Reset UI — mirror this shape for the new "Negotiation brief" and "KÜ data" cards
- `window.FULL_CHECKLIST` + existing checklist row rendering in `detail-panel.js` — zero new UI for the post-viewing checklist experience

### Established Patterns
- **Never-raise:** every new backend handler catches, logs, continues; a failed KÜ scrape or Claude call is a no-op, not a 500
- **Thread-safe JSON:** `with data_store._lock: load → mutate → save`
- **setdefault migration:** every new field on `properties[]` entries gets a `setdefault` in `load_app_data()` for zero-downtime deploy
- **Runtime settings hot-reload:** new AI-facing knobs (if any) plug into `settings_store._SCHEMA` and the Settings tab so they're editable without a restart
- **Background threads for slow work:** `/api/check-now` spawns a daemon thread; the negotiation-brief generation and KÜ lookup follow the same pattern so HTTP responses stay snappy
- **Deep-link `?listing=<id>`:** already wired; new state changes should still route through the detail panel via the existing `openDetailPanel(id)` path

### Integration Points
- `data_store.approve_listing()` → also kicks off async KÜ lookup (best-effort, silent on failure)
- New `/api/entry/{id}/schedule-viewing` → sets state + `scheduled_at`, spawns background `generate_negotiation_brief` thread
- New `/api/entry/{id}/mark-viewed` → sets state to `"viewed"` and returns; no side effects beyond the state flip
- Detail panel: new "Schedule viewing" button appears when `entry.status == "approved"`; "Mark viewed" appears when `entry.status == "viewing_scheduled"` AND `now >= scheduled_at`; "Negotiation brief" + "KÜ data" sections render conditionally based on presence
- Sidebar filter chips / map pin styles: extend to show `viewing_scheduled` and `viewed` visually (small icon or dot; executor picks)

</code_context>

<specifics>
## Specific Ideas

- **Negotiation brief prompt seed:** feed Claude the listing fields + full `price_history[]` + district avg €/m² + the AI's own prior verdict/strengths/risks. Ask for a 4-8 sentence paragraph in Russian (matches the existing AI output language) that cites concrete numbers and closes with a suggested opening-offer range and one-line reasoning.
- **Datetime picker:** native `<input type="datetime-local">` — no calendar library needed. Default value: today at 17:00 local so most viewings need only a minor tweak.
- **"Mark viewed" appearance:** enabled once `scheduled_at` is in the past. Before that time it's greyed out with a tooltip: "Available from {scheduled_at}".
- **KÜ card:** compact block with three key lines when present — "KÜ fee: {monthly_fee_eur} €/mo", "Repair fund: {repair_fund_balance_eur} €", "Arrears: {arrears_eur} €". Source-URL link at the bottom + "Refresh" button + `looked_up_at` timestamp. Hide entirely when nothing was extracted.
- **Sidebar status glyph:** small icon in the sidebar item's meta line — 📅 for viewing_scheduled, ✓ for viewed. Just enough to skim.
- **Status filter chip in the detail sidebar:** removed in a prior UI iteration but with two new statuses on the horizon it may be worth re-adding — executor decides based on the filter-bar layout.

</specifics>

<deferred>
## Deferred Ideas

- **PDF export (EXPORT-01)** — dropped from Phase 6 in discussion. Reconsider later if Daniel needs to hand documents to a bank / advisor. If revisited: single-listing dossier is the highest-value scope (title + score + verdict + cost card + price history + checklist snapshot + brief).
- **Telegram post-viewing checklist flow** — original VIEW-02 called for an inline Telegram Q&A; user preferred keeping Telegram noise-free after initial scrape. A future phase could add a lightweight "Fill checklist from your phone" web-app link if the pure web-UI path proves too easy to skip.
- **Offer / decision tracker** — a `"decided"` state with an offer amount + acceptance/rejection outcome. Would turn the viewing workflow into a full offer-tracking system. Explicitly out of scope for Phase 6.
- **Public-transit commute mode + walking-distance amenities** — carried over from Phase 5 deferred.
- **Second-viewing dedicated flow** — beyond the append-only `viewing_history[]` from D-04. Rarely needed for a single hunter.
- **Post-viewing decision reminder** — a nudge on the sidebar if a listing has been in `"viewed"` state for more than N days without a follow-up action. Nice-to-have, future phase.

</deferred>

---

*Phase: 6-Viewing Workflow & Extras*
*Context gathered: 2026-07-10*
