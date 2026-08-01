# Aparts Looker — Design Brief for Claude Design

> Paste this into a fresh Claude Design (or Claude.ai) chat. The brief is self-contained — Claude Design shouldn't need to ask clarifying questions before producing mockups. If it does ask, the missing context probably belongs in this file.

---

## The product in one sentence

A personal command center for one person hunting an apartment to buy in Tallinn, Estonia — surfaces the best new listings, tracks viewings, prepares negotiations. Not a marketplace. Not a SaaS.

## The user

One user, Daniel — technical, works at a modern tech company (Bolt), reads a lot of dashboards during the day (Linear, Vercel, Sentry, Grafana), has strong opinions on visual hierarchy. Uses the dashboard from a laptop, occasionally from a phone on the couch. Not a designer, but immediately notices "this looks unfinished" and finds it demotivating to open.

## What the app does end-to-end

1. A scraper on Daniel's home mini PC fetches new listings from kv.ee every 2 hours and POSTs them to the server.
2. Claude Haiku scores each listing 0–100 against Daniel's buyer profile and generates a one-line Russian verdict + a ~40-item structured checklist (finance / quality / location / building fund / risk).
3. High-score listings trigger a Telegram card with `/approve` `/reject` inline buttons. Daniel decides.
4. Approved listings show up in the web dashboard. Daniel schedules viewings, marks them viewed, and reviews AI-drafted negotiation briefs + broker outreach emails.
5. Rejected listings inform future AI scoring (rejected-because-price → down-weight similarly-priced future listings).

## Current UI (what exists today)

Static HTML/CSS/JS served by FastAPI. No framework. Leaflet for the map. Vanilla `<canvas>` for charts. Basic-auth prompt on entry (Caddy handles it).

**Tabs (top nav):**

1. **Overview** — the "one screen to open in the morning"
   - Leaflet map of Tallinn with score-colored pins per listing, district polygons colored by quartile of avg €/m², optional isochrone showing the ~30-min commute from Bolt HQ (Veerenni 28).
   - Filter pills: "all / approved / pending". A districts toggle.
   - Two charts: a score distribution histogram and a price-vs-score scatter. Both feel bolted on — Daniel called them "not very beautiful".
   - A "BEST" hero card at the top — clicks through to the Detail tab.

2. **Detail** — the deep dive per listing
   - Left sidebar: a scrolling list of listings (approved + pending), each row: title, price, score, glyph (📅 scheduled / ✓ viewed).
   - Right main pane, top to bottom for the selected listing: photo gallery, title/address, price/area/rooms row, score + verdict, AI-generated checklist (~40 items), cost-of-ownership card (monthly total, breakdown), negotiation brief card (free-form Russian paragraph + suggested offer range), KÜ card (building fund lookup), price history, external kv.ee link, action buttons (Schedule viewing, Mark viewed, Refresh KÜ, Draft Email, Regenerate brief).
   - The main pane is a wall of text. The checklist alone is overwhelming.

3. **Pending** — the approval queue
   - Card list. Each card: photo, title, score, price, verdict, approve/reject buttons. Rejecting opens a reason picker (price / location / condition / other).

4. **Comparison** — side-by-side listing cards for direct comparison. Rarely used.

5. **Settings** — a form with grouped inputs (AI knobs, cost knobs, filter knobs, telegram thresholds). Utilitarian.

**Aesthetic today:**
- Default browser fonts.
- No consistent color palette — mostly white/gray with random accent colors from Leaflet, chart libs, and ad-hoc CSS.
- Density is uneven: the Overview tab feels sparse but crowded; the Detail tab feels dense but text-heavy.
- No animations. No transitions. No sense of information hierarchy — the verdict, the checklist, the price all look equally important.
- Score is shown as a plain number in most places. Occasionally as a horizontal bar. No visual language for "high score = go look at this now".

## What Daniel wants

Reference points he's mentioned or shown appreciation for:
- **Linear** — density with clarity, dark theme, meaningful color coding.
- **Vercel dashboard** — restrained palette, generous whitespace on top-level views, dense on detail views.
- **Sentry issue detail** — how one big data-heavy screen can still feel scannable.

He probably wants:
- **Dark theme** (or dark-friendly, at minimum). This is a tool he opens at night after work.
- **Real color logic** — score should have a color that means something (green = act, amber = maybe, red = probably not). One consistent scale, applied everywhere score appears.
- **Typographic hierarchy** — one glance should tell him "this is a €239k, 70m², score 82 listing in Mustamäe". Right now that data is present but visually flat.
- **Chart quality worth looking at** — not chartjunk. Distribution should be a proper histogram with axis labels that mean something; scatter should have score-color-coded points, hover cards, and readable axes.
- **Checklist that doesn't scream** — 40 items should be groupable, collapsible, or use visual density (icons, tiny check/cross glyphs, subtle grouping bars) rather than 40 lines of text.
- **A Detail tab that has a "shape"** — image + hero data + verdict on top, then progressive disclosure of the details.

## Constraints

- **Vanilla HTML/CSS/JS only.** No React, no Vue, no build step. Leaflet is fine. Small utility libs are fine (Chart.js, tiny CSS libs). No enormous frameworks.
- The current file layout is: `app/static/index.html`, `app/static/js/*.js` (comparison, detail-panel, map, ui), one CSS file inside `index.html` `<style>` block. A redesign that keeps this shape is easier to land than one that requires restructuring.
- Estonian real-estate context: prices in EUR, area in m², district names in Estonian (Mustamäe, Kesklinn, Nõmme, Kalamaja, etc.). Verdicts and negotiation briefs are in Russian (Daniel's native language) — the design must handle Cyrillic gracefully.
- The current implementation uses `escapeHtml()` for every string written into DOM/tooltips. Preserve that discipline — no `innerHTML` with user/scraped strings.
- No backend changes proposed. Design should assume the existing API shapes (see the `docs/features.md` inventory for what data each screen already has).

## What I want you to produce

1. **A design system, briefly stated:**
   - Color palette (dark theme). Primary, accent, score gradient (bad → good), status colors (pending amber, approved green, rejected red, viewing_scheduled blue, viewed dim).
   - Typography scale (2–3 sizes for text, one display size for hero numbers).
   - Spacing scale (4-based or 8-based).
   - Icon language (single library, or emoji if that's the cleanest fit).
   - Motion language (2–3 rules: fades ≤ 150ms, easing curve, no bounces).

2. **Screen designs (mockups) for the 4 real tabs** — Overview, Detail, Pending, Settings. Comparison can be skipped (rarely used). For each screen:
   - Full-page layout at 1440×900 (typical laptop).
   - Mobile view at 375×812 (Detail and Pending only — Overview map isn't useful on mobile).
   - Callouts on the components that repeat (listing row, listing card, metric card, chart container).

3. **Detail-tab specifically** — the biggest opportunity. Show how a 40-item checklist can live in one screen without exhausting the reader. Grouping? Progressive disclosure? A "quick verdict" band with drill-down? Your call — show me two options and I'll pick.

4. **Chart redesign** — the distribution histogram and price-vs-score scatter. Even a rough sketch (aesthetics + axis annotations) is enough. Point is to move away from "default chart lib output" toward "chart that answers a question".

5. **Empty states** — first-run when the pending queue is empty and no listings exist yet.

6. **Delivery format:** Figma or a rendered PNG per screen is fine. Include hex codes and font sizes so I can translate to CSS directly.

## Do NOT propose

- New features (out of scope).
- Backend / API changes.
- A framework migration (React etc.).
- A build pipeline.
- A component library (Radix, shadcn) — the deliverable is CSS I can paste in, not a JS dependency graph.

## References for you (optional reading)

- `docs/features.md` in this repo — the full feature inventory, what data each screen already shows.
- Current data model: a Postgres `listings` table with columns for the flat scalars (id, title, price_eur, area_sqm, rooms, year_built, energy_class, district, lat/lng, status, score, verdict) plus JSONB columns for nested structures (cost_of_ownership, viewing_history, negotiation_brief, ku, price_history, checklist).

---

Ready when you are. Start with the design system, then pick one screen and go deep — I'll iterate from there.
