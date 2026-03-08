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

## Surprises & Discoveries

- Observation: CLI commands failed before execution because `src/cli.js` imported a missing file (`src/output/render.js`).
  Evidence: `node src/cli.js doctor` failed with `ERR_MODULE_NOT_FOUND` for `src/output/render.js`.
- Observation: `jf doctor` originally crashed when `config/sources.json` was missing, which is common on first run.
  Evidence: command exited with missing config error before source warnings.
- Observation: Playwright MCP browser verification was not available in this session due extension bridge timeout.
  Evidence: `browser_navigate` returned `Extension connection timeout`.

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

## Outcomes & Retrospective

The foundation is now in place for dashboard-first onboarding and optional analytics/monetization telemetry. The largest remaining gap is deeper source-specific auth/challenge classification beyond baseline readiness checks. This is intentionally left in backlog as a follow-up so core onboarding can ship without blocking on per-source complexity.

## Context and Orientation

Key files for this work:
- `src/onboarding/state.js`: local settings model + onboarding progression.
- `src/onboarding/source-access.js`: environment and source readiness checks.
- `src/analytics/events.js`: analytics event envelope + queue and optional flush.
- `src/monetization/entitlements.js`: feature-flagged limit state scaffolding.
- `src/config/feature-flags.js`: onboarding/analytics/monetization feature flags.
- `src/config/load-config.js`: source enablement persistence helper.
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
    node src/cli.js doctor

Expected outcomes:
- all tests pass.
- doctor prints environment checks and source warnings (including missing sources config on fresh setups) without non-zero exit.

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
    ℹ tests 132
    ℹ pass 132
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
