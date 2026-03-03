# Job Finder MVP

Local-first CLI scaffold for a job search agent. This first cut focuses on:

- profile and source configuration
- LinkedIn snapshot import by named saved search
- job intake into SQLite
- deterministic scoring
- shortlist generation
- application status tracking

The current LinkedIn adapter imports Playwright accessibility snapshots saved to `output/playwright/<source-id>-snapshot.md`. The rest of the pipeline stays stable while the browser capture backend evolves.

## Setup

1. Copy and edit `config/profile.example.json` to `config/profile.json`.
2. Copy and edit `config/sources.example.json` to `config/sources.json`.
3. Add named LinkedIn sources with `node src/cli.js add-source "<Label>" "<LinkedIn URL>"`.
4. Either:
   - save Playwright snapshots under `output/playwright/<source-id>-snapshot.md` and run `npm run capture:all`, or
   - run `npm run capture:all:live` to have the app drive the browser via the local Playwright CLI bridge.
5. Run `npm run run`.

## Commands

- `npm run init`
- `npm run sources`
- `npm run capture -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all`
- `npm run capture:live -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all:live`
- `npm run sync`
- `npm run score`
- `npm run shortlist`
- `npm run list`
- `npm run mark -- <job-id> <status>`
- `npm run review`
- `npm run run`

## Status values

Suggested statuses: `new`, `viewed`, `applied`, `rejected`.

## Live Capture Notes

The live capture commands require:

- the Playwright MCP Bridge browser extension to be connected
- a valid `PLAYWRIGHT_MCP_EXTENSION_TOKEN` in your environment or `~/.codex/config.toml`
- the local Playwright CLI wrapper installed at `~/.codex/skills/playwright/scripts/playwright_cli.sh`

If the CLI bridge is unavailable, use the snapshot import flow instead.
