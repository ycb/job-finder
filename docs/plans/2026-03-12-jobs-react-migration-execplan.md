# Jobs React Migration (Tailwind + shadcn) — Parallel Execution Plan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current.

This plan follows [PLANS.md](../../PLANS.md).

## Purpose / Big Picture

`Searches` is now on React, but `Jobs` is still a placeholder in [App.jsx](../../src/review/web/src/App.jsx#L838). The goal is to migrate the Jobs experience to React/Tailwind/shadcn using existing backend contracts, then remove remaining legacy dependency for Jobs behavior.

## Progress

- [x] (2026-03-12) Baseline audit complete: backend contracts for Jobs already exist (`/api/dashboard`, `/api/search-criteria`, `/api/sources/run-all`, `/api/jobs/:id/status`).
- [x] (2026-03-12) J2 presentational Jobs UI landed in React: mocked/fallback Jobs shell renders queue, detail, controls rail, and criteria form from props in `src/review/web/src/features/jobs/`, with minimal state wiring in `src/review/web/src/App.jsx`.
- [x] (2026-03-12) Created parallel lane branches/worktrees (`J1`–`J4`) and merged J1/J2/J3 into `main`.
- [x] (2026-03-12) Implemented Jobs logic module + targeted tests for view selection, source filters, sort, pagination, selected-job reconciliation, and optimistic viewed semantics.
- [x] (2026-03-12) Implemented Jobs UI components + state wiring in React.
- [x] (2026-03-12) Implement Jobs action wiring + status transitions + reject-reason dialog in React (`App.jsx`, `features/jobs/api.js`, `components/ui/dialog.jsx`, `test/review-jobs-api.test.js`).
- [x] (2026-03-12) J4 verification complete: legacy + react Playwright smoke passed with artifacts (`2026-03-12-jobs-react-*-jobs.{png,json,log}`), plus full suite green (`npm test`).
- [x] (2026-03-18) Approved Jobs IA/layout pass: add top-right monetization/value metrics, rebuild advanced constraints as a 3-column region, redesign widgets/filter-toolbar/results/detail layout, and keep all post-search narrowing state in one shared active-chip system.
- [x] (2026-03-18) Add monthly search usage + jobs-stored cap data to the dashboard payload for the new top-right metrics.
- [x] (2026-03-18) Replace Jobs table rows with the approved two-row summary card/list and update the detail pane header/action layout.
- [x] (2026-03-18) Added monthly search usage persistence in onboarding settings, exposed monetization counters in `/api/dashboard`, and verified contract coverage in `test/onboarding-state.test.js`, `test/entitlements.test.js`, and `test/dashboard-api-contract.test.js`.
- [x] (2026-03-18) Rebuilt the Jobs React IA/layout: header metrics, 3-column advanced constraints with in-card collapse controls, 4-column widgets strip, distinct Filters/Sort toolbar, unified active-chip rail, card-style results rows, and denser detail header/actions.
- [x] (2026-03-18) Verified the Jobs IA/layout pass with `npm run dashboard:web:build`, targeted tests, `npm test`, and dual-mode Playwright smoke artifacts (`2026-03-18-jobs-ia-pass-{legacy,react}-jobs.*`).
- [x] (2026-03-18) Approved Jobs refinement pass: converted advanced-search modules to shadcn accordion, attached Job sources tabs to the search box, replaced the salary matrix with paired salary/score histogram filters, removed the standalone Filters button and Max salary field, and moved Sort into the Results header.
- [x] (2026-03-18) Verified the histogram/accordion refinement with targeted Jobs logic tests, `npm run dashboard:web:build`, `npm test`, and dual-mode Playwright smoke artifacts (`2026-03-18-jobs-histogram-refine-{legacy,react}-jobs.*`).
- [x] (2026-03-19) Approved Jobs refinement follow-up landed: replaced modal-based source management with inline `Search / Ready / Disabled` tabs, simplified post-search numeric filtering to salary-only, removed redundant histogram outputs, and normalized accordion triggers to the standard shadcn affordance.

## Surprises & Discoveries

- Legacy Jobs behavior is rich and spans filtering, sort, pagination, viewed tracking, status transitions, and detail rendering inside the legacy `renderDashboardPage` script.
- No new backend endpoint is required for MVP parity; migration risk is frontend behavior parity and state coordination.
- The React worktree had no existing `src/review/web/src/features/jobs/` surface, so J2 added a mock-backed presentational model to keep the tab renderable before J1/J3 land.
- Fresh worktrees may not have `node_modules` bootstrapped; `npm install` was required before the React build and CLI smoke tests could execute.
- J4 React smoke initially failed because row-click in React does not mark viewed (only `Open Job/Open Search` does) and reject confirm label is `Reject job`; harness selectors were updated to match shipped UX semantics.
- The original Jobs React pass concentrated too much derived UI state inside `App.jsx`, which made QA-driven layout changes brittle and hard to reason about. This pass should move widget/filter composition into tested helper functions instead of adding more inline state coupling.
- Top-right monetization metrics are not just presentation. `searches used this month` and `jobs stored` require real runtime data, and the existing payload only exposed daily view limits.

## Decision Log

- Decision: Migrate Jobs on current `/api/dashboard` payload first; avoid backend schema churn.
  - Rationale: Reduces scope and supports faster parallelization.
  - Date: 2026-03-12
- Decision: Keep user-facing status/action feedback in toasts only.
  - Rationale: Aligns with current React Searches UX and avoids mixed feedback systems.
  - Date: 2026-03-12
- Decision: Reject reason collection uses shadcn `Dialog` (not `window.prompt`).
  - Rationale: Better UX and deterministic testability.
  - Date: 2026-03-12
- Decision: The Jobs page should use two top-right monetization/value counters in MVP: `Searches used this month` and `Jobs stored`.
  - Rationale: These are the clearest value/paywall hooks and match the approved monetization framing better than daily view counts.
  - Date: 2026-03-18
- Decision: The advanced constraints region uses a 3-column layout where `Hard filter` spans columns 1-2 and `Additional keywords` occupies column 3, with collapse/expand controls inside each module header.
  - Rationale: Keeps the power-search composer compact while preserving the distinction between import gates and scoring-only terms.
  - Date: 2026-03-18
- Decision: Widgets remain a 4-column strip with salary breakdown rendered as a clickable 2x2 matrix.
  - Rationale: The matrix is the clearest MVP representation of salary buckets and is simpler than a histogram.
  - Date: 2026-03-18
- Decision: Post-search narrowing must resolve into one shared active-chip rail, with `Filters` and `Sort` presented as distinct controls.
  - Rationale: Avoids one-off widget filter behavior and keeps state legible.
  - Date: 2026-03-18
- Decision: Results rows become a two-row summary plus a three-stat strip, and the detail pane removes `Job X of Y` while moving `Source` into chips.
  - Rationale: The prior table was too cramped and the standalone source section wasted high-value detail space.
  - Date: 2026-03-18
- Decision: Jobs React smoke should treat direct Jobs workspace render as valid and should key off the current primary action (`Run search` / `View Job`) rather than legacy tabs and CTA labels.
  - Rationale: The IA pass intentionally removed the old page-tab shell; verification must follow shipped UX, not obsolete structure.
  - Date: 2026-03-18
- Decision: Post-search distribution filtering will use a histogram interaction model, but salary is the only MVP numeric histogram.
  - Rationale: Salary is the one high-value numeric filter users are likely to slice directly; score is better served by `Best match` and sort order.
  - Date: 2026-03-19
- Decision: `Job sources` should use an attached-tab treatment above the search composer, and advanced-search modules should use the shadcn accordion pattern.
  - Rationale: These controls are secondary to the primary search/detail CTAs and should feel structurally attached, not like competing buttons.
  - Date: 2026-03-18
- Decision: The salary matrix is replaced by a salary histogram range filter, while source/posted move into a quieter accordion below the widgets.
  - Rationale: Histogram filtering is valuable for salary, but score histograms do not justify the visual weight in MVP.
  - Date: 2026-03-19
- Decision: The first Jobs surface will use inline `Search / Ready / Disabled` tabs, and the searches modal is removed from the Jobs flow.
  - Rationale: Search intent and source readiness are one setup-and-run workflow; modal separation obscures that relationship.
  - Date: 2026-03-19
- Decision: Score histogram is removed from MVP UI and moved to Icebox potential, while salary remains the one numeric distribution filter.
  - Rationale: Score is already well served by sorting and the `Best match` tab; salary is the unique high-value numeric filter.
  - Date: 2026-03-19
- Decision: Salary filtering keeps only histogram + slider + min/max controls, with salary completeness surfaced locally through `With salary / Missing salary`.
  - Rationale: The previous control over-explained itself and diluted the actual filtering interaction.
  - Date: 2026-03-19
- Decision: `Ready / Disabled` source management moves inline into the Jobs page via a connected tab treatment above the search composer, and the welcome CTA routes to the `Disabled` tab instead of reopening a modal.
  - Rationale: Search and source readiness are one workflow; a modal split obscured the relationship and created unnecessary navigation overhead.
  - Date: 2026-03-19
- Decision: Sort is a quiet inline control in the Results header, and post-search filters use an accordion below widgets rather than a standalone `Filters` CTA.
  - Rationale: `Run search` and `View Job` should remain the only strong CTAs; filter and sort controls need lower visual weight.
  - Date: 2026-03-19

## Scope

### In Scope (MVP)

1. React Jobs tab replacing placeholder.
2. Parity behaviors:
   - jobs view filter (`all/new/best_match/applied/skipped/rejected`)
   - source filter chips
   - sort (`score/date`)
   - queue pagination
   - selected job detail pane
   - status actions (`viewed`, `applied`, `skip_for_now`, `rejected` with reason)
   - open job link flow.
3. Keep existing backend API surface.
4. Add behavior tests + Playwright smoke.
5. Approved IA/layout refresh:
   - top-right monetization/value counters
   - advanced-constraints 3-column layout
  - 4-column widgets strip with keyword stack + salary-focused numeric filtering
  - separate `Filters` and `Sort` controls with one active-chip rail
  - redesigned results rows and detail pane actions/header

### Out of Scope

- Profile React migration.
- Backend data-model redesign.
- New ranking features.
- LLM-driven `Why it fits`.
- Employment-type normalization cleanup.

## Parallel Lanes

## J1 — Jobs Logic Extraction (Pure Functions + Tests)

- Branch: `codex/jobs-react-j1-logic`
- Owns:
  - `src/review/web/src/features/jobs/logic.js` (new)
  - `test/review-jobs-react-logic.test.js` (new)
- Deliverables:
  - pure helpers for:
    - queue group selection by view
    - source filter aggregation and filtering
    - sort comparator (`score/date`)
    - pagination helpers
    - selected job reconciliation on filter/view change
    - optimistic viewed-mark semantics
- Must not edit API/server routes.
- Acceptance:
  - targeted tests pass.

## J2 — Jobs UI Components (Presentational)

- Branch: `codex/jobs-react-j2-ui`
- Owns:
  - `src/review/web/src/features/jobs/` components (new files)
  - minimal integration in `src/review/web/src/App.jsx`
- Deliverables:
  - queue list panel
  - job detail panel
  - jobs controls rail (view filter, source chips, sort, pagination)
  - criteria form + Find Jobs CTA visual shell
- Must consume props; no side-effect fetch logic in leaf components.
- Acceptance:
  - UI renders from mocked props.

## J3 — API Wiring + Interactions

- Branch: `codex/jobs-react-j3-wiring`
- Owns:
  - `src/review/web/src/App.jsx`
  - optional `src/review/web/src/features/jobs/api.js` (new)
- Deliverables:
  - wire calls to:
    - `POST /api/search-criteria`
    - `POST /api/sources/run-all`
    - `POST /api/jobs/:id/status`
    - dashboard refresh via `GET /api/dashboard`
  - replace reject `prompt` parity with shadcn `Dialog`
  - route user feedback through toasts
- Acceptance:
  - action flows complete without runtime errors.

## J4 — Verification Harness + QA Evidence

- Branch: `codex/jobs-react-j4-verification`
- Owns:
  - `scripts/playwright-jobs-flow-smoke.js` (new)
  - `test/dashboard-api-contract.test.js` updates if needed
  - evidence artifacts in `docs/roadmap/progress-merge/`
- Deliverables:
  - Playwright smoke for:
    - Jobs tab render
    - filter/view changes
    - mark viewed/applied/skip
    - reject with reason
  - screenshot + JSON/log artifacts
- Acceptance:
  - deterministic smoke pass with artifacts.

## Dependencies and Merge Order

1. J1 merges first (logic contracts).
2. J2 and J3 can run in parallel after J1 baseline is known (or concurrently with a sync checkpoint).
3. J4 rebases on merged J2/J3 and validates final behavior.
4. Merge order to `main`: `J1 -> J2 -> J3 -> J4`.

## Worker Startup Commands

Run from `/Users/admin/job-finder`:

```bash
git fetch origin

git worktree add /Users/admin/.codex/worktrees/jobs-j1 -b codex/jobs-react-j1-logic origin/main
git worktree add /Users/admin/.codex/worktrees/jobs-j2 -b codex/jobs-react-j2-ui origin/main
git worktree add /Users/admin/.codex/worktrees/jobs-j3 -b codex/jobs-react-j3-wiring origin/main
git worktree add /Users/admin/.codex/worktrees/jobs-j4 -b codex/jobs-react-j4-verification origin/main
```

Per worker bootstrap:

```bash
cd /Users/admin/.codex/worktrees/jobs-jX
npm ci
```

## Acceptance Criteria (Release Gate)

1. Jobs tab no longer shows placeholder copy.
2. Find Jobs flow updates criteria and triggers run-all successfully.
3. Queue/detail interaction parity:
   - selection
   - viewed marking
   - status transitions
   - reject reason required.
4. Source filter + view filter + sort + pagination function correctly.
5. `npm test` green.
6. Playwright Jobs smoke passes with saved artifacts.

## Verification Checklist

Required commands before merge:

```bash
node --test test/entitlements.test.js
node --test test/review-jobs-react-logic.test.js
node --test test/review-jobs-react-ui-model.test.js
node --test test/dashboard-api-contract.test.js
npm run dashboard:web:build
npm test
node scripts/playwright-jobs-flow-smoke.js --artifact-prefix 2026-03-12-jobs-react --output-dir docs/roadmap/progress-merge --port 4513
```

## Outcomes & Retrospective

- J2 shipped a presentational Jobs shell with prop-driven criteria, controls, queue, and detail components.
- J2 verification run in this worktree:
  - `node --test test/review-jobs-react-ui-model.test.js`
  - `npm run dashboard:web:build`
- 2026-03-12 J3 verification:
  - `node --test test/review-jobs-api.test.js`
  - `npm run dashboard:web:build`
  - `npm test`
- Result: Jobs tab now saves criteria, runs captures, refreshes the dashboard, marks jobs viewed/applied/skipped/rejected, and collects rejection reasons in a dialog with toast feedback.
- 2026-03-12 J4 verification:
  - `node --test test/playwright-jobs-flow-smoke.test.js`
  - `node --test test/dashboard-api-contract.test.js`
  - `node scripts/playwright-jobs-flow-smoke.js --mode legacy ...`
  - `node scripts/playwright-jobs-flow-smoke.js --mode react ...`
  - `npm test`
- Result: verification harness now passes in both legacy and react modes with evidence files in `docs/roadmap/progress-merge/`.
- 2026-03-18 IA/layout verification:
  - `node --test test/onboarding-state.test.js test/entitlements.test.js test/review-jobs-react-logic.test.js test/dashboard-api-contract.test.js`
  - `npm run dashboard:web:build`
  - `npm test`
  - `node scripts/playwright-jobs-flow-smoke.js --artifact-prefix 2026-03-18-jobs-ia-pass --output-dir docs/roadmap/progress-merge --port 4516`
  - `node scripts/playwright-jobs-flow-smoke.js --mode react --artifact-prefix 2026-03-18-jobs-ia-pass --output-dir docs/roadmap/progress-merge --port 4517`
- Result: Jobs now exposes real monetization/value counters, advanced constraints are separated from the primary search bar, widget-driven filters resolve into one chip rail, results are scannable card rows, and the detail pane uses the approved CTA/action hierarchy.
- 2026-03-19 search/sources/salary refinement verification:
  - `node --test test/review-jobs-react-logic.test.js test/dashboard-api-contract.test.js test/entitlements.test.js test/onboarding-state.test.js`
  - `npm run dashboard:web:build`
  - `node scripts/playwright-jobs-flow-smoke.js --mode react --artifact-prefix 2026-03-19-jobs-search-sources-salary --output-dir docs/roadmap/progress-merge --port 4518`
- Result: Jobs now uses inline `Search / Ready / Disabled` tabs, standard accordion affordances, salary-only numeric filtering, and an inline source-management panel instead of the old modal split.
