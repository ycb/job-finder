# Built In Baseline Rubric

Built In is the reference source for the MVP source-quality pass because it is the simplest healthy source in the current slate: it is direct fetch, does not require auth, and should stay readable even when other sources are failing or challenge-prone.

Use this rubric when checking whether a source-row or reporting change is safe:

- A healthy Built In row should show `direct_fetch` / `live` refresh semantics.
- A healthy row should keep `last attempted` separate from `last successful` when a later failure happens.
- Unknown expected totals should stay unknown (`?`), not collapse to zero.
- Average score should only reflect imported jobs; it should not appear as a proxy for a source that imported nothing.
- Challenge and verification failures should be surfaced as actionable failures, not blurred into generic success copy.

If a change makes Built In look unhealthy, unclear, or mathematically impossible, treat it as a regression in source reporting before extending the same behavior to other MVP sources.
