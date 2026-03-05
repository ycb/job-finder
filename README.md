# Job Finder

*Job intelligence agent that turns saved searches into a ranked action queue.*

## Dashboard Preview

<img width="1532" height="1496" alt="image" src="https://github.com/user-attachments/assets/207ebb5b-288e-4db6-9e03-180afd3b1927" />

The dashboard is designed around the actual workflow:

- manage named searches and rerun them on demand
- review one de-duped, prioritized queue instead of duplicate listings
- move completed applications out of the work queue and into a separate applied list

Job Finder is an intelligence agent for turning noisy job discovery into a ranked action queue. Runs locally, uses Codex and Playwright MCP.

Instead of acting like another job board, generic scraper, or chat wrapper, it models your search as a repeatable system:

- structured profile and preference inputs
- named search sources (LinkedIn and Built In) as reusable inputs
- browser-driven intake into a local database
- deterministic fit scoring against your target criteria
- a de-duped review queue with lightweight application tracking

This repo is intentionally opinionated about the workflow: automate the repetitive intake and triage, keep the decision-making local, and preserve human review before anything high-stakes.

The current implementation focuses on:

- profile/goals and source configuration
- LinkedIn capture by named saved search
- Built In SF search ingestion by URL
- job intake into SQLite
- deterministic scoring with hard filters, freshness, confidence, and history-aware signals
- shortlist generation
- de-duped review and application tracking

The current intake adapters support:

- LinkedIn live capture through the local browser bridge (`chrome_applescript` by default on macOS)
- LinkedIn snapshot import from `output/playwright/<source-id>-snapshot.md` as a fallback
- Built In search ingestion directly from the configured search URL during `sync`

The scoring and review pipeline stays stable across both.

## Why This Is Different

The useful part of this project is not "AI chat for jobs." The differentiation is the system design:

- local-first control over profile data, source configuration, and application history
- browser automation tied to real saved searches instead of a generic feed
- structured, inspectable scoring instead of opaque ranking
- de-dupe across overlapping searches so the review queue stays actionable
- a human-in-the-loop review loop that is fast enough to use daily

That makes it a stronger demonstration of AI-native product thinking than a thin wrapper around an LLM prompt. The current ranking is deterministic by design; the architecture leaves room for LLM-assisted drafting or orchestration later without making the core workflow depend on it.

## Current Workflow

1. Define your profile either in `config/profile.json` or `config/my-goals.json`.
2. Add labeled search sources in `config/sources.json` or with the CLI.
3. Run `npm run run` to execute intake + scoring + shortlist generation.
4. Start `npm run review` to run the local dashboard server and inspect ranked jobs and attribution.
5. Mark jobs as applied/rejected and refine sources based on outcomes.

`run` and `review` are separate processes:

- `npm run run` updates data (capture, sync, score, shortlist).
- `npm run review` serves the local UI at `http://127.0.0.1:4311`.
- if you only run `run`, dashboard data changes will not appear until `review` is running and refreshed.

## Setup

1. Copy and edit `config/profile.example.json` to `config/profile.json`.
2. Copy and edit `config/my-goals.example.json` to `config/my-goals.json` if you want goals-based scoring inputs.
3. Copy `config/profile-source.example.json` to `config/profile-source.json` if you want to explicitly control provider mode.
4. Copy and edit `config/sources.example.json` to `config/sources.json`.
5. Add named LinkedIn sources with `node src/cli.js add-source "<Label>" "<LinkedIn URL>"`.
6. Optionally add Built In sources with `node src/cli.js add-builtin-source "<Label>" "<Built In URL>"`.
7. Run `npm run run` for the full pipeline. LinkedIn capture auto-starts a local bridge only when needed.
8. Start `npm run review` when you want the dashboard UI (this is a separate long-running server process).

Fallback snapshot workflow:

- save Playwright snapshots under `output/playwright/<source-id>-snapshot.md`
- run `npm run capture:all`
- then run `npm run run`

For the full automated daily path:

```bash
npm run run
```

## Commands

- `npm run run` (recommended daily command; full pipeline)
- `npm run run:live` (compatibility alias for `run`)
- `npm run init`
- `npm run sources`
- `node src/cli.js add-source <label> <linkedin-url>`
- `node src/cli.js add-builtin-source <label> <built-in-url>`
- `node src/cli.js set-source-url <source-id-or-label> <url>`
- `node src/cli.js profile-source`
- `node src/cli.js use-my-goals [goals-path]`
- `node src/cli.js use-profile-file [profile-path]`
- `node src/cli.js connect-narrata-file [goals-path]`
- `node src/cli.js connect-narrata-supabase <supabase-url> <user-id> [service-role-env]`
- `npm run capture -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all`
- `npm run capture:live -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all:live`
- `npm run bridge`
- `npm run sync`
- `npm run score`
- `npm run shortlist`
- `npm run list`
- `npm run mark -- <job-id> <status>`
- `npm run review`

## Review Dashboard

`npm run review` starts the local dashboard for search management and job review.

The dashboard includes:

- top-level tabs: `Jobs`, `Searches`, `Profile`
- a profile summary with active and applied counts
- profile source controls (`profile.json`, `my-goals.json`, or Narrata file sync) in `Profile`
- a searchable list of named job search sources
- per-source quality signals (`jobs found`, `applied`, `high signal %`, `avg score`)
- per-search run controls (`Run`, `Run All`, `See Results`, `Edit`) in `Searches`
- a de-duped ranked queue with selected-job detail and `Prev/Next` navigation in `Jobs`
- `Active`, `Applied`, and `Skipped` job views in `Jobs`
- per-job attribution showing which source/search URLs surfaced the role

Jobs found in multiple searches are grouped into one review row and show which searches surfaced them.

## Profile Source Modes

`job-finder` supports three profile providers:

- `legacy_profile`: reads `config/profile.json`
- `my_goals`: reads `config/my-goals.json` and maps goals into scoring profile fields
- `narrata` (`file` mode in first pass): reads Narrata goals JSON via file path

If `config/profile-source.json` is missing, `job-finder` auto-uses `my_goals` when `config/my-goals.json` exists; otherwise it falls back to `profile.json`.

Switch with CLI:

```bash
node src/cli.js use-profile-file
node src/cli.js use-my-goals
node src/cli.js connect-narrata-file config/my-goals.json
node src/cli.js profile-source
```

Or switch in the `Profile` tab in the review dashboard.

## Scoring (First-Pass Programmatic)

Scoring is deterministic and profile-driven. Each job is evaluated into `high_signal`, `review_later`, or `reject`.

Base fit signals:

- title family + seniority alignment
- location/work-type alignment
- salary floor alignment
- target company / specialty / industry alignment

Programmatic upgrades in this pass:

- hard filters for explicit deal-breakers (excluded keywords, salary/work-type deal-breakers)
- freshness adjustment from `posted_at` when available
- data confidence score based on source completeness
- source-quality bonus (better-structured sources score slightly higher)
- history-aware adjustment from your prior outcomes (`applied`, `rejected`, `skip_for_now`) at company level

What the score is used for:

- rank ordering in `Jobs > Active`
- bucket assignment (`high_signal`, `review_later`, `reject`)
- per-source quality rollups in `Searches` (high signal %, average score)

## Status values

Supported statuses: `new`, `viewed`, `applied`, `skip_for_now`, `rejected`.

- `new` and `viewed` stay in the actionable queue (`Jobs > Active`)
- `applied` moves into `Jobs > Applied`
- `skip_for_now` moves into `Jobs > Skipped`
- `rejected` is removed from active review views
- rejecting a job requires a reason, which is stored as a note

## Live Capture Notes

LinkedIn sources require a browser bridge service. `npm run run` and dashboard `Run`/`Run All` auto-start a local bridge when needed.

Manual bridge startup is still available:

- Start it with `node src/cli.js bridge-server [port] [provider]`
- Default port: `4315`
- Default provider: `chrome_applescript`
- Fastest automation on macOS: `chrome_applescript`
- Temporary fallback provider: `playwright_cli`
- Manual handoff fallback provider: `persistent_scaffold`

`chrome_applescript` captures directly from the active Chrome tab and does not require Playwright snapshots.

One-time Chrome setup:

1. In Chrome, open `View`
2. Open `Developer`
3. Enable `Allow JavaScript from Apple Events`

`persistent_scaffold` is a stateful handoff flow:

1. `capture-source-live` opens the saved search and writes a pending request file.
2. You save a fresh Playwright snapshot to the requested path.
3. You rerun the same capture command.
4. The bridge detects the fresh snapshot, imports it, and completes the capture.

The `playwright_cli` provider still depends on:

- the Playwright MCP Bridge browser extension being connected
- a valid `PLAYWRIGHT_MCP_EXTENSION_TOKEN` in your environment or `~/.codex/config.toml`
- the local Playwright CLI wrapper at `~/.codex/skills/playwright/scripts/playwright_cli.sh`

If the browser bridge or provider is unavailable, use the snapshot import flow instead.
