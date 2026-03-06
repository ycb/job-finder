# P1 Onboarding: Improve `jf init` (LinkedIn Auto-Extract + Initial Params)

- Priority: P1
- Theme: Onboarding

## Why
Manual first-run setup creates friction and lowers activation.

## Impact
Faster time-to-first-useful-search should increase onboarding completion and repeat usage.

## Detailed Spec
- Parse LinkedIn saved-search URL details during `jf init`.
- Prompt user for canonical initial parameters (title, keywords, location, date, salary, etc.).
- Validate generated source/config before finishing init.
- Provide graceful fallback for extraction failure with guided manual path.

## Acceptance Criteria
- Users complete `jf init` with at least one usable search and no manual file edits.
- Fallback path remains functional and clear.
- Tests cover extraction and fallback flows.
