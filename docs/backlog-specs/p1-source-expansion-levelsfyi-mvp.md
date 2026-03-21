# P1 Source Expansion: Add Levels.fyi to the MVP Slate

- Priority: P1
- Theme: Source Coverage Expansion

## Context

Levels.fyi is being promoted into MVP because it is a direct non-auth source with differentiated salary signal. It fits the product thesis that "more is more at launch" only when the added source also contributes a meaningful new dimension of value. In this case that dimension is compensation transparency.

## Why It Matters

Levels.fyi can add salary-transparent tech roles and strengthen the product's salary-aware ranking and filtering story. It also complements Built In as a cleaner non-auth source type that is likely easier to maintain than auth browser sources.

## MVP Scope

- Add a dedicated Levels.fyi source adapter.
- Support end-to-end capture, normalization, scoring, dedupe, and review.
- Preserve salary metadata cleanly enough that the source meaningfully improves salary-aware prioritization.
- Add tests for parser stability and source integration.

## Out of Scope

- Advanced salary analytics beyond the existing MVP jobs UI.
- Community adapter infrastructure.

## Acceptance Criteria

- Users can run Levels.fyi end-to-end through ingest -> score -> shortlist -> review.
- Parsed jobs include normalized salary fields when available, plus title/company/location/URL.
- Source metrics in the dashboard are coherent and trustworthy.
- Tests cover parser behavior and integration into the source pipeline.

## Dependencies

- Existing source schema/config support for HTTP-direct sources
- Salary normalization paths already used by review/scoring

## Definition of Done

- Levels.fyi is part of the approved MVP source slate.
- It produces usable salary-transparent jobs with trustworthy metadata and URLs.
