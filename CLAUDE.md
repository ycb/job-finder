# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Commands

**Development workflow:**
- `npm run run` - Full pipeline: capture, sync, score, shortlist (recommended daily command)
- `npm run review` - Start local dashboard server at http://127.0.0.1:4311
- `npm test` - Run all tests using Node's built-in test runner

**Database:**
- `npm run init` - Initialize SQLite database at `data/jobs.db`

**Capture & sync:**
- `npm run capture -- <source-id-or-label> [snapshot-path]` - Capture single source
- `npm run capture:all` - Capture all enabled sources
- `npm run capture:live -- <source-id-or-label> [snapshot-path]` - Live capture via bridge
- `npm run capture:all:live` - Live capture all sources via bridge
- `npm run sync` - Sync jobs from all enabled sources into database

**Scoring & review:**
- `npm run score` - Run scoring algorithm on all jobs
- `npm run shortlist` - Generate shortlist
- `npm run list` - List all jobs
- `npm run mark -- <job-id> <status>` - Mark job with status

**Configuration management:**
- `npm run sources` - List all configured sources
- `node src/cli.js add-source <label> <linkedin-url>` - Add LinkedIn source
- `node src/cli.js add-builtin-source <label> <url>` - Add Built In source
- `node src/cli.js add-wellfound-source <label> <url>` - Add Wellfound source
- `node src/cli.js add-ashby-source <label> <url>` - Add Ashby source
- `node src/cli.js set-source-url <source-id-or-label> <url>` - Update source URL
- `node src/cli.js profile-source` - View current profile source configuration
- `node src/cli.js use-profile-file [path]` - Switch to legacy profile mode
- `node src/cli.js use-my-goals [path]` - Switch to goals-based profile mode
- `node src/cli.js connect-narrata-file [path]` - Connect Narrata goals file
- `node src/cli.js connect-narrata-supabase <url> <user-id> [env-var]` - Connect Narrata Supabase

**Browser bridge:**
- `npm run bridge` - Start browser bridge server manually (default port 4315)
- `node src/cli.js bridge-server [port] [provider]` - Start with custom port/provider

## Architecture

### System Overview

Job Finder is a local-first intelligence agent that transforms noisy job discovery into a ranked action queue. The system is designed around repeatability, transparency, and human-in-the-loop review.

**Core workflow:**
1. Profile configuration (local JSON files or Narrata sync)
2. Named search sources (LinkedIn, Built In, Wellfound, Ashby)
3. Browser-driven intake into local SQLite database
4. Deterministic scoring against target criteria
5. De-duped review queue with application tracking

### Key Design Principles

- **Local-first control**: All profile data, configuration, and application history stored locally
- **Deterministic scoring**: No opaque ranking; all scoring logic is inspectable
- **De-duplication**: Jobs found across multiple searches are merged into single review items
- **Source attribution**: Every job tracks which search(es) surfaced it
- **Separation of concerns**: `run` updates data, `review` serves UI (separate processes)

### Directory Structure

```
src/
  browser-bridge/     Browser automation layer
    client.js         Bridge client for live capture
    server.js         Bridge server (auto-started when needed)
    providers/        Provider implementations (chrome-applescript, playwright-cli, etc.)

  sources/           Source ingestion adapters
    linkedin-saved-search.js    LinkedIn capture & snapshot parsing
    builtin-jobs.js            Built In scraper
    wellfound-jobs.js          Wellfound scraper
    ashby-jobs.js              Ashby discovery & ingestion

  jobs/              Job processing & scoring
    normalize.js     Job normalization & de-duplication
    repository.js    Database access layer
    score.js         Deterministic scoring algorithm

  config/            Configuration management
    schema.js        Validation for profile, goals, sources
    load-config.js   Configuration loading & CLI commands

  db/                Database layer
    client.js        SQLite connection
    migrations.js    Schema & migrations

  review/            Dashboard server
    server.js        Express server for local UI

  output/            Output rendering
    render.js        Shortlist generation

  cli.js             CLI entry point

config/              User configuration (gitignored)
  profile.json       Legacy profile format
  my-goals.json      Goals-based profile format
  sources.json       Named search sources
  profile-source.json Profile provider selection

test/               Node.js test runner tests
  *test.js          Test files
```

### Database Schema

**jobs table:**
- Primary key: `id` (generated hash)
- Unique constraint: `(source_id, source_url)` - enforces one job per source
- Columns: source metadata, job details, normalized fields for de-dupe
- `normalized_hash`: Used for cross-source de-duplication
- `external_id`: Platform-specific ID (e.g., LinkedIn job ID)

**evaluations table:**
- Primary key: `job_id` (1:1 with jobs)
- Foreign key: `job_id` references `jobs(id)` with CASCADE delete
- Columns: score, bucket (high_signal/review_later/reject), summary, reasons, confidence, freshness, hard_filtered flag

**applications table:**
- Primary key: `job_id` (1:1 with jobs)
- Foreign key: `job_id` references `jobs(id)` with CASCADE delete
- Columns: status, notes, draft_path, timestamps
- Status values: `new`, `viewed`, `applied`, `skip_for_now`, `rejected`

### Source Types

**linkedin_capture_file:**
- Reads from `capturePath` (snapshot file)
- Requires Playwright MCP snapshot or live capture output
- Parses accessibility tree format

**builtin_search:**
- Direct HTTP ingestion from Built In search URLs
- Supports `maxJobs` and `requestTimeoutMs` options

**wellfound_search:**
- Direct HTTP ingestion from Wellfound URLs
- Supports `maxJobs` and `requestTimeoutMs` options
- Optional `capturePath` for snapshot fallback

**ashby_search:**
- Supports direct Ashby board URLs
- Supports Google discovery (`site:ashbyhq.com` queries)
- Expands discovered boards and filters matching roles
- Supports `maxJobs` and `requestTimeoutMs` options

**mock_linkedin_saved_search:**
- Test/dev mode: reads from `mockResultsPath`

### Browser Bridge Architecture

The browser bridge provides automated capture for LinkedIn sources through multiple provider strategies:

**chrome_applescript** (default on macOS):
- Uses AppleScript to extract content from active Chrome tab
- Requires Chrome setting: View > Developer > Allow JavaScript from Apple Events
- Fastest option, no Playwright dependency

**playwright_cli**:
- Uses Playwright MCP Bridge extension
- Requires `PLAYWRIGHT_MCP_EXTENSION_TOKEN` in environment or `~/.codex/config.toml`
- Requires local wrapper at `~/.codex/skills/playwright/scripts/playwright_cli.sh`

**persistent_scaffold**:
- Manual handoff workflow for when automation isn't available
- Writes pending request, user saves snapshot, rerun completes capture

**noop**:
- No-op provider for testing

The bridge auto-starts when running `npm run run` or dashboard `Run`/`Run All` commands if LinkedIn sources are enabled.

### Profile Source Modes

Three profile providers are supported:

**legacy_profile:**
- Reads `config/profile.json`
- Full control over scoring criteria

**my_goals:**
- Reads `config/my-goals.json`
- Maps goal-oriented inputs into scoring profile

**narrata:**
- File mode: reads Narrata goals JSON from file
- Supabase mode: fetches from Narrata Supabase instance

Auto-detection: If `config/profile-source.json` is missing, system prefers `my_goals` when `config/my-goals.json` exists, otherwise falls back to `legacy_profile`.

### Scoring Algorithm

Deterministic, profile-driven scoring with these components:

**Base fit signals:**
- Title family + seniority alignment
- Location/work-type alignment
- Salary floor alignment
- Target company / industry / business model alignment

**Programmatic upgrades:**
- Hard filters for deal-breakers (excluded keywords, salary/work-type requirements)
- Freshness adjustment from `posted_at`
- Data confidence score (source completeness)
- Source quality bonus (structured sources rank higher)
- History-aware adjustment (prior outcomes at company level)

**Output:**
- Numeric score
- Bucket assignment: `high_signal`, `review_later`, `reject`
- Summary and reasoning
- Confidence and freshness metrics

### Deduplication Strategy

Jobs are deduplicated using `normalized_hash` computed from:
- Normalized company name (case-insensitive, whitespace-normalized)
- External ID when available (e.g., LinkedIn job ID)
- Source URL as fallback

The unique constraint on `(source_id, source_url)` ensures one record per source per job. Multiple sources surfacing the same job (same `normalized_hash`) are tracked via source attribution in the review UI.

### Review Dashboard

Express server serving local UI with:

**Jobs tab:**
- Active/Applied/Skipped views
- De-duped ranked queue
- Selected job detail panel with prev/next navigation
- Attribution showing which sources surfaced the job
- Quick actions: mark applied, skip, reject (with reason)

**Searches tab:**
- List of named sources with quality metrics
- Per-source stats: jobs found, applied count, high signal %, avg score
- Run controls: Run, Run All, See Results, Edit

**Profile tab:**
- Profile summary (active count, applied count)
- Profile source mode switcher
- Configuration for legacy_profile, my_goals, or Narrata sync

## Development Notes

**Running tests:**
- Use `npm test` to run all tests
- Node's built-in test runner (no external dependencies)
- Test files use `node:test` and `node:assert/strict`

**Adding a new source type:**
1. Add type to allowed types in `src/config/schema.js` `validateSources()`
2. Create source collector function in `src/sources/` (return array of job objects)
3. Add case in `collectJobsFromSource()` in `src/sources/linkedin-saved-search.js`
4. Add CLI command in `src/config/load-config.js` if needed

**Adding new profile fields:**
1. Update validation in `src/config/schema.js`
2. Update scoring logic in `src/jobs/score.js`
3. Update example configs in `config/*.example.json`

**Database migrations:**
- Schema defined in `src/db/migrations.js` `runMigrations()`
- Use `addColumnIfMissing()` for backwards-compatible schema changes
- Migrations run automatically on every database open

**Job normalization:**
- All jobs pass through `normalizeJobRecord()` in `src/jobs/normalize.js`
- Computes `normalized_hash` for de-duplication
- Extracts/normalizes company, location, external_id

**Browser bridge providers:**
- Implement `captureSnapshot(url)` returning accessibility tree string
- Register in `src/browser-bridge/server.js`
- Default provider: `chrome_applescript`
