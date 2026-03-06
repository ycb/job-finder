# P1 Integrations: Build MCP Server for Codex

- Priority: P1
- Theme: Integrations

## Why
Codex integrations need structured tool APIs, not only shell command orchestration.

## Impact
Codex can reliably run job-finder workflows as first-class tools in agent sessions.

## Detailed Spec
- Implement MCP server exposing core tools:
  - initialize job search/profile
  - sync/run sources
  - analyze specific job
- Define stable tool input/output schemas and error contracts.
- Wire handlers to existing deterministic job-finder runtime operations.
- Add local setup docs for Codex + MCP registration.
- Add integration tests for tool invocation and result shapes.

## Acceptance Criteria
- Codex can run core workflows via MCP tools.
- Tool responses are schema-stable and actionable.
- Setup and tests are documented and reproducible.
