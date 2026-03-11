# F1-C Contracts & Harness Evidence (2026-03-11)

## Scope

Lane `F1-C Contracts & Harness` delivered:
- `/api/dashboard` API contract test coverage for fields consumed by Searches/onboarding UI.
- Playwright smoke harness runnable with `--mode legacy` and `--mode react`.

## Commands Run

1. Targeted contract test
   - `node --test test/dashboard-api-contract.test.js`
   - Outcome: pass (`1` test, `0` fail)

2. Playwright smoke (legacy mode)
   - `npm run smoke:dashboard -- --mode legacy --artifact-prefix 2026-03-11-f1-c --output-dir docs/roadmap/progress-merge --port 4421`
   - Outcome: pass (`ok: true`)

3. Playwright smoke (react mode)
   - `npm run smoke:dashboard -- --mode react --artifact-prefix 2026-03-11-f1-c --output-dir docs/roadmap/progress-merge --port 4422`
   - Outcome: pass (`ok: true`)

4. Full suite
   - `npm test`
   - Outcome: pass (`242` tests, `0` fail)

## Artifact Paths

- Legacy mode screenshot:
  - `docs/roadmap/progress-merge/2026-03-11-f1-c-legacy-dashboard.png`
- Legacy mode dashboard JSON snapshot:
  - `docs/roadmap/progress-merge/2026-03-11-f1-c-legacy-dashboard.json`
- Legacy mode smoke log:
  - `docs/roadmap/progress-merge/2026-03-11-f1-c-legacy-smoke.log`
- React mode screenshot:
  - `docs/roadmap/progress-merge/2026-03-11-f1-c-react-dashboard.png`
- React mode dashboard JSON snapshot:
  - `docs/roadmap/progress-merge/2026-03-11-f1-c-react-dashboard.json`
- React mode smoke log:
  - `docs/roadmap/progress-merge/2026-03-11-f1-c-react-smoke.log`

## Notes

- Smoke harness runs in isolated temp workspace fixtures (copied from `config/*.example.json`) to avoid mutating repo runtime data.
- Mode flag is forwarded through `JOB_FINDER_DASHBOARD_UI=<mode>` for both runs.
