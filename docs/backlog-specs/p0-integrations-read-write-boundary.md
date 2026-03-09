# P0 Integrations: Read/Write Boundary for MCP and Browser Bridge

- Priority: P0
- Theme: Integrations

## Why
Once an MCP tool can trigger capture/navigation, the gap to unsafe write actions (for example clicking apply/submit) is small unless we enforce an explicit boundary now.

## Impact
Creates a durable safety contract for contributors and prevents accidental release of write-capable agent actions in v1.

## Detailed Spec
- Define browser-bridge primitive classes:
  - `read`: navigate, wait, extract, parse, capture metadata.
  - `write`: click submit/apply, type into mutable forms, upload files, confirm dialogs.
- Enforce a tool-surface rule for MCP v1:
  - only expose `read` primitives.
  - block `write` primitives at registration time.
- Add policy constants and validation guardrails in MCP tool registration code.
- Add docs that state this boundary is intentional and not an implementation gap.
- Add contributor checklist item requiring explicit approval for any write-capable proposal.

## Acceptance Criteria
- MCP v1 tool manifest contains no write-capable operations.
- Attempting to register a write primitive fails with a clear error.
- Policy boundary is documented in architecture/contributor docs.
- Tests cover allowed read paths and denied write paths.
