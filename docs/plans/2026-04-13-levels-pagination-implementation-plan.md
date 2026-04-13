# Levels Pagination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture all Levels.fyi jobs across pages by reusing the shared pagination loop and minimal DOM helpers (no bespoke pagination engine).

**Architecture:** Extend the existing pagination primitive to allow a per-page navigator hook, then reuse it for Levels by wiring in a “Next” click + wait-for-jobId-change step. Keep dedupe/stop logic centralized.

**Tech Stack:** Node.js, AppleScript Chrome automation, DOM scripts, Node test runner.

---

### Task 1: Add Levels pagination DOM helper tests

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/test/levelsfyi-dom-scripts.test.js`
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`

**Step 1: Write the failing test**

```js
test("Levels pagination scripts detect next and wait for job id change", () => {
  const html = `
    <div class="jobs">
      <a href="/jobs?jobId=1"><div class="companyJobTitle">Job 1</div></a>
    </div>
    <div class="pagination">
      <button aria-label="Next">Next</button>
    </div>
  `;
  const { context, document } = createDomContext(html);
  const nextButton = document.querySelector("[aria-label='Next']");
  nextButton.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = "/jobs?jobId=2";
    link.innerHTML = "<div class='companyJobTitle'>Job 2</div>";
    document.querySelector(".jobs").prepend(link);
  });

  const info = JSON.parse(vm.runInContext(buildLevelsFyiPaginationInfoScript(), context));
  assert.equal(info.nextExists, true);

  const clickPayload = JSON.parse(vm.runInContext(buildLevelsFyiPaginationClickNextScript(), context));
  assert.equal(clickPayload.clicked, true);

  const waitPayload = JSON.parse(
    vm.runInContext(buildLevelsFyiPaginationWaitScript("1"), context)
  );
  assert.equal(waitPayload.ready, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/levelsfyi-dom-scripts.test.js`  
Expected: FAIL (missing exports).

**Step 3: Write minimal implementation**

Add `buildLevelsFyiPaginationInfoScript`, `buildLevelsFyiPaginationClickNextScript`, `buildLevelsFyiPaginationWaitScript` to `chrome-applescript.js`.

**Step 4: Run test to verify it passes**

Run: `node --test test/levelsfyi-dom-scripts.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add test/levelsfyi-dom-scripts.test.js src/browser-bridge/providers/chrome-applescript.js
git commit -m "test: add Levels pagination DOM helpers"
```

---

### Task 2: Extend shared pagination primitive with a page navigator hook

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`

**Step 1: Write the failing test**

Add a pure helper test that verifies the navigator is invoked before page > 0 is captured.

```js
test("capturePaginatedGenericBoardJobs invokes page navigator", () => {
  const calls = [];
  const payloads = [
    { jobs: [{ externalId: "1" }], expectedCount: 2 },
    { jobs: [{ externalId: "2" }], expectedCount: 2 }
  ];
  let index = 0;

  const jobs = capturePaginatedJobsWithNavigator({
    maxPages: 2,
    readPage: () => payloads[index++],
    navigatePage: (pageIndex) => calls.push(pageIndex)
  });

  assert.deepEqual(calls, [1]);
  assert.equal(jobs.length, 2);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/levelsfyi-dom-scripts.test.js`  
Expected: FAIL (helper missing).

**Step 3: Minimal implementation**

- Introduce `capturePaginatedJobsWithNavigator({ maxPages, readPage, navigatePage })`
- Use the existing dedupe + stop logic from `capturePaginatedGenericBoardJobs`
- Refactor `capturePaginatedGenericBoardJobs` to call the new helper.

**Step 4: Run test to verify it passes**

Run: `node --test test/levelsfyi-dom-scripts.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add test/levelsfyi-dom-scripts.test.js src/browser-bridge/providers/chrome-applescript.js
git commit -m "refactor: allow pagination navigator hook"
```

---

### Task 3: Wire Levels capture into shared pagination loop

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`

**Step 1: Write the failing test**

Add a small unit test for a pure helper that decides if Levels pagination should proceed based on the DOM pagination info.

```js
test("Levels pagination guard uses nextExists", () => {
  assert.equal(shouldPaginateLevels({ nextExists: true }), true);
  assert.equal(shouldPaginateLevels({ nextExists: false }), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/levelsfyi-dom-scripts.test.js`  
Expected: FAIL.

**Step 3: Minimal implementation**

- Add `shouldPaginateLevels(info)` pure helper.
- After initial Levels capture, use `capturePaginatedJobsWithNavigator` to:
  - `readPage`: run Levels DOM capture on current page
  - `navigatePage`: click Next + wait for jobId change
- Stop if no Next or no new jobs.

**Step 4: Run test to verify it passes**

Run: `node --test test/levelsfyi-dom-scripts.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add test/levelsfyi-dom-scripts.test.js src/browser-bridge/providers/chrome-applescript.js
git commit -m "feat: paginate Levels via shared loop"
```

---

### Task 4: Verification

**Step 1: Run Levels unit tests**

Run: `node --test test/levelsfyi-dom-scripts.test.js`  
Expected: PASS.

**Step 2: Live capture sanity**

Run: `node src/cli.js capture-source-live levelsfyi-ai-pm`  
Expected: captured jobs >= 30 for the known search URL, with pagination stats logged.

