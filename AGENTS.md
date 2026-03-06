See `/Users/admin/job-finder/PROCESS.md` for the full engineering workflow and quality bar.

## Workflow Orchestration

### 0. Scope Split (Bugfix vs Feature)

- **Bugfix**: Existing behavior is broken and a repro exists. Default: fix immediately, without a pre-implementation check-in.
- **Feature**: New behavior, architecture change, or non-trivial work (3+ steps). You **must** create/update an ExecPlan first and check in before implementation.
- **Always requires check-in first**: destructive operations, risky migrations, security/privacy-sensitive changes, or unclear requirements.

### 1. Plan Mode Default

Enter planning mode for any non-trivial work. If implementation drifts from plan or new constraints appear, stop and re-plan before continuing. Use planning mode for verification steps, not only build steps.

### 2. Subagent Strategy

Use subagents when tasks can be explored independently. Keep one focused track per subagent and synthesize results in the main thread before editing.

### 3. Self-Improvement Loop

After corrections from the user, update `/Users/admin/job-finder/docs/learnings.md` with the pattern and prevention rule. Re-read relevant learnings at session start.

### 4. Verification Before Done

Never mark work complete without proof. Run tests, compare behavior before/after when relevant, and include concrete evidence in the final summary.

### 5. Demand Elegance (Balanced)

For non-trivial changes, pause and ask whether there is a simpler, more robust path. Avoid over-engineering for straightforward fixes.

### 6. Autonomous Bug Fixing

When given a bug report, reproduce it and fix it directly. Do not ask for hand-holding or pre-implementation check-in unless the work matches an "Always requires check-in first" condition.

## Execution Flow

1. Classify work as bugfix or feature.
2. Bugfix path: reproduce, implement, verify, summarize evidence.
3. Feature path: author/update ExecPlan per `/Users/admin/job-finder/PLANS.md`, check in, then implement. For non-trivial feature work, an ExecPlan is mandatory.
4. Track active steps in planning mode; keep ExecPlan `Progress` current for feature work.
5. Update `/Users/admin/job-finder/docs/learnings.md` when corrections reveal a reusable process lesson.

## Design Skill Pack (Draft)

For frontend and UX work, use:

- `/Users/admin/job-finder/.codex/skills/ux-flow-content/SKILL.md`
- `/Users/admin/job-finder/.codex/skills/design-system-ui/SKILL.md`
- `/Users/admin/job-finder/.codex/skills/microinteractions-motion/SKILL.md`

## Core Principles

**Simplicity First**: Keep changes minimal and clear.  
**No Laziness**: Fix root causes, not symptoms.  
**Minimal Impact**: Touch only what is necessary and verify no regressions.
