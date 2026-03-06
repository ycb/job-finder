# Announcement Draft: Refresh Policy and State

## Metadata

- Date: `2026-03-06`
- Release slug: `refresh-policy-state-foundation`
- Channels: LinkedIn + Substack

## LinkedIn Draft

Most job-search automation fails at refresh discipline: it either hammers sources or goes stale.

Today I shipped a new refresh policy/state layer in Job Finder to make capture behavior explicit and controllable:

- risk-classed refresh rules by source type
- profile modes (`safe`, `probe`, `mock`) for different operating postures
- persisted refresh state + challenge cooldown tracking

Why this matters: reliability and credibility in AI-driven systems come from explicit operational policy, not just extraction scripts.

If you are building autonomous or semi-autonomous pipelines, this is the pattern: model state, codify throttles, and expose decision reasons.

## Substack Draft

### Context

A recurring issue in browser-capture pipelines is refresh chaos. Teams often optimize extraction quality first, but skip policy and state management. That creates fragile behavior: stale caches on one day, challenge loops on the next.

### Build Approach

This release introduces a foundation layer that sits between source capture and collection execution:

- refresh policy by source risk class
- explicit profiles for operating mode (`safe`, `probe`, `mock`)
- persisted refresh events and cooldown windows
- reasoned cache-vs-live decision outputs

### What We Shipped

- A refresh policy module with source type classification and interval/cap/cooldown controls.
- A refresh state module with event history, day-level counting, and challenge detection.
- Cache decision structures that return reasons and next-eligible timestamps for diagnostics.

### Why It Matters

It improves system behavior under pressure. Instead of opaque “it refreshed” logic, we now have explicit, testable decisioning that can be inspected and eventually surfaced in product UX.

### Professional Credential Angle

This is the part of AI-assisted software development that often gets skipped: operational rigor. The code is only half the work; policy, state, and verification are what make autonomous workflows production-ready.

### Next Steps

- Surface refresh reason/eligibility data in user-facing review diagnostics.
- Document profile usage (`safe`, `probe`, `mock`) directly in top-level runtime docs once fully exposed.

