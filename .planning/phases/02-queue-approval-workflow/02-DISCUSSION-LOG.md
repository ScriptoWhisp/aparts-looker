# Phase 2: Queue & Approval Workflow - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 2-queue-approval-workflow
**Areas discussed:** Pending queue data model, Telegram approval mechanics, Rejection reason collection, Email draft timing

---

## Pending Queue Data Model

| Option | Description | Selected |
|--------|-------------|----------|
| New key in app_data.json | Add pending[] and rejected[] alongside properties[] — same lock, same file | ✓ |
| Separate pending_data.json file | New JSON file, cleaner separation but two-file reads and partial-state risk | |
| Status field on each listing | All in properties[], status field per entry — derived views for each state | |

**User's choice:** New key in app_data.json

---

| Option | Description | Selected |
|--------|-------------|----------|
| Full Listing + evaluation result | All fields + score/verdict/strengths/concerns/draft_body — self-contained | ✓ |
| Listing ID + URL only | Re-fetch on approve — adds latency and Cloudflare failure risk | |
| Full Listing + evaluation only (no draft_body) | Generate draft fresh at approval time | |

**User's choice:** Full Listing fields + evaluation result

---

| Option | Description | Selected |
|--------|-------------|----------|
| Archived in app_data.json as rejected[] | Same pattern as pending[] — includes reason + date | ✓ |
| Permanently deleted | No archive — gone on reject | |
| Stay in pending[] with status flag | One list, status per item | |

**User's choice:** Archived in app_data.json as rejected[] list

---

| Option | Description | Selected |
|--------|-------------|----------|
| ingest_handler writes to pending[] directly | Direct append after evaluate_listing() under _lock | |
| Event-based intermediary | Over-engineered for single-user scale | |
| You decide | Deferred to Claude | ✓ |

**User's choice:** You decide (Claude chose direct write — option A)

---

## Telegram Approval Mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Inline keyboard buttons on card | [Approve] [Reject] [More] — one-tap, requires callback_query handling | ✓ |
| Typed commands /approve <id> | Extends existing extract_send_commands() — simpler but requires typing | |
| Both: buttons + typed fallback | Full coverage but double the code paths | |

**User's choice:** Inline keyboard buttons on the card

---

| Option | Description | Selected |
|--------|-------------|----------|
| Photo + score + verdict + key numbers + buttons | sendPhoto with caption and inline keyboard | ✓ |
| Text-only card | No photo — loses visual context | |
| Photo + score only (minimal) | Too little context for approve/reject without [More] | |

**User's choice:** Photo + score + verdict + key numbers + buttons

---

| Option | Description | Selected |
|--------|-------------|----------|
| Follow-up message with full listing detail | Second sendMessage with strengths/concerns/URL | |
| Link to web UI pending tab | Bot replies with web UI URL for that listing | ✓ |
| You decide | Deferred to Claude | |

**User's choice:** A link to the web UI pending tab for this listing

---

| Option | Description | Selected |
|--------|-------------|----------|
| Edit card caption to show action taken | editMessageCaption — removes buttons, prevents double-tap | ✓ |
| Leave card unchanged, send confirmation | Simpler but leaves active-looking buttons | |
| Delete card, send new resolved card | Cleanest but no undo, history lost | |

**User's choice:** Edit the card caption to show the action taken

---

## Rejection Reason Collection

| Option | Description | Selected |
|--------|-------------|----------|
| Follow-up inline buttons with quick reason options | After [Reject], bot sends reason prompt | ✓ |
| Reason only in web UI, silent Telegram rejection | Inconsistent channel experience | |
| Silent rejection (no reason) | Simplest but doesn't satisfy QUEUE-05 | |

**User's choice:** Yes — follow-up inline buttons with quick reason options

---

| Option | Description | Selected |
|--------|-------------|----------|
| Price / Location / Condition / Other | 4 options covering main rejection triggers | |
| Price too high / Too far / Needs work / Floor plan / Other | More specific but 5 options = more taps | |
| You decide | Deferred to Claude | ✓ |

**User's choice:** You decide (Claude chose: Price / Location / Condition / Other)

---

| Option | Description | Selected |
|--------|-------------|----------|
| No — rejection is permanent | Simple state machine; no reverse transitions | ✓ |
| Yes — web UI 'Restore' button | Adds complexity; useful if Daniel fat-fingers reject | |

**User's choice:** Rejection is permanent — no un-reject

---

## Email Draft Timing

| Option | Description | Selected |
|--------|-------------|----------|
| At ingest time (pre-compute) | draft_body stored with pending entry, used at approval | |
| At approval time (on-demand) | Fresh AI call on approve — latency + cost on listings that may never be sent | |
| (User free-text) | Separate flow, opt-in with explicit trigger; agent should read replies too | ✓ |

**User's choice (free-text):** "it should be separate flow, not always right after my approval, but with my external trigger, or agent suggestion and my approval. Ideally agent should then be able to read answers and draft reply acting as personal assistant"

**Notes:** Scoped to Phase 2 only for the initial outreach draft. Mäkler reply-reading + follow-up drafting deferred.

---

| Option | Description | Selected |
|--------|-------------|----------|
| On approval, automatically — Gmail draft created | QUEUE-06 as written | |
| Not automatically — draft only on explicit request | Approval just moves to dossier; draft is opt-in | ✓ |

**User's choice:** Not automatically — draft only when Daniel explicitly requests it

---

| Option | Description | Selected |
|--------|-------------|----------|
| /draft <id> in Telegram | Typed command triggers generate+save | |
| Button in web UI pending/dossier tab | "Draft email" button per listing | ✓ |
| Both channels | Doubles surface area | |

**User's choice:** Button in the web UI pending/dossier tab

---

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-computed draft_body from evaluation | Stored in listing entry, instant | |
| Re-generate fresh with Claude | Adds ~2-3s latency + token spend | |
| You decide | Deferred to Claude | ✓ |

**User's choice:** You decide (Claude chose: pre-computed draft_body — no extra AI call)

---

## Claude's Discretion

- **ingest → pending[] integration:** Direct write from `ingest_handler.process_ingest_batch()` after `evaluate_listing()`, under `data_store._lock` — no intermediary
- **Rejection reason options:** Price / Location / Condition / Other
- **Email draft content:** Pre-computed `draft_body` reused from evaluation — no re-generation at click time
- **Rejected entry structure:** Mirrors pending entry + adds `rejection_reason` (enum string) + `rejected_at` (ISO timestamp)

## Deferred Ideas

- **Mäkler reply assistant:** Reading mäkler email responses and drafting follow-up replies as a personal assistant / conversation thread manager. Richer agentic flow that goes beyond Phase 2's initial outreach scope. Future phase (Phase 6+).
