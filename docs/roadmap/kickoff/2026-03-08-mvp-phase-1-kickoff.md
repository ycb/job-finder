# MVP Phase 1 Kickoff (2026-03-08)

## Objective

Ship a trustworthy, agent-native MVP quickly by completing P0 safety/quality foundations and the minimum P1 set needed for daily user value and operational control.

## Scope Lock (Phase 1)

- In scope: all `P0` items in `docs/backlog.md` plus MVP `P1` items currently marked `In progress` and core operations controls needed for launch readiness.
- Out of scope: Icebox items and P2 source/UX expansion.
- Governance: priority/scope changes require stakeholder approval.

## Why This Phase Exists

- P0 foundations reduce false positives, unsafe automation surface area, and silent data-quality regressions.
- Selected P1 items increase immediate utility (`search quality`, `freshness`, `diagnostics`) and launch viability (`metering`, `caps`, `retention`).

## Deliverables and Done Criteria

1. P0 safety + quality baseline is complete or explicitly waived with approval.
2. Daily run experience shows net-new value without reset confusion.
3. Usage/value metrics are available for launch decisions.
4. Retention and donation policy paths are implemented behind clear, testable rules.

## Phase 1 Workstreams

| Workstream | Backlog Items | Complexity | Dependency Notes |
| --- | --- | --- | --- |
| Safety boundary | P0 read-vs-write MCP/browser boundary | L | Hard prerequisite for MCP surface expansion |
| Source contract quality | P0 source-shape contracts library; P0 full-JD gap closure | L | Contract library should land before broad source additions |
| Full-JD trust | P0 page-level pass | M | Blocked by Built In salary extraction path |
| Criteria fidelity | P1 diagnostics; P1 multi-keyword; P1 hard filter/include-exclude/cache; P1 net-new refresh; P1 work type | M-L | Must preserve deterministic scoring and clear filter explainability |
| Launch operations | P1 tooling ownership/metering; P1 value metrics/caps/donation verification; P1 local retention controls | L | Metering is hard dependency for caps/donation effectiveness |

## Sequencing (Best Current Plan)

1. Land P0 safety boundary and source-shape contracts.
2. Resolve Built In salary dependency, then close page-level full-JD pass.
3. Complete criteria-fidelity items already in progress.
4. Ship operations metering/value controls and retention defaults.
5. Reassess MVP launch checklist and hold Icebox.

## Tracking Cadence

- Daily: `docs/roadmap/progress-daily/YYYY-MM-DD.md`
- Merge-based: `docs/roadmap/progress-merge/YYYY-MM-DD-<shortsha>.md`
- Phase tracker: `docs/roadmap/phase-1-execution-tracker.md`
- Decisions: `docs/roadmap/decision-log.md`

## Open Questions

None blocking kickoff as of 2026-03-08. New scope or priority changes route through approval-required decision flow.
