# 2026-03-12 J4 Jobs Smoke Verification

## Scope
- Lane: J4 verification harness
- Controller branch baseline includes J1 + J2 + J3 on `main`

## Commands
- `node --test test/playwright-jobs-flow-smoke.test.js`
- `node --test test/dashboard-api-contract.test.js`
- `node scripts/playwright-jobs-flow-smoke.js --mode legacy --artifact-prefix 2026-03-12-jobs-react --output-dir docs/roadmap/progress-merge --port 4513`
- `node scripts/playwright-jobs-flow-smoke.js --mode react --artifact-prefix 2026-03-12-jobs-react --output-dir docs/roadmap/progress-merge --port 4514 --timeout-ms 90000`
- `npm test`

## Result
- Legacy mode smoke: pass
- React mode smoke: pass
- Full test suite: pass (`276/276`)

## Artifacts
- `docs/roadmap/progress-merge/2026-03-12-jobs-react-legacy-jobs.png`
- `docs/roadmap/progress-merge/2026-03-12-jobs-react-legacy-jobs-dashboard.json`
- `docs/roadmap/progress-merge/2026-03-12-jobs-react-legacy-jobs-summary.json`
- `docs/roadmap/progress-merge/2026-03-12-jobs-react-legacy-jobs-smoke.log`
- `docs/roadmap/progress-merge/2026-03-12-jobs-react-react-jobs.png`
- `docs/roadmap/progress-merge/2026-03-12-jobs-react-react-jobs-dashboard.json`
- `docs/roadmap/progress-merge/2026-03-12-jobs-react-react-jobs-summary.json`
- `docs/roadmap/progress-merge/2026-03-12-jobs-react-react-jobs-smoke.log`
