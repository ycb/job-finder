# Backlog

As of 2026-03-06.

## Active

### P0
- `P0` Add onboarding source selection + per-source authentication readiness. [Detailed spec](./backlog-specs/p1-onboarding-source-auth.md)
  - WHY: Automation fails when source auth/readiness is unresolved at setup.
  - IMPACT: Fewer failed scheduled runs and less manual intervention.

- `P0` Run page-level full-JD verification for keyword/required-term checks. [Detailed spec](./backlog-specs/p1-core-full-jd-pass.md)
  - WHY: Snippet-only text can miss key terms and skew decisions.
  - IMPACT: Higher precision for hard-filter and fit classification.

- `P0` Add source capture verification framework (expected count vs imported count). [Detailed spec](./backlog-specs/p0-source-capture-verification-framework.md)
  - WHY: Under-capture currently surfaces only through manual inspection.
  - IMPACT: Faster detection of source regressions and more trustworthy counts.


### P1

**Theme: Core Functionality**
- `P1` Persist formatter diagnostics in CLI/dashboard. [Detailed spec](./backlog-specs/p1-core-formatter-diagnostics.md)
  - WHY: Unsupported criteria diagnostics are currently easy to lose after a run.
  - IMPACT: Better transparency on why filters did or did not apply per source.
- `P1` Add shared `workType` criteria (`remote`/`hybrid`/`in_person`/`all`) across source URL builders. [Detailed spec](./backlog-specs/p1-core-worktype-field.md)
  - WHY: Users need one consistent work-mode preference across all sources.
  - IMPACT: Better match quality and less per-source setup overhead.
- `P1` Support comma-separated multiple keywords in search criteria. [Detailed spec](./backlog-specs/p1-core-multi-keyword-comma.md)
  - WHY: Users need one field to express multiple distinct keyword intents.
  - IMPACT: Better query quality with less manual criteria editing.
- `P1` Add explicit search freshness/date controls to Searches table.
  - WHY: Users need to see and adjust recency intent without verbose per-row copy.
  - IMPACT: Clearer search context and better relevance tuning per source.


**Theme: Onboarding**
- `P1` Improve `jf init` with LinkedIn auto-extract + initial search params. [Detailed spec](./backlog-specs/p1-onboarding-jf-init.md)
  - WHY: Manual setup is still high-friction for first-time users.
  - IMPACT: Faster activation and first useful run.


**Theme: Distribution**
- `P1` Publish `job-finder` to NPM with a repeatable release flow. [Detailed spec](./backlog-specs/p1-distribution-npm-publish.md)
  - WHY: Repo-clone installs are slower and harder to maintain.
  - IMPACT: Standard install/update path for wider adoption.
- `P1` Publish `jf` to Homebrew after NPM flow is stable. [Detailed spec](./backlog-specs/p1-distribution-homebrew.md)
  - WHY: Many CLI users prefer brew lifecycle management.
  - IMPACT: Easier macOS/Linux install/upgrade experience.

**Theme: Integrations**
- `P1` Build Claude Code skill for Job Finder workflows. [Detailed spec](./backlog-specs/p1-integrations-claude-skill.md)
  - WHY: Claude-native commands reduce context switching and command overhead.
  - IMPACT: Higher usability for analysis and tracking workflows.
- `P1` Build Codex MCP server for tool-based Job Finder operations. [Detailed spec](./backlog-specs/p1-integrations-codex-mcp.md)
  - WHY: Codex integrations need stable tool contracts, not shell glue alone.
  - IMPACT: Reliable agent-driven job search operations.
- `P1` Connect Narrata with stable file/Supabase sync flows. [Detailed spec](./backlog-specs/p1-integrations-narrata.md)
  - WHY: Narrata sync remains operationally inconsistent.
  - IMPACT: More reliable profile-driven scoring with clearer recovery paths.

**Theme: Source Expansion**
- `P1` Add Greenhouse source using shared portal abstraction. [Detailed spec](./backlog-specs/p1-source-expansion-greenhouse.md)
  - WHY: Greenhouse is a major missing source family.
  - IMPACT: Broader and higher-quality role coverage.

### P2

**Theme: Source Quality**
- `P2` Bootstrap Wellfound criteria via UI capture (feature-flagged). [Detailed spec](./backlog-specs/p2-source-quality-wellfound-bootstrap.md)
  - WHY: Wellfound URL criteria support is still stubbed.
  - IMPACT: Better relevance when Wellfound is enabled.

- `P2` Validate and re-enable RemoteOK criteria flow (feature-flagged). [Detailed spec](./backlog-specs/p2-source-quality-remoteok-validation.md)
  - WHY: RemoteOK is now gated behind a flag until criteria + capture quality are verified.
  - IMPACT: Prevents noisy results while keeping a clear path to re-enable.

- `P2` Optimize Ashby discovery yield (high capture-to-import drop).
  - WHY: Ashby discovery mode captures broad board inventories before hard-filtering.
  - IMPACT: Lower scrape noise/cost and cleaner funnel ratios.

**Theme: Source Expansion**
- `P2` Add Y Combinator jobs source. [Detailed spec](./backlog-specs/p2-source-expansion-yc.md)
  - WHY: YC startup roles are not yet captured.
  - IMPACT: Additional startup opportunity coverage.

**Theme: UX Simplification**
- `P2` Remove `Searches` page after auto-construct flow is stable. [Detailed spec](./backlog-specs/p2-ux-remove-searches-page.md)
  - WHY: Separate manual page becomes redundant post automation maturity.
  - IMPACT: Simpler UX and lower maintenance surface.

**Theme: Brand & Design**
- `P2` Define styles and brand system baseline. [Detailed spec](./backlog-specs/p2-brand-styles.md)
  - WHY: Visual/brand decisions are not yet standardized.
  - IMPACT: More consistent product experience and stronger presentation quality.

## Completed / Retired

**Theme: Core Functionality**
- `P0` URL-based search construction abstraction rollout (completed). [Detailed spec](./backlog-specs/completed-core-url-construction-rollout.md)
  - WHY: Needed consistent URL generation and criteria normalization.
  - IMPACT: Stable multi-source baseline now in production.
