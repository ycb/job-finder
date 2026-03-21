# P1 Source Coverage: Approved MVP Source Slate

- Priority: P1
- Theme: Source Coverage Expansion

## Context

The approved MVP source slate is intentionally limited to six curated sources. The goal is not maximum raw source count. The goal is a source set that is:

- high signal for the target SF AI PM market
- diverse enough to feel complete at launch
- maintainable enough to ship with trustworthy quality

## Approved MVP Source Slate

| Source | Type | Gate | Rationale |
| --- | --- | --- | --- |
| LinkedIn | Browser/auth | Live | ~78% of saved jobs; irreplaceable auth-gated professional network. |
| Built In SF | HTTP-direct | Live | Cleanest healthy source today; direct employer relationships and low ghost-job noise. |
| Indeed | HTTP-direct | Degraded | Broad ATS/employer-direct coverage; Cloudflare interference is intermittent and should degrade gracefully rather than block MVP. |
| ZipRecruiter | Browser | 1 fix | Strong UX and perceived completeness; one scoped job-specific URL fix gates ship. |
| YC Jobs | HTTP-direct | Build | High-signal SF AI startup market source at relatively low build cost. |
| Levels.fyi | HTTP-direct | Build | Salary-first differentiation and meaningful tech-job coverage at relatively low build cost. |

## Out of MVP

- Wellfound
  - criteria still stubbed
- Greenhouse
  - additional company-portal complexity and likely overlap with LinkedIn/Indeed
- Ashby
  - capture-to-import drop remains under investigation
- RemoteOK
  - wrong geo focus for the launch market

## Why This Matters

The MVP should prove the adapter pattern with a source slate that is broad enough to feel useful but narrow enough to maintain. Every source beyond the six above is better treated as a post-launch decision or future community adapter candidate unless it clearly clears the novelty and maintenance bar.

The MVP source slate should also generate reusable source-pattern artifacts. Each launch source should teach the system something durable about how to add the next source:

- how that source type constructs searches
- what fields and review targets are required
- what honest degradation looks like
- what parser and reporting checks prove quality

Without those artifacts, the MVP yields six bespoke adapters instead of the foundation for a future `add a source` capability.

## Acceptance Criteria

- Backlog and roadmap artifacts consistently reflect the six-source MVP slate.
- YC Jobs and Levels.fyi are tracked as `P1` launch-scope source additions.
- ZipRecruiter deep-link correctness is tracked as a scoped blocker for that source.
- Wellfound, Greenhouse, Ashby, and RemoteOK are clearly out of MVP.
- Each MVP source lane leaves behind reusable source-type notes and verification patterns that can feed the future `add a source` workflow.
