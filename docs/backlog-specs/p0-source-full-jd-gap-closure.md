# P0 Source Quality: Full-JD Gap Closure by Source

As of 2026-03-07.

## Why

Current ingestion is mostly card/snippet driven. Hard-filter and fit quality improves materially when full job descriptions are fetched and parsed per job URL.

## Source Matrix

| Source Type | Runtime Source | Full JD Status | Extraction Path | Primary Blocker Class | Follow-on Step |
| --- | --- | --- | --- | --- | --- |
| `linkedin_capture_file` | Browser bridge card list | no | card | navigation | Add detail-pane click pass per captured card; extract detail text and merge into job payload before write. |
| `builtin_search` | HTTP page parse | partial | mixed | navigation | Fetch each job detail URL after list parse and replace `description` with detail body when available. |
| `ashby_search` | Google discovery + board parse | partial | mixed | selector volatility | Stabilize board-level job detail extraction and enforce per-job description boundaries before merge. |
| `google_search` | HTTP SERP parse | no | card | navigation | For each outbound job URL, run secondary fetch/parser adapters (Greenhouse/Lever/Ashby/etc.) and store resolved JD text. |
| `indeed_search` | Browser bridge generic board parser | no | card | navigation | Add job-card click/detail scrape flow in browser automation and capture detail-pane/body text. |
| `ziprecruiter_search` | Browser bridge generic board parser | no | card | navigation | Add per-card open/detail extraction step; capture full description block and normalize. |
| `wellfound_search` *(feature-flagged off)* | Browser bridge card/context parse | partial | mixed | selector volatility | Build stable detail navigation parse for `/jobs/<id>` pages and re-enable only after JD coverage threshold tests pass. |
| `remoteok_search` *(feature-flagged off)* | Browser bridge generic board parser | no | card | selector volatility | Implement source-specific parser (avoid generic) for full post body extraction; validate before re-enable. |

## Implementation Notes

- Keep existing snippet/summary as fallback when detail fetch fails.
- Store description provenance (`card` vs `detail`) in structured metadata.
- Preserve capture-funnel metrics when adding detail fetch so regressions are visible.

## Acceptance Criteria

- Every enabled source emits `structuredMeta.description.source` as either `detail` or `card` with non-empty text.
- Enabled sources achieve >= 90% `detail` description coverage over a 3-run rolling window, or have explicit blocker exceptions documented.
- `wellfound_search` and `remoteok_search` remain disabled until they meet re-enable checks:
  - search criteria mapping validated
  - expected-count/capture-funnel metrics populated
  - full-JD extraction coverage validated by tests + live verification.

## Verification

- Add/extend parser tests per source for detail extraction success/fallback behavior.
- Add dashboard/report metrics for `% detail description` by source.
- Run `jf check-source-contracts` and ensure required description coverage does not regress.
