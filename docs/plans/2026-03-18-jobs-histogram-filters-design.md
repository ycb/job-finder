# Jobs Histogram Filters Design

## Goal
Refine the Jobs page so hierarchy, filtering, and source controls match stakeholder intent: primary emphasis on `Run search` and `View Job`, quieter secondary controls, tab-attached source management, and histogram-based filters for salary and score.

## Problem
The current Jobs UI is functional but still mixes control weights and interaction models:

- custom expand/collapse controls add visual noise and duplicate established shadcn patterns
- widget-based filtering and a separate Filters button create redundant post-search narrowing systems
- `Sort` is visually separated from Results even though it operates on result ordering
- `Max salary` is not a meaningful user concept for post-search filtering
- `Job sources` is visually detached from the search surface it governs
- salary filtering via a 2x2 matrix is clever but opaque; it hides ranges, counts, and distribution shape

## Approved Direction

### 1. Search Surface Hierarchy
The top of the Jobs page will be organized as:

1. Page header with value metrics on the right.
2. `Job sources` tab control attached above the search box using the same visual pattern as `My Job Searches`.
3. Horizontal search composer with:
   - `Job title`
   - `Location`
   - `Minimum salary`
   - `Date posted`
   - primary CTA `Run search`
4. Advanced search controls directly beneath in a 3-column layout:
   - `Hard filter` accordion spanning columns 1-2
   - `Additional keywords` accordion in column 3

Only `Run search` and `View Job` should read as primary CTAs.

### 2. Accordion Pattern
Use the shadcn accordion pattern for `Hard filter` and `Additional keywords`.

Requirements:
- trigger lives in each module header
- collapsed state shows summary content, not disappearance
- accordions are visually quieter than primary CTAs and tabs
- no bespoke `Expand`/`Collapse` buttons

### 3. Widgets and Post-Search Filters
Widgets remain above post-search filters.

Widget layout:
- column 1: large `Total jobs` and `Avg score`
- column 2: stacked keyword widgets with vertical overflow
- column 3: title breakdown list
- column 4: histogram-capable distribution modules

Salary and score move to one shared visual language: histogram filters.

### 4. Histogram Filters
Replace the salary 2x2 matrix with a histogram-based filter. Apply the same solution to score.

Histogram requirements:
- show distribution shape
- show range context
- support active min/max filtering
- display counts per bucket or range selection state clearly enough that filtering is understandable
- integrate with the shared active filter chip rail

For MVP, histogram filters should appear in the post-search Filters accordion below widgets. They should not live in the top composer.

### 5. Filters vs Sort
Post-search controls split into two roles:

- `Filters`: accordion below widgets, containing histogram filters and other narrowing controls
- `Sort`: moved into the Results header where it belongs semantically

The separate `Filters` button is removed.

The active filter chip rail remains the one canonical representation of all active narrowing state.

### 6. Results and Detail
Results remain left column and Detail remains right column. Existing card-based result rows and detail CTA hierarchy stay directionally correct.

Refinement in this pass:
- maintain lower weight on tabs/filters than on primary actions
- keep `View Job` as the dominant action in detail
- keep source attribution as chips, not a standalone section

## Chosen Over Alternatives

### Accordion vs custom collapse
Accordion wins because it is a known pattern, visually quieter, and consistent with the chosen component system.

### Histogram vs 2x2 matrix
Histogram wins because it generalizes across both salary and score, reveals distribution, and aligns with common filtering patterns. The 2x2 matrix is less standard and hides too much information.

### Filters accordion vs persistent filter row
Accordion wins because widgets already occupy significant space. A persistent expanded filter row competes with results and weakens hierarchy.

## MVP Scope
Included in this pass:
- source tabs attached above search box
- shadcn accordion conversion for advanced search modules
- remove `Max salary`
- move `Sort` into Results header
- remove standalone Filters button
- add a Filters accordion below widgets
- add salary and score histogram filters in that accordion
- keep histogram selections reflected in chip rail

Not included in this pass:
- chart library expansion beyond what is needed for salary/score histograms
- redesign of title/keyword widgets beyond layout polish
- LLM `Why it fits`
- employment-type filter return

## Success Criteria
- Primary actions are visually obvious and secondary controls are quieter.
- `Job sources` reads as part of the search surface, not a detached status block.
- Users can understand and use salary and score filtering from visible distributions.
- Post-search filtering and sorting are clearly separated.
- The page remains scannable with results and detail visible together.
