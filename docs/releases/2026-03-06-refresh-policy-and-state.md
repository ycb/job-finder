# Release Note: Refresh Policy and State Foundation

## Release Metadata

- Date: `2026-03-06`
- Version/Tag: `7a56a2c`
- Scope: Cache decisioning foundations for source refresh control

## Summary

This release introduces a policy/state layer for deciding when source capture should use cache versus live refresh. It establishes source risk classes, profile-based throttling, and persisted event history needed for cooldown and daily-cap decisions.

## Changes

- Added refresh policy module with source risk classes and profile policies (`safe`, `probe`, `mock`).
- Added refresh state module for event history, cooldown tracking, and challenge outcome classification.
- Extended cache policy summary/decision outputs with `expectedCount`, reason codes, and next-eligible time.
- Added tests covering policy rules, state persistence, challenge detection, and decision outcomes.

## Why It Matters

- Provides deterministic guardrails against over-refreshing and challenge loops.
- Creates a durable state model that can be surfaced in CLI/dashboard diagnostics.
- Enables safer probing via profile controls without changing source-specific collectors.

## Behavior Changes

- No public command-surface changes yet.
- Internal behavior now supports richer refresh decision metadata and state persistence.

## Verification Evidence

- Commit inspected: `7a56a2c`
- Tests added:
  - `test/refresh-policy.test.js`
  - `test/refresh-state.test.js`
  - `test/capture-refresh-decision.test.js`
  - `test/challenge-signal-detection.test.js`
  - `test/refresh-profile-cli.test.js`

## Known Limitations

- Current release primarily lays foundation modules; explicit user-facing docs for environment toggles should ship with CLI/dashboard wiring.
- Decision metadata availability is ahead of broad user-facing explanation in top-level docs.

