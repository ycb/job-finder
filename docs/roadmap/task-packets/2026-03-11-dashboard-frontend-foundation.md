# Dashboard Frontend Foundation Task Packets (2026-03-11)

Use these as copy/paste handoff prompts. Each packet is launch-ready and self-contained.

Controller context (applies to all lanes):

- Controller branch: `codex/frontend-foundation-controller`
- Controller worktree: `/Users/admin/.codex/worktrees/frontend-foundation-controller`
- Scope doc: `docs/plans/2026-03-11-dashboard-frontend-foundation-execplan.md`
- Dispatch board: `docs/roadmap/frontend-foundation-dispatch-board.md`

---

## Packet F1-A: Infra Scaffold + Review Server Integration

Lane: `F1-A Infra`

Execution environment:

- branch: `codex/frontend-f1-a-infra`
- worktree: `/Users/admin/.codex/worktrees/frontend-f1-a-infra`

In scope:

- Add browser frontend scaffold (Vite + React) for dashboard UI.
- Add build output + static serving path from review server.
- Add feature flag switch to choose React UI vs legacy renderer.

Out of scope:

- Do not port business UI behavior yet (Searches/onboarding logic stays legacy in this lane).
- Do not change backend API contracts.
- Do not edit controller-owned docs.

Expected change surface:

- `package.json`
- `package-lock.json`
- `src/review/server.js`
- New frontend app files under a single chosen path (for example `src/review/web/*`).
- Any minimal build config files needed by Vite.

Acceptance criteria:

1. `JOB_FINDER_DASHBOARD_UI=react node src/cli.js review` serves React shell content.
2. Default/fallback mode still serves legacy dashboard renderer.
3. No API endpoint regressions from review server startup path.

Required verification:

- Targeted: `node --test test/review-narrata-flag.test.js`
- Targeted: `node --test test/review-refresh-ui-copy.test.js`
- Full suite: `npm test`

Artifact requirements:

- Add merge evidence note under `docs/roadmap/progress-merge/` with:
  - command outputs summary
  - env flag used
  - URL/screenshot proving React shell is served

Stop conditions (escalate to controller):

- Build tooling choice conflicts with existing Node packaging assumptions.
- Review server static hosting requires backend route contract changes.

Return payload:

- Summary of changes
- Files changed list
- Commands run + pass/fail
- Commit SHA (or explicit `not committed`)

---

## Packet F1-B: Design System Foundation (Tailwind + shadcn primitives)

Lane: `F1-B Design System`

Execution environment:

- branch: `codex/frontend-f1-b-design-system`
- worktree: `/Users/admin/.codex/worktrees/frontend-f1-b-design-system`

In scope:

- Add Tailwind setup for frontend app.
- Add shadcn-compatible component primitives and shared theme tokens.
- Build primitives needed for Searches migration: Tabs, Card, Table, Button, Select, Toast.

Out of scope:

- No data wiring to `/api/*` yet.
- No onboarding behavior implementation.
- No legacy renderer CSS edits except required compatibility glue.

Expected change surface:

- Frontend app config/styles files.
- Component files for primitives in frontend app path.
- Any minimal theme token files.

Acceptance criteria:

1. React shell builds with Tailwind styles active.
2. Base primitives render and are reusable by later lanes.
3. Active/inactive tab semantics support `active = dark`.

Required verification:

- Targeted frontend/unit tests for primitives (if added).
- Full suite: `npm test`.

Artifact requirements:

- Save screenshot or snapshot proof of primitive render under `docs/roadmap/progress-merge/`.

Stop conditions:

- shadcn setup requires architectural deviation from F1-A scaffold choices.
- Token system conflicts with established brand palette constraints.

Return payload:

- Summary
- Files changed
- Commands + outcomes
- Commit SHA

---

## Packet F1-C: API Contracts + Playwright Harness

Lane: `F1-C Contracts & Harness`

Execution environment:

- branch: `codex/frontend-f1-c-contracts-harness`
- worktree: `/Users/admin/.codex/worktrees/frontend-f1-c-contracts-harness`

In scope:

- Add explicit `/api/dashboard` contract tests for fields consumed by Searches/onboarding UI.
- Add Playwright smoke harness runnable against both legacy and React UI mode.

Out of scope:

- No UI component implementation in this lane.
- No API shape expansion beyond what current backend already serves.

Expected change surface:

- New/updated tests under `test/` for dashboard payload contracts.
- Playwright smoke scripts/tests and minimal wiring.
- Optional docs artifact template for smoke evidence.

Acceptance criteria:

1. Contract tests fail clearly if required Searches/onboarding payload fields drift.
2. Playwright smoke can run in both UI modes and capture artifact output.

Required verification:

- Targeted contract test command(s).
- Playwright smoke command in legacy mode.
- Playwright smoke command in react mode (can target shell in F1).
- Full suite: `npm test`.

Artifact requirements:

- Save smoke outputs/screenshots to `docs/roadmap/progress-merge/`.
- Include exact commands and mode flags used.

Stop conditions:

- Playwright harness cannot be run in environment due unrelated infra constraints.
- Contract test reveals current API missing critical fields required by existing UI.

Return payload:

- Summary
- Files changed
- Commands + outcomes
- Artifact paths
- Commit SHA

---

## Packet F2-D: Searches Slice Port (React)

Dispatch only after F1-A/F1-B/F1-C merge.

Lane: `F2-D Searches Slice`

Execution environment:

- branch: `codex/frontend-f2-d-searches`
- worktree: `/Users/admin/.codex/worktrees/frontend-f2-d-searches`

In scope:

- Port Searches UI slice to React:
  - Searches nav section shell
  - Enabled/Disabled state tabs
  - Search frequency control
  - source rows/actions parity
  - first-visit welcome toast logic

Out of scope:

- Jobs/Profile redesign.
- Backend API contract changes unless controller approves.

Expected change surface:

- React Searches components.
- Frontend state/data wiring for Searches.
- Minimal `src/review/server.js` integration updates for route/entry selection only.
- Related tests.

Acceptance criteria:

1. Searches behavior matches legacy parity and fixes known regressions.
2. Active tab state semantics are consistent (`active = dark`) across nav/sub-tabs.
3. Welcome toast appears once on first Searches visit and supports close + go-to-disabled CTA.

Required verification:

- `node --test test/review-narrata-flag.test.js`
- Any new React component tests.
- Playwright smoke for Searches flow.
- Full suite: `npm test`.

Artifact requirements:

- Save at least one screenshot + one short smoke note under `docs/roadmap/progress-merge/`.

Stop conditions:

- Missing API fields block parity and require backend changes.
- Conflicting behavior expectations between existing tests and stakeholder-approved UX.

Return payload:

- Summary
- Files changed
- Commands + outcomes
- Artifact paths
- Commit SHA

---

## Packet F2-E: Onboarding Interactions in Searches (React)

Dispatch only after F1-A/F1-B/F1-C merge.

Lane: `F2-E Onboarding Interactions`

Execution environment:

- branch: `codex/frontend-f2-e-onboarding`
- worktree: `/Users/admin/.codex/worktrees/frontend-f2-e-onboarding`

In scope:

- Port onboarding source readiness/auth interactions used in Searches:
  - Enabled/Auth Required/Not Enabled group behavior
  - enable/disable actions
  - auth modal/probe flow states
  - status messaging parity

Out of scope:

- Re-architect onboarding business logic in backend.
- New onboarding features not in parity scope.

Expected change surface:

- React onboarding components used from Searches page.
- API call wiring for existing onboarding endpoints.
- Related tests and smoke updates.

Acceptance criteria:

1. Auth-required sources can be enabled and verified in React UI.
2. Status transitions and messages match current approved UX.
3. No regression in onboarding legal/consent gate behavior.

Required verification:

- `node --test test/onboarding-state.test.js`
- `node --test test/onboarding-source-selection.test.js`
- `node --test test/source-access.test.js`
- Playwright onboarding/auth smoke.
- Full suite: `npm test`.

Artifact requirements:

- Save auth-flow smoke evidence under `docs/roadmap/progress-merge/`.

Stop conditions:

- Endpoint behavior mismatch prevents parity without backend contract change.
- Consent/legal gate behavior differs from expected policy flow.

Return payload:

- Summary
- Files changed
- Commands + outcomes
- Artifact paths
- Commit SHA
