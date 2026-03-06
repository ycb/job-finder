# P2 Source Quality: RemoteOK Validation and Re-Enable

## Problem
- `remoteok_search` has URL construction support but now sits behind `JOB_FINDER_ENABLE_REMOTEOK` by default.
- We need to confirm parameter behavior and capture quality before enabling it by default again.

## Scope
- Run repeated live captures with canonical criteria (`title`, `keywords`, `location`, `salary`, `date`).
- Document which criteria are actually supported vs ignored by RemoteOK.
- Define fallback behavior for unsupported criteria (URL fallback, page-level checks, or explicit unsupported diagnostics).
- Verify dashboard/source filtering behavior remains clean when RemoteOK is disabled.

## Deliverables
- Updated support mapping for RemoteOK criteria behavior.
- Source formatting notes + diagnostics for unsupported fields.
- Updated tests for URL build and visibility/feature-flag behavior.
- Decision record: keep gated, partially re-enable, or re-enable by default.

## Definition of Done
- RemoteOK behavior is validated with evidence from live captures.
- Criteria support/limitations are documented in code/tests.
- Default source enablement decision is implemented and reflected in docs.
