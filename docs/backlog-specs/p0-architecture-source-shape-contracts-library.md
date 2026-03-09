# P0 Architecture: Source Shape Contracts Library

- Priority: P0
- Theme: Architecture

## Why
Search-parameter expectations and extraction-shape expectations are currently distributed across adapters/configs, making onboarding automation and quality governance harder.

## Impact
Provides a single authoritative contract layer that powers source setup, extraction validation, canaries, and contributor confidence.

## Detailed Spec
- Introduce a canonical `source-shape-contracts` library keyed by source type and source id.
- For each source contract, define:
  - search parameter shape (supported, required, optional, ui-driven-only).
  - extraction shape (required metadata fields + optional fields + quality thresholds).
  - mapping modes (`appliedInUrl`, `appliedInUiBootstrap`, `appliedPostCapture`, `unsupported`).
- Bind contract definitions to:
  - URL/search construction diagnostics.
  - extraction validation and health scoring.
  - canary checks and contract drift checks.
- Version contract schema and persist contract version in quality outputs.
- Document extension workflow for adding new source contracts.

## Acceptance Criteria
- Every enabled source type has a contract entry with search + extraction sections.
- Contract validation runs in CI/tests and in CLI diagnostics paths.
- Canaries and drift checks reference the same contract source-of-truth.
- Contributor docs include a step-by-step contract authoring flow.
