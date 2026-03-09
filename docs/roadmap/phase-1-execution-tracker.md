# Phase 1 Execution Tracker

Started: 2026-03-08
Scope reference: `docs/roadmap/kickoff/2026-03-08-mvp-phase-1-kickoff.md`
Dispatch board: `docs/roadmap/phase-1-dispatch-board.md`

## Snapshot

- Total tracked items: `12`
- Done: `2`
- In progress: `6`
- Blocked: `1`
- Planned: `3`

## Active Dispatch State

- current_task: `W1-04`
- lane: `Source Contracts`
- implementer_status: `ready to dispatch`
- spec_review_status: `pending`
- code_quality_status: `pending`
- gate_order: `implementer -> spec compliance -> code quality`

## Item Tracker

| Item | Priority | Theme | Status | Complexity | Dependencies |
| --- | --- | --- | --- | --- | --- |
| Onboarding source auth readiness | P0 | Onboarding | Planned | M | - |
| Full-JD page-level verification pass | P0 | Core | Blocked | M | Built In salary extraction [hard] |
| Full-JD extraction gap closure | P0 | Source Trust | In progress | L | Source-shape contracts [soft] |
| Read-vs-write MCP/browser boundary | P0 | Integrations | Done (`1b18d56`) | L | - |
| Source-shape contracts library | P0 | Architecture | Done (`444d199`) | L | - |
| Persist formatter diagnostics | P1 | Core | In progress | M | - |
| Multi-keyword criteria support | P1 | Core | In progress | M | Search-controls cleanup [soft] |
| Search controls (hard filter, include/exclude, cache) | P1 | Core | In progress | L | - |
| Net-new + refresh behavior | P1 | Core | In progress | M | - |
| Tooling ownership/metering baseline | P1 | Operations | In progress | L | PostHog SDK installed; channel taxonomy/reporting contract pending |
| Value metrics + caps + donation verification | P1 | Operations | Planned | L | Tooling ownership/metering [hard] |
| Local storage retention controls | P1 | Operations | Planned | M | Tooling ownership/metering [soft] |

## Milestone Targets (Initial)

1. Milestone A: P0 safety + contract foundations active.
2. Milestone B: P0 full-JD trust path unblocked and validated.
3. Milestone C: P1 criteria-fidelity in-progress items complete.
4. Milestone D: P1 operations controls (`metering`, `caps`, `retention`) complete.

## Update Protocol

- Update this file after each merge to `main` and in daily review.
- Any priority/scope change requires stakeholder approval and decision-log entry.
