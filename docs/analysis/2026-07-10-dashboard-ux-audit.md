# Dashboard UX Audit — 2026-07-10

Method: live inspection of the running dashboard at `http://127.0.0.1:4311` (branch `qa/current`, 5 enabled sources, 357 stored jobs), cross-checked against `docs/learnings.md` UX rules and the apply-engine ExecPlan's UX Standards. Screenshots taken of Search, Ready, and Disabled tabs plus the full results surface.

Verdict: the primary failure is not visual polish — it is that the dashboard tells three contradictory stories about the same data and offers no way to reconcile them. Polish issues are real but secondary. Fixing trust legibility is a precondition for shipping an apply flow on this surface; nobody drafts applications from a queue they don't believe.

## P0 — Trust-breaking (fix before or with the apply flow)

1. The empty-queue contradiction. The header says `JOBS STORED 357/500`. The Sources table says `Imported 1745` (enabled total) plus `94` disabled. The queue says `All (0) · New (0) · Unread (0) · Best match (0)` and "No jobs match the current filters." Three different answers to "how many jobs do I have," and the zero-state explains nothing: not which filter zeroed the queue, not that 357 jobs exist behind it, not what to do next. This is the exact complaint the stakeholder raised ("don't trust the import numbers vs matching jobs in each portal") rendered in UI. Fix: one reconciled metric vocabulary (stored vs in-queue vs shown), an empty state that names the gating cause ("357 stored; 0 match your hard filter 'ai' + Past 3 days"), and an escape hatch ("Show all stored jobs").

2. Source funnel rows don't reconcile arithmetically on screen. LinkedIn: Found 1356, Filtered 748, Dupes 7, Imported 680 — but 1356 − 748 − 7 = 601 ≠ 680. Whatever the true semantics (lifetime vs latest-run mixing again, or Filtered ≠ subtracted-from-Found), the row invites the reader to do arithmetic that fails. This is Milestone 5's scope; the audit confirms it must also define column semantics visibly (shared funnel: raw → filtered → deduped → imported, one run context), not just add an expected count.

3. Scores are illegible. `AVG SCORE 17 / 23 / 33 / 40 / 49` with no scale, no color, no bucket language. Read cold, these look like failing grades on everything. Either render bucket labels (High signal / Review / Low) or show `n/100` with consistent color semantics tied to the existing bucket vocabulary. (Also flagged in backlog as the scoring-model MVP analysis — the UI can fix legibility independent of the model verdict.)

## P1 — Information architecture and hierarchy

4. Top-level tabs mix unrelated modes. `Search | Ready (5) | Disabled (1)` puts a workflow (composing a search) beside source-management states, and switching tabs only swaps the top card — the queue widgets render below all three. Ready/Disabled are properties of Sources, not top-level destinations. Proposed IA: two areas — Jobs (composer + queue + detail) and Sources (ready/disabled grouped inside, per the onboarding learnings' two-group pattern).

5. The widget rail (Total jobs / Keywords / Titles / Salary / Avg score) consumes roughly two screens of vertical space to display zeros — giant tiles per keyword, a dedicated empty-state card inside the Salary card (double-shell), "No title data" in an otherwise blank card. The repo's own learnings ban exactly this (compact rails, no redundant chrome, popovers for secondary diagnostics). Collapse to one compact stat strip; hide or de-emphasize when empty.

6. Monetization stats occupy the most prominent screen position. `SEARCHES USED 3/10` and `JOBS STORED 357/500` are the first things the eye lands on, before any product value, while the queue below reads zero. Caps belong in a quiet corner until the user approaches them.

7. Results + Job detail — the actual product — start below the fold entirely, under composer, widgets, and (on other tabs) the sources table. The ranked queue is the promise; it should lead.

8. Copy and layout inconsistencies: two different empty-state strings for the same condition ("No jobs match the current filters." vs "No jobs are available for the current filter."); the "Results 0-0 / 0 · Sort by" label wraps mid-phrase; disabled source rows show full-weight funnel metrics and "n/a" score instead of the muted treatment the learnings specify.

## Proposed scope and sequencing (stakeholder to confirm)

UX-0 "Trust + legibility" pass (small, high-value, before apply UI): items 1–3 and the copy fixes in 8. Merges naturally with Milestone 5 (import-count trust) into a single funnel-semantics + queue-explanation change. No IA restructure yet.

Prototype gate (replaces the markdown-only M3a gate): a clickable HTML prototype of the proposed Jobs workspace — restructured IA per item 4–7 — with the Prepare-application flow embedded end-to-end (entry → consent → drafting → review/gaps → filled → confirmed), using realistic data. Stakeholder clicks through and approves/redlines before any M3 implementation.

M3 implementation then covers: the approved IA restructure of the Jobs area + the apply flow + the answers editor, built once against the approved prototype rather than twice.

Open questions for the stakeholder: (a) confirm P0 ordering — trust pass before apply UI; (b) is the IA restructure (items 4–7) in scope for M3, or does the apply flow ship inside the current layout with restructure deferred; (c) any issues the audit missed that bother you daily — the list above is from one session of inspection, and your lived usage outranks it.
