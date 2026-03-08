# Source Contract Governance

As of 2026-03-07.

## Purpose

Keep search construction and extraction mappings synchronized as source UIs change, with measurable drift signals and explicit ownership.

## Single Source of Truth

- Contract registry: `config/source-contracts.json`
- Contract loader + drift evaluator: `src/sources/source-contracts.js`
- Search construction implementation: `src/sources/search-url-builder.js`
- Source criteria hydration/persistence: `src/config/load-config.js`
- Criteria design companion: `docs/plans/2026-03-06-search-construction-design.md`

## Contract Shape (Per Source Type)

Each contract declares:

- `sourceType`
- `contractVersion`
- `lastVerified`
- `criteriaMapping` for canonical fields (`title`, `keywords`, `location`, `distanceMiles`, `datePosted`, `experienceLevel`, `minSalary`) using:
  - `url`
  - `ui_bootstrap`
  - `post_capture`
  - `unsupported`
- `extraction.requiredFields`
- `extraction.fullJobDescription` (`yes`, `no`, `partial`)
- `expectedCountStrategy`
- `paginationStrategy`

## Runtime Drift Signals

- `jf check-source-contracts` computes source-level drift status from latest capture payloads:
  - `ok`: no stale contract and no low required-field coverage issues
  - `warning`: stale contract only
  - `error`: missing contract or low required-field extraction coverage
- Coverage denominator is captured jobs in the latest payload.
- Missing/placeholder values (`""`, `unknown`) do not count as covered.

## Measurement Baselines

Use these together for quality tracking:

- Criteria accountability buckets (`appliedInUrl`, `appliedInUiBootstrap`, `appliedPostCapture`, `unsupported`) on each source row.
- Capture funnel counts (`availableCount`, `capturedRawCount`, `postHardFilterCount`, `postDedupeCount`, `importedCount`) from capture payload metadata.
- Found ratio in dashboard `Searches` table (`importedCount/expectedCount` or `importedCount/?`).
- Structured metadata quality (`metadataQualityScore`, `missingRequiredFields`) from normalized jobs.

## Update Workflow When a Source UI Changes

1. Reproduce with a fresh capture for the affected source.
2. Update parser/search mapping code.
3. Update `config/source-contracts.json` (`contractVersion`, `lastVerified`, mapping/required field changes).
4. Run tests:
   - `npm test -- test/source-contracts.test.js test/source-contract-drift-check.test.js`
   - Relevant source parser and schema tests.
5. Run `jf check-source-contracts` in an environment with valid `config/sources.json`.
6. Update `docs/plans/2026-03-06-search-construction-design.md` if canonical mapping intent changed.

## Disabled Sources Policy

`wellfound_search` and `remoteok_search` can remain disabled in runtime capture, but contracts must still stay versioned and validated by tests to avoid stale re-enable paths.
