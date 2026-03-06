# Data Quality Epic: Search Fidelity, Max Import Coverage, and Structured Metadata

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, every enabled source will have explicit accountability for each provided search criterion, capture depth will be measurable against source-available totals, and imported jobs will include a normalized structured metadata object with predictable fields across boards. The user-visible effect is higher trust: searches reflect intended filters, "Found" can show progress against source availability, and extraction quality regressions become detectable quickly when source UIs change.

## Progress

- [x] (2026-03-06 22:00Z) Reviewed current URL-construction implementation in `/Users/admin/job-finder/src/sources/search-url-builder.js` and source hydration in `/Users/admin/job-finder/src/config/load-config.js`.
- [x] (2026-03-06 22:08Z) Reviewed browser capture depth and pagination logic in `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js`.
- [x] (2026-03-06 22:14Z) Reviewed normalization/storage path (`/Users/admin/job-finder/src/jobs/normalize.js`, `/Users/admin/job-finder/src/jobs/repository.js`, `/Users/admin/job-finder/src/db/migrations.js`).
- [x] (2026-03-06 22:21Z) Reviewed dashboard/source funnel metrics in `/Users/admin/job-finder/src/review/server.js`.
- [x] (2026-03-06 22:28Z) Audited representative capture payloads in `/Users/admin/job-finder/data/captures/*main.json`.
- [ ] Build and merge parallel workstreams A-E in isolated worktrees.
- [ ] Validate end-to-end data quality gates with targeted tests and one live run per enabled board.

## Surprises & Discoveries

- Observation: Criteria-to-URL mapping exists for all source types, but some fields are deliberately unsupported (for example Wellfound all criteria, Indeed experience level, BuiltIn salary/distance/experience).
  Evidence: `buildSearchUrlForSourceType(...)` in `/Users/admin/job-finder/src/sources/search-url-builder.js` returns non-empty `unsupported` arrays for these cases.

- Observation: LinkedIn has expected-count extraction plus pagination/scroll harvesting, but other boards do not yet persist `expectedCount`.
  Evidence: `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js` passes `expectedCount` only through LinkedIn write path; `/Users/admin/job-finder/src/sources/cache-policy.js` can read it when present.

- Observation: Dashboard search table labels currently conflate "Filtered" and "Dupes" with dropped counts, while "Found" is capture count without denominator.
  Evidence: `/Users/admin/job-finder/src/review/server.js` computes `filteredCount` from `droppedByHardFilterCount` and `dedupedCount` from `droppedByDedupeCount`.

- Observation: BuiltIn summary extraction already captures salary and skills from card HTML, including collapsed UI fields.
  Evidence: `/Users/admin/job-finder/src/sources/builtin-jobs.js` extracts `salaryText` from `fa-sack-dollar` and appends skills to description.

- Observation: Several non-LinkedIn sources show low metadata precision in current captures (for example title/company leakage, null postedAt, null salary/employment fields).
  Evidence: sampled payloads under `/Users/admin/job-finder/data/captures/google-main.json`, `/Users/admin/job-finder/data/captures/ashby-main.json`, `/Users/admin/job-finder/data/captures/ziprecruiter-main.json`, `/Users/admin/job-finder/data/captures/indeed-main.json`.

## Decision Log

- Decision: Implement this epic as five parallel tracks with one integration owner, rather than a single serial branch.
  Rationale: Search fidelity, capture depth, metadata normalization, and contract governance are mostly independent and benefit from separate worktrees.
  Date/Author: 2026-03-06 / Codex

- Decision: Use a single source contract registry for both search construction and extraction mappings.
  Rationale: Prevent divergence between URL filter mappings and DOM extraction mappings, and make drift tests deterministic.
  Date/Author: 2026-03-06 / Codex

- Decision: Recommend displaying Found as `imported/expected` when expected is known, with fallback to imported only when unknown.
  Rationale: This communicates progress against source availability while preserving behavior when counts are unavailable.
  Date/Author: 2026-03-06 / Codex

## Outcomes & Retrospective

Pending implementation.

## Context and Orientation

Current search criteria flow is: criteria file plus per-source overrides -> URL formatting in `/Users/admin/job-finder/src/sources/search-url-builder.js` -> source hydration/update in `/Users/admin/job-finder/src/config/load-config.js`.

Current capture flow is: browser bridge capture in `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js` -> source capture payload writer (`write*CaptureFile`) -> normalization in `/Users/admin/job-finder/src/jobs/normalize.js` -> SQLite upsert in `/Users/admin/job-finder/src/jobs/repository.js`.

Current source quality surfacing is mostly in `/Users/admin/job-finder/src/review/server.js`, which computes per-source capture funnel counts and a LinkedIn-only import verification ratio when `expectedCount` is present.

The existing source criteria design document is `/Users/admin/job-finder/docs/plans/2026-03-06-search-construction-design.md`. This epic adds extraction and governance dimensions that must remain synchronized with that document.

## Plan of Work

This work is split into five tracks designed for parallel execution in separate worktrees.

Track A (`criteria fidelity`) makes criteria accountability explicit for every source. The implementation must enforce that each provided criterion is either applied in URL construction, applied via UI bootstrap path, applied via post-capture hard filter, or explicitly marked unsupported with persisted diagnostics.

Track B (`max imports + baseline`) extends capture depth and expected-count extraction beyond LinkedIn, then persists a canonical funnel model per source run: `availableCount`, `capturedRawCount`, `postHardFilterCount`, `postDedupeCount`, and `importedCount`.

Track C (`structured metadata`) introduces a normalized job summary object and extraction quality scoring so all sources emit the required core fields with explicit nullability/quality semantics.

Track D (`contract governance`) introduces a versioned per-source contract registry and automated drift checks to detect when UI/DOM changes invalidate either search construction or extraction selectors.

Track E (`integration and UX`) merges A-D outputs into dashboard and CLI views, updates docs, and ensures `/Users/admin/job-finder/docs/plans/2026-03-06-search-construction-design.md` is updated alongside the new extraction contract content.

## Parallel Worktree Assignment

Use separate worktrees under `~/.config/superpowers/worktrees/job-finder/` and branch names prefixed with `codex/`.

Agent A (`criteria fidelity`): branch `codex/data-quality-criteria-fidelity`

Agent B (`max imports`): branch `codex/data-quality-max-imports`

Agent C (`structured metadata`): branch `codex/data-quality-structured-meta`

Agent D (`contract governance`): branch `codex/data-quality-contract-governance`

Agent E (`integration + docs`): branch `codex/data-quality-integration`

Integration order: A, B, C, D merge into E worktree; E resolves conflicts, runs full verification, and produces final PR.

## Detailed Track Specs

### Track A: Criteria Fidelity (Agent A)

Modify `/Users/admin/job-finder/src/sources/search-url-builder.js` and `/Users/admin/job-finder/src/config/load-config.js` to return a structured criteria application report per source with four buckets: `appliedInUrl`, `appliedInUiBootstrap`, `appliedPostCapture`, `unsupported`.

Persist this report in source metadata so it survives restarts and can be shown in both `jf normalize-source-urls --dry-run` and dashboard source rows.

Update tests:
- `/Users/admin/job-finder/test/search-url-builder.test.js`
- `/Users/admin/job-finder/test/source-search-criteria-bootstrap.test.js`
- `/Users/admin/job-finder/test/source-url-preview.test.js`
- add new `/Users/admin/job-finder/test/source-criteria-accountability.test.js`

Acceptance for Track A: for each source type, every provided criterion appears in exactly one accountability bucket.

### Track B: Max Imports and Baseline Counts (Agent B)

Extend browser extraction scripts in `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js` with source-specific expected count extraction where reliable (Indeed, ZipRecruiter, BuiltIn first; best-effort for others). Persist `expectedCount` for all source writers by extending `/Users/admin/job-finder/src/sources/cache-policy.js` and source write helpers.

Add/standardize pagination/scroll controls per source (`maxPages`, `maxScrollSteps`, `maxIdleScrollSteps`) including LinkedIn support in schema/config.

Persist funnel counts in capture payload metadata for each run.

Update tests:
- `/Users/admin/job-finder/test/linkedin-expected-count.test.js`
- add `/Users/admin/job-finder/test/source-expected-count.test.js`
- add `/Users/admin/job-finder/test/source-capture-funnel.test.js`
- update `/Users/admin/job-finder/test/sources-schema.test.js`

Acceptance for Track B: dashboard API inputs include both numerator and denominator fields for Found and import verification across supported sources.

### Track C: Structured Metadata Model and Extraction Quality (Agent C)

Add structured metadata model in normalization path by modifying:
- `/Users/admin/job-finder/src/jobs/normalize.js`
- `/Users/admin/job-finder/src/jobs/repository.js`
- `/Users/admin/job-finder/src/db/migrations.js`

Required normalized object fields (core): `title`, `company`, `location`, `freshness`, `salary`, `description`, `employmentType`.

Optional normalized fields: `workModel`, `skills`.

`freshness` must include both raw and parsed value (`rawText`, `postedAtIso`, `relativeDays`). `salary` must include at least `rawText`, plus parsed numeric bounds when possible.

Add extraction-quality metadata per job record (for example `metadataQualityScore`, `missingRequiredFields`) to support source-level quality metrics.

Upgrade source parsers in:
- `/Users/admin/job-finder/src/sources/builtin-jobs.js`
- `/Users/admin/job-finder/src/sources/google-jobs.js`
- `/Users/admin/job-finder/src/sources/ashby-jobs.js`
- `/Users/admin/job-finder/src/browser-bridge/providers/chrome-applescript.js`

Update tests:
- `/Users/admin/job-finder/test/normalize-dedupe.test.js`
- add `/Users/admin/job-finder/test/normalize-structured-meta.test.js`
- add `/Users/admin/job-finder/test/source-extraction-quality.test.js`

Acceptance for Track C: each imported job has a structured metadata payload and explicit quality markers for missing required fields.

### Track D: Source Contract Governance and Drift Detection (Agent D)

Create source contract registry files (one source of truth for both search and extraction mappings):
- `/Users/admin/job-finder/config/source-contracts.json` (or equivalent under `docs/analysis/` if config coupling is undesirable)
- `/Users/admin/job-finder/src/sources/source-contracts.js`

Each source contract must define:
- criteria mapping method (`url`, `ui_bootstrap`, `post_capture`, `unsupported`)
- extraction field selectors/parsing strategy
- expected-count strategy
- pagination strategy
- last-verified timestamp and contract version

Add drift-check command (CLI) that validates contract selectors against captured HTML/snapshots and reports contract health.

Update docs:
- `/Users/admin/job-finder/docs/plans/2026-03-06-search-construction-design.md` (reference contract registry and remove duplicated static mapping text that can drift)
- add `/Users/admin/job-finder/docs/analysis/source-contract-governance.md`

Update tests:
- add `/Users/admin/job-finder/test/source-contracts.test.js`
- add `/Users/admin/job-finder/test/source-contract-drift-check.test.js`

Acceptance for Track D: one command can report which source mappings are stale or broken.

### Track E: Integration, Dashboard UX, and Documentation (Agent E)

Integrate Track A-D outputs into `/Users/admin/job-finder/src/review/server.js` and CLI surfaces.

Dashboard/Searches table recommendation:
- Found column displays `importedCount/expectedCount` when expected is known.
- Found column displays `importedCount` when expected is unknown.
- Keep advanced funnel columns (`captured`, `hard-filter dropped`, `dedupe dropped`, `imported`) available in expanded row/details.

Update render and API tests:
- `/Users/admin/job-finder/test/dashboard-refresh-status.test.js`
- add `/Users/admin/job-finder/test/dashboard-source-quality-metrics.test.js`
- add `/Users/admin/job-finder/test/review-searches-found-ratio.test.js`

Update documentation:
- `/Users/admin/job-finder/README.md`
- `/Users/admin/job-finder/docs/backlog.md` (status updates or follow-on tasks)
- ensure `/Users/admin/job-finder/docs/plans/2026-03-06-search-construction-design.md` and new governance doc remain aligned.

Acceptance for Track E: user can see per-source criteria accountability, Found denominator when available, and source data quality status in one place.

## Concrete Steps

Working directory for all commands: `/Users/admin/job-finder`.

1. Create worktrees.

    git fetch origin
    mkdir -p ~/.config/superpowers/worktrees/job-finder
    git worktree add ~/.config/superpowers/worktrees/job-finder/data-quality-criteria -b codex/data-quality-criteria-fidelity
    git worktree add ~/.config/superpowers/worktrees/job-finder/data-quality-imports -b codex/data-quality-max-imports
    git worktree add ~/.config/superpowers/worktrees/job-finder/data-quality-meta -b codex/data-quality-structured-meta
    git worktree add ~/.config/superpowers/worktrees/job-finder/data-quality-contracts -b codex/data-quality-contract-governance
    git worktree add ~/.config/superpowers/worktrees/job-finder/data-quality-integration -b codex/data-quality-integration

2. In each worktree, run baseline tests before edits.

    npm test -- test/search-url-builder.test.js test/source-search-criteria-bootstrap.test.js test/normalize-dedupe.test.js test/sources-schema.test.js

3. Execute each track and keep commits scoped to track-owned files.

4. Integration worktree cherry-picks each track branch, resolves conflicts, and runs full verification.

    npm test

5. Run live proof pass (minimum one source per major capture type).

    node src/cli.js capture-source-live "LinkedIn Main" --force-refresh
    node src/cli.js capture-source-live "Indeed Main" --force-refresh
    node src/cli.js capture-source-live "BuiltIn Main" --force-refresh

Expected observable output after integration: Found ratios and criteria accountability visible in dashboard source rows; capture payloads include standardized funnel metadata.

## Validation and Acceptance

Goal 1 (Quality Searches): For each source type, a test fixture with full criteria set must demonstrate every field is either applied or explicitly unsupported with reason. No silent drops.

Goal 2 (Max Imports): Capture payload must include `expectedCount` when detectable and always include `capturedRawCount`, `postHardFilterCount`, `postDedupeCount`, `importedCount`. Dashboard Found must consume these fields.

Goal 3A (Structured metadata): Every imported job includes required structured fields with deterministic null handling; optional fields tracked when present. Extraction quality metrics are computed per source run.

Goal 3B (Ongoing maintenance): Contract drift command must fail loudly when selectors/mappings break and must reference the same source contract data used by search construction docs.

## Idempotence and Recovery

All track changes are additive and safe to rerun. If a track drifts into another track’s owned files, stop and re-scope before merge to reduce conflict risk.

If live capture verification is rate-limited or challenged, use existing safe/probe refresh policy controls and rely on fixture/snapshot tests for non-live verification.

If contract drift checks fail due transient UI changes, record failures in `Surprises & Discoveries`, mark affected source contract version as stale, and keep unsupported mapping explicit until selectors are repaired.

## Artifacts and Notes

Normalized metadata object shape (target):

    {
      title: string,
      company: string,
      location: string | null,
      freshness: {
        rawText: string | null,
        postedAtIso: string | null,
        relativeDays: number | null
      },
      salary: {
        rawText: string | null,
        minAnnualUsd: number | null,
        maxAnnualUsd: number | null,
        period: "hour" | "year" | "unknown"
      },
      description: {
        summary: string,
        fullText: string | null,
        source: "card" | "detail"
      },
      employmentType: "full_time" | "part_time" | "contract" | "internship" | "temporary" | "unknown",
      workModel: "remote" | "hybrid" | "onsite" | "unknown",
      skills: string[],
      metadataQualityScore: number,
      missingRequiredFields: string[]
    }

Found metric recommendation for Searches table:

    Found = importedCount/expectedCount (when expectedCount != null)
    Found = importedCount (when expectedCount == null)

## Interfaces and Dependencies

No external service dependency is required for implementation, but live verification depends on browser bridge provider configuration and source availability.

Core interfaces to add or extend:

- `deriveCriteriaAccountability(source, criteria) -> { appliedInUrl, appliedInUiBootstrap, appliedPostCapture, unsupported, notes }`
- `buildSourceCaptureMetrics(payload, source) -> { expectedCount, capturedRawCount, postHardFilterCount, postDedupeCount, importedCount }`
- `normalizeStructuredJobMeta(rawJob, sourceType) -> StructuredJobMeta`
- `runSourceContractDriftCheck({ sourceId? }) -> { status, failures, warnings, verifiedAt }`

Plan revision note (2026-03-06): Initial multi-agent ExecPlan created from codebase review for Data Quality Epic, including explicit worktree split and governance path tying extraction mapping to existing search-construction design.
