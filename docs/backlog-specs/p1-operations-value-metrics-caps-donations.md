# P1 Operations: User-Value Metrics, Usage Caps, and Donation-Based Cap Reset

- Priority: P1
- Theme: Operations & Monetization

## Context
We need top-line user-value indicators in the product and a lightweight paywall model that can gate heavy usage while keeping access flexible.

## Why It Matters
Without visible value metrics and enforceable usage controls, it is hard to communicate product value, manage free-tier limits, or run a donation-backed access model.

## User/Business Value
- Users can see concrete value delivered (`searches run`, `matching jobs imported`).
- Product can enforce fair-use caps for free usage.
- Donation path can unlock usage without forcing fixed pricing early.

## MVP Scope
- Add top-right metrics in dashboard/review UI:
  - number of searches run
  - number of matching jobs imported
- Track usage counters per user identity/session scope used by the product.
- Add configurable caps for free usage:
  - max searches in window
  - max imported jobs in window
- Add `Donate` action that can reset caps when a valid GitHub Sponsors donation is verified.
- Add GitHub Sponsors integration baseline:
  - repo has `.github/FUNDING.yml` configured
  - Sponsors webhook endpoint receives sponsorship lifecycle events
  - webhook signatures are validated server-side
- Add donation verification flow tied to authenticated GitHub identity:
  - user links GitHub account (recommended: OAuth device flow for CLI contexts)
  - donation event is matched to linked GitHub identity
  - reset entitlement and audit log are persisted
- Keep donation threshold experiment-driven:
  - support configurable minimum donation threshold (including any-amount mode)
  - default and experiments governed by `docs/monetization.md`

## Future Work (Out of MVP)
- Tiered plans beyond donation reset.
- Per-source/per-feature caps.
- Experimentation on cap thresholds and conversion prompts.

## Metrics
- `% users reaching cap`
- `% capped users who donate`
- `% successful donation verifications`
- `median time from cap hit to reset`
- `weekly searches run` and `weekly matching jobs imported`
- `donation amount distribution` and `reset conversion by threshold variant`

## Definition of Done
- Metrics display reliably in UI for active users.
- Usage counters are persisted and enforce caps deterministically.
- Donation reset only succeeds after verified GitHub sponsor-to-user match.
- Audit trail exists for cap resets and verification outcomes.
- Tests cover cap enforcement, donation verification success/failure, and reset behavior.
- Experimental threshold variants can be configured and measured without code changes.

## Complexity
- Size: `L`
- Rationale: cross-cutting changes across UI, identity, usage metering, payment/donation verification, and policy enforcement.

## Dependencies
- `DEPENDS_ON: Define internal-vs-external tool ownership and usage metering baseline [hard]`
- `DEPENDS_ON: Adopt licensing split policy boundaries [soft]`
- `DEPENDS_ON: docs/monetization.md experimentation policy [hard]`
