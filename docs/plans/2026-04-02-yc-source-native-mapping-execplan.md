# YC Source-Native Mapping Recovery

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

`YC Jobs` currently breaks the product promise in a straightforward way: Job Finder says it is searching for a specific role, location, salary floor, and recency window, but the current YC adapter ignores almost all of that and simply captures the generic YC jobs feed. The result is a queue full of engineering and founding roles that do not resemble the user’s search. After this change, `YC Jobs` will follow the same source-mapping model as the rest of the MVP slate: first inventory the source’s native query/filter surface, then map overlapping universal Job Finder criteria into that surface honestly, and finally leave only truly non-overlapping or unsupported criteria to post-capture evaluation. A user should be able to run the canonical PM + AI + San Francisco search and see YC return a product-shaped result set rather than a generic startup jobs inventory.

## Progress

- [x] (2026-04-02 19:34Z) Re-read `PLANS.md`, current learnings, the active source-regression ExecPlan, `src/sources/yc-jobs.js`, `src/sources/search-url-builder.js`, and the current `yc_jobs` contract in `config/source-contracts.json`.
- [x] (2026-04-02 19:41Z) Recorded the corrected design premise from stakeholder feedback in `docs/learnings.md`: source mapping must start from a complete source-native query/data inventory and split parameters into `universal` and `non-universal`, not ad hoc route shortcuts.
- [ ] Write the source-native YC mapping inventory into this plan and update the source-regression parity matrix to reflect the revised recovery path.
- [ ] Add failing tests for YC query construction, source contract accountability, and extraction narrowing.
- [ ] Implement native YC query-state mapping in `src/sources/search-url-builder.js`.
- [ ] Implement YC extraction/capture alignment in `src/sources/yc-jobs.js` so the captured set reflects the mapped search state.
- [ ] Update `config/source-contracts.json` to reflect the real native/post-capture split for YC.
- [ ] Verify live YC behavior in QA and update roadmap/progress docs with evidence.

## Surprises & Discoveries

- Observation: the earlier route-only recovery idea was too conservative.
  Evidence: stakeholder-provided YC screenshot shows a logged-in source-native filter surface with fields for search text, commitment, role, company size, industry, experience, location, remote, company stage, and salary/equity/interview-process toggles.

- Observation: the current code and contract materially understate YC capability.
  Evidence: `src/sources/search-url-builder.js` marks `title`, `keywords`, `location`, `datePosted`, `minSalary`, and `experienceLevel` unsupported for `yc_jobs`, while the live product evidence shows native controls for several overlapping fields.

## Decision Log

- Decision: treat `YC Jobs` as a source with a native query/filter surface, not as a fixed-route feed with mostly post-capture filtering.
  Rationale: the live YC UI exposes explicit search and filter controls, so the current “unsupported” contract is a modeling failure, not a source limitation.
  Date/Author: 2026-04-02 / Codex

- Decision: use the repository-wide source-mapping model for YC: inventory the real query surface first, then classify fields into `universal` and `non-universal`, and only then choose `native`, `approximation`, `post_capture`, or `unsupported` per universal field.
  Rationale: this makes the YC adapter extensible to other users and searches instead of baking in another one-off PM route shortcut.
  Date/Author: 2026-04-02 / Codex

## Outcomes & Retrospective

This plan is newly created. No implementation outcome exists yet. The immediate outcome of this planning pass is a corrected design target: recover `YC Jobs` by honoring the source’s native search surface, not by hiding behind a simplified route-family approximation.

## Context and Orientation

The current YC adapter spans three main files. `src/sources/search-url-builder.js` is the shared builder that turns Job Finder criteria into a source-native URL or search state and emits `criteriaAccountability`, which is the internal explanation of which fields were applied in URL, applied in UI bootstrap, applied post-capture, or unsupported. `src/sources/yc-jobs.js` is the source-specific parser for the HTML/payload returned by YC. Right now it extracts jobs from a generic payload and has a narrow guard that only filters to product roles when the search URL already uses the special `/jobs/l/product-manager` route. `config/source-contracts.json` is the checked-in source contract that declares which Job Finder criteria map natively and what the extractor is expected to return. Right now the contract and builder both claim YC ignores almost everything, which conflicts with the source-native UI the user showed.

The relevant existing tests are `test/yc-jobs.test.js`, `test/yc-capture.test.js`, `test/source-criteria-accountability.test.js`, `test/search-url-builder.test.js`, and `test/source-contracts.test.js`. Those tests currently encode the old assumption that YC is mostly unsupported. They will need to be updated so they fail until the new mapping is implemented.

This change must stay within the product’s established source-mapping model. In this repository, `universal` parameters are Job Finder concepts that should map across sources when possible: search text/title, hard include terms, location, date posted, salary floor, remote/work mode, employment type, and experience level. `Non-universal` parameters are source-specific extras that exist only on one source or have no matching Job Finder control today, such as YC’s company stage or “has interview process” toggles. Universal parameters must then be classified per source as `native`, `approximation`, `post_capture`, or `unsupported`.

## Plan of Work

First, inventory the real YC search/filter surface in source terms and write that inventory into this plan before code changes. The relevant visible controls from the stakeholder screenshot are: free-text search, commitment, role, company size, industry, experience, location, remote, company stage, and boolean checkboxes for salary range, equity range, interview process, visa not required, and founder details. For each of these, determine whether it overlaps a current Job Finder concept. The overlap classification should be:

- `search text` -> universal (`title`, `keywords`, `hardIncludeTerms`, `includeTerms`, `keywordMode`)
- `commitment` -> universal (`employmentType`)
- `role` -> universal (`title` intent / role family approximation)
- `location` -> universal (`location`)
- `remote` -> universal (`remote/work mode`, which Job Finder does not yet expose but should still be represented in the source map as latent capability)
- `experience` -> universal (`experienceLevel`)
- `company size`, `industry`, `company stage`, `has salary range`, `has equity range`, `has interview process`, `US visa not required`, `show founder details` -> non-universal for now

Second, convert the current YC builder from “everything unsupported” to an honest native/post-capture split. The builder in `src/sources/search-url-builder.js` should stop returning the fixed generic URL with an unsupported list for all fields. Instead, it should build a base YC jobs URL and attach a `uiBootstrap` description (or the existing equivalent notes/accountability structure) that tells the browser capture path how to set the source-native search text and filter controls for the overlapping universal parameters. This is important because YC is auth-required and filter state is likely stored in the app, not just in static URL params. The plan does not assume the final implementation is URL-only. It assumes source-native state can be applied either through stable query parameters or through deterministic UI bootstrap if the source requires it.

Third, update the YC extraction path in `src/sources/yc-jobs.js` so it no longer depends on the special `/jobs/l/product-manager` route to decide whether product-role narrowing should apply. The narrowing should follow the actual mapped search state instead. If the current Job Finder search asks for product-manager intent, then product-role filtering must be enforced regardless of whether the source reached that state through a route, query string, or UI bootstrap. This can be represented by passing an explicit parsed search-state object into `parseYcJobsHtml()` rather than inferring intent from the URL shape alone.

Fourth, update the contract in `config/source-contracts.json` and the contract/accountability tests. The new contract should explicitly separate:

- native universal mappings that YC can support today (`title/search text`, `location`, possibly `experienceLevel`, possibly `employmentType`)
- approximations (`title` role-family mapping through YC’s role taxonomy if the text search is not enough)
- post-capture universal fields that YC still lacks direct support for (`datePosted`, `minSalary`, hard excludes if no native equivalent exists)
- non-universal latent capabilities that are not exposed by Job Finder yet (`company stage`, `has equity range`, etc.)

Fifth, add a QA-proof baseline for YC. The acceptance evidence should not just be tests. It must include a live YC run in `/Users/admin/job-finder` showing that the canonical PM + AI + San Francisco search yields a product-shaped set rather than generic engineer/founder roles. The fresh capture should be compared against the pre-fix persisted examples from the parity matrix, which included `Founding Engineer` and `Full Stack Software Engineer`.

## Concrete Steps

1. In `/Users/admin/.codex/worktrees/51f6/job-finder`, update this ExecPlan with the explicit universal/non-universal YC inventory described above, and append a note to `docs/analysis/2026-04-02-mvp-source-parity-matrix.md` saying that YC recovery is now based on source-native mapping rather than the earlier route-only idea.

2. Add failing tests:

   - In `test/search-url-builder.test.js`, add a YC-specific case that proves the builder no longer returns a generic unsupported-only result when given the canonical QA criteria.
   - In `test/source-criteria-accountability.test.js`, update the `yc_jobs` expectation so overlapping native fields are not all marked unsupported.
   - In `test/yc-jobs.test.js`, add a case that proves product-role narrowing follows explicit search intent/state rather than only the `/jobs/l/product-manager` route string.
   - If needed, add a small new test file such as `test/yc-native-mapping.test.js` to cover the universal/non-universal mapping helper without polluting the generic builder suite.

3. Implement the minimal builder change in `src/sources/search-url-builder.js`:

   - add a YC-specific helper that builds source-native search state from Job Finder criteria
   - express overlapping universal fields in `criteriaAccountability` as `appliedInUrl`, `appliedInUiBootstrap`, `appliedPostCapture`, or `unsupported`
   - keep non-universal YC filters out of Job Finder mapping for now, but document them in notes or contract metadata as latent capability

4. Implement the matching parser/capture change in `src/sources/yc-jobs.js`:

   - stop inferring product-role intent only from the route string
   - accept a normalized search-state/input object so the parser can apply role-family narrowing consistently
   - preserve job-level identity (`/jobs/<id>`) and existing extraction shape

5. Update `config/source-contracts.json` for `yc_jobs`:

   - revise `contractVersion`
   - replace the current all-unsupported criteria mapping with the honest native/post-capture split
   - do not claim unsupported for fields that the live YC UI clearly exposes

6. Run targeted verification in `/Users/admin/.codex/worktrees/51f6/job-finder`:

   - `node --test test/yc-jobs.test.js test/search-url-builder.test.js test/source-criteria-accountability.test.js test/source-contracts.test.js`
   - `node -c src/sources/yc-jobs.js`
   - `node -c src/sources/search-url-builder.js`
   - `npm run dashboard:web:build`

7. Fold the controller changes into `/Users/admin/job-finder`, rerun the live QA search, and capture evidence:

   - `npm run review:stop`
   - `npm run review:qa`
   - trigger `YC Jobs` from the QA UI or run `node src/cli.js run --force-refresh`
   - inspect `/Users/admin/job-finder/data/captures/yc-product-jobs.json`
   - inspect the latest `source_run_deltas` row for `yc-product-jobs`
   - compare the top captured/persisted rows against the pre-fix off-target examples in the parity matrix

## Validation and Acceptance

This work is complete only when all of the following are true:

- the YC source contract no longer claims nearly all universal parameters are unsupported
- the builder/accountability tests prove that overlapping universal YC fields are mapped natively or honestly marked post-capture
- a live QA YC run for the canonical criteria no longer returns a queue dominated by `Founding Engineer` / generic engineering roles
- the fresh YC capture and source row together make sense: the source is clearly applying product-role / search-text narrowing before post-capture scoring
- docs are updated so the parity matrix and progress notes reflect the revised source-native YC mapping model

## Idempotence and Recovery

This plan is safe to execute incrementally. The contract and builder changes are additive and testable before the QA rerun. If the live YC UI turns out to require a browser-side bootstrap step instead of a static URL/query-param mapping, keep the builder/accountability changes and extend the capture path rather than rolling back to “unsupported.” If a live QA rerun still produces generic engineering roles, preserve the capture artifact and source-row evidence and update this plan instead of hiding the failure behind post-capture filtering.

## Artifacts and Notes

Current evidence that motivates this work:

    Current generated YC URL:
      https://www.workatastartup.com/jobs

    Current contract (`config/source-contracts.json`):
      title, keywords, location, datePosted, experienceLevel, minSalary = unsupported

    Current persisted YC examples from `docs/analysis/2026-04-02-mvp-source-parity-matrix.md`:
      Founding Engineer
      Founding Full Stack AI Engineer
      Full Stack Software Engineer

    Stakeholder-provided live YC filter surface:
      Search
      Commitment
      Role
      Company size
      Industry
      Experience
      Location
      Remote
      Company stage
      Has salary range / Has equity range / Has interview process / US visa not required / Show founder details

This evidence is enough to justify treating the current YC adapter as under-modeled rather than constrained by the source.

## Interfaces and Dependencies

The main interfaces after this work should be:

- `buildSearchUrlForSourceType("yc_jobs", criteria, options)` in `src/sources/search-url-builder.js`
  - must return a source-native YC search state with honest accountability, not a generic unsupported-only result
- `parseYcJobsHtml(html, searchStateOrUrl)` in `src/sources/yc-jobs.js`
  - must apply role-family/search-intent narrowing based on explicit mapped search state, not only route-string detection
- `config/source-contracts.json`
  - must describe the real native/post-capture split for YC universal fields

Revision note (2026-04-02): created after stakeholder clarification that YC exposes a source-native search/filter UI and should be modeled under the same universal/non-universal source-mapping framework as the rest of the MVP slate, replacing the earlier route-only recovery idea.
