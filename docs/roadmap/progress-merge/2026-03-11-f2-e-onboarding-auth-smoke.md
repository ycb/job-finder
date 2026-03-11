# F2-E Onboarding Auth Smoke Evidence (2026-03-11)

Lane: `F2-E Onboarding Interactions`

## Command

```bash
npm run smoke:onboarding-auth -- --artifact-prefix 2026-03-11-f2-e-onboarding-auth --timeout-ms 45000
```

## Outcome

- PASS (exit code `0`)
- Consent gate rendered and accepted in React mode.
- Auth-required source (`LinkedIn`) enabled from `Not Enabled` group.
- Auth modal opened and probe flow executed; final status message:
  - `LinkedIn is not authorized. Sign in and retry.`

## Artifacts

- Screenshot: `docs/roadmap/progress-merge/2026-03-11-f2-e-onboarding-auth-screenshot.png`
- Result JSON: `docs/roadmap/progress-merge/2026-03-11-f2-e-onboarding-auth-result.json`
- Smoke log: `docs/roadmap/progress-merge/2026-03-11-f2-e-onboarding-auth-smoke.log`
