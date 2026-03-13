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

## Surprises & Discoveries

- Legacy Jobs behavior is rich and spans filtering, sort, pagination, viewed tracking, status transitions, and detail rendering inside the legacy `renderDashboardPage` script.
- No new backend endpoint is required for MVP parity; migration risk is frontend behavior parity and state coordination.
- The React worktree had no existing `src/review/web/src/features/jobs/` surface, so J2 added a mock-backed presentational model to keep the tab renderable before J1/J3 land.
- Fresh worktrees may not have `node_modules` bootstrapped; `npm install` was required before the React build and CLI smoke tests could execute.
- J4 React smoke initially failed because row-click in React does not mark viewed (only `Open Job/Open Search` does) and reject confirm label is `Reject job`; harness selectors were updated to match shipped UX semantics.

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

### Out of Scope

- Profile React migration.
- Backend data-model redesign.
- New ranking features.

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
node --test test/review-jobs-react-logic.test.js
node --test test/dashboard-api-contract.test.js
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
