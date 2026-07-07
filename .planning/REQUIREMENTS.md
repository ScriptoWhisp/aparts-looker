# Requirements: Aparts Looker

**Defined:** 2026-07-07
**Core Value:** Every listing that meets Daniel's criteria gets evaluated, queued, and surfaced before he has to manually look — best ones get an email to the agent drafted and ready.

## v1 Requirements

### Queue & Approval Workflow

- [ ] **QUEUE-01**: New scraped listings enter a PENDING queue state, not the main dossier list
- [ ] **QUEUE-02**: Telegram card for pending listings is compact: score + 1-line verdict + price/m² + /approve /reject /more commands
- [ ] **QUEUE-03**: Web app shows a "Pending" tab with full listing detail and approve/reject actions
- [ ] **QUEUE-04**: Approving a listing moves it to the main dossier list
- [ ] **QUEUE-05**: Rejecting a listing archives it with a reason (price, location, other)
- [ ] **QUEUE-06**: On approval, AI drafts an outreach email to the mäkler (not triggered automatically by score)
- [ ] **QUEUE-07**: Email draft requires Daniel's explicit `/send <id>` approval before sending

### AI Evaluation Quality

- [ ] **EVAL-01**: Evaluation prompt includes 2-3 previously-approved listings with their scores as calibration anchors
- [ ] **EVAL-02**: Evaluation output includes structured checklist: pass/fail per each of the 7 BUYER_PROFILE criteria that can be assessed from listing text
- [ ] **EVAL-03**: Evaluation prompt includes running price/m² average for the listing's district (computed from seen listings)
- [ ] **EVAL-04**: When a seen listing's price drops ≥5%, it is re-evaluated and re-queued as a new pending item

### Price & Listing Intelligence

- [ ] **INTEL-01**: Price history is recorded per listing on every scrape (date + price)
- [ ] **INTEL-02**: Listing longevity (days on market) is tracked and surfaced in the listing card
- [ ] **INTEL-03**: When a listing URL returns 404, it is marked as sold/removed in the dossier with the date

### Source Coverage

- [ ] **SRC-01**: city24.ee listings are scraped and fed into the same evaluation pipeline
- [ ] **SRC-02**: kinnisvara24.ee listings are scraped and fed into the same evaluation pipeline
- [ ] **SRC-03**: Listings from all sources are deduplicated by address or object ID before evaluation

### Scraper Architecture Split

- [x] **ARCH-01**: A standalone scraper client runs on the home mini PC (Windows/macOS compatible)
- [x] **ARCH-02**: The scraper client POSTs raw listing data to a VPS ingest endpoint (secret token auth)
- [x] **ARCH-03**: The VPS ingest endpoint triggers AI evaluation and queuing (no scraping on VPS)
- [x] **ARCH-04**: Scraper health alert: Telegram notification if 0 listings are returned for 2 consecutive runs

### Map & Overview UI

- [ ] **MAP-01**: Overview page shows an interactive Tallinn map with one pin per apartment in the dossier
- [ ] **MAP-02**: Pin colour reflects AI score tier: green (≥75), amber (50–74), red (<50)
- [ ] **MAP-03**: Map shows a price/m² heat zone overlay by district, computed from seen-listing data
- [ ] **MAP-04**: Map shows a 20-minute commute isochrone from Veerenni 28 (Bolt HQ)
- [ ] **MAP-05**: Each pin opens a listing card preview on click
- [ ] **MAP-06**: Commute time from Veerenni 28 is displayed on each listing card

### Comparison & Design

- [ ] **UI-01**: Redesigned dossier — modern, information-dense layout replacing current design
- [ ] **UI-02**: Side-by-side comparison view for 2–4 pinned listings with all fields aligned

### Viewing Workflow

- [ ] **VIEW-01**: Approved listings can be set to "viewing scheduled" state
- [ ] **VIEW-02**: After a viewing, Telegram prompts Daniel to fill the 11-category checklist inline
- [ ] **VIEW-03**: Negotiation brief is auto-generated for listings in "viewing scheduled" state: listing age, price trajectory, district comps, suggested opening offer

### Building Fund & Enrichment

- [ ] **ENRICH-01**: Attempt korteriühistu (KT/remondifond) data lookup per listing address; surface result in card if found

### Export & Access

- [ ] **EXPORT-01**: Dossier can be exported as a PDF (for bank/advisor review)

## v2 Requirements

### Extended Intelligence

- **V2-01**: Telegram Mini App for inline dossier access without opening a browser
- **V2-02**: Similar listing recommendations ("this is like Retke tee 22 which you scored 82")
- **V2-03**: Deadline/urgency tracking — mark listings with agent-mentioned viewing deadlines
- **V2-04**: Mortgage payment simulator per listing based on Daniel's financial profile

### Additional Sources

- **V2-05**: kv.ee email alert parsing as a fallback supplement to the scraper

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user support | Personal tool for Daniel only |
| Native mobile app | Telegram + Mini App covers mobile UX |
| Real-time price feeds | Polling-based scraping is sufficient |
| Full Google OAuth | Gmail App Password is simpler and sufficient |
| Automated offer submission | Always requires human decision |
| Full 11-category physical inspection checklist (pre-viewing) | Only fillable post-viewing; AI fills what it can from listing text |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCH-01 | Phase 1 | Complete |
| ARCH-02 | Phase 1 | Complete |
| ARCH-03 | Phase 1 | Complete |
| ARCH-04 | Phase 1 | Complete |
| QUEUE-01 | Phase 2 | Pending |
| QUEUE-02 | Phase 2 | Pending |
| QUEUE-03 | Phase 2 | Pending |
| QUEUE-04 | Phase 2 | Pending |
| QUEUE-05 | Phase 2 | Pending |
| QUEUE-06 | Phase 2 | Pending |
| QUEUE-07 | Phase 2 | Pending |
| EVAL-01 | Phase 3 | Pending |
| EVAL-02 | Phase 3 | Pending |
| EVAL-03 | Phase 3 | Pending |
| EVAL-04 | Phase 3 | Pending |
| INTEL-01 | Phase 3 | Pending |
| INTEL-02 | Phase 3 | Pending |
| INTEL-03 | Phase 3 | Pending |
| SRC-01 | Phase 4 | Pending |
| SRC-02 | Phase 4 | Pending |
| SRC-03 | Phase 4 | Pending |
| MAP-01 | Phase 5 | Pending |
| MAP-02 | Phase 5 | Pending |
| MAP-03 | Phase 5 | Pending |
| MAP-04 | Phase 5 | Pending |
| MAP-05 | Phase 5 | Pending |
| MAP-06 | Phase 5 | Pending |
| UI-01 | Phase 5 | Pending |
| UI-02 | Phase 5 | Pending |
| VIEW-01 | Phase 6 | Pending |
| VIEW-02 | Phase 6 | Pending |
| VIEW-03 | Phase 6 | Pending |
| ENRICH-01 | Phase 6 | Pending |
| EXPORT-01 | Phase 6 | Pending |

**Coverage:**

- v1 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-07*
*Last updated: 2026-07-07 — traceability expanded to per-requirement rows after roadmap creation*
