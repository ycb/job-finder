# P1 Governance: Licensing Split (MIT Core + BSL MCP Layer)

- Priority: P1
- Theme: Governance & Licensing

## Why
License boundaries are not explicit across core framework vs MCP/permission components, creating ambiguity for contributors and commercial users.

## Impact
Clarifies community/open-source posture while protecting commercialization-sensitive server capabilities.

## Detailed Spec
- Define licensing boundaries:
  - MIT: core framework, adapter interface, non-sensitive libraries.
  - BSL: MCP server + permission/policy enforcement layer.
- Add repository/package boundary map documenting which modules fall under each license.
- Add top-level docs/notice updates and contribution guidance.
- Add release checklist items that validate license headers and package scopes.
- Add FAQ for personal use vs commercial/hosted usage.

## Acceptance Criteria
- License files and notices are consistent with module boundaries.
- Contributor docs clearly explain where MIT vs BSL applies.
- Build/release checks fail on mis-scoped licensing metadata.
- Public docs include a simple commercial-use explanation.
