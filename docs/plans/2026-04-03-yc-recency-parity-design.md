# YC Recency Parity Design

**Goal:** Align YC Jobs capture with JobFinder search semantics for keyword, role, location, salary presence, and recency coverage.

## Decisions

1. **URL mapping (primary)**
   - `query`: JobFinder keywords
   - `role`: mapped from JobFinder title
   - `locations`: JobFinder location string (exact)
   - `hasSalary=true`: when `minSalary` is set
   - `sortBy`:
     - `keyword` for `any/not set`
     - `newest` for `past month` or tighter

2. **Recency coverage (post-capture)**
   - `24h` → 10%
   - `3d` → 30%
   - `1w` → 50%
   - `2w` → 75%
   - `1m` / `any` / `not set` → 100%

3. **Lazy-load capture**
   - Parse “Showing N matching startups” to get total.
   - Compute `targetCount = ceil(total * fraction)`, capped by `maxJobs`.
   - Scroll until `targetCount` reached or no growth for two passes.

## Non-goals

- No UI-based filter clicks.
- No new extraction fields beyond existing card capture.
