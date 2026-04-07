# Design: Cache Removal + Dupes Accounting Fix

**Date:** 2026-04-07
**Branch:** `claude/hopeful-jackson`
**Status:** Approved

---

## Problem Statement

Three related data-quality issues remain unresolved after the 2026-04-07 QA sprint:

1. **Cache not disabled** — HTTP sources (Built In, Levels.fyi) default to 12h TTL, producing `+0` deltas when re-run within the window. Complicates development and QA.
2. **Built In / Levels.fyi showing `+0` delta** — downstream of Issue 1. Both are HTTP sources hitting the cache.
3. **LinkedIn import math doesn't add up** — `Found +38, Filtered +0, Dupes +0, Imported +10` leaves 28 jobs unaccounted. Root cause: "Dupes" column only shows within-source duplicates (`droppedByDedupeCount`); cross-source duplicates (`duplicateCollapsedCount`) are tracked in the delta table but never surfaced in the UI.

---

## Decision: Remove Cache Entirely

**Rationale:** The cache was added to avoid users hammering job boards. The protection rationale is weak in practice:
- Each instance runs locally and is nearly indistinguishable from standard browsing
- No real rate-limit incidents have occurred
- Cache is actively hurting development velocity and obscuring data quality

**Approach:** Delete the cache layer entirely. Sources always run fresh. No TTL configuration, no freshness checks, no snapshot age guards. Can be reintroduced later if a real rate-limit incident occurs.

---

## Architecture

### Change 1: Remove cache-policy freshness / TTL machinery

The following functions in `src/sources/cache-policy.js` are removed:
- `getDefaultCacheTtlHours`
- `getSourceCacheTtlHours`
- `isTimestampFresh`
- `isSourceCaptureFresh`
- `getFreshCachedJobs` — replaced by direct `getSourceCaptureJobs` call (always reads latest snapshot)
- `getSourceRefreshDecision` — callers simplified to always treat as "needs refresh"
- `normalizeRefreshProfile` — removed; refresh profile concept goes away

**Keep:** `readSourceCaptureSummary`, `writeSourceCapturePayload`, `getSourceCaptureJobs`, `sanitizeExpectedCount` — these are I/O primitives unrelated to caching.

**Source adapters** (`builtin-jobs.js`, `google-jobs.js`, `levelsfyi-jobs.js`, `yc-jobs.js`): Replace `getFreshCachedJobs(...)` guard with unconditional `getSourceCaptureJobs` or direct fetch → write.

**`src/review/server.js` + `src/cli.js`:** Remove all `getSourceRefreshDecision` / `normalizeRefreshProfile` call sites. Run paths proceed without freshness checks.

### Change 2: Remove `cacheTtlHours` from config schema and source library

- `src/config/schema.js`: Remove `cacheTtlHours` validation
- `src/config/source-library.js`: Remove `cacheTtlHours` defaults
- `src/review/server.js`: Remove override handling for `cacheTtlHours`

### Change 3: Fix Dupes column to combine within-source + cross-source counts

**Location:** `src/review/web/src/features/searches/logic.js`, `buildSearchRows()`

**Current:** `dedupedCount = droppedByDedupeCount` (within-source only)

**New:**
```js
const dedupedCount = normalizeOptionalCount(
  (source.droppedByDedupeCount ?? 0) + (source.duplicateCollapsedCount ?? 0)
);
```

`duplicateCollapsedCount` is already present on the source object (from delta table via server). This is a pure display-layer change. Internally the two metrics remain separate — useful for future "net new jobs per source" reporting.

**Invariant restored:** `Found = Filtered + Dupes + Imported` holds for every source row.

---

## Test Changes

- Delete `test/cache-policy.test.js`
- Delete `test/capture-refresh-decision.test.js`
- Delete `test/dashboard-refresh-status.test.js`
- Update `test/levelsfyi-source-registration.test.js` — remove `getDefaultCacheTtlHours` assertion
- Update `test/yc-source-registration.test.js` — same
- Update `test/source-expected-count.test.js`, `test/linkedin-expected-count.test.js`, `test/yc-capture.test.js` — remove `writeSourceCapturePayload`/`readSourceCaptureSummary` cache-specific assertions; keep I/O primitive tests if they remain
- Update `test/refresh-profile-cli.test.js` — remove entirely if only tests `normalizeRefreshProfile`

---

## Success Criteria

1. HTTP sources (Built In, Levels.fyi) produce non-zero deltas on back-to-back runs
2. `Found = Filtered + Dupes + Imported` holds for every source row in the UI
3. LinkedIn shows `+28` in Dupes (or the correct cross-source dedup count) instead of 0
4. All remaining tests pass
5. No `cacheTtlHours` references remain in schema, source library, or server

---

## Out of Scope

- UI changes beyond the Dupes column math fix
- Re-introducing cache infrastructure
- Any new feature work (onboarding constraint still active)
