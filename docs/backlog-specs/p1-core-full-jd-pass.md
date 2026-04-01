# P1 Core Functionality: Page-Level Full JD Verification Pass

- Priority: P1
- Theme: Core Functionality

## Why
Snippet-only text can miss required terms and produce false positives/negatives.

## Impact
More accurate hard-filter and fit decisions from full description text should improve shortlist quality.

## Detailed Spec
- Dependency: scrape salary data for Built In matches first.
- For candidate jobs, fetch/open detail pages during evaluation.
- Extract full JD text and rerun required-term and keyword checks.
- Persist pass/fail evidence and rationale in evaluation metadata.
- Define fallback behavior when detail fetch fails (use snippet path with explicit marker).
- Current sequencing rule: LinkedIn summary-card capture stability comes first. Full JD extraction remains deferred until LinkedIn and the other MVP sources can reliably import enough card-level data to uphold the search-quality promise.

## Acceptance Criteria
- When detail fetch succeeds, decisions use full JD text.
- Fallback path is deterministic and visible.
- Tests cover full-JD success and snippet fallback branches.
