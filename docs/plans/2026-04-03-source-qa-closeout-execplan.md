# Source QA Closeout ExecPlan

> Maintain this document in accordance with `/Users/admin/job-finder/PLANS.md`.

## Purpose / Big Picture

JobFinder is supposed to run one search and return a trustworthy, simplified set of opportunities across sources. The current QA feedback shows that this promise is still not met consistently: some sources still build the wrong search, some sources appear not to run, the source table mixes cumulative accounting with the current queue in a confusing way, and one run can appear to load a source more than once. After this plan is complete, a user will be able to run a search in QA, see each enabled source trigger once, inspect a source table whose latest-run deltas align with the queue semantics, and trust that each MVP source is either searching with the intended native query or failing honestly.

The visible proof is a fresh `Run search` in QA at `http://127.0.0.1:4311` using the active search:

- title: `Product manager`
- hard include: `ai`
- location: `San Francisco, CA`
- salary floor: `$200,000`
- date posted: `Past 3 days`

The run is successful only when the latest-run source deltas and the queue output are coherent, and each source either shows the expected native search behavior or an explicit, truthful failure state.

## Progress

- [ ] (2026-04-03 03:15Z) Add hardening observability for source capture so each run records actual URLs, live filter state, pagination trace, trigger start/finish/failure, and explicit blocked/challenged states.
- [ ] Reproduce the current QA defects from one fresh live run and capture a per-source evidence pack (screens, URLs, capture files, telemetry, and latest-run API payload).
- [ ] Fix duplicate source triggering so each enabled source is loaded at most once per `run-all` batch and per single-source run.
- [ ] Fix queue/accounting mismatch so `Imported`, `New`, and `Unread` reflect the same latest-batch semantics and do not imply missing jobs.
- [ ] Fix `YC Jobs` native query construction to use the browser/app-state route that actually reflects the search field (`query=ai`) and role filter (`role=product`) instead of the current `/jobs/l/product-manager?...` URL.
- [ ] Review and fix `Built In` source parity if the low-yield import is due to wrong query construction or extraction loss rather than true scarcity.
- [ ] Review and fix `LinkedIn` filtering semantics if `68 found / 59 filtered` is caused by scoring/hard-filter drift rather than the user’s active criteria.
- [ ] Fix `Levels.fyi` triggering/visibility so the source actually runs in QA and produces fresh evidence, or fail it honestly if it cannot run.
- [ ] Re-run a full live QA search, record all artifacts, and update `docs/roadmap/progress-daily/2026-04-03.md` with the verified outcomes.

## Surprises & Discoveries

- Observation: Prior QA work mixed source-specific debugging with shared run-accounting problems, which made the source table and queue behavior hard to reason about.
  Evidence: one QA run reported `Imported +42` in the source table while the queue showed `New (24)`, and several source rows still reflected cumulative state rather than the latest batch.

- Observation: Indeed base query construction is now fixed, but the source still needs a fresh QA pass under the corrected native parity path before it can be considered closed.
  Evidence: `/Users/admin/job-finder/data/captures/indeed-ai-pm.json` from `2026-04-03T02:19:25.609Z` shows `pageUrl=https://www.indeed.com/jobs?q=Product+manager+ai&l=San+Francisco%2C+CA&radius=0&salaryType=%24200%2C000%2B&fromage=3` with `captureDiagnostics` confirming pay/date/distance parity.

- Observation: `YC Jobs` is not a normal static URL source; the logged-in page exposes app-state filters and search results that are richer than the current builder path.
  Evidence: live inspection previously showed `data-page.props.currentRole = "product"` and a search UI with `query`, `role`, `location`, and `remote` controls, while the current URL still used `/jobs/l/product-manager?...`.

## Decision Log

- Decision: Treat this as one QA closeout track instead of a series of isolated source fixes.
  Rationale: the user’s latest feedback combines source-specific regressions with shared orchestration and accounting defects; fixing them independently hides root causes.
  Date/Author: 2026-04-03 / Codex

- Decision: Make observability the first implementation track in this plan.
  Rationale: browser observation has repeatedly outperformed our logs; until per-source capture telemetry is hardened, the remaining source and accounting bugs will keep being diagnosed by inference.
  Date/Author: 2026-04-03 / Codex

- Decision: Mark Indeed as “fixed pending QA” rather than complete.
  Rationale: builder parity and capture diagnostics are corrected, but the user has not yet validated the corrected flow end-to-end under a fresh QA run.
  Date/Author: 2026-04-03 / Codex

- Decision: Keep human-verification handling out of scope for this closeout until native search/query parity is stable.
  Rationale: the user explicitly asked to defer challenge handling and focus on whether the product is constructing the right searches and extracting the right jobs.
  Date/Author: 2026-04-03 / Codex

## Outcomes & Retrospective

This section must be updated after implementation. The expected outcome is a single QA search whose per-source latest-run evidence matches what the user saw in the browser, with no duplicate source triggers and no unexplained mismatch between source imports and queue cohorts.

## Context and Orientation

The work spans shared search orchestration, source query construction, and the source table/queue relationship.

Relevant files and roles:

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`
  Runs `run-all`, exposes the dashboard API, and assembles source rows and queue payloads.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/web/src/App.jsx`
  Renders the source table, queue counts, and filters in the QA UI.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/web/src/features/searches/logic.js`
  Computes source-row latest-run deltas and other search UI model state.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/run-deltas.js`
  Defines the persisted semantics for `Found`, `Filtered`, `Dupes`, and `Imported`.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/repository.js`
  Aggregates source-run metrics and queue/job state from SQLite.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/search-url-builder.js`
  Maps JobFinder search criteria into source-native URLs for sources that use URL construction.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/yc-jobs.js`
  Contains the current YC source implementation, which still assumes the wrong URL shape.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/indeed-jobs.js`
  Contains the Indeed search-specific helper logic and capture diagnostics.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`
  Executes live browser capture for LinkedIn, Indeed, YC, and other browser-driven sources.

- `/Users/admin/job-finder/data/captures/*.json`
  Fresh capture artifacts in the QA checkout. These are the primary source of truth for whether a source actually searched the intended page.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`
  The main browser-driven capture layer. This is the first place that must emit richer telemetry for source runs.

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/cache-policy.js`
  Persists capture payloads and diagnostics. It already supports `captureDiagnostics` and is the right place to standardize richer telemetry payloads.

Definitions used in this plan:

- `latest-run delta`: the `+N` figures in the source table representing what the most recent successful run contributed, not lifetime totals.
- `Imported`: jobs that survived hard filtering and dedupe and were persisted for review in the current accounting model.
- `New`: jobs whose `last_import_batch_id` equals the latest completed queue-refresh batch.
- `Unread`: jobs with `first_viewed_at IS NULL`.
- `source trigger`: one live source execution within a `run-all` batch. The user expects one trigger per enabled source.

## Plan of Work

### 1. Add hardening observability first

Before changing the remaining source logic, add per-source capture telemetry so the logs become as informative as browser observation.

Required telemetry for every browser-driven source run:

- `sourceId`
- `runId`
- `triggeredAt`
- `finishedAt`
- `initialUrl`
- `visitedUrls` in order
- `finalUrl`
- `pageTitlesVisited`
- `detectedFilterState` from the live UI where applicable
- `pageCountVisited`
- `captureCountByPage`
- `stopReason`
- `status` with explicit values such as:
  - `live_success`
  - `live_failed`
  - `blocked_verification`
  - `auth_failed`
  - `unexpected_page`

Persist this telemetry in the capture artifact and expose enough of it through the dashboard/debug surfaces to explain the run without opening the browser.

Implementation should start in:

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/cache-policy.js`
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/web/src/features/searches/logic.js`

### 2. Reproduce the current QA defects from one controlled live run

Start by running one fresh live QA search from `/Users/admin/job-finder` with caching already disabled. Record:

- the browser-visible behavior for each source
- `/api/dashboard` before and after the run
- the latest capture file and telemetry for each source
- the latest `source_run_deltas` rows for each source

This evidence pack is required before changing code again, because several current complaints may share the same root cause. Save concise findings in `docs/roadmap/progress-daily/2026-04-03.md`.

### 3. Fix duplicate source triggering

Inspect the run orchestration in `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`, the CLI entrypoints, and any browser-provider loops to determine why a source appears to load multiple times. The acceptance rule is strict: during one `run-all`, each enabled source may have at most one live trigger, unless there is an explicit retry caused by a visible error state. Hidden double-loads are not allowed.

Add regression tests around the run dispatcher and, if needed, source refresh state so that one batch cannot dispatch the same source more than once.

### 4. Reconcile source-table accounting with queue semantics

The user-facing complaint is: source rows reported `Imported +42` while the queue showed `New (24)`. Fix this by making the dashboard explicit and internally consistent:

- latest-run `Imported +N` must represent jobs newly imported in the current batch
- `New` must be the count of jobs from the latest import batch after active queue gating
- if `Imported +N` and `New (M)` differ because some imported jobs are not queue-eligible, the UI must either align the semantics or show the reason explicitly

Implement the fix in:

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/repository.js`
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/web/src/features/searches/logic.js`
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/web/src/App.jsx`

The preferred outcome is semantic alignment, not explanatory copy.

### 5. Fix YC native query construction

Replace the current YC URL strategy. The current builder emits:

`https://www.workatastartup.com/jobs/l/product-manager?search=Product+manager+ai&location=San+Francisco&datePosted=3d&minSalary=200000`

The user’s required native shape is closer to:

`https://www.workatastartup.com/companies?...&query=ai&role=product&sortBy=keyword&tab=any...`

Implementation requirements:

- map JobFinder title intent into the correct YC `role` parameter
- map the hard include term (`ai`) into YC’s actual `query` search field
- preserve other unsupported fields as explicit post-capture filtering in accountability, not fake URL params
- use the browser/app-state path if the YC results page requires it to produce real filtered results

The output of `/api/dashboard` for `yc-product-jobs` must reflect the corrected URL or browser-equivalent state, and a fresh capture must show that the search input contains `ai` and the role filter is set to `Product`.

### 6. Review Built In yield and correct only if it is actually broken

Do not assume `2 imported` is a bug. Reproduce the exact Built In search and inspect:

- generated URL
- live page result count
- capture count
- filtered count
- imported count

If the source is using the wrong native search or dropping jobs in extraction, fix it. If the source truly returns only a few relevant jobs for this search, document that and leave the implementation unchanged.

### 7. Review LinkedIn filtering semantics

LinkedIn extraction is now materially fixed, but the user’s concern about `68 found / 59 filtered` still stands. Determine whether the large filtered count is caused by:

- hard-filter misclassification
- scoring bucket semantics masquerading as filtering
- or genuinely weak source-side narrowing

Use the latest LinkedIn capture and scoring output to classify the `59`. The goal is not to force the count downward; the goal is to make sure the count means what the user thinks it means. If the filtered number is semantically wrong, fix the accounting or scoring classification. If it is semantically right, record a sample explanation in the roadmap note.

### 8. Fix Levels.fyi triggering/visibility

The user did not see Levels trigger at all. Determine whether:

- the source failed silently
- the UI did not surface the trigger
- the source used stale rows from a prior run
- or the source never dispatched

Then fix the root cause. This may require adjustments in source dispatch, source status reporting, or browser/direct-fetch instrumentation. The acceptance bar is that a fresh QA search makes Levels visibly run once or explicitly fail once.

### 9. Re-run QA and record the outcome

After implementing the fixes above, run one fresh live search in QA and update this plan’s `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`. Also update `docs/roadmap/progress-daily/2026-04-03.md` with:

- latest-run source table snapshot
- queue snapshot
- per-source pass/fail against the user’s QA checklist

## Concrete Steps

Run these commands from `/Users/admin/.codex/worktrees/51f6/job-finder` unless otherwise noted.

1. Read the live dashboard state before the new QA run:

    ```bash
    curl -sS http://127.0.0.1:4311/api/dashboard > /tmp/dashboard-before.json
    ```

2. Trigger one fresh live search in the QA checkout:

    ```bash
    node /Users/admin/job-finder/src/cli.js run --force-refresh
    ```

    Expected: one batch runs, each enabled source attempts one live trigger, new capture files appear under `/Users/admin/job-finder/data/captures/`, and each browser-driven source writes telemetry that explains where it navigated and why it stopped.

3. Inspect latest source deltas and captures:

    ```bash
    sqlite3 /Users/admin/job-finder/data/jobs.db "select source_id, captured_at, raw_found_count, hard_filtered_count, duplicate_collapsed_count, imported_kept_count, semantics_version from source_run_deltas order by captured_at desc limit 20;"
    node --input-type=module -e "import fs from 'node:fs'; const p=JSON.parse(fs.readFileSync('/Users/admin/job-finder/data/captures/indeed-ai-pm.json','utf8')); console.log(JSON.stringify({pageUrl:p.pageUrl,count:p.jobs.length,captureDiagnostics:p.captureDiagnostics,telemetry:p.captureTelemetry}, null, 2));"
    ```

4. Run targeted tests after each implementation milestone:

    ```bash
    node --test test/review-run-all-resilience.test.js test/dashboard-refresh-status.test.js test/review-jobs-api.test.js
    node --test test/search-url-builder.test.js test/source-criteria-accountability.test.js test/source-url-preview.test.js
    node --test test/review-searches-react-logic.test.js test/review-jobs-react-logic.test.js test/review-jobs-react-ui-model.test.js
    ```

5. Restart QA after applying fixes to `/Users/admin/job-finder`:

    ```bash
    npm run review:stop --prefix /Users/admin/job-finder
    npm run review:qa --prefix /Users/admin/job-finder
    ```

6. Read the live dashboard state after the fix:

    ```bash
    curl -sS http://127.0.0.1:4311/api/dashboard > /tmp/dashboard-after.json
    ```

## Validation and Acceptance

This closeout is complete only when all of the following are true in a fresh QA run:

1. Every browser-driven source writes enough telemetry to explain:
   - which page it started on
   - which pages it visited
   - which filters the live UI showed
   - why it stopped

2. Each enabled source triggers once, not multiple times.
3. Indeed is still fixed:
   - it opens an AI Product Manager search
   - native parity for `$200,000+`, `last 3 days`, and `exact location only` is present
   - it does not drift into `viewjob` or `page not found`
4. Source-table latest-run accounting and queue batch semantics are coherent; `Imported +N` no longer conflicts with `New (M)` in an unexplained way.
5. YC uses a native search shape that clearly reflects:
   - `query=ai`
   - `role=product`
6. Built In either proves that `2 imported` is legitimate or is fixed so the low yield is explained.
7. LinkedIn filtering is either corrected or explained with evidence that the current filtered count is semantically accurate.
8. Levels.fyi visibly triggers once or fails honestly; it does not silently disappear.

## Idempotence and Recovery

- The QA run can be repeated safely because caching is disabled and the source table records latest-run deltas separately from cumulative totals.
- If a source is blocked by human verification, do not implement a bypass in this plan. Record the failure honestly and proceed with the remaining sources.
- If a change makes QA worse, restore the affected files from the latest good commit and re-run the targeted tests before restarting QA.

## Artifacts and Notes

Expected artifacts to capture during execution:

- `/tmp/dashboard-before.json`
- `/tmp/dashboard-after.json`
- fresh source capture files under `/Users/admin/job-finder/data/captures/`
- SQL transcript showing the latest `source_run_deltas` rows

Representative evidence to preserve in the roadmap note:

    Indeed capture diagnostics:
      pageUrl: https://www.indeed.com/jobs?q=Product+manager+ai&l=San+Francisco%2C+CA&radius=0&salaryType=%24200%2C000%2B&fromage=3
      appliedPayFilter: $200,000+
      appliedDatePostedFilter: last 3 days
      appliedDistanceFilter: exact location only

## Interfaces and Dependencies

The implementation will rely on these existing interfaces:

- `buildSourceSearchUrl(source, criteria)` in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/search-url-builder.js`
  - must produce native source URLs and criteria accountability for URL-driven sources

- `recordSourceRunDelta(...)` / source-run semantics helpers in `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/run-deltas.js`
  - must continue to define the user-facing latest-run metrics

- browser capture helpers in `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`
  - must capture per-source live evidence without hidden cache reuse

- dashboard assembly in `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`
  - must combine source rows and queue state into one truthful payload

Revision note (2026-04-03): Created this plan to consolidate the user’s latest QA feedback into one execution track. The key reason is that several remaining issues are shared run/accounting defects, not isolated source regressions.
Revision note (2026-04-03, later): Reordered the plan to make hardening observability the first track. Browser observation is currently more informative than our logs, so richer telemetry is required before the remaining source/debug work can be done efficiently.
