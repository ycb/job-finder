# P1 UX & Workflow: Multi-Search Support with Add-Tab Flow

- Priority: P1
- Theme: UX & Workflow

## Why
Single-search-at-a-time workflow limits power users and slows iterative exploration.

## Impact
Multi-search tabs improve throughput, side-by-side comparison, and faster source iteration.

## Detailed Spec
- Extend search workflow to support multiple concurrent search contexts.
- Add `+` tab action to create and manage additional search tabs.
- Persist tab state (query/filters/selected source scope) across refreshes.
- Keep run actions scoped to active tab while preserving global run options.

## Acceptance Criteria
- Users can create, switch, and close multiple search tabs.
- Each tab maintains independent search criteria/state.
- Tests cover tab lifecycle and state persistence behavior.
