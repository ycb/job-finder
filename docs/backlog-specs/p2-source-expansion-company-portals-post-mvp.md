# P2 Source Expansion: Revisit Company-Portal Sources After MVP

- Priority: P2
- Theme: Source Expansion

## Context

Company-portal sources such as Ashby and Greenhouse are strategically interesting because they may surface jobs that do not appear quickly or cleanly on broader aggregators. They are also structurally different from the direct search sources in the MVP slate:

- discovery often requires board or subdomain enumeration
- source-specific narrowing is harder
- novelty must justify the extra maintenance burden

The current MVP source slate intentionally excludes these sources until they can clear a stronger quality and novelty bar.

## Why It Matters

The right question for company-portal sources is not merely "can we scrape them?" It is:

- do they produce genuinely novel jobs?
- is the capture-to-import funnel healthy?
- is there a maintainable discovery strategy that is not brute-force?

If the answer is not clearly yes, these sources should stay out of MVP.

## Post-MVP Scope

- Revisit Ashby using the novelty-vs-redundancy spike results.
- Revisit Greenhouse only if the portal-source strategy is proven worthwhile.
- Define source-type-specific discovery and narrowing patterns before re-enabling either source broadly.

## Acceptance Criteria

- A clear product/engineering decision exists for each company-portal source:
  - keep
  - rework
  - defer
- Any source brought back must show acceptable novelty and capture-to-import efficiency.
- Discovery strategy is maintainable and source-specific, not generic brute-force crawling.

## Dependencies

- Source-type pattern library
- Add-source / community adapter direction
- Novelty-vs-redundancy measurement for outlier sources

## Definition of Done

- The post-MVP decision on Ashby/Greenhouse is made with real evidence rather than intuition.
