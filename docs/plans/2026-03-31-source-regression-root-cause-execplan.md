# Source Regression Root-Cause and Manual-Parity Recovery

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

Job Finder's product promise is simple: take a search the user could do manually across several job sources, run it more efficiently, and return a cleaner, higher-signal queue than the user would get by hand. That promise is currently broken. The QA environment now tells the truth about live runs, but the live runs themselves are not good enough: ZipRecruiter can show zero results while the same manual native search shows fourteen, and LinkedIn source rows are materially inconsistent with the actual capture file. After this plan is complete, the controller branch will have a source-by-source baseline proving what each source returns live, how that compares to our generated search state, and exactly which code paths regressed or remain lossy. The immediate deliverable is not a cosmetic patch. It is a trustworthy root-cause baseline and a prioritized, verified fix sequence for ZipRecruiter and LinkedIn first, then the rest of the MVP slate.

## Progress

- [x] (2026-03-31 08:42Z) Re-read `docs/learnings.md`, `PLANS.md`, and the debugging/planning skill guidance before continuing source-regression work.
- [x] (2026-03-31 08:46Z) Confirmed the controller worktree is clean and anchored on `codex/controller-source-data-quality` with upstream tracking.
- [x] (2026-03-31 08:58Z) Compared source-handling history after baseline commit `934b808`; confirmed substantial churn across `src/review/server.js`, `src/browser-bridge/providers/chrome-applescript.js`, `src/sources/search-url-builder.js`, `src/jobs/normalize.js`, and source-adapter files.
- [x] (2026-03-31 09:02Z) Confirmed the core `combineTitleAndKeywords` query compression behavior for LinkedIn/Indeed/Zip already existed at `934b808`; this means current Zip failure is not explained by one recent query-builder regression alone.
- [x] (2026-03-31 09:06Z) Confirmed the current Zip capture file contains only 4 jobs from the generated Zip search URL while the user's manual native search on the live site shows 14.
- [x] (2026-03-31 09:08Z) Confirmed the current LinkedIn capture file contains 34 jobs with `expectedCount=57` while the latest source row for the same batch shows `found=11 filtered=9 imported=2`, proving a post-capture accounting/evaluation mismatch.
- [x] (2026-03-31 18:44Z) Produced a written per-source live baseline report in `docs/analysis/2026-03-31-mvp-source-regression-baseline.md`, covering generated URLs, latest live semantic rows, and current capture artifacts for all MVP sources.
- [x] (2026-03-31 19:11Z) Traced LinkedIn's `34 captured -> 11 found -> 2 imported` mismatch to the generic source collection path. `collectJobsFromSource()` was applying `applySourceHardFilters()` before sync, so source rows were counting the post-filtered subset instead of the raw capture. Added `collectRawJobsFromSource()` and switched sync/CLI accounting to use it.
- [x] (2026-03-31 19:11Z) Confirmed a second regression vector for LinkedIn/Indeed/Zip: canonical source-library base URLs had been reduced to generic endpoints, discarding richer SF-native location/radius state that older working searches carried. Restored richer canonical defaults and builder logic that preserves the richer existing location when criteria only specifies the city name.
- [x] (2026-03-31 20:07Z) Reproduced the remaining `0 filtered` bug directly against fresh LinkedIn/Indeed/Zip captures. `buildSourceRunSemanticMetrics()` was faithfully using `evaluation.hardFiltered`, but the scorer only sets that flag for required-term and exclude-term failures. Title/location/salary/date-based rejects stay in `bucket='reject'`, so source rows were undercounting filtered jobs. Updated the semantic metric builder so user-facing `Filtered` counts all criteria-based rejects.
- [x] (2026-03-31 21:18Z) Fixed the stale capture-summary bug in `runSyncAndScore()`. The server path was still evaluating fresh raw jobs against the pre-collection summary, while `src/cli.js sync` already reread the refreshed summary after collection. Added a focused regression test for the capture-payload builder.
- [ ] Validate the live QA batch after the controller fixes land on `qa/current`, and compare the new `LinkedIn` / `ZipRecruiter` rows against their raw capture artifacts and manual-equivalent native searches.
- [ ] Add regression tests that fail if a source is declared parity-ready without matching a manual-equivalent baseline for at least the first-page count and representative top matches.

## Surprises & Discoveries

- Observation: the core query-compression behavior for several sources is older than the recent data-quality work.
  Evidence: `git diff 934b808..HEAD -- src/sources/search-url-builder.js` shows that `combineTitleAndKeywords()` now includes `hardIncludeTerms`, but the overall pattern of collapsing search intent into `Product manager ai` was already present at the baseline. This weakens the hypothesis that Zip's failure is caused solely by a recent builder regression.

- Observation: Zip's browser-capture wrapper is effectively unchanged from the last known-good baseline.
  Evidence: `git show 934b808:src/browser-bridge/providers/chrome-applescript.js | sed -n '1700,2000p'` and the current `sed -n '1983,2285p'` output show the `readZipRecruiterJobsFromChrome()` extraction loop is materially the same. That points suspicion away from the wrapper entrypoint and toward generated search state fidelity, site-state handling, or later evaluation.

- Observation: the current live Zip capture under QA is objectively too small.
  Evidence: `/Users/admin/job-finder/data/captures/zip-ai-pm.json` has `pageUrl=https://www.ziprecruiter.com/jobs-search?search=Product+manager+ai&location=San+Francisco&days=3&refine_by_salary=200000&page=1`, `jobs=4`, and titles `[Associate Director Product-AI Platform, Product Manager - Buyer Solutions, Product Manager, Multi-Cloud Growth - Google, Product Manager]`, while the user's manual native search on Zip returned 14 jobs.

- Observation: LinkedIn source-row accounting is currently inconsistent with the raw live capture.
  Evidence: `/Users/admin/job-finder/data/captures/linkedin-live-capture.json` has `expectedCount=57` and `jobs=34`, but the corresponding `source_run_deltas` row for run `61de70cf-e340-490d-9520-025c7ceeba8d` records `raw_found_count=11`, `hard_filtered_count=9`, and `imported_kept_count=2`.

- Observation: the `34 -> 11` LinkedIn collapse happens before normalization or DB upsert.
  Evidence: source collection returned `applySourceHardFilters(source, jobs).jobs` from `src/sources/linkedin-saved-search.js`, so sync never saw the full raw capture. A focused regression test now proves `collectRawJobsFromSource()` preserves the raw rows while `collectJobsFromSource()` still applies the source hard filter.

- Observation: the canonical source-library defaults had been reduced to generic search endpoints, which removed richer known-good source state for Zip/Indeed/LinkedIn.
  Evidence: `src/config/source-library.js` used plain URLs like `https://www.ziprecruiter.com/jobs-search` and `https://www.indeed.com/jobs`, while older known-good artifacts and merged progress snapshots consistently used `San Francisco, CA` plus radius state. The builder also overwrote that richer state when criteria only specified `San Francisco`.

- Observation: the QA-path honesty fixes did their job; the remaining issues are true source-quality regressions, not cache/quarantine lies.
  Evidence: latest `source_run_deltas` rows for run `61de70cf-e340-490d-9520-025c7ceeba8d` all show `served_from=live` and `status_reason=fetched_during_sync`, proving the current bad outcomes are coming from real live attempts.

- Observation: the current `Filtered` column was still semantically wrong even after raw-capture accounting was restored.
  Evidence: direct evaluation of fresh raw captures showed `LinkedIn 34 -> 19 reject`, `Indeed 24 -> 11 reject`, and `Zip 4 -> 1 reject`, but `buildSourceRunSemanticMetrics()` only counted `evaluation.hardFiltered`. Because the scorer reserves `hardFiltered=true` for required-term and exclude-term failures, normal title/location/salary/date rejects were being shown as unfiltered in the Sources table.

- Observation: `src/review/server.js` was still using stale capture metadata after fresh collection.
  Evidence: `runSyncAndScore()` read `readSourceCaptureSummary(source)` before `collectRawJobsFromSource(source)` and used that stale summary to populate `capturedAt`, `expectedCount`, and `captureFunnel`. `src/cli.js sync` had already been corrected to reread the refreshed summary after collection, so the server and CLI paths had diverged.

## Decision Log

- Decision: treat this as a regression-root-cause investigation, not a generic source-quality tweak pass.
  Rationale: the user explicitly states that Zip used to work and LinkedIn counts are implausibly low. That requires comparison against the last known-good baseline and a proof-oriented explanation of what changed.
  Date/Author: 2026-03-31 / Codex

- Decision: first-pass per-source baseline work will be performed by the controller directly, not delegated to the user.
  Rationale: the user should not be doing first-pass manual baseline discovery for source regressions. The controller must generate the source URLs, inspect the live source state, and compare capture/import outcomes before asking the user to QA fixes.
  Date/Author: 2026-03-31 / Codex

- Decision: ZipRecruiter and LinkedIn are the first fix priorities.
  Rationale: Zip shows a clear manual-vs-generated mismatch and LinkedIn has a proven capture-vs-accounting mismatch. These are more urgent than broad source-map cleanup because they directly violate the product promise.
  Date/Author: 2026-03-31 / Codex

## Outcomes & Retrospective

Pending implementation.

## Context and Orientation

The stakeholder QA environment is served from `/Users/admin/job-finder` on branch `qa/current` via `npm run review:qa`, which launches the React dashboard at `http://127.0.0.1:4311` and the browser bridge health endpoint at `http://127.0.0.1:4315/health`. Source runs are orchestrated in `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js` and mirrored in `/Users/admin/.codex/worktrees/51f6/job-finder/src/cli.js`. Search URLs are built in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/search-url-builder.js`. Browser-captured sources such as LinkedIn, Indeed, and ZipRecruiter are extracted in `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`. Normalization and dedupe identity live in `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/normalize.js`, while per-run semantic source metrics live in `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/run-deltas.js` and are aggregated in `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/repository.js`.

A "manual-equivalent baseline" in this repository means: take the actual user search criteria from `config/source-criteria.json`, generate the source-native URL or page state we send to a source, then compare that with what a human sees when running the same search natively on the live source in the browser. For each source, the minimum parity bar is: the generated search lands on the same kind of native results page as the manual search, the first-page result count is in the same ballpark, and the top few captured roles are plausibly part of the intended search. If the source requires authentication, the existing browser session in the user's real browser counts as the manual baseline environment.

A "source row mismatch" means the raw capture artifact and the Sources table disagree about what just happened. For LinkedIn, this mismatch is already proven: the capture file contains 34 rows while the latest source row says 11 found and 2 imported. That means the bug is not only query quality; it is also somewhere in the normalization, evaluation, or source-row accounting path.

## Plan of Work

First, create a durable written baseline report for all six MVP sources: LinkedIn, Built In SF, Indeed, ZipRecruiter, Levels.fyi, and YC Jobs. For each source, record the generated search URL, whether the source truly ran live in the last QA batch, the raw capture file path and row count, the top captured rows, the latest `source_run_deltas` row, and the current imported queue survivors. This report must make it obvious which part of the pipeline is underperforming: query construction, capture extraction, dedupe identity, evaluation filtering, or source-row aggregation.

Second, focus on ZipRecruiter. Trace the current generated URL and compare it to the native manual search the user showed. Determine whether the site is interpreting our generated URL differently because of location formatting, query text compression, page-parameter handling, or omitted native filters. Then inspect the capture artifact and extraction code to determine whether we are missing visible cards, mis-navigating pagination, or simply generating the wrong first-page state. The fix should be made at the earliest point that explains the mismatch. If the query state is wrong, fix the builder; if the page state is right but the extraction misses cards, fix the extractor; if both are weak, fix both and add regression coverage.

Third, focus on LinkedIn. Trace the path from the raw capture file to the latest `source_run_deltas` row. Specifically compare the 34 captured job rows in `/Users/admin/job-finder/data/captures/linkedin-live-capture.json` against the evaluation set used to compute `raw_found_count=11`, `hard_filtered_count=9`, and `imported_kept_count=2`. Determine whether rows are being dropped before normalization, collapsed by identity unexpectedly, or treated as hard-filter rejects because of later cleanup or location/title matching logic. The output must name the exact function and condition responsible for the collapse.

Fourth, after identifying the concrete regression points, implement the minimal root-cause fixes for Zip and LinkedIn and add tests that would have prevented this session's failure mode. Those tests should verify not just unit semantics, but end-to-end source expectations such as: generated URL contains the correct source-native criteria mapping, capture artifact contains at least the visible first-page cards for the fixture/manual-equivalent page, and source-row metrics are consistent with the raw capture count once evaluation is applied.

Finally, rerun the affected sources live in the QA environment and update the baseline report. The acceptance bar is not “tests pass.” It is: the source promise is materially restored. Zip should return a live result set in the same rough range as the user's manual native search for the same criteria, and LinkedIn's source row should no longer materially disagree with the capture artifact.

## Concrete Steps

Work from `/Users/admin/.codex/worktrees/51f6/job-finder` for code and plan changes unless a step explicitly says to use `/Users/admin/job-finder` for the QA checkout.

1. Record the current regression evidence.

    git log --oneline 934b808..HEAD -- src/sources/search-url-builder.js src/browser-bridge/providers/chrome-applescript.js src/review/server.js src/jobs/normalize.js src/sources/cache-policy.js src/sources/indeed-jobs.js src/sources/yc-jobs.js src/sources/levelsfyi-jobs.js
    sqlite3 /Users/admin/job-finder/data/jobs.db "select source_id, run_id, raw_found_count, hard_filtered_count, duplicate_collapsed_count, imported_kept_count, served_from, status_reason, captured_at from source_run_deltas order by rowid desc limit 18;"
    node --input-type=module - <<'EOF'
    import fs from 'node:fs';
    for (const p of ['/Users/admin/job-finder/data/captures/zip-ai-pm.json','/Users/admin/job-finder/data/captures/linkedin-live-capture.json']) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      console.log(p, data.pageUrl, data.expectedCount, (data.jobs || []).length);
    }
    EOF

2. Create or update an internal baseline artifact, likely under `docs/analysis/`, that records the above evidence per source.

3. Inspect the Zip and LinkedIn code paths with focused diffs against `934b808`.

    git diff 934b808..HEAD -- src/sources/search-url-builder.js
    git diff 934b808..HEAD -- src/browser-bridge/providers/chrome-applescript.js
    rg -n "readZipRecruiterJobsFromChrome|readLinkedInJobsFromChrome|combineTitleAndKeywords|buildSourceRunSemanticMetrics" src

4. After the root cause is identified, add failing tests first. Candidate files:
   - `test/source-zip-parity.test.js`
   - `test/source-linkedin-accounting.test.js`
   - or updates to existing source regression suites if those are already the closest fit.

5. Implement the minimal fixes, then run targeted verification.

    node --test <targeted-tests>
    node -c src/review/server.js
    node -c src/browser-bridge/providers/chrome-applescript.js
    npm run dashboard:web:build

6. Fold the pushed controller fixes into the QA checkout and re-run live source attempts from `/Users/admin/job-finder`.

    npm run review:stop
    npm run review:qa

   Then use the UI or `curl` to trigger fresh source runs and inspect:

    curl -s http://127.0.0.1:4311/api/dashboard
    sqlite3 /Users/admin/job-finder/data/jobs.db "select source_id, raw_found_count, hard_filtered_count, duplicate_collapsed_count, imported_kept_count, served_from, status_reason, captured_at from source_run_deltas order by rowid desc limit 12;"

## Validation and Acceptance

This work is complete only when all of the following are true:

- The source-by-source baseline artifact exists and names the exact generated URL/state, capture count, and imported count for every MVP source.
- ZipRecruiter no longer produces a live browser state that is materially worse than the manual native search for the same criteria. The acceptance bar is that the generated state lands on a results page in the same rough range as the user's manual search and the captured jobs are plausible.
- LinkedIn's latest source row no longer materially disagrees with the raw capture artifact. If the capture file has dozens of rows, the source row must explain that honestly through filtering and imports; it cannot collapse 34 visible rows into 11 "found" without a specific, verified reason.
- The QA environment at `http://127.0.0.1:4311` continues to run sources live-first and exposes current-run truth rather than stale cache or hidden quarantine.
- Tests exist that would have failed before these fixes and pass afterward.

## Idempotence and Recovery

This investigation is safe to repeat because it relies on additive inspection of git history, DB rows, and capture artifacts. Live re-runs in the QA checkout may refresh captures and `source_run_deltas`, which is expected. If a fix needs to be backed out, use git to revert the specific controller commit rather than manually editing the QA checkout. Preserve `/Users/admin/job-finder/config/source-criteria.json` as approved local QA configuration if the QA checkout needs to be stashed or merged.

## Artifacts and Notes

Current hard evidence to preserve:

    /Users/admin/job-finder/data/captures/zip-ai-pm.json
      pageUrl=https://www.ziprecruiter.com/jobs-search?search=Product+manager+ai&location=San+Francisco&days=3&refine_by_salary=200000&page=1
      expectedCount=undefined
      jobs=4

    /Users/admin/job-finder/data/captures/linkedin-live-capture.json
      pageUrl=https://www.linkedin.com/jobs/search/?keywords=Product+manager+ai&location=San+Francisco&f_TPR=r259200&f_SB2=9
      expectedCount=57
      jobs=34

    source_run_deltas for run 61de70cf-e340-490d-9520-025c7ceeba8d
      linkedin-live-capture|...|11|9|0|2|live|fetched_during_sync|2026-03-30T23:36:34.427Z
      zip-ai-pm|...|3|3|0|0|live|fetched_during_sync|2026-03-30T23:37:46.850Z

These examples already prove that Zip and LinkedIn need deeper regression work than the completed QA-path honesty fixes.

## Interfaces and Dependencies

The important interfaces in this plan are:

- `buildSearchUrlForSourceType()` in `src/sources/search-url-builder.js`, which turns product criteria into source-native URL/query state.
- `readLinkedInJobsFromChrome()` and `readZipRecruiterJobsFromChrome()` in `src/browser-bridge/providers/chrome-applescript.js`, which turn the live browser page into captured job rows.
- `buildSourceRunSemanticMetrics()` in `src/jobs/run-deltas.js`, which decides what user-facing `Found`, `Filtered`, `Dupes`, and `Imported` mean for a run.
- `listSourceRunTotals()` and `listLatestSourceRunDeltas()` in `src/jobs/repository.js`, which determine what the Sources table shows.

Revision note (2026-03-31): created after the user explicitly flagged that Zip used to work and LinkedIn counts were implausibly low, requiring a true regression comparison against the last known-good source-handling baseline instead of more surface-level QA.
