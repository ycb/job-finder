# Job Finder

*Job intelligence agent that turns saved searches into a ranked action queue.*

Search all major job boards, get one de-duplicated, ranked list of best-match jobs.

## Quick Start

```bash
# Clone and install
git clone https://github.com/ycb/job-finder.git
cd job-finder
npm install
npm link  # Makes 'jf' command available globally

# Initialize local database
jf init

# Copy starter config files
cp config/profile.example.json config/profile.json
cp config/sources.example.json config/sources.json
cp config/search-criteria.example.json config/search-criteria.json

# Add at least one source
jf add-source "Senior PM AI" "https://www.linkedin.com/jobs/search/?keywords=senior%20product%20manager%20ai"

# Sync + score jobs (run daily)
jf run

# Open dashboard to review jobs
jf review
# Opens http://localhost:4311
```

**That's it.** Dashboard shows de-duplicated jobs, ranked by your configured search criteria.

---

## Dashboard Preview

<img width="1532" height="1496" alt="image" src="https://github.com/user-attachments/assets/207ebb5b-288e-4db6-9e03-180afd3b1927" />

The dashboard is designed around the actual workflow:

- manage named searches and rerun them on demand
- review one de-duped, prioritized queue instead of duplicate listings
- move completed applications out of the work queue and into a separate applied list

Job Finder is an intelligence agent for turning noisy job discovery into a ranked action queue. Runs locally, uses Codex and Playwright MCP.

Instead of acting like another job board, generic scraper, or chat wrapper, it models your search as a repeatable system:

- structured profile and preference inputs
- named search sources (LinkedIn, Built In, Google, Wellfound, Ashby, Indeed, ZipRecruiter, RemoteOK) as reusable inputs
- browser-driven intake into a local database
- deterministic fit scoring against your target criteria
- a de-duped review queue with lightweight application tracking

This repo is intentionally opinionated about the workflow: automate the repetitive intake and triage, keep the decision-making local, and preserve human review before anything high-stakes.

The current implementation focuses on:

- profile/goals, search criteria, and source configuration
- source URL normalization from canonical `config/search-criteria.json`
- browser-capture intake for LinkedIn / Wellfound / Ashby / Google / Indeed / ZipRecruiter / RemoteOK
- Built In ingestion from configured search URLs
- job intake into SQLite
- deterministic scoring with hard filters, freshness, confidence, and history-aware signals
- shortlist generation
- de-duped review and application tracking

The current intake adapters support:

- live capture through the local browser bridge (`chrome_applescript` by default on macOS)
- source-level capture caching with TTL controls and `--force-refresh` overrides
- LinkedIn snapshot import from `output/playwright/<source-id>-snapshot.md` as a fallback
- HTTP fetch parsers for URL-driven ingestion flows during `sync`

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

1. Define global search intent in `config/search-criteria.json`.
2. Add labeled search sources in `config/sources.json` or with the CLI.
3. Run `npm run run` to execute capture + sync + prune + scoring + shortlist generation.
4. Start `npm run review` and use `Find Jobs` in the `Jobs` tab to save criteria and run all sources from the UI.
5. Mark jobs as applied/skipped/rejected and refine criteria/sources based on outcomes.

`run` and `review` are separate processes:

- `npm run run` updates data (capture, sync, score, shortlist).
- `npm run review` serves the local UI at `http://127.0.0.1:4311`.
- if you only run `run`, dashboard data changes will not appear until `review` is running and refreshed.

## Setup

1. Copy and edit `config/profile.example.json` to `config/profile.json`.
2. Copy and edit `config/my-goals.example.json` to `config/my-goals.json` if you want goals-based scoring inputs.
3. Copy `config/profile-source.example.json` to `config/profile-source.json` if you want to explicitly control provider mode.
4. Copy and edit `config/search-criteria.example.json` to `config/search-criteria.json`.
5. Copy and edit `config/sources.example.json` to `config/sources.json`.
6. Add named LinkedIn sources with `node src/cli.js add-source "<Label>" "<LinkedIn URL>"`.
7. Optionally add non-LinkedIn sources with:
   - `node src/cli.js add-builtin-source "<Label>" "<Built In URL>"`
   - `node src/cli.js add-google-source "<Label>" "<Google URL>" [any|1d|1w|1m]`
   - `node src/cli.js add-wellfound-source "<Label>" "<Wellfound URL>"`
   - `node src/cli.js add-ashby-source "<Label>" "<Ashby URL>"`
   - `node src/cli.js add-indeed-source "<Label>" "<Indeed URL>"`
   - `node src/cli.js add-ziprecruiter-source "<Label>" "<ZipRecruiter URL>"`
   - `node src/cli.js add-remoteok-source "<Label>" "<RemoteOK URL>"`
   - for Ashby discovery, you can also use a Google query URL like `site:ashbyhq.com "product manager" "San Francisco" "AI"`; Job Finder expands discovered company boards and ingests matching roles
8. Run `npm run run` for the full pipeline. Browser capture auto-starts a local bridge when needed.
9. Use `npm run run -- --force-refresh` when you want to bypass cache TTL and force fresh browser/HTTP collection.
10. Start `npm run review` when you want the dashboard UI (this is a separate long-running server process).
11. Optional refresh-profile tuning:
    - `JOB_FINDER_REFRESH_PROFILE=safe` (default)
    - `JOB_FINDER_REFRESH_PROFILE=probe` (shorter intervals, still throttled)
    - `JOB_FINDER_REFRESH_PROFILE=mock` (no live refresh; cache-only)

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
- `npm run run -- --force-refresh` (force fresh capture/fetch; ignore cache TTL)
- `npm run run:live` (compatibility alias for `run`)
- `npm run run:safe`
- `npm run run:probe`
- `npm run run:mock`
- `JOB_FINDER_REFRESH_PROFILE=probe npm run run` (dev probing mode with guardrails)
- `JOB_FINDER_REFRESH_PROFILE=mock npm run run` (cache-only mode for UI/scoring iteration)
- `npm run init`
- `npm run sources`
- `node src/cli.js add-source <label> <linkedin-url>`
- `node src/cli.js add-builtin-source <label> <built-in-url>`
- `node src/cli.js add-google-source <label> <google-url> [any|1d|1w|1m]`
- `node src/cli.js add-wellfound-source <label> <wellfound-url>`
- `node src/cli.js add-ashby-source <label> <ashby-url>`
- `node src/cli.js add-indeed-source <label> <indeed-url>`
- `node src/cli.js add-ziprecruiter-source <label> <ziprecruiter-url>`
- `node src/cli.js add-remoteok-source <label> <remoteok-url>`
- `node src/cli.js set-source-url <source-id-or-label> <url>`
- `node src/cli.js normalize-source-urls --dry-run`
- `node src/cli.js profile-source`
- `node src/cli.js use-my-goals [goals-path]`
- `node src/cli.js use-profile-file [profile-path]`
- `node src/cli.js connect-narrata-file [goals-path]`
- `node src/cli.js connect-narrata-supabase <supabase-url> <user-id> [service-role-env]`
- `node src/cli.js open-source <source-id-or-label>`
- `node src/cli.js open-sources`
- `npm run capture -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all`
- `node src/cli.js import-linkedin-snapshot <source-id-or-label> <snapshot-path>`
- `npm run capture:live -- <source-id-or-label> [snapshot-path]`
- `npm run capture:live -- <source-id-or-label> [snapshot-path] --force-refresh`
- `npm run capture:all:live`
- `npm run capture:all:live -- --force-refresh`
- `npm run bridge`
- `npm run sync`
- `npm run score`
- `npm run shortlist`
- `npm run list`
- `npm run mark -- <job-id> <status>`
- `npm run review`
- `npm run review:safe`
- `npm run review:probe`
- `npm run review:mock`

## Review Dashboard

`npm run review` starts the local dashboard for search management and job review.

The dashboard includes:

- top-level tabs: `Jobs`, `Searches`, `Profile`
- `Jobs` tab `Find Jobs` control that saves search criteria and runs all sources
- a de-duped ranked queue with selected-job detail and `Prev/Next` navigation in `Jobs`
- job views: `All`, `New`, `Best Match`, `Applied`, `Skipped`, `Rejected`
- source-kind job filters in `Jobs` (for example, LinkedIn/Built In/Ashby)
- `Searches` tab grouped by source kind with funnel metrics: `Found`, `Filtered`, `Dupes`, `Imported`, `Avg Score`
- source refresh/capture status signals including cache/live state
- row click-through from `Searches` into filtered `Jobs` view
- `Profile` tab path visibility for profile/goals/sources/search criteria configs
- profile source controls (`profile.json`, `my-goals.json`, Narrata file mode)
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

Or switch in the `Profile` tab in the review dashboard. Narrata connection controls are hidden unless `JOB_FINDER_ENABLE_NARRATA_CONNECT=1`.

## Scoring (Search-Criteria Driven)

Scoring is deterministic and driven by `config/search-criteria.json` (with per-source `searchCriteria` overrides for URL construction).

Each job is evaluated into `high_signal`, `review_later`, or `reject` using weighted criteria:

- title match (35)
- keywords match ratio (25)
- location match (15)
- salary floor match (15)
- freshness target (`datePosted`) match (10)

Scoring notes:

- keyword terms are split from comma/semicolon/`and`-style input
- AI-like tokens (`ai`, `ml`, `llm`, `genai`) map to broader AI phrase matching
- title mismatch is strongly penalized (score cap path)
- source hard filters still run before scoring when configured in `sources.json`

Global search-construction criteria in `config/search-criteria.json`:

- `title`, `keywords`, `location`, `minSalary`, `distanceMiles`, `datePosted`, `experienceLevel`
- these are used as the default canonical variables when constructing source URLs
- the dashboard `Jobs` tab `Find Jobs` control provides a single editor for these fields (`Title`, `Keyword`, `Location`, `Salary`, `Posted on`)

Per-source quality/caching knobs in `config/sources.json`:

- `requiredTerms` (optional string array): every job must match all terms before it enters scoring/ranking.
- `cacheTtlHours` (optional number): source-level TTL override.
- `searchCriteria` (optional object): per-source override on top of global criteria for the same canonical fields.
- `hardFilter` (optional object): explicit filter controls before scoring.
  - `requiredAll` (string array): all terms must match in selected fields.
  - `requiredAny` (string array): at least one term must match in selected fields.
  - `excludeAny` (string array): any matching term drops the job before scoring.
  - `fields` (string array): fields to evaluate (`title`, `summary`, `description`, `location`, `company`).
  - `enforceContentOnSnippets` (boolean): when `false`, content checks can be deferred for thin snippets.
- `searchCriteria` currently stubs (no URL application) for `wellfound_search`; Wellfound is treated as a UI-bootstrap outlier.
- `searchCriteria.minSalary` is intentionally not applied to `ashby_search` URL construction; it remains available to scoring.
- Default TTLs: `12h` for HTTP sources (for example, Built In) and `24h` for browser-capture sources (LinkedIn/Wellfound/Ashby/Google/Indeed/ZipRecruiter/RemoteOK).

Refresh policy behavior:

- The UI `Refresh` action can serve cache or run live capture depending on policy/state.
- Source-level policy enforces min interval, daily cap, and cooldown after challenge/captcha signals.
- Dashboard/API status fields now include:
  - `refreshMode` (`safe`, `probe`, `mock`)
  - `servedFrom` (`live` or `cache`)
  - `nextEligibleAt`
  - `cooldownUntil`
  - `statusLabel` / `statusReason`
- Invalid `JOB_FINDER_REFRESH_PROFILE` values now fail fast with an actionable error.

What the score is used for:

- rank ordering in `Jobs > Active`
- bucket assignment (`high_signal`, `review_later`, `reject`)
- per-source quality rollups in `Searches` (high signal %, average score)

## Status values

Supported statuses: `new`, `viewed`, `applied`, `skip_for_now`, `rejected`.

- `new` and `viewed` stay in the actionable queue (`Jobs` tab active views)
- `applied` moves into `Jobs > Applied`
- `skip_for_now` moves into `Jobs > Skipped`
- `rejected` moves into `Jobs > Rejected`
- rejecting a job requires a reason, which is stored as a note
- sync pruning removes stale `new/viewed` records per source when they no longer appear in current capture results
- newly captured jobs can inherit existing application status by `normalized_hash` (for example, previously rejected duplicates stay rejected)

## Live Capture Notes

Browser-capture sources require a browser bridge service. `npm run run` and dashboard `Find Jobs` auto-start a local bridge when needed.

Manual bridge startup is still available:

- Start it with `node src/cli.js bridge-server [port] [provider]`
- Default port: `4315`
- Default provider: `chrome_applescript`
- Fastest automation on macOS: `chrome_applescript`
- Temporary fallback provider: `playwright_cli`
- Manual handoff fallback provider: `persistent_scaffold`

`chrome_applescript` captures directly from the active Chrome tab and does not require Playwright snapshots.
LinkedIn live capture now includes multi-page traversal (`start=0`, `25`, `50`, ...) and stores `expectedCount` when extractable for capture verification.

Browser-capture source types:

- `linkedin_capture_file`
- `wellfound_search`
- `ashby_search`
- `google_search`
- `indeed_search`
- `ziprecruiter_search`
- `remoteok_search`

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

## Feature Flags

Dashboard feature flags:

- `JOB_FINDER_ENABLE_WELLFOUND=1`: enable Wellfound source visibility/creation in review UI
- `JOB_FINDER_ENABLE_REMOTEOK=1`: enable RemoteOK source visibility/creation in review UI
- `JOB_FINDER_ENABLE_NARRATA_CONNECT=1`: show Narrata connect controls in `Profile` tab
