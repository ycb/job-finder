# Lane B W2-04 Net-New and Refresh Delta Completion

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, every sync run will explicitly report how many records are newly discovered, updated, or unchanged instead of only reporting a single upsert total. Those delta counters will be persisted in SQLite per source/run and surfaced in both CLI sync output and dashboard source status context so users can immediately see what changed and why a refresh mattered.

## Progress

- [x] (2026-03-09 06:40Z) Created Lane B W2-04 ExecPlan from current `runSync` / `runSyncAndScore` integration points and acceptance criteria.
- [x] (2026-03-09 06:58Z) Added failing tests in `test/run-deltas.test.js` and `test/dashboard-refresh-status.test.js` to lock run-delta and UI-copy behavior.
- [x] (2026-03-09 07:06Z) Added migration + repository primitives for persisted `source_run_deltas` rows and latest-by-source lookup.
- [x] (2026-03-09 07:12Z) Wired delta computation/persistence into CLI `runSync` and dashboard `runSyncAndScore`.
- [x] (2026-03-09 07:20Z) Updated dashboard source status copy to include refresh context + run-delta counters.
- [x] (2026-03-09 07:27Z) Ran required targeted tests and full suite (`182` passing).
- [x] (2026-03-09 07:44Z) Captured Playwright smoke screenshot and updated roadmap tracker/dispatch/progress docs.

## Surprises & Discoveries

- Observation: Both CLI and dashboard implement near-duplicate sync loops (`runSync` and `runSyncAndScore`) and both must emit consistent run delta behavior.
  Evidence: `/Users/admin/job-finder/src/cli.js` `runSync` and `/Users/admin/job-finder/src/review/server.js` `runSyncAndScore`.

- Observation: The worktree had no usable runtime profile/sources config for dashboard smoke, and `config/profile.example.json` is malformed.
  Evidence: dashboard initially returned `Missing config file` and then `Invalid JSON ... line 56 column 3`; resolved by writing a local valid `config/profile.json` for smoke execution only.

## Decision Log

- Decision: Persist run deltas in SQLite using a source-scoped history table keyed by sync run id + source id.
  Rationale: This preserves per-run history while allowing fast lookup of latest counters for dashboard rendering.
  Date/Author: 2026-03-09 / Codex

- Decision: Keep delta classification logic in a dedicated module (`src/jobs/run-deltas.js`) and keep repository APIs focused on DB IO.
  Rationale: Classification rules should be unit-testable without DB side effects and reusable from CLI/dashboard sync paths.
  Date/Author: 2026-03-09 / Codex

## Outcomes & Retrospective

Delivered W2-04 end-to-end with persisted per-run deltas and UI/CLI surfacing:

- Sync paths now classify each run into `new`, `updated`, `unchanged` and persist per source/run in SQLite.
- CLI `sync` now prints explicit run delta totals.
- Dashboard sources status now shows refresh context plus run-delta counters.
- Added focused run-delta tests and extended refresh-status UI copy tests.
- Verification evidence:
  - `node --test test/run-deltas.test.js test/dashboard-refresh-status.test.js` -> pass
  - `node src/cli.js sync` -> prints `Run deltas: new=0, updated=0, unchanged=0.`
  - `npm test` -> `182` passed, `0` failed
  - Playwright smoke screenshot: `docs/roadmap/progress-merge/2026-03-09-lane-b-w2-04-playwright-smoke.png`

## Context and Orientation

`/Users/admin/job-finder/src/cli.js` contains `runSync`, which currently reports `Collected/Upserted/Pruned` totals. `/Users/admin/job-finder/src/review/server.js` contains `runSyncAndScore` with parallel ingest logic used by `/api/sync-score` and source-run endpoints. `/Users/admin/job-finder/src/jobs/repository.js` handles job upsert/prune but currently does not persist per-run delta history. `/Users/admin/job-finder/src/db/migrations.js` defines schema setup and is the correct place to add durable run-delta tables.

In this repository, a “run delta” means classification of each normalized job in a source refresh as:

- `new`: no matching prior stored job for this source/job identity.
- `updated`: matching prior job exists but one or more persisted fields changed in this run.
- `unchanged`: matching prior job exists and persisted fields are effectively the same.

## Plan of Work

Milestone 1 (tests first) adds failing tests that lock expected delta semantics, including persistence and latest-run lookup. Milestone 2 adds schema + repository support for storing per-source run counters and reading the latest counters per source. Milestone 3 wires those primitives into CLI and dashboard sync flows so each run records delta history and returns aggregate run counters. Milestone 4 updates dashboard rendering to display run delta counters alongside refresh context and updates sync feedback copy. Milestone 5 runs the required verification sequence, generates dashboard smoke evidence, and updates roadmap status docs.

## Concrete Steps

From `/Users/admin/job-finder`:

1. Add tests:

    node --test test/run-deltas.test.js
    node --test test/dashboard-refresh-status.test.js

2. Implement schema/repository/delta module and sync wiring:

    node --test test/run-deltas.test.js
    node --test test/dashboard-refresh-status.test.js

3. Verify required suite:

    npm test

4. Produce dashboard smoke artifact under `docs/roadmap/progress-merge/` and record path in merge/progress docs.

## Validation and Acceptance

Acceptance is met when:

- A sync run records persisted `new`, `updated`, and `unchanged` counters per source/run.
- CLI sync output prints run delta counters.
- Dashboard source rows show the latest run delta counters with refresh context.
- `node --test test/run-deltas.test.js` and `node --test test/dashboard-refresh-status.test.js` pass.
- Full `npm test` passes.

## Idempotence and Recovery

Run-delta persistence is append-only and keyed by run id + source id, so rerunning sync adds new history rows without mutating prior evidence. If migration issues appear, recovery is to remove the temporary test database and re-run migrations; production data is unaffected because migration changes are additive tables/indexes only.

## Artifacts and Notes

Evidence captured:

- Targeted tests:
  - `node --test test/run-deltas.test.js test/dashboard-refresh-status.test.js` -> pass
- CLI evidence:
  - `node src/cli.js sync` -> `Run deltas: new=0, updated=0, unchanged=0.`
- Full suite:
  - `npm test` -> `182` pass, `0` fail
- Smoke artifact:
  - `docs/roadmap/progress-merge/2026-03-09-lane-b-w2-04-playwright-smoke.png`

## Interfaces and Dependencies

Implementation will add/extend these interfaces:

- `src/jobs/run-deltas.js`
  - `classifyRunDeltas({ existingRows, incomingJobs }) -> { newCount, updatedCount, unchangedCount }`
  - `buildStoredJobSignature(row)` (internal helper for deterministic comparisons)
- `src/jobs/repository.js`
  - `listSourceJobsForDelta(db, sourceId)`
  - `recordSourceRunDeltas(db, deltaRows)`
  - `listLatestSourceRunDeltas(db)`
- `src/db/migrations.js`
  - Add run-delta history table(s) and index(es).
- `src/cli.js` and `src/review/server.js`
  - Integrate run-delta classification, persistence, aggregate counters, and output payload fields.

Revision Note (2026-03-09): Initial Lane B W2-04 ExecPlan created from handoff packet `docs/roadmap/task-packets/2026-03-09-phase1-1-parallel-handoffs.md` with concrete file-level integration path.
Revision Note (2026-03-09): Updated after implementation completion with final decisions, verification evidence, and smoke artifact path.
