# Source Data Quality Pass: Review Targets, Source Metrics, and Score Sanity

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the dashboard source table will report believable `Found`, `Filtered`, `Imported`, and `Avg Score` values for the current source run, job review links will open the correct destination instead of fabricated LinkedIn pages, and score output will be interpretable enough that a user can trust the ranking system. A user should be able to run `jf review`, inspect source rows, and understand why a source shows low imports or low scores without seeing impossible combinations like `0/0 found` with a non-null average score.

This pass must also prove that source-specific search construction is semantically correct for each active source. Reliable data quality is not achievable if search URLs or discovery flows are too broad, malformed, or only weakly aligned with the user's criteria. The fix bar is therefore not just "clean up bad rows after capture"; it is "stop generating garbage input upstream."

This pass must also leave behind reusable source-addition artifacts. MVP source work is not complete if it only fixes today's six sources. Each source lane should clarify:

- the source type pattern it belongs to
- what search-construction mapping is required
- the minimum extraction contract
- how canonical review targets are preserved
- what degradation states are acceptable
- which tests prove the source is trustworthy

The controller is responsible for collecting those artifacts as lane outputs are integrated so this work compounds into the future `add a source` workflow.

## Progress

- [x] (2026-03-20 18:11Z) Controller re-scoped the active execution model to the approved six-source MVP slate: LinkedIn, Built In SF, Indeed, ZipRecruiter, YC Jobs, and Levels.fyi. Google and Ashby were moved out of active MVP implementation scope.
- [x] (2026-03-20 09:18Z) User approved six concrete workstreams for this pass: run-all resilience, last-attempted/error reporting, Cloudflare challenge classification, LinkedIn extraction repair, Ashby narrowing, and Indeed expected-count suppression.
- [x] (2026-03-19 22:05Z) Reproduced the reported anomalies from the live dashboard: LinkedIn review targets broken, BuiltIn showing `0/0` with `Avg score 35`, Ashby showing `1/0` with `483 filtered`, Indeed showing `21/200000`, and Google showing `0/0` with a non-null score.
- [x] (2026-03-19 22:12Z) Inspected `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js` source-row assembly and confirmed current-run capture funnel stats are being mixed with historical database counts and score totals.
- [x] (2026-03-19 22:18Z) Inspected `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/cache-policy.js` and live capture summaries; confirmed BuiltIn, Ashby, and Google capture payloads currently record unknown expected counts as `null`, while Indeed persists a bogus `expectedCount` of `200000`.
- [x] (2026-03-19 22:22Z) Inspected `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js` review-target logic and confirmed any numeric `externalId` currently produces a synthetic LinkedIn job URL, regardless of source type.
- [x] (2026-03-19 23:04Z) Added regression coverage for review-target routing, unknown expected counts, imported-score averaging, implausible expected-count suppression, semantic hard include/exclude matching, and LinkedIn title/salary cleanup.
- [x] (2026-03-19 23:19Z) Fixed review-target routing so only LinkedIn sources synthesize LinkedIn direct/search URLs; non-LinkedIn numeric ids now preserve their own source URLs or resolve to `unavailable`.
- [x] (2026-03-19 23:26Z) Fixed source-row reporting semantics so unknown expected counts remain unknown, bogus Indeed expected counts are suppressed, and source avg score derives only from currently imported hashes rather than historical DB fallback totals.
- [x] (2026-03-19 23:42Z) Wired shared LinkedIn cleanup into scoring and queue hydration; semantic hard-filter matching now uses the same term-family matcher as source-side filtering, which raises valid matches without score-weight inflation.
- [x] (2026-03-19 23:49Z) Ran targeted tests, full `npm test`, and React build verification. Direct DB/module inspection confirmed the root cause of low averages is hard-filter zeroes, not universally weak scoring weights.
- [x] (2026-03-20 00:02Z) Applied post-review regression fixes: LinkedIn cleanup now no-ops for non-LinkedIn jobs, and canonical LinkedIn direct URLs with query params remain direct review targets.
- [x] (2026-03-20 17:22Z) Controller reviewed and integrated returned lane `L1` (LinkedIn). Verified that hard include terms participate in LinkedIn query construction and that the polluted company/description cleanup changes are present; targeted verification passed (`20/20`).
- [x] (2026-03-20 17:29Z) Controller reviewed and integrated returned lane `L3` (Indeed/reporting). Verified Cloudflare / `additional verification needed` challenge classification, bogus expected-count suppression, and latest-attempt vs last-success metadata with targeted verification passing (`22/22`).
- [x] (2026-03-20 20:07Z) Controller verified and marked lane `L3` (ZipRecruiter deep links) integrated. Posting-specific `lk=` / `uuid` identity survives normalization and review-target resolution; combined targeted verification covering Zip deep links, normalization, Built In baseline guard, source reporting, and refresh-state semantics passed (`25/25`).
- [x] (2026-03-20 20:07Z) Controller verified and marked lane `L6` (Built In baseline guard) integrated. The baseline rubric artifact is present and the direct non-auth baseline guard tests pass in the controller branch.
- [x] (2026-03-21 00:32Z) Controller closed the completed integrated lanes (`L1`, `L2`, `L3`, `L6`) and updated roadmap artifacts to reflect true inventory. Remaining active work is limited to the two launch-build lanes: `YC Jobs` and `Levels.fyi`.
- [ ] (2026-03-21 00:35Z) Reassign freed worker capacity onto the two remaining launch-build lanes with disjoint ownership (adapter path vs registration/tests) so the controller is actively moving MVP scope instead of passively polling workers.
- [x] (2026-03-21 00:47Z) Controller updated the execution model so every MVP source lane must return reusable source-type artifacts (search-construction notes, extraction contract, degradation semantics, and verification pattern) alongside code.
- [ ] (2026-03-20 19:05Z) Scoped lane `L5` as a direct HTTP source build for Levels.fyi. Approved assumption: if the search page is thin, the adapter may perform source-specific detail-page enrichment as long as the canonical Levels.fyi detail URL remains the review target and the scope stays MVP-tight.
- [x] (2026-03-20 18:18Z) Controller completed the MVP-scope Indeed lane re-check. Current branch already satisfies the degraded-but-honest gate: challenge classification, bogus-total suppression, and latest-attempt reporting all verified in a fresh targeted suite (`30/30`). Remaining risk is live wording variance on new challenge pages.

## Surprises & Discoveries

- Observation: `resolveReviewTarget(job)` treats any numeric `externalId` as a LinkedIn job id, even when the job came from BuiltIn, Indeed, or another source.
  Evidence: `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js:485-490` returns `https://www.linkedin.com/jobs/view/<externalId>/` whenever `/^\d+$/` matches.

- Observation: source-row `avgScore` currently falls back to historical database score totals whenever the current import funnel has zero scored imports.
  Evidence: `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js:1602-1606` uses `counts.scoreTotal / counts.scoredCount` when `importedScoredCount` is zero.

- Observation: source-row expected-count handling treats unknown denominators as zero in the React payload layer even though the capture summary stores them as `null`.
  Evidence: `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js:5241-5243` computes `expectedFoundCount` from `source.captureExpectedCount`, and the live payload shows `captureExpectedCount: 0` for sources that actually had unknown expected counts.

- Observation: Ashby’s large filtered count is real current-run funnel data rather than a display bug; the display bug is the denominator (`1/0`) and the lack of clarity that `483` were dropped by hard filters.
  Evidence: live `/api/dashboard` payload showed `captureJobCount: 484`, `droppedByHardFilterCount: 483`, `importedCount: 1`.

- Observation: several source adapters appear to be failing upstream at source-specific search construction, not just downstream at extraction. Broad or semantically wrong search URLs/discovery flows are producing polluted result sets that hard filters then clean up after the fact.
  Evidence: Ashby current capture file contains `518` raw jobs from broad board discovery with only `1` imported; Google current search returns `0` jobs; LinkedIn current capture returns only `5` rows and several are off-target role families.

- Observation: Google Jobs is a filtered jobs surface, not generic SERP scraping, when the correct Google Jobs state is constructed. The current Google failures are implementation defects in source-specific URL/state construction and DOM extraction rather than evidence that the source concept is inherently low-value.
  Evidence: user-provided Google Jobs URL and screenshot show a stable Jobs-tab experience with applied filters and real job cards, while the current adapter only reconstructs a lightweight `udm=8` query and relies on brittle widget extraction.

- Observation: Indeed’s `200000` denominator is not a rendering typo; it is persisted into capture metadata and then surfaced directly.
  Evidence: `readSourceCaptureSummary(...)` in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/cache-policy.js` returned `expectedCount: 200000` for `indeed-ai-pm` from the local capture file.

- Observation: persisted LinkedIn rows are genuinely malformed before they ever reach the dashboard: duplicated titles, company/title collisions, and implausible salaries such as `$60M` and `$100M`.
  Evidence: direct SQLite inspection of `jobs where source_id='linkedin-live-capture'` returned rows like `"Principal Product Manager Principal Product Manager ..."` with `company="Principal Product Manager"` and `salary_text="$60M"`.

- Observation: low source averages are primarily a hard-filter accounting artifact. When hard-filtered zeroes are removed, the kept-job averages are much healthier.
  Evidence: direct reevaluation against current search criteria produced per-source `avgScoreAll / avgScoreKept` pairs of BuiltIn `32 / 55`, Google `19 / 48`, LinkedIn `8 / 45`, and ZipRecruiter `5 / 75`, with the low averages driven by large counts of `hardFiltered` zero-score rows.

- Observation: Built In is the cleanest direct non-auth reference source for this repo.
  Evidence: the current `builtin-sf-ai-pm` capture file contains 25 plausible PM jobs, `expectedCount: null`, and stable salary/location/title metadata without auth/browser challenge noise. That is the closest existing example of the source class Levels.fyi should satisfy.

## Decision Log

- Decision: Treat source-table metrics as current-run funnel reporting, not mixed lifetime reporting.
  Rationale: Users read `Found`, `Filtered`, `Imported`, and `Avg Score` as one coherent run summary; mixing historical database averages into those cells creates impossible combinations and destroys trust.
  Date/Author: 2026-03-19 / Codex

- Decision: Preserve unknown expected counts as unknown (`?`) instead of coercing them to zero.
  Rationale: A zero denominator reads as a logic error. Unknown source availability is honest and already supported elsewhere in the product language.
  Date/Author: 2026-03-19 / Codex

- Decision: Restrict LinkedIn URL synthesis to actual LinkedIn sources or canonical LinkedIn URLs.
  Rationale: Numeric `externalId` is not globally meaningful. It only becomes a LinkedIn review target when the job source is LinkedIn or the stored URL is already a valid LinkedIn URL.
  Date/Author: 2026-03-19 / Codex

- Decision: Centralize LinkedIn row cleanup in a shared module and apply it in both capture-time extraction and read-time evaluation.
  Rationale: Existing user databases already contain malformed LinkedIn rows. Fixing only the capture path would leave current review/score output broken until the user manually re-captures every source.
  Date/Author: 2026-03-19 / Codex

- Decision: Do not change score weights in this pass.
  Rationale: The current evidence shows low source averages are driven by hard-filter zeroes and polluted LinkedIn text, not by an intrinsically broken weight model. Fixing the data path first is lower risk than inflating weights.
  Date/Author: 2026-03-19 / Codex

- Decision: Suppress Indeed `expectedCount` entirely for MVP until the extractor can prove the value is trustworthy.
  Rationale: The live parser currently emits absurd totals such as `200000`; showing that denominator is worse than admitting the board total is unknown.
  Date/Author: 2026-03-20 / Codex

- Decision: Keep `run-all` best-effort per source and always complete final sync for sources that already succeeded.
  Rationale: One live-source failure should not erase earlier success or prevent file-backed sources from refreshing into the queue.
  Date/Author: 2026-03-20 / Codex

- Decision: Distinguish `last attempted` / `last error` from `last successful`.
  Rationale: Users need to understand fresh failed attempts without losing the last known-good run timestamp.
  Date/Author: 2026-03-20 / Codex

- Decision: Treat Cloudflare / `additional verification needed` as challenge states.
  Rationale: Those failures are user-actionable and should not be collapsed into generic transient errors.
  Date/Author: 2026-03-20 / Codex

- Decision: Treat source-specific search construction as part of the data-quality root cause, not as a separate future enhancement.
  Rationale: If a source query is too broad or malformed, downstream filtering, scoring, and dedupe cannot produce trustworthy data quality.
  Date/Author: 2026-03-20 / Codex

- Decision: Split active source work by source type rather than treating all sources as one class.
  Rationale: Built In, Google, Ashby, and auth browser sources fail in materially different ways. The correct MVP path is to stabilize the reliable baseline first, then fix auth-source and outlier behavior with source-specific tactics.
  Date/Author: 2026-03-20 / Codex

- Decision: Google is not part of the approved six-source MVP slate.
  Rationale: Even though Google Jobs can be treated as a real source adapter, the approved launch slate is LinkedIn, Built In SF, Indeed, ZipRecruiter, YC Jobs, and Levels.fyi. Google should not consume MVP source-quality implementation effort unless explicitly promoted into the slate.
  Date/Author: 2026-03-20 / Codex

- Decision: Treat Ashby as a source-novelty spike, not just a bugfix lane.
  Rationale: The value hypothesis for company-board portals is unique job discovery. The correct acceptance bar is therefore novelty versus redundancy, plus feasibility/cost. If Ashby is mostly redundant or too brute-force to sustain, it should not remain in the MVP set.
  Date/Author: 2026-03-20 / Codex

- Decision: Adopt the approved six-source MVP slate as the active source policy for this pass.
  Rationale: MVP source-quality work should improve launch sources and their blockers, not blur in out-of-scope sources. The active launch slate is LinkedIn, Built In SF, Indeed, ZipRecruiter, YC Jobs, and Levels.fyi. Ashby, Wellfound, Greenhouse, and RemoteOK remain out of MVP.
  Date/Author: 2026-03-20 / Codex

- Decision: Allow Levels.fyi to use direct detail-page enrichment when the search page is too thin to carry salary-rich metadata.
  Rationale: The user explicitly approved a bounded direct-enrichment path as long as the canonical Levels.fyi detail URL remains the review target. This keeps the adapter useful without turning it into a broad crawler or an auth-browser source.
  Date/Author: 2026-03-20 / Codex

## Outcomes & Retrospective

Implemented and verified.

Behaviorally, this pass fixes three separate trust failures:

- Source reporting now keeps unknown denominators unknown and suppresses bogus expected counts from noisy capture extractors such as Indeed.
- Review-target routing no longer fabricates LinkedIn URLs for non-LinkedIn jobs that happen to have numeric external ids.
- LinkedIn cleanup is shared across capture, queue hydration, and scoring, which prevents malformed titles / companies / salaries from poisoning current review output and reevaluation.

Verification evidence:

- Targeted regression suite:
  - `node --test test/score-search-criteria.test.js test/linkedin-chrome-extraction.test.js test/review-source-data-quality.test.js test/source-expected-count.test.js`
- Full test suite:
  - `npm test` → `304` passing, `0` failed
- React build:
  - `npm run dashboard:web:build` → passed
- Direct module/data inspection:
  - capture summary inspection now reports `expectedCount: null` for BuiltIn, Ashby, Indeed, and Google instead of coercing unknowns to `0` or leaving Indeed at `200000`
  - reevaluation against current criteria shows that low averages are mostly caused by hard-filter zeroes rather than uniformly poor kept-job scores

## Context and Orientation

The dashboard source table is assembled in `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`. That file builds both the API payload for the React dashboard and the legacy HTML table. The relevant path starts when `loadDashboardState()` prepares `sources`, then maps each source into row metrics using capture summaries from `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/cache-policy.js` and persisted job counts/scores from the SQLite database.

A “capture summary” is the most recent raw source harvest written to a file under `data/captures/`. It contains the number of jobs captured from the source, an optional expected total available on that board, and optional funnel counts that describe how many jobs were dropped by hard filters or deduplication. These numbers are current-run facts.

Database counts in `countsBySourceId` are lifetime facts about jobs currently stored in SQLite for that source. They include active, applied, skipped, rejected, and scored jobs. Those numbers are useful for queue and archive views, but they should not silently replace current-run funnel numbers.

Job review links are also assembled in `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js` through `resolveReviewTarget(job)`. That function decides whether a job should open as a direct job page or a search results page. Right now it over-assumes that any numeric `externalId` belongs to LinkedIn, which is not true for this repository because several boards emit numeric identifiers.

The raw job scoring algorithm lives in `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/score.js`. It combines title matching, keyword matching, salary floor checks, freshness, metadata confidence, and work-type matching. The user’s complaint that scores are generally low may be a real calibration issue, or it may reflect that score averages are being computed from sparse/highly penalized subsets. The fix must distinguish those cases before changing weights.

Source-specific search construction lives primarily in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/search-url-builder.js` plus source adapters such as `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/ashby-jobs.js` and `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`. This pass now explicitly includes validating that each active source is being queried in a way that is both syntactically valid for that source and semantically aligned with the user's criteria.

For this pass, treat sources as four classes:

- `Direct non-auth sources`
  - `Built In`
  - likely future peers such as `Levels.fyi`
  - MVP baseline: these should be the most reliable ingestion path.

- `Auth browser sources`
  - `LinkedIn`
  - `Indeed`
  - `ZipRecruiter`
  - These depend on valid auth, challenge handling, and source-specific extraction quality.

- `Search-on-search sources`
  - `Google`
  - Not part of the approved MVP slate.
  - Keep only as a post-MVP or replacement-candidate analysis track unless promoted by stakeholder decision.

- `Outlier company-board sources`
  - `Ashby`
  - Potentially `Greenhouse` later if Ashby proves worthwhile.
  - These are explicitly out of MVP.
  - The only active question is whether they ever deserve to come back after launch based on novelty versus redundancy.

## Plan of Work

This pass now has six approved workstreams and they land in dependency order.

First, add failing regression tests for the run/reporting path. The new tests should prove that a failed live source does not abort later sources, that final sync still happens for completed sources, that source rows expose `last attempted` / `last error` distinctly from `last successful`, and that Cloudflare / `additional verification needed` text classifies as a challenge state.

Next, change the run loop in `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js` so `run-all` becomes best-effort per source. A single source failure must no longer prevent later sources from running or suppress the final sync step. The server should collect per-source failures, continue, and return/report them after sync.

Then, expand the refresh-state classifier in `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/refresh-state.js` so Cloudflare and verification gates map to `challenge`. The dashboard should surface that as a user-actionable state while still preserving the last successful timestamp separately.

After that, repair source-quality issues by source type instead of treating all sources uniformly, but keep active implementation effort tied to the approved MVP source slate.

- `Direct non-auth baseline`
  - Keep `Built In` as the reference implementation for trustworthy source semantics.

- `Auth browser sources`
  - `LinkedIn` needs better cleanup/extraction quality so titles, companies, and review targets remain canonical.
  - `Indeed` needs challenge classification, honest reporting, and expected-count suppression until totals are trustworthy.
  - `ZipRecruiter` remains in the auth/browser class for data-quality review, and its direct-job deep-link correctness is a launch blocker for that source.

- `Launch-build direct non-auth sources`
  - `YC Jobs` must be built as a direct HTTP source.
  - `Levels.fyi` must be built as a direct HTTP source with salary-rich metadata where available.
  - For `Levels.fyi`, allow a small, source-specific detail-page enrichment step if the search results page is too thin to preserve salary/company/role metadata, but do not change the canonical review target away from the Levels.fyi job/detail URL.

- `Out-of-scope sources`
  - `Ashby`, `Google`, `Wellfound`, `Greenhouse`, and `RemoteOK` are not active MVP implementation lanes in this pass.
  - Prior analysis remains useful for later source policy, but these sources should not consume launch bandwidth now.

This step explicitly includes validating and, where needed, correcting source-specific search construction for LinkedIn and Indeed so the adapters stop generating polluted input upstream, fixing ZipRecruiter deep links, and building YC Jobs and Levels.fyi to the same source-trust bar as Built In.

Finally, rerun targeted verification and inspect a real run against local data. Acceptance is not just tests passing; the dashboard source table must stop showing impossible combinations and must explain fresh failures clearly.

## Concrete Steps

Run all commands from `/Users/admin/.codex/worktrees/51f6/job-finder` unless a command explicitly says otherwise.

1. Add failing regression tests and run them for:
   - per-source `run-all` continuation / final sync
   - `last attempted` / `last error` source-row reporting
   - challenge classification for Cloudflare / `additional verification needed`
   - LinkedIn cleanup and Ashby novelty assessment
   - Indeed expected-count suppression

   node --test test/<new-or-updated-targeted-tests>.test.js

   Expect at least one failure that demonstrates the current anomaly.

2. Implement P0 run/reporting fixes in the server path and refresh-state path.

3. Implement P1 source-quality fixes for LinkedIn and Indeed, while keeping ZipRecruiter launch blockers visible.
   - Audit source-specific search construction in:
     - `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/search-url-builder.js`
     - `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/ashby-jobs.js`
     - `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`
   - Prove that each source query/discovery flow is aligned with the user criteria before capture.
   - If a source still depends on downstream hard filters to remove obviously off-target result families, treat that as unresolved data-quality debt and fix it here.

4. Implement the `Levels.fyi` MVP source build as a direct HTTP source.
   - Update the source-type allowlists and source library in:
     - `/Users/admin/.codex/worktrees/51f6/job-finder/src/config/source-library.js`
     - `/Users/admin/.codex/worktrees/51f6/job-finder/src/config/schema.js`
     - `/Users/admin/.codex/worktrees/51f6/job-finder/src/config/load-config.js`
     - `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/source-contracts.js`
     - `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/cache-policy.js`
     - `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/refresh-policy.js`
   - Add a new adapter module under `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/` for Levels.fyi capture/import.
   - Preserve the canonical Levels.fyi job/detail URL as the review target and enrich detail pages only when the search page is too thin.
   - Add targeted tests for parser stability, source registration, and reporting semantics.

5. Re-run targeted tests.

   node --test test/<targeted-tests>.test.js

   Expect all targeted tests to pass.

6. Validate the dashboard payload directly.

   JOB_FINDER_DASHBOARD_UI=react node src/cli.js review 4521
   curl -s http://127.0.0.1:4521/api/dashboard

   Expect source rows to stop showing `0/0` for unknown expected counts, and to stop showing non-null average scores when imported count is zero for the current run.

7. Run full verification.

   npm test
   npm run dashboard:web:build
   node scripts/playwright-jobs-flow-smoke.js --mode react --artifact-prefix 2026-03-19-source-data-quality-pass --output-dir docs/roadmap/progress-merge --port 4518

## Validation and Acceptance

Acceptance is behavioral.

A valid result means:

- A failed source run no longer aborts later sources or suppresses final sync for already-completed sources.
- Source rows expose recent failed attempts separately from the last successful run.
- Cloudflare / `additional verification needed` states render as challenges, not generic transient errors.
- Non-LinkedIn jobs open their own source URLs instead of fabricated LinkedIn URLs.
- Unknown source availability renders as `?`, not `0`.
- A source row with zero imported jobs in the current run shows `Avg Score: n/a`.
- Indeed expected totals are suppressed for MVP until the extractor can emit a parser-validated value.
- The dashboard source table remains internally coherent: `Found`, `Filtered`, `Imported`, and `Avg Score` all describe the same current run.
- Active sources no longer rely on obviously over-broad or malformed source-specific search construction to generate candidate pools.
- LinkedIn candidate pools are materially narrowed upstream; hard filters are no longer the primary mechanism turning broad garbage input into tiny imported counts.
- Ashby has an explicit non-MVP product outcome:
  - `revisit post-MVP` if novelty is meaningful and discovery can be made sustainable,
  - `drop` if novelty is weak relative to complexity and redundancy.
- Source handling is explicitly rationalized by source type:
  - `Built In` remains trustworthy baseline behavior
  - `Auth browser` failures surface as auth/challenge/extraction issues instead of stale success states
  - `Ashby` has a documented post-MVP recommendation and does not block MVP source quality
- Score behavior is either recalibrated with tests or explicitly explained as a data-quality artifact rather than a ranking bug.

## Idempotence and Recovery

This work is safe to repeat. Server-side code and tests can be rerun without mutating the durable job database. When querying the review server, use a fixed alternate port such as `4521` so retries do not conflict with a user’s normal QA server. Do not delete `data/` or `config/` during this pass. If a capture file contains clearly corrupt expected counts, prefer to make the parser ignore or null them rather than editing user data files by hand.

## Artifacts and Notes

Relevant live observations captured before implementation:

- `linkedin-live-capture` capture summary: `jobCount 19`, `expectedCount 33`
- `builtin-sf-ai-pm` capture summary: `jobCount 25`, `expectedCount null`
- `ashby-pm-roles` capture summary: `jobCount 484`, `expectedCount null`
- `indeed-ai-pm` capture summary: `jobCount 41`, `expectedCount 200000`
- `google-ai-pm` capture summary: `jobCount 10`, `expectedCount null`

Representative impossible rows observed in live payload:

- BuiltIn: `importedCount 0`, `captureExpectedCount 0`, `avgScore 35`
- Google: `importedCount 0`, `captureExpectedCount 0`, `avgScore 31`
- Ashby: `importedCount 1`, `captureExpectedCount 0`, `droppedByHardFilterCount 483`
- Indeed: `importedCount 21`, `captureExpectedCount 200000`

## Interfaces and Dependencies

The main implementation surfaces are:

- `/Users/admin/.codex/worktrees/51f6/job-finder/src/review/server.js`
  - `resolveReviewTarget(job)`
  - source-row mapping inside `loadDashboardState()`
  - React payload shaping for source rows and totals
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/cache-policy.js`
  - `readSourceCaptureSummary(source)`
  - `writeSourceCapturePayload(source, jobs, options)`
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/config/source-library.js`
  - source enablement and default source definitions for the MVP slate
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/config/schema.js`
  - allowed source types and source config validation
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/config/load-config.js`
  - source registration helpers and type-specific config materialization
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/source-contracts.js`
  - source contract allowlist and per-source contract checks
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/refresh-policy.js`
  - source risk classification for refresh intervals/caps
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/levelsfyi-jobs.js`
  - new direct Levels.fyi adapter that fetches, parses, enriches, and writes capture payloads
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/indeed-jobs.js`
  - expected-count extraction logic if the bogus denominator originates there
- `/Users/admin/.codex/worktrees/51f6/job-finder/src/jobs/score.js`
  - score weighting and confidence/freshness behavior

New or updated tests should live under `/Users/admin/.codex/worktrees/51f6/job-finder/test/` and should prefer narrow, deterministic fixtures over live data dependencies.

Revision note (2026-03-19): Created this plan after the Jobs UI merge to isolate the next pass around data quality regressions reported from live dashboard use. The plan resolves the work into three cohesive bug classes: review-target routing, source-row metric semantics, and score sanity.
Revision note (2026-03-20): Updated source-type framing after user correction that filtered Google Jobs should be treated as a real source adapter if revisited later.
Revision note (2026-03-20): Synced the plan to the approved six-source MVP slate. Ashby and Google are out of MVP for this pass; Ashby remains spike-only, and launch source-quality implementation focuses on LinkedIn, Built In SF, Indeed, ZipRecruiter blockers, and the launch-build additions YC Jobs and Levels.fyi.
Revision note (2026-03-20): Scoped L5 as a direct Levels.fyi MVP source build and recorded the approved assumption that thin search pages may be supplemented with source-specific detail enrichment while preserving the canonical Levels.fyi review target URL.
