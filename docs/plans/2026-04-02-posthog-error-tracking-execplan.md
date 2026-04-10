# PostHog Error Tracking Installation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is governed by `/Users/admin/job-finder/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

JobFinder currently emits analytics events to PostHog, but it does not send frontend or backend exceptions into PostHog Error Tracking. After this change, a QA pass through the React review dashboard and the Node review runtime should surface actual uncaught errors in PostHog Error Tracking instead of disappearing into the terminal or browser console. The important user-visible outcome is simple: when JobFinder breaks during QA, the failure should land in PostHog with a stack trace and enough context to debug it quickly.

## Progress

- [x] (2026-04-02 21:09Z) Re-read `PROCESS.md`, `PLANS.md`, current learnings, and the active PostHog analytics wiring in `src/analytics/client.js`, `src/review/web/src/main.jsx`, and `src/review/server.js`.
- [x] (2026-04-02 21:10Z) Confirmed the active UI surface is the Vite React dashboard rooted at `src/review/web/src/main.jsx`, and confirmed no existing error capture hooks exist in either React or Node runtime.
- [x] (2026-04-02 21:11Z) Confirmed official PostHog guidance for the target runtimes: React should use `PostHogProvider`, `PostHogErrorBoundary`, and manual `captureException` when needed; Node should use `posthog-node` with `enableExceptionAutocapture: true`.
- [x] (2026-04-02 21:20Z) Added red tests for shared PostHog config resolution and review HTML bootstrap injection in `test/posthog-error-tracking.test.js` and `test/posthog-browser-bootstrap.test.js`, and verified they failed before implementation with `ERR_MODULE_NOT_FOUND`.
- [x] (2026-04-02 21:24Z) Implemented `src/analytics/posthog-config.js` and refactored `src/analytics/client.js` to use the shared config resolver so analytics and error tracking read the same `.env` token/host values.
- [x] (2026-04-02 21:27Z) Wired the React dashboard entrypoint in `src/review/web/src/main.jsx` with a narrow PostHog browser client, `PostHogProvider`, and `PostHogErrorBoundary`, using server-injected config instead of a second env path.
- [x] (2026-04-02 21:29Z) Wired Node review-runtime error tracking in `src/review/server.js` with a shared PostHog client, top-level request-loop exception capture, signal-aware shutdown, and HTML bootstrap injection for the React app.
- [x] (2026-04-02 22:00Z) Verified the install with targeted tests, `npm run dashboard:web:build`, and a live synthetic exception that appeared in PostHog Error Tracking.

## Surprises & Discoveries

- Observation: the repository already has working PostHog analytics transport but no error-tracking hooks.
  Evidence: `rg -n "uncaughtException|unhandledRejection|window.onerror|ErrorBoundary|captureException" src --glob '!dist'` returned no matches before implementation.

- Observation: the React dashboard is a small Vite app and therefore the smallest useful frontend install point is `src/review/web/src/main.jsx`.
  Evidence: `src/review/web/index.html` loads `/src/main.jsx`, and `src/review/web/src/main.jsx` currently renders `<App />` directly with no provider wrapper.

- Observation: the cleanest way to keep one PostHog config path for both runtimes is to inject the browser-safe token/host into the built dashboard HTML at serve time instead of adding a separate `VITE_*` env track.
  Evidence: `src/review/server.js` already reads and serves `src/review/web/dist/index.html` for `GET /`, so the bootstrap script can be inserted there without changing the rest of the build pipeline.

- Observation: PostHog’s generic `list-errors` MCP endpoint lagged behind raw exception ingestion, but the dedicated error-tracking issues endpoint reflected the synthetic smoke issue once processing completed.
  Evidence: `query-trends` for `$exception` showed one event at `2026-04-02 22:00`, and `error_tracking_issues_list` returned issue `019d5036-4143-7221-a115-96622984c837` with description `jobfinder-error-tracking-smoke-2026-04-02T22-03-00Z`.

## Decision Log

- Decision: scope this install to the React dashboard and Node review runtime, not every CLI command path.
  Rationale: this is the highest-value QA surface and keeps the first install narrow. CLI-only exceptions can be added later if operational evidence shows they matter enough.
  Date/Author: 2026-04-02 / Codex

- Decision: reuse the same PostHog project token and host already used for product analytics instead of introducing a second PostHog configuration path.
  Rationale: one source of truth reduces drift, and the repository already relies on `.env`-driven `POSTHOG_API_KEY` and `POSTHOG_HOST`.
  Date/Author: 2026-04-02 / Codex

## Outcomes & Retrospective

This plan started from a working analytics baseline and extended it into error tracking without broadening the telemetry model. QA can now rely on PostHog for both behavior analytics and failure reporting in the same project.

Concrete verification evidence:

- `node --test test/analytics-client.test.js test/posthog-error-tracking.test.js test/posthog-browser-bootstrap.test.js`
  Result: 8 tests passed, 0 failed.
- `npm run dashboard:web:build`
  Result: production dashboard build completed successfully on April 2, 2026.
- Synthetic exception smoke:
  Command used a shared PostHog client to send marker `jobfinder-error-tracking-smoke-2026-04-02T22-03-00Z`.
  PostHog evidence: `$exception` trend count increased at `2026-04-02 22:00`, and error-tracking issue `019d5036-4143-7221-a115-96622984c837` was created with that marker in the description.

Residual note:

- `node -c src/review/web/src/main.jsx` is not a meaningful syntax check because Node does not parse `.jsx` directly. The dashboard build is the correct validation path for that file and passed.

## Context and Orientation

There are three relevant areas in this repository.

`package.json` at the repository root defines all runtime dependencies and scripts for both the Node CLI/review server and the Vite React dashboard. Any PostHog SDK install must be declared there because `src/review/web` does not have its own package manifest.

`src/review/web/src/main.jsx` is the React dashboard entrypoint. It currently imports `App` and renders it directly. In React terms, an “error boundary” is a wrapper component that catches render-time exceptions from the tree beneath it and reports them instead of letting the whole app fail silently.

`src/review/server.js` is the Node review runtime that serves the dashboard and handles review API requests. In Node terms, “exception autocapture” means the PostHog client registers handlers so uncaught exceptions and unhandled promise rejections are sent to PostHog automatically.

The current PostHog analytics transport lives in `src/analytics/client.js`. That file now bootstraps `.env` values automatically, so it is the natural place to share host/token resolution logic with error tracking instead of copying environment parsing into multiple new files.

## Plan of Work

First, add small regression tests before implementation. The tests should not attempt to throw real runtime errors through a browser. Instead, they should verify the bootstrap contracts that make the install real: a config helper returns the correct PostHog host/token values from `.env` and runtime overrides, the React entrypoint can import a PostHog provider wrapper without build-time failure, and the Node review runtime can construct a PostHog error-tracking client with exception autocapture enabled.

Second, install the minimum SDK dependencies. For the React dashboard, add the PostHog web and React packages required for `PostHogProvider` and `PostHogErrorBoundary`. For the Node review runtime, add the Node SDK used by PostHog’s error-tracking docs. Keep the install in the root `package.json` so both runtimes build from the same lockfile and workspace.

Third, factor shared PostHog config resolution into `src/analytics/client.js` or a small adjacent helper under `src/analytics/`. The important requirement is that analytics and error tracking both resolve the same host and project token from `.env` and explicit overrides. Avoid duplicating `.env` parsing or host normalization logic.

Fourth, wire the React dashboard. In `src/review/web/src/main.jsx`, create the PostHog client once, wrap the app in `PostHogProvider`, and then wrap `App` in `PostHogErrorBoundary`. Keep this narrowly focused on exception reporting rather than enabling unrelated PostHog frontend products. If PostHog’s React package requires the raw web SDK instance, construct it there and pass it to the provider.

Fifth, wire the Node review runtime. In `src/review/server.js`, initialize a PostHog Node client once at module scope with `enableExceptionAutocapture: true`. Add safe flush/shutdown handling on process exit so QA-triggered crashes are less likely to be dropped. If the SDK exposes `captureException`, keep a thin helper available for explicit catches later, but do not expand this change into a broad manual-instrumentation pass.

Sixth, verify behavior. Run targeted tests for the new helper and runtime bootstrap, run the React dashboard build, then trigger one synthetic exception path in a controlled way and confirm it lands in PostHog Error Tracking. The synthetic trigger can be a short one-off Node script or a guarded dev-only hook; the key is to prove ingestion, not to leave a permanent crash switch in production code.

## Concrete Steps

1. Modify `package.json` to add the official PostHog SDK packages required for React and Node error tracking.

2. Add tests in `test/analytics-client.test.js` or a new focused file such as `test/posthog-error-tracking.test.js` that cover:

   - shared PostHog host/token resolution
   - Node client initialization with exception autocapture enabled
   - any helper behavior that would regress `.env` loading or config normalization

3. Implement the shared config helper in `src/analytics/client.js` or a new adjacent module such as `src/analytics/posthog-config.js`.

4. Modify `src/review/web/src/main.jsx` to:

   - initialize the PostHog frontend client
   - wrap the React tree in `PostHogProvider`
   - wrap `<App />` in `PostHogErrorBoundary`

5. Modify `src/review/server.js` to:

   - initialize the PostHog Node client with `enableExceptionAutocapture: true`
   - register safe flush/shutdown behavior

6. Run verification from `/Users/admin/job-finder`:

   - `node --test test/analytics-client.test.js test/posthog-error-tracking.test.js`
   - `npm run dashboard:web:build`
   - a focused Node smoke command that constructs the error-tracking client and captures or autocaptures a synthetic exception

7. Confirm the captured synthetic exception appears in PostHog Error Tracking for project `336026`.

## Validation and Acceptance

This work is complete only when all of the following are true:

- the repository installs the required PostHog SDK packages cleanly
- the React dashboard build passes with the new provider and error boundary in place
- targeted tests prove `.env`/host/token resolution still works and the Node error-tracking client is initialized as intended
- a synthetic exception from the JobFinder codebase appears in PostHog Error Tracking
- the change does not break the existing product analytics flow

## Idempotence and Recovery

This install is safe to repeat. Re-running dependency installation or the verification commands should not mutate repository data beyond the lockfile and build artifacts. If the PostHog SDK initialization breaks the dashboard build or Node runtime, revert the new PostHog error-tracking wrappers first while keeping the shared config helper and tests so the failure stays diagnosable. Synthetic exception verification should use a distinct message marker so repeated runs are easy to identify in PostHog without confusing them with real production failures.

## Artifacts and Notes

Expected evidence after implementation should look like this:

    node --test test/posthog-error-tracking.test.js
    ✔ posthog error tracking resolves host/token from .env
    ✔ posthog node client enables exception autocapture

    npm run dashboard:web:build
    vite build completes with exit code 0

    synthetic exception verification
    PostHog Error Tracking shows one issue containing the marker string used by the smoke script

## Interfaces and Dependencies

The main interfaces after this work should be:

- a shared PostHog config resolver under `src/analytics/` that returns the normalized project token and host
- a React bootstrap in `src/review/web/src/main.jsx` that creates the frontend PostHog client and wraps the tree with `PostHogProvider` and `PostHogErrorBoundary`
- a Node bootstrap in `src/review/server.js` that creates a PostHog Node client with `enableExceptionAutocapture: true`

Revision note (2026-04-02 21:11Z): created after stakeholder approval to install PostHog Error Tracking for the live QA phase, scoped narrowly to the React dashboard and Node review runtime rather than a full CLI-wide exception-capture rollout.
