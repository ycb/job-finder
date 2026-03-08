# Release Note: Source Quality Guardrails and Contract Governance

## Release Metadata

- Date: `2026-03-08`
- Version/Tag: `a57a935` (merge commit for `d321d45`)
- Scope: Ingest guardrails, source health/canaries, contract governance, and shortlist output hardening

## Summary

This release adds hard quality controls around source ingest so broken adapters fail loudly instead of silently degrading ranking quality. It introduces source contract governance, canary checks, rolling health telemetry, and quarantine artifacts for diagnosis. It also hardens shortlist output into a stable JSON artifact for downstream tooling.

## Changes

- Added source contract registry and governance inputs:
  - `config/source-contracts.json`
  - `docs/analysis/source-contract-governance.md`
- Added contract drift command and rolling coverage checks:
  - `node src/cli.js check-source-contracts [--window n] [--min-coverage r] [--stale-days d]`
  - coverage history persisted at `data/quality/source-coverage-history.json`
- Added ingest quality guardrails (`accept`, `quarantine`, `reject`) in sync/review ingest paths:
  - quarantine evidence persisted at `data/quality/quarantine/<source-id>/*.json`
  - explicit override via `--allow-quarantined`
- Added source canary framework:
  - config in `config/source-canaries.json`
  - command: `node src/cli.js check-source-canaries [--include-disabled]`
  - diagnostics artifact: `data/quality/canary-checks/latest.json`
- Added source health history/scoring and dashboard visibility:
  - history persisted at `data/quality/source-health-history.json`
  - adapter health status/reasons surfaced in source/search UI diagnostics
- Added structured shortlist renderer:
  - `src/shortlist/render.js`
  - `shortlist` output now written as `output/shortlist.json`
- Added/expanded tests for capture validation, canaries, source contracts, source health, structured metadata normalization, and shortlist rendering.

## Why It Matters

- Protects ranking/scoring quality by default when a source parser regresses.
- Makes source reliability measurable over time instead of anecdotal.
- Gives operators repeatable diagnostics for canaries, coverage drift, and quarantine outcomes.
- Improves downstream interoperability with machine-readable shortlist output.

## Behavior Changes

- `sync`/`run` now block `quarantine` and `reject` ingest outcomes by default.
- `sync --allow-quarantined` and `run --allow-quarantined` can explicitly ingest quarantined runs for debugging.
- `check-source-contracts` now reflects contract drift plus source health context and can return warning/error exit codes.
- `shortlist` now writes `output/shortlist.json` (not markdown).

## Verification Evidence

- Commit-range review covered:
  - `docs/plans/2026-03-06-data-quality-epic-execplan.md`
  - `docs/plans/2026-03-06-search-construction-design.md`
  - `docs/plans/2026-03-07-adapter-reliability-guardrails-execplan.md`
  - `docs/backlog.md`
  - `docs/backlog-specs/p0-source-full-jd-gap-closure.md`
  - new backlog specs added in this round (`p1-core-net-new-refresh`, `p1-core-search-hardfilter-keywords-include-exclude-cache`, `p1-ux-multi-search-tabs`, `p2-source-expansion-levelsfyi`)
- Feature implementation evidence is documented in:
  - `docs/plans/2026-03-07-adapter-reliability-guardrails-execplan.md`
  - tests under `test/` for capture validation, canaries, contracts, health, and shortlist rendering

## Known Limitations

- Wellfound and RemoteOK remain feature-flagged paths and continue to require targeted quality verification before broad enablement.
- Quarantine override is intentionally manual and should be used only for controlled investigation workflows.
