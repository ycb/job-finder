# Frontend Foundation Dispatch Board

As of 2026-03-11.

Scope reference: `docs/plans/2026-03-11-dashboard-frontend-foundation-execplan.md`

## Execution Mode

- Mode: `dispatching-parallel-agents` with controller-managed merges.
- Controller branch/worktree (required):
  - branch: `codex/frontend-foundation-controller`
  - worktree: `/Users/admin/.codex/worktrees/frontend-foundation-controller`
- No lane edits to controller-owned docs unless explicitly assigned:
  - `docs/backlog.md`
  - `docs/roadmap/phase-1-execution-tracker.md`
  - `docs/roadmap/phase-1-dispatch-board.md`
  - `docs/roadmap/decision-log.md`
  - `docs/learnings.md`

## Parallel Waves

### Wave F1 (parallel now)

| Lane | Branch | Worktree | Scope | Dependency |
| --- | --- | --- | --- | --- |
| F1-A Infra | `codex/frontend-f1-a-infra` | `/Users/admin/.codex/worktrees/frontend-f1-a-infra` | React app scaffold + build + static serving + UI mode switch | None |
| F1-B Design System | `codex/frontend-f1-b-design-system` | `/Users/admin/.codex/worktrees/frontend-f1-b-design-system` | Tailwind + shadcn setup and base component primitives | F1-A [soft] |
| F1-C Contracts & Playwright Harness | `codex/frontend-f1-c-contracts-harness` | `/Users/admin/.codex/worktrees/frontend-f1-c-contracts-harness` | `/api/dashboard` contract tests + UI smoke harness for legacy/react mode | F1-A [soft] |

### Wave F2 (parallel after F1 merge)

| Lane | Branch | Worktree | Scope | Dependency |
| --- | --- | --- | --- | --- |
| F2-D Searches Slice | `codex/frontend-f2-d-searches` | `/Users/admin/.codex/worktrees/frontend-f2-d-searches` | Searches tab parity in React (tabs/state rows/actions/toast) | F1-A/F1-B/F1-C [hard] |
| F2-E Onboarding Interactions | `codex/frontend-f2-e-onboarding` | `/Users/admin/.codex/worktrees/frontend-f2-e-onboarding` | Onboarding source readiness/auth interactions in React | F1-A/F1-B/F1-C [hard] |

## Merge Gate Order

1. Implementer lane complete with required verification evidence.
2. Spec-review lane report approved.
3. Code-review lane report approved.
4. Controller merge and tracker update.

## Global Verification Gates

Required on every lane:

1. Targeted tests for changed files.
2. Full suite: `npm test`.
3. If UI changed: Playwright smoke artifact in `docs/roadmap/progress-merge/`.

Required before moving from F1 to F2:

1. React mode serves without runtime error.
2. Legacy mode still works (feature-flag fallback).
3. Contract tests pass for required dashboard payload fields.

## Planning Precedence (Worker Guardrail)

- For this execution, workers must update the existing ExecPlan at:
  - `docs/plans/2026-03-11-dashboard-frontend-foundation-execplan.md`
- `tasks/todo.md` is not a valid destination for feature-level ExecPlan drafting in this repo.

## Controller Notes

- This dispatch is intentionally front-loaded ahead of full manual QA closeout for Phase 1/1.1 + onboarding.
- Full QA signoff is paused until F2 parity gates pass in React mode.
