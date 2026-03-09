# Phase 1 Multi-Agent Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish and run a controlled multi-agent execution loop for Phase 1 MVP work with explicit worktree isolation, review gates, and progress/retro artifacts.

**Architecture:** One controller agent manages prioritized queue progression while implementation happens in lane-isolated worktrees. Each task must pass two review gates (spec compliance then code quality) before tracker/status updates and merge prep.

**Tech Stack:** Git worktrees, Node test runner (`node --test` via `npm test`), roadmap artifacts in `docs/roadmap/*`, backlog/spec docs.

---

### Task 1: Build Controller Artifacts

**Files:**
- Create: `docs/roadmap/phase-1-dispatch-board.md`
- Modify: `docs/roadmap/phase-1-execution-tracker.md`
- Modify: `docs/docs-registry.md`

**Step 1: Create dispatch board with lane map + queue**

Define:
- lane names
- worktree/branch mapping
- Wave 1 prioritized queue
- per-task controller checklist

**Step 2: Link dispatch board in tracker**

Update tracker with:
- reference to dispatch board
- explicit gate order (`implementer -> spec -> quality`)

**Step 3: Register artifact in docs registry**

Add `docs/roadmap/phase-1-dispatch-board.md` with audience/purpose/trigger.

**Step 4: Verify docs are present**

Run: `rg -n "phase-1-dispatch-board|gate order|Wave 1" docs/roadmap docs/docs-registry.md`
Expected: matches from board/tracker/registry.

**Step 5: Commit**

```bash
git add docs/roadmap/phase-1-dispatch-board.md docs/roadmap/phase-1-execution-tracker.md docs/docs-registry.md
git commit -m "docs: add phase 1 dispatch board and tracker links"
```

### Task 2: Establish and Verify Lane Worktrees

**Files:**
- Modify: `docs/roadmap/phase-1-dispatch-board.md`
- Modify: `docs/roadmap/phase-1-execution-tracker.md`

**Step 1: Create lane branches/worktrees**

Run:
- `git worktree add .codex/worktrees/phase1-safety-boundary -b codex/phase1-lane-safety-boundary`
- `git worktree add .codex/worktrees/phase1-source-contracts -b codex/phase1-lane-source-contracts`
- `git worktree add .codex/worktrees/phase1-criteria-fidelity -b codex/phase1-lane-criteria-fidelity`
- `git worktree add .codex/worktrees/phase1-operations-metrics -b codex/phase1-lane-operations-metrics`

**Step 2: Baseline verification**

Run in at least one new lane worktree:
- `npm test`

Expected:
- exit code `0`
- explicit pass/fail counts captured in dispatch board notes

**Step 3: Record verification evidence**

Update dispatch board:
- baseline test command
- summarized result counts
- commit hash baseline

**Step 4: Commit**

```bash
git add docs/roadmap/phase-1-dispatch-board.md docs/roadmap/phase-1-execution-tracker.md
git commit -m "docs: record lane worktrees and baseline verification"
```

### Task 3: Create Task Packets for Subagent Dispatch

**Files:**
- Create: `docs/roadmap/task-packets/2026-03-08-phase1-wave1.md`
- Modify: `docs/docs-registry.md`

**Step 1: Create Wave 1 task packet file**

For each `W1-01` to `W1-08`, include:
- task objective
- acceptance criteria
- required tests/verification command
- exact worktree path
- dependency notes

**Step 2: Ensure packets are copy/paste-ready**

Each task packet must include full requirement text so controller does not ask implementer to read plan/spec files.

**Step 3: Register packet artifact**

Add task packet file in `docs/docs-registry.md`.

**Step 4: Verify packet completeness**

Run:
- `rg -n "^## W1-0[1-8]" docs/roadmap/task-packets/2026-03-08-phase1-wave1.md`

Expected: 8 task sections found.

**Step 5: Commit**

```bash
git add docs/roadmap/task-packets/2026-03-08-phase1-wave1.md docs/docs-registry.md
git commit -m "docs: add phase 1 wave 1 subagent task packets"
```

### Task 4: Wire Retro and Learning Loop Into Execution

**Files:**
- Create: `docs/roadmap/retros/2026-03-08.md`
- Modify: `docs/learnings.md`
- Modify: `docs/roadmap/decision-log.md`

**Step 1: Write retro note using virtual-retro format**

Include for each learning:
- signal
- root_cause
- action
- owner
- target_window
- status

**Step 2: Persist durable learnings**

Append high-signal process learnings to `docs/learnings.md`.

**Step 3: Log orchestration decision**

Add autonomous decision log entry for multi-agent Phase 1 execution structure.

**Step 4: Verify persistence**

Run:
- `rg -n "Phase 1|multi-agent|worktree|retro" docs/roadmap/retros docs/learnings.md docs/roadmap/decision-log.md`

Expected: all three files contain new entries.

**Step 5: Commit**

```bash
git add docs/roadmap/retros/2026-03-08.md docs/learnings.md docs/roadmap/decision-log.md
git commit -m "docs: wire phase 1 retro and learning loop"
```

### Task 5: Start Active Dispatch Tracking

**Files:**
- Modify: `docs/roadmap/phase-1-execution-tracker.md`
- Modify: `docs/roadmap/progress-daily/2026-03-08.md`

**Step 1: Add active dispatch section**

In tracker, add:
- `current_task`
- `lane`
- `implementer_status`
- `spec_review_status`
- `code_quality_status`

**Step 2: Initialize current task**

Set current task to `W1-01` with status `ready to dispatch`.

**Step 3: Update daily progress note**

Add note that execution moved from kickoff-only to active dispatch tracking.

**Step 4: Verify visibility**

Run:
- `rg -n "current_task|W1-01|active dispatch" docs/roadmap/phase-1-execution-tracker.md docs/roadmap/progress-daily/2026-03-08.md`

Expected: tracker and daily artifact both show active execution state.

**Step 5: Commit**

```bash
git add docs/roadmap/phase-1-execution-tracker.md docs/roadmap/progress-daily/2026-03-08.md
git commit -m "docs: initialize active phase 1 dispatch tracking"
```

### Task 6: Final Verification and Branch Completion Readiness

**Files:**
- Modify: `docs/roadmap/phase-1-dispatch-board.md` (if needed for fixes)
- Modify: `docs/plans/2026-03-08-phase-1-multi-agent-orchestration-execplan.md` (if corrections needed)

**Step 1: Run verification-before-completion checks**

Run:
- `git status --short`
- `git worktree list`
- `rg -n "Phase 1|Wave 1|dispatch|worktree|retro" docs/roadmap docs/plans/2026-03-08-phase-1-multi-agent-orchestration-execplan.md`

**Step 2: Ensure claims match evidence**

Confirm:
- worktrees exist
- artifacts exist
- tracker and daily notes reflect active status

**Step 3: Request final code review**

Use `superpowers:requesting-code-review` pattern for full-doc diff range.

**Step 4: Address any review findings**

Fix and re-run verification commands.

**Step 5: Prepare for finishing branch flow**

Use `superpowers:finishing-a-development-branch` after reviews pass.
