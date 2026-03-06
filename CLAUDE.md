# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See `/Users/admin/job-finder/PROCESS.md` for the full engineering workflow and quality bar.

## Workflow Orchestration

### 0. Scope Split (Bugfix vs Feature)

- **Bugfix**: Existing behavior is broken and a repro exists. Default: fix immediately, without a pre-implementation check-in.
- **Feature**: New behavior, architecture change, or non-trivial work (3+ steps). You **must** create/update an ExecPlan first and check in before implementation.
- **Always requires check-in first**: destructive operations, risky migrations, security/privacy-sensitive changes, or unclear requirements.

### 1. Plan Mode Default

Enter planning mode for any non-trivial work. If implementation drifts from plan or new constraints appear, stop and re-plan before continuing. Use planning mode for verification steps, not only build steps.

### 2. Subagent Strategy

Use subagents when tasks can be explored independently. Keep one focused track per subagent and synthesize results in the main thread before editing.

### Session Start

At the beginning of each session, read `/Users/admin/job-finder/docs/learnings.md` to review patterns and prevention rules from prior work.

### 3. Self-Improvement Loop

After corrections from the user, update `/Users/admin/job-finder/docs/learnings.md` with the pattern and prevention rule.

### 4. Verification Before Done

Never mark work complete without proof. Run tests, compare behavior before/after when relevant, and include concrete evidence in the final summary.

### 5. Demand Elegance (Balanced)

For non-trivial changes, pause and ask whether there is a simpler, more robust path. Avoid over-engineering for straightforward fixes.

### 6. Autonomous Bug Fixing

When given a bug report, reproduce it and fix it directly. Do not ask for hand-holding or pre-implementation check-in unless the work matches an "Always requires check-in first" condition.

## Execution Flow

1. Classify work as bugfix or feature.
2. Bugfix path: reproduce, implement, verify, summarize evidence.
3. Feature path: author/update ExecPlan per `/Users/admin/job-finder/PLANS.md`, check in, then implement. For non-trivial feature work, an ExecPlan is mandatory.
4. Track active steps in planning mode; keep ExecPlan `Progress` current for feature work.
5. Update `/Users/admin/job-finder/docs/learnings.md` when corrections reveal a reusable process lesson.

## Design Skill Pack (Draft)

For frontend and UX work, use:

- `/Users/admin/job-finder/.codex/skills/ux-flow-content/SKILL.md`
- `/Users/admin/job-finder/.codex/skills/design-system-ui/SKILL.md`
- `/Users/admin/job-finder/.codex/skills/microinteractions-motion/SKILL.md`

## Core Principles

**Simplicity First**: Keep changes minimal and clear.
**No Laziness**: Fix root causes, not symptoms.
**Minimal Impact**: Touch only what is necessary and verify no regressions.

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
- `node src/cli.js add-google-source <label> <query>` - Add Google search source
- `node src/cli.js add-indeed-source <label> <url>` - Add Indeed source
- `node src/cli.js add-ziprecruiter-source <label> <url>` - Add ZipRecruiter source
- `node src/cli.js add-remoteok-source <label> <url>` - Add RemoteOK source
- `node src/cli.js set-source-url <source-id-or-label> <url>` - Update source URL
- `node src/cli.js normalize-source-urls [--dry-run]` - Normalize source URLs from searchCriteria
- `node src/cli.js open-source <source-id-or-label>` - Open source URL in browser
- `node src/cli.js open-sources` - Open all source URLs in browser
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
2. Global and per-source search criteria (optional)
3. Named search sources (LinkedIn, Built In, Wellfound, Ashby, Google, Indeed, ZipRecruiter, RemoteOK)
4. Browser-driven or HTTP-based intake into local SQLite database
5. Deterministic scoring against target criteria
6. De-duped review queue with application tracking

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
  search-criteria.json Global search criteria (optional)
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

**Browser-capture sources** (require browser bridge):
- `linkedin_capture_file` - LinkedIn saved searches via live capture or snapshot
- `wellfound_search` - Wellfound job boards
- `ashby_search` - Ashby boards (direct URLs or Google discovery)
- `google_search` - Generic Google job searches
- `indeed_search` - Indeed job searches
- `ziprecruiter_search` - ZipRecruiter searches
- `remoteok_search` - RemoteOK job boards

**HTTP-based sources**:
- `builtin_search` - Built In search URLs (direct HTTP ingestion)

**Test/dev sources**:
- `mock_linkedin_saved_search` - Reads from `mockResultsPath`

All sources support:
- `maxJobs` - Limit results per capture/sync
- `requestTimeoutMs` - HTTP timeout (HTTP sources only)
- `cacheTtlHours` - Source-level cache TTL override
- `searchCriteria` - Canonical search parameters (auto-generates normalized URLs)
- `recencyWindow` - Google-style recency filter (`1d`, `1w`, `1m`, `any`) for Google/Ashby sources

### Browser Bridge Architecture

The browser bridge provides automated capture for browser-capture sources (LinkedIn, Wellfound, Ashby, Google, Indeed, ZipRecruiter, RemoteOK) through multiple provider strategies:

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

The bridge auto-starts when running `npm run run` or dashboard `Run`/`Run All` commands if browser-capture sources are enabled.

**Capture caching:**
- Default TTL: 12h for HTTP sources, 24h for browser-capture sources
- Per-source override: set `cacheTtlHours` in source config
- Force refresh: use `--force-refresh` flag to bypass cache

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

### Search Criteria Configuration

Global search criteria can be defined in `config/search-criteria.json` to provide default search parameters across all sources. Individual sources can override these with source-level `searchCriteria` fields.

**Supported fields:**
- `title` - Job title keywords
- `keywords` - Additional search keywords
- `location` - Location filter
- `minSalary` - Minimum salary threshold
- `distanceMiles` - Distance from location in miles
- `datePosted` - Recency filter (`any`, `1d`, `3d`, `1w`, `2w`, `1m`)
- `experienceLevel` - Experience level (`intern`, `entry`, `associate`, `mid`, `senior`, `director`, `executive`)

**Behavior:**
- Global criteria act as defaults for all sources
- Source-level `searchCriteria` override global values
- The system auto-generates normalized search URLs from these canonical fields
- Use `normalize-source-urls` command to preview/apply URL normalization
- Dashboard Profile tab provides UI for editing global search criteria

**URL normalization:**
- For URL-driven sources (Built In, LinkedIn), `searchCriteria` are formatted into proper query parameters
- For Google-based sources (Ashby, Google search), criteria map to Google query syntax
- `datePosted` maps to Google `qdr` parameter (`1d` → `d`, `1w` → `w`, `1m` → `m`)
- Wellfound is currently a stub (no URL application from criteria)

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
- Source editor with URL normalization from searchCriteria

**Profile tab:**
- Profile summary (active count, applied count)
- Profile source mode switcher (legacy_profile, my_goals, or Narrata sync)
- Global search criteria editor (title, keywords, location, salary, date posted)
- Configuration paths for all config files

## Development Notes

**Running tests:**
- Use `npm test` to run all tests
- Node's built-in test runner (no external dependencies)
- Test files use `node:test` and `node:assert/strict`

**Adding a new source type:**
1. Add type to allowed types in `src/config/schema.js` `validateSources()`
2. Create source collector function in `src/sources/` (return array of job objects)
3. Add case in `collectJobsFromSource()` in `src/sources/linkedin-saved-search.js`
4. Add CLI command helper in `src/config/load-config.js` if needed
5. If source uses `searchCriteria`, implement URL builder in `buildSearchUrlForSourceType()`
6. Determine if source needs browser bridge (add to browser-capture type list) or HTTP-only

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

**Search criteria system:**
- Global criteria loaded from `config/search-criteria.json` via `loadSearchCriteria()`
- Sources loaded with `loadSourcesWithPath()` merge global + source-level criteria
- `resolveEffectiveSearchCriteria()` implements override logic (source-level wins)
- `ensureDerivedSourceMetadata()` auto-updates source URLs from effective criteria
- URL builders in `buildSearchUrlForSourceType()` format criteria into platform-specific URLs
- Dashboard exposes global criteria editor with save + normalize flow
