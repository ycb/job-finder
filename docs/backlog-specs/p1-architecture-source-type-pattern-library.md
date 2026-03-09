# P1 Architecture: Source Type Pattern Library

- Priority: P1
- Theme: Architecture & Extensibility

## Why
Many source adapters share repeatable patterns (auth model, URL style, UI-driven filters), but these are not formalized as reusable abstractions.

## Impact
Improves implementation speed and reliability for new sources by reusing known patterns instead of rebuilding source logic ad hoc.

## Detailed Spec
- Define source pattern taxonomy, including:
  - `auth_required`
  - `unauth_public`
  - `subdomain_tenant`
  - `ui_driven_filters`
  - `no_parameter_url`
- For each pattern, provide:
  - search-construction strategy defaults.
  - extraction strategy defaults.
  - canary template defaults.
- Add a resolver that maps source types/sources to pattern templates.
- Integrate pattern resolver with add-source skill output.
- Document how to extend the pattern library safely.

## Acceptance Criteria
- New source setup can select one or more patterns and generate scaffolding.
- Pattern library is referenced by onboarding/add-source workflows.
- Tests verify template selection and generated defaults.
- Docs describe pattern tradeoffs and fallback behavior.
