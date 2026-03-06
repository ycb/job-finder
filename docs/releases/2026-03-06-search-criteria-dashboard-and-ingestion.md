# Release Note: Search Criteria, Dashboard Orchestration, and Ingestion Hygiene

## Release Metadata

- Date: `2026-03-06`
- Version/Tag: `working-tree (uncommitted batch after 7a56a2c)`
- Scope: Search-criteria-driven scoring, dashboard workflow overhaul, and ingestion lifecycle hardening

## Summary

This release shifts the product toward a criteria-first operating model. Search criteria now drive both URL construction defaults and scoring behavior, while the review dashboard centers around a `Find Jobs` action that saves criteria and runs sources. Ingestion behavior is also tightened with stale-job pruning and status inheritance across normalized duplicates.

## Changes

- Added global search criteria config (`config/search-criteria.json`) with schema validation.
- Added global + per-source criteria merge in source loading/URL derivation.
- Switched run/score paths to search-criteria-driven evaluation (`evaluateJobsFromSearchCriteria`).
- Added stale source-job pruning during sync for `new/viewed` records.
- Added application status inheritance by `normalized_hash` for newly captured duplicates.
- Added LinkedIn multi-page capture traversal and `expectedCount` persistence.
- Added canonical dedupe normalization improvements for Indeed (`jk`) and Google jobs (`docid`).
- Added review dashboard `Find Jobs` flow (`/api/search-criteria` + `/api/sources/run-all`) with inline feedback.
- Added dashboard source-kind grouping and funnel metrics (`Found`, `Filtered`, `Dupes`, `Imported`, `Avg Score`).
- Added jobs view options including `Rejected`.
- Added refresh profile npm scripts (`run:*`, `review:*`) and dashboard feature flags for Wellfound/RemoteOK/Narrata controls.
- Added structured source `hardFilter` schema validation (`requiredAll`, `requiredAny`, `excludeAny`, `fields`, `enforceContentOnSnippets`).
- Updated `ashby_search` URL construction to treat `minSalary` as unsupported criteria.

## Why It Matters

- Reduces setup ambiguity by making scoring and query intent explicit in one criteria file.
- Improves review trust by showing where jobs are dropped between capture and import.
- Prevents stale or duplicate-role churn by pruning stale queue items and carrying forward prior application decisions.
- Makes the dashboard a primary control plane instead of a passive viewer.

## Behavior Changes

- `score` and `run` now evaluate from search criteria instead of profile goals/preferences.
- Review UI now emphasizes `Find Jobs`; prior top-level `Run All`/`Refresh + Re-score` controls are removed.
- Wellfound/RemoteOK visibility in review UI is feature-flagged:
  - `JOB_FINDER_ENABLE_WELLFOUND=1`
  - `JOB_FINDER_ENABLE_REMOTEOK=1`
- Narrata connect controls in profile tab are feature-flagged:
  - `JOB_FINDER_ENABLE_NARRATA_CONNECT=1`

## Verification Evidence

- Updated/new tests in this batch include:
  - `test/search-criteria-config.test.js`
  - `test/score-search-criteria.test.js`
  - `test/source-prune.test.js`
  - `test/rejected-job-inheritance.test.js`
  - `test/linkedin-capture-pagination.test.js`
  - `test/linkedin-expected-count.test.js`
  - `test/dashboard-refresh-status.test.js`
  - `test/review-refresh-ui-copy.test.js`
  - `test/review-narrata-flag.test.js`
  - plus schema/normalization updates in existing tests

## Known Limitations

- Wellfound and RemoteOK remain intentionally gated in the dashboard until quality verification is complete.
- Some source-specific criteria (for example, parts of Wellfound URL application) still rely on capture/runtime behavior rather than full URL-level expression.
- `ashby_search` does not apply `minSalary` during URL construction; salary constraints are still honored by scoring/hard filters.
