# P2 Source Quality: Wellfound Criteria Bootstrap

- Priority: P2
- Theme: Source Quality

## Why
Wellfound currently stubs URL criteria and is less capable than other sources.

## Impact
When enabled, Wellfound results become more relevant and less noisy.

## Detailed Spec
- Keep behind `JOB_FINDER_ENABLE_WELLFOUND` until mature.
- Use Playwright/browser capture to apply criteria in UI:
  - keywords
  - location
  - salary
  - date posted
  - experience
- Persist resulting URL/capture metadata for repeatability.

## Acceptance Criteria
- Wellfound no longer drops all criteria in bootstrap flow.
- Tests cover filter application and extraction behavior.
