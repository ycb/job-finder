# YC Recency + Location Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make YC query construction and capture parity match JobFinder criteria (location, salary range, recency) and reliably harvest lazy-loaded results.

**Architecture:**
- Extend YC URL builder to encode location, salary-range checkbox, and recency sort.
- In the YC capture path, compute a recency-based target count from the total results and scroll until reaching that target (or until no new jobs load).
- Keep post-capture filters for location as a backstop, but require location be applied in URL.

**Tech Stack:** Node.js, AppleScript Chrome bridge, existing source URL builder and YC capture logic.

---

### Task 1: Add YC recency fraction mapping helper (TDD)

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/yc-jobs.js`
- Test: `/Users/admin/.codex/worktrees/51f6/job-finder/test/yc-jobs.test.js`

**Step 1: Write failing test**

```js
test("resolveYcRecencyFraction maps all datePosted values", () => {
  assert.equal(resolveYcRecencyFraction("any"), 1);
  assert.equal(resolveYcRecencyFraction("1d"), 0.1);
  assert.equal(resolveYcRecencyFraction("3d"), 0.3);
  assert.equal(resolveYcRecencyFraction("1w"), 0.6);
  assert.equal(resolveYcRecencyFraction("2w"), 0.8);
  assert.equal(resolveYcRecencyFraction("1m"), 1);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/yc-jobs.test.js`
Expected: FAIL due to missing function export.

**Step 3: Implement helper**

Add `resolveYcRecencyFraction(datePosted)` to `yc-jobs.js` and export it.
- Return `1` for unknown or empty values.
- Mapping table:
  - `any` -> `1.0`
  - `1d` -> `0.1`
  - `3d` -> `0.3`
  - `1w` -> `0.6`
  - `2w` -> `0.8`
  - `1m` -> `1.0`

**Step 4: Run test to verify it passes**

Run: `node --test test/yc-jobs.test.js`
Expected: PASS.

---

### Task 2: Encode YC location + salary-range + recency sort in URL (TDD)

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/search-url-builder.js`
- Test: `/Users/admin/.codex/worktrees/51f6/job-finder/test/search-url-builder.test.js`

**Step 1: Update test to expect new params**

Extend the existing YC test to assert:
- `location` param equals criteria location.
- `hasSalary` is `only` when `minSalary` is set.
- `sortBy` is `newest` when `datePosted` is not `any`.
- criteria accountability marks `location` and `minSalary` as applied in URL.

**Step 2: Run tests and see failure**

Run: `node --test test/search-url-builder.test.js`
Expected: FAIL on missing params / accountability.

**Step 3: Implement URL updates**

- Set `location` param to `criteria.location`.
- Set `hasSalary=only` when `criteria.minSalary` is set.
- Set `sortBy=newest` when `criteria.datePosted` is not `any`.
- Update criteria accountability:
  - `location`, `minSalary` -> `markAppliedInUrl`
  - `datePosted` -> `markAppliedPostCapture` (fractional mapping) but add a note that recency is approximated.

**Step 4: Re-run tests**

Run: `node --test test/search-url-builder.test.js`
Expected: PASS.

---

### Task 3: Add lazy-load scrolling + recency cap to YC capture (TDD)

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/sources/yc-jobs.js`
- Test: `/Users/admin/.codex/worktrees/51f6/job-finder/test/yc-capture.test.js` (or new unit test as needed)

**Step 1: Add extraction payload fields**

Extend YC extraction script to include:
- `matchingCount`: parse from text `Showing X matching startups`
- `jobCardsCount` (already)
- `jobIds` (numeric ids only)

**Step 2: Compute target count**

In `captureYcSourceWithChromeAppleScript`:
- Read `source.criteria.datePosted`
- `fraction = resolveYcRecencyFraction(datePosted)`
- `targetCount = matchingCount ? ceil(matchingCount * fraction) : null`
- Cap by `source.maxJobs` if set.

**Step 3: Scroll loop**

In `readYcJobsFromChrome`:
- Loop until `jobIds.length >= targetCount` OR no new jobIds for 2 iterations.
- Scroll the container (or page) by viewport height each loop.
- Keep diagnostics: `matchingCount`, `targetCount`, `fraction`, `jobIdsCount`, `scrollPasses`.

**Step 4: Tests**

Add a unit test for the target count mapping logic (mock matchingCount/fraction) or an integration test in `yc-capture.test.js` verifying the stop condition with synthetic payloads.

**Step 5: Run tests**

Run: `node --test test/yc-capture.test.js` (and any new unit tests).
Expected: PASS.

---

### Task 4: QA run

**Steps:**
1. Run: `node src/cli.js capture-source-live yc-product-jobs`
2. Verify:
   - URL includes `location=<city>`, `hasSalary=only`, `sortBy=newest`
   - Capture count approximates recency fraction of `Showing X matching startups`
   - Location matches the JobFinder search (strict)

---

### Progress Tracking
- [ ] Task 1 complete
- [ ] Task 2 complete
- [ ] Task 3 complete
- [ ] Task 4 complete

