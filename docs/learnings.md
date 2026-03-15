# Learnings

As of 2026-03-06.

## Onboarding Integration Rebase Hygiene

- After rebasing a branch that introduces new runtime deps (for example Ink/React CLI UI), run `npm install` before interpreting CLI smoke failures. Missing-module errors can mask real behavior regressions.
- Resolve large conflict blocks in `src/review/server.js` with deterministic chunk rules and immediate `node -c` verification after each pass. Broad regex replacements can corrupt unrelated blocks that share repeated tokens.
- During manual QA, bind review-server runs to an explicit port to avoid accidentally validating another running worktree instance.

## Search-Driven Scoring Scope

- Current product scope: scoring is derived from `source-criteria.json` (with legacy fallback to `search-criteria.json`), not from goals/profile files.
- When scoring from search criteria, only use these inputs: `title`, `keywords`, `location`, `minSalary`, `datePosted`.
- Do not blend in profile preferences, historical-learning boosts/penalties, source bonuses, or data-confidence penalties unless explicitly re-approved.
- If results look incoherent, first verify that score denominators and weights map directly to configured criteria fields.

## Config Boundary Clarity

- Keep config responsibilities distinct:
  - `config/profile.json`: candidate/profile content only (not source search criteria).
  - `config/source-criteria.json`: canonical search intent inputs used for URL construction + scoring.
  - `config/sources.json`: source enablement in library-map mode (`sourceId -> true/false`) by default.
- Preserve backward compatibility during migrations:
  - accept legacy `search-criteria.json` as fallback.
  - accept legacy `sources` array mode, but treat map mode as canonical for onboarding and first-run flows.
- First-run UX should not require manual config copy. Missing `sources.json` should bootstrap safely.

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

## CLI Smoke Coverage

- Add at least one smoke test that runs `node src/cli.js help` (or similar) from a real subprocess.
- Reason: unit tests can stay green while CLI entrypoint imports break (for example, missing module paths not exercised by pure unit tests).
- This catches startup-time regressions before users hit command failures in first-run onboarding.

## Config Example Integrity

- Treat `config/*.example.json` files as executable onboarding artifacts, not static docs.
- Add a test that parses every `*.example.json` file to catch syntax regressions early.
- Reason: malformed example JSON can block first-run dashboard loading even when core logic is correct.

## UX Quality Bar for Onboarding

- Functional onboarding is not sufficient; onboarding is a core product surface and requires a dedicated UX/design pass.
- Before shipping onboarding UI changes, apply the UX/design/microinteraction skill pack and verify hierarchy, CTA clarity, and auth-state affordances.
- Include explicit first-run guidance copy and stateful success/failure feedback in-product, not only in docs.

## Onboarding State Semantics

- Distinguish temporary UI selection from persisted runtime enablement.
- Persist only what drives ingestion (`enabled sources`), not a second "selected searches" model that can drift.
- When auth verification fails, keep source disabled and communicate retry, but avoid storing it as an enabled/personalized search.

## Source Library Label Integrity

- In `config/sources.json` map mode, treat entries as enablement-only (`sourceId -> boolean` or `{ enabled }`).
- Do not allow legacy per-source map overrides (e.g., `name`, `searchUrl`) to mutate canonical source-library labels.
- Reason: old manual-search metadata can leak into onboarding and make source enablement look like saved custom searches.

## Consent Capture Timing

- Legal/operational consent should be captured during CLI `init` (first-run), not deferred to dashboard-only onboarding.
- Require explicit opt-in for ToS risk and rate-limit responsibility before continuing initialization.
- Provide non-interactive consent flags for scripted installs to keep automation deterministic.

## Onboarding Surface Ownership

- When a setup field is moved to CLI ownership (for example install channel), remove the duplicate control from dashboard onboarding to avoid conflicting sources of truth.
- Dashboard onboarding should only expose preferences that remain editable post-install (for example analytics toggle), and copy should point to CLI where appropriate.

## CLI Design Compliance

- `jf init` UX must follow terminal-native interaction principles:
  - no "open this file in your editor" instructions for legal review;
  - show clickable local doc links (OSC 8 fallback-safe) for `TERMS.md` and `PRIVACY.md`;
  - use guided interactive controls for selection steps rather than raw argument dumps.
- Keep non-interactive behavior explicit and strict:
  - require legal acceptance flags;
  - return exit code `2` for misuse/invalid combinations.
- Do not rely solely on hyperlink capability auto-detection libraries for legal links; emit OSC 8 sequences directly in TTY mode.
- In interactive `jf init`, legal doc lines must render as OSC 8 links only (no visible fallback URLs/paths) to preserve a clean click-to-open UX.
- For Ink link UX, follow Ink docs and use `ink-link` rather than ad-hoc text transforms. The npm `ink` package readme references an `/examples` directory, but examples are not included in the published package, so use readme guidance + the `ink-link` component contract directly.
- Terminal.app compatibility: even with OSC8 bytes emitted, click behavior may be unavailable for anchors in the default macOS Terminal stack. For this audience, render visible `http://127.0.0.1:<port>/...` links for legal docs so auto-link detection provides click-to-open behavior.

## Legal Consent Ownership

- For this product/audience, legal acceptance should be dashboard-owned (UI Step 1), not CLI-owned.
- Keep CLI `jf init` focused on install channel + analytics; move policy review/acceptance to Searches onboarding where link behavior and consent UX are reliable.
- Gate all onboarding source actions (`save sources`, `verify`, `complete`) on accepted legal consent both in UI and server APIs.
- Legal consent should be a true interstitial gate before accessing the rest of the app, not a nested step users can bypass by switching tabs.

## Lean Init Output

- Keep `jf init` completion output to a single success line for this flow.
- Do not append extra summaries or immediate Y/N prompts after the Ink wizard; users interpreted post-exit prompt text as shell input and hit `command not found`.
- In `jf review`, do not lead with warning tone for empty queue on first-run onboarding, and always print a plain local URL string (`http://127.0.0.1:<port>`) instead of label-only links.
- In the final Ink confirm step, avoid repeating selected values if they were already shown in prior steps; keep confirm text minimal ("Ready to initialize" + Enter/Ctrl+C only).
- Ensure Ink teardown fully completes before returning to shell. If `waitUntilExit()` is skipped/raced, terminal input can leak escape sequences (`^[[...`) on subsequent interactions.
- For macOS Terminal.app, do not instruct Option-click for URLs. Option-click sends cursor movement escapes in foreground processes. Use `Command-click` guidance with plain URL output.

## Consent Interstitial Copy/Layout

- In legal consent checkboxes, wrap full sentence copy in a single inline span and keep links inline at the decision point.
- Avoid rendering loose text/link nodes in checkbox labels; this can create broken line flow and punctuation artifacts.
- When consent is a hard gate, render only the interstitial surface before acceptance (hide app shell header/tabs until consent is complete).
- Keep consent-gate messaging minimal: do not render a default success/info banner before user action; show status text only for explicit responses/errors.
- Avoid double-shell presentation in the consent gate (outer panel + inner card). Flatten the shell while gated so only one container is visible.
- Keep legal/risk consent copy short and neutral; avoid over-legalized phrasing when user-approved wording is provided.
- Do not trigger consent-gate re-render on checkbox `change`; only persist checkbox draft state and require explicit `Agree and Continue` action to advance.
- Consent is a true interstitial: while gate is active, do not render app navigation/tabs/content behind or around it. Render consent surface only, then reveal shell after acceptance.
- Keep consent interstitial flat: avoid nesting it inside a second outer app-shell container/card while gated.

## Source Auth State Model

- Use exactly three user-facing source states in setup:
  - green = ready
  - yellow = not authorized
  - grey = disabled
- Keep yellow strictly auth-related; do not reuse it for selector/page-structure issues.
- Keep auth checks and page-structure checks as separate pipelines and separate user messages.
- In Step 1 copy, avoid redundant headers/subheaders and avoid default explanatory filler text for no-auth rows; keep labels single-purpose and terse.
- Do not render persisted source-check `userMessage` notes for no-auth default rows; stale copy can reappear and conflict with the intended minimal setup UX.
- In onboarding, "Check access" must run a lightweight auth probe only (URL/authwall/sign-in detection), never the full capture/scroll/pagination pipeline.
- Show `Re-check` only after a prior failed auth check; do not show `Re-check` for sources already in `Ready` state.
- On auth probe in onboarding, close the temporary automation window after the check completes to avoid leftover Chrome windows.
- Keep Step 1 copy and containers minimal: avoid duplicate section labels, remove success-status callouts, and avoid secondary "next step" blocks that repeat Jobs CTA guidance.
- Source row actions should be consistent across auth/no-auth groups: use a shared overflow menu for disable actions, and avoid redundant post-auth "Open site" CTAs.
- Overflow is a standard top-right kebab pattern: no outlined button treatment, and it must stay in the same top-right meta rail as the status chip across all row variants.
- Prefer a shared row renderer for onboarding source lists; avoid separate one-off row implementations and remove supplementary note rows when state labels already communicate readiness.
- Use two source groups in setup: `Enabled (N)` and `Authentication Required`; once auth passes, the source should move into `Enabled` automatically and update the count.
- Render `Connect your sources` as its own top-level section on the Searches tab (below page tabs), not nested inside `My Job Searches`.
- Treat explicit source configuration as its own persisted state (`sourcesConfiguredAt`), separate from selected-count. Without this, first-run defaults can overwrite intentional disables (especially when the user disables all sources).

## QA Fresh-State

- Do not claim "new-user onboarding QA" from an existing dev worktree without a full state reset.
- Persisted files that must be reset for true first-run validation:
  - `data/user-settings.json` (consent/channel/check states),
  - `config/sources.json` (enabled/disabled source map),
  - `data/captures/*` (prior capture files can make auth/setup appear already ready),
  - optionally `data/jobs.db` and `data/refresh-state.json` for clean run/cooldown behavior.

## Searches UX Controls

- Scope operational controls to the relevant tab context: show `Search frequency` only in `Enabled`, not `Disabled`.
- In the Searches table, `enabled=false` must take precedence over capture/refresh signals in status presentation. Disabled rows should render `disabled`, muted tone, and disabled refresh copy (never `ready`).
- After React refactors, run a production build and load-path sanity check for table helpers (`formatRelativeTimestamp` etc.); missing imports can pass unit tests but still white-screen at runtime.
- Keep the Searches `Actions` column non-wrapping with a minimum width and right-aligned controls; wrapping CTA + overflow into a narrow cell creates compressed/touch-hostile UI.
- Preserve action hierarchy in table design: primary CTA belongs in the `Action` column, overflow belongs in a dedicated `More` column/module to avoid mixed semantics and crowded controls.
- In dense tables, keep `Action/More` columns compact (`w-*` + reduced cell padding) and prefer opening overflow menus upward to avoid overlapping the next row's CTA hit area.
- If overflow overlap is acceptable, open the menu sideways/overlaying the row action region rather than between rows; this avoids visual competition from two simultaneous row CTAs.
- Keep table header alignment consistent by default; if action cells are right-aligned for affordance, don't force just one header label right unless the full header row follows that pattern.
- Keep primary CTA alignment consistent with column reading flow: when table headers are left-aligned, left-align row CTAs unless there is an explicit right-aligned action pattern across the full table.
- In tall rows with multiline status content, keep compact control columns (`...`) on `align-middle` so icon actions stay visually centered with primary row actions.
- In Disabled tab rows, do not render overflow placeholders (`—`) in the overflow column; keep the cell empty so disabled rows clearly expose only the primary `Enable` action.
- Totals rows must have a dedicated non-hover visual style (own background + fixed hover state), never the same tonal treatment as interactive row hover.
- For dense dashboard cards, move persistent controls (like `Search frequency`) into the card header rail aligned with the title to reduce vertical dead space above the table.
- Keep table rows scannable with one primary status value in-cell; push secondary diagnostics (refresh context, run delta, formatter notes) into an on-demand hover/click popover.
- For custom popovers/tooltips, do not combine browser-native `title` with custom overlays; it creates double-tooltips and visual noise.
- Do not surface cache internals in user-facing status labels. Cache behavior is controlled by the toggle; status UI should stay focused on readiness/attention only.
- Treat "z-index-looking" overlay bugs in the React UI as potential token/class mismatches first (for example `bg-popover` without a defined `popover` token can render transparent and mimic stacking issues).
- When defaulting users to `Enabled` for orientation, add concise guidance that points to `Disabled` for auth-required enablement.
- In `Disabled`, `Enable` must be a prominent primary row action; do not hide primary source actions inside overflow.
- Remove overflow menus from `Disabled` rows entirely to reduce duplicate affordances; keep overflow for `Enabled` row secondary actions only.
- For auth-required source enablement, enforce one-source-at-a-time with a guided modal flow (`Open source` -> user signs in -> `I'm logged in` auth probe).
- Use explicit positive-success copy in auth modals: `Success! <Source> is now enabled.` instead of vague readiness text.
- Orientation guidance should use a true toast pattern: fixed top-right, animated entrance from the right, non-blocking with explicit CTA + dismiss.
- For row-level status diagnostics, use on-demand toasts instead of persistent inline sub-status blocks/popovers so the primary status cell stays scannable.
- For onboarding orientation toasts, use standard shadcn toast primitives (`Toaster` + `ToastAction`) and avoid one-off custom toast containers/styles.
- Surface only actionable status issues to users (currently auth-required). Route formatter/schema drift diagnostics to internal alerts instead of user-facing row details.

## Dispatch and QA Commit Discipline

- Never hand off QA instructions assuming code is available in downstream worktrees until the fix is committed and pushed (or explicit local-only scope is stated).
- Before giving QA refresh commands, verify upstream commit presence with `git log -n 1` and branch sync with `git status --short --branch`.
- In worker packets, explicitly state planning-file precedence (`PROCESS.md` + `PLANS.md` + repo `AGENTS.md`) and ban `tasks/todo.md` for feature ExecPlans to avoid instruction-layer ambiguity.

## Dashboard Smoke Harness Reliability

- A dual-mode smoke harness must assert mode-specific render markers, not just command success + screenshots. Otherwise `react` mode can silently fall back to legacy and still pass.
- Smoke tooling must use deterministic local dependencies (project-pinned `playwright`) instead of ambient `npx` package resolution.
- For dashboard mode proof, persist explicit evidence in smoke logs (for example `ui_mode_check=pass` + root page title).
- For manual QA on local runtime (`/Users/admin/job-finder`), always sync that repo to `origin/main` immediately before launch; pushing from a worktree does not update the separate local runtime checkout automatically.
- Use a single QA launch command (`npm run review:main:follow`) as source of truth; avoid mixing `git checkout/pull/review` ad-hoc steps that can leave stale commit + live server combinations.
- Do not merge to `main` before stakeholder QA approval. QA should run from a QA branch that tracks the feature branch; merge to `main` only after explicit sign-off.
- Avoid fixed-port QA startup (`node src/cli.js review`) in docs/instructions; use scripts that auto-pick an open port and print the active URL to prevent recurring `EADDRINUSE` confusion.
- For cross-worktree collaboration, Cmd-R reflects local changes only. If another worktree is producing commits, QA must run an auto-follow mode (`review:follow`) or explicit pulls to avoid stale UI confusion.
- QA startup friction should be one-time per machine, not per branch. Prefer an always-on local review agent that follows the current branch/upstream and serves a fixed URL for Cmd-R.
