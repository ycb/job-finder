# Job Finder

*Job intelligence agent that turns LinkedIn saved searches into a ranked action queue.*

## Dashboard Preview

<img width="1532" height="1496" alt="image" src="https://github.com/user-attachments/assets/207ebb5b-288e-4db6-9e03-180afd3b1927" />

The dashboard is designed around the actual workflow:

- manage named searches and rerun them on demand
- review one de-duped, prioritized queue instead of duplicate listings
- move completed applications out of the work queue and into a separate applied list

Job Finder is an intelligence agent for turning noisy job discovery into a ranked action queue. Runs locally, uses Codex and Playwrght MCP.

Instead of acting like another job board, generic scraper, or chat wrapper, it models your search as a repeatable system:

- structured profile and preference inputs
- named LinkedIn saved searches as reusable sources
- browser-driven intake into a local database
- deterministic fit scoring against your target criteria
- a de-duped review queue with lightweight application tracking

This repo is intentionally opinionated about the workflow: automate the repetitive intake and triage, keep the decision-making local, and preserve human review before anything high-stakes.

The current implementation focuses on:

- profile and source configuration
- LinkedIn capture by named saved search
- job intake into SQLite
- deterministic scoring
- shortlist generation
- de-duped review and application tracking

The current LinkedIn adapter supports two intake paths:

- live capture through the local browser bridge (`chrome_applescript` by default on macOS)
- snapshot import from `output/playwright/<source-id>-snapshot.md` as a fallback

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

1. Define your profile and preferences in `config/profile.json`.
2. Add labeled LinkedIn saved searches in `config/sources.json` or with the CLI.
3. Run live capture against those saved searches.
4. Score and de-dupe the results.
5. Review the ranked queue, then mark jobs as applied or rejected with notes.

## Setup

1. Copy and edit `config/profile.example.json` to `config/profile.json`.
2. Copy and edit `config/sources.example.json` to `config/sources.json`.
3. Add named LinkedIn sources with `node src/cli.js add-source "<Label>" "<LinkedIn URL>"`.
4. For the normal live workflow, start `npm run bridge` in one terminal.
5. In another terminal, run `npm run run:live`.
6. Open `npm run review` when you want the dashboard UI.

Fallback snapshot workflow:

- save Playwright snapshots under `output/playwright/<source-id>-snapshot.md`
- run `npm run capture:all`
- then run `npm run run`

For the full automated daily path with a running browser bridge:

```bash
npm run bridge
npm run run:live
```

## Commands

- `npm run init`
- `npm run sources`
- `npm run capture -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all`
- `npm run bridge`
- `npm run capture:live -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all:live`
- `npm run sync`
- `npm run score`
- `npm run shortlist`
- `npm run list`
- `npm run mark -- <job-id> <status>`
- `npm run review`
- `npm run run`
- `npm run run:live`

## Review Dashboard

`npm run review` starts the local dashboard for search management and job review.

The dashboard includes:

- a profile summary with active and applied counts
- a searchable list of named LinkedIn saved searches
- per-search run controls (`Run`, `Run All`, `See Results`, `Edit`)
- a de-duped ranked queue of actionable jobs (`new` and `viewed`)
- a separate `Applied` list

Jobs found in multiple searches are grouped into one review row and show which searches surfaced them.

## Status values

Supported statuses: `new`, `viewed`, `applied`, `rejected`.

- `new` and `viewed` stay in the actionable queue
- `applied` moves into the separate `Applied` list
- `rejected` is removed from the actionable queue
- rejecting a job requires a reason, which is stored as a note

## Live Capture Notes

The live capture commands require a running browser bridge service:

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
