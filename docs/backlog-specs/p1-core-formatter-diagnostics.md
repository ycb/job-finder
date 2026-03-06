# P1 Core Functionality: Persist Formatter Diagnostics

- Priority: P1
- Theme: Core Functionality

## Why
Unsupported criteria fields are currently discovered during URL building but are mostly transient and easy to miss after a run.

## Impact
Users can immediately see why a source ignored a filter, reducing confusion and improving trust in ranking/input behavior.

## Detailed Spec
- Persist per-source diagnostics from URL normalization:
  - `unsupported` criteria fields
  - formatter `notes`
- Store diagnostics in source metadata that survives reloads and restarts.
- Show diagnostics in:
  - CLI source views
  - dashboard source views
- Keep diagnostics synchronized whenever source criteria or URL is regenerated.

## Acceptance Criteria
- Diagnostics remain available after process restart.
- CLI and dashboard display consistent diagnostics per source.
- Tests cover persistence and rendering paths.
