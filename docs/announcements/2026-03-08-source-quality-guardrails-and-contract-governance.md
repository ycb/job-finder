# Announcement Draft: Source Quality Guardrails and Contract Governance

## Metadata

- Date: `2026-03-08`
- Release slug: `source-quality-guardrails-and-contract-governance`
- Channels: LinkedIn + Substack

## LinkedIn Draft

Most AI automation demos show what works when everything is healthy. The harder problem is making failure visible and recoverable.

Today I shipped a reliability release in Job Finder:

- ingest guardrails that classify source runs as `accept`, `quarantine`, or `reject`
- source contract governance with drift checks and rolling extraction coverage
- source canary checks with machine-readable diagnostics
- rolling adapter health status in the dashboard (`ok` / `degraded` / `failing`)
- shortlist output moved to stable JSON (`output/shortlist.json`) for downstream workflows

Why this matters: without explicit reliability controls, ranking quality quietly degrades and users lose trust. This release makes adapter risk measurable and operationally visible without stopping the daily workflow.

## Substack Draft

### Context

Job search automation has two failure modes: obvious crashes and silent quality decay. Silent decay is worse because bad data still looks plausible and keeps flowing into scoring.

### Build Approach

I treated source reliability as a first-class product surface:

- define expected behavior per source type (`source contracts`)
- validate each capture run at ingest (`accept`/`quarantine`/`reject`)
- keep historical health telemetry so one-off noise does not hide trends
- enforce canaries that fail loudly when extraction assumptions break

### What We Shipped

- `config/source-contracts.json` plus `check-source-contracts` for drift + rolling coverage checks.
- `config/source-canaries.json` plus `check-source-canaries` for repeatable adapter verification.
- Ingest quarantine protection with persisted artifacts under `data/quality/quarantine/`.
- Source health history and status scoring in `data/quality/source-health-history.json`.
- Dashboard surfacing of adapter health and reason hints.
- Structured shortlist renderer writing `output/shortlist.json`.

### Why It Matters

This release changes reliability from “best effort” to “governed system.” You can now answer:

- Which source regressed?
- Was this run safe to ingest?
- Is the problem transient or trend-level?
- What evidence file should I inspect?

That keeps daily usage moving while improving confidence in what gets ranked.

### Professional Credential Angle

This is the development pattern I advocate for AI-driven products: move fast on extraction, but add explicit contracts, guardrails, diagnostics, and test coverage so the system remains auditable as it evolves.

### Next Steps

- tighten source-specific full-JD coverage where snippet-level extraction still dominates
- expand canary depth and contract freshness automation
- continue reducing manual operator intervention in degraded-source recovery
