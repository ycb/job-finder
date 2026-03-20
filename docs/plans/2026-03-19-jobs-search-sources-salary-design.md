# Jobs Search, Sources, and Salary Filter Refinement Design

## Goal
Refine the Jobs page so search composition, source management, and salary filtering feel like one coherent workflow rather than separate modules competing for attention.

## Problem
The current Jobs page is directionally better, but three issues remain:

- `Search` and `Sources` are still split across different interaction models, with source management hidden behind a modal.
- The score histogram duplicates an already-strong sort/tab mental model and distracts from salary filtering, which is the genuinely differentiated numeric filter.
- The salary histogram control is over-instrumented and visually noisy, which makes the control harder to read instead of easier.

## Approved Direction

### 1. First Surface: Search / Ready / Disabled Tabs
Replace the current detached source tabs and modal flow with one inline tab system connected to the first surface:

- `Search`
- `Ready (n)`
- `Disabled (n)`

Behavior:
- `Search` shows the search composer and advanced search controls.
- `Ready (n)` shows enabled source management inline.
- `Disabled (n)` shows disabled/auth-required source management inline.
- The welcome toast CTA routes to the `Disabled` tab directly.
- The searches modal is removed from this flow.

This makes search and source readiness one continuous setup-and-run surface.

### 2. Primary Hierarchy
The only true primary CTAs remain:

- `Run search`
- `View Job`

Everything else should have lower visual weight:

- queue tabs
- Search / Ready / Disabled tabs
- accordions
- sort control

### 3. Advanced Search Controls
`Hard filter` and `Additional keywords` remain below the horizontal search bar, but:

- use standard shadcn accordion affordances
- no `Expand` / `Collapse` copy
- use the larger chevron-down style icon
- keep summary content visible when collapsed

Layout:
- `Hard filter` spans columns 1-2
- `Additional keywords` uses column 3

### 4. Salary Filtering
Keep salary as the one post-search numeric distribution filter in MVP.

Remove from MVP UI:
- score histogram

Simplify salary card:
- remove `Distributions` heading
- lead directly with `Salary`
- remove helper copy
- remove redundant summary row (`Selected range`, `Matching jobs`, `Full span`)
- keep:
  - histogram
  - dual-handle range slider
  - `Minimum` and `Maximum` display/input controls

### 5. Salary Completeness Signal
The salary filter must make it obvious that the histogram only reflects jobs with salary data.

Chosen direction:
- local segmented control in the Salary card header:
  - `With salary (x)`
  - `Missing salary (y)`

Behavior:
- `With salary` shows the histogram/filter
- `Missing salary` shows the count-only empty-state/list view for salary-missing jobs
- this keeps the salary completeness explanation attached to the salary filter itself without introducing another global tab layer

### 6. Filters and Sort
- Remove the standalone `Filters` button.
- Keep filters in a quiet accordion below widgets.
- Move `Sort` into the `Results` header.
- Present it quietly as `Sort: Score` / `Sort: Date posted` / `Sort: Salary`
- no asc/desc controls in MVP

Rationale:
- users are much more likely to use descending-quality defaults than to ask for reverse ordering
- asc/desc doubles control complexity with weak practical value for MVP

### 7. Source Automation Caveat
Chrome JavaScript execution via AppleScript requires the user to enable Chrome's “Allow JavaScript from Apple Events” developer setting when we need script execution inside the browser.

This is not required for merely opening tabs/URLs, but it is required for richer automation. The product must surface this clearly in onboarding/setup if that capability is expected.

## Out of MVP
- score histogram UI (move to Icebox/spec retained for possible revival)
- any comparison/baseline mode for histogram filtering
- additional chart types for titles/source mix

## Success Criteria
- Users can switch between `Search`, `Ready`, and `Disabled` without leaving the Jobs page.
- Source readiness no longer depends on a modal.
- Salary filtering is readable at a glance and clearly tied to real salary-bearing jobs.
- Sort reads as a quiet results control, not a competing page-level action.
- Accordion triggers match shadcn expectations instead of bespoke affordances.
