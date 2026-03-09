# Job Finder

*Job intelligence agent that turns generated searches into a ranked action queue.*

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

# Open dashboard to review jobs
jf review
# Opens http://localhost:4311

# Enter search input in the dashboard and click "Find Jobs"
```

**That's it.** Dashboard shows de-duplicated jobs ranked from your search input.

---

## Dashboard Preview

<img width="1532" height="1496" alt="image" src="https://github.com/user-attachments/assets/207ebb5b-288e-4db6-9e03-180afd3b1927" />

The dashboard is designed around the actual workflow:

- enter search input and trigger intake from one place
- review one de-duped, prioritized queue instead of duplicate listings
- move completed applications out of the work queue and into a separate applied list

Job Finder is an intelligence agent for turning noisy job discovery into a ranked action queue. Runs locally, uses Codex and Playwright MCP.

Instead of acting like another job board, generic scraper, or chat wrapper, it models your search as a repeatable system:

- structured search input
- automatically generated searches across supported job sources
- browser-driven intake into a local database
- deterministic fit scoring against your target criteria
- a de-duped review queue with lightweight application tracking

This repo is intentionally opinionated about the workflow: automate the repetitive intake and triage, keep the decision-making local, and preserve human review before anything high-stakes.

The current implementation focuses on:

- search-input-driven intake and scoring
- browser-capture intake for LinkedIn / Wellfound / Ashby / Google / Indeed / ZipRecruiter / RemoteOK
- Built In ingestion from configured search URLs
- job intake into SQLite
- deterministic scoring with hard filters, AND/OR keyword mode, include/exclude terms, freshness, confidence, and history-aware signals
- capture-quality guardrails with quarantine/reject protection and source health telemetry
- run delta tracking (`new`, `updated`, `unchanged`) across source refreshes
- status-aware retention cleanup with per-status TTLs and audit logs
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

- local-first control over search input, source execution, and application history
- browser automation tied to real search runs instead of a generic feed
- structured, inspectable scoring instead of opaque ranking
- de-dupe across overlapping searches so the review queue stays actionable
- a human-in-the-loop review loop that is fast enough to use daily

That makes it a stronger demonstration of AI-native product thinking than a thin wrapper around an LLM prompt. The current ranking is deterministic by design; the architecture leaves room for LLM-assisted drafting or orchestration later without making the core workflow depend on it.

## Current Workflow

1. Start `npm run review` and open the dashboard.
2. Enter search input and click `Find Jobs`.
3. Let the system generate and run searches automatically.
4. Review ranked jobs and mark outcomes (`applied`, `skip_for_now`, `rejected`).
5. Iterate search input and rerun.

`run` and `review` are separate processes:

- `npm run run` updates data (capture, sync, score, shortlist).
- `npm run review` serves the local UI at `http://127.0.0.1:4311`.
- if you only run `run`, dashboard data changes will not appear until `review` is running and refreshed.

## Setup

1. Run `jf init` to initialize the SQLite database.
2. Start the dashboard with `npm run review`.
3. Use dashboard search input + `Find Jobs` to run the pipeline.
4. No `profile.json` / `my-goals.json` setup is required for scoring.
5. No manual search/source creation is required in normal workflow.

Fallback snapshot workflow:

- save Playwright snapshots under `output/playwright/<source-id>-snapshot.md`
- run `npm run capture:all`
- then run `npm run run`

For the full automated daily path:

```bash
npm run run
```

## Commands

Daily workflow:

- `npm run review`
- `npm run run` (full pipeline: capture -> sync -> score -> shortlist -> list)
- `npm run run -- --force-refresh` (ignore capture cache TTLs)
- `npm run run -- --allow-quarantined` (operator override; ingest quarantine outcomes)
- `npm run run:safe`
- `npm run run:probe`
- `npm run run:mock`

Quality and diagnostics:

- `node src/cli.js check-source-contracts [--window 3] [--min-coverage 0.9] [--stale-days 30]`
- `node src/cli.js check-source-canaries [--include-disabled]`
- `node src/cli.js retention-policy` (show effective retention policy + policy path)
- `npm run sync -- --allow-quarantined` (override ingest gate for quarantine outcomes)
- Quality artifacts:
  - quarantine runs: `data/quality/quarantine/<source-id>/*.json`
  - source health history: `data/quality/source-health-history.json`
  - contract coverage history: `data/quality/source-coverage-history.json`
  - contract drift diagnostics: `data/quality/contract-drift/latest.json`
  - canary diagnostics: `data/quality/canary-checks/latest.json`
  - retention cleanup audit: `data/retention/cleanup-audit.jsonl`
  - analytics events/counters: `data/analytics/events.jsonl`, `data/analytics/counters.json`

Capture/source operations:

- `npm run sources`
- `node src/cli.js normalize-source-urls --dry-run`
- `npm run capture -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all`
- `npm run capture:live -- <source-id-or-label> [snapshot-path]`
- `npm run capture:all:live`
- `npm run bridge`
- `node src/cli.js import-linkedin-snapshot <source-id-or-label> <snapshot-path>`
- `node src/cli.js open-source <source-id-or-label>`
- `node src/cli.js open-sources`

Legacy/manual source management (optional, not required for normal dashboard flow):

- `node src/cli.js add-source <label> <url>`
- `node src/cli.js add-builtin-source <label> <url>`
- `node src/cli.js add-google-source <label> <url> [any|1d|1w|1m]`
- `node src/cli.js add-wellfound-source <label> <url>`
- `node src/cli.js add-ashby-source <label> <url> [any|1d|1w|1m]`
- `node src/cli.js add-indeed-source <label> <url>`
- `node src/cli.js add-ziprecruiter-source <label> <url>`
- `node src/cli.js add-remoteok-source <label> <url>`
- `node src/cli.js set-source-url <source-id-or-label> <url>`

Other:

- `npm run init`
- `npm run score`
- `npm run shortlist` (writes `output/shortlist.json`)
- `npm run list`
- `npm run mark -- <job-id> <status>`
- `npm run review:safe`
- `npm run review:probe`
- `npm run review:mock`
- `npm run run:live` (compatibility alias for `run`)

## Review Dashboard

`npm run review` starts the local dashboard for search management and job review.

The dashboard includes:

- top-level tabs: `Jobs`, `Searches`
- search input controls with a single `Find Jobs` action
- keyword targeting controls (`AND`/`OR` mode + include/exclude terms)
- automatically generated searches across supported sources
- a de-duped ranked queue with selected-job detail and `Prev/Next` navigation in `Jobs`
- job views: `All`, `New`, `Best Match`, `Applied`, `Skipped`, `Rejected`
- source-kind job filters in `Jobs` (for example, LinkedIn/Built In/Ashby)
- `Searches` tab grouped by source kind with funnel metrics: `Found`, `Filtered`, `Dupes`, `Imported`, `Avg Score`
- run-delta context in search/source status (`new`, `updated`, `unchanged`) for latest refresh
- `Found` shown as `imported/expected` when expected totals are detectable, otherwise `imported/?`
- source refresh/capture status signals including cache/live state
- per-source criteria-accountability metadata (URL-applied, UI-bootstrap, post-capture, unsupported)
- per-source adapter health (`ok` / `degraded` / `failing`) with reason hints
- row click-through from `Searches` into filtered `Jobs` view
- per-job attribution showing which source/search URLs surfaced the role

Jobs found in multiple searches are grouped into one review row and show which searches surfaced them.

## Scoring (Search-Criteria Driven)

Scoring is deterministic and driven by search input (`Find Jobs`).

Each job is evaluated into `high_signal`, `review_later`, or `reject` using weighted criteria:

- title match (35)
- keywords match ratio (25)
- location match (15)
- salary floor match (15)
- freshness target (`datePosted`) match (10)

Scoring notes:

- keyword terms are split from comma/semicolon/`and`-style input
- keyword mode defaults to `AND`; switching to `OR` treats any matched positive term as a keyword win
- `includeTerms` are merged into positive keyword matching
- `excludeTerms` are treated as hard filters before scoring (matched jobs are rejected)
- AI-like tokens (`ai`, `ml`, `llm`, `genai`) map to broader AI phrase matching
- title mismatch is strongly penalized (score cap path)
- source hard filters still run before scoring when configured in `sources.json`

Global search-construction criteria in `config/search-criteria.json`:

- `title`, `keywords`, `keywordMode`, `includeTerms`, `excludeTerms`, `location`, `minSalary`, `distanceMiles`, `datePosted`, `experienceLevel`
- these are used as the default canonical variables when constructing source URLs
- the dashboard `Jobs` tab `Find Jobs` control provides a single editor for these fields (`Title`, `Keyword`, `Keyword Mode`, `Include`, `Exclude`, `Location`, `Salary`, `Posted on`)

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

Source contract governance:

- Canonical source mapping registry: `config/source-contracts.json`
- Drift-check command: `node src/cli.js check-source-contracts` (default `minCoverage` is `0.9`)
- Governance and update workflow: `docs/analysis/source-contract-governance.md`

Capture quality guardrails:

- Ingest evaluates each source capture as `accept`, `quarantine`, or `reject`.
- Default behavior ingests only `accept`; `quarantine`/`reject` runs are blocked from normal ingest.
- Operator override is explicit: `sync --allow-quarantined` or `run --allow-quarantined`.
- Quarantined/rejected runs persist diagnostic artifacts under `data/quality/quarantine/`.
- Source health is tracked over rolling runs in `data/quality/source-health-history.json`.
- Contract drift diagnostics are persisted under `data/quality/contract-drift/`.
- Canary checks are configurable in `config/source-canaries.json` and run with `check-source-canaries`.

Sync runtime telemetry:

- Every `sync` run prints aggregate run deltas (`new`, `updated`, `unchanged`).
- Per-source run deltas are persisted and surfaced in dashboard source status rows.
- Sync applies retention cleanup by status (`new`, `viewed`, `skip_for_now`, `rejected`; `applied` is protected by default).
- Retention cleanup writes audit rows to `data/retention/cleanup-audit.jsonl`.
- CLI and dashboard paths emit local analytics events (`data/analytics/events.jsonl`) and counters (`data/analytics/counters.json`), with optional PostHog forwarding when `POSTHOG_API_KEY` is set.

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
- status-aware retention cleanup runs during sync by default:
  - `new`: 30 days
  - `viewed`: 45 days
  - `skip_for_now`: 21 days
  - `rejected`: 14 days
  - `applied`: never auto-deleted
- override retention defaults with `config/retention-policy.json` (inspect effective policy via `jf retention-policy`)

## Live Capture Notes

Browser-capture sources require a browser bridge service. `npm run run` and dashboard `Find Jobs` auto-start a local bridge when needed.

`capture-source-live` now auto-starts a persistent local bridge process when one is not running, so sequential source captures can reuse one Chrome automation window/tab instead of opening a new window per source.

Bridge safety boundary:

- MCP v1 bridge surface is read-only (`/health`, `/capture-source`, `/capture-linkedin-source`).
- Write-side browser actions are intentionally excluded from MCP v1 route registration.

Manual bridge startup is still available:

- Start it with `node src/cli.js bridge-server [port] [provider]`
- Default port: `4315`
- Default provider: `chrome_applescript`
- Stop a detached bridge process with `pkill -f "src/cli.js bridge-server"`
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

## Legal

- Privacy policy: `PRIVACY.md`
- Terms of use: `TERMS.md`
