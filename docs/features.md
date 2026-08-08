# Aparts Looker — Feature Inventory (for the CTO)

**Purpose:** Personal apartment-hunting automation for one buyer in Tallinn. Not a marketplace, not a SaaS. Optimized for "no good listing slips through" over throughput or scale.

**Deployment:** Two-machine setup:
- **Mini PC (home, residential IP):** runs the scraper container. Necessary because kv.ee's Cloudflare blocks datacenter IPs.
- **VPS (`46.62.152.9`):** runs the FastAPI app + Postgres + Caddy. Auto-deployed via GitHub Actions on every `push origin main`.

---

## 1. Ingest & Scraping

**What it does:** Continuously fetches new kv.ee listings from residential IP, POSTs to the VPS.

**Nuances:**
- kv.ee blocks datacenter IPs at the Cloudflare edge — datacenter scraping is not an option, mini PC is load-bearing.
- Cloudflare bypass uses Playwright headless Chromium under Xvfb (virtual display). Historically crashed twice: once from Xvfb lock-file leftover (`/tmp/.X99-lock`), once from Playwright event-loop poisoning after exceptions. Both patched.
- Heartbeat monitoring is scaffolded (`/api/heartbeat`) but not yet alerting on silence — if the mini PC dies quietly, we find out days later.
- Runs every `CHECK_INTERVAL_HOURS` (default 2h). Zero-listing runs trigger an alert (Phase 1 completion).

---

## 2. AI Evaluation

**What it does:** Every ingested listing is scored 0–100 by Claude Haiku against Daniel's buyer profile (from `config.py:BUYER_PROFILE`), plus a one-line verdict and a structured checklist (~40 items covering finance, quality, location, KÜ, risk).

**Nuances:**
- Model is configurable via Settings tab (`ANTHROPIC_MODEL`, `AI_MAX_TOKENS`, `AI_DESCRIPTION_MAX_CHARS`).
- **Post-hoc number-grounding validator** catches AI hallucinations: any 4–6 digit number in the AI output that is NOT in the input facts triggers `needs_review=True`. Cheap safety net.
- Calibration anchors: 2–3 previously-approved listings are included in the prompt so the AI scores relative to Daniel's actual taste, not an absolute rubric.
- District average price is injected — the AI knows if a listing is above/below its area's baseline.
- Claude occasionally emits JSON with trailing prose; parsed with `json.JSONDecoder().raw_decode()` after finding the first `{`.
- Cost per listing: <$0.01. Not a real budget concern.
- No regression eval suite exists yet — if Claude changes its behavior between model versions, we'd learn by missing a good listing. **This is the biggest AI risk today.**

---

## 3. Pending Queue & Approval

**What it does:** Every evaluated listing enters `status='pending'`. Daniel reviews via the web Inbox (swipe/tap Tinder-flow) or the Shortlist tab. Approval flips status to `approved` and triggers the KÜ lookup + email draft; rejection captures a reason (price / location / condition / other). Telegram is a notifier-only surface — all triage happens in the web app.

**Nuances:**
- Rejection reasons are surfaced back to the AI on future scores (rejected-because-price context lets the AI down-weight similar listings).
- **Telegram two-message flow (Wave 8B):** Per scrape run, Daniel gets at most two messages:
  1. **Full photo card(s)** for the top-scoring listings at or above `TELEGRAM_MIN_SCORE_PHOTO` (default 80). Capped at `TELEGRAM_PHOTO_CARDS_PER_RUN` (default 3) per run. Caption format: `{score} · {title} / {price} € · {area} m² · {district} / {verdict} / Open in Aparts Looker ↗`. No inline keyboard — the deeplink is in the caption body.
  2. **Digest follow-up** for everything else at or above `TELEGRAM_MIN_SCORE_TEXT` (default 65) that didn't get a photo card: `"N more above X today. Open inbox ↗"`. One message for the whole remainder.
  3. If nothing qualifies: silence. No messages sent.
  4. Telegram AI-flagged high-severity risks suppress that individual photo card; the listing still appears in the web Inbox.
- Silence-for-N-hours is a first-class feature (`/api/telegram/silence`) — suppresses both photo cards and digest. Used during viewings.

---

## 4. Price Intelligence

**What it does:** Every scrape records the current price. When a known listing drops ≥5%, it re-enters pending for re-evaluation with the new number.

**Nuances:**
- Days-on-market is displayed on each card. Old-but-cheap = negotiating room signal.
- 404 detection: listings whose URL stops responding are flagged `removed` with a date; they stay in the dossier as historical reference.

---

## 5. Map & Spatial Overview

**What it does:** Leaflet map centered on Veerenni 28 (Bolt HQ — Daniel's commute anchor). Score-colored pins per listing. District polygons colored by quartile of average price/m². Isochrone overlay showing the ~30-min commute zone.

**Nuances:**
- Isochrone comes from OpenRouteService (`ORS_API_KEY`). Cached; refresh via `/api/refresh-isochrone`.
- District data is pre-computed at `/api/districts` from stored listing average prices — client just consumes.
- Estonia bounding-box guard silently drops pins with bogus coordinates.
- Districts toggle is a UI pill.
- Pin click routes to detail tab via a real click on the tab-nav button (not a manual class toggle — otherwise the tab state gets desynchronized).

---

## 6. Viewing Workflow

**What it does:** Approved listings can be flagged `viewing_scheduled` with a datetime, then `viewed` after the appointment. Sidebar shows a 📅 glyph for scheduled, ✓ for viewed.

**Nuances:**
- **Negotiation brief** is auto-generated on scheduling: Claude Haiku produces a free-form Russian paragraph with suggested offer range grounded in comparable properties + district average, plus post-hoc number validation.
- **KÜ lookup** hits `ariregister.rik.ee/est/api/autocomplete` filtered by `legal_form=23` (korteriühistud) — best-effort. Preserves any manually-entered `ku.manual` notes across refreshes (Pitfall 7).
- No Telegram post-viewing — deliberately scoped web-only. Daniel doesn't want notification interruptions after the fact.
- **Interactive checklist (Wave 10):** every listing's checklist always shows all 13 registry keys (`backend/ai_evaluator.py::AI_FILLABLE_CHECKLIST_KEYS`, mirrored in `frontend/src/lib/checklistMeta.ts`), grouped into Building fund / Risk / Finance / Quality / Location — not just the ones the AI managed to fill from the listing text. Each item's state (ok/flag/unknown/skip) is `user_marks[key]?.state ?? ai-derived-state`, click-to-cycle on a state chip, PATCHed to `PATCH /api/entry/{id}/checklist-item` and stored on `Listing.checklist.user_marks` (JSONB). Each item also has an independent, 800ms-debounced free-text note field, PATCHed the same way. Groups start expanded only when they contain a flag or a user mark; everything else is one click away. The prior read-only "Ask at the viewing" card was retired — every unknown item is already visible and taggable here, so a separate unknowns view added nothing.

---

## 7. Cost of Ownership

**What it does:** Per-listing monthly cost breakdown (mortgage + KÜ + heating + utilities), computed from the price/area/year + globally-tunable rates (down %, interest %, term years, KÜ €/m², heating €/m²).

**Nuances:**
- Manual per-listing overrides (`cost_of_ownership.overridden=true`) are preserved across global-rate recomputes. The user's judgment wins over the formula.
- Rate changes in Settings trigger a bulk recompute over every non-overridden row — now 18ms after Wave 5 (was multi-second with the old JSON `load → mutate → save` pattern).

---

## 8. Email Draft to Broker

**What it does:** On approval, an outreach email is drafted (Claude generates a personalized subject + Russian body), saved to Gmail Drafts via IMAP. Nothing is sent until Daniel manually runs `/send <id>` in Telegram.

**Nuances:**
- Uses Gmail App Password + IMAP4_SSL (drafts) and SMTP_SSL (send). No OAuth / Google Cloud project needed.
- Draft is regenerable from the dashboard's "Draft Email" button on any approved listing — the endpoint hits `get_approved_listing`, so the button is intentionally gated to approved-only.

---

## 9. Database (Phase 7)

**What it does:** Postgres 16 + SQLAlchemy 2.x + Alembic. Single `listings` table with a `status` enum (pending / approved / rejected / viewing_scheduled / viewed) + JSONB columns for nested structures (`cost_of_ownership`, `viewing_history`, `negotiation_brief`, `ku`, `ai_output_raw`, `checklist`, `price_history`, `score_breakdown`, `strengths`, `concerns`, `risks`, `extras`).

**Nuances:**
- Primary key is the kv.ee id as `VARCHAR(64)` (`"3883234"`). Preserves all `/api/entry/{id}/...` routes without change; when a second scraper source is added, plan is to prefix (`"kv:..."`, `"city24:..."`).
- **No backups.** Deferred by explicit decision — Postgres volume on VPS is the only copy. Server disk failure = data loss.
- The `data_store._lock` legacy `threading.RLock` is a `contextlib.nullcontext()` no-op — kept only so any leftover `with data_store._lock:` blocks parse. Postgres handles atomicity per row.
- JSONB gotcha: SQLAlchemy does NOT detect in-place `list.append()` on JSONB columns. All mutations reassign the whole list/dict.
- **Never hold a Session across an HTTP call.** Discipline pattern: open session → snapshot to plain dict → close → HTTP → open new session → save. 7 sites converted in Wave 4; regression tested with `test_no_session_during_http`.
- `settings.json` and `agent_state.json` stayed on the filesystem (in the `apartment_data` Docker volume) — they're small runtime state, not core data. Migrating them would have inflated scope.

---

## 10. Web Frontend

**What it does:** Static HTML/CSS/JS served by FastAPI's `StaticFiles`. Tabs: Overview, Detail, Comparison, Pending, Settings.

**Nuances:**
- No framework — vanilla JS modules (`frontend/js/*.js`). Started as a single big `index.html`; split into `detail-panel.js`, `map.js`, `ui.js`, `comparison.js` during Phase 5.
- Cache-control middleware serves HTML/JS/CSS with `no-store` so browser doesn't hold stale copies during rapid frontend iteration.
- Design is functional but ugly. See `design-brief.md` for the redesign brief.
- Uses `escapeHtml()` for every user/scraped string in DOM writes and Leaflet tooltips — XSS safety.

---

## 11. Backend Architecture

**What it does:** FastAPI + uvicorn (sync) + APScheduler for periodic checks. 6 route modules under `backend/routes_*.py`, `main.py` is a 77-LoC composition root.

**Nuances:**
- Sync (not async) — matches the existing HTTP client + scheduler ecosystem. Async would fight SQLAlchemy patterns for no throughput benefit at one user.
- Scheduler is `max_instances=1, coalesce=True` — no overlapping ticks.
- `/api/check-now` spawns a daemon thread so the HTTP call returns immediately.
- Bearer token auth on `/api/ingest` and `/api/heartbeat` — the scraper is the only client. Fail-closed if token is missing.
- Everything else is basic-auth via Caddy (`daniel` + bcrypt hash in Caddyfile).

---

## 12. Deployment

**What it does:** `git push origin main` fires GitHub Actions → SSHes into VPS as `root@46.62.152.9` → `git pull && docker compose up -d --build`. Cycle time: ~90 seconds.

**Nuances:**
- No staging environment. Every push is prod.
- No manual approval gate. If the workflow file itself is broken, the deploy silently no-ops.
- **Rollback is `git revert` + push** (30 seconds) OR `git reset --hard <sha>` on the VPS + `up -d --build` (also fast).
- Caddy handles TLS with Let's Encrypt IF a real hostname is configured. Currently the Caddyfile has `:80 { ... }` with basic auth — plain HTTP over IP-only. Basic auth over plain HTTP means the password is sniffable on hostile networks. Fine for home ISP, not fine for public WiFi.

---

## Feature Matrix

| Area | State | Owner risk |
|------|-------|-----------|
| Scraper reliability | Working, no alerting | Silent death goes unnoticed for days |
| AI evaluation quality | Working, no regression tests | Model drift undetected until missed listing |
| Data storage | Postgres, no backups | Server disk failure = total data loss |
| Frontend design | Functional, aesthetically weak | Slower to read → more manual filtering |
| Auth over the wire | Basic-auth over plain HTTP | Password sniffable on hostile network |
| Deployment safety | Direct-to-prod, no gate | Bad push = broken prod until revert |
| Test coverage | 115 tests, hits real Postgres | Not covering integration with real Claude / Telegram / kv.ee |

---

## Roadmap Position

- ✅ Phase 1–3: scraper split, approval queue, AI + price intelligence
- ⏸ Phase 4: multi-source (city24.ee, kinnisvara24.ee) — deferred, complexity vs value
- ✅ Phase 5: map + dashboard
- ✅ Phase 6: viewing workflow, negotiation brief, KÜ
- ✅ Phase 7: Postgres migration
- ⏭ Phase 8 candidate: nightly `pg_dump` → Backblaze B2 (~$0.005/GB/mo). Closes the data-loss risk from Phase 7.
- ✅ Filter layering fixed (2026-08-02, commit `66855b1`). Scraper now owns the four hard filters (max_price_eur, min_rooms, min_images, min_area_sqm), injects them into the kv.ee search URL as query params before fetching, and only POSTs what matches. Backend keeps the same filters as a safety net (logs at WARNING if triggered, meaning scraper URL is out of sync). Editable from the scraper's UI at `http://<mini-pc>:8002`. Was Phase 8 candidate; closed same day as identified.
- ⏭ Also candidate: AI regression eval suite (10 golden listings, nightly, alert on drift). Closes the AI risk.
- ⏭ Also candidate: heartbeat alerting (Telegram if no scraper POST in N hours). Closes the scraper-death risk.

---

*Last updated: 2026-08-02. This document is maintained by hand; refresh when features change.*
