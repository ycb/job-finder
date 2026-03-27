# MVP Source-Map Audit

As of 2026-03-27.

## Purpose

This document is the internal source-map truth table for the MVP source slate. It compares four layers together for each active source:

- the declared source contract in `config/source-contracts.json`
- the runtime query builder in `src/sources/search-url-builder.js`
- the runtime criteria-accountability output
- the actual source-specific collection and review-target behavior

The goal is not to expose this matrix to users. The goal is to make source capability, drift, and fix priority explicit so source work compounds into a future `add a source` workflow.

The default novelty baseline remains `LinkedIn + Indeed`. Novelty is internal-only in MVP.

## Classification legend

- `supported and truthful`: the contract, runtime builder, and accountability output agree
- `supported but lossy`: the source uses the field, but only through a weaker mechanism such as folded query text
- `implemented but misreported`: the runtime uses the field but accountability or contract reporting is wrong
- `not implemented`: the runtime does not use the field
- `should not be modeled`: the field is not meaningful for the current source shape

## MVP matrix

### LinkedIn (`linkedin_capture_file`)

- Source type: browser/auth
- Auth requirement: yes
- Canonical review target: direct `https://www.linkedin.com/jobs/view/<id>/` when possible; otherwise LinkedIn search fallback
- Extracted data shape:
  - required: title, company, location, description, postedAt, salaryText, employmentType
  - full job description: partial
- Supported query params:
  - `title`: supported and truthful
  - `keywords`: supported and truthful
  - `keywordMode`: supported and truthful
  - `hardIncludeTerms`: supported and truthful
  - `includeTerms`: supported and truthful
  - `excludeTerms`: supported but lossy via post-capture hard filter
  - `location`: supported and truthful
  - `distanceMiles`: supported and truthful
  - `datePosted`: supported and truthful
  - `experienceLevel`: supported and truthful
  - `minSalary`: supported and truthful
- Known drift:
  - no major contract/runtime drift remains in the active MVP map
- Novelty expectation vs baseline:
  - baseline source, not primarily judged for novelty

### Built In SF (`builtin_search`)

- Source type: direct HTTP / no auth
- Auth requirement: no
- Canonical review target: Built In job detail URL from the listing card
- Extracted data shape:
  - required: title, company, location, description, postedAt, salaryText
  - full job description: partial
- Supported query params:
  - `title`: supported and truthful
  - `keywords`: supported and truthful
  - `keywordMode`: supported but lossy via folded query text
  - `hardIncludeTerms`: supported but lossy via folded query text
  - `includeTerms`: supported but lossy via folded query text
  - `excludeTerms`: supported but lossy via post-capture hard filter
  - `location`: supported and truthful
  - `distanceMiles`: not implemented
  - `datePosted`: supported and truthful
  - `experienceLevel`: not implemented
  - `minSalary`: not implemented
- Known drift:
  - no major active drift in current MVP scope
- Novelty expectation vs baseline:
  - moderate; cleaner non-auth baseline rather than high novelty source

### Indeed (`indeed_search`)

- Source type: browser/auth in product behavior, URL-driven search construction
- Auth requirement: yes in current product flow
- Canonical review target: direct `viewjob?jk=<id>` when `jk`/`vjk` exists; otherwise captured URL
- Extracted data shape:
  - required: title, company, location, description, postedAt, salaryText
  - full job description: partial
- Supported query params:
  - `title`: supported and truthful
  - `keywords`: supported and truthful
  - `keywordMode`: supported but lossy via folded query text
  - `hardIncludeTerms`: supported but lossy via folded query text
  - `includeTerms`: supported but lossy via folded query text
  - `excludeTerms`: supported but lossy via post-capture hard filter
  - `location`: supported and truthful
  - `distanceMiles`: supported and truthful
  - `datePosted`: supported and truthful
  - `experienceLevel`: not implemented
  - `minSalary`: supported and truthful
- Known drift:
  - no active accountability drift after the 2026-03-27 fix for `hardIncludeTerms`
  - challenge-mode wording remains an operational validation risk, not a source-map gap
- Novelty expectation vs baseline:
  - baseline source, not primarily judged for novelty

### ZipRecruiter (`ziprecruiter_search`)

- Source type: browser/auth in product behavior, URL-driven search construction
- Auth requirement: yes in current product flow
- Canonical review target: direct job URL preserving posting-specific `lk` or `uuid`
- Extracted data shape:
  - required: title, company, location, description, postedAt, salaryText
  - full job description: partial
- Supported query params:
  - `title`: supported and truthful
  - `keywords`: supported but lossy via folded query text
  - `keywordMode`: supported but lossy via folded query text
  - `hardIncludeTerms`: supported but lossy via folded query text
  - `includeTerms`: supported but lossy via folded query text
  - `excludeTerms`: supported but lossy via post-capture hard filter
  - `location`: supported and truthful
  - `distanceMiles`: supported and truthful
  - `datePosted`: supported and truthful via `days`
  - `experienceLevel`: supported and truthful via `refine_by_experience_level`
  - `minSalary`: supported and truthful via `refine_by_salary`
- Known drift:
  - source-map/runtime drift remains because the product does not yet model Zip-native filters such as `remote`, `employment types`, or `apply type`
  - folded text search is weaker than the live site’s richer filter surface
- Novelty expectation vs baseline:
  - low-to-moderate; value comes more from breadth and direct employer inventory than unique net-new roles

### Levels.fyi (`levelsfyi_search`)

- Source type: direct HTTP / no auth
- Auth requirement: no
- Canonical review target: `https://www.levels.fyi/jobs?jobId=<id>`
- Extracted data shape:
  - required: title, company, location, description, salaryText
  - full job description: partial
  - salary-rich metadata available when present
- Supported query params:
  - `title`: supported and truthful
  - `keywords`: supported but lossy via `searchText`
  - `keywordMode`: supported but lossy via folded `searchText`
  - `hardIncludeTerms`: supported but lossy via folded `searchText`
  - `includeTerms`: supported but lossy via folded `searchText`
  - `excludeTerms`: supported but lossy via post-capture hard filter
  - `location`: supported and truthful
  - `distanceMiles`: not implemented
  - `datePosted`: supported and truthful
  - `experienceLevel`: not implemented
  - `minSalary`: supported and truthful
- Known drift:
  - severe builder drift is now closed: `levelsfyi_search` has an explicit shared builder branch and generic collection dispatch
  - still worth validating search richness against live site over time
- Novelty expectation vs baseline:
  - moderate; expected to contribute salary-transparent roles and compensation signal more than massive role novelty

### YC Jobs (`yc_jobs`)

- Source type: direct HTTP collector with auth-required product integration
- Auth requirement: yes at the product layer in current MVP
- Canonical review target: public company page URL (`/companies/<slug>`)
- Extracted data shape:
  - required: title, company, location, description, employmentType
  - full job description: partial
- Supported query params:
  - `title`: should not be modeled in current MVP because the source uses a fixed role route
  - `keywords`: not implemented
  - `keywordMode`: not implemented
  - `hardIncludeTerms`: not implemented
  - `includeTerms`: not implemented
  - `excludeTerms`: supported but lossy via post-capture hard filter
  - `location`: not implemented
  - `distanceMiles`: not implemented
  - `datePosted`: not implemented
  - `experienceLevel`: not implemented
  - `minSalary`: not implemented
- Known drift:
  - central source-map drift is now closed: shared builder and generic collection dispatch both support `yc_jobs`
  - product-model tension remains: auth-required onboarding is stricter than the underlying HTTP collector requires
- Novelty expectation vs baseline:
  - high; startup-specific inventory is the main reason to keep the source in MVP

## Prioritized fix list

1. `ZipRecruiter`
   - expand the modeled source map to cover the live site’s actual filter surface or explicitly narrow product claims to the currently modeled subset
   - first concrete focus:
     - `remote`
     - `employment types`
     - `apply type`
   - reason:
     - live user-visible mismatch already proven by manual search vs generated query behavior

2. `YC Jobs`
   - resolve the product-model tension between auth-required onboarding and a direct HTTP collector
   - decide whether the source should remain auth-gated for MVP product consistency or shift to no-auth with a different trust model

3. `LinkedIn`
   - continue extraction-quality and full-detail truth work
   - current source map is coherent, but extraction quality is still a meaningful trust risk

4. `Indeed`
   - keep validating degraded challenge-mode behavior against live wording changes

5. `Levels.fyi`
   - validate live-site parity for date/salary/location filters and detail enrichment quality after real runs

6. `Built In SF`
   - baseline re-verification only; no urgent source-map gap currently identified

## Reusable acceptance rules extracted from this audit

- A source is not integrated when only the adapter exists. It must also be wired into:
  - the shared query builder
  - generic collection dispatch
  - criteria-accountability output
  - source contracts
- If a criterion is folded into generic text search, report it as `supported but lossy`, not unsupported.
- If a criterion is applied only after capture, declare that explicitly as `post_capture`.
- New source types must not fall through the shared builder or shared collector silently.
- Source contracts must cover the full current product criteria surface, not a legacy subset.
