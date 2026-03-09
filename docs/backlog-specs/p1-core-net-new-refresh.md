# P1 Core Functionality: Net-New + Refresh Without Resetting Prior State

- Priority: P1
- Theme: Core Functionality

## Why
Current source runs can feel like a full restart, making it hard to see what is truly new vs already known.

## Impact
Clear net-new visibility and incremental refresh behavior improve trust and daily review efficiency.

## Detailed Spec
- On each source run, compute and persist net-new deltas instead of treating every run like a full reset.
- Preserve prior result state and annotate records with run-level freshness metadata.
- Update UI to show:
  - net-new count
  - refreshed/updated count
  - unchanged count (optional)
- Ensure run history can distinguish newly discovered jobs from re-seen jobs.

## Acceptance Criteria
- Re-running sources does not reset prior review context.
- UI clearly exposes net-new results per run.
- Tests cover delta classification and UI-facing counters.
