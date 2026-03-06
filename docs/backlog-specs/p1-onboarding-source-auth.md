# P1 Onboarding: Source Selection + Per-Source Authentication

- Priority: P1
- Theme: Onboarding

## Why
Automation reliability depends on enabling the right sources and authenticating required providers up front.

## Impact
Fewer failed scheduled runs and less user intervention after onboarding.

## Detailed Spec
- During onboarding, let users select which source families to enable.
- Add auth readiness checks/handshake per selected source.
- Persist source enablement and auth readiness state.
- Surface remediation guidance for auth failures.

## Acceptance Criteria
- Onboarding ends with explicit source set and per-source readiness state.
- Scheduled runs start without extra interactive auth for ready sources.
- Tests cover mixed ready/unready source states.
