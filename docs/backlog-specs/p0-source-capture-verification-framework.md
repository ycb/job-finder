# P0 Source Capture Verification Framework

## Summary

Add a source-quality verification layer that compares expected-result signals per source against captured/imported counts after each run. Flag large gaps automatically so under-capture is visible immediately in CLI/dashboard and can trigger follow-up capture retries or source-specific fixes.

## Problem

Current runs can silently under-capture (for example, source UI reports materially more jobs than captured payload). Without a verification framework, we only discover this manually from dashboard discrepancies.

## Goals

1. Compute an `expectedCount` signal per source whenever feasible.
2. Compare `expectedCount` against `capturedCount` and `importedCount`.
3. Persist a verification status (`ok`, `warning`, `critical`, `unknown`) with reason codes.
4. Show this status in dashboard and CLI summaries.

## Non-Goals

- Perfect accuracy for every source on day one.
- Blocking runs when expected count is unavailable.

## Source Strategy (Phase 1)

- LinkedIn: Parse result count header text (for example `39 results`) via live automation extraction.
- Indeed/ZipRecruiter/Google/Ashby/Wellfound/RemoteOK: Parse count indicators where available; otherwise mark `expectedCount` as `unknown`.
- BuiltIn: if no list-level count is reliable, defer to page-level sampling checks until count extraction is validated.

## Scoring Rules

- `ok`: capture ratio >= 0.70
- `warning`: capture ratio >= 0.40 and < 0.70
- `critical`: capture ratio < 0.40
- `unknown`: expected count not available

`captureRatio = importedCount / expectedCount` (clamped to [0, 1.5] for display)

## UX/Output

- Dashboard source row adds: `expected`, `imported`, `ratio`, `verificationStatus`.
- CLI run summary includes top sources by worst ratio.
- Optional auto-retry policy for `critical` when source supports pagination/scroll.

## Acceptance Criteria

1. At least LinkedIn has a working expected-count extractor.
2. Verification statuses appear in dashboard and CLI after run.
3. Automated tests cover scoring/threshold logic and `unknown` handling.
4. No source run crashes if expected-count extraction fails.

## Risks

- Source UI changes can break expected-count parsing.
- Count text may represent broader universe than filtered import set.

Mitigation: store reason codes and extractor confidence; never hard-fail on mismatch.
