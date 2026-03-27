# New vs Unread Queue Semantics and MVP Source-Map Audit

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, a user can separate “what just came in” from “what I still have not reviewed.” The Jobs workspace will expose `New` as the latest completed import batch and `Unread` as jobs never opened, so queue triage becomes stable and trustworthy instead of overloading legacy `new/viewed` status semantics.

This change also makes the MVP source-map truthful. Each active MVP source will have one coherent internal story across the declared source contract, the shared query builder, the runtime criteria-accountability output, and the live site behavior. The immediate user-facing payoff is fewer misleading source-row diagnostics and a concrete prioritized fix list, with ZipRecruiter first because the current live search behavior is already proven to drift from manual results.

## Progress

- [x] (2026-03-27 21:55Z) Added persisted queue-semantics fields and legacy backfill in `src/db/migrations.js`: `jobs.last_import_batch_id` and `applications.first_viewed_at`.
- [x] (2026-03-27 22:05Z) Wired import stamping and queue hydration through `src/jobs/repository.js`, `src/review/server.js`, and `src/cli.js` so jobs carry `isNew` and `isUnread` based on persisted state instead of only `applications.status`.
- [x] (2026-03-27 22:16Z) Updated React and legacy jobs UI filtering to expose `Unread` as a first-class queue view distinct from `New`.
- [x] (2026-03-27 22:24Z) Added/updated queue-semantics regression coverage for repository, UI logic, and viewed-status transitions; targeted suite passed locally.
- [x] (2026-03-27 22:42Z) Completed the shared source-map/runtime layer for all MVP sources: `levelsfyi_search` and `yc_jobs` now have explicit shared builder branches and generic collection dispatch, and Zip/Indeed accountability now reports `hardIncludeTerms` truthfully.
- [x] (2026-03-27 22:49Z) Wrote the internal MVP source-map audit matrix and reusable source-map acceptance checklist.
- [x] (2026-03-27 22:57Z) Ran final targeted verification for queue semantics plus source-map/runtime alignment, then updated roadmap/progress/docs registry and learnings for QA handoff.
- [x] (2026-03-27 23:18Z) Incorporated controller review findings before QA: `New` now clears on the latest completed run even if imports are zero, legacy optimistic viewed-state updates mutate `isUnread/firstViewedAt`, and shared React jobs logic recognizes `Levels.fyi` and `YC Jobs` as first-class source kinds.

## Surprises & Discoveries

- Observation: the queue-semantics data model did not need a brand-new batch table because `source_run_deltas.run_id` already exists and provides a durable import-batch marker.
  Evidence: `src/review/server.js` already stamps each sync/source run with a `runId` used in per-source reporting; reusing that id avoids introducing another persistence concept.

- Observation: `levelsfyi_search` and `yc_jobs` were declared in `config/source-contracts.json` but still fell through the shared `buildSearchUrlForSourceType` default path.
  Evidence: `src/sources/search-url-builder.js` had no explicit builder or default URL branch for either source type at the start of this pass.

- Observation: ZipRecruiter was not the only active MVP source with accountability drift. Indeed also folds hard include terms into the search string without reporting that truthfully.
  Evidence: `combineTitleAndKeywords(criteria)` includes `hardIncludeTerms`, but the `indeed_search` branch only marked `title`, `keywords`, `includeTerms`, and `keywordMode` as applied in URL.

- Observation: the generic source collection path was also incomplete for the new MVP sources.
  Evidence: `src/sources/linkedin-saved-search.js` did not dispatch `levelsfyi_search` or `yc_jobs` at the start of this pass, so shared review/sync flows could not collect them even though dedicated adapters existed.

## Decision Log

- Decision: `New` is defined by the latest completed import batch, not by “never viewed.”
  Rationale: This makes `New` stable after each run and prevents old unread jobs from polluting the “what just came in” cohort.
  Date/Author: 2026-03-27 / Codex

- Decision: `Unread` is defined only by `applications.first_viewed_at IS NULL`.
  Rationale: Triage status (`applied`, `skip_for_now`, `rejected`) and read state answer different product questions and should not be conflated.
  Date/Author: 2026-03-27 / Codex

- Decision: The shared source-map audit remains internal-only for MVP, with no new user-facing novelty or support-matrix UI.
  Rationale: The immediate need is operator truth and prioritization, not exposing complex source capability metadata to users.
  Date/Author: 2026-03-27 / Codex

## Outcomes & Retrospective

Completed.

The queue model now distinguishes “what just came in” from “what I have never opened” using persisted state instead of overloading `applications.status`. The Jobs workspace can expose `New` as the latest import batch and `Unread` as never viewed, with a job able to exist in both cohorts until a later batch replaces the `New` set.

The MVP source-map layer is also materially more truthful. `levelsfyi_search` and `yc_jobs` now have explicit shared-builder support and generic collection dispatch, ZipRecruiter and Indeed no longer misreport `hardIncludeTerms`, and the source contract schema now covers the full current criteria surface instead of a legacy subset.

Late review tightened the queue semantics further: the active `New` cohort now tracks the latest completed run rather than the latest run with imports, which ensures a zero-import run correctly clears `New`. The legacy dashboard's optimistic "viewed" path now also updates `isUnread` and `firstViewedAt`, so the server-rendered fallback matches the React semantics immediately instead of waiting for a full refresh.

Verification evidence:

- `node --test test/review-jobs-react-logic.test.js test/review-jobs-api.test.js test/review-jobs-react-ui-model.test.js test/run-deltas.test.js test/source-criteria-accountability.test.js test/source-contracts.test.js test/levelsfyi-jobs.test.js`
  - `44` passing, `0` failed
- `npm run dashboard:web:build`
  - passed
- `node --test test/dashboard-api-contract.test.js test/review-source-data-quality.test.js`
  - `11` passing, `0` failed

Remaining work after this plan is not queue/source-map infrastructure. It is downstream product follow-through:

- live QA of `New` vs `Unread` behavior in the integrated branch
- follow-on source-map fixes from the prioritized audit, with ZipRecruiter first

## Context and Orientation

Queue data lives in SQLite and is accessed through `/Users/admin/job-finder/src/jobs/repository.js`. Jobs are stored in the `jobs` table and per-user review state lives in the `applications` table. Before this pass, the product largely inferred “newness” from `applications.status === "new"`, which made it impossible to distinguish “imported in the latest run” from “never opened.”

The review server lives in `/Users/admin/job-finder/src/review/server.js`. It hydrates jobs into the dashboard/API payloads used by the React frontend and the legacy server-rendered fallback. The React jobs UI lives primarily in `/Users/admin/job-finder/src/review/web/src/App.jsx` and `/Users/admin/job-finder/src/review/web/src/features/jobs/`.

The source-map runtime is split across three layers:

- `/Users/admin/job-finder/config/source-contracts.json` declares what each source claims to support.
- `/Users/admin/job-finder/src/sources/search-url-builder.js` is the shared runtime query builder used to turn product criteria into source URLs and criteria-accountability output.
- Source-specific adapters such as `/Users/admin/job-finder/src/sources/levelsfyi-jobs.js` and `/Users/admin/job-finder/src/sources/yc-jobs.js` define source-native extraction and any dedicated builder helpers.

The MVP source slate for this audit is: `linkedin_capture_file`, `builtin_search`, `indeed_search`, `ziprecruiter_search`, `levelsfyi_search`, and `yc_jobs`.

## Plan of Work

First, finish the queue-semantics implementation by making the persisted fields authoritative throughout the API and UI. The repository already stores `last_import_batch_id` and `first_viewed_at`; the remaining work in this area is verification and documentation rather than more schema changes. The UI must expose `Unread` as a separate filter and must clear `Unread` only when a job is opened, not when a later run happens.

Next, make the source-map runtime coherent for all MVP sources. In `/Users/admin/job-finder/src/sources/search-url-builder.js`, add explicit default URLs and builder branches for `levelsfyi_search` and `yc_jobs` so those source types do not fall through the generic “unsupported” path. Reuse the dedicated Levels.fyi helper from `/Users/admin/job-finder/src/sources/levelsfyi-jobs.js` rather than re-implementing its URL logic. Keep `yc_jobs` intentionally narrow: return the fixed product-manager route and mark dynamic criteria unsupported so runtime truth matches the current MVP implementation.

While editing the shared builder, fix the active accountability drift for MVP sources. ZipRecruiter and Indeed both use `combineTitleAndKeywords(criteria)`; their criteria-accountability output must mark `hardIncludeTerms` as applied in URL whenever those terms are present. If a source uses a criterion only by folding it into generic text search, record that honestly as “applied in URL” and note the lossy behavior in the audit rather than pretending it is unsupported.

Then update `/Users/admin/job-finder/config/source-contracts.json` so the contract declares the current full product criteria surface for MVP sources. Include `keywordMode`, `hardIncludeTerms`, `includeTerms`, and `excludeTerms` for the MVP sources instead of only the older narrow field set. Use the mapping modes that match real behavior: `url`, `post_capture`, or `unsupported`.

After the runtime and contract are aligned, write two internal artifacts. The first is an audit matrix under `docs/analysis/` that, for each MVP source, compares the declared contract, the shared builder behavior, the runtime accountability output, and the live-site support surface. The second is a reusable acceptance checklist under `docs/backlog-specs/` that future source work must satisfy before a new source is considered product-integrated.

Finally, run targeted tests, update `docs/learnings.md`, `docs/docs-registry.md`, and the current roadmap daily note, and capture the verification evidence in this plan.

## Concrete Steps

From the repository root `/Users/admin/job-finder` (or this worktree mirror), run:

    node --test test/review-jobs-react-logic.test.js test/review-jobs-api.test.js test/review-jobs-react-ui-model.test.js test/run-deltas.test.js

Expect the queue-semantics suite to pass with the new `Unread` view and migration coverage.

Then run:

    node --test test/source-criteria-accountability.test.js test/source-contracts.test.js test/levelsfyi-jobs.test.js

Expect the source-map suite to prove:

    - ZipRecruiter and Indeed mark hard include terms as applied in URL.
    - Levels.fyi produces a real URL instead of falling through to unsupported.
    - YC Jobs returns its fixed route with unsupported dynamic criteria.
    - source contracts load for all MVP source types.

Finally run:

    npm run dashboard:web:build

Expect the React build to succeed with the new `Unread` view and no source-map regressions.

## Validation and Acceptance

Acceptance for queue semantics:

- After a successful import run, the dashboard/API payload includes a `queueMeta.currentImportBatchId`.
- Jobs imported in that batch have `isNew === true`.
- Jobs never opened have `isUnread === true`.
- Opening a job clears `Unread` immediately but does not remove it from `New` until a later completed import batch replaces the cohort.
- The Jobs UI exposes separate `New` and `Unread` filters.

Acceptance for source-map/runtime alignment:

- `buildSearchUrlForSourceType("levelsfyi_search", criteria)` returns a real Levels.fyi search URL and truthful accountability.
- `buildSearchUrlForSourceType("yc_jobs", criteria)` returns the fixed YC product-manager route and marks dynamic criteria unsupported.
- `buildSearchUrlForSourceType("ziprecruiter_search", criteria)` and `buildSearchUrlForSourceType("indeed_search", criteria)` both report `hardIncludeTerms` truthfully when those terms are folded into the query text.
- `config/source-contracts.json` loads successfully and includes the full declared criteria surface for all MVP sources.
- The internal audit document exists and contains a prioritized fix list with ZipRecruiter first.

## Idempotence and Recovery

The migration changes are additive and safe to run multiple times. The queue backfill only touches rows with missing `last_import_batch_id` or `first_viewed_at`, so rerunning the app will not overwrite newer data.

If a test fails after a partial source-map edit, rerun only the relevant suite first (`test/source-criteria-accountability.test.js` or `test/source-contracts.test.js`) before broadening the verification scope. If the shared builder and source contract diverge, prefer fixing the runtime truth first and then updating the contract to match, not the other way around.

## Artifacts and Notes

Expected evidence snippets after completion should include a passing transcript similar to:

    $ node --test test/source-criteria-accountability.test.js test/source-contracts.test.js test/levelsfyi-jobs.test.js
    ...
    # tests 12
    # pass 12
    # fail 0

and:

    $ node --test test/review-jobs-react-logic.test.js test/review-jobs-api.test.js test/review-jobs-react-ui-model.test.js test/run-deltas.test.js
    ...
    # pass <N>
    # fail 0

## Interfaces and Dependencies

The following repository interfaces must exist at the end of this work:

- `src/jobs/repository.js`
  - `upsertJobs(db, jobs, { lastImportBatchId })`
  - `getLatestImportedRunId(db)`

- `src/review/server.js`
  - queue hydration that emits `isNew`, `isUnread`, `lastImportBatchId`, and `firstViewedAt`

- `src/review/web/src/features/jobs/logic.js`
  - view selection logic that supports `all`, `new`, `unread`, and `best_match`

- `src/sources/search-url-builder.js`
  - explicit `levelsfyi_search` and `yc_jobs` branches
  - truthful criteria-accountability for ZipRecruiter and Indeed hard include terms

- `config/source-contracts.json`
  - contract entries for all MVP sources that declare the current supported criteria surface, not just a subset

Revision note (2026-03-27): Created this ExecPlan after queue-semantics implementation had already started because the work crossed the non-trivial feature threshold and now includes shared source-map/runtime alignment plus internal audit deliverables.
