# Source Table Semantics and Identity Reliability

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the Sources table becomes a trustworthy explanation of what the product actually did with each source. `Found` will mean raw candidates that entered the shared scoring funnel, `Filtered` will mean jobs rejected by the user’s required search criteria, `Dupes` will mean true duplicate opportunities collapsed by stable job identity, and `Imported` will mean surviving queue candidates.

This plan also fixes `YC Jobs` identity so duplicate counts stop being polluted by company-page collisions. The observable result is that a user can look at the Sources table and trust that the numbers add up and correspond to the job queue they are reviewing.

## Progress

- [x] Create the v2 source-table semantics persistence model in `source_run_deltas` and stop using legacy pre-import cleanup metrics as the public source-row truth.
- [x] Compute v2 per-run metrics from the shared evaluation and identity funnel in both sync entrypoints.
- [x] Fix `YC Jobs` canonical URL and stable identity so duplicate counts reflect job-level opportunities instead of company pages.
- [x] Rebuild source-row aggregation and UI presentation so legacy-only runs show `—` and v2 runs add up as `Found = Filtered + Dupes + Imported`.
- [x] Add regression coverage for migrations, aggregation, YC identity, and v2 source-row behavior.
- [x] Re-run affected sources in the QA checkout so the table displays trustworthy v2 counts.

## Surprises & Discoveries

- Observation: the current Sources table is not merely sparse; it is semantically wrong. `Indeed` shows `Filtered` because extractor junk cleanup is persisted there, while `LinkedIn`, `ZipRecruiter`, and other sources show zero filtered even though the DB contains hard-filtered and reject-bucket rows for them.
  Evidence: `/Users/admin/job-finder/data/jobs.db` currently shows `linkedin-live-capture` with `20` hard-filtered rows and `zip-ai-pm` with `12` hard-filtered rows, while the Sources table shows `0` filtered for both.

- Observation: `YC Jobs` duplicate counts are inflated by identity collisions, not healthy cross-source dedupe.
  Evidence: the current adapter canonicalizes to company pages like `https://www.workatastartup.com/companies/<slug>`, so multiple distinct jobs from the same company collapse to one identity.

- Observation: the first pass at v2 duplicate accounting still miscounted same-source reruns as dupes because it compared against all previously known normalized hashes rather than hashes from other sources only.
  Evidence: after the initial v2 rollout, fresh reruns produced rows like `levelsfyi-ai-pm|26|0|26|0` and `zip-ai-pm|13|0|13|0`, which made `Imported` collapse to zero even though those sources still had valid queue candidates.

- Observation: once duplicate accounting was fixed, the live table still showed inflated counts because old broken v2 rows were being summed with corrected rows.
  Evidence: `/api/dashboard` still showed `YC Jobs|90|0|14|76` and `Levels.fyi|78|0|26|52` until a semantics-version column was added and the public aggregation was gated to the corrected version only.

## Decision Log

- Decision: user-facing `Filtered` will mean evaluation hard-filter rejection only.
  Rationale: extractor cleanup and malformed-row rejection are source-maintenance diagnostics, not evidence that the user’s search criteria were applied.
  Date/Author: 2026-03-30 / Codex

- Decision: user-facing `Dupes` will mean duplicate opportunities collapsed by stable job identity only.
  Rationale: the source table exists to explain queue quality, so identity collisions caused by weak canonical URLs must be fixed rather than reported as healthy dedupe.
  Date/Author: 2026-03-30 / Codex

- Decision: legacy source-run rows will not be backfilled with guessed v2 semantics.
  Rationale: the Sources table must prefer unknown over misleading. Sources only become trustworthy again after one fresh run under the corrected model.
  Date/Author: 2026-03-30 / Codex

- Decision: same-source reruns do not count as user-facing dupes.
  Rationale: the Sources table should explain duplicate opportunities polluting the queue, not the fact that a source returned its own previously known jobs on a later refresh.
  Date/Author: 2026-03-30 / Codex

- Decision: public source metrics are versioned, and the Sources table only reads the current semantics version.
  Rationale: once the metric meaning changed, continuing to sum older broken rows with corrected rows would have kept the UI misleading even after the code fix.
  Date/Author: 2026-03-30 / Codex

## Outcomes & Retrospective

Implementation complete in the controller worktree and verified in the QA checkout at `http://127.0.0.1:4311`.

Final implementation notes (2026-03-30):
- `YC Jobs` now uses job-level URLs for canonical review/identity.
- v2 public source metrics are persisted separately from legacy pre-import diagnostics.
- duplicate accounting now compares against other sources and same-run repeats only, not the source’s own historical rows.
- public aggregation is gated by `semantics_version = 2`, so stale broken rows no longer pollute the table.

Live QA verification after a fresh `node src/cli.js sync` in `/Users/admin/job-finder`:
- `LinkedIn|18|0|2|16`
- `Built In|0|0|0|0`
- `Indeed|4|0|0|4`
- `ZipRecruiter|13|0|0|13`
- `YC Jobs|30|0|0|30`
- `Levels.fyi|26|0|0|26`

These rows now reflect only the corrected semantics-versioned runs instead of mixed legacy/broken totals.

## Context and Orientation

The review and sync pipelines currently persist per-source run metrics in SQLite `source_run_deltas`. That table lives behind `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/repository.js`, and the schema is created in `/Users/admin/.codex/worktrees/51f6/job-finder/src/db/migrations.js`. Source rows are assembled in `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js` and rendered in the React searches UI through `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/web/src/features/searches/logic.js`.

Today, the system mixes two incompatible meanings:

- legacy `filtered_count` / `deduped_count` reflect whatever pre-import funnel a source happened to persist
- imported totals are derived from current persisted rows or old run totals

That is why the table currently implies that only `Indeed` filters jobs and only `YC Jobs` finds dupes, even though the evaluation data in `jobs.db` proves otherwise.

`YC Jobs` adds a second problem. Its adapter in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/yc-jobs.js` currently points job URLs at company pages, so stable identity collapses multiple jobs into the same opportunity. That pollutes duplicate counts and undermines review targets.

## Plan of Work

First, extend `source_run_deltas` with v2 user-facing metrics. In `/Users/admin/.codex/worktrees/51f6/job-finder/src/db/migrations.js`, add nullable integer columns:

- `raw_found_count`
- `hard_filtered_count`
- `duplicate_collapsed_count`
- `imported_kept_count`

Keep the existing `found_count`, `filtered_count`, `deduped_count`, and `imported_count` columns unchanged for legacy/internal compatibility. In `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/repository.js`, update `recordSourceRunDeltas`, `listLatestSourceRunDeltas`, and `listSourceRunTotals` so these v2 fields are written and aggregated. `listSourceRunTotals` must aggregate only v2 fields into the user-facing totals and expose a boolean-or-sample signal that tells the server whether a source has any trustworthy v2 runs.

Second, add one shared helper that computes v2 metrics from the same funnel in both sync entrypoints. Put this helper in `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/run-deltas.js` so both `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js` and `/Users/admin/.codex/worktrees/51f6/job-finder/src/cli.js` can reuse it. The helper must accept:

- the normalized jobs for a source run
- the evaluation results for those jobs
- a set of normalized hashes already known before this run

and return:

- `rawFoundCount`
- `hardFilteredCount`
- `duplicateCollapsedCount`
- `importedKeptCount`
- the set of kept normalized hashes to merge into the global seen-hash set for later sources in the same run

`rawFoundCount` must equal the number of normalized jobs entering the shared funnel. `hardFilteredCount` must count `evaluation.hardFiltered === true`. `duplicateCollapsedCount` must count non-hard-filtered jobs whose normalized hash already existed in the global seen-hash set or was already kept earlier in the same run. `importedKeptCount` must count the remaining jobs.

Third, wire the helper into both sync pipelines. In `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js` and `/Users/admin/.codex/worktrees/51f6/job-finder/src/cli.js`, compute per-source evaluations immediately after normalization, before upserting jobs. Seed a `knownNormalizedHashes` set once from the pre-run DB and update it with the helper’s kept hashes as sources are processed. Continue upserting normalized jobs so refresh behavior is preserved, but write the source-table metrics from the v2 helper rather than from `rawJobs.length` or the old capture funnel fallback.

Fourth, fix `YC Jobs` identity. In `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/yc-jobs.js`, stop emitting company pages as the primary job URL. If the source payload contains a numeric job id, emit:

    https://www.workatastartup.com/jobs/<job-id>

Use that job URL as the canonical review target and as the identity input. Keep company page URLs only as supplemental metadata if useful. In `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/normalize.js`, ensure YC jobs infer `externalId` and canonical `sourceUrl` from the job page, not the company page. If a job id is missing, fall back to a job-level seed built from company, title, and location rather than a company page URL.

Fifth, rebuild source-row aggregation and presentation. In `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`, source rows must use only the v2 totals for public `Found`, `Filtered`, `Dupes`, and `Imported`. If a source has no v2 runs yet, all four values must be `null` so the UI renders `—`. Do not mix current persisted row counts with v2 source-run totals. In `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/web/src/features/searches/logic.js`, keep the current `—` presentation for unknown metrics and ensure totals also become unknown if any visible source lacks v2 totals.

Finally, re-run the affected sources in `/Users/admin/job-finder` on `qa/current` so the live table has one trustworthy v2 run for each MVP source. At minimum:

- `LinkedIn`
- `Indeed`
- `ZipRecruiter`
- `Levels.fyi`
- `YC Jobs`

The point is not merely to pass tests; it is to verify that the live QA branch shows additive counts and that `YC Jobs` no longer inflates dupes through company-page identity collapse.

## Concrete Steps

From the repository root `/Users/admin/.codex/worktrees/51f6/job-finder`, implement and verify in this order:

    node --test test/run-deltas.test.js test/normalize-dedupe.test.js test/review-searches-react-logic.test.js

Then run:

    node --test test/yc-capture.test.js test/review-source-data-quality.test.js test/dashboard-api-contract.test.js

Then run:

    npm run dashboard:web:build

After the worktree tests pass, fold the controller branch into the QA checkout at `/Users/admin/job-finder`, restart QA, and run fresh source captures plus sync. The exact live commands belong in the execution transcript once implementation is done, but the expected pattern is:

    npm run review:stop
    node src/cli.js capture-source-live <source-id>
    node src/cli.js sync
    npm run review:qa

## Validation and Acceptance

Acceptance is satisfied when all of the following are true:

- For any source with at least one v2 run, the Sources table shows `Found = Filtered + Dupes + Imported`.
- `LinkedIn` and `ZipRecruiter` no longer show `0` filtered if the underlying run produced hard-filter rejects.
- `Indeed` filtered counts reflect hard-filter rejection, not salary/career cleanup.
- `YC Jobs` duplicate counts fall because job identity is now job-level rather than company-page-level.
- Any source without a fresh v2 run shows `—` for `Found`, `Filtered`, `Dupes`, and `Imported`.
- The totals row follows the same rule and does not silently combine legacy and v2 semantics.

## Idempotence and Recovery

The migration is additive. Adding the new `source_run_deltas` columns is safe to run multiple times because `addColumnIfMissing` already guards repeated application.

If a fresh QA run still shows bad source counts, inspect the most recent `source_run_deltas` rows before changing UI code. The first debugging question after this plan lands should always be: “Did this source produce v2 metrics for the latest run?” not “Can the UI mask the mismatch?”

## Artifacts and Notes

The most important artifacts after implementation should be:

- a new ExecPlan at this path
- updated regression tests proving v2 aggregation and YC identity
- a live `/api/dashboard` snapshot from `qa/current` where:

    Found = Filtered + Dupes + Imported

for each source that has been re-run under the new model

## Interfaces and Dependencies

The following interfaces must exist when this work is complete:

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/run-deltas.js`
  - exported helper that computes v2 source-run metrics from normalized jobs, evaluations, and known normalized hashes

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/repository.js`
  - `recordSourceRunDeltas` accepts and persists v2 metrics
  - `listSourceRunTotals` returns v2 aggregated totals and sample/trust signals

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/yc-jobs.js`
  - emits job-level YC URLs and ids for canonical review/identity

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`
  - source rows use only v2 metrics for public `Found`, `Filtered`, `Dupes`, and `Imported`

Revision note (2026-03-30): Created after live QA proved that the existing Sources table mixed extractor cleanup, identity collisions, and current-row counts into misleading public metrics. This plan intentionally treats that as a data-semantics bug, not a presentation bug.
