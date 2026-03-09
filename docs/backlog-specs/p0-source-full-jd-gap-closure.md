# P0 Source Quality: Full-JD Gap Closure by Source

As of 2026-03-08.

## Why

Current ingestion is mostly card/snippet driven. Hard-filter and fit quality improves materially when full job descriptions are fetched and parsed per job URL.

## Current Status

Completed in merged work:

- Shared detail enrichment pipeline is implemented for enabled sources (`linkedin`, `builtin`, `ashby`, `google`, `indeed`, `ziprecruiter`) and can overwrite missing `description` from detail page content when available.
- `extractorProvenance` now tracks source of extracted fields, including `description` (`card`, `detail`, `fallback_unknown`).
- Detail enrichment is wired into both browser-capture and HTTP collectors.

Still open:

- No source is at confirmed "full JD closed" status; contracts still mark `fullJobDescription: partial`.
- No rolling quality gate on `% description from detail` (current gate checks required-field non-empty coverage, not detail provenance share).
- Source-specific detail extractors/adapters are still needed for dynamic/JS-heavy pages where generic HTML fetch cannot recover full JD reliably.

## Source Matrix (Done vs Remaining)

| Source Type | Runtime Source | Status Now | Done | Remaining |
| --- | --- | --- | --- | --- |
| `linkedin_capture_file` | Browser bridge card list | partial | Detail-pane hints + post-capture detail enrichment are in place. | Source-specific full detail pane/body extraction per job and verified high `% description=detail` coverage. |
| `builtin_search` | HTTP page parse | partial | List parse + detail-page enrichment pass implemented. | Improve JS/dynamic fallback reliability and prove sustained full-JD capture rate via source-level QA gate. |
| `ashby_search` | Google discovery + board parse | partial | Board parsing + detail enrichment integrated; dedupe and board-scope protections in place. | Strengthen board-specific structured extraction for full JD boundaries and coverage verification. |
| `google_search` | SERP + outbound detail fetch | partial | Outbound URL detail fetch/parsing path implemented with generic JSON-LD/text extraction. | Add stronger destination adapter chain coverage for JS-heavy targets and validate JD completeness quality. |
| `indeed_search` | Browser bridge generic board parser | partial | Card/detail hints + post-capture detail enrichment enabled. | Implement robust source-specific detail-body extraction and verify rolling full-JD quality target. |
| `ziprecruiter_search` | Browser bridge generic board parser | partial | Card/detail hints + post-capture detail enrichment enabled. | Implement source-specific detail block extraction and verify rolling full-JD quality target. |
| `wellfound_search` *(feature-flagged off)* | Browser bridge card/context parse | out of scope (disabled) | No change in this phase by design. | Keep disabled; build stable detail navigation parser and validate before re-enable. |
| `remoteok_search` *(feature-flagged off)* | Browser bridge generic board parser | out of scope (disabled) | No change in this phase by design. | Keep disabled; implement source-specific full-post parser and validate before re-enable. |

## Implementation Notes

- Keep existing snippet/summary as fallback when detail fetch fails.
- Store description provenance (`card` vs `detail` vs `fallback_unknown`) in structured metadata.
- Preserve capture-funnel metrics when adding detail fetch so regressions are visible.

## Acceptance Criteria (Not Yet Fully Met)

- Every enabled source emits description provenance and non-empty `description` values.
- Enabled sources achieve >= 90% `detail` description coverage over a 3-run rolling window, or have explicit blocker exceptions documented.
- `wellfound_search` and `remoteok_search` remain disabled until they meet re-enable checks:
  - search criteria mapping validated
  - expected-count/capture-funnel metrics populated
  - full-JD extraction coverage validated by tests + live verification.

## Verification (Current vs Needed)

Current:

- Detail enrichment unit tests exist for parser behavior and provenance.
- Contract checks run rolling required-field coverage (non-empty/known), including `description`.

Needed to close this spec:

- Add/extend source-specific parser tests for full-JD detail extraction success/fallback behavior.
- Add dashboard/report metric for `% description` sourced from `detail` by source.
- Add gating on rolling detail-description coverage (not only non-empty field coverage).
