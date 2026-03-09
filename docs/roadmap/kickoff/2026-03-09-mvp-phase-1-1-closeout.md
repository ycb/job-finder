# MVP Phase 1.1 Closeout Scope (2026-03-09)

## Objective

Close the remaining MVP follow-on items from Phase 1 so the execution tracker reaches fully completed state for this scoped set.

## In Scope (Closeout Set)

1. `P0` Full-JD page-level verification pass (evaluation-stage detail rerun + deterministic fallback evidence).
2. `P0` Full-JD extraction gap closure (source-level detail coverage + gating).
3. `P1` Search controls completion (`AND`/`OR`, include/exclude, hard-filter explainability, cache status clarity).
4. `P1` Net-new + refresh behavior completion (persisted delta classification and UI counters).

## Not In Scope

1. New source additions.
2. Distribution expansion (Homebrew).
3. Claude/Codex integration expansion beyond already-shipped safety boundary.
4. P2 and Icebox items.

## Why This Scope

These are the last execution-tracker items still preventing a clean MVP Phase 1 completion claim.

## Success Criteria

1. Tracker snapshot for this scope has no `Blocked` or `In progress` items.
2. Full-JD decisions show explicit evidence for detail-success vs snippet-fallback path.
3. Search controls support explicit keyword semantics and include/exclude behavior in persisted criteria + UI.
4. Dashboard/CLI expose net-new vs updated vs unchanged counts per run.
5. Each UI-affecting item includes Playwright smoke evidence before completion.

## Sequencing

1. `W2-01` Full-JD page-level verification pass (evaluation pipeline behavior + tests).
2. `W2-03` Search controls completion (shared criteria model + API/UI + tests).
3. `W2-04` Net-new + refresh deltas (data model + sync pipeline + API/UI + tests).
4. `W2-02` Full-JD extraction closure gating and source-level quality confirmation.

## Dependency Notes

1. Built In salary extraction is no longer a hard blocker for `W2-01`; latest contract checks show Built In salary coverage above gate threshold.
2. `W2-02` depends on having stable provenance and delta reporting from `W2-01` and `W2-04`.

## Stakeholder Input Requested

Only two decisions are needed to avoid later rework:

1. Detail coverage enforcement policy:
   - Option A (recommended): keep `>=90% detail-description` target with explicit per-source exception docs.
   - Option B: temporary lower threshold for MVP closeout with dated follow-up commitment.
2. Search keyword default semantics:
   - Option A (recommended): default `AND`, user-selectable `OR`.
   - Option B: default `OR`, user-selectable `AND`.

If no response by next dispatch, default to Option A for both.

## Verification Gate

No closeout item is marked complete without:

1. Fresh `npm test` run with zero failures.
2. Targeted test evidence for changed modules.
3. Playwright smoke verification artifact for any UI-affecting change.
4. Source-contract check evidence for source-quality tasks.
