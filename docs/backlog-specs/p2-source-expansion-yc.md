# P2 Source Expansion: Add Y Combinator Jobs Source

- Priority: P2
- Theme: Source Expansion

## Why
YC jobs can add relevant startup opportunities currently not captured.

## Impact
Additional startup coverage with potentially high-quality PM roles.

## Detailed Spec
- Seed path: `https://www.ycombinator.com/jobs/role/product-manager`
- Choose parser strategy:
  - static HTML parse first
  - browser capture fallback if blocked
- Add schema support, collector implementation, and tests.

## Acceptance Criteria
- YC source can be configured and run.
- Jobs flow through ingest -> score -> shortlist pipeline.
- Tests cover parse/collector behavior.
