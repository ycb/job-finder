# P1 Source Expansion: Add Greenhouse Source via Portal Abstraction

- Priority: P1
- Theme: Source Expansion

## Why
Greenhouse hosts many target roles; missing it reduces search coverage.

## Impact
Broader source coverage should increase relevant job volume and improve high-signal recall.

## Detailed Spec
- Add `greenhouse_search` source type in schema/config/CLI.
- Implement Greenhouse collector.
- Generalize portal discovery logic so Ashby and Greenhouse can share architecture.
- Define portal breadth limits from Google subdomain discovery quality.
- Add tests for parsing, discovery, and end-to-end ingestion.

## Acceptance Criteria
- Greenhouse sources can be added and run through the normal pipeline.
- Jobs ingest, normalize, score, and appear in review.
- Tests cover happy path and malformed portal inputs.
