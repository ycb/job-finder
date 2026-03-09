# P1 Operations: Local Storage Management and Automatic Deletion

- Priority: P1
- Theme: Operations & Tooling

## Context
Local-first workflows accumulate captures, logs, and intermediate artifacts that can grow over time without clear user controls.

## Why It Matters
Users need explicit control over what data is kept locally, for how long, and whether cleanup is manual or automatic.

## User/Business Value
- Users can reclaim disk space without breaking core workflows.
- Users can set retention behavior aligned with privacy and compliance preferences.
- Product reliability improves by preventing unbounded local storage growth.

## MVP Scope
- Add user controls for local storage management:
  - view storage usage summary by artifact type
  - manually delete selected/local cache data safely
- Add status-aware automatic deletion policy with `auto-delete ON` by default:
  - `new` (never viewed): delete after `30` days
  - `viewed`: delete after `45` days
  - `skip_for_now`: delete after `21` days
  - `rejected`: delete after `14` days
  - `applied`: never auto-delete
- Add retention settings UX that makes status-based defaults explicit and user-editable.
- Add safety constraints:
  - never delete required config/state files
  - preview/confirmation flow for destructive cleanup
  - preserve application history and status transitions for `applied` jobs
- Add audit visibility:
  - last cleanup run
  - amount deleted
  - failures/warnings

## Future Work (Out of MVP)
- Advanced per-source retention rules.
- Storage quotas with proactive warnings.
- Cloud backup/archive options before deletion.

## Metrics
- `% users enabling automatic deletion`
- `% users keeping default status-aware retention unchanged`
- `median local storage footprint`
- `bytes deleted per week`
- `% cleanup runs successful`
- `% users hitting storage-warning threshold`

## Definition of Done
- Users can inspect and manage local storage from product workflows.
- Automatic deletion defaults to enabled and executes status-aware TTL policy.
- Retention behavior preserves `applied` history by default (never auto-delete).
- Users can override defaults with clear visibility into impacts.
- Cleanup respects safe-file exclusions and produces audit logs.
- Tests cover manual delete, automatic retention cleanup, and safety guardrails.

## Complexity
- Size: `M`
- Rationale: cross-cutting work across local storage inventory, retention policy, and safe cleanup logic.

## Dependencies
- `DEPENDS_ON: Define internal-vs-external tool ownership and usage metering baseline [soft]`
