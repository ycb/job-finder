# Learnings

As of 2026-03-06.

## Search-Driven Scoring Scope

- Current product scope: scoring is derived from `search-criteria.json`, not from goals/profile files.
- When scoring from search criteria, only use these inputs: `title`, `keywords`, `location`, `minSalary`, `datePosted`.
- Do not blend in profile preferences, historical-learning boosts/penalties, source bonuses, or data-confidence penalties unless explicitly re-approved.
- If results look incoherent, first verify that score denominators and weights map directly to configured criteria fields.

## Playwright MCP Session Discipline

- Signal: `MCP client "unknown" connected.` means the extension bridge is ready.
- After that signal, immediately run page actions (`browser_navigate`, `browser_snapshot`, `browser_click`) and do not re-initialize Playwright.
- Anti-pattern to avoid: repeatedly calling `browser_install`/`browser_close` while debugging. This bounces context back to the extension page and drops the active app tab.
- Debug loop to follow:
  1. `browser_navigate` to target URL once.
  2. `browser_snapshot` to get refs.
  3. Interact (`browser_click`, `browser_type`, etc.).
  4. Re-snapshot after DOM/navigation changes.
- If the current page unexpectedly shows only the extension success screen:
  1. `browser_tabs` with `action="list"`.
  2. If app tab exists, `browser_tabs` with `action="select"` and that index.
  3. If no app tab exists, do one recovery navigate to target URL (no install/re-init loop).
- Only use `browser_install` when there is an explicit browser-not-installed error.
- In this environment, commands can reconnect to the extension page between calls. Reliable workaround:
  1. Use one `browser_run_code` call for multi-step validation (`goto` + interaction + assertions) when possible.
  2. Otherwise, re-run `browser_navigate` to the app URL immediately before each interaction command.

## Data Quality Planning Precision

- When proposing cross-source data contracts, include user-critical fields (`salary`, `location`) immediately with explicit placeholder semantics (for example `unknown`) instead of downgrading them out of the required set.
- Do not include disabled sources in “current-state” quality analysis unless the user asks for projected analysis; label them as out-of-scope for the snapshot.
- Sequence planning as parser-hardening first, then final schema/threshold commitments. Data-structure decisions should be based on measured parser output, not inferred capability.

## Multi-Agent Phase Execution

- When organizing lane-based work with `git worktree`, this environment may require escalated permissions for branch/ref lock writes. First failure should trigger immediate escalation request instead of repeated local retries.
- A phase tracker alone is insufficient for multi-agent control. Add a dispatch board with:
  - active task state
  - lane/worktree mapping
  - required review gate order (`implementer -> spec -> quality`)
- Task packets that are copy/paste-ready reduce controller overhead and keep subagent runs spec-anchored without extra context fetches.

## Worktree Handoff Discipline

- When the user switches execution to a new worktree/lane mid-thread, immediately re-read that worktree’s `AGENTS.md`, confirm branch/worktree context with `git status`, and re-anchor plan/docs in the active workspace before continuing implementation.
