# Changelog

All notable changes to this project should be documented in this file.

## Unreleased

### Added

- Search-controls expansion in canonical criteria and dashboard/API:
  - `keywordMode` (`and`/`or`) support
  - `includeTerms` / `excludeTerms` support
  - include/exclude semantics propagated through URL construction and scoring
- Source run-delta persistence and surfacing:
  - new `source_run_deltas` table (`new`, `updated`, `unchanged`, `imported`)
  - latest run delta counters surfaced in dashboard source/search status
  - aggregate run-delta summary in CLI `sync` output
- Status-aware retention policy and cleanup audit:
  - policy loader with defaults/overrides (`config/retention-policy.json`)
  - cleanup execution during sync flows with audit log at `data/retention/cleanup-audit.jsonl`
  - CLI inspect command: `jf retention-policy`
- Analytics instrumentation baseline:
  - canonical event registry and schema mapping (`src/analytics/events.js`)
  - local analytics persistence (`data/analytics/events.jsonl`, `data/analytics/counters.json`)
  - optional PostHog forwarding when `POSTHOG_API_KEY` is set
- Bridge primitive catalog and safety boundary enforcement:
  - explicit read/write primitive classes
  - MCP v1 surface validation that blocks write primitives
- Source contract diagnostics artifact writer:
  - contract drift diagnostics persisted under `data/quality/contract-drift/latest.json`
- Full-JD evaluation evidence fields persisted in scoring output:
  - `evaluation_meta.contentPathUsed`
  - `evaluation_meta.detailFetchStatus`
  - `evaluation_meta.contentPathRationale`
- Legal/policy docs:
  - `PRIVACY.md`
  - `TERMS.md`
- Source quality governance baseline:
  - source contract registry in `config/source-contracts.json`
  - contract drift and rolling coverage checks via `check-source-contracts`
  - contract coverage history persisted in `data/quality/source-coverage-history.json`
- Capture-quality guardrails in ingest:
  - per-source capture evaluation outcomes (`accept`, `quarantine`, `reject`)
  - quarantine artifact persistence in `data/quality/quarantine/<source-id>/*.json`
  - canary checks via `check-source-canaries` with diagnostics in `data/quality/canary-checks/latest.json`
- Source health scoring and persistence:
  - rolling source health history in `data/quality/source-health-history.json`
  - adapter health status/reasons surfaced in dashboard search/source rows
- JSON shortlist renderer (`src/shortlist/render.js`) writing `output/shortlist.json`
- Refresh policy/state foundation for cache-vs-live decisioning:
  - source risk classes and profile-aware throttling (`safe`, `probe`, `mock`)
  - persisted refresh event state in `data/refresh-state.json`
  - challenge-signal classification and cooldown tracking
  - cache summary support for `expectedCount`
  - decision reason codes for diagnostics and future UI/CLI surfacing
- Global search criteria config (`config/search-criteria.json`) with merge behavior:
  - global defaults plus per-source `searchCriteria` overrides
  - schema validation for canonical criteria fields
- New npm script variants for refresh profiles:
  - `run:safe`, `run:probe`, `run:mock`
  - `review:safe`, `review:probe`, `review:mock`
- LinkedIn live capture improvements:
  - multi-page traversal using `start` pagination
  - persisted `expectedCount` in capture payload/summary
- Source capture funnel diagnostics in review dashboard:
  - `Found`, `Filtered`, `Dupes`, `Imported`, and weighted `Avg Score`
  - all-sources totals row for search tab rollups
- New dashboard API endpoint:
  - `POST /api/search-criteria` to save criteria and normalize source URLs

### Changed

- `check-source-contracts` now supports richer per-contract quality thresholds (required-field and detail-description coverage gates) and defaults to `minCoverage=0.9`.
- Dashboard search criteria controls now expose `AND`/`OR` keyword mode and include/exclude term fields.
- Scoring now applies exclude terms as hard filters and respects explicit keyword mode (`AND` default, `OR` opt-in).
- `sync` and dashboard sync-score flows now execute retention cleanup and include retention summary in outputs/events.
- Source status copy in dashboard now includes run-delta context alongside refresh/capture state.
- Source contract diagnostics now run during sync and emit diagnostics-path messages for operators.
- `sync`/`run` now gate ingest on capture-quality outcomes; quarantined/rejected runs no longer silently flow into scoring.
- `sync` and `run` support explicit quarantine override via `--allow-quarantined`.
- `check-source-contracts` now includes source health status/score context and uses non-zero exit codes on warning/error states.
- Normalization now preserves structured metadata fields (`sourceFoundRatio`, `sourceExpectedCount`, `metadataQualityScore`) for scoring/review rollups.
- Scoring pipeline now evaluates jobs from search criteria (`config/search-criteria.json`) via weighted criteria matching.
- Sync pipeline now prunes stale `new/viewed` source jobs that disappear from current captures.
- New captures now inherit existing application status by `normalized_hash` (for example, rejected/applied duplicates keep prior status).
- Review dashboard jobs views now include `Rejected`, and the primary action is `Find Jobs` (criteria save + run all).
- Searches tab now groups by source kind instead of individual source rows and uses compact status indicators.
- Dashboard source visibility/creation for Wellfound/RemoteOK and Narrata connect UI are controlled by feature flags.
- Source schema now validates structured `hardFilter` blocks (`requiredAll`, `requiredAny`, `excludeAny`, `fields`, `enforceContentOnSnippets`).
- `ashby_search` URL construction now reports `minSalary` as unsupported instead of applying it as a query term.
