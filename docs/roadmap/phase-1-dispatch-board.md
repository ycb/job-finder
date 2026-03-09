# Phase 1 Dispatch Board

As of 2026-03-08.

## Execution Mode

- Mode: `subagent-driven-development` (single active implementation task at a time).
- Required gate order per task:
  1. Implementer run + self-review
  2. Spec compliance review (`must be ✅`)
  3. Code quality review (`must be ✅`)
  4. Task marked complete and tracker updated

## Lane Worktrees

| Lane | Branch | Worktree Path | Scope |
| --- | --- | --- | --- |
| Safety Boundary | `codex/phase1-lane-safety-boundary` | `.codex/worktrees/phase1-safety-boundary` | P0 read-vs-write MCP/browser boundary |
| Source Contracts | `codex/phase1-lane-source-contracts` | `.codex/worktrees/phase1-source-contracts` | P0 source-shape contracts + contract-first extraction quality |
| Criteria Fidelity | `codex/phase1-lane-criteria-fidelity` | `.codex/worktrees/phase1-criteria-fidelity` | P1 diagnostics/multi-keyword/search-controls/net-new |
| Operations Metrics | `codex/phase1-lane-operations-metrics` | `.codex/worktrees/phase1-operations-metrics` | P1 metering/caps/donations/retention |

Baseline verification command run in lane workspace:
- `npm test` => `158` pass, `0` fail on commit `a00a9b2`.
- Latest verification after safety-boundary merge:
  - `npm test` => `162` pass, `0` fail on commit `1b18d56`.
- Latest verification after source-contracts merge:
  - `npm test` => `164` pass, `0` fail on commit `444d199`.
- Latest verification after contract-diagnostics merge:
  - `npm test` => `167` pass, `0` fail on commit `2dd4c6f`.
- Latest verification after formatter-diagnostics merge:
  - `npm test` => `169` pass, `0` fail on commit `d552f35`.
- Latest verification after multi-keyword merge:
  - `npm test` => `170` pass, `0` fail on commit `44d227c` (lane full suite).
- Latest verification after analytics-schema merge:
  - `npm test` => `175` pass, `0` fail on commit `c264403`.
- Latest verification after retention-policy merge:
  - `npm test` => `179` pass, `0` fail on commit `34ad002`.

## Wave 1 Queue (Prioritized)

| Queue ID | Priority | Item | Lane | Status | Dependency |
| --- | --- | --- | --- | --- | --- |
| W1-01 | P0 | Define read vs write primitive taxonomy in browser bridge + MCP surface restrictions | Safety Boundary | Completed (`1b18d56`) | None |
| W1-02 | P0 | Add hard enforcement that write primitives are not exposed in MCP v1 tool list | Safety Boundary | Completed (`1b18d56`) | W1-01 [hard] |
| W1-03 | P0 | Introduce source shape contract schema (`required`/`optional`, search parameter expectations) | Source Contracts | Completed (`444d199`) | None |
| W1-04 | P0 | Add contract loader/validator and drift diagnostics path for contract violations | Source Contracts | Completed (`2dd4c6f`) | W1-03 [hard] |
| W1-05 | P1 | Complete dashboard surfacing for persisted formatter diagnostics | Criteria Fidelity | Completed (`d552f35`) | None |
| W1-06 | P1 | Finalize multi-keyword flow through URL/search criteria (comma and boolean mode prep) | Criteria Fidelity | Completed (`44d227c`) | Search controls model [soft] |
| W1-07 | P1 | Define canonical event schema + channel tags + PostHog mapping for all surfaces | Operations Metrics | Completed (`c264403`) | None |
| W1-08 | P1 | Implement status-aware retention defaults and policy persistence wiring | Operations Metrics | Completed (`34ad002`) | W1-07 [soft] |

## Controller Checklist Per Task

1. Copy full task text from `docs/plans/2026-03-08-phase-1-multi-agent-orchestration-execplan.md`.
2. Dispatch implementer subagent in target lane worktree.
3. Require implementer evidence:
   - files changed
   - tests run
   - commit SHA
4. Dispatch spec-review subagent with full requirements and implementer claims.
5. Resolve all spec gaps before quality review.
6. Dispatch code-review subagent with `BASE_SHA` and `HEAD_SHA`.
7. Resolve all critical/important issues.
8. Update:
   - `docs/roadmap/phase-1-execution-tracker.md`
   - `docs/roadmap/progress-merge/<date>-<shortsha>.md` (on merge)
   - `docs/roadmap/progress-daily/<date>.md` (daily)
9. Run virtual retro update.

## Completion Definition for Wave 1

- All Wave 1 tasks are reviewed and merged.
- No task is marked done without spec + quality approvals.
- Dependencies and blockers are reflected in the phase tracker within the same day.

Wave 1 status:
- ✅ Completed on `2026-03-08` with `W1-08` merge (`34ad002`).

## Notes

- PostHog mapping contract and channel-tag schema are now in-repo (`docs/analytics/event-schema.md` + analytics modules). Active operations focus is now `W1-08` retention policy wiring.
