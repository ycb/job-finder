# Phase 1.1 Closeout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the remaining Phase 1 MVP items (`W2-01`..`W2-04`) with verifiable evidence and zero blocked tracker items.

**Architecture:** Extend existing sync/evaluation and dashboard flows incrementally: first add full-JD evaluation evidence plumbing, then complete search-controls schema/UI, then add run-delta persistence/surfacing, and finally close source-level full-JD gates with explicit quality metrics.

**Tech Stack:** Node.js, SQLite (`better-sqlite3`), vanilla dashboard server (`src/review/server.js`), Playwright smoke checks, Node test runner.

---

### Task 1: W2-01 Full-JD Evaluation Pass + Fallback Evidence

**Files:**
- Modify: `src/jobs/score.js`
- Modify: `src/jobs/repository.js`
- Modify: `src/db/migrations.js`
- Modify: `src/cli.js`
- Modify: `src/review/server.js`
- Test: `test/score-search-criteria.test.js`
- Test: `test/hard-filter.test.js`
- Create test: `test/full-jd-evaluation-pass.test.js`

**Steps:**
1. Add failing tests for detail-success and snippet-fallback evidence paths.
2. Add minimal evaluation metadata persistence for `contentPathUsed`, `detailFetchStatus`, and rationale fields.
3. Wire evaluation pipeline to rerun keyword/required-term checks against full JD when detail is available.
4. Keep deterministic snippet fallback behavior with explicit marker in metadata.
5. Run targeted tests, then full `npm test`.

### Task 2: W2-03 Search Controls Completion (`AND`/`OR`, include/exclude)

**Files:**
- Modify: `src/config/schema.js`
- Modify: `src/config/load-config.js`
- Modify: `src/review/server.js`
- Modify: `src/jobs/score.js`
- Modify: `src/sources/search-url-builder.js`
- Test: `test/search-criteria-config.test.js`
- Test: `test/score-search-criteria.test.js`
- Create test: `test/search-controls-and-or-include-exclude.test.js`

**Steps:**
1. Add failing tests for new criteria fields and semantics.
2. Extend search criteria model with `keywordMode`, `includeTerms`, `excludeTerms`.
3. Update scoring/filtering to honor new fields consistently.
4. Update dashboard API/UI forms and summaries to expose controls clearly.
5. Run targeted tests, Playwright dashboard smoke, then full `npm test`.

### Task 3: W2-04 Net-New/Refresh Delta Persistence + UI Surfacing

**Files:**
- Modify: `src/db/migrations.js`
- Modify: `src/jobs/repository.js`
- Modify: `src/cli.js`
- Modify: `src/review/server.js`
- Create: `src/jobs/run-deltas.js`
- Create test: `test/run-deltas.test.js`
- Test: `test/dashboard-refresh-status.test.js`

**Steps:**
1. Add failing tests for `new`/`updated`/`unchanged` delta classification.
2. Add lightweight run-history/delta persistence model.
3. Compute deltas in sync path and store per-run counters.
4. Surface counters in dashboard and sync feedback text.
5. Run targeted tests, Playwright dashboard smoke, then full `npm test`.

### Task 4: W2-02 Full-JD Gap Closure Gates

**Files:**
- Modify: `src/sources/source-contracts.js`
- Modify: `src/sources/source-health.js`
- Modify: `src/sources/detail-enrichment.js`
- Modify: `src/review/server.js`
- Create test: `test/full-jd-detail-coverage-gate.test.js`
- Update docs: `docs/backlog-specs/p0-source-full-jd-gap-closure.md`

**Steps:**
1. Add failing tests for detail-description provenance coverage calculation.
2. Add `% description from detail` rolling metric.
3. Add gate behavior and exception handling path.
4. Surface source-level coverage in dashboard and contract outputs.
5. Run targeted tests, `node src/cli.js check-source-contracts --window 3 --min-coverage 0.7`, Playwright smoke (if UI changed), then full `npm test`.

### Task 5: Tracker and Evidence Closeout

**Files:**
- Modify: `docs/backlog.md`
- Modify: `docs/roadmap/phase-1-execution-tracker.md`
- Modify: `docs/roadmap/phase-1-dispatch-board.md`
- Create/update: `docs/roadmap/progress-merge/YYYY-MM-DD-<sha>.md`
- Create/update: `docs/roadmap/progress-daily/YYYY-MM-DD.md`

**Steps:**
1. Update statuses only after evidence is attached.
2. Record command outputs and Playwright artifact paths in merge updates.
3. Move completed items to backlog completed section.
4. Recompute tracker snapshot counts and dependency notes.
