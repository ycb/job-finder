# LinkedIn Live Diagnostic POC

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

Stop guessing about LinkedIn extraction failures by producing a repeatable live diagnostic report for the canonical search page. After this change, an engineer can run one script and see, for the same LinkedIn page, which job ids are present in the visible result list, which ids are present in hidden structured payloads, which ids can be activated into selected-job state, and which browser resource requests were observed. The result should make it obvious whether the missing jobs are blocked by row hydration, a partial structured payload, a missing interaction trigger, or a runtime data source we are not yet reading.

## Progress

- [x] (2026-04-01 21:50Z) Reviewed the current LinkedIn extractor, structured-payload POC, and testing surface to define the diagnostic scope.
- [x] (2026-04-01 22:09Z) Wrote the dedicated live diagnostic ExecPlan and kept it current as the POC evolved.
- [x] (2026-04-01 22:28Z) Added and passed tests for the diagnostic summarizer and LinkedIn job-id extraction from resource URLs.
- [x] (2026-04-01 22:36Z) Implemented a live diagnostic script that captures before/after snapshots and row-activation evidence.
- [x] (2026-04-01 22:47Z) Ran the script against the canonical LinkedIn search page and recorded the findings in this plan and `docs/learnings.md`.

## Surprises & Discoveries

- Observation: the current hidden structured payload on the live search page yields only seven jobs even though the visible page contains many more cards.
  Evidence: `node scripts/linkedin-structured-first-page-poc.js` returned `extractedCount: 7` while the page clearly showed a fuller first page.

- Observation: generic document and obvious list-container scrolling did not move the page state we inspected and did not change the structured payload count.
  Evidence: `node scripts/linkedin-structured-scroll-poc.js` reported `structuredCount: 7` before and after the scroll phase, and every tested container snapshot remained `scrollTop: 0`.

- Observation: on the live canonical search page, `document.documentElement.outerHTML` exposed no `li[data-occludable-job-id]` rows in the snapshot we captured, so the visible-row DOM surface was absent from the document HTML we read.
  Evidence: `node scripts/linkedin-live-diagnostic-poc.js` reported `rowIdCount: 0` and `activationAttemptCount: 0` in both the before/after summaries.

- Observation: the same live run still exposed a richer first-page job set through browser resource activity than through hidden structured payloads.
  Evidence: the diagnostic reported `structuredCount: 7` but `resourceJobCount: 25`, with resource URLs including `voyagerJobsDashJobCards ... count=25 ... start=0`, `voyagerJobsDashJobCards ... count=25 ... start=25`, and a `prefetchJobPostingCardUrns` GraphQL request containing 25 job ids.

- Observation: the missing LinkedIn jobs are not absent from the page lifecycle; they are absent from the surfaces we were reading.
  Evidence: the live diagnostic surfaced job ids such as `4380836098`, `4179504146`, and `4382455803` in resource URLs even though they were not present in the parsed hidden payload and no DOM rows were available in the `outerHTML` snapshot.

## Decision Log

- Decision: build a dedicated diagnostic script instead of continuing ad hoc tweaks to the live extractor.
  Rationale: the current problem is not “one more selector bug.” We need a durable evidence loop that reports per-row availability across the visible DOM, hidden structured payloads, selected-job state, and browser resource activity.
  Date/Author: 2026-04-01 / Codex

- Decision: keep this diagnostic POC separate from the production LinkedIn extraction path.
  Rationale: the goal is to identify the correct extraction surface and interaction trigger before changing the live capture algorithm again.
  Date/Author: 2026-04-01 / Codex

- Decision: target LinkedIn's runtime resource/state layer as the next extraction surface instead of continuing to tune `outerHTML`/visible-card scraping.
  Rationale: the live diagnostic proved that the richer first-page job set is present in resource activity (`25` ids) while the current document/hidden-payload surfaces remain partial (`7` ids) and the DOM snapshot exposed no row list at all.
  Date/Author: 2026-04-01 / Codex

## Outcomes & Retrospective

This plan is complete. The live diagnostic produced the missing evidence:

- the hidden structured payload is real but partial (`7` jobs)
- the document HTML snapshot is not a reliable visible-row surface on the live page (`0` row ids)
- the browser resource layer exposes a much fuller first-page job set (`25` ids)

That means the current LinkedIn extractor is under-harvesting because it is reading the wrong surfaces, not because the underlying job data is irregular. The next LinkedIn refactor should stop treating visible/hydrated card DOM as primary and instead investigate the richer runtime resource/state path that already exposes many more job ids.

## Context and Orientation

The active LinkedIn production extractor lives in `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`. It currently traverses `li[data-occludable-job-id]` rows, tries to hydrate them, and optionally reads bounded detail hints while staying on `/jobs/search/`. The earlier structured-payload prototype lives in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/linkedin-structured-payload.js` plus the POC scripts under `/Users/admin/.codex/worktrees/51f6/job-finder/scripts/`. That prototype proved the page contains parseable `JobPostingCard` JSON but only for an initial slice of the first page.

The diagnostic POC in this plan must inspect four data surfaces on the same live LinkedIn search page:

1. The visible result list, represented by `li[data-occludable-job-id]` rows and their currently hydrated card text.
2. The hidden structured payloads embedded in `display:none` `<code>` blocks, parsed with `extractLinkedInStructuredJobsFromHtml`.
3. The selected-job state that appears after activating a result row, as evidenced by `currentJobId` in the URL and same-id detail/top-card data when available.
4. Resource requests visible through browser performance entries so we can tell whether lazy loading is happening somewhere other than the document HTML.

The canonical test search is:

- title: `Product manager`
- hard filter: `ai`
- location: `San Francisco, CA`
- minimum salary: `$200,000`
- date posted: `Past 3 days`

The current unanswered questions are:

- Does the hidden payload ever expand past the first seven jobs?
- What interaction, if any, causes a placeholder row to become same-id selected-job data?
- Are later jobs represented only in runtime resource responses rather than `outerHTML`?
- For each row id on page one, where exactly does availability stop?

## Plan of Work

First, add a small pure helper module to summarize diagnostic snapshots. This helper should take raw row snapshots, structured job ids, and activation results, then compute coverage counts and per-row classifications. The module must be testable without a live browser. The tests should prove that the summarizer can distinguish rows that are visible but not structured, structured but not visible, and rows that become selected-job matches after activation.

Second, add a new live script at `/Users/admin/.codex/worktrees/51f6/job-finder/scripts/linkedin-live-diagnostic-poc.js`. The script should open the canonical LinkedIn search page in Chrome using the same AppleScript automation pattern as the production bridge. It should capture an initial snapshot containing:

- page URL and title
- current job id from the URL
- visible row ids and minimal card snapshots
- hidden structured job ids from `extractLinkedInStructuredJobsFromHtml(document.documentElement.outerHTML)`
- relevant browser resource URLs from `performance.getEntriesByType('resource')`
- a short inventory of likely runtime state keys on `window` related to jobs or voyager payloads

Third, the script should run a controlled interaction experiment on a bounded set of unresolved row ids. Start with the first ten row ids that are present in the visible list but absent from the structured payload or absent from hydrated card text. For each one, scroll it into view, activate it, wait briefly, and capture:

- whether `currentJobId` changed to that row id
- whether same-id selected-job metadata became available
- whether the row’s visible card text became hydrated
- whether the hidden structured payload count changed
- whether new relevant resource entries appeared

Fourth, summarize the results into one JSON report. The report should include aggregate counts and a per-row section so the engineer can inspect specific failures. The per-row section must answer whether the row existed in the visible DOM, whether it had visible text before activation, whether it existed in the structured payload, whether activation changed `currentJobId`, whether selected-job data matched the row id, and whether the row ended the experiment with enough metadata for MVP import.

Finally, run the script against the live canonical search page and record the conclusions in this plan and `docs/learnings.md`. The plan should state explicitly whether the next LinkedIn step should target runtime resource/state parsing, deterministic row activation, or both.

## Concrete Steps

1. Add a pure helper module at `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/linkedin-diagnostic.js` with functions that summarize raw snapshot arrays and activation results into:
   - visible row count
   - hydrated visible row count
   - structured job count
   - rows missing from structured payload
   - rows recovered by activation
   - rows still unresolved

2. Add a test file at `/Users/admin/.codex/worktrees/51f6/job-finder/test/linkedin-diagnostic.test.js` that:
   - feeds synthetic row snapshots and structured ids into the helper
   - asserts the summary counts and unresolved/recovered row ids are correct
   - proves the report distinguishes “visible only,” “structured only,” and “activation recovered” cases

3. Verify the test fails before implementation by running, from `/Users/admin/.codex/worktrees/51f6/job-finder`:

      node --test test/linkedin-diagnostic.test.js

4. Implement the minimal helper in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/linkedin-diagnostic.js`, then rerun:

      node --test test/linkedin-diagnostic.test.js

5. Add `/Users/admin/.codex/worktrees/51f6/job-finder/scripts/linkedin-live-diagnostic-poc.js`. Reuse the existing AppleScript/Chrome execution pattern from the other LinkedIn POC scripts. The script should:
   - open the canonical search page
   - collect the initial snapshot
   - activate a bounded set of unresolved rows
   - collect the final snapshot
   - print a single JSON report

6. Verify syntax and rerun the existing structured-payload tests:

      node -c scripts/linkedin-live-diagnostic-poc.js
      node --test test/linkedin-structured-payload.test.js test/linkedin-diagnostic.test.js

7. Run the live diagnostic script:

      node scripts/linkedin-live-diagnostic-poc.js

   Expected: one JSON report containing before/after counts, relevant resource URLs, and per-row activation results.

## Validation and Acceptance

This POC is successful if a single run of `node scripts/linkedin-live-diagnostic-poc.js` answers all of the following with concrete evidence:

- how many row ids exist on the first page
- how many of those row ids already have hydrated visible card text
- how many are present in hidden structured payloads
- whether activating unresolved rows changes `currentJobId` to the target row id
- whether same-id selected-job data becomes available after activation
- whether browser resource entries reveal a fuller result source than the hidden payloads

The acceptance artifact is the JSON report itself. It must contain enough information that a reader can point to one unresolved row id and see exactly which surfaces did or did not expose that job.

## Idempotence and Recovery

The live diagnostic script is safe to rerun. It should open a fresh Chrome window and close it when complete. If the script fails mid-run, rerunning it should simply create a new window and produce a new report. If Chrome AppleScript fails because of sandboxing, rerun the script with the same escalated execution path already used by the earlier POC scripts.

## Artifacts and Notes

Expected useful artifacts include:

    node scripts/linkedin-structured-first-page-poc.js
    {
      "extractedCount": 7,
      "jobs": [ ... ]
    }

    node scripts/linkedin-structured-scroll-poc.js
    {
      "before": { "structuredCount": 7 },
      "after": { "structuredCount": 7 }
    }

The new diagnostic POC should supersede these partial proofs by producing one richer report instead of separate one-off experiments.

## Interfaces and Dependencies

The diagnostic helper module should be a plain Node module with pure functions so it can be unit tested easily. The live script should keep using:

- `osascript` to drive Google Chrome
- `execute javascript` on the active tab
- `extractLinkedInStructuredJobsFromHtml()` from `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/linkedin-structured-payload.js`

Do not add new runtime dependencies. The diagnostic should run with the existing Node toolchain and the user’s active Chrome session.

Revision note (2026-04-01): created after the hidden-structured-payload POC proved that LinkedIn exposes regular job data but only for an initial slice of the first page. This plan exists to identify the complete data surface and interaction trigger before another LinkedIn extractor rewrite.
