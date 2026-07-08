# Phase 3: AI Quality & Price Intelligence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 3-AI Quality & Price Intelligence
**Areas discussed:** Anchor selection, Checklist output format, Price history storage, Re-evaluation scope on price drop

---

## Anchor Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Highest-scored 2-3 | Sort properties[] by score descending, take top 3 | ✓ |
| High / Mid / Low spread | One from top third, middle, bottom for full range coverage | |
| Most recent 2-3 | Last N listings Daniel approved | |
| You decide | Simplest to implement | |

**User's choice:** Highest-scored 2-3

**Notes:** User first asked for clarification on what "anchors" meant — explained that the model clusters around 70 without reference examples, and anchors are previously-approved listings injected into the prompt with their scores so the model has concrete calibration points. User then selected highest-scored 2-3. For the "fewer than 2 approved listings" edge case, user deferred to Claude — decision: skip anchors silently.

---

## Checklist Output Format

| Option | Description | Selected |
|--------|-------------|----------|
| Pass/fail/unknown per criterion | Flat dict with three-state values; renders as green/red/grey | ✓ |
| Boolean only | true/false, forces a guess on every criterion | |
| Structured with notes | Richer but more tokens and complex rendering | |

**User's choice:** Pass/fail/unknown per criterion

**Where checklist appears:**

| Option | Description | Selected |
|--------|-------------|----------|
| Separate from manual viewing checklist | AI checklist stored separately, no collision with user answers | |
| Pre-fill existing manual checklist with AI source tag | AI prefills checklists[listing_id] with source: "ai" marker | ✓ |

**User's choice:** Pre-fill the existing manual checklist, but mark AI-filled items visually (robot icon or different colour). User noted the checklist has both text-assessable criteria and viewing-only criteria; mäkler answers can also fill some fields.

**Checklist criteria:**

| Option | Description | Selected |
|--------|-------------|----------|
| Use the 7 BUYER_PROFILE criteria | Hardcoded mapping to the 7 buyer criteria | |
| Derive from existing checklist structure | Read current checklists keys from codebase, match AI output to those | ✓ |

**User's choice:** You decide — executor reads existing `app_data.checklists` structure and matches AI output field names to whatever categories are already present.

---

## Price History Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Separate top-level key | app_data["price_history"] = {listing_id: [{date, price}]} | ✓ |
| Inline on each listing entry | properties[i]["price_history"] = [...] | |

**User's choice:** Separate top-level key

**Recording frequency:**

| Option | Description | Selected |
|--------|-------------|----------|
| Every listing on every scrape | Record for all listings received, new or known | ✓ |
| Only when price changes | Append only on delta | |

**User's choice:** Every listing on every scrape (enables drop detection without extra state)

**Days-on-market:**

| Option | Description | Selected |
|--------|-------------|----------|
| First scrape date | today - price_history[id][0].date; no extra field | ✓ |
| Separate first_seen field | Explicit field, redundant with first price_history entry | |

**User's choice:** First scrape date

---

## Re-evaluation Scope on Price Drop

**Previously-rejected listings:**

| Option | Description | Selected |
|--------|-------------|----------|
| Only if rejected for price reason | Re-queue if rejection_reason == "price" | ✓ |
| All rejected listings | Re-queue regardless of rejection reason | |
| Never re-queue rejected | Rejected = done | |

**User's choice:** Only if rejected for price reason

**Already-approved listings:**

| Option | Description | Selected |
|--------|-------------|----------|
| Re-evaluate and add note to card | Re-score, update properties[] entry, Telegram notification | ✓ |
| Re-queue as new pending | Treat like fresh listing | |
| Just record drop, no re-evaluation | Track in history, keep original score | |

**User's choice:** Re-evaluate and add a note to the listing card (Telegram notification with new score)

**Currently-pending listings:**

| Option | Description | Selected |
|--------|-------------|----------|
| Re-evaluate silently, update pending entry | No new notification | ✓ |
| Re-evaluate and send new Telegram card | Fresh card with updated score | |
| You decide | | |

**User's choice:** Re-evaluate silently and update the pending entry

---

## Claude's Discretion

- Anchor prompt format and wording
- Checklist criteria field names (derived from existing codebase structure)
- District average line wording in prompt
- Sold/removed signal mechanism (scraper explicit `removed: true` vs. VPS infers from absent listing IDs)
- Edge case: fewer than 2 approved listings → skip anchors silently

## Deferred Ideas

- Price history sparkline chart — visual mini chart on card; sufficient with text list for Phase 3, chart in Phase 5
- Explicit scraper-side `removed: true` signal — more elegant than VPS inference; executor decides simpler path
