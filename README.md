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
4. Save Playwright snapshots under `output/playwright/<source-id>-snapshot.md`.
5. Run `npm run capture:all`, then `npm run run`.

## Commands

- `npm run init`
- `npm run sources`
- `npm run capture -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all`
- `npm run sync`
- `npm run score`
- `npm run shortlist`
- `npm run list`
- `npm run mark -- <job-id> <status>`
- `npm run review`
- `npm run run`

## Status values

Suggested statuses: `new`, `viewed`, `applied`, `rejected`.
