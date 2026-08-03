# Aparts Looker — redesign spec

For a coding agent working in `app/static/`. Vanilla HTML/CSS/JS, no build step, no framework. Leaflet stays. Chart.js optional; the two charts here are hand-rolled SVG and simpler that way.

Mockups: `Aparts Looker - Redesign.dc.html` in this project. Option ids (`1a`, `2b`, `3c`…) are referenced throughout — open the file and match against them.

---

## 0. Product model — read this first

Three states, three verbs, and they must not blur:

| State | Set by | Means | Lives in |
|---|---|---|---|
| `new` | scraper + scoring | not yet triaged | Inbox |
| `shortlisted` | Daniel, from Inbox | "worth a closer look" — cheap, 2-second gesture | Shortlist |
| `skipped` | Daniel, from Inbox | not worth a look; optional reason | nowhere (reachable via filter) |
| `viewed` | Daniel, after a viewing | has been seen in person, carries his own score | Shortlist / Viewed |
| `offering` \| `thinking` \| `dropped` | Daniel, after a viewing | the expensive decision | Shortlist |

Consequences that the current build gets wrong:

1. **A listing appears in exactly one list.** Today pending listings show up both in the Pending tab and in Detail's sidebar. Detail's sidebar must contain only shortlisted + viewed items.
2. **Tabs are renamed to their verb.** `Pending` → **Inbox**, `Detail` → **Shortlist**, `Overview` stays, `Comparison` tab is **deleted** (becomes an overlay, §5), `Settings` stays.
3. **Copy: "Approve" → "Look closer", "Reject" → "Skip".** Approve reads like a purchase decision; it is not one. DB values (`status` enum) can stay as they are — this is a label change only, so no migration.
4. **Telegram is a notifier.** Remove the `/approve` `/reject` inline keyboard. The card carries photo, score, price, one-line verdict, and a deep link into the app (`/inbox?listing=<id>`). All triage happens in the app. Consequence: the **mobile Inbox is a primary surface**, not a courtesy view (§2).

---

## 1. Design tokens

Put these in `:root` in the `<style>` block of `index.html`. Nothing below should be hard-coded elsewhere.

```css
:root {
  /* ground & chrome */
  --bg:            #0f111c;  /* page canvas, map background */
  --app:           #161826;  /* app background */
  --sunken:        #1d1f2d;  /* cards, panels */
  --surface:       #232532;  /* raised: sheets, dialogs, hero card */
  --border:        #292b31;  /* hairlines — use inset box-shadow, not border */
  --border-strong: #3f424d;

  --text:          #e9e9ed;
  --text-2:        #cfd3e5;  /* body copy, verdicts */
  --text-3:        #9397ab;  /* secondary */
  --muted:         #75798c;  /* labels, axis ticks */
  --faint:         #595d6c;  /* disabled, hints */

  --accent:        #9184d9;
  --accent-lt:     #b5abfc;  /* accent text on dark — use this, not --accent, for labels */

  /* score ramp — the only place saturation carries meaning */
  --s-bad:   #c4635f;  /*  0–39 */
  --s-weak:  #c98b52;  /* 40–59 */
  --s-mid:   #c9b455;  /* 60–74 */
  --s-good:  #7fbf7a;  /* 75–84 */
  --s-best:  #4fb98d;  /* 85–100 */

  /* status */
  --st-new:      #d9a473;
  --st-short:    #6fc9a3;
  --st-skip:     #d4827e;
  --st-viewing:  #93aee0;
  --st-viewed:   #75798c;

  /* spacing — 4-based */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-6: 24px; --sp-8: 32px; --sp-12: 48px;

  --r-sm: 4px; --r-md: 6px; --r-lg: 8px; --r-xl: 14px;

  --sh-sm: 0 1px 2px rgba(0,0,0,.4);
  --sh-md: 0 4px 12px rgba(0,0,0,.45);
  --sh-lg: 0 10px 30px rgba(0,0,0,.5);

  --font: Inter, system-ui, -apple-system, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;

  --ease: cubic-bezier(.2,.7,.3,1);
  --t-fast: 120ms;  /* opacity */
  --t-base: 160ms;  /* transform, height */
}
```

### Score → colour

One function, used by map pins, sidebar rules, badges, charts, everything:

```js
function scoreColor(s) {
  if (s == null) return 'var(--muted)';
  if (s >= 85) return 'var(--s-best)';
  if (s >= 75) return 'var(--s-good)';
  if (s >= 60) return 'var(--s-mid)';
  if (s >= 40) return 'var(--s-weak)';
  return 'var(--s-bad)';
}
```

Never use score colour as a large background fill. It appears as: a 2px left rule on rows, a small badge with dark text (`#0f160f` on the two greens, `#160f0f` on the three warm stops), a map pin fill, a chart point fill, or a numeral colour.

### Type

Five roles only. Numbers that are ever compared column-to-column use `--mono` with `font-variant-numeric: tabular-nums`.

| Role | Spec | Used for |
|---|---|---|
| display | `--mono`, 34px/1, 500, `-.025em`, **`white-space: nowrap`** | hero figures: price, area, score, monthly |
| title | `--font`, 26px, 500, `-.02em` | listing name on Shortlist |
| card-title | `--font`, 15–18px, 500 | card headings |
| body | `--font`, 13–14px/1.55, 400, `--text-2` | verdicts, checklist items, briefs |
| meta | `--mono` or `--font`, 11–12px, 400, `--muted` | €/m², dates, counts |
| label | `--font`, 9.5–10px, 600, `.1em`, uppercase, `--muted` | section headings |

Display figures must never wrap — `white-space: nowrap` on every one, and `flex: none` on its container. `183 000 €` breaking before the `€` is the most visible way this design fails.

Cyrillic: Inter covers it; do not add a fallback stack that swaps fonts mid-string. Verdicts and negotiation briefs are Russian, Estonian addresses and checklist items are Estonian, UI chrome is English. Set `text-wrap: pretty` on verdict paragraphs.

### Motion

Three rules, no exceptions. `opacity var(--t-fast) var(--ease)`, `transform`/`height var(--t-base) var(--ease)`, no bounce/spring/loop. Accordions animate `height` only. Wrap everything in:

```css
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
```

### Icons

Phosphor, regular weight, 16px, `currentColor`. Vendor the ~12 glyphs actually used as inline SVG symbols in `index.html` (`<svg><symbol id="ph-calendar">…`), reference with `<use href="#ph-calendar">`. No icon font, no CDN, no emoji in UI chrome.

### Focus & hover

```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

Every clickable row/card/button needs a hover tint (`background: rgba(255,255,255,.03)`) and a pressed state. No default browser focus rings anywhere.

---

## 2. Screens

### 2.1 Shell (`nav`)

48px bar. Brand mark (8px accent square + wordmark), then tabs: Overview · Inbox · Shortlist · Settings. Inbox carries a count badge in `--st-new` when > 0. Right side: `scraped N min ago` in meta type, plus a Refresh button. See `1b`.

Tab: `padding: 6px 10px; border-radius: var(--r-md)`. Active = `background: rgba(145,132,217,.14); color: var(--accent-lt)`.

### 2.2 Overview — `1b`

Grid `1fr 372px`, gap 12, page gutter 20.

**Map (left, fills).** Leaflet, `--bg` background. Pins are DivIcons: circle, diameter scales with score (26–34px), fill `scoreColor(score)`, dark numeral inside, `box-shadow: 0 0 0 4px <fill at 16% alpha>`. District polygons: `fillColor` from the €/m² quartile using the score ramp reversed (cheap = `--s-best`), `fillOpacity: .06`, `weight: 1`, `color` = same at 25%. Isochrone: no fill, 1.5px dashed `--accent-lt` at 45%. Filter pills top-left, layer toggles top-right, quartile legend bottom-left — all `background: rgba(35,37,50,.75)`, hairline, `--r-md`.

**Charts (left, below, two-up, ~150px tall).** See §3.

**Right rail.** Hero "Best today" card (`--r-xl`, `--surface`, 1px `--s-best` at 35%, `--sh-lg`), a three-metric "This week" strip, then a "Next up" list of shortlisted rows sorted by score.

**New: calibration panel** — see `3c`. Only render at ≥5 rated viewings; below that the slot is not shown at all (no empty box).

### 2.3 Inbox — desktop `2a`, mobile `3a`

**Desktop.** Three-column card grid, gap 12. Card: `--sunken`, `--r-lg`, hairline; photo 132px with score badge top-right; title, meta, price row, verdict with 2px `scoreColor` left rule; two buttons at the bottom pinned with `margin-top: auto`. Focused card gets `box-shadow: inset 0 0 0 1px var(--border), 0 0 0 1px rgba(145,132,217,.4)`.

Keyboard, shown as hints in the header: `L` look closer, `S` skip, `↑ ↓` move focus, `Enter` open detail. Implement as one `keydown` listener on `document` guarded by `if (e.target.closest('input,textarea')) return;`.

**Skip → reason.** Overlay covering the card body below the photo, `rgba(22,24,38,.92)`. Heading "Skipped — what put you off?", sub "Optional. It only tunes future scoring." Six chips: Price, Location, Condition, Layout, Building, Other. Undo button + `auto-closes 8s`. Skipping without picking a reason is a valid, silent path — do not block on it.

**Mobile (375px).** One card at a time, not a scrolling list — this is now the primary triage surface. Progress: `N of M` plus a 6-segment 2px bar. Card fills the viewport between header and action block; a second card peeks 6px behind it to imply a stack. Actions pinned to the bottom, full width, 17px `Look closer` / 15px `Skip` / ghost `Later`. **All hit targets ≥ 48px tall.** Reason picker is a bottom sheet with 36×4px grab handle, chips at `padding: 9px 14px`.

**Cleared state** — `3a`, third frame. Summary of what was just decided, then a single `Open shortlist · N` button. Not a celebration, not an illustration.

### 2.4 Shortlist — `2b`

Grid `284px 1fr`.

**Sidebar is the funnel**, three labelled groups: `To view` (N), `Viewed` (N), `Dropped` (N, collapsed by default, `show` toggle). Rows: 2px `scoreColor` left rule, mono score at 15px, title, `price · area` meta, right-hand status hint (booked date in `--st-viewing`, `offer` in `--st-short`, `thinking`/`unbooked` in `--muted`). Dropped rows: 40% opacity, title struck through. Selected row: `background: rgba(145,132,217,.1)`.

Footer line, `--faint`, 11px: *"Inbox decides worth a look. This list decides worth an offer."*

**Main pane, top to bottom** — this is the "shape" the current wall-of-text lacks:

1. **Hero band.** 300px photo left; right: status chips + title + meta, then the display-figure row separated by `inset 1px 0 0 var(--border)` dividers: **all-in cost** (§4), area, score, monthly. `1c`/`3b`.
2. **Verdict band.** Full width, `--sunken`, 2px `scoreColor` left rule, 15px/1.55 Russian text. Right side: three counts — *N flags* / *N unknown* / *N ok*.
3. **After-the-viewing bar** (only when `status = viewed`). `2b`. Three buttons: `Still in — draft offer` (primary), `Thinking`, `Drop`.
4. **Two columns, `1fr 340px`:** checklist left (§2.5), and right: *Ask at the viewing* (checkbox list built from the checklist's `unknown` items), cost-of-ownership, negotiation.
5. **Negotiation is disabled until `status = viewed`** — 45% opacity, label `unlocks after viewing`, `Preview draft` only. The argument list is only honest once he has been there.

### 2.5 Checklist — pick `1c`, keep `1d` as a reference

**Ship `1c`: flag-first collapsible groups.** Five groups (finance, quality, location, building fund, risk). Each header row: 2px left rule in the group's worst-item colour, group name + Estonian sub-label, a **signal strip** (one 7×7px rounded square per item, coloured `ok` = `--s-best`, `unknown` = `--faint`, `flag` = `--s-bad`/`--s-weak`), a count, a chevron.

Open by default iff the group contains a flag. Groups with only `ok` items collapse and summarise as `N ok`. Inside an open group: one row per item — 12px glyph (`✓` `✕` `?` `!`), 13px text, optional `−N pts` or `ask broker` on the right. Consecutive `ok` items at the end of a group collapse into one row: `Küte renoveeritud 2019 · trepikoda korras · 4 more`.

`1d` (five-column grid, all 40 visible, tinted flag column) is the alternative — build it behind a `?checklist=grid` flag if you want to A/B it, but the default is `1c`.

### 2.6 Settings — `1f`, plus §4

Left rail of sections: Buyer profile · Scoring & AI · **Cost model** · Telegram · Scraper. Two-column body: plain controls left, cards right. Sliders: 4px track `--border`, `--accent` fill, 12px `--text` knob. Segmented control for rooms. District chips with `✕`. Weight sliders must sum to 100 — show the running total and block save if it doesn't.

Telegram threshold uses the **score ramp as its track** (`linear-gradient` of the five stops at 75% opacity) with a 3px white marker — it's the one place the whole ramp is legible at once. Show the consequence under it: `≈4 cards a week at this level`.

### 2.7 Empty states — `1h`

Two only. **Inbox empty:** explain *why* (everything scored below threshold), when the next scrape is, and offer the two actions that change it (lower threshold, scrape now). **First run, no listings:** a three-row checklist of what must be true (profile saved, scraper posted, bot connected) with real values on the right. No illustrations, no "get started" hero.

---

## 3. Charts — hand-rolled SVG, no chart lib

Both live in `js/charts.js`, both take `(listings, container)` and re-render on filter change. Each answers a question stated in its title.

### 3.1 "Where the scores land" — histogram

Ten bins of 10. Bar fill = `scoreColor(binMidpoint)`, `border-radius: 2px 2px 0 0`. Baseline is a 1px `--border-strong` rule; no left axis, no gridlines. Ticks below at 0 / 25 / 50 / 75 / 100, and **75 is labelled `75 · approve line`** in `--text-3` — the tick is the point of the chart. Header right: `median N · n=M`. Hover: bar to full opacity + a small popover `N listings, 60–69`.

### 3.2 "Is a good score expensive?" — scatter

X = score (30–100), Y = price (inverted: cheap at top). Points `r=4.5`, fill `scoreColor`, `r=5.5` + a 4px halo for shortlisted. A horizontal dashed `--border-strong` line at the budget ceiling, labelled `budget 265k` in mono 9.5px. Axis frame is `inset 1px -1px 0 var(--border-strong)` on the plot box — two edges, not four.

Hover card: `--surface`, `--r-md`, `--sh-md`, three lines (title / `price · €/m² · score`). Positioned with `transform` and clamped to the container. Click = select in Shortlist.

Both charts: `escapeHtml()` every string that reaches a tooltip (§7).

---

## 4. All-in cost — new

The core of it: **Daniel owns the prices, the AI owns the classification.** The model never invents a euro figure.

**Settings → Cost model → Renovation rates** (`3b`, right). A table of line items the user can edit and extend. Each row: label, rate, unit. Defaults:

| item | rate | unit |
|---|---|---|
| kitchen_full | 12000 | € |
| bathroom_full | 7000 | € |
| windows | 420 | €/unit |
| floors | 100 | €/m² |
| rewire | 58 | €/m² |
| heating | 2600 | € |
| cosmetic | 35 | €/m² |

Plus a **contingency** slider (default 15%) applied on top of the subtotal, and a toggle **Rank shortlist by all-in** (default on).

**The AI's contract per listing** — this is the only new field it produces:

```json
{ "renovation_items": [
    { "key": "kitchen_full", "applies": true,  "confidence": 3, "qty": null, "note": "фото 4: старая кухня" },
    { "key": "floors",       "applies": true,  "confidence": 1, "qty": 30,   "note": null },
    { "key": "rewire",       "applies": null,  "confidence": 1, "qty": null, "note": "не видно, спросить" },
    { "key": "windows",      "applies": false, "confidence": 3, "qty": null, "note": "заменены 2016" }
] }
```

`confidence` is 1–3 and renders as the three-bar strip. `applies: null` = unknown; cost is included in the estimate but the row is muted and the item is auto-added to *Ask at the viewing*.

Client-side maths, so editing a rate re-costs everything instantly with no AI call and no re-score:

```js
work = round(sum(items.where(applies !== false).map(i => rate[i.key] * (i.qty ?? 1))) * (1 + contingency));
allIn = price_eur + work;
band  = round(work * 0.25);   // the ±figure; widen to 0.4 if any item has confidence 1
```

Display as `price + work = all-in` (`3b`, left), with all-in in `--accent-lt` and a `€/m²` recomputed on all-in. Store the resolved estimate on the listing's existing `cost_of_ownership` JSONB (new key `renovation`) — no schema change.

**Also add an `Override` action** per listing that pins a manual work figure and marks the estimate as user-set.

---

## 5. Compare — overlay, not a tab

Delete the Comparison tab. Instead: multi-select two rows in the Shortlist sidebar (cmd-click or checkbox), press `C` or click *Compare*, get the overlay in `3d`.

Dialog 1000px wide, `--app`, `--r-lg`, `--sh-lg`, backdrop is the shortlist at 22% opacity. Layout is a `172px 1fr 1fr` grid: label column, then one column per listing with a 104px photo and title.

**Only render rows that differ.** Rows: all-in cost, area, monthly, vs sold €/m², score + your score, flags, commute. Better side gets `--st-short` — and it is explicitly allowed to be split across columns; do not compute an overall winner. Footer: one action per column (`Draft offer on this one` / `Drop this one`). `Esc` closes.

---

## 6. Maa-amet sold-price baseline — new

Every "−4% vs district" today compares against **asking** prices scraped from kv.ee. Replace with actual transaction prices.

Individual transaction records from the Land Board's transactions database are access-restricted (released to valuers, official statisticians, public research bodies, licensed credit institutions, or others on a justified legitimate-interest basis), so **do not build against per-address comps.** The public price-statistics query environment is the right source: apartment-ownership price statistics can be broken down by area, by the building's load-bearing structure and year of first use, over months/quarters, with Excel export. Monthly and quarterly overviews are published by the 20th of the following month.

Implementation:

1. A monthly manual (or cron'd) pull → one CSV/XLSX per quarter, committed as a data file. No live API, no X-Road membership.
2. Ingest into a small lookup table keyed `(district, structure, decade_built, quarter)` → `median_eur_sqm`, `n_transactions`.
3. Match a listing to the finest bucket with `n >= 5`, else fall back one dimension at a time (drop decade, then structure). Store which bucket was used.
4. Display as `−6% vs sold Kalamaja` with the bucket visible on hover: `Q2 pre-war brick · n=23`. If no bucket reaches n≥5, print `no comparable sales` — never a fabricated percentage.
5. Attribute the source in Settings → Cost model: data source Maa-amet transactions database.

Also add a **`sold` / `withdrawn` state**: when a listing disappears from kv.ee, mark it and keep it. Days-on-market of vanished listings is the signal that tells Daniel how fast he has to move.

---

## 7. Non-negotiables

- **`escapeHtml()` on every scraped or AI-produced string** written into DOM, tooltip, or attribute. That includes verdicts, checklist items, negotiation briefs, addresses, and renovation `note` fields. Never `innerHTML` with such a string; prefer `textContent`, or build nodes.
- No new backend endpoints and no schema migrations. New data rides existing JSONB columns: `renovation` under `cost_of_ownership`, `own_score` / `own_note` / `own_tags` under `viewing_history`, `renovation_items` on `checklist`.
- No framework, no bundler, no component library. Keep the file layout: `app/static/index.html` (markup + the one `<style>`), `js/{map,charts,inbox,shortlist,compare,ui}.js`.
- Do not bold headings past 500. Hierarchy is size and space.
- Do not flood any area with the accent or a score colour.
- No pure black or pure white.

---

## 8. Order of work

1. Tokens + type + `scoreColor()` + focus/hover states, applied to the existing markup. Nothing moves yet; everything already looks intentional.
2. Rename tabs, split the lists (§0.1–0.3), copy change. Removes the conceptual bug.
3. Telegram → notifier only; build the mobile Inbox (`3a`). These two ship together or the couch workflow breaks.
4. Shortlist shape (`2b`) + checklist `1c`.
5. Charts (§3).
6. All-in cost (§4) — Settings rates first, then the hero row.
7. Maa-amet baseline (§6).
8. Compare overlay (§5), calibration panel (§3c) — both are additive and can wait.
