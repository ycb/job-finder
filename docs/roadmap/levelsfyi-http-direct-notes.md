# Levels.fyi Direct HTTP Source Notes

- Source type: `http_direct`
- Canonical route family: `https://www.levels.fyi/jobs/...`

## Product Integration Notes

- Product integration treats `Levels.fyi` as a standard no-auth source.
- Enablement should use the same no-auth path as other direct HTTP sources.
- Public readiness/status must reuse existing source vocabulary only:
  - `ready`
  - `not authorized`
  - `challenge`
  - `disabled`
  - `never run`
- Do not introduce bespoke status or onboarding semantics for direct salary-rich sources.

## Search Construction Notes

- Search construction maps the supported subset of criteria into a direct Levels.fyi jobs URL:
  - title slug
  - location slug
  - search text
  - minimum compensation
  - posted-after window
  - sort order
- Unsupported criteria must remain explicit instead of being silently dropped.

## Canonical Review Target Rule

- Preserve the canonical Levels.fyi detail URL as the review target:
  - `https://www.levels.fyi/jobs?jobId=<id>`
- Do not widen the review target into a generic search or browser flow.

## Minimum Extraction Contract

- Required fields for trustworthy ingest:
  - `externalId`
  - `title`
  - `company`
  - `url`
- Minimum useful metadata:
  - `location`
  - `salaryText`
  - compensation summary in `summary`
  - `employmentType`
- Bounded detail enrichment is allowed when the list page is too thin to preserve salary-rich metadata.

## Verification Pattern

- Parser tests:
  - assert canonical review target via `jobId`
  - assert salary-rich metadata extraction
  - assert direct URL construction from criteria
- Product-integration tests:
  - assert `levelsfyi_search` is no-auth
  - assert search-row presentation uses existing status vocabulary
- Registration/reporting tests:
  - assert source-library registration
  - assert schema/cache-policy acceptance
  - assert dashboard source-row contract

## Internal Novelty Interpretation

- Default novelty baseline for new-source evaluation is `LinkedIn + Indeed`.
- Levels should be judged on:
  - salary-transparent roles not already covered by the baseline
  - whether compensation-rich postings add prioritization value beyond simple duplication
- Novelty stays internal in MVP; it should not appear in the end-user UI.

## Current Test Coverage

- [test/levelsfyi-jobs.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/levelsfyi-jobs.test.js)
- [test/levelsfyi-source-registration.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/levelsfyi-source-registration.test.js)
- [test/review-searches-react-logic.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/review-searches-react-logic.test.js)
- [test/source-access.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/source-access.test.js)
- [test/source-novelty.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/source-novelty.test.js)
