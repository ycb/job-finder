# Levels.fyi Source Fix ExecPlan (2026-04-10)

## Summary
Restore Levels.fyi capture to match the live search (San Francisco Bay Area, Product Manager, AI, min $200k, past 3 days). The target is a capture count consistent with the live UI (≈59) and reliable diagnostics explaining any shortfall.

## Goals / Acceptance
- `capture-source-live levelsfyi-ai-pm` returns a count consistent with the live page for the same filters (≈59).
- `captureDiagnostics` shows the data path used (API vs DOM) and why.
- No regression to other browser-capture sources.

## Plan
1. **Reproduce with correct bridge**: Run live capture through the current worktree bridge, collect `captureDiagnostics`.
2. **Root cause**: Identify whether the failure is API decoding, DOM extraction, or scroll container selection.
3. **TDD**: Add a failing test that captures the root cause (decoder or DOM/scroll) before code changes.
4. **Fix**: Apply the minimal change required to pass the test and improve capture coverage.
5. **Verify**: Re-run live capture and relevant tests; document evidence.

## Progress
- [ ] Step 1: Reproduce with correct bridge and record diagnostics.
- [ ] Step 2: Identify root cause (API vs DOM vs scroll container).
- [ ] Step 3: Add failing test.
- [ ] Step 4: Implement minimal fix.
- [ ] Step 5: Verify and document evidence.

## Verification
- `node --test test/levelsfyi-dom-scripts.test.js`
- `JOB_FINDER_BROWSER_BRIDGE_URL=http://127.0.0.1:4321 node src/cli.js capture-source-live levelsfyi-ai-pm`
