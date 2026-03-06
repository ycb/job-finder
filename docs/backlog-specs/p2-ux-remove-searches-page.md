# P2 UX Simplification: Remove `Searches` Page

- Priority: P2
- Theme: UX Simplification

## Why
Once search auto-construction is stable, a separate manual `Searches` page adds complexity and maintenance load.

## Impact
Cleaner navigation and fewer duplicate control surfaces.

## Detailed Spec
- Dependency: auto-construct search fully replaces manual page actions.
- Remove `Searches` tab UI and dependent routes/state wiring.
- Preserve equivalent controls in remaining surfaces.
- Update docs/tests for single streamlined workflow.

## Acceptance Criteria
- No `Searches` page remains in dashboard UX.
- Add/edit/run search workflows remain available through replacement flow.
- Regression tests confirm no loss of core capabilities.
