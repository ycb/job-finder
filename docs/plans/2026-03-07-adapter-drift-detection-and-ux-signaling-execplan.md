# Adapter Drift Detection and UX Signaling

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, adapter breakage from DOM or interaction drift will be detected quickly and surfaced clearly without interrupting normal workflow. The user will still be able to run capture/sync, but the dashboard and CLI will show a clear source-level warning such as "LinkedIn adapter needs attention" with concrete failure reasons and recent evidence. The goal is to prevent silent bad-data ingestion while avoiding noisy hard stops.

## Progress

- [x] (2026-03-08 22:10Z) Created new ExecPlan to extend reliability work after `2026-03-07-adapter-reliability-guardrails-execplan.md` reached completion and merged.
- [x] (2026-03-08 22:31Z) Added structured ingest reason contract in `src/sources/capture-validation.js` with stable `reasonDetails[{code,message}]` while preserving backward-compatible `reasons[]` strings.
- [x] (2026-03-08 22:34Z) Extended source-health records to persist structured reason details and expose `updatedAt` from latest health event in `computeSourceHealthStatus`.
- [x] (2026-03-08 22:40Z) Added canary expected-record diff capability (`kind=expected_record`) in `src/sources/source-canaries.js`.
- [x] (2026-03-08 22:43Z) Updated UX/CLI signaling: dashboard status now uses non-blocking `needs attention` wording for degraded/failing adapters; CLI contract checks print `action: adapter needs attention`; canary skipped sources no longer force non-zero exit.
- [x] (2026-03-08 22:49Z) Added and passed regression tests for reason codes, canary field diffs, source-health timestamps/reasonDetails, and UI copy updates.
- [x] (2026-03-08 22:51Z) Completed verification runs: full `npm test`, `check-source-canaries --include-disabled`, `check-source-contracts --window 3 --min-coverage 0.7`, and `capture-all-live`.

## Surprises & Discoveries

- Observation: The previous reliability plan already introduced ingest guardrails, rolling health status, and canary infrastructure.
  Evidence: `src/sources/capture-validation.js`, `src/sources/source-health.js`, and `src/sources/source-canaries.js` are present on `main`.

- Observation: Drift risk is still concentrated in adapter internals (DOM selectors, accessibility tree assumptions, click flows), not only in post-capture field coverage.
  Evidence: Browser adapter logic in `src/browser-bridge/providers/chrome-applescript.js` still depends on source-specific page structures and interaction patterns.

- Observation: Marking skipped canaries as warning exit codes (`2`) created noisy automation behavior despite no failed checks.
  Evidence: `node src/cli.js check-source-canaries --include-disabled` returned `EXIT:2` solely because disabled-source canaries were intentionally unconfigured.

## Decision Log

- Decision: Create a new ExecPlan instead of extending the completed reliability guardrails plan.
  Rationale: The prior plan is complete and merged; drift-detection hardening is a follow-on initiative with different milestones and acceptance criteria.
  Date/Author: 2026-03-08 / Codex

- Decision: Keep response model as silent degradation with visible indicators, not full pipeline interruption.
  Rationale: The user requested non-annoying signaling in a local-first workflow while still surfacing breakage clearly.
  Date/Author: 2026-03-08 / Codex

- Decision: Treat this plan as adapter-agnostic infrastructure applied first to enabled sources (`linkedin`, `builtin`, `ashby`, `google`, `indeed`, `ziprecruiter`).
  Rationale: These are currently active and high-value. Disabled adapters and future adapters (for example Zillow) should plug into the same interfaces later.
  Date/Author: 2026-03-08 / Codex

- Decision: Preserve existing string reasons and add structured reason details rather than replacing the reason shape.
  Rationale: This keeps older CLI and tests stable while enabling code-driven alert classification.
  Date/Author: 2026-03-08 / Codex

- Decision: Treat skipped canaries as informational (exit 0) unless an explicit canary failure occurs.
  Rationale: Missing canary configuration for disabled/out-of-scope sources should not fail local or CI pipelines.
  Date/Author: 2026-03-08 / Codex

## Outcomes & Retrospective

Implemented drift-focused hardening on top of existing guardrails with the following outcomes:

- Ingest evaluation now exposes stable reason codes (`reasonDetails`) in addition to string summaries.
- Source health history now preserves reason details and exposes `updatedAt` for UI/CLI last-signal rendering.
- Canary checks now support expected-record field diffing (`expected_record`) so adapter regressions can be diagnosed at field granularity.
- Dashboard signaling uses non-blocking `needs attention` wording, and CLI contract checks provide explicit action language.
- Canary skipped statuses are now non-failing by default, reducing alert noise while still surfacing skipped sources in output.

Gap note: this pass adds the expected-record diff capability and signaling path; per-source production canary definitions for stable real-world postings remain a follow-on data/config task.

## Context and Orientation

The source capture system has three relevant layers today.

The browser extraction layer lives in `src/browser-bridge/providers/chrome-applescript.js`. This module contains source-specific extraction logic and interaction flow (navigation, scroll, click, detail parse) for LinkedIn, Ashby, Google, Indeed, ZipRecruiter, and others.

The ingest and quality layer lives in `src/sources/capture-validation.js`, `src/sources/source-health.js`, and `src/sources/source-canaries.js`. It already supports run outcomes (`accept`, `quarantine`, `reject`), rolling health status (`ok`, `degraded`, `failing`), and canary checks.

The surfacing layer lives in `src/cli.js` and `src/review/server.js`. CLI commands currently include `check-source-contracts` and `check-source-canaries`. Dashboard Searches rows already display health-aware status text.

In this plan, "adapter drift" means a source extractor still runs but starts producing low-trust output due to changed page structure, selectors, accessibility labels, or interaction sequence. "Silent failure" means output is technically present but semantically broken enough to harm scoring, dedupe, or user trust.

## Plan of Work

Milestone 1 introduces explicit adapter extraction schema contracts. We will define per-source minimum record-shape expectations (for example required fields and URL validity rules) and per-run shape expectations (minimum sample, duplicate ratio ceiling). This expands current ingest validation so it can distinguish parser drift from normal low-volume runs and attach reason codes that are stable across sources.

Milestone 2 introduces confidence scoring based on baseline behavior. We will compute confidence from multiple signals: run volume versus trailing baseline, required-field fill-rate, URL validity, and parser provenance quality. We will preserve run-level confidence history so sudden drops become visible, even if absolute counts remain non-zero.

Milestone 3 introduces null/anomaly drift monitoring by critical field. We will track rolling null rates for key fields (`title`, `company`, `url`, `location`, `postedAt`, `salaryText`, `employmentType`) and mark field-level drift events when deltas exceed configured thresholds.

Milestone 4 hardens canary records from generic checks to expected-output diffs. We will support canary definitions that include expected field patterns and stable identity checks. Canary failures will emit per-field diffs and persist diagnostics that point directly to likely adapter breakage.

Milestone 5 extends user signaling without interruption. Dashboard source rows and summary panels will show adapter state, short reason text, and latest evidence timestamp. CLI commands will print concise warnings and file paths to diagnostics. Normal capture/sync remains available unless the user explicitly requests strict blocking mode.

Milestone 6 completes verification and rollout. We will add fixture-based drift tests, confidence/anomaly unit tests, canary diff tests, and integration checks against enabled sources. We will verify that drift is surfaced loudly while agent flow remains uninterrupted.

## Concrete Steps

From repository root `/Users/admin/job-finder`:

1. Implement adapter schema/drift contract module and tests.

    npm test -- test/capture-validation.test.js test/source-extraction-quality.test.js

2. Implement confidence baseline scoring and rolling anomaly tests.

    npm test -- test/source-health.test.js

3. Extend canary engine to support expected-output field diffs and diagnostics.

    npm test -- test/source-canaries.test.js

4. Verify CLI surfacing.

    node src/cli.js check-source-canaries
    node src/cli.js check-source-contracts --window 3 --min-coverage 0.7

5. Verify dashboard payload/surface integrity.

    npm test -- test/review-refresh-ui-copy.test.js test/dashboard-refresh-status.test.js

6. Run full regression.

    npm test

7. Run live capture verification across enabled sources in one bridge session.

    node src/cli.js capture-all-live --force-refresh

Expected outcomes must be captured in this file during execution with short evidence snippets under `Artifacts and Notes`.

## Validation and Acceptance

Acceptance is met when all of the following are true.

A run with malformed records or severe required-field loss is quarantined or rejected with explicit reason codes and persisted evidence. A low-confidence run relative to baseline volume is marked degraded/failing even if some records are present. A sudden null-rate spike on salary or freshness is surfaced in source health reasons. Canary checks can report field-level diff output against expected patterns. Dashboard and CLI both show non-blocking "adapter needs attention" signaling with source and reason context. Enabled-source capture/sync still completes in non-strict mode, proving silent degradation behavior rather than hard interruption.

## Idempotence and Recovery

All new quality history writes must remain append-safe and dedupe by source plus capture timestamp. Re-running checks must not duplicate identical entries. If thresholds are too strict and create alert noise, recovery is to tune config thresholds and rerun checks; previously captured payloads remain intact. Strict blocking mode, if added, must be opt-in and reversible with a CLI flag or environment toggle.

## Artifacts and Notes

During implementation, include concise evidence snippets here:

- example CLI output for degraded/failing source with reason codes
- canary field-diff sample output
- dashboard payload snippet showing adapter health summary and timestamp
- before/after confidence score for a simulated drift fixture

Evidence captured during implementation:

- `npm test -- test/capture-validation.test.js test/source-canaries.test.js test/source-health.test.js test/review-refresh-ui-copy.test.js` -> all pass after implementation changes.
- `node src/cli.js check-source-canaries --include-disabled` -> `EXIT:0` with skipped sources reported informationally.
- `node src/cli.js check-source-contracts --window 3 --min-coverage 0.7` -> health output includes action signaling for degraded/failing states when present.
- `npm test` -> `158 pass, 0 fail`.

## Interfaces and Dependencies

Implementation will extend existing reliability interfaces and add stable drift-oriented helpers.

In `src/sources/capture-validation.js`, ensure there is a stable reason-code output contract in addition to plain reason text, for example `reasons: [{ code, message }]` or equivalent normalized structure.

In `src/sources/source-health.js`, add or preserve APIs that can compute source health and include drift components:

- `recordSourceHealthFromCaptureEvaluation(source, capturePayload, evaluation, options)`
- `computeSourceHealthStatus(sourceId, options)` returning status, score, reasons, and component metrics.

In `src/sources/source-canaries.js`, extend canary definitions to include expected-output checks and produce diffable diagnostics via `writeSourceCanaryDiagnostics(...)`.

In `src/cli.js`, ensure `check-source-canaries` and `check-source-contracts` emit degradation information that is easy to act on and not excessively verbose.

In `src/review/server.js`, ensure dashboard source serialization includes adapter health status, score, reason(s), and latest update timestamp for the UI.

Dependencies are internal modules already in the repository. No external service dependency is required for baseline detection. Future adapters (including Zillow if enabled later) should adopt the same config-driven contracts and health interfaces.

Revision Note (2026-03-08): New follow-on plan created after reliability guardrails completion to focus specifically on DOM/accessibility/page-flow drift detection and non-blocking user signaling.
Revision Note (2026-03-08): Updated progress/outcomes after implementing reason-code contracts, expected-record canary diffs, and UX/CLI signaling refinements with full verification evidence.
