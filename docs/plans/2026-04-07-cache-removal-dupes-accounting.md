# Cache Removal + Dupes Accounting Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the source capture cache entirely so sources always run fresh, and fix the Dupes column accounting so `Found = Filtered + Dupes + Imported` holds for every source row.

**Architecture:** The cache layer lives in `src/sources/cache-policy.js` and is called from 4 HTTP source adapters (`builtin-jobs`, `google-jobs`, `levelsfyi-jobs`, `yc-jobs`) via `getFreshCachedJobs()`, and from 2 browser-capture adapters (`indeed-jobs`, `ziprecruiter-jobs`) via `getSourceCaptureJobs()`. The cache-gating logic (`getSourceRefreshDecision`) also runs in `src/review/server.js` and `src/cli.js` on every run path. Removing the cache means: (1) delete the freshness-check guard from each source adapter, (2) remove `getSourceRefreshDecision`/`normalizeRefreshProfile` call sites from server and CLI, (3) remove `cacheTtlHours` from config schema. The Dupes fix is a display-layer change in `buildSearchRows` — `droppedByDedupeCount` (currently `duplicateCollapsedCount` from delta table) needs to also add `buildSourceCaptureFunnel`'s inline within-source dedup count, which is currently computed but orphaned. Both values exist; the fix is to surface and sum them.

**Tech Stack:** Node.js ESM, SQLite, Express (server.js), React (App.jsx), node:test

---

## Task 1: Remove cache guard from HTTP source adapters

**Files:**
- Modify: `src/sources/builtin-jobs.js:243-250`
- Modify: `src/sources/google-jobs.js:224-232`
- Modify: `src/sources/levelsfyi-jobs.js:564-573`
- Modify: `src/sources/yc-jobs.js:487-497`

These four adapters follow the same pattern:
```js
const cachedJobs = getFreshCachedJobs(source);
if (Array.isArray(cachedJobs)) {
  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return cachedJobs.slice(0, source.maxJobs);
  }
  return cachedJobs;
}
// ... fetch + write ...
```

**Step 1: Remove the cache guard block from builtin-jobs.js**

Delete the `getFreshCachedJobs` import from the import line and remove the cache guard block (the `if (Array.isArray(cachedJobs))` check). The function should proceed directly to fetch + write.

Before:
```js
import { getFreshCachedJobs, writeSourceCapturePayload } from "./cache-policy.js";
// ...
export function collectBuiltInJobsFromSearch(source) {
  const cachedJobs = getFreshCachedJobs(source);
  if (Array.isArray(cachedJobs)) {
    if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
      return cachedJobs.slice(0, source.maxJobs);
    }
    return cachedJobs;
  }
  const html = fetchBuiltInSearchHtml(...);
  // ...
}
```

After:
```js
import { writeSourceCapturePayload } from "./cache-policy.js";
// ...
export function collectBuiltInJobsFromSearch(source) {
  const html = fetchBuiltInSearchHtml(...);
  // ...
}
```

**Step 2: Apply the same change to google-jobs.js, levelsfyi-jobs.js, yc-jobs.js**

Same pattern: remove `getFreshCachedJobs` from import, delete the guard block.

**Step 3: Verify no syntax errors**

```bash
node --input-type=module < /dev/null && \
  node -e "import('./src/sources/builtin-jobs.js')" 2>&1 | head -5 && \
  node -e "import('./src/sources/google-jobs.js')" 2>&1 | head -5 && \
  node -e "import('./src/sources/levelsfyi-jobs.js')" 2>&1 | head -5 && \
  node -e "import('./src/sources/yc-jobs.js')" 2>&1 | head -5
```
Expected: No errors (or only expected "missing config" errors, not syntax/import errors)

**Step 4: Run tests**

```bash
npm test 2>&1 | tail -30
```
Expected: Same pass/fail count as baseline (17 pre-existing failures, no new failures)

**Step 5: Commit**

```bash
git add src/sources/builtin-jobs.js src/sources/google-jobs.js src/sources/levelsfyi-jobs.js src/sources/yc-jobs.js
git commit -m "fix(cache): remove getFreshCachedJobs guard from HTTP source adapters"
```

---

## Task 2: Remove getSourceRefreshDecision from server.js and cli.js run paths

**Files:**
- Modify: `src/review/server.js` (lines ~1084-1091, ~1571-1591)
- Modify: `src/cli.js` (lines ~525-530, ~1784-1793, ~1870-1874)

These call sites gate capture behind `decision.allowLive`. With no cache, the decision is always "allow live". We remove the gate entirely.

**Step 1: Remove the cache gate in server.js runSingleSourceCapture (~line 1571)**

Find the block:
```js
const refreshProfile = normalizeRefreshProfile(...);
const decisionSource = sourceWithCadenceCacheTtl(source, options);
const decision = getSourceRefreshDecision(decisionSource, { ... });

if (!decision.allowLive) {
  return {
    capture: {
      provider: "cache",
      status: "completed",
      cached: true,
      ...
    },
    sync: null
  };
}
```

Delete this entire block (the `normalizeRefreshProfile`, `getSourceRefreshDecision`, and the early-return `if (!decision.allowLive)` branch). Also remove those functions from the import at the top of the file.

**Step 2: Remove or simplify buildSourceRefreshMeta (~line 1103)**

Find the call:
```js
const decision = getSourceRefreshDecision(source, { ... });
```

If `buildSourceRefreshMeta` is only used for UI "refresh status" metadata, simplify it: remove the `getSourceRefreshDecision` call and return a static object indicating the source is always eligible. If the function is not used elsewhere, delete it entirely.

Check usage: `grep -n "buildSourceRefreshMeta" src/review/server.js`

**Step 3: Remove the cache gates in cli.js (3 call sites)**

For each of the three call sites at ~525, ~1784, ~1870:
- Delete the `getSourceRefreshDecision` call and the `if (!decision.allowLive)` early-return block
- The run path should proceed unconditionally

Also remove `getSourceRefreshDecision`, `normalizeRefreshProfile`, and any related helpers from the import at the top of cli.js.

**Step 4: Verify syntax**

```bash
node -e "import('./src/review/server.js')" 2>&1 | head -10
node -e "import('./src/cli.js')" 2>&1 | head -10
```
Expected: No errors

**Step 5: Run tests**

```bash
npm test 2>&1 | tail -30
```
Expected: Same or fewer failures (some cache-related tests may now pass trivially or fail for different reasons — that's expected, we'll clean them up in Task 4)

**Step 6: Commit**

```bash
git add src/review/server.js src/cli.js
git commit -m "fix(cache): remove getSourceRefreshDecision gates from server and CLI run paths"
```

---

## Task 3: Remove cacheTtlHours from config schema and source library

**Files:**
- Modify: `src/config/schema.js` (~line 736)
- Modify: `src/config/source-library.js` (~lines 10, 20, 29, 39, 48, 57)
- Modify: `src/review/server.js` (~lines 1536, 1543) — remove `cacheTtlHours` override handling

**Step 1: Remove cacheTtlHours from schema validation**

In `src/config/schema.js` around line 736, find where `cacheTtlHours` is validated. Delete that validation block.

**Step 2: Remove cacheTtlHours defaults from source library**

In `src/config/source-library.js`, remove `cacheTtlHours` from the default source object definitions.

**Step 3: Remove cacheTtlHours override handling from server.js**

Find `sourceWithCadenceCacheTtl` or similar function around lines 1536-1543 in server.js. If this function only serves the cache decision, delete it. If it does other things, strip only the cacheTtlHours assignment.

**Step 4: Verify no remaining cacheTtlHours references in src/**

```bash
grep -rn "cacheTtlHours" src/
```
Expected: No output (all references removed)

**Step 5: Run tests**

```bash
npm test 2>&1 | tail -30
```

**Step 6: Commit**

```bash
git add src/config/schema.js src/config/source-library.js src/review/server.js
git commit -m "fix(cache): remove cacheTtlHours from config schema and source library"
```

---

## Task 4: Delete and update cache-related tests

**Files:**
- Delete: `test/cache-policy.test.js`
- Delete: `test/capture-refresh-decision.test.js`
- Delete: `test/dashboard-refresh-status.test.js`
- Delete: `test/refresh-profile-cli.test.js` (if it only tests `normalizeRefreshProfile`)
- Update: `test/levelsfyi-source-registration.test.js` — remove `getDefaultCacheTtlHours` assertion
- Update: `test/yc-source-registration.test.js` — remove `getDefaultCacheTtlHours` assertion
- Update: `test/source-expected-count.test.js` — remove cache-specific assertions
- Update: `test/linkedin-expected-count.test.js` — remove cache-specific assertions
- Update: `test/yc-capture.test.js` — remove cache-specific assertions

**Step 1: Check what refresh-profile-cli.test.js actually tests**

```bash
cat test/refresh-profile-cli.test.js
```
If it only tests `normalizeRefreshProfile`, delete it. If it tests other CLI behavior, remove only the `normalizeRefreshProfile` tests.

**Step 2: Delete the three dedicated cache test files**

```bash
rm test/cache-policy.test.js test/capture-refresh-decision.test.js test/dashboard-refresh-status.test.js
```

**Step 3: Update registration tests**

In `test/levelsfyi-source-registration.test.js` and `test/yc-source-registration.test.js`, find and remove assertions like:
```js
assert.equal(getDefaultCacheTtlHours(source.type), 12);
```
Remove the import of `getDefaultCacheTtlHours` as well.

**Step 4: Update remaining test files**

For `test/source-expected-count.test.js`, `test/linkedin-expected-count.test.js`, `test/yc-capture.test.js`:
- Remove `writeSourceCapturePayload`/`readSourceCaptureSummary` imports if only used for cache setup
- Keep any assertions about job count or source behavior that don't depend on cache TTL

**Step 5: Run tests and confirm baseline**

```bash
npm test 2>&1 | tail -30
```
Expected: Fewer total tests (deleted files), no new failures in non-cache tests. Note the new pass/fail count.

**Step 6: Commit**

```bash
git add -A test/
git commit -m "test(cache): remove cache-specific tests after cache layer removal"
```

---

## Task 5: Fix Dupes column to include within-source dedup count

**Context:** `buildSourceCaptureFunnel` in `src/review/server.js` computes `droppedByDedupeCount` (within-source hash dedup, inline from captured jobs) but this value is not fed into the source metrics object sent to the frontend. The UI's "Dupes" column currently only shows `duplicateCollapsedCount` (cross-source dedup from delta table). We need to sum both.

**Files:**
- Modify: `src/review/server.js` (~lines 2339-2345 where `droppedByDedupeCount` is set on the source object)

**Step 1: Find where the source object is assembled in server.js**

```bash
grep -n "droppedByDedupeCount" src/review/server.js
```

Find the line where `droppedByDedupeCount: dedupedCount` is set. This is where `dedupedCount` comes from `aggregateSourceRunTotals` (which sums `duplicateCollapsedCount` from the delta table).

**Step 2: Find where buildSourceCaptureFunnel result is used**

```bash
grep -n "buildSourceCaptureFunnel\|droppedByDedupeCount\|captureFunnel" src/review/server.js | head -30
```

Identify whether `buildSourceCaptureFunnel`'s `droppedByDedupeCount` is currently stored anywhere or discarded.

**Step 3: Thread the funnel dedup count into the source object**

In the source object assembly, change:
```js
droppedByDedupeCount: dedupedCount,  // currently only cross-source delta count
```
to:
```js
droppedByDedupeCount: sumOptionalCounts(dedupedCount, funnelDedupedCount),
```
where `funnelDedupedCount` is `captureFunnel?.droppedByDedupeCount ?? null` and `sumOptionalCounts` is a local helper:
```js
function sumOptionalCounts(a, b) {
  const na = Number.isFinite(a) ? a : null;
  const nb = Number.isFinite(b) ? b : null;
  if (na === null && nb === null) return null;
  return (na ?? 0) + (nb ?? 0);
}
```

**Step 4: Verify the invariant manually**

Run a capture and check the Sources table:
```bash
npm run run 2>&1 | tail -20
npm run review
```
Open the dashboard Sources tab. For LinkedIn, verify `Found = Filtered + Dupes + Imported` for the delta row.

**Step 5: Run tests**

```bash
npm test 2>&1 | tail -30
```

**Step 6: Commit**

```bash
git add src/review/server.js
git commit -m "fix(accounting): include within-source dedup count in Dupes column"
```

---

## Task 6: Verify end-to-end and clean up

**Step 1: Run a full pipeline**

```bash
npm run run 2>&1 | tail -30
```
Expected: All 6 sources execute (no cache short-circuit), Built In and Levels.fyi produce non-zero deltas.

**Step 2: Check Sources tab math**

Open dashboard, go to Sources tab. For each source verify:
- `Found delta = Filtered delta + Dupes delta + Imported delta`

**Step 3: Check no orphaned cache imports remain**

```bash
grep -rn "getFreshCachedJobs\|getSourceRefreshDecision\|normalizeRefreshProfile\|cacheTtlHours\|isSourceCaptureFresh\|isTimestampFresh" src/
```
Expected: No output (all removed from src/).

**Step 4: Final test run**

```bash
npm test 2>&1 | grep -E "^(pass|fail|ok|not ok)" | tail -20
```
Confirm pass count is stable or improved vs baseline.

**Step 5: Final commit if any cleanup needed, then summarize**

Report: sources that now produce non-zero deltas, before/after test counts, and confirmation that accounting invariant holds.
