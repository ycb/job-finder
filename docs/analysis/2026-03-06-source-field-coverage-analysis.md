# Source Field Coverage Analysis (Live Verification Snapshot)

As of 2026-03-07.

## Scope

This snapshot is based on live capture runs in this execution branch for in-scope sources:

- `linkedin-live-capture`
- `builtin-sf-ai-pm`
- `ashby-pm-roles`
- `google-ai-pm`
- `indeed-ai-pm`
- `zip-ai-pm`

Excluded by request from analysis scope:

- `wellfound-ai-pm` (feature-flagged off)
- `remoteok-ai-pm` (feature-flagged off)

## Live Coverage (Required Contract Fields)

Coverage from `node src/cli.js check-source-contracts` after a post-remediation live capture rerun:

- `linkedin-live-capture` (`91` jobs): `title 100%`, `company 100%`, `location 100%`, `description 100%`, `postedAt 0%`, `salaryText 0%`, `employmentType 0%`.
- `builtin-sf-ai-pm` (`9` jobs): `title 100%`, `company 100%`, `location 100%`, `description 100%`, `postedAt 100%`, `salaryText 89%`.
- `ashby-pm-roles` (`4` jobs): `title 100%`, `company 100%`, `location 0%`, `description 100%`, `postedAt 0%`, `salaryText 0%`.
- `google-ai-pm` (`10` jobs): `title 100%`, `company 100%`, `location 80%`, `description 100%`, `postedAt 100%`, `salaryText 10%`.
- `indeed-ai-pm` (`67` jobs): `title 100%`, `company 100%`, `location 100%`, `description 100%`, `postedAt 0%`, `salaryText 91%`.
- `zip-ai-pm` (`60` jobs): `title 100%`, `company 100%`, `location 100%`, `description 100%`, `postedAt 3%`, `salaryText 45%`.

## Contract Drift Outcome

- Command exit status: `1` (expected for active extraction gaps).
- Error sources: `linkedin-live-capture`, `ashby-pm-roles`, `google-ai-pm`, `indeed-ai-pm`, `zip-ai-pm`.
- Clean source: `builtin-sf-ai-pm`.

## Practical Cross-Source Contract (Current)

Based on live parser behavior, this remains the best implementation posture:

Required, always present (value or placeholder):

- `title`
- `company`
- `location` (`unknown` placeholder when missing)
- `salary` (`unknown` placeholder when missing)
- `description` (summary/snippet fallback if full JD unavailable)
- source identity (`sourceId`, `sourceType`, `sourceUrl`)

Quality-scored required goals (currently failing for some sources):

- `freshness` (`postedAt`)
- `employmentType`

Optional:

- `workModel`
- `skills`
- `description.fullJD`

## Key Risks (Validated by Live Data)

- `ashby-main` quality drift risk remains high: location/freshness/salary extraction at `0%` in this run.
- `indeed-main` and `ziprecruiter-main` freshness reliability is weak (`0%` and `3%`).
- `google-main` and `ziprecruiter-main` salary/employment extraction needs stronger parsing (`salaryText 10%` and `45%`; employment sparse).
- `linkedin-main` metadata gap is material for freshness/salary/employment (`0%` each in this run).

Parser-hardening note:

- This branch includes one remediation pass in browser extraction scripts (regex/line parsing improvements); it produced limited lift (Google salary improved from `0%` to `10%`) and confirms the remaining gaps require source-specific detail-pane/detail-page extraction, not card-only heuristics.

## Recommendation

Keep parser-first execution in effect:

1. Prioritize freshness and employment parsing upgrades for LinkedIn/Indeed/ZipRecruiter.
2. Add salary extraction hardening for Google and ZipRecruiter.
3. Improve Ashby board parsing boundaries for location/freshness/salary.
4. Keep `wellfound`/`remoteok` disabled until criteria + extraction + full-JD validation gates pass.

Track progress using:

- `criteriaAccountability` buckets
- Found ratio (`X/Y`)
- capture funnel metrics
- `jf check-source-contracts` drift status
