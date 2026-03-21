# P1 Source Expansion: Add YC Jobs to the MVP Slate

- Priority: P1
- Theme: Source Coverage Expansion

## Context

YC Jobs is being promoted into MVP because it offers high-signal startup roles in the target SF AI market, fits the direct non-auth source pattern, and should be relatively low-cost to build compared with auth browser sources or company-portal discovery.

## Why It Matters

The approved MVP source slate is intentionally six curated sources. YC Jobs strengthens startup coverage in a way that is likely to surface jobs not already dominant on LinkedIn/Indeed, while keeping implementation complexity moderate.

## MVP Scope

- Add a dedicated YC Jobs source adapter.
- Support source configuration, capture, normalization, scoring, dedupe, and review.
- Start with direct HTTP parsing against the stable YC Jobs role surfaces.
- Support the MVP criteria set that meaningfully maps to YC Jobs without pretending unsupported filters work.
- Add parser and integration tests.

## Out of Scope

- Community-source adapter framework.
- Rich portal discovery beyond the YC Jobs surface.

## Acceptance Criteria

- Users can run YC Jobs end-to-end through ingest -> score -> shortlist -> review.
- Parsed jobs include normalized title, company, location, URL, and enough description/metadata to score credibly.
- Unsupported filters are explicitly omitted or marked unsupported rather than silently ignored.
- Tests cover parser stability and source integration.

## Dependencies

- Existing source schema/config support for HTTP-direct sources
- Search-construction fidelity work for shared criteria mapping

## Definition of Done

- Source is enabled in the approved MVP slate.
- Jobs from YC Jobs appear in review with coherent metrics and trustworthy URLs.
