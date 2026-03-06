# LinkedIn Capture Depth and Cross-Source Verification

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

Today, LinkedIn capture undercounts available jobs because the bridge reads mostly visible cards from one loaded view. After this change, a single LinkedIn source run will actively scroll and paginate through result pages, dedupe jobs, and persist a larger, cleaner capture set. In parallel, this plan defines how every source can be measured against an expected-result signal so we can spot low-capture regressions quickly instead of noticing only in the UI.

## Progress

- [x] (2026-03-06 18:26Z) Reproduced the mismatch with evidence (LinkedIn UI result count materially higher than captured active jobs).
- [x] (2026-03-06 18:30Z) Identified root cause in `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js`: LinkedIn capture parses currently loaded DOM only.
- [x] (2026-03-06 18:40Z) Implemented LinkedIn scroll harvesting inside each page capture cycle (scroll step script + per-page harvest loop).
- [x] (2026-03-06 18:40Z) Implemented LinkedIn pagination traversal (`start` offset pages), with dedupe and early-stop heuristics.
- [x] (2026-03-06 18:41Z) Added tests for LinkedIn pagination URL behavior in `test/linkedin-capture-pagination.test.js`.
- [x] (2026-03-06 18:45Z) Verified behavior with targeted tests, full test suite, and live capture: `AI PM` capture increased from 7 (intermediate regression) to 36 jobs after scroll-target fix.
- [x] (2026-03-06 19:01Z) Added LinkedIn expected-count extraction and persisted `expectedCount` in capture payload; surfaced source-level `expected/imported/ratio/status` verification metadata in dashboard data.
- [x] (2026-03-06 18:48Z) Drafted source-verification framework spec and added backlog item:
  `/Users/admin/job-finder/docs/backlog-specs/p0-source-capture-verification-framework.md`.

## Surprises & Discoveries

- Observation: The dashboard metric mismatch was partly a measurement-layer problem, but LinkedIn under-capture is also real.
  Evidence: Active LI jobs were 3 while LI source captures across configured LI sources were much higher (multiple capture files with 20+ rows).

- Observation: Existing Chrome provider already has a generic paginated capture helper for other boards (Indeed/ZipRecruiter), but LinkedIn uses a separate single-page path.
  Evidence: `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js` has `capturePaginatedGenericBoardJobs` and `readLinkedInJobsFromChrome` implemented independently.

- Observation: First pagination implementation regressed capture depth (7 jobs) because list scroll targeted the wrong container for LinkedIn virtualization.
  Evidence: `node src/cli.js capture-source-live "AI PM" --force-refresh` initially returned `Live-captured 7 job(s)`; after changing scroll strategy to `scrollIntoView(last card)` + scrollable ancestor detection, it returned `Live-captured 36 job(s)`.

- Observation: LinkedIn expected-count extraction currently available only for sources that have been recaptured with the new payload field.
  Evidence: `ai-pm` capture includes `expectedCount`, while older LinkedIn capture files remain `expectedCount: null` until refreshed.

## Decision Log

- Decision: Extend the existing LinkedIn path in the Chrome AppleScript provider instead of replacing with a new provider.
  Rationale: Lowest-risk path; existing production flow already routes LinkedIn through this provider.
  Date/Author: 2026-03-06 / Codex

- Decision: Use deterministic URL pagination (`start` offsets) plus in-page scroll loops.
  Rationale: URL pagination alone misses lazy-loaded cards; scroll alone misses deeper pages. Combining both is more reliable.
  Date/Author: 2026-03-06 / Codex

- Decision: Keep verification framework scoped as spec in this change rather than implementing all-source validation gate immediately.
  Rationale: User requested immediate LinkedIn fix; cross-source verification needs additional source-specific expected-count strategies.
  Date/Author: 2026-03-06 / Codex

## Outcomes & Retrospective

LinkedIn capture depth is now materially improved with explicit page traversal and repeated in-page harvesting. We moved from a single-view extraction path to a deduped multi-page approach and confirmed behavior in live runs (`AI PM`: 35-36 jobs captured in subsequent checks). We also established first-pass LinkedIn `expected vs imported` telemetry by extracting expected result count from the page and persisting it into capture payloads, then deriving verification metadata in dashboard source data. Cross-source verification governance is specified in backlog spec `p0-source-capture-verification-framework.md` for rollout to remaining source types.

## Context and Orientation

LinkedIn live capture currently flows through `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js`:

- `captureLinkedInSourceWithChromeAppleScript(...)` invokes `readLinkedInJobsFromChrome(...)`.
- `readLinkedInJobsFromChrome(...)` currently navigates once and repeatedly attempts extraction until jobs appear, then returns.
- `buildExtractionScript()` parses LinkedIn card DOM into normalized job objects.

Dashboard counts are then derived from persisted jobs and statuses in `/Users/admin/job-finder/src/review/server.js`.

For this change, we only modify capture behavior for LinkedIn and add light verification-oriented helpers/tests. No database schema change is required.

## Plan of Work

First, add LinkedIn-specific page URL construction and page traversal in the Chrome provider. Each page run will:

1. navigate to the page URL,
2. run repeated "scroll step + extract" cycles to load more cards,
3. dedupe jobs across cycles,
4. return a page payload.

Then outer pagination will iterate page offsets (`start=0,25,50,...`) and dedupe across pages, stopping when a page yields no growth.

Next, add a focused unit test for LinkedIn pagination URL generation and replacement semantics so this behavior is regression-safe without requiring AppleScript in tests.

Finally, run targeted tests and a live capture command for one LinkedIn source, record before/after job counts, and document a source-verification spec entry for expected-vs-captured comparison.

## Concrete Steps

From `/Users/admin/job-finder`:

1. Implement provider changes in `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js`.
2. Add tests in `/Users/admin/job-finder/test/linkedin-capture-pagination.test.js` (or nearest existing test file if better fit).
3. Run:
   - `npm test -- test/linkedin-capture-pagination.test.js`
   - `npm test`
4. Run one live check:
   - `node src/cli.js capture-source-live "AI PM" --force-refresh`

Expected behavior:

- LinkedIn capture file for the target source should contain materially more rows when multiple pages exist.
- Run output should show a higher `jobsImported` than prior single-view capture (exact value varies by live results).

## Validation and Acceptance

Acceptance criteria:

- LinkedIn capture traverses multiple pages and scroll loads cards within each page.
- Duplicate jobs across scroll cycles/pages are deduped.
- No regression in non-LinkedIn sources.
- Unit tests for page URL pagination logic pass.
- Full test suite passes.

Manual verification:

- Trigger a live LinkedIn source capture.
- Inspect resulting capture JSON job count.
- Confirm dashboard source count reflects increased linked-in capture depth after sync.

## Idempotence and Recovery

The code changes are additive and safe to rerun. If live capture behavior is unexpectedly noisy, set LinkedIn `maxPages` in source config once support is added, or reduce internal defaults in one commit. If a live run fails, rerun with `--force-refresh` and inspect capture payload/log output.

## Artifacts and Notes

Key evidence transcripts:

    npm test -- test/linkedin-capture-pagination.test.js
    ✔ buildLinkedInPageUrl applies LinkedIn start offset in 25-result increments
    ✔ buildLinkedInPageUrl replaces existing start query parameter

    npm test
    ℹ tests 78
    ℹ pass 78
    ℹ fail 0

    node src/cli.js capture-source-live "AI PM" --force-refresh
    Live-captured 36 job(s) for "AI PM" via chrome_applescript

## Interfaces and Dependencies

Key functions to modify or add in `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js`:

- `readLinkedInJobsFromChrome(searchUrl, options)` (expand behavior)
- helper to build paginated LinkedIn URL (`start` offset)
- helper to perform one scroll step in the active tab
- helper to capture one LinkedIn page with extraction retries

No new external dependencies.

---

Plan revision note (2026-03-06): Initial plan created to implement LinkedIn scroll + pagination now and scope cross-source expected-count work as follow-up spec.
Plan revision note (2026-03-06): Updated after implementation and verification; recorded intermediate regression and final scroll-target fix with live evidence.
