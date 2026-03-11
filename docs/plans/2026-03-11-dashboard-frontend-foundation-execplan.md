# Dashboard Frontend Foundation Migration (React + Tailwind + shadcn)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](../../PLANS.md).

## Purpose / Big Picture

We are repeatedly shipping UI regressions because the dashboard is currently built as one large server-rendered HTML string in `src/review/server.js` with manual DOM listeners and CSS inlined in a template literal. The user-visible result is inconsistent active states, brittle toast behavior, and hard-to-verify changes.

After this plan, the dashboard UI will run on React components styled with Tailwind and shadcn primitives, while preserving existing backend APIs and CLI behavior. The first milestone target is the `Searches` tab (including onboarding affordances), because that is where current regressions cluster. Full Phase 1/1.1 onboarding QA should happen against this new frontend foundation, not the legacy string-template UI.

## Progress

- [x] (2026-03-11) Authored ExecPlan with migration scope, sequencing, and parallel lanes.
- [x] (2026-03-11) F1-A completed scaffold/static serving in `src/review/server.js` with `JOB_FINDER_DASHBOARD_UI=react` fallback switching.
- [x] (2026-03-11) F1-B completed shared design tokens and shadcn primitives for tabs/cards/table/toast/button/select.
- [x] (2026-03-11 21:28Z) Started lane `F2-D Searches Slice` in worktree `/Users/admin/.codex/worktrees/309b/job-finder` on branch `codex/worktrees/frontend-f2-d-searches`; verified F1-A/F1-B/F1-C baseline merge commit (`678ab70`) before implementation.
- [x] (2026-03-11 22:07Z) Ported `Searches` shell/state tabs/search-frequency/source rows-actions/first-visit welcome toast to React (`src/review/web/src/App.jsx`) with behavior helpers tested in `test/review-searches-react-logic.test.js`.
- [ ] Port onboarding source readiness/auth UX used from `Searches` into React.
- [x] (2026-03-11 22:07Z) Added and ran React Searches Playwright smoke (`scripts/playwright-searches-flow-smoke.js`) with screenshot+log artifacts under `docs/roadmap/progress-merge/`.
- [ ] Run full QA checklist for Phase 1/1.1 + onboarding on React UI and update backlog/roadmap status.

## Surprises & Discoveries

- Observation: UI regressions are passing tests because many tests assert string snippets inside generated HTML instead of exercising rendered behavior.
  Evidence: Recent regressions around active tab color and toast visibility passed Node tests but failed manual QA screenshots.
- Observation: One-time toast behavior is sensitive to localStorage key history and gating predicates.
  Evidence: Toast did not appear in QA when gate depended on auth-source conditions or stale localStorage state.
- Observation: Local port `4432` returned `listen EPERM` in this environment while `4511` was available.
  Evidence: Searches smoke failed on `4432` with timeout + `listen EPERM`; rerun on `4511` succeeded and produced artifacts.

## Decision Log

- Decision: Migrate dashboard to React + Tailwind + shadcn before full manual QA closeout of Phase 1/1.1 and onboarding.
  Rationale: Current UI architecture is the top regression source; QA on unstable UI produces churn and rework.
  Date/Author: 2026-03-11 / Codex + stakeholder.
- Decision: Preserve backend API/server routes and migrate frontend incrementally behind a UI flag.
  Rationale: Reduces risk by avoiding simultaneous backend contract changes.
  Date/Author: 2026-03-11 / Codex.
- Decision: Prioritize `Searches` + onboarding UX first, then jobs/profile parity.
  Rationale: `Searches` and onboarding are current blocker surfaces for trust and activation.
  Date/Author: 2026-03-11 / Codex.
- Decision: Keep `F2-D` limited to `Searches` shell/state/actions/toast parity and defer onboarding modal flow parity to lane `F2-E`.
  Rationale: Task packets split these behaviors into independent lanes and allow smaller reviewable diffs while keeping API contracts stable.
  Date/Author: 2026-03-11 / Codex.

## Outcomes & Retrospective

- (2026-03-11, lane `F2-D`) Delivered React Searches parity slice with active-tab semantics, frequency control gating to Enabled tab, source row actions (`Enable`/`Run now`/`Check access`/overflow `Disable`), and first-visit welcome toast (dismiss + `Go to Disabled`). Added pure-logic tests and a dedicated Playwright Searches flow smoke. Remaining scope for this milestone is onboarding auth modal flow parity, explicitly deferred to lane `F2-E`.

## Context and Orientation

Today the dashboard UI is emitted from `renderDashboardPage` in `src/review/server.js`. This function contains:

- inlined CSS,
- inlined HTML,
- inlined JS state/event handlers,
- all tab/toast/onboarding/search table rendering paths.

This coupling creates high change risk: small visual edits can alter control flow, and test coverage is mostly static-string validation (`test/review-narrata-flag.test.js`, `test/review-refresh-ui-copy.test.js`) rather than component behavior.

Backend/API responsibilities already exist in `src/review/server.js` and should remain stable for this migration:

- dashboard JSON payload (`/api/dashboard`),
- onboarding/readiness endpoints,
- source actions and sync triggers,
- policy endpoints.

The migration introduces a dedicated frontend app that consumes existing endpoints and is served by the existing review server.

## Scope

### In Scope (MVP for this migration)

1. Add frontend app stack:
   - React
   - Tailwind CSS
   - shadcn/ui component primitives
2. Serve compiled frontend assets from review server behind a feature flag:
   - `JOB_FINDER_DASHBOARD_UI=react` (new UI)
   - fallback to current legacy renderer until parity gate passes
3. Port to React first:
   - main nav shell
   - `Searches` tab
   - search-state tabs (Enabled/Disabled)
   - welcome toast (first visit only)
   - onboarding source readiness/auth controls currently surfaced in Searches
4. Add behavior-first tests:
   - API contract tests for required payload shape
   - Playwright smoke for Searches/onboarding critical path

### Out of Scope (for this phase)

- Jobs detail redesign beyond parity.
- Profile tab redesign beyond parity.
- New product features unrelated to parity/stability.
- API schema expansion unless parity requires missing fields.

## Plan of Work

### Milestone 0: Freeze + Branching Strategy (Controller)

Create a controller branch and freeze non-critical dashboard UI edits on legacy renderer. Only bug fixes that unblock migration are allowed. Set the delivery rule: no full Phase 1/1.1 onboarding QA signoff until Milestone 3 acceptance criteria pass.

### Milestone 1: Foundation Scaffold (Parallel Lanes A/B/C)

Lane A (Infra):
- Create frontend app directory (for example `src/review/web/` or `dashboard/`) with Vite + React.
- Configure build output path and server static-asset serving in `src/review/server.js`.
- Add UI mode feature flag and fallback switch.

Lane B (Design System):
- Install Tailwind and shadcn baseline.
- Define shared tokens mapped to existing brand palette.
- Build base primitives used by Searches: `Tabs`, `Card`, `Table`, `Button`, `Select`, `Toast`.

Lane C (Contracts/Test Harness):
- Snapshot existing `/api/dashboard` shape used by Searches.
- Add API contract tests for required fields to prevent backend drift during UI migration.
- Add Playwright harness that can run against both legacy and React mode.

Merge gate:
- React shell renders with no runtime errors.
- Legacy mode remains functional.

### Milestone 2: Searches Slice Port (Parallel Lanes D/E)

Lane D (UI Behavior):
- Port `Searches` section rendering from template string to React components.
- Port enabled/disabled tabs and active-state semantics.
- Port run cadence selector and source rows/actions.

Lane E (Welcome + Onboarding interactions):
- Port welcome toast behavior with first-visit logic and persisted dismissal.
- Port onboarding source readiness/auth actions currently shown from Searches flow.
- Ensure consent/onboarding state from APIs is reflected identically.

Merge gate:
- Search-state tab behavior, toast behavior, and onboarding interactions pass Playwright smoke.
- Existing Node API tests remain green.

### Milestone 3: QA Gate Before Full Phase QA

Run manual QA checklist on React mode:

1. `jf init` new user flow.
2. `jf review` Searches tab default state.
3. Welcome toast appears once and can close/go to disabled.
4. Enabled/Disabled tabs active state and counts are correct.
5. Auth-required source flow (open source, verify login, status transitions).
6. Find Jobs/run cadence interactions.
7. No regressions in Jobs/Profile basic navigation.

If Milestone 3 fails, fix in React mode before resuming broader Phase 1/1.1 QA.

### Milestone 4: Expand Parity and Retire Legacy Renderer

After stable Searches/onboarding QA:
- Port remaining Jobs/Profile rendering to React.
- Keep API routes intact.
- Remove legacy HTML template renderer only after parity and smoke coverage are accepted.

## Parallelization and Dependencies

Work can be parallelized after initial scaffold contract decisions:

- A depends on none.
- B depends on A for build/runtime plumbing.
- C depends on A for runnable UI modes and endpoint references.
- D depends on A+B.
- E depends on A+B and uses C harness for validation.
- Milestone 3 depends on D+E completion.

Suggested worktree lanes:

- `lane-ui-foundation` (A)
- `lane-ui-design-system` (B)
- `lane-ui-contracts-playwright` (C)
- `lane-ui-searches` (D)
- `lane-ui-onboarding-interactions` (E)

Controller branch merges lanes in order: A -> B/C -> D/E -> QA gate.

## Concrete Steps

All commands run from `/Users/admin/job-finder`.

1. Create controller and lane worktrees.
2. Scaffold frontend app and build scripts.
3. Add server static hosting + UI mode switch.
4. Implement component primitives and Searches/onboarding port.
5. Run verification commands:
   - `npm test`
   - `node --test test/review-narrata-flag.test.js`
   - `node --test test/review-refresh-ui-copy.test.js`
   - Playwright smoke command(s) for Searches and onboarding flow.
6. Capture artifacts under `docs/roadmap/progress-merge/`.

## Validation and Acceptance

Acceptance criteria for this migration phase:

1. React dashboard mode renders and is selectable via env flag.
2. Searches + onboarding critical paths pass manual QA and Playwright smoke.
3. Active/inactive tab states are visually consistent with design conventions.
4. Welcome toast first-visit behavior is deterministic and test-covered.
5. No regression in backend APIs or CLI commands.

Observable success:

- Running `JOB_FINDER_DASHBOARD_UI=react node src/cli.js review` serves React dashboard.
- Searches/onboarding actions behave correctly without template-string regressions.

## Idempotence and Recovery

- Keep legacy renderer as fallback until parity gate passes.
- If a lane fails or diverges, reset only that lane worktree and re-run from controller branch.
- API contract tests protect against accidental backend payload drift during UI migration.

## Interfaces and Dependencies

Add/adjust dependencies:

- React runtime for browser app (already used for Ink in CLI; browser bundling is new).
- Vite for frontend build/dev flow.
- Tailwind CSS.
- shadcn/ui-compatible component set (Radix primitives + utility wrappers).

Interface boundaries:

- Frontend reads existing `/api/*` endpoints only.
- Frontend does not introduce write-surface beyond current endpoint set.
- Server remains source of truth for data, auth readiness checks, and actions.

## Artifacts and Notes

On each milestone merge, add:

- command transcript summary,
- Playwright screenshots/snapshots,
- explicit pass/fail checklist for acceptance criteria.

Plan revision note (2026-03-11): Initial creation to prioritize frontend foundation migration before full Phase 1/1.1 onboarding QA, with explicit parallel lanes and gating.
