# YC Jobs Direct HTTP Source Notes

- Source type: `http_direct`
- Canonical route: `https://www.workatastartup.com/jobs/l/product-manager`

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
- Capture/import tests:
  - write capture payload with expected count
  - collect from injected HTML fetch
  - assert max-jobs trimming and capture persistence

## Current Test Coverage

- [test/yc-jobs.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/yc-jobs.test.js)
- [test/yc-capture.test.js](/Users/admin/.codex/worktrees/51f6/job-finder/test/yc-capture.test.js)
