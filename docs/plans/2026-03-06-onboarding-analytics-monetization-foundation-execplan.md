# Onboarding + Analytics + Monetization Foundation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `/Users/admin/job-finder/PLANS.md`.

## Purpose / Big Picture

After this change, a new user can complete first-run setup from inside the dashboard rather than relying on README-only setup. The product now tracks onboarding progress, allows source selection and readiness checks, records optional analytics events (with user toggle), and exposes donation + entitlement scaffolding for future monetization gates.

The observable behavior is:
- `jf init` creates both DB and user settings state.
- `jf doctor` reports environment/source readiness.
- Dashboard exposes onboarding actions and source checks.
- Onboarding APIs are available under `/api/onboarding/*`.

## Progress

- [x] (2026-03-06 16:55Z) Added feature-flag module for onboarding/analytics/monetization gates.
- [x] (2026-03-06 17:10Z) Added persistent onboarding/user-settings model with install ID, channel inference, source selections, and check state.
- [x] (2026-03-06 17:22Z) Added source readiness checker with normalized `pass|warn|fail` contract.
- [x] (2026-03-06 17:34Z) Added analytics event envelope, local queue persistence, and optional flush path.
- [x] (2026-03-06 17:42Z) Added entitlement scaffolding behind feature flag.
- [x] (2026-03-06 18:05Z) Wired onboarding + monetization payloads and onboarding APIs into review server.
- [x] (2026-03-06 18:26Z) Added dashboard onboarding card UI actions (save channel, save sources, run checks, complete onboarding).
- [x] (2026-03-06 19:05Z) Added `jf doctor` command and analytics event for doctor runs.
- [x] (2026-03-06 19:32Z) Fixed CLI boot blocker by adding missing `src/output/render.js` module.
- [x] (2026-03-06 19:48Z) Hardened `jf doctor` for missing `config/sources.json` to warn instead of exit non-zero.
- [x] (2026-03-06 20:05Z) Added regression tests for onboarding state, source checks, analytics events, entitlements, and CLI startup.
- [x] (2026-03-06 20:10Z) Verified full repository test suite passes.
- [x] (2026-03-07 21:40Z) Canonicalized config model boundaries: `config/source-criteria.json` for search intent, `config/sources.json` source-library map mode for enable/disable, legacy file modes retained as fallback.
- [x] (2026-03-07 21:45Z) Added safe bootstrap for missing `config/sources.json` in config loader to unblock true first-run dashboard onboarding.
- [x] (2026-03-07 21:50Z) Updated source normalization/read paths to support both map mode and legacy array mode, including `setEnabledSources`, URL preview/normalize, and source lookup.
- [x] (2026-03-07 21:53Z) Updated `runReview` to open dashboard empty-state onboarding even when review queue is empty.
- [x] (2026-03-07 21:58Z) Added/updated tests for map mode selection, source bootstrap, canonical search-criteria resolution, and map-mode preview/normalize behavior.
- [x] (2026-03-07 22:00Z) Verified full repository test suite passes (`138/138`).
- [x] (2026-03-07 22:28Z) Redesigned onboarding UI into an inline stepper flow with explicit welcome copy, source auth-required badges, and step-specific CTAs.
- [x] (2026-03-07 22:33Z) Added auth-aware source verification behavior: selected auth-required sources are enabled only after verification pass; failed auth sources remain disabled with retry action.
- [x] (2026-03-07 22:36Z) Added API support for separate onboarding `sourceIds` vs `enabledSourceIds` to preserve selection intent while enforcing verification-gated enablement.
- [x] (2026-03-07 22:39Z) Verified full repository test suite passes after onboarding UX + verification updates (`143/143`).

## Surprises & Discoveries

- Observation: CLI commands failed before execution because `src/cli.js` imported a missing file (`src/output/render.js`).
  Evidence: `node src/cli.js doctor` failed with `ERR_MODULE_NOT_FOUND` for `src/output/render.js`.
- Observation: `jf doctor` originally crashed when `config/sources.json` was missing, which is common on first run.
  Evidence: command exited with missing config error before source warnings.
- Observation: Playwright MCP browser verification was not available in this session due extension bridge timeout.
  Evidence: `browser_navigate` returned `Extension connection timeout`.
- Observation: Config migration had drifted to partial support only: canonical path constants existed, but several read/write paths still assumed legacy array mode or wrong object shapes.
  Evidence: `getSourceByIdOrName` called metadata derivation with full config object rather than `sources[]`, and URL normalize helpers threw in map mode.
- Observation: Prior onboarding UI was functionally wired but had low UX clarity (unclear hierarchy, oversized checkbox controls, and non-guided action sequencing).
  Evidence: user QA screenshots showed visually noisy card with weak affordances and unclear completion path.

## Decision Log

- Decision: Keep onboarding state local in `data/user-settings.json` and avoid mandatory account creation in v1.
  Rationale: Local-first setup was an explicit product constraint; cloud identity remains optional.
  Date/Author: 2026-03-06 / Codex
- Decision: Persist selected sources into `config/sources.json` from onboarding API.
  Rationale: Source selection must immediately affect run behavior without a second config step.
  Date/Author: 2026-03-06 / Codex
- Decision: Ship donation CTA now and keep subscription limits as scaffolding behind `JOB_FINDER_ENABLE_MONETIZATION_LIMITS`.
  Rationale: Matches implementation priority to monetize lightly while preserving OSS core behavior.
  Date/Author: 2026-03-06 / Codex
- Decision: Normalize source-check contract to `{ status, reasonCode, userMessage, technicalDetails }`.
  Rationale: This shape is reusable in both CLI doctor output and onboarding dashboard APIs.
  Date/Author: 2026-03-06 / Codex
- Decision: Treat `config/source-criteria.json` as canonical and keep `config/search-criteria.json` as compatibility fallback only.
  Rationale: Keeps search intent config explicit and aligned with auto-constructed source URLs/scoring.
  Date/Author: 2026-03-07 / Codex
- Decision: Treat `config/sources.json` map mode (`sourceId -> bool|override`) as canonical onboarding shape; retain legacy array mode for compatibility commands.
  Rationale: Matches product direction away from manually managed static source URL lists while avoiding hard migration breakage.
  Date/Author: 2026-03-07 / Codex
- Decision: For onboarding, persist selected sources separately from enabled sources (`sourceIds` vs `enabledSourceIds`).
  Rationale: Auth-required sources can remain selected for retry while staying disabled until verification passes.
  Date/Author: 2026-03-07 / Codex
- Decision: Use live source run verification for auth-required sources (skip sync/score) and probe checks for non-auth sources.
  Rationale: Confirms access realistically without forcing a full pipeline run during onboarding verification.
  Date/Author: 2026-03-07 / Codex

## Outcomes & Retrospective

The foundation is now in place for dashboard-first onboarding and optional analytics/monetization telemetry. First-run flow no longer requires manual creation of `config/sources.json`; it bootstraps safely. Config boundaries are now explicit across profile/onboarding, search intent, and source enablement. The largest remaining gap is deeper source-specific auth/challenge classification beyond baseline readiness checks. This is intentionally left in backlog as a follow-up so core onboarding can ship without blocking on per-source complexity.

Onboarding UX now follows a guided three-step flow in the `Searches` tab:
1) choose sources and preferences,
2) verify source access (auth-aware),
3) proceed to first search from `Jobs`.

## Context and Orientation

Key files for this work:
- `src/onboarding/state.js`: local settings model + onboarding progression.
- `src/onboarding/source-access.js`: environment and source readiness checks.
- `src/analytics/events.js`: analytics event envelope + queue and optional flush.
- `src/monetization/entitlements.js`: feature-flagged limit state scaffolding.
- `src/config/feature-flags.js`: onboarding/analytics/monetization feature flags.
- `src/config/load-config.js`: source enablement persistence helper.
- `src/config/source-library.js`: canonical source library definitions and map-mode materialization.
- `src/review/server.js`: onboarding APIs and dashboard UI wiring.
- `src/cli.js`: `init` settings bootstrap and `doctor` command.
- `src/output/render.js`: shortlist writer used by CLI startup path.
- `test/onboarding-state.test.js`, `test/source-access.test.js`, `test/analytics-events.test.js`, `test/entitlements.test.js`, `test/cli-smoke.test.js`: regression coverage for this feature set.

## Plan of Work

The implementation adds a local onboarding state store and exposes it through API endpoints consumed by the dashboard. Source checks read capture freshness and source metadata to produce explicit pass/warn/fail outcomes. Source selection persists directly to `sources.json` so runtime ingestion follows onboarding choices.

Analytics uses a small local queue and an optional remote flush target. Monetization adds read-only entitlement computation and donation affordances, leaving enforcement disabled unless a feature flag is explicitly set.

CLI changes ensure first-run setup initializes settings and provides a doctor command for environment/source checks.

## Concrete Steps

Run from repository root:

    npm test
    npm test -- test/search-criteria-config.test.js test/onboarding-source-selection.test.js test/source-url-preview.test.js test/cli-smoke.test.js
    node src/cli.js doctor

Expected outcomes:
- all tests pass.
- doctor prints environment checks and source warnings (including missing sources config on fresh setups) without non-zero exit.
- map-mode `sources.json` selection updates enabled source state correctly.
- `loadSearchCriteria()` prefers `source-criteria.json` and falls back to legacy `search-criteria.json`.

## Validation and Acceptance

Acceptance criteria met when:
- `GET /api/onboarding/state` returns onboarding + monetization + source payload.
- `POST /api/onboarding/channel`, `/api/onboarding/sources`, `/api/onboarding/check-source`, `/api/onboarding/complete` persist expected state transitions.
- dashboard shows onboarding card and source check statuses.
- `jf doctor` runs on fresh setup and provides actionable warnings.
- analytics queueing respects both feature flag and user toggle.

## Idempotence and Recovery

All operations are idempotent by design:
- settings and analytics payload files are rewritten safely with normalized schema.
- source selection can be repeatedly saved; it deterministically reassigns enabled sources.
- onboarding completion can be re-posted without breaking state.

Recovery:
- delete `data/user-settings.json` to reset onboarding state.
- delete `data/analytics-events.json` to reset queued analytics.

## Artifacts and Notes

Verification transcript:

    npm test
    ℹ tests 138
    ℹ pass 138
    ℹ fail 0

Targeted config regression transcript:

    npm test -- test/search-criteria-config.test.js test/onboarding-source-selection.test.js test/source-url-preview.test.js test/cli-smoke.test.js
    ℹ tests 12
    ℹ pass 12
    ℹ fail 0

Doctor transcript on fresh config:

    node src/cli.js doctor
    Environment:
    [PASS] Node.js 20+: Node 24.6.0
    ...
    Sources:
    [WARN] Sources config not found. Create config/sources.json from config/sources.example.json or use the dashboard onboarding flow.

## Interfaces and Dependencies

Onboarding API contract:
- `GET /api/onboarding/state`
- `POST /api/onboarding/channel` body: `{ channel?: string, analyticsEnabled?: boolean }`
- `POST /api/onboarding/sources` body: `{ sourceIds: string[] }`
- `POST /api/onboarding/check-source` body: `{ sourceId: string, probeLive?: boolean }`
- `POST /api/onboarding/complete` body: `{}`

Source check contract:

    {
      status: "pass" | "warn" | "fail",
      reasonCode: string,
      userMessage: string,
      technicalDetails: object
    }

Analytics envelope:

    {
      installId: string,
      eventName: string,
      timestamp: string,
      channel: string,
      appVersion: string,
      platform: string,
      properties: object
    }

Feature flags:
- `JOB_FINDER_ENABLE_ONBOARDING_WIZARD`
- `JOB_FINDER_ENABLE_ANALYTICS`
- `JOB_FINDER_ENABLE_MONETIZATION_LIMITS`

---

Update note (2026-03-06): Document created after implementation to preserve contracts, decisions, and verification evidence for downstream multi-worktree handoffs.
