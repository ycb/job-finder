# Adapter Reliability Guardrails

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, broken source adapters will fail loudly instead of silently poisoning downstream scoring and deduplication. The system will validate capture quality at ingest, compute adapter health signals over time, quarantine suspicious runs, and surface non-blocking warnings in the dashboard so the user can continue workflow while seeing which source needs attention.

## Progress

- [x] (2026-03-08 04:28Z) Created ExecPlan and anchored scope to in-scope sources (`linkedin`, `builtin`, `ashby`, `google`, `indeed`, `ziprecruiter`).
- [x] (2026-03-08 17:24Z) Re-loaded codebase integration points (`runSync`, capture writers, dashboard source rows) and converted milestones into `tasks/todo.md` checklist for active execution tracking.
- [x] (2026-03-08 18:02Z) Implemented Milestone 1 ingest guardrails: added `src/sources/capture-validation.js`, integrated quarantine/reject gating into CLI `sync` and review-server sync path, and added `test/capture-validation.test.js`.
- [x] (2026-03-08 20:07Z) Implemented Milestone 2 source-health history/scoring (`src/sources/source-health.js`) and wired ingest decision recording from both CLI and review sync paths.
- [x] (2026-03-08 20:41Z) Implemented Milestone 3 canary checks (`config/source-canaries.json`, `src/sources/source-canaries.js`) and added CLI `check-source-canaries` with diagnostics + health downgrades on failures.
- [x] (2026-03-08 21:03Z) Implemented Milestone 4 non-blocking health indicators in dashboard Searches table and health output in `check-source-contracts`.
- [x] (2026-03-08 21:12Z) Completed Milestone 5 verification: full test suite pass plus CLI smoke checks (`check-source-canaries`, `check-source-contracts`, `capture-all-live` cache-path run).
- [x] Implement ingest schema guardrails with quarantine/reject routing and operator-visible reasons.
- [x] Implement adapter health scoring (volume anomaly, null-rate drift, required-field coverage confidence).
- [x] Implement canary capture checks with expected-output diffing and per-source canary status.
- [x] Add dashboard and CLI surfaces for adapter health and degraded-state indicators.
- [x] Add automated tests (unit + integration) and complete live verification sequence.

## Surprises & Discoveries

- Observation: Existing rolling contract coverage is now reliable per parser version because history keys include `contractVersion`.
  Evidence: `src/sources/source-contracts.js` stores and filters `history.bySource[*].contractVersion`.

- Observation: Source quality failures are source-specific and require mixed strategy (detail parse, fallback inference, quarantine), not one global regex pass.
  Evidence: Current captures show heterogeneous weak points: LinkedIn (`postedAt/salary/employment` historically), Indeed (freshness), Google/Zip (salary/employment), Ashby (discovery noise).

## Decision Log

- Decision: Treat this as a new feature track with a dedicated ExecPlan, separate from parser-remediation commit history.
  Rationale: Guardrails are cross-cutting (ingest, health analytics, UI/CLI) and need isolated rollout and rollback.
  Date/Author: 2026-03-08 / Codex

- Decision: Default response mode will be silent degradation + visible indicator, not hard-stop pipeline.
  Rationale: User explicitly asked to avoid interrupting agent flow while still surfacing adapter breakage.
  Date/Author: 2026-03-08 / Codex

- Decision: Ingest will support three outcomes per run: `accept`, `quarantine`, `reject`.
  Rationale: We need a middle state to retain evidence for debugging without polluting scoring tables.
  Date/Author: 2026-03-08 / Codex

## Outcomes & Retrospective

Implemented across ingest, health tracking, canary validation, and UX/CLI surfacing with the following outcomes:

- Broken or malformed source runs no longer silently ingest; they are rejected/quarantined with persisted evidence artifacts.
- Source health now has rolling status/score/reason semantics and is visible in both CLI (`check-source-contracts`) and dashboard Searches status.
- Canary checks are configurable per source type and now produce machine-readable diagnostics (`data/quality/canary-checks/latest.json`).
- Regression coverage expanded for capture validation, health scoring, and canary evaluation.
- Verification evidence:
  - `npm test` -> `157 passed, 0 failed`
  - `node src/cli.js check-source-canaries` -> pass on enabled sources in this worktree
  - `node src/cli.js check-source-contracts --window 3 --min-coverage 0.7` -> pass with health output
  - `node src/cli.js capture-all-live` -> cache-path capture-all flow remained non-blocking

## Context and Orientation

The capture pipeline starts in `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js` and source-specific collectors under `/Users/admin/job-finder/src/sources/`. Captured payloads are written to `data/captures/*.json`, then normalized in `/Users/admin/job-finder/src/jobs/normalize.js`, persisted in `/Users/admin/job-finder/src/jobs/repository.js`, and surfaced in dashboard endpoints in `/Users/admin/job-finder/src/review/server.js`.

Contract quality checks already exist in `/Users/admin/job-finder/src/sources/source-contracts.js` with CLI entry in `/Users/admin/job-finder/src/cli.js` (`check-source-contracts`). This plan adds ingest-time safety checks and run-health intelligence so adapter breakage is detected before bad records affect downstream ranking.

In this repository, “adapter” means the source-specific DOM extraction path that turns a board page into normalized job records. “Canary” means a known stable posting (or stable query signature) that can be re-captured and compared against expected extracted fields.

## Plan of Work

Milestone 1 will add ingest guardrails. We will add a validation module in `/Users/admin/job-finder/src/sources/` that evaluates each capture run against required field thresholds and run-level sanity checks (minimum rows, URL validity, duplicate inflation, null-field limits). `collectJobsFromSource`/capture write paths will annotate runs with validation outcomes and reasons. Suspicious runs will be written to a quarantine artifact (`data/quality/quarantine/*.json`) and excluded from normal `sync` insertion unless an explicit override flag is used.

Milestone 2 will add health scoring and anomaly detection. We will persist per-source run stats (`sampleSize`, required-field coverage, null rates, and capture funnel ratios) in `data/quality/source-health-history.json`. Health score calculation will combine: (1) required-field coverage confidence, (2) run volume anomaly versus trailing window, and (3) sudden null-rate spikes by field. This becomes a source-level `health.status` (`ok`, `degraded`, `failing`) and `health.reasons[]`.

Milestone 3 will add canary verification. We will create `config/source-canaries.json` for source-specific canary definitions. A new CLI command (`check-source-canaries`) will run canary captures or fixture replays and compare expected fields/value patterns. Mismatches downgrade source health and emit actionable diagnostics.

Milestone 4 will add UX/CLI surfacing. Dashboard payloads from `/Users/admin/job-finder/src/review/server.js` will include adapter health summary and last degradation reason per source. UI will show non-blocking indicators in Searches/source rows. CLI outputs (`sync`, `check-source-contracts`, `run-live`) will print concise degradation warnings with links to quality artifacts.

Milestone 5 will complete verification and rollout hardening. We will add tests for guardrail decisions, anomaly math, canary diff logic, and API serialization. Live QA will run captures sequentially in one bridge session and verify: healthy sources stay green, intentionally broken fixture paths surface degraded/failing status, quarantine files are produced, and normal sync remains uninterrupted.

## Concrete Steps

From repo root `/Users/admin/job-finder`:

1. Implement validation/quarantine core:

    npm test -- test/source-contract-drift-check.test.js test/source-extraction-quality.test.js

2. Add health-history scoring and drift anomaly tests:

    npm test -- test/source-health-*.test.js

3. Add canary config + checker command:

    node src/cli.js check-source-canaries

4. Verify enabled-source contract + health outputs:

    node src/cli.js check-source-contracts --window 3 --min-coverage 0.7

5. Run live capture sweep in a single bridge session and validate UI:

    node src/cli.js capture-all-live --force-refresh

Expected command outcomes will be recorded here as implementation proceeds.

## Validation and Acceptance

Acceptance is met when all of the following are true:

- A deliberately malformed capture run is quarantined and excluded from normal ingest by default.
- `check-source-contracts` and new health outputs identify degraded/failing sources with explicit reasons.
- Canary checker reports pass/fail per source and writes diagnostics for failed canaries.
- Dashboard source rows show non-blocking degradation indicators and last-known reason.
- Enabled in-scope sources can still be captured/imported without workflow interruption when one source degrades.

## Idempotence and Recovery

Quality history and quarantine writes are append-safe and deduped by source + captured timestamp. Re-running capture/health commands should not duplicate identical entries. If a bad threshold causes excessive quarantine, recovery is to tune threshold config and re-run `check-source-contracts` / `sync` with explicit override only for validated runs.

No destructive operations are required. Existing capture files remain the source of truth; guardrails only add metadata and quarantine artifacts.

## Artifacts and Notes

As milestones complete, this section will include concise transcripts for:

- failing run -> quarantined outcome
- canary mismatch diff output
- dashboard/API payload showing degraded source indicator
- before/after health score for a repaired adapter

## Interfaces and Dependencies

Implementation must introduce stable interfaces:

- `src/sources/capture-validation.js`
  - `evaluateCaptureRun(source, payload, options) -> { outcome, reasons, metrics }`
- `src/sources/source-health.js`
  - `recordSourceHealthRun(sourceId, runMetrics, options)`
  - `computeSourceHealthStatus(sourceId, options) -> { status, score, reasons }`
- `src/sources/source-canaries.js`
  - `loadSourceCanaries(path)`
  - `evaluateSourceCanaries(source, options) -> { status, checks }`

And wire these into:

- `/Users/admin/job-finder/src/cli.js` (new command + warning output)
- `/Users/admin/job-finder/src/review/server.js` (health indicator serialization)
- `/Users/admin/job-finder/src/jobs/repository.js` or associated ingest path (quarantine-aware insertion)

Revision Note (2026-03-08): Initial plan created after parser reliability milestone commit to isolate guardrail architecture and rollout from parser-specific fixes.
