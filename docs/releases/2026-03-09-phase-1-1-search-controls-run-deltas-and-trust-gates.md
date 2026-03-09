# Release Note: Phase 1.1 Search Controls, Run Deltas, and Trust Gates

## Release Metadata

- Date: `2026-03-09`
- Version/Tag: `26a0a48` (latest merge on `main`)
- Scope: Search-controls completion, run-delta persistence/surfacing, trust-gate coverage, retention cleanup, and telemetry baseline

## Summary

This release moves the system from "latest capture snapshot" to "observable operational loop." Search intent now supports explicit `AND`/`OR` keyword mode plus include/exclude terms, sync runs persist net-new/updated/unchanged deltas, and source trust diagnostics are tightened with richer contract thresholds. It also adds status-aware retention cleanup/auditing and a channel-aware analytics event baseline.

## Changes

- Added search-control fields and semantics across config, URL construction, scoring, and dashboard:
  - `keywordMode` (`and`/`or`)
  - `includeTerms`
  - `excludeTerms`
- Added sync run-delta persistence and surfacing:
  - SQLite table: `source_run_deltas`
  - per-source latest counters in dashboard source status
  - CLI sync aggregate output (`new`, `updated`, `unchanged`)
- Expanded source contract diagnostics:
  - richer extraction/search-parameter shape validation
  - required-field and detail-description rolling coverage gates
  - diagnostics artifact: `data/quality/contract-drift/latest.json`
- Added retention policy runtime:
  - policy loader/defaults from `config/retention-policy.json` (optional file)
  - sync-time cleanup with status-aware TTL defaults
  - audit log: `data/retention/cleanup-audit.jsonl`
  - CLI inspect command: `jf retention-policy`
- Added analytics baseline:
  - canonical event registry/schema mapping (`src/analytics/events.js`)
  - local event + counter persistence in `data/analytics/`
  - optional PostHog forwarding via `POSTHOG_API_KEY`
- Added bridge primitive safety boundary:
  - explicit primitive catalog with read/write classification
  - MCP v1 registration guard that rejects write primitives
- Added full-JD evaluation evidence metadata persistence (`evaluation_meta`) for content-path provenance.

## Why It Matters

- Search tuning is now explicit and testable instead of implicit keyword guessing.
- Refresh runs now communicate what changed, not just that work occurred.
- Source trust failures are easier to detect before ranking quality degrades silently.
- Retention and telemetry now provide operator-grade visibility into ongoing system behavior.

## Behavior Changes

- Exclude-term matches now hard-reject jobs before weighted scoring.
- Keyword matching defaults to `AND`; `OR` is explicit through `keywordMode`.
- Sync flows now print run-delta and retention summary lines.
- Sync flows now execute status-aware cleanup by default (`applied` remains protected).
- Contract diagnostics now default to stricter minimum coverage (`0.9`) and include detail-description gate checks.

## Verification Evidence

- Reviewed changed exec/backlog docs in this pass:
  - `docs/plans/2026-03-06-search-construction-design.md`
  - `docs/plans/2026-03-08-phase-1-multi-agent-orchestration-execplan.md`
  - `docs/plans/2026-03-09-lane-b-w2-04-net-new-refresh-deltas-execplan.md`
  - `docs/plans/2026-03-09-phase-1-1-closeout-execution-plan.md`
  - `docs/backlog.md`
  - changed backlog specs under `docs/backlog-specs/`
- Commit-window test evidence is documented in lane plans/progress docs, including targeted suites for:
  - search controls
  - run deltas + dashboard status copy
  - full-JD evaluation/detail coverage
  - retention cleanup/policy validation

## Known Limitations

- Legacy profile/narrata command surfaces still exist even though search-input flow is primary.
- `config/retention-policy.json` is optional and not auto-generated; defaults apply when absent.
- Analytics forwarding is opt-in via environment variables; local event persistence is default.
