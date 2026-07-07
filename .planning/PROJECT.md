# Aparts Looker

## What This Is

A personal apartment-hunting automation system for Daniel's Tallinn apartment search. It scrapes Estonian real estate portals, evaluates listings with AI against Daniel's specific buying criteria, manages a review queue with Telegram + web UI, and sends drafts to real estate agents on his approval. The goal is to eliminate manual portal-checking and make sure no good listing slips through unnoticed.

## Core Value

Every new listing that meets Daniel's criteria gets evaluated, queued, and surfaced to him before he has to manually look — and the best ones get an email to the agent drafted and ready.

## Business Context

Personal tool — no revenue model. Success = Daniel finds and buys the right apartment.

## Requirements

### Validated

- ✓ kv.ee scraping via Playwright (Cloudflare bypass) — existing
- ✓ Claude Haiku AI evaluation against BUYER_PROFILE criteria — existing
- ✓ Telegram card notifications per new listing — existing
- ✓ JSON-file property dossier with frontend — existing
- ✓ Gmail draft creation + `/send <id>` Telegram command — existing
- ✓ Price/rooms/image pre-filter before AI evaluation — existing

### Active

**Queue & Approval Workflow**
- [ ] New listings go to a PENDING queue, not directly to main list
- [ ] Compact Telegram card: score + 1-line verdict + key numbers + /approve /reject /more inline commands
- [ ] Web app "Pending" tab: full listing detail + approve/reject actions
- [ ] On approval: listing moves to main dossier list
- [ ] On approval: AI drafts email to mäkler (not auto-triggered by score)
- [ ] Email draft requires Daniel's explicit send approval (existing /send flow extended)

**AI Evaluation Quality**
- [ ] Calibrated scoring with anchors: feed 2-3 previously-approved listings + their scores before evaluating new ones
- [ ] Structured checklist output: AI fills the 11-category viewing checklist fields it can determine from listing text (pass/fail per criterion)
- [ ] District average context: include running price/m² average per district from seen-listing data in the evaluation prompt
- [ ] Re-evaluation on price drop: if a seen listing drops price 5%+, re-score and re-queue

**Price & Listing Intelligence**
- [ ] Price history tracking per listing: record price at each scrape, surface drops in Telegram and dossier
- [ ] Listing longevity tracking: how long has listing been on kv.ee; long-sitting = motivated seller signal
- [ ] Sold/removed detection: detect when a listing URL 404s, mark as expired in dossier, track what price range clears

**Source Coverage**
- [ ] Add city24.ee scraper
- [ ] Add kinnisvara24.ee scraper
- [ ] Unified deduplication across all sources by address/object ID

**Map & Overview UI**
- [ ] Redesigned overview page — modern, information-dense design
- [ ] Interactive Tallinn map: one pin per apartment, color-coded by AI score (green ≥75, amber 50-74, red <50)
- [ ] Price/m² heat zone overlay by district (from seen-listing data)
- [ ] 20-minute commute isochrone from Veerenni 28 (Bolt HQ) overlaid on map
- [ ] Side-by-side comparison view for 2-4 pinned listings
- [ ] Commute time display per listing card

**Viewing Workflow**
- [ ] "Viewing scheduled" state on approved listings
- [ ] Post-viewing Telegram prompt to fill 11-category checklist inline
- [ ] Negotiation brief: auto-generate 1-page memo (listing age, price trajectory, district comps, suggested opening offer)

**Scraper Architecture Split** ✓ Phase 01 complete (2026-07-08)
- ✓ Mini PC (home, Windows/macOS) runs scraper-only process (`scraper-client/`)
- ✓ Mini PC POSTs structured Listing JSON to VPS via `POST /api/ingest` (Bearer token auth)
- ✓ VPS handles AI evaluation, queue, dossier, web frontend — no browser on VPS
- ✓ Scraper health alerts: offline alert after 2×interval+30min; zero-listing alert after 2 consecutive zero runs

**Building Fund & Enrichment**
- [ ] Attempt korteriühistu (KT/remondifond) data lookup per listing address
- [ ] Neighborhood enrichment: transit score, walkability near listing

**Operations**
- [ ] Export dossier as PDF (for bank/advisor review)
- [ ] Telegram Mini App: inline dossier view without opening separate browser

### Out of Scope

- Multi-user support — personal tool for Daniel only
- Native mobile app — Telegram Mini App covers mobile UX
- Real-time price feeds — polling-based scraping is sufficient
- Full OAuth Gmail integration — App Password is sufficient and simpler
- Automated offer submission — always requires human decision

## Context

Daniel is 22, software engineer at Bolt (Veerenni 28, Tallinn), looking for a 3-4 room apartment, 50-80 m², up to 260,000 EUR + 40,000 EUR DIY renovation budget. He prefers panel blocks with healthy KT, is open to cosmetic renovation, and targets price/m² below 2,500 EUR (excellent) to 3,500 EUR (acceptable). Free parking and a healthy building fund are key signals.

The tool currently runs on a VPS but scraping is blocked by Cloudflare when coming from datacenter IPs. A home mini PC with residential IP will handle all scraping; the VPS continues to run the brain (evaluation, storage, API, frontend).

## Constraints

- **Scraping**: datacenter IPs are blocked by kv.ee Cloudflare — residential IP (home mini PC) required for scraping
- **Scale**: single user, low request volume — JSON file persistence is fine, no DB migration needed yet
- **AI cost**: Claude Haiku pricing is a fraction of a cent per listing — cost not a constraint
- **Email**: Gmail App Password, no Google Cloud OAuth needed
- **Mini PC OS**: Windows or macOS — scraper must run without Linux-only tooling

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| Playwright for kv.ee scraping | Cloudflare blocks plain HTTP from datacenter IPs | ✓ Works, but fragile |
| Split scraper (home) from brain (VPS) | Residential IP bypasses Cloudflare reliably | ✓ Phase 01 — `scraper-client/` Docker image on mini PC, VPS receives Listing JSON via /api/ingest |
| JSON file persistence | Single user, no concurrent writers, no infra overhead | ✓ Good |
| Approval-gated email drafting | Prevents unsolicited emails to agents; Daniel stays in control | — Pending |
| Calibrated scoring with anchors | Fixes "everything gets 70" problem — model needs comparison context | — Pending |
| Bolt HQ commute reference: Veerenni 28 | Daniel's workplace for commute isochrone calculation | — Pending |

---
*Last updated: 2026-07-08 after Phase 01 (scraper-architecture-split) completion*

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state
