# P1 Operations: Internal vs External Tooling Ownership and Usage Metering

- Priority: P1
- Theme: Operations & Tooling

## Why
Without explicit ownership boundaries and baseline telemetry, feature prioritization, plan limits, and maintenance responsibility become ambiguous.

## Impact
Creates a practical operating model for what we build internally vs expose externally, and provides data needed for limits/pricing/donation decisions.

## Detailed Spec
- Define tool ownership taxonomy:
  - internal-only tools (for example docs/UI authoring, auto-healing governance).
  - external-facing tools (for example source-addition workflows).
- For each tool category, define support/SLA expectations and release gates.
- Add baseline metering for:
  - installs/downloads
  - runs/searches
  - source count and capture volume
  - limit events
  - donation/free vs paid signals
- Add canonical event schema dimensions:
  - channel (`terminal`, `dashboard`, `codex`, `claude`)
  - identity mode (`anonymous_install_id`, `linked_github_id`)
  - source and search identifiers for attribution
- Define telemetry architecture that is reliable across channels:
  - PostHog is the canonical telemetry system across channels (`terminal`, `dashboard`, `codex`, `claude`)
  - first-party ingestion endpoint forwards normalized events to PostHog as source of truth for product metrics
  - local queue/retry for CLI events when offline
  - optional replay tooling (for example LogRocket) may be used for dashboard UX debugging only (not source of truth)
- Define external signal ingestion:
  - GitHub release asset `download_count` aggregation
  - Homebrew public analytics aggregation for formula installs
- Define privacy-safe telemetry boundaries and opt-in/opt-out behavior.
- Add internal dashboard/report format for weekly product ops review.

## Acceptance Criteria
- Ownership categories are documented and applied to current tools.
- Baseline event schema exists for usage and limit telemetry.
- Channel-tagged events can be compared across terminal/agent/dashboard workflows.
- At least one aggregated report path exists for product ops decisions.
- Docs include privacy posture and operational responsibilities.
- PostHog project/event taxonomy is documented and enforced across all channels.
