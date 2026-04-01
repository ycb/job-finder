# LinkedIn Structured Payload POC

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

Test the hypothesis that LinkedIn search/detail pages expose enough hidden structured data to extract MVP job fields without depending on hydrated left-rail card DOM. The POC is intentionally narrow: prove we can parse the saved sample page into structured job records containing the fields Job Finder actually needs for MVP import and scoring.

## Progress

- [x] (2026-04-01 21:11Z) Inspected the sample page and confirmed it contains hidden BPR payloads and `JobPostingCard` objects inside `display:none` `<code>` blocks.
- [x] (2026-04-01 21:17Z) Added a failing test proving the sample page should yield at least one structured LinkedIn job with stable MVP fields.
- [x] (2026-04-01 21:23Z) Implemented a minimal parser in `src/sources/linkedin-structured-payload.js` that reads hidden BPR payloads and extracts structured job cards.
- [x] (2026-04-01 21:24Z) Added a runnable POC entrypoint in `scripts/linkedin-structured-payload-poc.js`.
- [x] (2026-04-01 21:25Z) Verified the parser against the real sample page and confirmed it extracts the selected job with stable MVP fields.
- [x] (2026-04-01 21:33Z) Probed the live first-page LinkedIn search and confirmed it exposes a hidden `voyagerJobsDashJobCards` payload in the live DOM.
- [x] (2026-04-01 21:39Z) Added a collection-case test proving the parser can extract multiple jobs from a hidden `voyagerJobsDashJobCards` response.
- [x] (2026-04-01 21:44Z) Added a live first-page POC script that opens the search page in Chrome, reads `outerHTML`, and parses hidden structured jobs from the first page only.
- [x] (2026-04-01 21:46Z) Ran the live first-page POC and recorded extracted count / sample rows.

## Surprises & Discoveries

- Observation: the sample page only exposes one selected-job structured payload, not an obvious full search-results collection.
  Evidence: the sample contains one `bpr-guid-*` body with `JobPostingCard` data, and the POC extracts exactly one job (`4392864954`) from the hidden payloads.

- Observation: the structured payload already contains the key MVP fields needed for Job Finder import.
  Evidence: the parser recovers `externalId`, canonical LinkedIn job URL, title, company, location, posted recency, and workplace type for the selected job directly from hidden BPR JSON.

- Observation: the live first-page search page appears to expose a separate hidden collection payload for search results.
  Evidence: a live DOM probe found a hidden request for `/voyager/api/voyagerJobsDashJobCards?...start=0` and the page HTML contained `JobPostingCard` and `urn:li:fsd_jobPosting:` many times.

- Observation: the live first-page structured payload only yielded a narrow initial slice, not the full visible first page.
  Evidence: the live first-page POC extracted `7` jobs from the hidden `voyagerJobsDashJobCards` payload while the visible search page advertised materially more results and showed a first page with many more cards.

- Observation: generic page/pane scrolling did not expand the hidden structured payload.
  Evidence: a before/after-scroll POC on the live first page showed `structuredCount: 7` both before and after the scroll phase, while the candidate scroll containers in the main document all reported zero scroll capacity or zero movement.

## Decision Log

- Decision: keep this POC separate from the active LinkedIn AppleScript extractor.
  Rationale: the goal is to test feasibility of a different extraction surface, not to mix two experimental strategies into the live capture path yet.
  Date/Author: 2026-04-01 / Codex

## Outcomes & Retrospective

The POC is successful for the narrow hypothesis it tested: LinkedIn’s hidden BPR payloads can be parsed into regular MVP job data without relying on hydrated left-rail card DOM. The saved sample page yields one structured selected-job record with the exact fields Job Finder needs for summary-card-first import. The live first-page probe proves there is also a hidden `voyagerJobsDashJobCards` collection on the search page, and the parser can extract `7` real job rows from it. However, that hidden collection is only a narrow initial slice, not the full visible first page, so structured payloads alone are not yet a full replacement for first-page coverage. The likely direction is a hybrid extractor: structured payloads for high-confidence seeded rows plus deterministic row traversal for the remaining cards.

## Context and Orientation

The current LinkedIn extraction path lives in `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js` and depends on hydrated visible rows in the search results list. That strategy currently under-harvests because many rows remain placeholder shells. The saved sample page at `/Users/admin/job-finder/data/li-sample-data.html` contains hidden `<code style="display:none">` blocks that embed LinkedIn BPR payloads. Early inspection shows those payloads include `com.linkedin.voyager.dash.jobs.JobPostingCard` objects, `urn:li:fsd_jobPosting:<id>`, `jobPostingTitle`, `primaryDescription`, and `tertiaryDescription`, which is enough to test whether a structured-data-first strategy can recover MVP job fields.

## Plan of Work

First, add a focused parser module that operates on saved HTML only. It should read hidden `<code>` blocks, map `datalet-bpr-guid-*` request descriptors to `bpr-guid-*` bodies, decode HTML-escaped JSON, and recursively locate `JobPostingCard` objects. The parser should then normalize those cards into MVP job records using explicit rules for title, company, location, job id, canonical URL, and posted recency.

Second, add a small failing test using the real sample HTML. The test should prove the sample yields at least one structured record with the exact selected job shown in the hidden payload and that the extracted data includes the fields needed for MVP import.

Third, add a simple script so we can run the POC against any saved HTML file and inspect the extracted output without touching the live LinkedIn capture path.

## Concrete Steps

1. Add a new module at `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/linkedin-structured-payload.js` with helpers to:
   - read hidden code blocks
   - decode LinkedIn HTML-escaped JSON
   - map request payloads to body payloads
   - recursively collect `JobPostingCard` objects
   - convert cards into MVP job records

2. Add a new test file at `/Users/admin/.codex/worktrees/51f6/job-finder/test/linkedin-structured-payload.test.js` that:
   - loads `/Users/admin/job-finder/data/li-sample-data.html`
   - asserts at least one structured job is extracted
   - asserts the selected sample job id/title/company/location/posted fields are recovered
   - asserts the canonical job URL is derived from the structured job id

3. Add a small POC script at `/Users/admin/.codex/worktrees/51f6/job-finder/scripts/linkedin-structured-payload-poc.js` that:
   - accepts a path to saved HTML
   - prints extracted job count and the first few parsed records as JSON

4. Verify with:
   - `node --test test/linkedin-structured-payload.test.js`
   - `node scripts/linkedin-structured-payload-poc.js /Users/admin/job-finder/data/li-sample-data.html`
   - `node -c src/sources/linkedin-structured-payload.js`

## Validation and Acceptance

This POC is successful if:

- the parser extracts at least one valid structured LinkedIn job from the sample page
- that job includes:
  - stable LinkedIn job id
  - canonical `/jobs/view/<id>/` URL
  - title
  - company
  - location
  - posted recency when present
- the final write-up can clearly compare this structured-payload approach to the current hydrated-DOM approach and explain the delta

This POC has two acceptance levels:

1. Narrow sample proof
   - prove that hidden payloads contain usable, regular job data
   - prove that the parser can recover the selected job's MVP fields

2. Live first-page proof
   - prove that the live search page exposes a hidden first-page collection payload
   - prove that the parser can recover multiple first-page jobs from that live HTML

This POC still does not need to prove full multi-page search-result coverage.
