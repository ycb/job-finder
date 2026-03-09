# P1 Onboarding: Add-Source Skill Workflow (No UI Changes)

- Priority: P1
- Theme: Onboarding

## Why
Adding a new source currently requires manual reverse-engineering of query parameters, extraction shape, and run checks.

## Impact
Reduces adapter onboarding effort and increases consistency by generating a repeatable source-onboarding flow with built-in quality controls.

## Detailed Spec
- Build a skill/workflow that accepts a candidate source URL/domain and produces:
  - search-parameter shape analysis.
  - extraction-shape mapping (required vs optional metadata).
  - source contract draft.
  - canary/check scaffold for recurring validation.
- Restrict initial version to read-only analysis and config/spec generation (no UI changes).
- Integrate with source-type pattern library and source-shape contract library.
- Produce machine-readable output that can be reviewed and committed.
- Add operator checklist for manual approval before enabling a new source.

## Acceptance Criteria
- Running the workflow for a new source yields contract + canary artifacts.
- Output includes required metadata mapping and unsupported parameter notes.
- Workflow can be used during onboarding and post-onboarding source additions.
- Tests cover artifact generation and validation for at least one new-source fixture.
