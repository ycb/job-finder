# Search Construction and Source Mapping Design

As of 2026-03-07.

## Goal

Provide one canonical search-criteria model and deterministic per-source mapping so generated searches are auditable, measurable, and resilient to source UI changes.

## Canonical Criteria Model

```js
{
  title?: string,
  keywords?: string,
  location?: string,
  distanceMiles?: number,
  datePosted?: "any" | "1d" | "3d" | "1w" | "2w" | "1m",
  experienceLevel?: "intern" | "entry" | "associate" | "mid" | "senior" | "director" | "executive",
  minSalary?: number
}
```

These fields are set globally in `config/search-criteria.json` and can be overridden per source via `sources[].searchCriteria`.

Keyword normalization rule (current):
- `keywords` accepts comma-separated values and is canonicalized as a deduped token list.
- URL builders consume the normalized set and emit all terms (`AND`-style intent).
- Explicit `OR` semantics are deferred to the search-controls expansion backlog item.

## Source of Truth and Drift Control

To prevent divergence between search construction and extraction:

- Authoritative mapping registry: `config/source-contracts.json`
- Search URL builder implementation: `src/sources/search-url-builder.js`
- Source hydration/persistence: `src/config/load-config.js`
- Drift evaluator and contract loader: `src/sources/source-contracts.js`
- Governance process: `docs/analysis/source-contract-governance.md`

This document describes the operating model and links to the contract registry; it should not duplicate detailed selector-level mappings that are now contract-owned.

## Criteria Accountability Contract

Every provided criterion must land in exactly one bucket per source:

- `appliedInUrl`
- `appliedInUiBootstrap`
- `appliedPostCapture`
- `unsupported`

Accountability is persisted on each source (`sources[].criteriaAccountability`) and surfaced in dry-run normalization + dashboard API rows.

## Current Source Mapping Posture

Per-source mapping mode is contract-defined in `config/source-contracts.json`.

- `linkedin_capture_file`: URL-driven for current canonical criteria.
- `builtin_search`: URL-driven for title/keywords/location/date; other criteria explicitly unsupported.
- `ashby_search`: URL-driven with Google query composition and recency mapping.
- `google_search`: URL-driven with jobs query composition and recency mapping.
- `indeed_search`: URL-driven with explicit unsupported handling for currently unmapped criteria.
- `ziprecruiter_search`: URL-driven for full canonical set in current implementation.
- `wellfound_search`: currently treated as UI/bootstrap or unsupported criteria path.
- `remoteok_search`: URL/path-tag driven with explicit unsupported non-remote filters.

`wellfound_search` and `remoteok_search` are currently feature-flagged off by default but remain in the contract registry to keep re-enable paths explicit.

## Data Quality Metrics Linked to Search Construction

Search construction quality is measured with:

- Criteria accountability coverage per source.
- Found ratio in Searches (`imported/expected` or `imported/?`).
- Capture funnel metadata (`available`, `capturedRaw`, `postHardFilter`, `postDedupe`, `imported`).
- Contract drift status from `jf check-source-contracts`.

## Change Workflow

When a source search UI or URL semantics change:

1. Update mapping implementation in `src/sources/search-url-builder.js` (and source bootstrap path if needed).
2. Update `config/source-contracts.json` (`criteriaMapping`, `contractVersion`, `lastVerified`).
3. Run mapping/accountability tests:
   - `test/search-url-builder.test.js`
   - `test/source-search-criteria-bootstrap.test.js`
   - `test/source-criteria-accountability.test.js`
4. Run drift tests:
   - `test/source-contracts.test.js`
   - `test/source-contract-drift-check.test.js`
5. Run `jf check-source-contracts` in a configured environment.

## Full JD Follow-On

Search construction and card-level capture are complete for this epic, but full job-description coverage still has per-source gaps.

Follow-on scope and acceptance criteria:

- `docs/backlog-specs/p0-source-full-jd-gap-closure.md`
