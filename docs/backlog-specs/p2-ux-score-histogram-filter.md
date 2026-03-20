# P2 UX: Score Histogram Filter (Icebox)

## Theme

UX & Workflow

## Why It Matters

The score histogram prototype proved that histogram-based filtering can work technically, but it also showed weak product value in the current Jobs MVP. Users already have two stronger score-driven controls:

1. `Best match` queue tab for score-prioritized triage.
2. Sort-by-score for ordering the current result set.

Adding a score histogram alongside the salary histogram diluted the one numeric filter users are much more likely to care about during application triage: compensation.

## User / Business Value

- Keeps the Jobs page focused on the highest-signal numeric filter for MVP: salary.
- Avoids visual complexity and repeated interaction models where the second model adds little incremental value.
- Preserves the underlying implementation path so score-distribution filtering can be reintroduced later if users show a clear need to slice the queue by score bands rather than just sorting.

## Current Findings

- Histogram filtering is a valid interaction model when the attribute has strong user meaning and users need to narrow the result set.
- Salary meets that bar. Score currently does not.
- The score histogram competed with salary for attention and weakened the page hierarchy.
- Users are more likely to:
  - click `Best match`
  - sort by score
  than to define a score range.

## MVP Decision

Do not ship score-histogram filtering in MVP.

Ship only:

- salary histogram filter
- salary range controls
- score sort
- `Best match` queue tab

## Future Trigger To Revisit

Promote this item only if one or more of these become true:

- users need to compare or isolate distinct score bands as part of application strategy
- score quality becomes more trusted/explainable and users start reasoning about score thresholds
- we add richer score explainability that makes score slicing actionable

## MVP Scope

Out of scope.

## Future Scope

- restore score histogram UI
- align it with the shipped salary histogram interaction model
- ensure it writes into the same active-filter chip system
- validate that dynamic rebucketing remains understandable after other filters are applied

## Dependencies

- Stable Jobs filter architecture in React
- Salary histogram interaction finalized first
- Better evidence that score-band slicing is a meaningful user need

## Definition of Done

This item remains in Icebox until:

1. There is explicit user demand for score-range filtering.
2. The Jobs screen has space and hierarchy to support it without competing with salary.
3. The product team approves reintroducing it as more than a prototype.
