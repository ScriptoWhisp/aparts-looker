# Deferred Items — Quick Task 260808-vae

Out-of-scope discoveries surfaced while verifying this task (SCOPE BOUNDARY —
not fixed, logged only).

## Pre-existing e2e failures unrelated to the checklist rewrite

Found while running the full Playwright suite (`npx playwright test`) after
this task's changes. None reference the checklist UI; all reproduce on the
component/test files below, which this task did not touch.

| Spec | Test | Likely cause |
|------|------|---------------|
| `e2e/qa-shortlist.spec.ts` | `Negotiation card is gated (opacity + locked copy) for approved status` | `NegotiationCard.tsx`'s own doc comment says "opacity-45 pointer-events-none with 'unlocks after viewing' kicker", but that copy/gating is no longer in the rendered component — predates this session (`git log` shows `fix(negotiation): read suggested_offer_{low,high}_eur from backend + ungate` as the most recent commit touching the file). |
| `e2e/mobile-snapshots.spec.ts` | `mobile overview: single-column stack, no broken narrow elements` | Leaflet map renders when the mobile overview test expects it hidden. |
| `e2e/mobile-snapshots.spec.ts` | `mobile shortlist: only sidebar visible without selection` | NoSelection placeholder appears when the test expects it hidden on mobile. |
| `e2e/mobile-snapshots.spec.ts` | `mobile shortlist: main pane visible after row tap` | "Back" button not visible within timeout. |
| `e2e/mobile-snapshots.spec.ts` | `mobile settings: horizontal category strip rendered` | Sidebar width assertion fails (not collapsed to expected value on mobile). |
| `e2e/feedback.spec.ts` | `submitting feedback shows a toast and the report appears in the Feedback list` | Unrelated feedback flow. |
| `e2e/qa-inbox.spec.ts` | `mobile — Later moves the card to the end of the queue with no network call` | Unrelated inbox flow. |

None of these touch `backend/checklist_registry.py`, `ChecklistCard.tsx`, or
any file this task modified. Recommend a separate quick task / debug session
to triage.
