# Announcement Draft: Search Criteria and Dashboard Control Plane

## Metadata

- Date: `2026-03-06`
- Release slug: `search-criteria-dashboard-and-ingestion-hygiene`
- Channels: LinkedIn + Substack

## LinkedIn Draft

Job search automation breaks down when intent is scattered and ingestion quality is opaque.

Today I shipped a major workflow upgrade in Job Finder:

- one global `search-criteria.json` driving URL construction + scoring
- dashboard-first `Find Jobs` flow (save criteria + run all sources)
- capture funnel metrics (`Found`, `Filtered`, `Dupes`, `Imported`) for source quality
- ingestion hygiene improvements (stale job pruning + duplicate status inheritance)

Why this matters: AI-driven products need operational clarity, not just extraction tricks. If you cannot explain where records are dropped or why rankings changed, users stop trusting the system.

This release pushes Job Finder further toward a transparent, local-first intelligence workflow.

## Substack Draft

### Context

Most “AI job search” tools over-index on scraping and under-invest in system clarity. You get results, but it is hard to tell whether they are fresh, duplicated, filtered correctly, or scored for the right reasons.

### Approach

I moved the product toward a criteria-first architecture:

- canonical search criteria as the shared intent layer
- dashboard orchestration as the main interaction loop
- ingestion lifecycle controls that keep the queue clean and status-aware

### What We Shipped

- Global search criteria config with schema validation and per-source overrides.
- Search-criteria-driven scoring path replacing profile-driven scoring in run/score.
- A dashboard `Find Jobs` action that saves criteria and runs all sources in one step.
- Source-kind grouped search diagnostics with funnel metrics and totals.
- Queue hygiene: prune stale `new/viewed` records and inherit app status across normalized duplicates.
- LinkedIn capture depth improvements (multi-page pagination plus expected-count tracking).

### Why It Matters

Users now get a tighter loop:

- set criteria once
- run and observe source quality
- review ranked jobs with less stale/duplicate noise

From an engineering standpoint, this introduces a clearer contract between intent, collection, and ranking.

### Professional Credential Angle

This is what I think AI-driven software development should look like in practice: use LLMs for acceleration, but keep system behavior explicit, testable, and operationally legible.

### Next Steps

- Continue tightening source-level verification (especially gated sources).
- Surface more refresh-policy diagnostics in user-facing workflows.
- Expand onboarding so criteria + source readiness setup is even faster.
