# YC Recency Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make YC Jobs query construction and capture honor JobFinder location, salary presence, and recency coverage.

**Architecture:** Use URL-only mapping for YC filters and enforce recency via lazy-load capture targeting a percentage of the total matching count. Diagnostics should expose the target and stop reason.

**Tech Stack:** Node.js, AppleScript/Chrome automation, URL builder, unit tests.

---

> Note: Implementation already applied in this worktree; keep this plan as the recorded execution checklist.

### Task 1: YC URL builder parity

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/test/search-url-builder.test.js`
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/test/source-criteria-accountability.test.js`
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/search-url-builder.js`

**Step 1: Write the failing test**

```js
assert.equal(parsed.searchParams.get("sortBy"), "newest");
assert.equal(parsed.searchParams.get("locations"), "San Francisco, CA");
assert.equal(parsed.searchParams.get("hasSalary"), "true");
```

**Step 2: Run test to verify it fails**

Run: `node --test test/search-url-builder.test.js test/source-criteria-accountability.test.js`  
Expected: FAIL (sortBy/location/salary not set)

**Step 3: Write minimal implementation**

```js
parsed.searchParams.set("locations", normalizeText(criteria.location));
parsed.searchParams.set("hasSalary", "true");
parsed.searchParams.set("sortBy", wantsNewest ? "newest" : "keyword");
```

**Step 4: Run test to verify it passes**

Run: `node --test test/search-url-builder.test.js test/source-criteria-accountability.test.js`  
Expected: PASS

**Step 5: Commit**

```bash
git add test/search-url-builder.test.js test/source-criteria-accountability.test.js src/sources/search-url-builder.js
git commit -m "feat: map yc location, salary, and recency sort"
```

### Task 2: YC recency fraction mapping

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/test/yc-jobs.test.js`
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/yc-jobs.js`

**Step 1: Write the failing test**

```js
assert.equal(getYcRecencyFraction("24h"), 0.1);
assert.equal(getYcRecencyFraction("3d"), 0.3);
```

**Step 2: Run test to verify it fails**

Run: `node --test test/yc-jobs.test.js`  
Expected: FAIL (export missing)

**Step 3: Write minimal implementation**

```js
export function getYcRecencyFraction(rawValue) { ... }
```

**Step 4: Run test to verify it passes**

Run: `node --test test/yc-jobs.test.js`  
Expected: PASS

**Step 5: Commit**

```bash
git add test/yc-jobs.test.js src/sources/yc-jobs.js
git commit -m "feat: add yc recency fraction mapping"
```

### Task 3: YC lazy-load capture targeting

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`

**Step 1: Write the failing test**

Add diagnostics assertions in a new unit test if needed (optional).

**Step 2: Run test to verify it fails**

Run: `node --test test/yc-jobs.test.js`  
Expected: N/A (if no new test)

**Step 3: Write minimal implementation**

```js
const matchingCount = ...;
const targetCount = Math.ceil(matchingCount * recencyFraction);
scroll until targetCount reached or no growth.
```

**Step 4: Run test to verify it passes**

Run: `node --test test/yc-jobs.test.js`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/browser-bridge/providers/chrome-applescript.js
git commit -m "feat: scroll yc capture to recency target"
```

### Task 4: Update YC contract + learnings

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/config/source-contracts.json`
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/docs/learnings.md`

**Step 1: Write the failing test**

Run existing contract/accountability tests.

**Step 2: Run test to verify it fails**

Run: `node --test test/source-criteria-accountability.test.js`  
Expected: FAIL if contract mismatches

**Step 3: Write minimal implementation**

```json
"location": "url",
"minSalary": "url",
"keywords": "url"
```

**Step 4: Run test to verify it passes**

Run: `node --test test/source-criteria-accountability.test.js`  
Expected: PASS

**Step 5: Commit**

```bash
git add config/source-contracts.json docs/learnings.md
git commit -m "docs: align yc contract mapping"
```
