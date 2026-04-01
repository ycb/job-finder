# LinkedIn Extraction Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

LinkedIn is currently failing at the exact thing the product needs most: harvesting the search results page reliably enough to build a useful queue. The user can see dozens of jobs in the native LinkedIn search, but our extractor is only importing a small unstable subset because it still depends on passive scrolling of a virtualized results list. After this change, LinkedIn capture will traverse search rows deterministically, skip blank placeholders honestly, stay on the search results page, and import summary-card data without depending on full job-description extraction.

## Progress

- [x] (2026-04-01 17:16Z) Re-read the active source-regression ExecPlan, `docs/learnings.md`, and the current LinkedIn Chrome provider/tests before implementation.
- [x] (2026-04-01 17:28Z) Created this dedicated LinkedIn refactor ExecPlan and recorded the explicit backlog deferral for full JD extraction in `docs/backlog-specs/p1-core-full-jd-pass.md`.
- [x] (2026-04-01 17:34Z) Added failing tests for hydrated row snapshots, placeholder skipping, and LinkedIn capture diagnostics in `test/linkedin-chrome-extraction.test.js`.
- [x] (2026-04-01 17:43Z) Refactored LinkedIn extraction in `src/browser-bridge/providers/chrome-applescript.js` to row-snapshot finalization and summary-card-first capture persistence.
- [~] (2026-04-01 17:48Z) Targeted tests and build checks are green. Live verification is partially complete: a QA-bridge run captured `24` LinkedIn jobs, but direct controller-side verification is still blocked by bridge/cwd ambiguity and a long-running local AppleScript path.

## Surprises & Discoveries

- Observation: the last broad “good enough” LinkedIn run was still only `36 captured -> 14 imported`; import yield was never close to capture count.
  Evidence: `source_run_deltas` row for run `7adbe9b5-979c-445e-85a7-59ac3e4d0c69` records `raw_found_count=36`, `hard_filtered_count=22`, `imported_kept_count=14`.

- Observation: the current blocker is row hydration, not just pagination or `similar-jobs` drift.
  Evidence: live DOM probes showed many `li[data-occludable-job-id]` rows with empty `innerText`/`innerHTML`, and scrolling changed the container position without rotating in newly hydrated readable rows.

- Observation: an existing bridge server can silently validate the wrong checkout.
  Evidence: `node src/cli.js capture-source-live linkedin-live-capture` reported `24` captured jobs but wrote `/Users/admin/job-finder/data/captures/linkedin-live-capture.json`, not this worktree's `data/captures/linkedin-live-capture.json`, because the long-running bridge process was already serving the QA checkout.

## Decision Log

- Decision: MVP LinkedIn import will be summary-card-first.
  Rationale: summary cards contain enough data for Job Finder import and first-pass review. Full JD extraction is higher-risk, slower, and not required to restore the product promise.
  Date/Author: 2026-04-01 / Codex

- Decision: LinkedIn detail-pane reads remain optional enrichment only when the pane’s job id exactly matches the active row id.
  Rationale: stale or mismatched detail-pane text has already caused false hard-filter rejects and polluted persisted rows.
  Date/Author: 2026-04-01 / Codex

## Outcomes & Retrospective

Implementation is complete for the summary-card-first LinkedIn refactor in the controller worktree. The extraction tests and build checks pass, and the capture path now finalizes row snapshots into stable jobs with placeholder and detail-mismatch diagnostics. The remaining gap is live verification in the same checkout as the changed provider code; the current QA bridge can still route browser-capture verification through `/Users/admin/job-finder`, so final acceptance requires either folding the controller branch into `qa/current` or forcing a worktree-local bridge instance before claiming live parity.

## Context and Orientation

The LinkedIn browser capture path lives in `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`. The function `captureLinkedInSourceWithChromeAppleScript()` calls `readLinkedInJobsFromChrome()`, which currently paginates LinkedIn search pages and repeatedly scrolls the results pane while scraping visible cards. That strategy used to be barely sufficient, but the current LinkedIn results list is heavily virtualized: many rows exist in the DOM as placeholders with no readable text. The previous bugfixes already solved three separate problems: drifting into `similar-jobs`, stale detail-pane contamination, and overshooting to `start=50`. The remaining problem is that our extractor still assumes passive scroll will expose enough readable rows. It no longer does.

The LinkedIn capture file is written by `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/linkedin-saved-search.js`. The current write path accepts a list of jobs and optional metadata like `pageUrl` and `expectedCount`. It does not yet persist richer LinkedIn diagnostics. The cleanup rules used by capture persistence live in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/linkedin-cleanup.js`.

The relevant tests today are `/Users/admin/.codex/worktrees/51f6/job-finder/test/linkedin-chrome-extraction.test.js` and `/Users/admin/.codex/worktrees/51f6/job-finder/test/linkedin-capture-pagination.test.js`. They already cover salary plausibility, stale detail-id provenance, valid search URL guards, and pagination helpers. They do not yet cover placeholder-row skipping or row-snapshot finalization.

## Plan of Work

First, add a small LinkedIn-only snapshot finalization layer in the Chrome provider. The browser-side script should return “row snapshots” rather than directly assuming every seeded DOM node is a usable job. A row snapshot is a plain object containing the row id, the card fields we could read, and any bounded detail-pane hints gathered for that row. A second helper in Node should turn those snapshots into final LinkedIn jobs and diagnostics. This split keeps the DOM-specific behavior in the browser script while giving us a pure function we can test with fixtures.

Second, replace the current seed-building and scroll-loop model with deterministic row traversal. For each LinkedIn page, enumerate row ids from `li[data-occludable-job-id]`, scroll each row into view directly, retry hydration for a bounded number of attempts, and capture only rows whose title text actually appears for that row id. If a row stays blank, count it as a missed placeholder and move on. Do not use whole-page anchor scans as the primary source of truth anymore.

Third, keep the existing search-context guards and provenance rules. The refactor must remain on `/jobs/search/` URLs, must not rely on `similar-jobs`, and must reject detail text unless the detail pane resolves to the same job id as the active row. Pagination should continue to page 2 when warranted, but it must stop before empty terminal pages and use the actual hydrated yield of the current page as part of the stop condition.

Fourth, explicitly keep full JD extraction out of this change. For LinkedIn, skip the generic post-capture detail-enrichment pass so MVP import depends only on summary-card data plus same-job detail hints already gathered in the live search page. Record a backlog follow-up for full JD extraction as optional enrichment after capture stability is restored.

## Concrete Steps

1. In `/Users/admin/.codex/worktrees/51f6/job-finder`, add this ExecPlan and update the existing backlog note in `docs/backlog-specs/p1-core-full-jd-pass.md` to state that full JD extraction is deferred until after LinkedIn summary-card stability is restored.

2. Add failing tests in:

   - `/Users/admin/.codex/worktrees/51f6/job-finder/test/linkedin-chrome-extraction.test.js`
   - `/Users/admin/.codex/worktrees/51f6/job-finder/test/linkedin-capture-pagination.test.js`

   The new tests must verify:

   - a mixed fixture of hydrated row snapshots and placeholder snapshots finalizes into jobs for hydrated rows only
   - diagnostics include `missedPlaceholderCount` and `missedPlaceholderJobIds`
   - mismatched detail ids do not populate description/detail-derived fields
   - pagination helpers still reject invalid search URLs and terminal pages

3. Refactor `src/browser-bridge/providers/chrome-applescript.js`:

   - add LinkedIn snapshot finalization helpers outside the browser-script string
   - rewrite `buildExtractionScript()` so it:
     - enumerates result rows in order
     - scrolls each row into view directly
     - waits for bounded hydration retries
     - emits row snapshots plus diagnostics
   - simplify `harvestLinkedInPageJobs()` to collect page payloads rather than repeated generic scroll attempts
   - keep `buildLinkedInPageUrl()`, `shouldFetchLinkedInPage()`, `shouldContinueLinkedInPagination()`, and `isLinkedInSearchResultsUrl()` behavior intact unless the tests prove a necessary change

4. Update `captureLinkedInSourceWithChromeAppleScript()` so LinkedIn writes the finalized summary-card jobs directly and skips the generic full-detail enrichment pass for this source.

5. Persist capture diagnostics in the LinkedIn capture payload by extending `writeLinkedInCaptureFile()` in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/linkedin-saved-search.js`.

6. Run targeted verification from `/Users/admin/.codex/worktrees/51f6/job-finder`:

   - `node --test test/linkedin-chrome-extraction.test.js test/linkedin-capture-pagination.test.js`
   - `node -c src/browser-bridge/providers/chrome-applescript.js`
   - `node -c src/sources/linkedin-saved-search.js`
   - `npm run dashboard:web:build`

7. Run a live LinkedIn QA capture from the QA checkout (`/Users/admin/job-finder`) after folding the controller changes:

   - `npm run review:stop`
   - `npm run review:qa`
   - trigger LinkedIn from `http://127.0.0.1:4311` or use the equivalent CLI/source endpoint

   Verify that the run remains on search URLs, reaches page 2 when needed, does not overshoot to `start=50`, and captures materially more than the current `5-11` broken range.

## Validation and Acceptance

This work is complete only when:

- the new LinkedIn tests fail before the refactor and pass after it
- the capture artifact contains internal diagnostics for missed placeholder rows
- a live LinkedIn run stays on valid search URLs for both page 1 and page 2
- no captured LinkedIn row contains stale detail text from another job id
- the canonical QA search captures materially more than the current broken baseline, with a target floor of `30` unless the live page clearly advertises fewer than `40`
- summary-card data alone is sufficient for imported jobs to remain reviewable in Job Finder

## Idempotence and Recovery

The code changes are additive and safe to rerun. If the live verification still under-harvests after the refactor, preserve the capture artifact and diagnostics; do not reintroduce cache or quarantine to hide the bad run. Rollbacks should use git to revert the specific controller commit rather than editing the QA checkout manually.

## Artifacts and Notes

Known baseline evidence before this refactor:

    last known good-ish recent run:
      36 captured / 58 expected
      14 imported after filtering

    recent broken runs:
      33 / 49
      11 / 45
      7 / 43
      5 / 47

Live DOM behavior that shaped this plan:

    many li[data-occludable-job-id] rows exist with empty innerText/innerHTML
    scrolling the results container changes scrollTop without rotating in more hydrated rows
    clicking a blank placeholder row did not hydrate it

This is why the plan replaces passive whole-pane scraping with deterministic row traversal.

## Interfaces and Dependencies

The main interfaces after implementation should be:

- in `src/browser-bridge/providers/chrome-applescript.js`:
  - a helper that finalizes LinkedIn row snapshots into jobs and diagnostics
  - `readLinkedInJobsFromChrome()` returning `{ pageUrl, capturedAt, jobs, expectedCount, captureDiagnostics }`
- in `src/sources/linkedin-saved-search.js`:
  - `writeLinkedInCaptureFile()` accepting and persisting `captureDiagnostics`

The generic `enrichJobsWithDetailPages()` pipeline remains available for other sources, but LinkedIn should no longer depend on it for MVP import correctness.

Revision note (2026-04-01): created after live debugging proved the remaining LinkedIn blocker is row hydration/virtualization, not just pagination or stale detail provenance.
