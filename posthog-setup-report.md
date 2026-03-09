<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of your project. The `posthog-node` SDK was already installed (`^5.28.0`) and a well-structured analytics singleton existed in `src/analytics.js`. All 12 planned events were already instrumented across `src/cli.js` (CLI pipeline, source management) and `src/review/server.js` (dashboard actions). Environment variables `POSTHOG_API_KEY` and `POSTHOG_HOST` were confirmed and updated in `.env`. No code changes were required — the integration was complete and correct.

| Event | Description | File |
|-------|-------------|------|
| `pipeline_run_completed` | Full pipeline (capture → sync → score → shortlist) completed via `npm run run` | `src/cli.js` |
| `jobs_synced` | Jobs synced from all enabled sources into the database via `npm run sync` | `src/cli.js` |
| `jobs_scored` | All jobs scored against the active profile via `npm run score` | `src/cli.js` |
| `shortlist_generated` | Shortlist file written via `npm run shortlist` | `src/cli.js` |
| `source_added` | A new job search source was added via CLI (any platform) | `src/cli.js` |
| `source_captured_live` | A single browser-capture source was refreshed live via the bridge | `src/cli.js` |
| `capture_quality_rejected` | A source was skipped during sync due to capture quality guardrail rejection | `src/cli.js` |
| `job_status_changed` | User changed a job's application status via the review dashboard | `src/review/server.js` |
| `sync_score_completed` | Sync and score pipeline triggered from the review dashboard | `src/review/server.js` |
| `source_run_completed` | A single source was captured and synced via the dashboard Run button | `src/review/server.js` |
| `search_criteria_updated` | Global search criteria saved via the Profile tab | `src/review/server.js` |
| `profile_source_changed` | Profile provider switched via the review dashboard | `src/review/server.js` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard**: [Analytics basics](https://us.posthog.com/project/336026/dashboard/1342796)
- **Insight 1**: [Pipeline activity (runs, syncs, scores)](https://us.posthog.com/project/336026/insights/3Tjkeadn)
- **Insight 2**: [Job review funnel (run → sync → score → shortlist)](https://us.posthog.com/project/336026/insights/GQI4NFe1)
- **Insight 3**: [Job status changes by type](https://us.posthog.com/project/336026/insights/EXhbZ9rc)
- **Insight 4**: [Source activity (adds, live captures, runs)](https://us.posthog.com/project/336026/insights/PHxHjczN)
- **Insight 5**: [Data quality & dashboard usage](https://us.posthog.com/project/336026/insights/5ZbPAKW8)

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/posthog-integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
