# P1 Core Functionality: MVP Scoring Model Analysis

- Priority: P1
- Theme: Core Functionality

## Context

Job Finder's ranking model is a core MVP promise: users should see the best jobs first, with deterministic reasoning they can trust. The current model appears directionally sound, but several dimensions remain unproven enough that they could create visible launch friction even if the overall architecture is right.

Current stakeholder assessment:

- Weight distribution: likely good
- Deterministic design: correct and should remain
- Hard-filter separation: correct
- AI token expansion: likely appropriate for target market
- Title match implementation: unknown and likely highest-risk failure point
- Keyword ratio: likely adequate for MVP but will need refinement later
- Company/quality signal: missing but not necessarily an MVP blocker
- Bucket thresholds: unknown and likely second-highest friction point

This item is intentionally an analysis-and-decision item first, not an automatic scoring rewrite. If the analysis concludes the current model is good enough for MVP, the output should say so explicitly and leave the model unchanged.

## Why It Matters

If ranking feels arbitrary, the product loses trust even when source capture works. The MVP does not need a perfect model, but it does need a model that is:

- coherent
- explainable
- stable
- good enough that users feel the top of the queue is worth acting on

## MVP Scope

Analyze and decide whether the current scoring model is sufficient for MVP, with explicit attention to:

1. Title-family matching
2. Keyword weighting and ratio behavior
3. Hard-filter vs ranking separation
4. Bucket thresholds / score bands used in UX and filtering
5. Missing company/quality signal and whether its absence is acceptable for launch

Deliverables:

- a source-aware scoring-model review against real current code
- a written MVP verdict:
  - keep as-is
  - keep with small targeted fixes
  - or block launch pending correction
- any narrow follow-on implementation items split into:
  - MVP must-do
  - post-MVP refinement

## Not In Scope

- replacing deterministic scoring with an LLM-based ranker
- broad ML experimentation
- adding complex reputation datasets or external company-quality APIs
- redesigning the entire Jobs UI around score distributions

## Dependencies

This analysis depends on source-data quality being stabilized enough that the model is being judged on reasonably trustworthy inputs. In practice:

- source-quality fixes for launch sources should land first
- canonical title-family bucketing should inform title-match assessment
- missing full job details should be understood, because snippet-only inputs can distort scoring conclusions

## Success Criteria

- We can explain exactly how title matching works today.
- We can explain whether score buckets/thresholds are defensible for MVP.
- We know whether low observed scores are:
  - a model problem
  - a source-data problem
  - or both
- We make an explicit launch decision:
  - `ship`
  - `ship with targeted fixes`
  - `do not ship yet`

## Metrics / Evidence

The analysis should use:

- code inspection of the live scoring path
- representative real jobs from launch-scope sources
- comparison of kept vs filtered jobs
- explanation quality in the UI ("why it fits" and ranking rationale)

Useful output examples:

- title-family mismatches that should have ranked higher
- false positives that scored well for the wrong reasons
- score-band compression or threshold oddities
- evidence that company/quality signal absence is acceptable or noticeable

## Definition of Done

- scoring-model MVP verdict documented
- any required MVP scoring fixes added to backlog or implemented
- any non-blocking refinements moved to post-MVP backlog
- roadmap/backlog remain clear on whether the model is considered launch-ready
