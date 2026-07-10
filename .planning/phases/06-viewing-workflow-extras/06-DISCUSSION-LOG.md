# Phase 6: Viewing Workflow & Extras - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-10
**Phase:** 6-Viewing Workflow & Extras
**Areas discussed:** Viewing state model, Negotiation brief, Post-viewing checklist prompt, PDF export scope, KÜ enrichment (folded in after PDF descope)

---

## Viewing state model

### Q1 — How should the "viewing scheduled" state live on top of properties[]?

| Option | Description | Selected |
|--------|-------------|----------|
| Status field on entry (Recommended) | Add entry.status = 'approved' \| 'viewing_scheduled' \| 'viewed' on properties[]; entry.viewing = {scheduled_at, brief, ...}. Matches existing rejection_reason pattern. | ✓ |
| Separate viewings[] list | New top-level list, one row per viewing event, keyed to listing_id. | |
| Viewings dict keyed by listing_id | app_data.viewings[listing_id] = {...}. Middle ground. | |

### Q2 — How much scheduling info should "viewing_scheduled" carry?

| Option | Description | Selected |
|--------|-------------|----------|
| Date + time (Recommended) | entry.viewing.scheduled_at = ISO datetime. Enables reminders, chronological upcoming-viewings, precise post-viewing trigger. | ✓ |
| Date only | entry.viewing.scheduled_at = 'YYYY-MM-DD'. Simpler; timing of any post-viewing action becomes fuzzy. | |
| Boolean flag | entry.viewing.scheduled = true. Minimal; no calendar/reminder features. | |

### Q3 — What happens to the listing after the viewing is done?

| Option | Description | Selected |
|--------|-------------|----------|
| New 'viewed' status (Recommended) | entry.status = 'viewed'. Enables 'walked but not decided' filter and future decide/offer states. | ✓ |
| Back to 'approved' | Reverts with entry.viewing.completed_at set. | |
| New 'decided' status w/ verdict | Adds offer/drop/hold decision flow. Broader scope than Phase 6. | |

### Q4 — Can a listing have more than one viewing?

| Option | Description | Selected |
|--------|-------------|----------|
| One at a time is fine (Recommended) | entry.viewing = current; previous rows pushed into entry.viewing_history[] on re-schedule. | ✓ |
| Always allow multiple | entry.viewings = []. Costlier upfront, minor real-world payoff. | |
| One only — no re-viewing | Hard block on second viewing. Simplest but rigid. | |

**Notes:** All defaults accepted — straightforward status-machine model that fits the existing per-entry data pattern.

---

## Negotiation brief

### Q1 — How should the brief be generated?

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: Python computes, Claude writes (Recommended) | Backend computes numbers, Claude turns them into prose. Numbers deterministic, narrative from AI. | |
| Pure Python | Facts + hard-coded template. Deterministic, boilerplate prose. | |
| Pure Claude free text | Send raw context, ask for full brief. Higher quality prose, numbers may drift. | ✓ |

### Q2 — When should the brief be generated?

| Option | Description | Selected |
|--------|-------------|----------|
| On state transition, cached (Recommended) | Fires on approved → viewing_scheduled; cached in entry.viewing.brief. | |
| On-demand — "Regenerate" button | Empty on transition; user clicks button. | |
| Both — auto + regen | Auto on transition + Regenerate button on card. | ✓ |

### Q3 — What must the brief contain?

| Option | Description | Selected |
|--------|-------------|----------|
| Structured sections (Recommended) | Fixed headings AI fills in: market context / district comps / seller signals / suggested offer / on-site questions. | |
| Free-form single paragraph | One dense paragraph of context and recommendation. | ✓ |
| Structured + talking-points | Structured sections plus conversation prompts. | |

### Q4 — Where does the brief live in the UI?

| Option | Description | Selected |
|--------|-------------|----------|
| Detail panel + Telegram (Recommended) | Detail-panel section + Telegram push on transition. | |
| Detail panel only | Web-only section on the detail card. | ✓ |
| Telegram only | Skip web card; only Telegram message on transition. | |

**Notes:** User explicitly prefers concise prose (single paragraph) and no Telegram noise beyond initial scrape — recurring theme.

---

## Post-viewing checklist prompt

### Q1 — How should Telegram guide Daniel through the checklist?

| Option | Description | Selected |
|--------|-------------|----------|
| One-at-a-time Q&A dialog (Recommended) | Bot posts each item as a message with buttons; Daniel taps. | |
| Section-by-section batch | Bot posts one section per message; Daniel replies with a compact answer sheet. | |
| Telegram just links to web checklist | Bot sends a Dashboard link; all input in existing web UI. | ✓ |

### Q2 — When should the post-viewing prompt fire?

Skipped after Q1 selection made the whole "prompt via Telegram" branch moot.

**User free-text response (Q1 follow-up):** "you know, lets use telegram only for the first scrapping, not send anything after viewing"

### Q1-alt — How does the listing move from "viewing_scheduled" to "viewed"?

| Option | Description | Selected |
|--------|-------------|----------|
| Button in detail panel (Recommended) | "Mark viewed" button on detail card once scheduled_at is past. | ✓ |
| Auto after scheduled_at + 2h | Background job silently flips the state. | |
| Filling any checklist item flips it | Implicit — first checklist entry advances the state. | |

**Notes:** User firmly wants Telegram limited to the initial scrape notification. Post-viewing behavior collapses to a single "Mark viewed" button — the existing web-UI FULL_CHECKLIST already handles the rest.

---

## PDF export scope

### Q1 — What should the exported PDF contain?

| Option | Description | Selected |
|--------|-------------|----------|
| Single-listing dossier (Recommended) | One-listing export for bank/advisor. | |
| All approved listings | Full internal record. | |
| Multi-select (compare + export) | Reuses comparison mode. | |

**User free-text response:** "lets not do pdf"

**Notes:** EXPORT-01 descoped from Phase 6 entirely. Captured in Deferred Ideas — can be revisited in a future phase if the need becomes real.

---

## KÜ / Remondifond enrichment (folded in after PDF descope)

### Q1 — How should we approach the korteriühistu lookup?

| Option | Description | Selected |
|--------|-------------|----------|
| Best-effort e-Business Register scrape (Recommended) | Scrape ariregister.rik.ee; extract KÜ fee / repair fund / arrears; never-raise on failure. | ✓ |
| Manual field on detail panel | Free-text field Daniel fills himself. | |
| Defer to later phase | Drop ENRICH-01 entirely. | |

### Q2 — When should the KÜ lookup fire?

| Option | Description | Selected |
|--------|-------------|----------|
| On approval + "Refresh" button (Recommended) | Fires on pending → approved; cached; Refresh button for re-fetch. | ✓ |
| On every ingest | Runs during ingest for every new listing. | |
| On viewing_scheduled transition | Only when Daniel commits to viewing. | |

**Notes:** ENRICH-01 stays in Phase 6, but flagged as the flakiest requirement — no formal contract with `ariregister.rik.ee`. Executor is expected to code defensively (short timeouts, partial-data OK, always cache what was found even if incomplete).

---

## Claude's Discretion

- Exact wording/tone of the negotiation-brief system prompt (single-paragraph Russian output, cites concrete numbers, closes with an offer range).
- Layout of the "Schedule viewing" and "Mark viewed" buttons within the detail panel.
- HTML parsing strategy for ariregister.rik.ee (regex vs BeautifulSoup selectors).
- Whether KÜ scrape runs synchronously in the approval handler or gets dispatched to a background thread.
- Whether legacy properties[] need a bulk KÜ backfill endpoint or just wait for the Refresh button.
- Sidebar / map badge glyphs for the new statuses.

## Deferred Ideas

- **PDF export (EXPORT-01)** — dropped from Phase 6; single-listing dossier is the highest-value scope if it comes back.
- **Telegram post-viewing checklist flow** — user prefers Telegram-free workflow after the initial scrape.
- **Offer / decision tracker** — a "decided" state with offer amount + outcome. Turns Phase 6 into a full offer-tracking system; out of scope.
- **Public-transit commute mode + walking-distance amenities** — carried from Phase 5 deferred.
- **Dedicated second-viewing flow** — beyond the append-only viewing_history[].
- **Post-viewing decision reminder** — sidebar nudge if a listing has been "viewed" for N days without follow-up.
