# P2 Source Expansion: Add Levels.fyi as a New Source

- Priority: P2
- Theme: Source Expansion

## Why
Levels.fyi can surface compensation-transparent roles and companies that are underrepresented in current source coverage.

## Impact
Broader source coverage and stronger salary-signal data for prioritization.

## Detailed Spec
- Add `levelsfyi_search` source type support in schema and source management flows.
- Implement collector/parser for Levels.fyi job listings with normalized fields.
- Define URL normalization and criteria mapping behavior for supported filters.
- Integrate with existing ingest -> dedupe -> score -> review pipeline.
- Add tests for parser stability and source integration.

## Acceptance Criteria
- Users can add and run a Levels.fyi source end-to-end.
- Parsed jobs include key normalized fields needed for scoring.
- Tests cover parsing and pipeline integration paths.
