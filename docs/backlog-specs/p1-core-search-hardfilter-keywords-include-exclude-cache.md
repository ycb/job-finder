# P1 Core Functionality: Improve Search Controls and Explainability

- Priority: P1
- Theme: Core Functionality

## Why
Current search controls are not explicit enough for power users, and cache/filters behavior is hard to reason about quickly.

## Impact
Higher search precision, clearer filtering behavior, and more confidence in result freshness.

## Detailed Spec
- Make hard-filter behavior explicit in UI/CLI:
  - clearly show hard-filter conditions
  - clearly show why a job was excluded
- Expand keyword logic:
  - support multiple keywords
  - support explicit `AND` / `OR` semantics
  - default mode is `AND`; user can opt into `OR`
- Add include/exclude controls:
  - include terms list
  - exclude terms list
- Add cache status and visualization:
  - show whether source data is fresh/stale
  - show last refresh and cache hit/miss indicators

## Acceptance Criteria
- Users can configure AND/OR keyword logic and include/exclude terms from search criteria.
- Hard-filter logic is visible and understandable in outputs/UI.
- Cache status is visible at source level with meaningful freshness indicators.
- Tests cover parsing/config behavior and status rendering paths.
