# Analytics Event Schema and PostHog Mapping

As of 2026-03-08.

## Canonical Envelope

All analytics events emit a canonical envelope with:

- `schemaVersion`: current contract version (`2026-03-08`)
- `occurredAt`: ISO timestamp
- `event`: canonical event name
- `channel`: one of `terminal`, `dashboard`, `codex`, `claude`
- `identityMode`: one of `machine_hash`, `anonymous_session`
- `distinctId`: identity value scoped by `identityMode`
- `properties`: event-specific payload
- `posthog`: mapped transport payload (`event` + normalized `properties`)

PostHog properties always include:

- `channel`
- `identity_mode`
- `schema_version`

## Event Mapping

| Canonical Event | PostHog Event |
| --- | --- |
| `pipeline_run_completed` | `jf_pipeline_run_completed` |
| `jobs_synced` | `jf_jobs_synced` |
| `jobs_scored` | `jf_jobs_scored` |
| `shortlist_generated` | `jf_shortlist_generated` |
| `source_added` | `jf_source_added` |
| `source_captured_live` | `jf_source_captured_live` |
| `capture_quality_rejected` | `jf_capture_quality_rejected` |
| `job_status_changed` | `jf_job_status_changed` |
| `sync_score_completed` | `jf_sync_score_completed` |
| `source_run_completed` | `jf_source_run_completed` |
| `search_criteria_updated` | `jf_search_criteria_updated` |
| `profile_source_changed` | `jf_profile_source_changed` |

## Instrumented Surfaces

- `terminal`: CLI sync/score/shortlist/run and source-management paths
- `dashboard`: review API actions for profile source, criteria updates, sync-score, source runs, and job status changes
- `codex`: reserved channel in contract (runtime wiring follows MCP delivery)
- `claude`: reserved channel in contract (runtime wiring follows skill runtime delivery)
