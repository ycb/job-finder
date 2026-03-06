# P1 Core Functionality: Support Comma-Separated Multiple Keywords

- Priority: P1
- Theme: Core Functionality

## Why
Users often think in multiple distinct terms and need predictable keyword handling without manual URL/query hacks.

## Impact
Higher search precision and easier setup by allowing a single criteria field to represent multiple keywords.

## Detailed Spec
- Update keyword criteria parsing to accept comma-separated input (for example: `ai, fintech, payments`).
- Normalize tokens:
  - split on commas
  - trim whitespace
  - dedupe empty/duplicate values
- Preserve normalized keyword list in canonical criteria representation.
- Apply normalized keywords consistently across source URL builders and query formatters.
- Show unsupported keyword behavior in diagnostics when a source cannot represent multi-keyword logic.

## Acceptance Criteria
- Comma-separated keywords are parsed and persisted consistently.
- Generated source URLs/queries include all normalized keywords where supported.
- Tests cover parsing normalization and source-builder mappings.
