# Backlog

As of 2026-03-10.

## Execution Snapshot

| Phase | Status | Done | In Progress | Planned |
|---|---|---|---|---|
| Phase 1 Wave 1 (Engineering) | ✓ Complete | 7/7 | — | — |
| Phase 1.1 Closeout (Engineering) | In progress | — | 3 | 2 |
| Launch Readiness (Product) | Planned | — | — | 4 |
| Platform Abstraction (Epic H) | Icebox | — | — | 3 |

**Phase 1.1 In Progress:** Full-JD page-level verification, Full-JD extraction gap closure, Search controls (hard filter / include-exclude / cache).
**Phase 1.1 Planned:** Onboarding source auth readiness, Value metrics + caps + donation verification.
**Launch Readiness Planned:** CLI design implementation, "Runs" label decision, Legal review (TERMS.md / PRIVACY.md), Monetization variable wiring into caps enforcement.

Onboarding integration status: `codex/3b-worker-2-onboarding` rebased/validated on `onboarding-integration-qa`; pending merge to `main`.



## Vision

Job Finder should feel like a reliable local job-search copilot: you ask for roles in plain language, the system runs real source capture (including LinkedIn in your local browser), scores results deterministically, and returns a ranked queue you can act on immediately.

## Definition of Success

We consider this roadmap successful when these outcomes are true end-to-end:

1. **Agent-native done test passes consistently**: Asking Claude/Codex for a request like "Find me PM roles in SF above $180k" triggers tool-based execution, runs source capture, and returns a ranked, trustworthy list.
2. **Capture quality is observable and trusted**: We can see expected vs imported counts and quickly detect source under-capture/regressions.
3. **Search intent is expressed once**: Users define intent once (title/keywords/location/comp/work type), and all supported sources/scoring honor that intent predictably.
4. **Daily use is low-friction**: Setup/auth/readiness issues are surfaced early, and scheduled/daily runs require minimal manual intervention.

## Epics

The current backlog has strong item-level specs, but we need explicit epic-level framing to guide sequencing and completion.

### Epic A — Agent Execution Loop (Missing)

**Goal**: Make the "ask agent, get ranked jobs" flow first-class and repeatable.

- Includes: Codex MCP server, Claude skill commands/runtime, MCP safety boundaries, and natural-language request mapping into search criteria.
- Success signals: agent tool invocation contracts are stable, ranked response payloads are actionable, and the done test runs without shell glue or write-surface risk.
- Primary linked items:
  - Build Codex MCP server (`P1`, Theme: Integrations).
  - Build Claude Code skill (`P1`, Theme: Integrations).
  - Define read-vs-write browser primitive boundary and enforce read-only MCP v1 surface (`P0`, Theme: Integrations).
  - **Missing backlog item to add**: NL query → canonical search criteria parser + validation.

### Epic B — Source Trust & Verification

**Goal**: Ensure ranked results are trustworthy by making capture and import quality visible.

- Includes: expected-count verification, full-JD extraction quality, source-shape contracts, and source-specific quality hardening.
- Success signals: source quality issues are auto-flagged and do not silently degrade ranking quality.
- Primary linked items:
  - Source capture verification framework (`P0`, completed).
  - Run page-level full-JD verification (`P0`, blocked on Built In salary extraction dependency).
  - Close full-JD extraction gaps per source (`P0`, in progress).
  - Add definitive source shape contract library (`P0`, completed).

### Epic C — Criteria Fidelity & Ranking Quality

**Goal**: Ensure user intent is reflected consistently in URL construction, filtering, and score output.

- Includes: work type support, multi-keyword support, clear hard-filter controls, freshness/net-new behavior, and cross-search ranking blend behavior.
- Success signals: fewer false positives/negatives and clearer explanation of why jobs were ranked or filtered.
- Primary linked items:
  - Persist formatter diagnostics (`P1`, completed).
  - Add shared `workType` criteria (`P1`, planned).
  - Support comma-separated multiple keywords (`P1`, completed).
  - Improve search controls (hard filter, AND/OR, include/exclude, cache status) (`P1`, in progress).
  - Add net-new + refresh incremental behavior (`P1`, in progress).
  - Add multi-search ranking model with interleaving/weights (`P1`, planned).

### Epic D — Onboarding & Run Reliability

**Goal**: Make first-run and daily-run behavior dependable.

- Includes: source selection + auth readiness, improved `jf init`, source-addition workflow support, and clearer remediation when setup is incomplete.
- Success signals: users can reach first useful run quickly and keep runs healthy over time.
- Primary linked items:
  - Add onboarding source selection + per-source auth readiness (`P0`, planned).
  - Improve `jf init` with LinkedIn auto-extract + initial search params (`P1`, planned).
  - Build add-source skill workflow (parameter/extraction mapping + canary setup) (`P1`, planned).
  - Build source-type pattern library and scaffolding hooks (`P1`, planned).

### Epic E — Distribution & Adoption

**Goal**: Reduce installation friction and improve repeatability across environments.

- Includes: npm publish and Homebrew distribution.
- Success signals: install/update flow is standardized and documented.

### Epic F — Source Coverage Expansion

**Goal**: Increase high-signal role coverage without sacrificing quality.

- Includes: Levels.fyi, Greenhouse and YC expansion, plus re-enable and quality paths for gated sources.
- Success signals: broader coverage with acceptable capture-to-import and quality ratios.
- Primary linked items:
  - Add Greenhouse source (`P1`, planned).
  - Add Y Combinator source (`P2`, planned).
  - Add Levels.fyi source (`P2`, planned).
  - Wellfound bootstrap + RemoteOK validation (`P2`, planned).

### Epic G — Governance, Operations, and Internal Tools (New)

**Goal**: Establish durable policy, ownership, and observability foundations before external agent/tooling scale.

- Includes: licensing boundaries, internal-vs-external tool ownership, product/usage metering, and explicit contributor guardrails.
- Success signals: contributors can tell what is intentionally internal, what is externally supported, and how policy/limits are enforced.
- Primary linked items:
  - Adopt licensing split (MIT core + BSL MCP/permissions layer) (`P1`, planned).
  - Define internal-vs-external tool ownership and usage metering baseline (`P1`, completed).
  - Add user-value metrics + caps + donation-based reset verification (`P1`, planned).
  - Define read-vs-write MCP/browser boundary (`P0`, completed; cross-epic dependency with Epic A).

### Epic H — Platform Abstraction & Multi-Vertical (New)

**Goal**: Abstract Job Finder's browser-mediated capture pipeline into a reusable multi-vertical platform so the same core powers HomeFinder, CarFinder, and beyond.

- Core insight: local-first + browser-session-mediated = runs on user's machine, indistinguishable from user browsing, structurally unblockable by platforms. This is the moat.
- Includes: clean adapter interface extraction from existing source adapters, multi-vertical npm package structure, permission/delegation config schema, and HomeFinder as proof-of-concept second vertical.
- Success signals: two verticals run on shared core; MCP tools callable from Claude/Codex; adapter interface is clean enough for community contribution.
- References: `docs/monetization.md`, `docs/cli-design.md`, `TERMS.md`, `PRIVACY.md`.
- Primary linked items:
  - Extract clean adapter interface from existing source adapters (`P1`, planned).
  - Build HomeFinder adapter (Zillow + Redfin) as second vertical (`P2`, planned).
  - Expand Codex MCP server to multi-vertical tool surface (`P2`, depends on MCP P1 item).
  - Adopt licensing split: MIT core + BSL MCP/permissions layer (`P1`, icebox → promote when adapter interface is clean).



## MVP Scope (In Execution)

### P0
- `P0` Add onboarding source selection + per-source authentication readiness. [Detailed spec](./backlog-specs/p1-onboarding-source-auth.md)
  - STATUS: Planned
  - WHY: Automation fails when source auth/readiness is unresolved at setup.
  - IMPACT: Fewer failed scheduled runs and less manual intervention.
- `P0` Run page-level full-JD verification for keyword/required-term checks. [Detailed spec](./backlog-specs/p1-core-full-jd-pass.md)
  - STATUS: In progress (Built In salary dependency no longer hard-blocking; evaluation-stage full-JD rerun and fallback evidence persistence remain)
  - WHY: Snippet-only text can miss key terms and skew decisions.
  - IMPACT: Higher precision for hard-filter and fit classification.
- `P0` Close full-JD extraction gaps per source before re-enable/scale. [Detailed spec](./backlog-specs/p0-source-full-jd-gap-closure.md)
  - STATUS: In progress (detail enrichment path shipped; source-by-source closure still open)
  - WHY: Current source coverage is mostly card/snippet level and creates avoidable scoring/filter noise.
  - IMPACT: Better quality decisions, clearer source readiness, and safer re-enable path for feature-flagged sources.

### P1

**Theme: Core Functionality**
- `P1` Add shared `workType` criteria (`remote`/`hybrid`/`in_person`/`all`) across source URL builders. [Detailed spec](./backlog-specs/p1-core-worktype-field.md)
  - STATUS: Planned
  - WHY: Users need one consistent work-mode preference across all sources.
  - IMPACT: Better match quality and less per-source setup overhead.
- `P1` Improve search controls: clear hard filter, AND/OR keywords, include/exclude terms, and cache status visualization. [Detailed spec](./backlog-specs/p1-core-search-hardfilter-keywords-include-exclude-cache.md)
  - STATUS: In progress (hard filter + cache visibility are partially shipped; full AND/OR + include/exclude controls pending)
  - WHY: Search/filter behavior is currently hard to tune and explain quickly.
  - IMPACT: More precise targeting and better trust in search freshness/results.
- `P1` Add net-new + refresh run behavior so source reruns update incrementally instead of resetting context. [Detailed spec](./backlog-specs/p1-core-net-new-refresh.md)
  - STATUS: In progress (refresh policy/state shipped; explicit net-new/refresh delta UX still pending)
  - WHY: Users need clear separation between newly discovered and previously seen results.
  - IMPACT: Faster daily triage with higher confidence in run deltas.

**Theme: Onboarding**
- `P1` Improve `jf init` with LinkedIn auto-extract + initial search params. [Detailed spec](./backlog-specs/p1-onboarding-jf-init.md)
  - STATUS: Planned
  - WHY: Manual setup is still high-friction for first-time users.
  - IMPACT: Faster activation and first useful run.

**Theme: Distribution**
- `P1` Publish `job-finder` to NPM with a repeatable release flow. [Detailed spec](./backlog-specs/p1-distribution-npm-publish.md)
  - STATUS: Planned
  - WHY: Repo-clone installs are slower and harder to maintain.
  - IMPACT: Standard install/update path for wider adoption.

**Theme: Integrations**
- `P1` Build Codex MCP server for tool-based Job Finder operations. [Detailed spec](./backlog-specs/p1-integrations-codex-mcp.md)
  - STATUS: Planned
  - WHY: Codex integrations need stable tool contracts, not shell glue alone.
  - IMPACT: Reliable agent-driven job search operations.

**Theme: Operations & Tooling**
- `P1` Add user-value metrics (`searches ran`, `matching jobs imported`) with free-tier caps and donation-based cap reset + verification. [Detailed spec](./backlog-specs/p1-operations-value-metrics-caps-donations.md)
  - STATUS: Planned
  - WHY: We need visible user value and enforceable usage controls to support a donation-backed early monetization model.
  - IMPACT: Clear value communication, configurable free-tier enforcement, and validated donation unlock flow.
  - NOTE: Specific variable values and tier definitions are in `docs/monetization.md`. Implementation must wire to those values: `FREE_RUNS_PER_MONTH=10`, `FREE_JOBS_IN_DB=500`, `DONATION_MINIMUM_USD=5`, `DONATION_UNLOCK_PERIOD_DAYS=30`, `SUPPORTER_RUNS_PER_MONTH=40`, `SUBSCRIPTION_MONTHLY_USD=9`. All values must be runtime-configurable without code changes.

**Theme: Launch Readiness**
- `P1` Implement CLI design system per `docs/cli-design.md`.
  - STATUS: Planned
  - WHY: Current CLI output is functional but plain. Public launch requires a first-run experience that builds trust and communicates the agent-powered value proposition.
  - IMPACT: Higher activation rate; product feels intentional rather than scripted.
  - SCOPE: Welcome screen, step-list pipeline runner with per-source status, Y/N prompt system, completion summary, OSC 8 clickable links. Implement using Ink (React for CLIs) + `@inkjs/ui`. Gate all animation/color behind `is-interactive()`. Persistent agent icon (stretch goal).
  - DEPENDS ON: "Runs" terminology decision (see below).

- `P1` Decide user-facing label for "runs" before public launch.
  - STATUS: Planned
  - WHY: "Run" is an internal technical term. The free-tier cap and all UI copy must use a consistent, user-friendly term. Candidates: "refreshes", "syncs", "searches". Decision affects CLI copy, dashboard, ToS, and monetization messaging.
  - IMPACT: Prevents terminology debt that becomes expensive to fix post-launch.
  - SCOPE: Decision only — no implementation. Update `docs/monetization.md`, `docs/cli-design.md`, and TERMS.md once decided.

- `P1` Legal review and launch readiness for TERMS.md and PRIVACY.md.
  - STATUS: Planned
  - WHY: ToS and Privacy Policy drafts are complete (`TERMS.md`, `PRIVACY.md`) but require review by a California-licensed attorney before public distribution, especially the limitation of liability cap ($0 aggregate) and the third-party ToS risk section.
  - IMPACT: Reduces legal exposure at launch. Required before npm publish or public HN post.
  - SCOPE: External legal review only. No implementation work. Flag any required changes back to backlog as follow-on items.

## Icebox (Out of MVP Scope For Now)

### P1

**Theme: Onboarding**
- `P1` Build add-source skill workflow for onboarding/anytime source addition (parameter-shape analysis, extraction mapping, canary setup; no UI changes). [Detailed spec](./backlog-specs/p1-onboarding-add-source-skill.md)
  - STATUS: Icebox
  - WHY: Adding sources currently requires deep manual adapter work and slows expansion.
  - IMPACT: Faster source onboarding with better consistency and built-in quality gates.

**Theme: Distribution**
- `P1` Publish `jf` to Homebrew after NPM flow is stable. [Detailed spec](./backlog-specs/p1-distribution-homebrew.md)
  - STATUS: Icebox
  - WHY: Many CLI users prefer brew lifecycle management.
  - IMPACT: Easier macOS/Linux install/upgrade experience.

**Theme: Integrations**
- `P1` Build Claude Code skill for Job Finder workflows. [Detailed spec](./backlog-specs/p1-integrations-claude-skill.md)
  - STATUS: Icebox
  - WHY: Claude-native commands reduce context switching and command overhead.
  - IMPACT: Higher usability for analysis and tracking workflows.

**Theme: Architecture & Extensibility**
- `P1` Build source-type pattern library (`auth`, `unauth`, `subdomain`, `ui_driven`) and adapter scaffolding hooks. [Detailed spec](./backlog-specs/p1-architecture-source-type-pattern-library.md)
  - STATUS: Icebox
  - WHY: Repeated source-specific logic is not abstracted into reusable type-level patterns.
  - IMPACT: Lower adapter implementation cost and clearer path for source-addition skills.
- `P1` Add multi-search ranking model with interleaving and optional per-search weighting (for example `searchA=1.25`, `searchB=0.9`). [Detailed spec](./backlog-specs/p1-core-multi-search-ranking-blend.md)
  - STATUS: Icebox
  - WHY: Multi-search ingestion without an explicit blend model can produce unstable ranking behavior.
  - IMPACT: Predictable cross-search ranking quality and better control for power users.

**Theme: Source Expansion**
- `P1` Add Greenhouse source using shared portal abstraction. [Detailed spec](./backlog-specs/p1-source-expansion-greenhouse.md)
  - STATUS: Icebox
  - WHY: Greenhouse is a major missing source family.
  - IMPACT: Broader and higher-quality role coverage.

**Theme: UX & Workflow**
- `P1` Add multi-search support with `+` tab creation for parallel search contexts. [Detailed spec](./backlog-specs/p1-ux-multi-search-tabs.md)
  - STATUS: Icebox
  - WHY: One-search-at-a-time flow slows iterative exploration.
  - IMPACT: Higher search throughput and easier side-by-side refinement.

**Theme: Governance & Licensing**
- `P1` Adopt licensing split: MIT for core framework + adapter interface, BSL for MCP server + permission layer. [Detailed spec](./backlog-specs/p1-governance-licensing-split.md)
  - STATUS: Icebox
  - WHY: Licensing boundary is currently undefined for the most defensible server-side layer.
  - IMPACT: Better open-core trust plus clearer protection against unmanaged hosted competitive reuse.

**Theme: Platform Abstraction**
- `P1` Extract clean adapter interface from existing source adapters (Epic H prerequisite).
  - STATUS: Icebox
  - WHY: Current adapter logic is tightly coupled to JobFinder's pipeline. A clean interface contract is required before HomeFinder or community adapters can be built.
  - IMPACT: Unlocks multi-vertical platform play and community-contributed source adapters.
  - SCOPE: Define and document the adapter contract (what a source adapter must implement); refactor existing adapters to conform; publish interface as part of core npm package.

- `P2` Build HomeFinder adapter (Zillow + Redfin) as proof-of-concept second vertical.
  - STATUS: Icebox
  - WHY: Two verticals running on the same core proves the abstraction and makes the platform story fundable. Real estate has identical multi-source deduplication problem to jobs.
  - IMPACT: Platform narrative validated with evidence; co-founder pitch and investor story strengthened.
  - DEPENDS ON: Clean adapter interface extraction (above).

### P2

**Theme: Source Quality**
- `P2` Bootstrap Wellfound criteria via UI capture (feature-flagged). [Detailed spec](./backlog-specs/p2-source-quality-wellfound-bootstrap.md)
  - STATUS: Icebox
  - WHY: Wellfound URL criteria support is still stubbed.
  - IMPACT: Better relevance when Wellfound is enabled.
- `P2` Validate and re-enable RemoteOK criteria flow (feature-flagged). [Detailed spec](./backlog-specs/p2-source-quality-remoteok-validation.md)
  - STATUS: Icebox
  - WHY: RemoteOK is now gated behind a flag until criteria + capture quality are verified.
  - IMPACT: Prevents noisy results while keeping a clear path to re-enable.
- `P2` Optimize Ashby discovery yield (high capture-to-import drop).
  - STATUS: Icebox
  - WHY: Ashby discovery mode captures broad board inventories before hard-filtering.
  - IMPACT: Lower scrape noise/cost and cleaner funnel ratios.

**Theme: Integrations**
- `P2` Connect Narrata with stable file/Supabase sync flows. [Detailed spec](./backlog-specs/p1-integrations-narrata.md)
  - STATUS: Icebox (in progress in parallel, not required for MVP launch)
  - WHY: Narrata sync remains operationally inconsistent.
  - IMPACT: More reliable profile-driven scoring with clearer recovery paths.

**Theme: Source Expansion**
- `P2` Add Y Combinator jobs source. [Detailed spec](./backlog-specs/p2-source-expansion-yc.md)
  - STATUS: Icebox
  - WHY: YC startup roles are not yet captured.
  - IMPACT: Additional startup opportunity coverage.
- `P2` Add Levels.fyi as a new source. [Detailed spec](./backlog-specs/p2-source-expansion-levelsfyi.md)
  - STATUS: Icebox
  - WHY: Levels.fyi can add compensation-transparent roles not captured in current sources.
  - IMPACT: Better source coverage and stronger salary-signal inputs.

**Theme: UX Simplification**
- `P2` Remove `Searches` page after auto-construct flow is stable. [Detailed spec](./backlog-specs/p2-ux-remove-searches-page.md)
  - STATUS: Icebox
  - WHY: Separate manual page becomes redundant post automation maturity.
  - IMPACT: Simpler UX and lower maintenance surface.

**Theme: Brand & Design**
- `P2` Define styles and brand system baseline. [Detailed spec](./backlog-specs/p2-brand-styles.md)
  - STATUS: Icebox
  - WHY: Visual/brand decisions are not yet standardized.
  - IMPACT: More consistent product experience and stronger presentation quality.

## Completed / Retired

**Theme: Core Functionality**
- `P0` Add source capture verification framework (expected count vs imported count). [Detailed spec](./backlog-specs/p0-source-capture-verification-framework.md)
  - STATUS: Completed (2026-03-07)
  - WHY: Under-capture currently surfaces only through manual inspection.
  - IMPACT: Faster detection of source regressions and more trustworthy counts.

- `P0` URL-based search construction abstraction rollout (completed). [Detailed spec](./backlog-specs/completed-core-url-construction-rollout.md)
  - WHY: Needed consistent URL generation and criteria normalization.
  - IMPACT: Stable multi-source baseline now in production.

- `P0` Define read-vs-write browser primitive boundary and enforce read-only MCP v1 tool surface. [Detailed spec](./backlog-specs/p0-integrations-read-write-boundary.md)
  - STATUS: Completed (`1b18d56`; read-only primitive catalog enforcement for `mcp_v1` is active and documented)
  - WHY: Once MCP can execute capture, accidental drift into write/apply automation becomes a high-risk failure mode.
  - IMPACT: Explicit safety boundary for contributors and safer MCP rollout.

- `P0` Add definitive source shape contract library for search-parameter and extraction expectations (required + optional metadata). [Detailed spec](./backlog-specs/p0-architecture-source-shape-contracts-library.md)
  - STATUS: Completed (`444d199`, `2dd4c6f`; schema/validation, sourceId resolution, field-level drift diagnostics, and sync-path diagnostics persistence are live)
  - WHY: Search construction and extraction expectations were not captured in one authoritative contract layer.
  - IMPACT: Stronger source adapter quality, simpler onboarding automation, and clearer contract governance.

- `P1` Persist formatter diagnostics in CLI/dashboard. [Detailed spec](./backlog-specs/p1-core-formatter-diagnostics.md)
  - STATUS: Completed (`d552f35`; persisted source formatter diagnostics surface in dashboard status details and source metadata)
  - WHY: Unsupported criteria diagnostics were easy to lose after a run.
  - IMPACT: Better transparency on why filters did or did not apply per source.

- `P1` Support comma-separated multiple keywords in search criteria. [Detailed spec](./backlog-specs/p1-core-multi-keyword-comma.md)
  - STATUS: Completed (`44d227c`; criteria persistence and URL query builders consume normalized comma-delimited keyword sets)
  - WHY: Users needed one field to express multiple distinct keyword intents.
  - IMPACT: Better query quality with less manual criteria editing.

- `P1` Define internal-vs-external tool ownership and add usage metering baseline (installs, runs, searches, sources, limits, donations). [Detailed spec](./backlog-specs/p1-operations-tooling-ownership-metering.md)
  - STATUS: Completed (`c264403`; canonical analytics schema/channel tags + PostHog mapping + local counters are implemented and tested)
  - WHY: Product and growth operations needed explicit ownership boundaries and baseline telemetry.
  - IMPACT: Better roadmap decisions, pricing/limit enforcement readiness, and healthier maintenance model.

- `P1` Add local storage controls with status-aware auto-delete ON by default (`new`/`viewed`/`skip_for_now`/`rejected`; keep `applied`). [Detailed spec](./backlog-specs/p1-operations-local-storage-retention.md)
  - STATUS: Completed (`34ad002`; status-aware retention defaults, cleanup audit logging, sync-path wiring, and policy inspection are live)
  - WHY: Users needed predictable control over local disk usage and data retention behavior.
  - IMPACT: Better trust, lower storage bloat, and cleaner long-term operation.
