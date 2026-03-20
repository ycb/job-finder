# Jobs Search, Sources, and Salary Filter Refinement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Inline search and source management on the Jobs page, remove the modal path, simplify salary filtering, and de-scope score histogram from MVP UI.

**Architecture:** Reuse existing Jobs and Searches data already present in `/api/dashboard`, but collapse them into a single page-level tab state. Keep score histogram logic available in code/spec if needed later, but remove it from the current UI hierarchy. Simplify the salary filter card so its information density matches its actual value.

**Tech Stack:** React, Tailwind, shadcn-style primitives, Radix accordion/slider/tabs, existing Jobs logic helpers, Node test runner, Playwright smoke.

---

### Task 1: Update planning artifacts

**Files:**
- Modify: `docs/plans/2026-03-12-jobs-react-migration-execplan.md`
- Create: `docs/plans/2026-03-19-jobs-search-sources-salary-design.md`
- Create: `docs/plans/2026-03-19-jobs-search-sources-salary-implementation-plan.md`

**Step 1: Record the approved refinement scope**

Capture:
- Search / Ready / Disabled inline tabs
- remove searches modal from Jobs flow
- de-scope score histogram from MVP UI
- simplify salary card
- quiet sort control
- standard shadcn accordion trigger affordance

**Step 2: Verify plan files exist**

Run: `ls docs/plans | rg '2026-03-19-jobs-search-sources-salary'`
Expected: both files listed

### Task 2: Add failing tests for salary range/supporting logic

**Files:**
- Modify: `test/review-jobs-react-logic.test.js`
- Modify: `src/review/web/src/features/jobs/logic.js`

**Step 1: Add/adjust failing tests**

Cover:
- exact salary range counts
- score histogram remains available in logic without being required in UI
- active chip generation remains correct after UI simplification

**Step 2: Run targeted tests and verify failures**

Run: `node --test test/review-jobs-react-logic.test.js`
Expected: fail on missing/refined helpers

**Step 3: Implement minimal helper changes**

Add or refine pure helpers only as needed.

**Step 4: Re-run targeted tests**

Run: `node --test test/review-jobs-react-logic.test.js`
Expected: pass

### Task 3: Normalize accordion trigger affordance

**Files:**
- Modify: `src/review/web/src/components/ui/accordion.jsx`

**Step 1: Replace bespoke triangle/copy treatment**

Use a standard shadcn-style chevron-down trigger affordance with no `Expand`/`Collapse` copy.

**Step 2: Run build**

Run: `npm run dashboard:web:build`
Expected: pass

### Task 4: Inline Search / Ready / Disabled surface

**Files:**
- Modify: `src/review/web/src/App.jsx`

**Step 1: Add a three-tab state for the first Jobs surface**

Tabs:
- `Search`
- `Ready (n)`
- `Disabled (n)`

**Step 2: Render content inline**

- `Search` renders composer + advanced controls
- `Ready` renders enabled source table inline
- `Disabled` renders disabled/auth-required source table inline

**Step 3: Remove modal-only searches path**

Delete the Jobs-page searches modal and route welcome toast CTA to the `Disabled` tab.

### Task 5: Simplify salary filtering and de-scope score histogram

**Files:**
- Modify: `src/review/web/src/App.jsx`

**Step 1: Remove score histogram from MVP UI**

Keep sort-by-score and best-match flows unchanged.

**Step 2: Simplify salary card**

Keep only:
- salary title
- with-salary / missing-salary local control
- histogram
- slider
- minimum / maximum display-input controls

Remove:
- `Distributions` title
- helper copy
- redundant summary outputs

**Step 3: Keep salary filter chip integration**

Ensure salary selection still narrows results and emits one shared active chip.

### Task 6: Quiet filters and sort hierarchy

**Files:**
- Modify: `src/review/web/src/App.jsx`

**Step 1: Remove separate Filters button**

Keep filters in the accordion below widgets.

**Step 2: Quiet the sort control**

Render in Results header as a lower-emphasis inline control:
- `Sort: Score`
- `Sort: Date posted`
- `Sort: Salary`

No asc/desc controls.

### Task 7: Verification and documentation

**Files:**
- Modify: `docs/learnings.md`
- Update evidence under: `docs/roadmap/progress-merge/`

**Step 1: Run targeted tests**

Run:
- `node --test test/review-jobs-react-logic.test.js`
- `node --test test/dashboard-api-contract.test.js test/entitlements.test.js test/onboarding-state.test.js`

Expected: pass

**Step 2: Run build and full suite**

Run:
- `npm run dashboard:web:build`
- `npm test`

Expected: pass

**Step 3: Run Jobs smoke**

Run:
- `node scripts/playwright-jobs-flow-smoke.js --mode react --artifact-prefix 2026-03-19-jobs-search-sources-salary --output-dir docs/roadmap/progress-merge --port 4518`

Expected: pass

**Step 4: Update ExecPlan outcomes**

Record:
- inline search/source tabs
- salary-only histogram
- removed modal path
- verification evidence
