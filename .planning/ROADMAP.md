# Roadmap: Aparts Looker

## Overview

The existing kv.ee scraper + Claude evaluation + Telegram + JSON dossier system is working but has two structural problems: datacenter IPs are blocked by Cloudflare, and every evaluated listing goes straight to the main list with no human gate. This roadmap adds the infrastructure split (Phase 1), approval queue (Phase 2), smarter AI evaluation + price intelligence (Phase 3), additional scraped sources (Phase 4), a map-based overview UI (Phase 5), and the viewing/closing workflow (Phase 6). Each phase delivers a complete, independently usable capability built on top of the previous one.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Scraper Architecture Split** - Mini PC scraper POSTs to VPS; Cloudflare bypass moves off datacenter IP (completed 2026-07-07)
- [x] **Phase 2: Queue & Approval Workflow** - Every listing enters a pending queue; Daniel approves before it reaches the dossier (completed 2026-07-08)
- [x] **Phase 3: AI Quality & Price Intelligence** - Calibrated scoring, structured checklist output, price history, longevity, and re-evaluation on drops (completed 2026-07-09)
- [ ] **Phase 4: Additional Scraper Sources** - city24.ee and kinnisvara24.ee added; deduplication across all sources *(deferred — cross-portal dedup complexity vs MVP value)*
- [ ] **Phase 5: Map & Overview UI** - Interactive Tallinn map with score pins, district heat zones, commute isochrone, and redesigned dossier
- [ ] **Phase 6: Viewing Workflow & Extras** - Scheduled viewings, negotiation briefs, building fund lookup, PDF export

## Phase Details

### Phase 1: Scraper Architecture Split

**Goal:** The scraper runs reliably from Daniel's home mini PC and delivers raw listing data to the VPS over HTTP, with a health alert if it goes silent.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** ARCH-01, ARCH-02, ARCH-03, ARCH-04
**Success Criteria** (what must be TRUE):

  1. Running the scraper client on the home mini PC (Windows or macOS) triggers a complete scrape of kv.ee and POSTs the raw results to the VPS ingest endpoint authenticated by a shared secret token.
  2. The VPS ingest endpoint receives a POST, runs AI evaluation and queuing on the payload, and never launches its own browser or Playwright process.
  3. If the scraper client returns zero listings for two consecutive runs, Daniel receives a Telegram alert naming the scraper and the timestamp of the last successful run.
  4. The existing VPS-side evaluation, notification, and dossier flows continue to work unchanged after the split.

**Plans:** 3/3 plans complete

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Extract standalone scraper client (scraper-client/) — Docker image with while-True loop that scrapes kv.ee and POSTs Listing JSON to VPS
- [x] 01-02-PLAN.md — Add VPS ingest endpoint (POST /api/ingest + /api/heartbeat) with Bearer token auth; move filter+evaluate+notify from agent_job into ingest_handler; update Caddyfile

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-03-PLAN.md — Scraper health alerts (offline + consecutive-zero) wired into scheduler tick; pytest scaffold covering ARCH-01/02/03/04

### Phase 2: Queue & Approval Workflow

**Goal:** Every newly evaluated listing enters a PENDING state first; Daniel reviews each via Telegram or the web app, and only approved listings reach the main dossier.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04, QUEUE-05, QUEUE-06, QUEUE-07
**Success Criteria** (what must be TRUE):

  1. A freshly scraped and evaluated listing does not appear in the main dossier list until Daniel approves it.
  2. The Telegram notification for a pending listing shows score, a one-line verdict, price/m², and inline /approve /reject /more buttons.
  3. The web app has a "Pending" tab that shows full listing detail with Approve and Reject buttons; rejecting prompts for a reason (price / location / other).
  4. Approving a listing via either Telegram or the web app moves it to the main dossier list immediately.
  5. On approval, the AI generates a draft outreach email to the mäkler; the draft is saved but not sent until Daniel runs /send <id>.

**Plans:** 4/4 plans complete

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Data model + Wave 0 tests: extend data_store with pending[]/rejected[]; rewire ingest_handler to write pending entries (QUEUE-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Telegram approval slice: sendPhoto inline keyboard, callback_query dispatcher, approve_listing/reject_listing (QUEUE-02, QUEUE-04, QUEUE-05 via Telegram)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — Web UI Pending tab: GET/POST /api/pending endpoints + static Pending tab with approve/reject reason picker (QUEUE-03, QUEUE-04, QUEUE-05 via browser)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-04-PLAN.md — Opt-in email draft: POST /api/draft/{id} + Draft email button in dossier; /send <id> unchanged (QUEUE-06, QUEUE-07)

### Phase 3: AI Quality & Price Intelligence

**Goal:** The AI evaluator produces calibrated, anchor-grounded scores with a structured checklist, and the system tracks price history and listing age — automatically re-queuing listings when prices drop significantly.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** EVAL-01, EVAL-02, EVAL-03, EVAL-04, INTEL-01, INTEL-02, INTEL-03
**Success Criteria** (what must be TRUE):

  1. The evaluation prompt sent to Claude includes 2–3 previously-approved listings with their scores as calibration anchors before asking for a new score.
  2. Each evaluation response includes a structured pass/fail checklist covering the BUYER_PROFILE criteria assessable from listing text.
  3. The evaluation prompt includes the running price/m² average for the listing's district, computed from seen listings in the dossier.
  4. Every scrape records the current price for each known listing; price history (date + price) is visible on the listing card in the dossier.
  5. When a seen listing's price drops 5% or more since last scrape, it is automatically re-evaluated and placed back in the PENDING queue.
  6. Listings show days-on-market in the dossier card; listings whose URL returns 404 are marked as removed with the date.

**Plans:** 4/4 plans complete

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Calibration anchors + district avg injection into evaluate_listing + Wave 0 test scaffolds + PRICE_DROP_THRESHOLD config (EVAL-01, EVAL-03)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — Structured checklist output: SYSTEM_PROMPT extension, write_checklist_ai persistence, AI badge strip in pending card (EVAL-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-03-PLAN.md — Price history tracking: data model migration, record_price_in_data + get_price_history, days-on-market + price history list in card (INTEL-01, INTEL-02)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-04-PLAN.md — Re-evaluation on ≥5% price drop across approved/pending/rejected states + raw_ok=False removed marking (EVAL-04, INTEL-03)

### Phase 4: Additional Scraper Sources

**Goal:** Listings from city24.ee and kinnisvara24.ee flow through the same evaluation and queue pipeline, with cross-source deduplication preventing the same apartment from appearing twice.
**Mode:** mvp
**Depends on:** Phase 3
**Requirements:** SRC-01, SRC-02, SRC-03
**Success Criteria** (what must be TRUE):

  1. Running the scraper client fetches listings from city24.ee and submits them to the VPS ingest endpoint; those listings appear in the PENDING queue after evaluation.
  2. Running the scraper client fetches listings from kinnisvara24.ee and submits them to the VPS ingest endpoint; those listings appear in the PENDING queue after evaluation.
  3. If the same physical apartment appears on multiple portals (matched by address or object ID), only one pending item is created; duplicates are silently discarded.

**Plans:** TBD

Plans:

- [ ] 04-01: city24.ee scraper module (city24_scraper.py) — harvest listing URLs and parse fields into shared Listing dataclass
- [ ] 04-02: kinnisvara24.ee scraper module (k24_scraper.py) — harvest listing URLs and parse fields into shared Listing dataclass
- [ ] 04-03: Cross-source deduplication — address/object ID normalisation before ingest; deduplicate in VPS ingest endpoint

### Phase 5: Map & Overview UI

**Goal:** The dossier homepage is replaced with a modern, information-dense view anchored by an interactive Tallinn map showing every apartment as a score-coloured pin, with district price heat zones and a 20-minute commute isochrone from Bolt HQ.
**Mode:** mvp
**Depends on:** Phase 4
**Requirements:** MAP-01, MAP-02, MAP-03, MAP-04, MAP-05, MAP-06, UI-01, UI-02
**Success Criteria** (what must be TRUE):

  1. The overview page shows an interactive map with one pin per dossier apartment; clicking a pin opens a listing card preview.
  2. Pin colours reflect the AI score tier: green for ≥75, amber for 50–74, red for <50.
  3. The map displays a price/m² heat zone overlay by district, computed from seen listings.
  4. A 20-minute commute isochrone from Veerenni 28 is overlaid on the map.
  5. Each listing card shows estimated commute time from Veerenni 28.
  6. The redesigned dossier layout is modern and information-dense (replacing the existing single-file SPA design).
  7. Daniel can select 2–4 listings and view them side-by-side with all fields aligned.

**Plans:** 4/4 planned

Plans:

- [ ] 05-01-PLAN.md — Data model + coordinate extraction (Listing.lat/lng, data_store helpers, kv.ee HTML coord probe)
- [ ] 05-02-PLAN.md — ORS integration + backend endpoints (isochrone, matrix commute, Nominatim backfill)
- [ ] 05-03-PLAN.md — Tallinn district GeoJSON + GET /api/districts heat zone data
- [ ] 05-04-PLAN.md — Full frontend redesign (map-first dashboard, KPI strip, charts, detail panel, comparison)

**UI hint**: yes

### Phase 6: Viewing Workflow & Extras

**Goal:** Approved listings can be moved into a "viewing scheduled" state that triggers a negotiation brief and post-viewing checklist; building fund data is surfaced per listing; and the dossier can be exported as a PDF.
**Mode:** mvp
**Depends on:** Phase 5
**Requirements:** VIEW-01, VIEW-02, VIEW-03, ENRICH-01, EXPORT-01
**Success Criteria** (what must be TRUE):

  1. An approved listing can be set to "viewing scheduled" state from the web app or Telegram.
  2. When a listing enters "viewing scheduled" state, a one-page negotiation brief is auto-generated (listing age, price trajectory, district comps, suggested opening offer) and attached to the dossier card.
  3. After a viewing, Telegram prompts Daniel to fill the 11-category checklist inline; responses are saved to the listing.
  4. If korteriühistu (KT/remondifond) data is found for a listing's address, the result is surfaced in the listing card.
  5. ~~Daniel can export the full dossier as a PDF suitable for sharing with a bank or advisor.~~ *(DEFERRED in Phase 6 discussion — see .planning/phases/06-viewing-workflow-extras/06-CONTEXT.md § Deferred Ideas, D-14. Track in v2 or a follow-up phase if needed.)*

**Plans:** 4/5 plans executed

Plans:
**Wave 0**

- [x] 06-01-PLAN.md — Test scaffolds + data_store setdefault migration + 4 new state-transition helpers (VIEW-01 foundation)

**Wave 1** *(blocked on Wave 0 completion)*

- [x] 06-02-PLAN.md — VIEW-01 + VIEW-02 vertical slice: /schedule-viewing + /mark-viewed endpoints + detail-panel buttons + datetime picker

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-03-PLAN.md — VIEW-03 vertical slice: brief_generator.py (Anthropic call + post-hoc number grounding) + /regenerate-brief endpoint + detail-panel brief card

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-04-PLAN.md — ENRICH-01 vertical slice: ku_lookup.py (ariregister autocomplete) + approval-hook dispatcher + /refresh-ku endpoint + detail-panel KÜ card

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 06-05-PLAN.md — Polish + governance: sidebar status glyphs; formally defer EXPORT-01 in ROADMAP + REQUIREMENTS; full-suite green gate

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Scraper Architecture Split | 3/3 | Complete    | 2026-07-07 |
| 2. Queue & Approval Workflow | 4/4 | Complete    | 2026-07-08 |
| 3. AI Quality & Price Intelligence | 4/4 | Complete    | 2026-07-09 |
| 4. Additional Scraper Sources | 0/3 | Not started | - |
| 5. Map & Overview UI | 0/5 | Not started | - |
| 6. Viewing Workflow & Extras | 4/5 | In Progress|  |
