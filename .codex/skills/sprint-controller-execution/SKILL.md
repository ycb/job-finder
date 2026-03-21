---
name: sprint-controller-execution
description: Use when running a multi-lane sprint from a controller branch and you need explicit rules for dispatch, rolling integration, push gates, QA handoff, and roadmap/reporting updates.
---

# Sprint Controller Execution

## Overview

This skill is the execution layer that sits between planning and implementation. Use it when parallel agents are building parts of a sprint and one controller branch is responsible for integrating, publishing, and proving the result.

## When to Use

Use this when:
- 2 or more worker lanes are active
- the controller branch must integrate returned work continuously
- QA depends on the controller branch being pushed
- roadmap, backlog, and progress artifacts must stay current during execution

Do not use this for a single-lane feature or a local-only spike.

## Core Rules

1. The controller branch is the only integration branch.
2. Returned lane work must be handled in the same cycle:
   - integrate
   - explicitly defer
   - re-scope
   - or reassign freed capacity
3. Never trust worker summaries without verifying:
   - `git status`
   - returned commit SHA
   - targeted tests
4. Do not call work QA-ready until the controller branch is pushed and has an upstream.
5. Roadmap artifacts are part of execution, not cleanup.

## Controller Loop

For each worker return:

1. Inspect the claimed files and commit.
2. Verify the branch state locally.
3. Run the smallest targeted test suite that proves the returned lane.
4. Decide immediately:
   - integrate now
   - defer with reason
   - re-task with tighter scope
   - close lane and recycle capacity
5. Update:
   - active ExecPlan
   - dispatch board
   - daily progress note
   - learnings if a new failure pattern appeared

## Push Gate

Before telling anyone to QA:

1. Ensure the controller branch is clean.
2. Ensure it has a meaningful integration commit history.
3. Push the branch and confirm upstream exists.
4. Record the push and QA target in roadmap reporting.
5. Then provide exact QA instructions.

If the branch is not pushed, it is not a real QA handoff.

## Required Artifacts

Each sprint must keep these current:
- `docs/plans/*execplan.md`
- `docs/roadmap/source-data-quality-dispatch-board.md` or equivalent dispatch board
- `docs/roadmap/progress-daily/<date>.md`
- `docs/roadmap/decision-log.md` when scope/launch decisions change
- `docs/learnings.md` after user corrections or process failures

## Lane Contract

Each worker lane must return:
- commit SHA
- files changed
- tests run
- blocker or `none`
- reusable artifact notes if the lane builds a new pattern

The controller must not accept a lane as complete until those claims are verified.

## QA Handoff

A good QA handoff includes:
- branch name
- commit SHA
- exact checkout command
- exact run command
- expected URL
- whether QA should use clean-state data or existing-user data

Do not tell the user to QA a local-only branch state they cannot reach.

## Common Mistakes

- Letting completed lanes sit idle without integration
- Reporting “parallel” while work is actually waiting on controller review
- Treating a local controller checkpoint as deployable
- Updating backlog/ExecPlan but skipping roadmap dispatch/progress artifacts
- Starting follow-on work before the current controller branch is published
