# P1 Core Functionality: Add `workType` Criteria Across Sources

- Priority: P1
- Theme: Core Functionality

## Why
Users need a single remote/hybrid/in-person/all preference that applies consistently instead of tuning each source manually.

## Impact
Higher relevance and less setup friction by enforcing consistent work-mode filtering across supported source URLs.

## Detailed Spec
- Add `workType` field to canonical search criteria schema with allowed values:
  - `remote`
  - `hybrid`
  - `in_person`
  - `all`
- Thread `workType` through source URL construction/normalization for all supported source types.
- Map canonical value to each source's closest supported filter semantics.
- Record unsupported mappings in formatter diagnostics (`unsupported` + notes).
- Ensure CLI/dashboard criteria editing supports the new field.

## Acceptance Criteria
- `workType` is configurable in shared criteria and preserved in config.
- Supported sources emit URLs with correct work-type filters.
- Unsupported sources clearly report diagnostics.
- Tests cover schema validation, URL mapping, and unsupported-path behavior.
