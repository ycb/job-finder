# Onboarding Integration QA - 2026-03-10

## Branch
- `onboarding-integration-qa`
- rebased onboarding tip integrated onto latest `main`

## Automated Verification
- `node --test test/cli-smoke.test.js test/onboarding-state.test.js test/onboarding-source-selection.test.js test/source-access.test.js test/npm-pack-legal-files.test.js test/search-criteria-config.test.js test/review-refresh-ui-copy.test.js` -> pass
- `npm test` -> pass (`240 passed, 0 failed`)

## Manual Verification
- `node src/cli.js init --non-interactive --channel codex --analytics false --json` -> returns `{ ok: true, channel: "codex", analyticsEnabled: false }`
- `node src/cli.js doctor` -> expected warning when `config/sources.json` missing
- Policy endpoints up from review server:
  - `GET /policy/terms` -> HTML response
  - `GET /policy/privacy` -> HTML response
- Consent gate verified in Playwright (checkboxes + `Agree and Continue`)
- Post-consent Searches UI verified in Playwright:
  - `Enabled` / `Disabled` tabs shown
  - funnel table columns present (`Found`, `Filtered`, `Dupes`, `Imported`, `Avg Score`)
  - refresh/run-delta context shown in status cells
- Disabled -> Enable flow verified in Playwright:
  - enabling LinkedIn opens auth dialog
  - clicking `I'm logged in` shows success feedback
- Jobs handoff wiring verified in rendered HTML markers:
  - `data-open-jobs-row` present on search row hotspots
  - row click handler binding present for `[data-open-jobs-row]`
- Guardrail payload fields verified via `GET /api/dashboard` on integration server:
  - `manualRefreshAllowed`, `manualRefreshRemaining`, `manualRefreshNextEligibleAt`
  - `runNewCount`
  - `criteriaAccountability`
  - `adapterHealthStatus`

## Bootstrap Scenario
- Clean temp workspace with packaged `config/*.example.json` copied:
  - `init` succeeds
  - `review` + `GET /api/dashboard` auto-creates both `config/profile.json` and `config/sources.json`

## Notes
- Playwright MCP intermittently returns to extension page in this environment; key flow checks were executed in single-session interactions and backed by HTML marker checks.
