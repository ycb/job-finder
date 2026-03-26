# YC Jobs Source Notes

- Source type: `auth_required_http_direct`
- Canonical route: `https://www.workatastartup.com/jobs/l/product-manager`

## Product Integration Notes

- Product integration treats `YC Jobs` as an auth-required source, even though the adapter fetch path is direct HTTP.
- Enablement must reuse the existing 3-step auth modal flow:
  - `Open source`
  - user signs in
  - `I'm logged in`
- Public readiness/status must reuse existing source vocabulary only:
  - `ready`
  - `not authorized`
  - `challenge`
  - `disabled`
  - `never run`
- Do not introduce a bespoke onboarding or source-management path for YC.

## Search Construction Notes

- Cleanly mapped criteria:
  - none in the current MVP adapter
- Unsupported criteria:
  - `title`
  - `keywords`
  - `keywordMode`
  - `hardIncludeTerms`
  - `includeTerms`
  - `location`
  - `distanceMiles`
  - `minSalary`
  - `datePosted`
  - `experienceLevel`
- Source-specific URL/state rule:
  - treat the YC product-manager route as a fixed discovery surface
  - do not pretend free-form query criteria map into the URL until a source-specific construction rule is proven trustworthy

## Canonical Review Target Rule

- Never use YC auth-gated `applyUrl` as the review target.
- Canonical review target is the public company page:
  - `https://www.workatastartup.com/companies/<companySlug>`

## Minimum Extraction Contract

- Required fields for trustworthy ingest:
  - `externalId`
  - `title`
  - `company`
  - `url`
- Minimum useful metadata:
  - `location`
  - `employmentType`
  - `summary`
- Current parser source:
  - server-rendered `data-page` payload embedded in the role page HTML

## Source-Specific Filtering Rule

- The `/jobs/l/product-manager` route still contains off-target roles.
- MVP parser must narrow to product-role titles and drop obvious non-PM jobs such as:
  - `Product Designer`
  - engineering-only roles
  - founder-office / unrelated staff roles

## Verification Pattern

- Parser tests:
  - parse the `data-page` payload
  - assert off-target roles are excluded from the product-manager route
  - assert canonical company-page review URL generation
- Product-integration tests:
  - assert `yc_jobs` is auth-required
  - assert enabled YC sources route into the existing `Authentication Required` group until access checks pass
  - assert search-row presentation uses existing status vocabulary
- Capture/import tests:
  - write capture payload with expected count
  - collect from injected HTML fetch
  - assert max-jobs trimming and capture persistence

## Internal Novelty Interpretation

- Default novelty baseline for new-source evaluation is `LinkedIn + Indeed`.
- YC should be judged on:
  - startup-role uniqueness beyond the LinkedIn/Indeed baseline
  - whether the fixed YC product-manager route adds net-new PM opportunities despite narrow URL semantics
- High overlap with little unique import yield is a signal to narrow, not to expose novelty to the end-user UI.

## Current Test Coverage

- [test/yc-jobs.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/yc-jobs.test.js)
- [test/yc-capture.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/yc-capture.test.js)
- [test/source-access.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/source-access.test.js)
- [test/review-react-onboarding-model.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/review-react-onboarding-model.test.js)
- [test/review-searches-react-logic.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/review-searches-react-logic.test.js)
