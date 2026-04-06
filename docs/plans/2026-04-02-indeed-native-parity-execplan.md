# Indeed Native Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore Indeed parity for the active JobFinder search by keeping the correct base query and applying native filter UI for salary, recency, and exact-location before capture.

**Architecture:** Indeed should no longer encode fragile salary/date/radius state directly into the URL. The browser-capture path should load the proven-good base search URL, apply the native filter controls in the live page, verify the page state reflects those choices, and only then scroll/paginate/extract summary-card rows. This keeps the source aligned with what the user can do manually and avoids the generic-search regression caused by unstable URL params.

**Tech Stack:** Node.js, Chrome AppleScript browser bridge, source URL builder, browser extraction tests, QA review server.

---

## Context

The base Indeed search is now fixed and clean:

- latest QA capture file: `/Users/admin/job-finder/data/captures/indeed-ai-pm.json`
- page URL: `https://www.indeed.com/jobs?q=Product+manager+ai&l=San+Francisco%2C+CA`
- count: `119`
- bad `viewjob`/`pagead` URLs: `0`

What remains broken is native parity for:

- `> $200k`
- `last 3 days`
- `exact location only`

The user's manual baseline demonstrates that Indeed can represent these natively in the live UI. The correct recovery is to drive those filters through the page controls rather than guessing with brittle query params that collapse the role query.

## Task 1: Add failing tests for the parity contract

**Files:**
- Modify: `test/search-url-builder.test.js`
- Modify: `test/source-criteria-accountability.test.js`
- Create/Modify: `test/indeed-chrome-parity.test.js`

**Step 1: Write failing builder/accountability tests**

Add tests asserting:

- `indeed_search` builder keeps only the base `q` and `l` URL params
- `minSalary`, `datePosted`, and `distanceMiles` are recorded as native-browser-application work, not URL params
- accountability stays honest about base query vs post-load native filters

**Step 2: Run the tests to confirm the current state fails where expected**

Run:

```bash
node --test test/search-url-builder.test.js test/source-criteria-accountability.test.js test/indeed-chrome-parity.test.js
```

Expected:
- at least one new Indeed parity assertion fails before implementation

## Task 2: Implement an Indeed post-load native filter driver

**Files:**
- Modify: `src/browser-bridge/providers/chrome-applescript.js`

**Step 1: Add a browser-side filter script for Indeed**

Implement a dedicated helper that:

- confirms the page is an Indeed jobs results page
- reads current filter/search input state
- applies:
  - `Pay > $200k`
  - `Date posted = last 3 days`
  - `Distance = exact location only`
- waits for the result page to settle after each filter application

The helper must validate the page state after applying filters by checking the live UI, not just the URL.

**Step 2: Keep capture summary-card only**

Do not introduce any detail-page clicks or JD reads.

The sequence for Indeed should be:

1. open base search URL
2. apply native filters in the page
3. verify live page state
4. scroll/paginate/extract cards

## Task 3: Record parity diagnostics in the capture payload

**Files:**
- Modify: `src/browser-bridge/providers/chrome-applescript.js`
- Modify: `src/sources/indeed-jobs.js` if needed

**Step 1: Persist verification hints**

Add internal capture diagnostics for Indeed such as:

- `queryValue`
- `locationValue`
- `appliedPayFilter`
- `appliedDatePostedFilter`
- `appliedDistanceFilter`
- `pageTitle`

These are internal-only and should help explain whether the native filter driver actually matched the live manual workflow.

## Task 4: Keep builder semantics minimal and honest

**Files:**
- Modify: `src/sources/search-url-builder.js`

**Step 1: Preserve the base query contract**

Ensure the builder continues to emit only:

- `q`
- `l`

for Indeed.

Do not reintroduce:

- `salaryType`
- `fromage`
- `radius`

into the URL unless a fresh manual-parity test proves those exact params are safe and stable.

## Task 5: Verify live in QA

**Files:**
- None

**Step 1: Run focused tests**

```bash
node --test test/search-url-builder.test.js test/source-criteria-accountability.test.js test/indeed-url-policy.test.js test/detail-enrichment.test.js test/indeed-chrome-parity.test.js
node -c src/browser-bridge/providers/chrome-applescript.js
node -c src/sources/search-url-builder.js
```

**Step 2: Apply the change to `/Users/admin/job-finder` and restart QA**

```bash
npm run review:stop --prefix /Users/admin/job-finder
npm run review:qa --prefix /Users/admin/job-finder
```

**Step 3: Trigger a fresh live Indeed capture from QA**

```bash
node src/cli.js capture-source-live indeed-ai-pm
```

Run it from:

```bash
/Users/admin/job-finder
```

**Step 4: Inspect the fresh capture**

Confirm:

- `pageUrl` remains the base search URL or a stable Indeed results URL
- the page/query still reflects `Product manager ai` and `San Francisco, CA`
- native filters reflect:
  - `> $200k`
  - `last 3 days`
  - `exact location only`
- no bad `viewjob`/`pagead` URLs reappear

## Acceptance Criteria

This work is complete only when:

- Indeed starts from the base query URL and no longer regresses into a generic salary-only search
- the native page state visibly reflects:
  - `Product manager ai`
  - `San Francisco, CA`
  - `> $200k`
  - `last 3 days`
  - `exact location only`
- the capture remains summary-card only
- no bogus `viewjob?jk=...` or `/pagead/clk` URLs survive in the final capture artifact
- the QA run is reproducible on `/Users/admin/job-finder`

## Notes

- Human verification handling is explicitly out of scope for this pass.
- YC is paused for now.
- This work is about manual/native Indeed parity only.
