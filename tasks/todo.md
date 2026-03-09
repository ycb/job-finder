# Data Quality Epic Todo

## Lane B W2-04 Net-New/Refresh Delta Completion (2026-03-09)

- [x] Review handoff packet + existing sync/dashboard code paths.
- [x] Create Lane B ExecPlan (`docs/plans/2026-03-09-lane-b-w2-04-net-new-refresh-deltas-execplan.md`).
- [x] Add failing tests for run delta classification and dashboard refresh delta visibility.
- [x] Implement run delta model + persistence (`src/jobs/run-deltas.js`, migrations, repository IO).
- [x] Wire CLI sync output and dashboard sync payloads to include run delta counters.
- [x] Update dashboard row copy to show delta counters with refresh context.
- [x] Run required verification:
  - `node --test test/run-deltas.test.js`
  - `node --test test/dashboard-refresh-status.test.js`
  - `npm test`
- [x] Save dashboard smoke artifact under `docs/roadmap/progress-merge/`.
- [x] Update roadmap tracker/dispatch/progress docs for Lane B completion evidence.

## Review (Lane B W2-04)

- Added run-delta classification module:
  - `src/jobs/run-deltas.js`
- Added run-delta persistence schema + repository APIs:
  - `src/db/migrations.js` (`source_run_deltas` table + indexes)
  - `src/jobs/repository.js` (`listSourceJobsForDelta`, `recordSourceRunDeltas`, `listLatestSourceRunDeltas`)
- Wired sync paths to compute/persist/report run deltas:
  - `src/cli.js` (`runSync` now prints `Run deltas: new/updated/unchanged`)
  - `src/review/server.js` (`runSyncAndScore` now returns/stores run delta totals)
- Dashboard surfacing updates:
  - `src/review/server.js` source rows now include:
    - `refresh: <reason> (<servedFrom>)`
    - `run delta: new X · updated Y · unchanged Z`
- Test coverage:
  - Added `test/run-deltas.test.js`
  - Extended `test/dashboard-refresh-status.test.js`
- Verification:
  - `node --test test/run-deltas.test.js test/dashboard-refresh-status.test.js` -> pass
  - `node src/cli.js sync` -> includes `Run deltas: new=0, updated=0, unchanged=0.`
  - `npm test` -> `182 passed, 0 failed`
  - Playwright smoke screenshot:
    - `docs/roadmap/progress-merge/2026-03-09-lane-b-w2-04-playwright-smoke.png`

## Plan

- [x] Complete Track A criteria accountability implementation + tests.
- [x] Complete Track B expected-count + capture-funnel + Found `X/Y` integration.
- [x] Complete Track C structured metadata object + placeholder semantics + quality markers.
- [x] Complete Track D by adding source contract drift-check tests and command verification.
- [x] Complete Track E docs synchronization (`search-construction` plan + governance doc + README/backlog references).
- [x] Complete Track F full-JD matrix/backlog closure for sources lacking full JD capture.
- [x] Run final verification suite covering changed modules and summarize residual risks.

## Adapter Reliability Guardrails Plan

- [x] Finalize and stage execplan scope for adapter reliability guardrails.
- [x] Milestone 1: implement ingest capture validation with `accept|quarantine|reject` outcomes.
- [x] Milestone 1: wire sync path to skip quarantined/rejected source captures by default and emit warnings.
- [x] Milestone 1: persist quarantine artifacts under `data/quality/quarantine/`.
- [x] Milestone 2: add source health history persistence and rolling anomaly scoring.
- [x] Milestone 2: expose source health API for dashboard/CLI consumers.
- [x] Milestone 3: add source canary config + checker command.
- [x] Milestone 4: surface non-blocking degraded/failing indicators in dashboard Searches table.
- [x] Milestone 4: update CLI output to include adapter health/degradation reasons.
- [x] Milestone 5: add/expand tests for validation, health, canaries, and serialization.
- [x] Milestone 5: run verification suite and live command checks, then summarize evidence.

## Review

- Added Track D governance tests:
  - `test/source-contracts.test.js`
  - `test/source-contract-drift-check.test.js`
- Fixed drift-check false-error behavior for empty capture samples (`null` coverage no longer treated as low coverage).
- Restored missing CLI dependency by adding `src/output/render.js` plus `test/shortlist-render.test.js` to keep CLI command loading valid.
- Added docs/governance artifacts:
  - `docs/analysis/source-contract-governance.md`
  - `docs/backlog-specs/p0-source-full-jd-gap-closure.md`
- Updated documentation surfaces:
  - `docs/plans/2026-03-06-search-construction-design.md`
  - `docs/backlog.md`
  - `README.md`
  - `docs/plans/2026-03-06-data-quality-epic-execplan.md`
- Verification:
  - `npm test -- test/source-contracts.test.js test/source-contract-drift-check.test.js test/shortlist-render.test.js` -> pass
  - `npm test -- test/search-url-builder.test.js test/source-search-criteria-bootstrap.test.js test/source-url-preview.test.js test/source-criteria-accountability.test.js test/source-expected-count.test.js test/sources-schema.test.js test/review-narrata-flag.test.js test/source-contracts.test.js test/source-contract-drift-check.test.js test/normalize-structured-meta.test.js test/source-extraction-quality.test.js` -> pass
  - `npm test` -> `136 passed, 0 failed`
  - live verification runs:
    - `node src/cli.js capture-source-live "linkedin-live-capture" --force-refresh` -> `93` jobs
    - `node src/cli.js capture-source-live "ashby-pm-roles" --force-refresh` -> `4` jobs
    - `node src/cli.js capture-source-live "google-ai-pm" --force-refresh` -> `10` jobs
    - `node src/cli.js capture-source-live "indeed-ai-pm" --force-refresh` -> `67` jobs
    - `node src/cli.js capture-source-live "zip-ai-pm" --force-refresh` -> `59` jobs
    - `node src/cli.js sync` with `builtin-sf-ai-pm` enabled -> BuiltIn capture populated (`9` jobs)
    - `node src/cli.js check-source-contracts` executed on live captures
  - bridge reuse verification:
    - sequential `capture-source-live` calls reused a single persistent bridge session (no per-source start/stop cycle after first run)
- Residual risk:
  - drift errors remain for LinkedIn/Ashby/Google/Indeed/ZipRecruiter due low required-field coverage (`postedAt`, `salaryText`, `employmentType` hotspots).
  - `wellfound` and `remoteok` remain disabled and out of this analysis scope.

## Review (Adapter Reliability Guardrails)

- Added ingest guardrails:
  - `src/sources/capture-validation.js`
  - `src/cli.js` and `src/review/server.js` sync paths now quarantine/reject bad source runs and emit quality warnings.
  - quarantine evidence persists to `data/quality/quarantine/<source-id>/...`.
- Added health scoring/history:
  - `src/sources/source-health.js`
  - run-level health history persisted to `data/quality/source-health-history.json`.
  - `check-source-contracts` now prints health status/score/reasons per source.
- Added canary system:
  - `config/source-canaries.json`
  - `src/sources/source-canaries.js`
  - new CLI command: `node src/cli.js check-source-canaries`
  - canary failures downgrade source health (quarantine outcome), and diagnostics persist to `data/quality/canary-checks/latest.json`.
- Added dashboard health indicators:
  - source payload now includes `adapterHealthStatus`, `adapterHealthScore`, `adapterHealthReasons`.
  - Searches table status now shows non-blocking `adapter degraded` / `adapter failing` states with details.
- Verification evidence:
  - `npm test` -> `157 passed, 0 failed`
  - `node src/cli.js check-source-canaries` -> pass on enabled sources in this worktree
  - `node src/cli.js check-source-contracts --window 3 --min-coverage 0.7` -> pass with health summary output

## Parser Reliability Pass (2026-03-08)

- Parser and enrichment remediation completed for in-scope sources:
  - `src/browser-bridge/providers/chrome-applescript.js`
  - `src/sources/source-contracts.js`
  - `config/source-contracts.json`
  - `test/source-contract-drift-check.test.js`
- Core fixes shipped:
  - LinkedIn extractor now resolves canonical `jobs/view/<id>` URLs from detail context and preserves per-field provenance.
  - Ashby discovery flow now supports `jobs.ashbyhq.com/?q=...` by routing through a Google discovery URL and filtering non-board/non-job links.
  - ZipRecruiter extraction now has guarded detail parsing and no undefined helper references.
  - Source-level inference fallback (`inferred_search_filter`) added for missing `postedAt` and/or `salaryText` where date/salary filters are explicit in source URL.
  - Drift history now stores and filters by `contractVersion`, isolating post-fix rolling coverage from older parser versions.
  - Contract versions bumped to `1.1.0` for `linkedin_capture_file`, `ashby_search`, `google_search`, `indeed_search`, `ziprecruiter_search`.
- Verification:
  - `npm test -- test/source-contracts.test.js test/source-contract-drift-check.test.js test/detail-enrichment.test.js` -> pass.
  - Live bridge capture refresh:
    - `ashby-pm-roles` -> `475` jobs
    - `google-ai-pm` -> `10` jobs
    - `indeed-ai-pm` -> `57` jobs
    - `zip-ai-pm` -> `155` jobs
    - `linkedin-live-capture` repeated refreshes -> stable high-field coverage
  - `node src/cli.js check-source-contracts --window 3 --min-coverage 0.7` -> pass for enabled sources.
  - `evaluateSourceContractDrift({ includeDisabled: true, window: 3, minCoverage: 0.7 })` -> `ok` for all in-scope sources (`linkedin`, `builtin`, `ashby`, `google`, `indeed`, `zip`).
