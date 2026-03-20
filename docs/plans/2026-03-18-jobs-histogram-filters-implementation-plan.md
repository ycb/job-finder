# Jobs Histogram Filters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refine the Jobs page with shadcn accordion-based advanced search, tab-attached source controls, and shared histogram filters for salary and score.

**Architecture:** Keep the existing Jobs React page and dashboard API, but move more derived filtering/view state into tested Jobs logic helpers. Use one canonical active-filter model, then render it through quieter controls and histogram-based filters.

**Tech Stack:** React, Tailwind, shadcn-style primitives, existing Jobs logic helpers, Node test runner.

---

### Task 1: Update planning artifacts

**Files:**
- Modify: `docs/plans/2026-03-12-jobs-react-migration-execplan.md`
- Create: `docs/plans/2026-03-18-jobs-histogram-filters-design.md`
- Create: `docs/plans/2026-03-18-jobs-histogram-filters-implementation-plan.md`

**Step 1: Record the approved refinement scope in the Jobs ExecPlan**

Add progress/decision-log entries for:
- source tabs above search
- shadcn accordion conversion
- salary + score histograms
- filters accordion below widgets
- sort moving to results header
- removing max salary and standalone Filters button

**Step 2: Save the design and implementation plan**

Ensure both files exist under `docs/plans/`.

**Step 3: Verify file presence**

Run: `ls docs/plans | rg '2026-03-18-jobs-histogram-filters'`
Expected: both files listed

### Task 2: Add failing logic tests for histogram filtering

**Files:**
- Modify: `test/review-jobs-react-logic.test.js`
- Modify: `src/review/web/src/features/jobs/logic.js`

**Step 1: Write failing tests**

Cover:
- salary histogram bucket generation with min/max/counts
- score histogram bucket generation with min/max/counts
- histogram range selection becoming active filter chips
- removal of max-salary post-search behavior from active filters

**Step 2: Run targeted tests and verify failure**

Run: `node --test test/review-jobs-react-logic.test.js`
Expected: fail on missing histogram helpers/behavior

**Step 3: Implement minimal helpers**

Add pure helpers for:
- bucket generation from numeric series
- salary histogram metadata
- score histogram metadata
- active chip generation for selected histogram range(s)

**Step 4: Re-run targeted tests**

Run: `node --test test/review-jobs-react-logic.test.js`
Expected: pass

### Task 3: Add accordion primitive support

**Files:**
- Modify: `package.json`
- Create: `src/review/web/src/components/ui/accordion.jsx`

**Step 1: Add dependency if needed**

Use `@radix-ui/react-accordion` if not already present.

**Step 2: Add shadcn-style accordion wrapper**

Create a reusable accordion primitive matching the existing UI component approach.

**Step 3: Verify build catches import errors**

Run: `npm run dashboard:web:build`
Expected: pass

### Task 4: Rebuild the Jobs search surface

**Files:**
- Modify: `src/review/web/src/App.jsx`

**Step 1: Attach Job sources tabs above the search composer**

Use the established attached-tab pattern from Searches.

**Step 2: Replace custom collapse buttons with accordion triggers**

Apply to:
- Hard filter
- Additional keywords

**Step 3: Remove standalone Filters button and Max salary filter**

Delete those UI elements and their state wiring.

**Step 4: Add a Filters accordion below widgets**

Place salary + score histogram filters and existing post-search filter controls there.

**Step 5: Move Sort into Results header**

Ensure sort remains functional but is visually grouped with Results.

### Task 5: Add histogram UI components in Jobs page

**Files:**
- Modify: `src/review/web/src/App.jsx`
- Optionally create: `src/review/web/src/features/jobs/histogram-filter.jsx`

**Step 1: Build salary histogram filter**

Show distribution bars, range labels, and active selection state.

**Step 2: Build score histogram filter**

Reuse the same component/system with score data.

**Step 3: Wire both into the canonical active-chip state**

Ensure filter changes narrow results and emit chip labels consistently.

### Task 6: Verification and evidence

**Files:**
- Modify: `scripts/playwright-jobs-flow-smoke.js`
- Add/refresh: `docs/roadmap/progress-merge/2026-03-18-jobs-histogram-filters-*`
- Modify: `docs/learnings.md` if new UI/QA lessons arise

**Step 1: Run targeted tests**

Run: `node --test test/review-jobs-react-logic.test.js test/dashboard-api-contract.test.js`
Expected: pass

**Step 2: Run build and full suite**

Run:
- `npm run dashboard:web:build`
- `npm test`
Expected: pass

**Step 3: Run Jobs smoke**

Run: `node scripts/playwright-jobs-flow-smoke.js --mode react --artifact-prefix 2026-03-18-jobs-histogram-filters --output-dir docs/roadmap/progress-merge --port 4518`
Expected: pass with updated screenshot/log/json artifacts

**Step 4: Update ExecPlan outcomes**

Record what changed and verification evidence.
