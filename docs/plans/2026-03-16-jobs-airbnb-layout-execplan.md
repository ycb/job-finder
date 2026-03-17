# Jobs Split-Pane Redesign (Airbnb-Inspired) — ExecPlan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current.

This plan follows [PLANS.md](../../PLANS.md).

## Purpose / Big Picture

Users need faster job triage with less context switching. After this change, the Jobs page will present a compact top filter bar, clear hard-filter versus scoring-keyword controls, filter-sensitive summary widgets, and a split-pane review workflow (list on left, detail on right) that supports high-volume decisioning. The design removes ambiguous labels (for example, user-facing freshness) and keeps action controls obvious.

## Progress

- [x] (2026-03-16 18:00Z) Scope alignment confirmed from stakeholder sketches: top widgets, horizontal filters, split-pane queue/detail, and post-MVP `Why it fits`.
- [x] (2026-03-16 18:00Z) Product decisions locked: widgets reflect current filtered set; rejected items capture notes; `freshness` remains internal.
- [x] (2026-03-16 23:20Z) Implemented new Jobs information architecture in React layout.
- [x] (2026-03-16 23:20Z) Implemented filter-sensitive widget rail (`Total jobs`, `Avg score`, `KW#1/#2/#3`, title breakdown, salary breakdown).
- [x] (2026-03-16 23:20Z) Implemented horizontal filter bar and advanced filters interaction model.
- [x] (2026-03-16 23:20Z) Updated list/detail behavior and rejected-notes rendering.
- [x] (2026-03-16 23:20Z) Removed user-facing freshness from visible Jobs labels.
- [ ] Run Playwright smoke + manual QA against the new Jobs layout in the stakeholder QA runtime checkout.
- [x] (2026-03-16 23:27Z) Full automated verification passed (`npm run dashboard:web:build`, `npm test`).

## Surprises & Discoveries

- Observation: Stakeholder QA environment uses a separate runtime checkout from the implementation worktree, so stale UI appears unless branch sync is automated.
  Evidence: prior repeated Cmd-R mismatches resolved only after branch pull.
- Observation: The current React Jobs page still carries transitional controls and copy from earlier migration phases, so layout simplification is both a UX and code clean-up task.
  Evidence: current `src/review/web/src/App.jsx` includes legacy queue chips/filters and transitional labels not present in the new sketch.

## Decision Log

- Decision: Use a new feature branch `codex/jobs-splitpane-airbnb-v1` for this redesign track.
  Rationale: Keeps scope isolated from prior `power-search-v2` hardening work and supports QA gate before merge.
  Date/Author: 2026-03-16 / Codex

- Decision: Widget counts and breakdowns are computed from the currently filtered result set (not total imported corpus).
  Rationale: Matches sketch intent and user mental model after filter tabs/controls are applied.
  Date/Author: 2026-03-16 / Stakeholder + Codex

- Decision: `Why it fits` is deferred to post-MVP LLM phase.
  Rationale: Avoids introducing AI coupling into this layout-focused MVP iteration.
  Date/Author: 2026-03-16 / Stakeholder

- Decision: `freshness` is internal-only and removed from user-facing Jobs UI for now.
  Rationale: It is a system metric and confuses users when shown alongside `date posted`.
  Date/Author: 2026-03-16 / Stakeholder + Codex

## Outcomes & Retrospective

- Delivered: Jobs page now follows the approved split-pane architecture with compact top search controls, explicit `Hard filter` vs `Additional keywords`, filter-sensitive widgets, and a denser review/detail workflow.
- Delivered: Rejected notes are surfaced directly in the detail pane when status is `rejected`.
- Delivered: User-facing freshness wording was removed from the Jobs surface; user-visible time reference is now `Date posted`.
- Verification evidence:
  - `npm run dashboard:web:build` ✅
  - `npm test` ✅ (`280` passing, `0` failing)
- Remaining gate before merge: manual QA + Playwright smoke in the stakeholder checkout flow (`qa/current`) because the existing smoke script still assumes pre-redesign page anchors.

## Context and Orientation

The Jobs React experience currently lives in [src/review/web/src/App.jsx](../../src/review/web/src/App.jsx). Data hydration comes from `/api/dashboard` and already includes queue records, status, score, salary text, source attribution, and application status. Search criteria save/run flows already use:

- `POST /api/search-criteria`
- `POST /api/sources/run-all`
- `POST /api/jobs/:id/status`
- `GET /api/dashboard`

Current Jobs logic helpers are in `src/review/web/src/features/jobs/` and corresponding tests in `test/review-jobs-*.test.js`.

The redesign is a UI/interaction re-architecture on top of existing APIs, not a backend rewrite.

## Plan of Work

### Milestone 1: Layout skeleton and interaction zones

Restructure Jobs into three vertical zones:

1. Top rail: `Job Finder` title row with source status button on the right.
2. Search + control rail: compact horizontal search controls and the two filter cards (`Hard filter`, `Additional keywords`) with `All/Any` radios.
3. Main review area: split-pane with left list/table and right detail panel.

This milestone should not change server contracts. It should preserve existing state behavior but remap where controls are displayed.

### Milestone 2: Widget rail and filter-sensitive aggregations

Add a widget strip directly above the split pane with:

- `Total jobs`
- `Avg score`
- `KW#1`, `KW#2`, `KW#3` (top keyword counts from filtered list)
- title breakdown card/list
- salary breakdown card/list

All widget values must recompute from the currently filtered subset (view tabs + search filters + source/date/employment/salary filters).

### Milestone 3: Horizontal filter bar and advanced filter model

Add a compact horizontal filter bar inspired by Airbnb:

- quick controls in-line for core criteria (`job title`, `location`, `minimum salary`, `date posted`)
- advanced filter affordance for source/date/employment/salary range/sort
- clear “applied filters” state and counts

`Date posted` remains user-facing; `freshness` is removed from user-visible labels.

### Milestone 4: Detail pane and status action completion

Refine right detail pane to include:

- job header and navigation (`job X of Y`, next/prev)
- primary action buttons (`Reject`, `Skip`, `I Applied`, and open job link)
- rejected notes visibility when status is `rejected`
- source attribution card/list
- optional fields card/list based on available structured data

`Why it fits` remains a placeholder/off section for now and must not present LLM-generated content yet.

### Milestone 5: Verification, QA, and merge readiness

Run targeted tests, full tests, and smoke. Capture manual QA evidence (desktop and mobile widths). Confirm no regressions in:

- source modal open/close and auth workflows
- search criteria persistence/run
- job status transitions and reject reason persistence

## Concrete Steps

Run from repository root:

    cd /Users/admin/job-finder
    git fetch origin
    git checkout -B codex/jobs-splitpane-airbnb-v1 origin/codex/power-search-v2

Implementation touchpoints:

    src/review/web/src/App.jsx
    src/review/web/src/features/jobs/logic.js
    src/review/web/src/features/jobs/api.js
    test/review-jobs-react-logic.test.js
    test/review-jobs-api.test.js
    test/dashboard-api-contract.test.js
    scripts/playwright-jobs-flow-smoke.js

QA runtime:

    cd /Users/admin/job-finder
    git checkout -B qa/current origin/codex/jobs-splitpane-airbnb-v1
    npm ci
    npm run review:stop
    npm run review:follow

## Validation and Acceptance

Automated validation:

    npm run dashboard:web:build
    node --test test/review-jobs-react-logic.test.js
    node --test test/review-jobs-api.test.js
    node --test test/dashboard-api-contract.test.js
    npm test

Smoke validation:

    node scripts/playwright-jobs-flow-smoke.js --artifact-prefix 2026-03-16-jobs-airbnb --output-dir docs/roadmap/progress-merge --port 4513

Manual acceptance:

- Jobs page renders redesigned split-pane structure matching approved sketch intent.
- Widget rail values update when user changes filters/tabs.
- No user-facing `freshness` label remains.
- Rejected jobs show persisted rejection notes in detail view.
- Filters and sorting still drive queue and detail selection correctly.

## Idempotence and Recovery

All steps are additive and safe to repeat. If layout refactors break JSX structure, recover by restoring only affected file sections:

    git checkout -- src/review/web/src/App.jsx

If QA runtime drifts stale, restart:

    npm run review:stop
    npm run review:follow

If branch diverges, rebase feature branch on latest `origin/codex/power-search-v2` before merge.

## Artifacts and Notes

Design source: stakeholder-provided sketch set (2026-03-16 chat attachment) showing:

- top widgets + filter bar
- split list/detail pane
- filter-sensitive counts
- detail action row and rejected notes

Post-MVP note: `Why it fits` LLM module is intentionally excluded from this plan and should be tracked as a separate epic item.

## Interfaces and Dependencies

No new backend endpoints are required for this phase. Continue using existing Jobs dashboard payload and status APIs. Any new computed widget data should be derived in frontend selectors/helpers first. If backend pre-aggregation becomes needed for performance, that change must be proposed in a follow-on ExecPlan.
