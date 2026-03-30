# Live-First Source QA and Honest Run Outcomes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

Stakeholder QA for source quality must measure the real thing: whether each enabled source can run live and return useful jobs for the current search criteria. After this change, the QA environment at `http://127.0.0.1:4311` will stop hiding bad source behavior behind fresh-cache reuse or a silent capture-quality quarantine gate. A source that runs badly will either ingest its real live result set or report an explicit current-run failure; it will not quietly leave stale prior metrics in place.

## Progress

- [x] (2026-03-30 16:45Z) Root-caused the latest failed run: LinkedIn captured live but was quarantined and excluded from sync; Indeed and Zip were cache-served; only Levels and YC ran live.
- [x] (2026-03-30 17:28Z) Implemented a QA-only live-run override helper and wired it through the review server, CLI refresh context, and `review:qa` startup path.
- [x] (2026-03-30 17:28Z) Removed silent quarantine blocking from the stakeholder QA path by allowing quarantine ingest whenever `JOB_FINDER_SOURCE_QA_MODE=1`.
- [x] (2026-03-30 17:29Z) Added regression coverage proving QA mode forces live capture and preserves quarantine-ingest overrides without changing non-QA behavior.
- [ ] Re-run the QA environment and verify each source's last run reflects the actual current attempt.

## Surprises & Discoveries

- Observation: the last user-visible run was a mixed batch, not a coherent all-source refresh.
  Evidence: `/Users/admin/job-finder/data/jobs.db` batch `28437644-df83-482b-8134-d2ed2200956f` contains live rows for `Levels.fyi` and `YC Jobs`, cache-served rows for `Indeed` and `ZipRecruiter`, a live zero-result row for `Built In`, and no row at all for `LinkedIn`.

- Observation: LinkedIn did capture live during that run, but the capture was quarantined before sync.
  Evidence: `/Users/admin/job-finder/data/quality/quarantine/linkedin-live-capture/2026-03-30T21-23-54-833Z-quarantine.json` records `capture volume below baseline: 8/58 (14%) < 15%`.

- Observation: ZipRecruiter still has a real query-parity issue independent of cache.
  Evidence: `/Users/admin/job-finder/data/captures/zip-ai-pm.json` shows only 4 captured jobs for `https://www.ziprecruiter.com/jobs-search?search=Product+manager+ai&location=San+Francisco&days=3&refine_by_salary=200000&page=1`, while the user's manual native search returned 14.

## Decision Log

- Decision: stakeholder QA will use a live-first source-run mode that bypasses cache.
  Rationale: cache is useful for resilience but the wrong default when validating source quality and query construction.
  Date/Author: 2026-03-30 / Codex

- Decision: stakeholder QA will not silently block ingestion on a `quarantine` outcome.
  Rationale: hidden quarantine is a trust-destroying bandaid. QA must reveal broken query construction or extraction instead of masking it behind stale source rows.
  Date/Author: 2026-03-30 / Codex

- Decision: this fix is scoped to the QA path first, not a broad redesign of all runtime source policies.
  Rationale: the immediate problem is that the approved QA environment is obscuring real source behavior. Fix that first, then revisit any global source-health policy with the user if needed.
  Date/Author: 2026-03-30 / Codex

## Outcomes & Retrospective

Pending implementation.

## Context and Orientation

The stakeholder QA environment is served from `/Users/admin/job-finder` on branch `qa/current` via `npm run review:qa`, which runs `scripts/review-qa.sh` and `scripts/review-react-watch.sh`. Source runs are orchestrated in `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`, primarily through `runAllCapturesWithOptions`, `runSourceCaptureWithOptions`, and `runSyncAndScore`. The CLI path mirrors much of the same logic in `/Users/admin/.codex/worktrees/51f6/job-finder/src/cli.js`.

A "browser capture source" is a source like LinkedIn, Indeed, or ZipRecruiter that is captured through the browser bridge rather than direct HTTP fetch. Those sources currently consult the cache policy in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/cache-policy.js`, which can return `cache_fresh` and prevent a live capture. After capture, the payload is passed through `evaluateCaptureRun` in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/capture-validation.js`. If the evaluation outcome is `quarantine`, `shouldIngestCaptureEvaluation` currently blocks sync by default.

That design is acceptable for an internal safety net, but it is not acceptable for stakeholder QA because it can make a run look successful while hiding the most important facts: whether the source ran live, whether the capture was poor, and whether the current run changed the queue.

## Plan of Work

First, add a small, explicit QA-mode switch that the QA scripts can set. The QA scripts should export an environment variable, for example `JOB_FINDER_SOURCE_QA_MODE=1`, before they launch the review server. The implementation should treat this as a stakeholder-QA override, not a general production runtime mode.

Second, change the run-all and manual-refresh API handlers in `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js` so that, when QA mode is enabled, they force live browser captures. In practice this means bypassing the cache gate by setting `forceRefresh: true` and using the more permissive live cadence profile (`probe`) rather than the default `safe` profile. The goal is that a user clicking `Run search` or `Run now` in QA is never served a `cache_fresh` result.

Third, change sync ingestion behavior so that a capture with outcome `quarantine` is not silently excluded from the stakeholder QA flow. The simplest additive path is to make `resolveAllowQuarantinedIngest` return true when QA mode is enabled, while keeping `reject` outcomes blocked. That preserves internal diagnostics while ensuring the latest live capture becomes visible in the queue and source table instead of disappearing behind stale numbers.

Fourth, add tests before implementation. One test should prove that the run-all QA path forces live capture instead of using a fresh cache decision. Another should prove that a `quarantine` outcome still ingests during QA mode. A third should prove that the normal non-QA path still preserves existing cache/quarantine behavior so this change stays scoped.

Finally, restart the QA environment, run a fresh all-source cycle from `/Users/admin/job-finder`, and inspect the latest `source_run_deltas`, refresh-state, and dashboard API. The acceptance bar is that a stakeholder can now trust that the last run reflects actual current attempts rather than a hidden mix of stale cache and quarantined captures.

## Concrete Steps

From `/Users/admin/.codex/worktrees/51f6/job-finder`, update the QA scripts and source-run handlers, then run:

    node --test test/review-run-all-resilience.test.js test/capture-validation.test.js

Add or update focused tests for the QA override behavior, then run:

    node --test test/review-run-all-resilience.test.js test/capture-validation.test.js test/dashboard-refresh-status.test.js

After code changes, verify the app still builds:

    npm run dashboard:web:build

Then in `/Users/admin/job-finder`, restart QA and run a fresh live cycle:

    npm run review:stop
    npm run review:qa

Use the UI on `http://127.0.0.1:4311` to run a search, then inspect:

    curl -s http://127.0.0.1:4311/api/dashboard
    sqlite3 /Users/admin/job-finder/data/jobs.db ".mode tabs" "select source_id, run_id, raw_found_count, hard_filtered_count, duplicate_collapsed_count, imported_kept_count, served_from, status_reason, captured_at from source_run_deltas order by id desc limit 12;"

The expected outcome is that browser sources show current-run live attempts rather than `cache_fresh`, and any poor capture is represented by current run data instead of a stale prior row.

## Validation and Acceptance

This work is complete when all of the following are true:

- In stakeholder QA, `Run search` does not silently serve `cache_fresh` for active browser sources.
- A live capture that would previously have been `quarantine` does not silently disappear from the batch; the current run is visible in the source metrics and queue behavior.
- The latest run for each source reflects the actual current attempt rather than a mixture of stale cache rows and missing quarantined rows.
- Non-QA code paths still preserve their prior behavior unless explicitly overridden.

## Idempotence and Recovery

The QA-mode environment variable is additive. If something goes wrong, removing the variable from `scripts/review-qa.sh` restores the previous behavior. The tests added here should make it safe to repeat the edits and rerun the same QA commands multiple times.

## Artifacts and Notes

The most important artifact from debugging is the LinkedIn quarantine file:

    /Users/admin/job-finder/data/quality/quarantine/linkedin-live-capture/2026-03-30T21-23-54-833Z-quarantine.json

This file proves the last run's LinkedIn capture existed but was excluded from sync, which is the core trust failure this plan fixes.

## Interfaces and Dependencies

The following interfaces must be clear at the end of this work:

- `scripts/review-qa.sh` exports a QA-mode flag used only for stakeholder QA.
- `src/review/server.js` honors QA mode in `/api/sources/run-all` and source-manual-run paths by forcing live capture semantics.
- `resolveAllowQuarantinedIngest` in both `src/review/server.js` and `src/cli.js` recognizes QA mode so `quarantine` no longer silently excludes current captures during QA.
- Tests in `test/review-run-all-resilience.test.js` and related files prove the QA override path and the normal path separately.

Revision note (2026-03-30): Created after debugging a user-visible run where LinkedIn captured live but was quarantined, while Indeed and Zip were cache-served. The point of this plan is to make stakeholder QA measure live source quality honestly instead of masking it.

Implementation note (2026-03-30): The additive implementation lives in `src/sources/qa-mode.js`. `scripts/review-qa.sh` now exports `JOB_FINDER_SOURCE_QA_MODE=1`, and the review server/CLI respect that by forcing `refreshProfile: probe`, `forceRefresh: true`, and `allowQuarantined: true` for stakeholder QA. Focused regression coverage was added in `test/source-qa-mode.test.js` and `test/review-run-all-resilience.test.js`.
