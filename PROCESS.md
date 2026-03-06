# Engineering Process

This document defines how work is planned, built, verified, and shipped in this repository.

## Purpose

The process exists to deliver changes quickly without lowering engineering or UX quality. It defines a consistent path from idea to deployment, keeps context durable for agents, and optimizes for fast, reliable bug fixes.

## Operating Goals

1. Rapid development that still meets high engineering and UX standards.
2. A clear workflow from planning to deployment.
3. Durable documentation so any agent can quickly regain context.
4. Low defect rate with fast bug detection and repair.

## Work Classification

Classify each task before implementation:

- **Bugfix**: Existing behavior is broken and reproducible.
- **Feature**: New capability, behavior change, architecture update, or other non-trivial implementation.

## Required Path Per Work Type

### Bugfix Path (default: autonomous)

1. Reproduce the bug with concrete evidence (test, logs, or deterministic steps).
2. Implement a focused fix at root cause level.
3. Verify with targeted tests plus relevant regression checks.
4. Summarize evidence and any new lesson in `/Users/admin/job-finder/docs/learnings.md`.

No pre-implementation check-in is required unless risk is high (see Risk Gates).

### Feature Path (default: planned)

For non-trivial feature work, an ExecPlan is mandatory before implementation.

1. Enter planning mode.
2. Author/update an ExecPlan under `/Users/admin/job-finder/docs/plans/` following `/Users/admin/job-finder/PLANS.md`.
3. Check in on the plan before implementation starts.
4. Implement incrementally against milestones.
5. Keep planning mode state and ExecPlan `Progress` synchronized.
6. Verify behavior and tests before completion.

## Risk Gates (always require explicit check-in)

- Destructive operations.
- Data/schema migrations with rollback risk.
- Security/privacy-sensitive changes.
- Ambiguous requirements with multiple plausible interpretations.

## Quality Bar

A task is not complete unless all are true:

1. Behavior is demonstrably correct for the intended use case.
2. Relevant tests pass.
3. No obvious regressions are introduced.
4. UX is intentional, coherent, and free of broken/unclear states.
5. Final summary includes what changed, why, and verification evidence.

## Verification Standards

- Prefer test-first for behavior changes where practical.
- For bugfixes, include a regression test when feasible.
- Run targeted tests for edited areas and broader suite when risk is wider.
- For UI work, verify critical user paths and loading/error/empty states.

## Deployment Expectations

Before deployment or merge-to-main intent:

1. Run repository verification commands required by current policy.
2. Confirm release/rollback implications for the change.
3. Ensure documentation and operator notes are updated if behavior changed.

Note: release channel automation (for example NPM/Homebrew) may evolve; treat backlog specs as roadmap, not a bypass for current verification.

## Planning Mode

Planning mode is a native Claude Code feature that tracks active work with a structured checklist. Use it for:

- Breaking down non-trivial work into steps
- Tracking progress during implementation
- Managing verification steps

Enter planning mode (`/plan`) for any feature work or multi-step bugfix. Exit when complete (`/done`).

**For feature work:** Keep both planning mode state AND ExecPlan `Progress` section synchronized. Planning mode tracks the active session; ExecPlans are durable docs for future sessions.

## Documentation System

Use these files as the source-of-truth map:

- `/Users/admin/job-finder/PROCESS.md`: umbrella process and quality standards.
- `/Users/admin/job-finder/AGENTS.md`: agent execution rules and day-to-day constraints.
- `/Users/admin/job-finder/PLANS.md`: ExecPlan format and rigor requirements.
- `/Users/admin/job-finder/CLAUDE.md`: architecture overview, commands, development notes.
- `/Users/admin/job-finder/docs/brand/BRAND_GUIDELINES.md`: brand strategy, visual identity, and UX expression standards.
- `/Users/admin/job-finder/docs/plans/`: feature-level execution plans.
- `/Users/admin/job-finder/docs/backlog.md`: prioritized future work and linked specs.
- `/Users/admin/job-finder/docs/learnings.md`: mistakes, patterns, and process improvements.

## Process Improvement

When process friction or quality gaps are discovered:

1. Capture the issue in `/Users/admin/job-finder/docs/learnings.md`.
2. Propose a concrete rule/process update.
3. Update this file and linked policy docs so future agents apply the fix by default.
