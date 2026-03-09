# Announcement Draft: Phase 1.1 Search Controls, Run Deltas, and Trust Gates

## Metadata

- Date: `2026-03-09`
- Release slug: `phase-1-1-search-controls-run-deltas-and-trust-gates`
- Channels: LinkedIn + Substack

## LinkedIn Draft

Shipping AI automation is easy when you only demo happy paths.  
Shipping it so operators can trust it day after day is harder.

Today’s Job Finder release focused on that second part:

- explicit search controls (`AND`/`OR`, include terms, exclude terms)
- sync run deltas (`new`, `updated`, `unchanged`) persisted and surfaced
- stronger source trust gates with contract drift diagnostics
- status-aware retention cleanup with audit logs
- local-first analytics baseline with optional PostHog forwarding

Why this matters: “more results” is not enough. Users need to see what changed, why it was ranked, and whether source quality is drifting. This release turns that into product behavior, not manual debugging.

## Substack Draft

### Context

There is a common failure mode in AI-assisted data products: the pipeline still runs, but quality quietly drifts. By the time users notice, confidence is already broken.

### Build Approach

Phase 1.1 focused on making the job-search loop observable and controllable:

- make search intent explicit in criteria controls
- make refresh results measurable with run deltas
- make source trust enforceable through contract and detail-coverage diagnostics
- make operations sustainable through retention policy and telemetry

### What We Shipped

- Search criteria now supports `keywordMode` (`and`/`or`) plus `includeTerms` and `excludeTerms`.
- Exclude terms are enforced as hard filters before weighted scoring.
- Sync writes and surfaces per-source run deltas (`new`, `updated`, `unchanged`, `imported`).
- Contract diagnostics now include richer threshold gates and persist machine-readable drift output.
- Retention cleanup now runs with status-aware defaults and audit logs.
- Analytics now has a canonical event schema, local event persistence, and optional PostHog delivery.

### Why It Matters

This closes a credibility gap: users can now understand not only what was found, but what changed, what was filtered out, and whether source quality is healthy.

### Professional Credential Angle

The engineering pattern here is intentional: use AI for implementation speed, but insist on deterministic scoring, explicit policy controls, diagnostics artifacts, and test-backed behavior before calling a feature complete.

### Next Steps

- complete remaining full-JD coverage closures per source and enforce stricter source-specific gates
- continue reducing legacy profile command surface in favor of one search-input-first control model
- tighten weekly ops reporting from analytics/retention/run-delta signals
