# P1 Core Functionality: Multi-Search Ranking Blend Model

- Priority: P1
- Theme: Architecture & Extensibility

## Why
As multi-search support expands, combining results without an explicit blend model can cause noisy or biased ranking outcomes.

## Impact
Enables predictable cross-search result ordering through deterministic interleaving and optional per-search weighting.

## Detailed Spec
- Add a search-context model where each job carries origin search id and optional search weight.
- Implement blend strategies:
  - flat interleave by score/rank.
  - weighted blend using search-level coefficients.
- Define default behavior when weights are missing.
- Add ranking diagnostics showing contribution of per-search weights.
- Ensure compatibility with existing single-search scoring paths.

## Acceptance Criteria
- Engine can rank across at least two searches in one run.
- Users can set optional per-search weights with deterministic impact.
- Diagnostics explain why cross-search ordering was produced.
- Tests cover flat interleave and weighted blend scenarios.
