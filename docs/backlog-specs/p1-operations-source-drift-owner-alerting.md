# P1 Operations: Owner Alerting for Non-Actionable Source Drift

- Priority: P1
- Theme: Operations & Tooling

## Why
Users should only see issues they can act on (for now: authentication-required remediation). Source-shape drift, parser changes, and formatter mismatches are internal maintenance concerns and create noise if shown in user-facing status UI.

## Impact
Keeps user workflows focused on actionable steps while ensuring source regressions still reach the owner quickly enough for schema/adapter fixes.

## Detailed Spec
- Define alertable non-user-actionable drift classes:
  - source contract mismatch (shape/coverage)
  - parser/formatter unsupported criteria mappings
  - extraction degradation tied to page/layout changes
- Emit internal alert events for those classes from existing diagnostics paths.
- Route alerts to owner-only channels (phase rollout):
  - phase 1: local artifact + structured log event
  - phase 2: PostHog event pipeline with severity tags and source IDs
  - phase 3: optional push channel (email/Slack/webhook)
- Keep user-facing UI policy strict:
  - show actionable auth guidance only
  - do not show internal parser/contract drift copy in source status rows
- Define alert payload schema:
  - source id/type, failure class, severity, first seen, last seen, run id/evidence path
- Add digest/reporting:
  - daily/merge summary of open drift alerts and status changes (new, ongoing, resolved)

## Acceptance Criteria
- Non-actionable drift classes are emitted as internal alerts with structured payloads.
- User-facing source status detail does not display internal drift diagnostics.
- Owner can identify which source broke, when, and where evidence is stored.
- Alerting contract is documented for future self-healing/source-add skill integration.
