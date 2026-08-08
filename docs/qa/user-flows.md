# Aparts Looker — React frontend user flows (QA sweep baseline)

This is the exhaustive flow list used to write `frontend/e2e/qa-*.spec.ts`. Every
flow below either has a corresponding Playwright test (existing or newly added
in this sweep) or is explicitly marked `[not automated]` with a reason.

Legend: **[existing]** = already covered by a pre-sweep spec file (`inbox.spec.ts`,
`shortlist.spec.ts`, `settings.spec.ts`, `compare.spec.ts`, `smoke.spec.ts`,
`mobile-snapshots.spec.ts`). **[new]** = added by this sweep in `qa-*.spec.ts`.

---

## Header / nav (both viewports)

```
## Flow: Switch between all 4 tabs via top nav (desktop)
Precondition: fullAppData, fullSettings mocked
Viewport: desktop
Steps:
  1. Click "Overview" button in header nav → Overview content renders, tab has accent style
  2. Click "Inbox" → Inbox content renders
  3. Click "Shortlist" → Shortlist content renders
  4. Click "Settings" → Settings content renders
Success criteria: each click updates window.location.hash and renders the matching route
Status: [existing: smoke.spec.ts per-tab] + [new: qa-header.spec.ts sequential switch]
```

```
## Flow: Switch between all 4 tabs via bottom nav (mobile)
Precondition: fullAppData mocked
Viewport: mobile
Steps:
  1. Tap "Overview" icon in bottom nav → activates, aria-current=page
  2. Tap "Inbox" → activates
  3. Tap "Shortlist" → activates
  4. Tap "Settings" → activates
Success criteria: nav item aria-current flips to the tapped tab
Status: [new: qa-header.spec.ts]
```

```
## Flow: Hash routing backward-compat — #pending lands on Inbox
Precondition: appDataWithPending mocked
Viewport: both
Steps:
  1. Navigate to /#pending → tabFromHash maps legacy hash to 'inbox'
  2. Inbox content renders (article cards on desktop, swipe card on mobile)
Success criteria: legacy hash still resolves to the correct tab
Status: [new: qa-header.spec.ts]
```

```
## Flow: Refresh button triggers /api/check-now
Precondition: fullAppData mocked
Viewport: desktop
Steps:
  1. Click "Refresh" button in header → POST /api/check-now fires
  2. Button label flips to "Checking…" while in flight
Success criteria: POST fired, button disabled during request
Status: [new: qa-header.spec.ts]
```

---

## Overview — desktop

```
## Flow: Loads with entries — BEST hero + This Week stats + Next up list
Precondition: fullAppData mocked
Viewport: desktop
Steps:
  1. Navigate to /#overview → BEST hero card renders with top-pick entry title/price
  2. "This week" stats card shows pending/to-view/viewed counts
  3. "Next up" list shows up to 6 approved/viewing_scheduled entries sorted by score
Success criteria: all three cards render with real data, no crash
Status: [existing: smoke.spec.ts loads without error] + [new: qa-overview.spec.ts content assertions]
```

```
## Flow: BEST hero click navigates to Shortlist with that entry selected
Precondition: fullAppData mocked
Viewport: desktop
Steps:
  1. Click the BEST hero card → setSelectedListingId(entry.id) + setTab('shortlist')
  2. Hash becomes #shortlist, HeroRow for that entry renders in main pane
Success criteria: navigation + selection both happen from a single click
Status: [new: qa-overview.spec.ts]
```

```
## Flow: Next up row click navigates to Shortlist with that entry selected
Precondition: fullAppData mocked
Viewport: desktop
Steps:
  1. Click a row in "Next up" list → same navigate+select behavior as BEST hero
Success criteria: hash #shortlist, correct entry's HeroRow visible
Status: [new: qa-overview.spec.ts]
```

```
## Flow: Histogram bars render for score buckets
Precondition: fullAppData mocked (mixed scores across bins)
Viewport: desktop
Steps:
  1. HistogramSVG renders >=1 <rect> bar with nonzero height for populated bins
Success criteria: SVG rect count > 0
Status: [new: qa-overview.spec.ts]
```

```
## Flow: Scatter dots render with budget line
Precondition: fullAppData mocked, fullSettings max_price_eur present
Viewport: desktop
Steps:
  1. ScatterSVG renders >=1 <circle> per plottable entry
  2. Budget dashed line renders when budget is within price range
Success criteria: circle count > 0
Status: [new: qa-overview.spec.ts]
```

```
## Flow: Empty state — no entries → sensible empty message
Precondition: emptyAppData mocked
Viewport: desktop
Steps:
  1. BEST hero shows "No shortlisted entries yet."
  2. Next up shows "No shortlisted entries yet." + "Check Inbox" link
Success criteria: no crash, friendly copy shown
Status: [new: qa-overview.spec.ts]
```

```
## Flow: Calibration panel — hides at <5 rated, shows at >=5
Precondition: appData with own_score set on N properties
Viewport: desktop
Steps:
  1. 4 rated viewings → CalibrationPanel absent from DOM
  2. 5 rated viewings → CalibrationPanel renders with "AI vs your score" text + MAE stat
Success criteria: threshold boundary respected exactly at 5
Status: [new: qa-overview.spec.ts]
```

## Overview — mobile

```
## Flow: Vertical stack, no map card
Precondition: fullAppData mocked
Viewport: mobile
Steps:
  1. BEST hero, stats, charts, calibration, next-up all render stacked
  2. .leaflet-container is absent/hidden (map only renders on desktop)
Success criteria: no map, single column
Status: [existing: mobile-snapshots.spec.ts "no broken narrow elements" + map hidden]
```

---

## Inbox — desktop

```
## Flow: Loads with pending entries — 3-col grid
Precondition: appDataWithPending mocked
Viewport: desktop
Steps:
  1. Navigate to /#inbox → grid of [role="article"] cards renders
Success criteria: card count matches pending.length
Status: [existing: inbox.spec.ts]
```

```
## Flow: Highest-score card has ring accent
Precondition: appDataWithPending mocked (entries have differing scores)
Viewport: desktop
Steps:
  1. First card in queue (highest score, pre-sorted) has ring-1/ring-2 class
Success criteria: visual distinction present in DOM class list
Status: [new: qa-inbox.spec.ts]
```

```
## Flow: Look closer button → POST /approve → stays #inbox → shortlist selected
Precondition: appDataWithPending mocked
Viewport: desktop
Steps:
  1. Click "Look closer" on first card → POST /api/pending/{id}/approve fires
  2. setSelectedListingId(id) + setTab('shortlist') → hash becomes #shortlist
Success criteria: approve POST fired, hash flips to #shortlist (desktop behavior
  differs from mobile — desktop navigates away, mobile stays on #inbox)
Status: [existing: inbox.spec.ts "Look closer moves to shortlist"]
```

```
## Flow: Skip button → drawer opens with 6 chips → pick reason → Confirm → POST /reject → row disappears
Precondition: appDataWithPending mocked
Viewport: desktop
Steps:
  1. Click "Skip" on a card → modal opens with 6 reason chips
  2. Click "Location" chip → selected state
  3. Click confirm "Skip" button → POST /api/pending/{id}/reject fires with reason
  4. Card removed from queue (decidedIds excludes it)
Success criteria: reject POST body contains "Location"
Status: [existing: inbox.spec.ts]
```

```
## Flow: Keyboard L/S shortcuts
Precondition: appDataWithPending mocked
Viewport: desktop
Steps:
  1. Press "l" → approve fires on selectedIndex card (same as Look closer)
  2. Press "s" → skip modal opens on selectedIndex card
Success criteria: both shortcuts act on the currently-selected card
Status: [existing: inbox.spec.ts L] + [new: qa-inbox.spec.ts S]
```

```
## Flow: Empty state — no pending → "Inbox is empty"
Precondition: emptyAppData mocked
Viewport: desktop
Steps:
  1. "Inbox is empty" text + "Adjust threshold" + "Run scrape now" buttons render
Success criteria: no crash, friendly copy
Status: [existing: inbox.spec.ts]
```

## Inbox — mobile (highest priority — recently broken)

```
## Flow: Single card + progress bar + 3 action buttons + bottom nav
Precondition: appDataWithPending mocked
Viewport: mobile
Steps:
  1. Only ONE full SwipeCard visible in the card stack (front card)
  2. Progress bar shows N of M segments filled
  3. "Look closer" / "Skip" / "Later" buttons visible above bottom nav
  4. Bottom nav (4 items) visible below the action strip
Success criteria: no dual-card overlap, all controls reachable
Status: [existing: inbox.spec.ts "renders action buttons", "bottom nav dock is visible"]
```

```
## Flow: Look closer → card slides right → next card FULL content (not dim placeholder) → still #inbox
Precondition: appDataWithPending (3 entries) mocked
Viewport: mobile
Steps:
  1. Tap "Look closer" → POST /approve fires, card 1 exits right
  2. Card 2 (previously the peek card) becomes the new front SwipeCard with full
     photo/title/price/verdict — NOT the dimmed 40%-opacity PeekCard markup
  3. Hash remains #inbox (no navigation away, unlike desktop)
Success criteria: card 2 title visible at full opacity, hash unchanged
Status: [existing: inbox.spec.ts "Look closer on card 1 stays on #inbox"]
  + [new: qa-inbox.spec.ts explicit full-opacity assertion]
```

```
## Flow: Skip → card slides left → drawer opens ONLY after exit → next card dimmed behind sheet
Precondition: appDataWithPending mocked
Viewport: mobile
Steps:
  1. Tap "Skip" → card exits left (250ms), THEN sheet opens (no overlap)
  2. Peek card visible behind sheet at reduced opacity while sheet is open
  3. Pick a reason chip → tap "Next" → sheet closes → POST /reject fires with reason
  4. Queue advances to the next card
Success criteria: sequential animation (not simultaneous), reject body has reason
Status: [existing: inbox.spec.ts "Skip opens sheet with Next button"]
  + [new: qa-inbox.spec.ts peek-card-dimmed-behind-sheet assertion]
```

```
## Flow: Skip → drawer opens → Undo → sheet closes → skipped card back at top of queue
Precondition: appDataWithPending (3 entries) mocked
Viewport: mobile
Steps:
  1. Tap "Skip" on card 1 → sheet opens
  2. Tap "Undo" → sheet closes, no POST /reject fired
  3. Card 1's title is visible again as the front card (restored to queue head)
Success criteria: no reject network call, card 1 title re-appears
Status: [new: qa-inbox.spec.ts]
```

```
## Flow: Skip → drawer opens → swipe-down dismiss → treated as skip-no-reason → advances
Precondition: appDataWithPending mocked
Viewport: mobile
Steps:
  1. Tap "Skip" → sheet opens
  2. Trigger the drawer's onOpenChange(false) without Next/Undo (simulates swipe-down)
  3. confirmSkip(null) fires → POST /reject with reason=null → queue advances
Success criteria: reject POST body has reason:null, next card renders
Status: [new: qa-inbox.spec.ts — driven via drawer close, not a literal touch
  gesture (vaul's internal swipe physics aren't reliably drivable via Playwright
  mouse/touch synthesis in headless mode); see note in spec file]
```

```
## Flow: Later cycles card to end of queue without backend call
Precondition: appDataWithPending (3 entries) mocked
Viewport: mobile
Steps:
  1. Tap "Later" on card 1 → no network call fires
  2. Card 2's title becomes the new front card
  3. Card 1 re-appears once cards 2 and 3 are also decided/cycled
Success criteria: zero approve/reject calls, queue order changes locally only
Status: [new: qa-inbox.spec.ts]
```

```
## Flow: Complete all cards → Cleared state with decision list + Open shortlist + bottom nav
Precondition: appDataWithPending (2 entries) mocked
Viewport: mobile
Steps:
  1. Approve both cards → "Inbox clear" heading renders
  2. Decision list shows both titles with score + outcome tag
  3. "Open shortlist" button visible (>=1 shortlisted)
  4. Bottom nav still visible
Success criteria: matches existing inbox.spec.ts cleared-state test
Status: [existing: inbox.spec.ts "cleared state renders decision list"]
```

```
## Flow: Swipe gestures — drag right >100px = Look closer; drag left = Skip
Precondition: appDataWithPending mocked
Viewport: mobile
Steps:
  1. Drag the front card >100px right via Playwright mouse events → same effect as
     tapping "Look closer" (POST /approve fires, card exits right)
  2. Drag the (new) front card >100px left → same effect as "Skip" (drawer opens)
Success criteria: drag gesture triggers the same handlers as the buttons
Status: [new: qa-inbox.spec.ts — driven via page.mouse down/move/up sequences
  against the draggable card element]
```

---

## Shortlist — desktop

```
## Flow: Loads with entries — sidebar shows 3 groups with counts
Precondition: appDataWithShortlisted mocked
Viewport: desktop
Steps:
  1. Sidebar shows "To view" / "Viewed" / "Dropped" group headers with counts
Success criteria: counts match entries per status bucket
Status: [existing: shortlist.spec.ts]
```

```
## Flow: Row click renders main pane — hero + verdict band + checklist + right column
Precondition: appDataWithShortlisted mocked
Viewport: desktop
Steps:
  1. Click a sidebar row → HeroRow, VerdictBand, ChecklistCard, AskAtViewing,
     NegotiationCard all render in the main pane
Success criteria: no crash, all 5 sub-components present
Status: [existing: shortlist.spec.ts hero+verdict+after-viewing]
  + [new: qa-shortlist.spec.ts full main-pane assertion]
```

```
## Flow: Approved entry hero — Schedule viewing → date picker → save → status transitions
Precondition: appData with one 'approved' entry
Viewport: desktop
Steps:
  1. "Schedule viewing" button visible on approved entry hero
  2. Click it → inline datetime-local picker appears
  3. Pick a date, click "Confirm" → POST /api/entry/{id}/schedule-viewing fires
Success criteria: POST body includes scheduled_at ISO string
Status: [new: qa-shortlist.spec.ts]
```

```
## Flow: Viewing_scheduled hero — Mark viewed → status flips to viewed → after-viewing bar appears
Precondition: appData with one 'viewing_scheduled' entry
Viewport: desktop
Steps:
  1. "Mark viewed" button visible
  2. Click it → POST /api/entry/{id}/mark-viewed fires
Success criteria: POST fired; (status flip itself depends on refetch, verified
  via a route mock that returns status=viewed on the next /api/data poll)
Status: [new: qa-shortlist.spec.ts]
```

```
## Flow: Viewed hero — after-viewing bar 3 buttons (Still in / Thinking / Drop)
Precondition: viewedEntry mocked
Viewport: desktop
Steps:
  1. "Still in" → POST viewing-decision(decision='still-in') → new_status=offer_drafted
  2. "Thinking" → POST viewing-decision(decision='thinking')
  3. "Drop" → opens DropDrawer → confirm → POST viewing-decision(decision='drop', reason)
Success criteria: correct decision string in each POST body
Status: [existing: shortlist.spec.ts "Still in"] + [new: qa-shortlist.spec.ts Thinking + Drop]
```

```
## Flow: Dropped row shows strikethrough + "Undo drop" button replaces after-viewing bar
Precondition: droppedEntry mocked
Viewport: desktop
Steps:
  1. Sidebar row title has strikethrough (line-through class) + reduced opacity
  2. Selecting the row shows "Undo drop" button instead of the 3-button bar
  3. Click "Undo drop" → POST viewing-decision(decision='thinking')
Success criteria: bar variant matches dropped status
Status: [existing: shortlist.spec.ts dropped-row title] + [new: qa-shortlist.spec.ts Undo drop]
```

```
## Flow: Checklist accordion — THE REPORTED BROKEN FLOW
Precondition: 4 data-shape variants (see below)
Viewport: desktop + mobile
Steps:
  1. entry.checklist=null, ai_checklist_fills=null → "No checklist data yet" empty
     state, no crash
  2. entry.checklist={} (empty object, no .groups) + ai_checklist_fills=null →
     same empty state, no crash
  3. entry.ai_checklist_fills={s14_01: "Kesklinn, 15 min", s16_03: "", ...} (REAL
     production shape — flat string map) → groups render correctly assigned by
     key (s14_01 → location, not dumped into "quality"), item shows readable
     label (not raw key "s14_01") + the filled text as a note line, state=ok
     (green check), NOT a gray "?"
  4. entry.checklist.groups=[...] (new structured shape, used once a listing has
     gone through the full manual-checklist writer) → renders as-is, flag-first
     ordered, signal strip renders one square per item
  5. Chevron click toggles a group's expanded/collapsed state
  6. Bottom meta line "N items · the M unknowns become your viewing questions"
     renders when totalItems > 0
Success criteria: no data shape produces a blank/broken accordion or crash;
  real production shape (#3) renders meaningful labels+text, not cryptic codes
Status: [new: qa-shortlist.spec.ts qa-checklist-* tests — this is the confirmed
  root-cause fix from this sweep, see ChecklistCard.tsx / checklistMeta.ts]
```

```
## Flow: Ask at the viewing card — lists unknown items as checkboxes
Precondition: entry with ai_checklist_fills covering 5 of 13 fillable keys
Viewport: desktop
Steps:
  1. AskAtViewing renders one checkbox row per key NOT present/filled in fills
  2. Clicking a checkbox toggles its checked/strikethrough state (local only)
  3. Empty state: all 13 keys filled → "No open questions" message
Success criteria: unknown-count matches (13 - filled-count)
Status: [new: qa-shortlist.spec.ts — this is the parallel fix alongside the
  checklist accordion bug]
```

```
## Flow: Negotiation card — greyed pre-viewing, active post-viewing
Precondition: approved entry (gated) vs viewed entry with negotiation_brief (active)
Viewport: desktop
Steps:
  1. approved/viewing_scheduled status → opacity-45 pointer-events-none +
     "unlocks after viewing" label
  2. viewed+ status with a brief → offer range + brief text + action buttons
     render at full opacity
  3. "regenerate" link → POST /api/entry/{id}/regenerate-brief fires
Success criteria: gating class present/absent per status
Status: [new: qa-shortlist.spec.ts]
```

```
## Flow: Compare — Cmd+click 2 rows → Compare button + C keyboard → overlay → Esc closes
Precondition: 2 shortlisted entries with differing scores
Viewport: desktop
Steps: (see full detail in compare.spec.ts)
Success criteria: only differing rows shown, Esc/backdrop both close
Status: [existing: compare.spec.ts — all 4 sub-flows]
```

```
## Flow: own_score slider (viewed entries) — debounced POST fires after 800ms
Precondition: viewedEntry mocked
Viewport: desktop
Steps:
  1. Drag/set slider value → local state updates immediately
  2. After 800ms with no further change → POST /api/entry/{id}/cost-override fires
     with own_score
Success criteria: no POST fires before debounce window elapses
Status: [existing: src/test/HeroRow.test.tsx Vitest coverage]
  + [new: qa-shortlist.spec.ts Playwright-level confirmation]
```

## Shortlist — mobile

```
## Flow: Sidebar OR main pane, never both. Row tap → full-width main pane + Back button
Precondition: appDataWithShortlisted mocked
Viewport: mobile
Steps:
  1. No selection → only sidebar visible
  2. Tap a row → sidebar hidden, main pane full-width with "Back" button
  3. Tap "Back" → sidebar visible again, main pane hidden
Success criteria: exactly one of {sidebar, main pane} visible at a time
Status: [existing: mobile-snapshots.spec.ts "only sidebar visible" +
  "main pane visible after row tap"] + [new: qa-shortlist.spec.ts Back button round-trip]
```

```
## Flow: All above flows adapted for mobile viewport
Status: [new: qa-shortlist.spec.ts checklist + after-viewing bar tests run on
  webkit-mobile project as well as chromium-desktop where the flow doesn't
  require the desktop-only sidebar]
```

---

## Settings

```
## Flow: All 5 categories load with correct fields
Precondition: fullSettings mocked
Viewport: desktop
Steps: click each of Buyer profile / Scoring & AI / Cost model / Telegram / Scraper
Success criteria: heading + subtitle change per category
Status: [existing: settings.spec.ts]
```

```
## Flow: Slider change → Save enabled → Save → POST /api/settings → toast "Saved"
Precondition: fullSettings mocked
Viewport: desktop
Steps: as titled
Success criteria: POST fires with changed field, toast appears
Status: [existing: settings.spec.ts]
```

```
## Flow: Reload → new value persists
Precondition: mock GET /api/settings to return the updated value after a save
Viewport: desktop
Steps:
  1. Change + save a field → local mock server "persists" the new value
  2. Reload the page → GET /api/settings returns the new value → slider reflects it
Success criteria: value on reload matches what was saved, not the original mock
Status: [new: qa-settings.spec.ts]
```

```
## Flow: Toggle switch (rank_by_all_in) → save → shortlist sort order changes
Precondition: two shortlisted entries where all-in cost reorders relative to score
Viewport: desktop
Steps:
  1. Toggle rank_by_all_in true → save
  2. Navigate to #shortlist → sidebar row order reflects rankByAllIn() output
Success criteria: order differs from the score-only default ordering
Status: [new: qa-settings.spec.ts]
```

```
## Flow: Mobile — horizontal category strip on top, form below, Save in header
Precondition: fullSettings mocked
Viewport: mobile
Steps: as titled
Success criteria: category pills scrollable, Save button reachable
Status: [existing: mobile-snapshots.spec.ts "horizontal category strip rendered"]
  + [new: qa-settings.spec.ts Save button flow on mobile]
```

---

## Cross-cutting assertions applied to every new spec

- `page.on('pageerror')` + `console.error` listener → no unexpected JS errors
  (matches the filtering convention already used in `smoke.spec.ts`)
- `[data-testid="error-boundary"]` must never be visible (added to
  `ErrorBoundary.tsx` in this sweep)
- Screenshots captured at key states under `frontend/e2e/fixtures/screenshots/`
