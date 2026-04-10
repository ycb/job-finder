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

## Source Query Parity

- Do not smuggle unrequested or unverified source-native filters into the generated URL just because the source currently supports them or an existing URL carried them.
- For parity debugging, the first comparison point is the user's manual baseline search. Preserve the core query semantics (`q` + `location`, or source equivalent) before layering on extra filters.
- If adding native filter params makes the source ignore or dilute the core query, move those filters back to `appliedPostCapture` until a verified native mapping exists.

## Direct Source Filter Mapping

- Do not assume a source lacks a URL strategy just because its `initialFilters` or SSR payload looks thin.
- Before concluding a source is "direct fetch only", inspect the live search URL shape and map the full supported filter/metadata surface explicitly.
- For new source adapters, build out the complete filter/metadata map first so adapter tests can prove which fields are applied in URL, which are preserved for review/import, and which remain unsupported.
- When a source exposes a canonical detail URL distinct from the search page, keep the canonical detail URL as the review target and treat search URLs as query builders only.
- Do not stop at the adapter. A source is not integrated until the shared query builder, criteria-accountability output, generic collection dispatch, and source contract all agree on the same truth.
- If a criterion is folded into generic text search, report it as supported-but-lossy in the contract/audit and mark it applied in runtime accountability. Do not call it unsupported just because the source lacks a dedicated filter chip.

## QA Handoff Discipline

- Prep QA immediately after a feature is built, tested, and delivered. Do not defer the QA handoff state to a later pass.
- QA prep means more than passing tests: update the active plan, roadmap daily note, docs registry, and any source-of-truth artifacts before asking for validation.
- If a table or dashboard is meant to be a source of truth, never mix lifetime metrics with latest-run metrics or silently coerce missing history to `0`. Prefer persisted cumulative accounting and render unavailable history explicitly.

## QA Fresh-State

- Do not claim "new-user onboarding QA" from an existing dev worktree without a full state reset.
- Persisted files that must be reset for true first-run validation:
  - `data/user-settings.json` (consent/channel/check states),
  - `config/sources.json` (enabled/disabled source map),
  - `data/captures/*` (prior capture files can make auth/setup appear already ready),
  - optionally `data/jobs.db` and `data/refresh-state.json` for clean run/cooldown behavior.

## AppleScript False-Repro Guardrail

- Do not treat an inline one-liner `execute javascript ... in active tab of front window` AppleScript snippet as a repro of our Chrome provider. That syntax is a known AppleScript grammar ambiguity and returns `-2740` even when the provider works.
- When validating AppleScript automation, use the same block-form `tell active tab of _window` structure as `src/browser-bridge/providers/chrome-applescript.js`.

## AppleScript Automation Permissions

- Chrome's `Allow JavaScript from Apple Events` is necessary but not sufficient for JobFinder automation.
- macOS Automation permissions must allow the host app (Codex/Terminal) to control Google Chrome.
- If AppleScript output includes `Connection Invalid` with `com.apple.hiservices-xpcservice` or parse errors like `-2740/-2741`, treat it as missing automation permission and prompt for the macOS toggle before debugging extraction logic.

## AppleScript JavaScript Syntax

- Do not use the compact one-liner form `execute javascript ... in active tab of front window`; it can trigger AppleScript parser errors (`-2740`) in Chrome’s dictionary.
- Always use the explicit block form with `tell active tab of _window` and `execute javascript "..."` to avoid grammar ambiguity.

## Browser Automation Respect

- When running live probes, open a brand-new Chrome window for each source and never reuse or hijack the user’s active window/session.
- If a source must be opened in a new window, treat that as a hard requirement and confirm any failure as a blocker rather than retrying in the existing window.

## Source Recency Semantics

- Treat "any time" as equivalent to "not set" in source recency mapping to avoid redundant paths.
- When a user provides explicit recency-to-coverage mapping, implement it verbatim before debating alternatives.

## QA Run Isolation

- Run live capture QA from the target checkout so capture files and config paths match what the user sees.

## Source Typeahead Tokens

- If a source uses typeahead-backed filters (e.g., YC location), the URL must use the exact canonical token returned by the typeahead, not a guessed abbreviation.

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

## Source QA Closeout Discipline

- When QA feedback spans multiple sources plus shared orchestration/accounting defects, stop handling issues piecemeal and create one closeout ExecPlan. Otherwise the team can "fix" individual sources while the shared run behavior remains misleading.
- Treat "fixed pending QA" as a real status for source work that has code/test evidence but has not yet been validated in a fresh end-to-end QA run. Do not promote those fixes to closed until the live run proves them.
- In `Disabled`, `Enable` must be a prominent primary row action; do not hide primary source actions inside overflow.
- Remove overflow menus from `Disabled` rows entirely to reduce duplicate affordances; keep overflow for `Enabled` row secondary actions only.
- For auth-required source enablement, enforce one-source-at-a-time with a guided modal flow (`Open source` -> user signs in -> `I'm logged in` auth probe).
- Use explicit positive-success copy in auth modals: `Success! <Source> is now enabled.` instead of vague readiness text.
- Orientation guidance should use a true toast pattern: fixed top-right, animated entrance from the right, non-blocking with explicit CTA + dismiss.
- For row-level status diagnostics, use on-demand toasts instead of persistent inline sub-status blocks/popovers so the primary status cell stays scannable.

## LinkedIn Capture Scope and Verification

- For LinkedIn MVP, summary-card data is sufficient for import. Do not let full JD extraction block capture stability work; keep full JD as a backlog enrichment item.
- When verifying browser-capture changes, make sure the browser bridge is running from the same checkout as the code under test. An already-running QA bridge can silently validate `/Users/admin/job-finder` while the controller worktree appears to be under test.
- If live verification is serviced by a different checkout, do not claim the controller implementation is live-verified. Call out the bridge/cwd ambiguity explicitly and either restart the bridge from the controller checkout or fold the branch into `qa/current` first.

## Crash Recovery and Dirty Worktrees

- After a crash during multi-lane work, do not assume newly dirty files are foreign edits. First reconcile the dirty paths against recent subagent notifications and the active controller plan.
- If the changed files match active subagent/controller scope, continue with review and verification instead of halting on a false "unexpected changes" branch.
- For onboarding orientation toasts, use standard shadcn toast primitives (`Toaster` + `ToastAction`) and avoid one-off custom toast containers/styles.
- Surface only actionable status issues to users (currently auth-required). Route formatter/schema drift diagnostics to internal alerts instead of user-facing row details.
- For search composer UX, support two states explicitly: pre-search (expanded controls) and post-search (collapsed orientation bar + chips for advanced constraints). Keep `Run search` scoped to the full composer, not nested inside one sub-module.
- In Jobs IA, preserve this ordering to match user mental model: view tabs -> widgets -> filters -> split pane results/detail.
- When the user asks for a standard shadcn interaction pattern (for example accordion), use the standard primitive instead of inventing a bespoke collapse treatment. Custom expand/collapse buttons drift visually and create unnecessary hierarchy noise.
- Do not duplicate search and filter semantics for the same attribute without a clear distinction. `Minimum salary` in the search composer and post-search salary narrowing serve different purposes; label and place them so the user can tell intent targeting from results filtering.
- Do not call a control a histogram unless it visibly shows the distribution, exposes concrete numeric ranges, and gives the user a direct way to set the active range. A row of nearly-flat bars with only min/max labels is not a usable filter.
- When using a shadcn pattern (for example accordion), match the standard affordance closely. Do not invent alternate trigger copy like `Expand`/`Collapse` or substitute non-standard chevrons when the user asked for the default interaction language.
- Do not over-instrument a filter widget. If the user can already read the active range from the slider bounds and input fields, avoid adding redundant summary blocks that compete with the control itself.
- Do not add redundant labels, helper chips, or nested headers that restate what the user can already see from the primary control. If a control already communicates the state, extra chrome is usually noise.
- Keep dense control regions physically compact. If secondary filters expand, they must open in an anchored panel/popover rather than pushing the whole layout onto a new line. Tabs, filters, and active-filter chips belong in one tight rail.
- Do not give low-frequency archive/history states the same visual weight as primary discovery states. Keep `All / New / Best match` as first-class tabs and move lower-traffic archive views into a secondary control.
- In a shared control rail, all dropdown-capable controls must use the same chevron language and comparable sizing. A mismatched trigger shape or icon reads as an unrelated component and breaks hierarchy.
- Do not confuse alternate datasets with filters. `Applied / Skipped / Rejected` are separate views over different queues, not refinements of the active queue, and should not be presented like a filter of `All`.
- When a control rail is carrying both options and current state, split it into two lines: top line for selectable controls, second line for applied chips/clear-all. Do not let chips compete with navigation controls in the same row.

## Branch Sequencing And Baseline Integrity

- Do not start a follow-on branch from `main` unless the last approved work is actually committed and present on `main`. "Approved in chat" is not a valid baseline; only committed code counts.
- Before beginning a new branch, prove the baseline with `git log` and `git diff main..<previous-branch>` so missing approved changes are detected before new work starts.
- If later approved refinements were left uncommitted in a feature branch, stop. Re-land that baseline first. Do not pile backend/data-quality work on top of an older UI baseline and hope to reconcile it later.
- Do not mix current-run funnel metrics with lifetime database aggregates in the same dashboard row. `Found`, `Filtered`, `Imported`, and `Avg Score` must all describe the same run context or the UI will show impossible combinations such as `0/0` with a non-null average score.
- Treat source-specific cleanup as shared domain logic, not UI glue. If malformed capture rows can affect capture, scoring, and review rendering, the cleanup belongs in a reusable source module applied at capture-time and read-time.
- Before changing score weights, prove whether low scores are a weighting problem or a data/accounting artifact. Hard-filter zeroes and malformed source text can make average scores look broken even when the kept-job ranking is reasonable.
- Do not duplicate the parent view in a secondary selector. If `All` already exists as the primary leftmost control, the secondary dataset selector must default to a neutral label instead of echoing `All`.
- When a parent dataset has alternate selections (`All / Applied / Skipped / Rejected`), the leftmost control itself should be the dataset selector. Do not split the same concept across a primary button and a separate orphaned dropdown.
- Storage-path confusion is not just a development problem. If app state is checkout-relative, end users installed from a repo clone will experience fragmented history across branches and copies of the project.
- Pagination is a first-class navigation control. Do not rely on post-render reconciliation effects to keep page and selection in sync; change both explicitly in the click handler and cover the visible page transition in React smoke tests.
- When starting a new implementation branch after a merged feature pass, preserve the approved UI baseline. Data-quality or backend branches must not accumulate unrelated UI churn; reset UI-facing files to `main` immediately if local experimentation leaks across scopes.

## Source-Type Framing

- Do not plan source-quality work as if all sources share one failure mode. Split sources by type first:
  - direct non-auth sources,
  - auth browser sources,
  - search-on-search sources,
  - outlier company-board sources.
- Do not spend P0 effort on outlier architecture unless it materially improves MVP reliability. For sources like Ashby, the controller should explicitly decide "narrow now" versus "defer" instead of letting the outlier muddy the baseline.
- For outlier source types like Ashby, measure novelty versus redundancy explicitly. The right question is not only "can we scrape it?" but "does it surface jobs we would not otherwise get, at a sustainable engineering cost?"
- Do not conflate Google Jobs with generic SERP scraping when the product is intentionally targeting the Google Jobs surface with applied filters. In that mode, Google should be treated as a first-class source adapter and judged on URL/state construction and extraction quality, not dismissed as low-value search noise.
- In controller-branch parallel execution, returned lane output must be reviewed and either integrated or explicitly deferred as each agent completes. Do not let completed lane work sit idle while the controller keeps planning in the abstract.
- When a stakeholder points to an external product brief or source-scope table as the MVP slate, treat that artifact as authoritative immediately. Sync backlog, roadmap, registry, and active ExecPlans in the same cycle; do not leave older source assumptions active in controller docs.
- In controller-driven MVP delivery, open agents are inventory, not decoration. Close completed lanes immediately, mark partial lanes truthfully (`re-tasked`, `in progress`, `% complete`), and reassign freed capacity to blocked build work instead of leaving workers idle.
- In controller-driven MVP delivery, worker oversight is continuous work, not a status poll. As each lane returns, the controller must do one of four things in the same cycle: integrate, explicitly defer, re-scope with new instructions, or reassign freed capacity to another open lane. Do not leave returned work unreviewed while remaining lanes drift.
- Delegation is only efficient if the controller distrusts summaries and verifies lane output immediately against the real branch state. A claimed "clean worktree" or "complete lane" is not authoritative; check `git status`, inspect the returned commit, run the targeted suite, and then either integrate or correct the lane report in the same cycle.
- In source MVP delivery, treat every source lane as pattern-building work, not a one-off adapter. Require each lane to leave behind reusable artifacts: source type, search-construction rules, extraction contract, degradation semantics, and verification pattern. Otherwise the future `add a source` feature will start from scratch.
- When a source lane is narrowed to adapter-only work, still leave behind one lightweight source note that captures source type, unsupported criteria, canonical review-target rule, minimum extraction contract, and the exact tests that prove the adapter. Reusable artifacts are still required even if registration/config wiring belongs to another lane.
- When a controller spins up a registration lane for a new direct HTTP source, leave behind a reusable checklist that covers source-library entry, schema acceptance, cache TTL, and reporting expectations. Future source builds should start from that checklist instead of rediscovering the same registration contract.
- When adding a new source type, wire it through the existing shared auth-gating and readiness/status pipelines in the same change. Do not infer “no auth” from a new type by omission, and do not introduce a new public status label like `live source` when existing vocabulary (`ready`, `not authorized`, `challenge`, `disabled`, `never run`) already covers the state.
- A controller branch is not ready for stakeholder QA until it is pushed and has an upstream. Local integration commits are not enough. The controller workflow must treat `push -> QA instructions -> roadmap/reporting update` as one gated cycle.
- If a branch contains MVP-scope fixes that affect what the user should see, push that branch before claiming readiness. A local-only controller branch creates false QA failures because the user cannot validate the actual integrated state.
- Before diagnosing a controller-branch UI regression, prove what checkout is actually serving the QA port. On macOS, inspect the live review-server PID and its cwd (`lsof -a -p <pid> -d cwd -Fn`) before blaming committed code.
- If a stakeholder reports that a controller/data-quality branch regressed the UI, diff only the UI-facing files against `main` first. If `App.jsx`, Jobs features, and UI components are unchanged, the bug is in runtime/checkout QA setup, not committed UI code.
- A controller fix is not real until two things are true: it is pushed to `origin`, and `qa/current` is updated to point at that pushed controller state. If `4311` is still serving `/Users/admin/job-finder` on an old `qa/current` commit, stakeholder QA will regress to stale UI again no matter what changed in the controller worktree.

## Title Bucketing Dependency

- Do not present raw job-title text as if it were a normalized title-family breakdown. If the product promise is canonical title families, bucketing must happen on normalized title families and level heuristics after source cleanup, not on polluted raw titles.
- When data-quality work is active, treat title-family bucketing as downstream of source cleanup and canonicalization. Otherwise the widget becomes a diagnostic for dirty source data rather than a trustworthy segmentation tool.

## Roadmap Rituals

- Do not let backlog grooming and local ExecPlans replace the roadmap directory rituals. When the work changes roadmap scope, launch readiness, sequencing, or MVP source decisions, update the roadmap artifacts too: at minimum `docs/roadmap/decision-log.md` and the current `docs/roadmap/progress-daily/<date>.md`.
- If a stakeholder asks about execution process, dispatch, or roadmap visibility, treat missing roadmap updates as a process bug and correct them immediately.

## Dispatch and QA Commit Discipline

- Never hand off QA instructions assuming code is available in downstream worktrees until the fix is committed and pushed (or explicit local-only scope is stated).
- Before giving QA refresh commands, verify upstream commit presence with `git log -n 1` and branch sync with `git status --short --branch`.
- In worker packets, explicitly state planning-file precedence (`PROCESS.md` + `PLANS.md` + repo `AGENTS.md`) and ban `tasks/todo.md` for feature ExecPlans to avoid instruction-layer ambiguity.

## Dashboard Smoke Harness Reliability

- A dual-mode smoke harness must assert mode-specific render markers, not just command success + screenshots. Otherwise `react` mode can silently fall back to legacy and still pass.
- Smoke tooling must use deterministic local dependencies (project-pinned `playwright`) instead of ambient `npx` package resolution.
- When the React shell intentionally removes legacy scaffolding (for example top-level page tabs or old CTA copy), update the smoke harness in the same change. Harnesses should lock to current user affordances (`Run search`, direct Jobs workspace render), not historical labels (`Find Jobs`, `Jobs` tab).
- For dashboard mode proof, persist explicit evidence in smoke logs (for example `ui_mode_check=pass` + root page title).
- For manual QA on local runtime (`/Users/admin/job-finder`), always sync that repo to `origin/main` immediately before launch; pushing from a worktree does not update the separate local runtime checkout automatically.
- Use a single QA launch command (`npm run review:main:follow`) as source of truth; avoid mixing `git checkout/pull/review` ad-hoc steps that can leave stale commit + live server combinations.
- Do not merge to `main` before stakeholder QA approval. QA should run from a QA branch that tracks the feature branch; merge to `main` only after explicit sign-off.
- Avoid fixed-port QA startup (`node src/cli.js review`) in docs/instructions; use scripts that auto-pick an open port and print the active URL to prevent recurring `EADDRINUSE` confusion.
- For cross-worktree collaboration, Cmd-R reflects local changes only. If another worktree is producing commits, QA must run an auto-follow mode (`review:follow`) or explicit pulls to avoid stale UI confusion.
- QA startup friction should be one-time per machine, not per branch. Prefer an always-on local review agent that follows the current branch/upstream and serves a fixed URL for Cmd-R.
- Harden npm build entrypoints against accidental positional args (for example copied checkmark glyphs). Vite treats stray tokens as project roots (`✅/index.html`) and hard-fails; wrapper scripts should ignore non-option args.
- Keep exactly one human-facing QA command for iterative UI validation (`npm run review:qa`), and make it deterministic: stop stale processes, lock to `127.0.0.1:4311`, follow branch upstream, and run React build watch. Splitting responsibilities across multiple commands (`review`, `review:qa`, `review:react:watch`) caused repeated stale-UI confusion.
- If the QA runner cannot actually bind the documented fixed port, it must fail loudly or print the real bound URL as the single source of truth. Advertising `4311` while launching on `4312` recreates stale-UI confusion and breaks Cmd-R assumptions.
- Do not give stakeholder QA instructions against uncommitted local worktree changes. If the user is expected to QA, the work must first be committed and pushed to a named branch they can check out, or the user must be explicitly told QA is blocked until that happens.
- Do not present `npm run dashboard:web:build` as a QA step. It is only a compile step. Stakeholder QA requires a running review server on the same committed branch being evaluated.
- Before handing off QA, verify this exact chain is true:
  1. the implementation commit exists,
  2. the branch is pushed,
  3. the user-facing QA command targets that branch,
  4. the command starts a reachable review server,
  5. the printed URL is the real URL to refresh.
- If any one of those conditions is false, do not tell the user to QA yet.
- A failed `git checkout`/`git switch` invalidates every QA instruction that follows. If checkout errors (for example stale `.git/HEAD.lock`), stop immediately and fix the repository state first; do not keep giving run/refresh guidance against an unknown commit.
- Before telling a stakeholder to refresh, explicitly verify the target checkout is on the expected branch and commit. A mismatched commit is a process failure, not a user error.
- Repeated QA-process churn is itself a product/process bug. Prefer one reliable path over “maybe this command” variants, and do not change the prescribed QA flow mid-iteration unless the previous flow has been explicitly retired and validated.
- For stakeholder QA, `review:qa` must be local-first, not branch-following. The accepted contract is: one terminal command per worktree, then `Cmd-R` for changes in that same worktree. Auto-pulling upstream belongs in a separate script, not the QA script.
- Current "local-first" storage is repo-relative, not user-local. Treat this as an architectural bug: persistent app state should live in one canonical machine-local folder, with explicit overrides for isolated QA, rather than being silently split across branches/worktrees.

## QA Process Contract

- Stakeholder QA must use exactly one checkout: `/Users/admin/job-finder`.
- Worker worktrees are implementation-only. The user should never need to QA them directly.
- The controller branch is integration-only. Stakeholder-visible QA should happen via a dedicated `qa/current` branch that mirrors the latest controller-approved state.
- `npm run review:qa` must be the single QA entrypoint. It should serve only `/Users/admin/job-finder`, fixed at `http://127.0.0.1:4311`, and either auto-follow `origin/qa/current` successfully or fail loudly.
- Every QA page should expose a visible build stamp: branch, short SHA, and serving checkout path. If the stamp is wrong, the QA session is invalid.
- The controller is responsible for pushing reviewed integration to `origin/qa/current` before asking for QA. Never ask for stakeholder QA against a controller/worktree branch directly.
- Main remains post-QA only. Flow is: workers -> controller -> `qa/current` -> stakeholder QA -> main.
- If `/Users/admin/job-finder` has local dirt, the QA updater must stop and report that explicitly instead of serving stale code silently.

## QA Readiness Gates

- A live QA environment is not the same thing as a feature being ready for stakeholder QA. Do not declare QA readiness if known MVP-source integration gaps still exist.
- New sources are not QA-ready until they fully reuse existing product contracts: source-type semantics, enablement/auth flows, status vocabulary, and existing reporting surfaces.
- New source integrations must reuse existing action hierarchy. Common recovery actions belong on the primary CTA, while overflow menus are only for uncommon actions like `Disable`. Never ship a new source row where the overflow trigger is secretly the destructive action.
- When adding a new source type, update all source-kind registries in the same change. If React search rows and legacy/server source maps are not both updated, the source will leak as `unknown` even when the adapter works.
- Novelty tracking for new sources should be internal by default and anchored to an explicit baseline. For MVP source evaluation, default to `LinkedIn + Indeed` unless the stakeholder changes the baseline deliberately.
- When an auth-required recovery flow is already active in a modal, failure feedback must stay inside that modal. Do not stack a destructive toast on top of inline modal state for the same auth failure.
- Source-row reporting must preserve source-identity continuity across renamed source configs. If canonical source IDs change, legacy IDs need explicit aggregation aliases or the source table stops being cumulative and ceases to be a source of truth.
- When a new source-library field matters at runtime, verify the full config-loading path preserves it. Adding metadata to the library definition alone is insufficient if `validateSources()` strips the field before the server builds dashboard rows.
- After every controller-delivered feature that is intended for stakeholder QA, push the branch and refresh `qa/current` immediately. QA prep is part of delivery, not a follow-up chore.
- Source reporting metrics must never coerce missing historical accounting into zero. If cumulative `filtered` or `deduped` history was never persisted, render those values as unavailable until a new run records them.
- If a table is intended to be a source of truth, every displayed metric needs a matching persistence model. Do not mix lifetime imports with latest-run funnel counters and pretend the row is cumulative.
- `review:qa` must start every runtime dependency required for the approved QA path. For auth-gated source checks, that includes the local browser bridge on `4315`; otherwise the QA flow reports false auth failures even when the user is correctly signed in.

- Before asking for stakeholder QA on auth-gated flows, verify the live QA checkout is actually running the bridge and execute the same endpoint the UI uses at least once (for example `/api/onboarding/check-source`). A healthy page alone is not enough.

- A source contract is not real unless the query builder, criteria accountability output, and live product criteria model all agree. Do not claim per-source mapping is implemented when the contract says a field is supported but the runtime model cannot actually express or account for it.
- For job-board sources with adjacent salary/career/explorer links, builder tests are not enough. Add capture-fixture tests that assert the extractor excludes non-job URLs (for Indeed specifically: `/career/` pages and `fromjk=` salary links) or regressions will ship while the URL builder still appears correct.
- For "latest run" semantics, do not anchor UI cohorts to the latest run that changed data if the product meaning is "latest completed run." A zero-import run is still the latest run and must be able to clear `New`.
- When introducing derived queue fields like `isUnread`/`isNew`, update every optimistic UI path in the same change. Mutating only the legacy `status` field leaves server-rendered counts and filters stale until a full refresh.
- The active queue must apply the same rejection gate as scoring. Jobs with `bucket = reject` or `hard_filtered = true` cannot stay in `queue` just because their application status is still `new` or `viewed`; otherwise source-specific junk leaks straight into stakeholder QA even when scoring is correct.
- Do not rationalize a source-row count mismatch as "current vs cumulative" until the underlying persisted rows agree. If the source table says 26 imported and the DB only holds 1 source row, treat it as an accounting or identity bug first.
- For source-specific canonical review URLs that carry identity in query params (for example `Levels.fyi jobId`), the generic URL canonicalizer must preserve that identity. Stripping query params on unknown hosts can silently collapse many jobs into one row and corrupt both persistence and source reporting.
- Source rows cannot mix aggregated persisted-job counts with non-aggregated run totals. If legacy source IDs roll into the current MVP row, `imported` must come from aggregated persisted rows, not raw `source_run_deltas`.
- If capture payloads only persist `capturedRawCount`, the sync path must still derive and persist `filtered_count` and `deduped_count` from the actual funnel (`captured raw -> post-hard-filter rows -> persisted rows`). Otherwise the source table falsely implies filtering and dedupe never happened.
- The Sources table must not present pre-import cleanup as if it were search hard-filter behavior. If `Filtered` is meant to explain product value, it must reflect criteria/hard-filter rejection consistently across all sources, not only source-specific extractor cleanup like Indeed salary-page rejection.
- The Sources table must not count identity collisions as healthy dedupe. If a source uses non-job review targets or collapsing canonical URLs (for example, YC company pages), `Dupes` becomes misleading and should be fixed at the identity layer before being surfaced as product behavior.
- User-facing source metrics must come from one shared funnel: raw capture -> hard-filter rejection -> duplicate collapse -> imported survivors. Mixing extractor cleanup, persisted-row counts, and identity collisions produces trustworthy-looking garbage.
- User-facing duplicate counts must exclude the source's own historical rows. A same-source rerun returning the same jobs is refresh behavior, not evidence of duplicate opportunities polluting the queue.
- When metric semantics change, version the persisted rows and gate public aggregation to the current semantics version. Do not sum old broken rows with corrected ones and call the result cumulative.
- For source-run QA, inspect per-source outcomes at the batch level: `live`, `cache`, `quarantine`, and `failed`. A source table can look coherent while the actual run is broken because one source was quarantined, another was cache-served, and a third never produced a synced row. Builder tests alone do not cover that execution path.
- Do not introduce or rely on a hidden source-run state like `quarantine` in stakeholder-facing QA unless that behavior has been explicitly approved and surfaced honestly in the product. Silent quarantine plus stale prior metrics destroys trust.
- When the goal is to measure source quality and query correctness, disable cache or bypass it for QA by default. Cache can be useful for resilience, but it is the wrong default when validating live search behavior.
- Do not ask for stakeholder QA on source search quality until manual-parity checks have been run for each active source and the acceptance criteria are actually met. “Builder passes tests” is not enough; live query parity must be demonstrated first.
- If stakeholder QA is supposed to measure current source quality, the QA path must force live capture and allow the current capture to reach sync even when internal safety heuristics would normally quarantine it. Hidden cache reuse or silent quarantine makes the run look healthy while masking the thing under test.
- Source-row refresh metadata must come from the current capture attempt, not a post-sync cache-policy recomputation. If sync recomputes refresh state after a fresh capture, it can relabel the current live run as `cache_fresh` and destroy trust in the run table.
- For source regressions, compare the generated URL against a direct live capture of the manual-equivalent broad query before changing extraction code. If the broad URL captures a healthy page and the configured URL does not, the regression is query-state overconstraint, not extractor incapacity.
- Do not force every structured criterion into a source-native URL just because the product model has the field. If a source's native URL semantics are lossy or brittle, keep only the high-signal constraints in the URL and move the rest to honest post-capture evaluation.
- If a source's current live search is materially controlled by native params that are already visible in the manual URL (`radius`, `days`, `refine_by_salary`, etc.), do not strip them out of the generated URL. That is not “cleaner”; it is a regression against manual parity and can collapse a healthy search into a near-empty one.

## Source Regression Baseline Discipline

- When a user says a source used to work, do not continue with generic source-quality tuning. First compare current source handling against the last known-good baseline commit and identify which layers changed: query builder, browser extraction, normalization, evaluation, and source-row accounting.
- Do not tell the user a source is parity-ready until you have personally checked the generated source-native URL/state against a manual-equivalent live search and verified the first-page result count and top captured matches are in the same rough range.
- If a source row disagrees with the raw capture artifact, treat that as a separate accounting bug. Do not rationalize low source counts as search quality until capture count, evaluation count, and imported count reconcile.
- Do not let the generic sync path count from a source-level prefilter. User-facing source metrics must start from raw captured rows and only then apply shared evaluation and dedupe.
- When canonicalizing source definitions into the library, preserve source-specific native search state that materially affects quality. Replacing richer working base URLs with generic endpoints is a regression unless proven harmless.
- For user-facing source metrics, `Filtered` must follow the product meaning of “rejected by this search,” not the scorer’s narrow `hardFiltered` flag. If evaluation uses `bucket='reject'` for title/location/salary/date failures, source-run accounting must count those rows as filtered too.
- `node src/cli.js sync` is not a live browser-recapture path for browser sources. It reads whatever is already in the capture files. Do not use it to validate live source quality or claim a fresh QA batch; use the real `run-all` path that captures first and syncs second.
- When a live source page advertises far more results than the capture file contains, treat it as an extraction shortfall first. Query construction may still be lossy, but `expectedCount >> captured jobs` on the same live page means the extractor is missing visible cards.
- If the server and CLI both ingest captures, compare their capture-payload construction paths directly. `src/cli.js sync` had already been corrected to reread the refreshed capture summary after collection, while `src/review/server.js runSyncAndScore()` still used the stale pre-collection summary and wrote contradictory source rows.
- Do not leave a browser-source timeout unchanged after making the extraction script materially heavier. If detail probing or cleanup gets more expensive, raise the source-specific timeout on the real live-run path before asking for QA.
- For LinkedIn card capture, do not trust detail-pane text unless the detail pane proves it belongs to the same LinkedIn job id as the card. Otherwise one stale open detail pane can contaminate many jobs with the same description and trigger false excludes.
- For LinkedIn search capture, do not click job anchors to read detail hints. Use a search-results-safe card interaction and explicitly guard against navigation into `/jobs/collections/similar-jobs`; otherwise the capture starts on the right search URL and then poisons itself by leaving the filtered search context.
- When the user directly observes the live automation tab, treat that as ground truth over indirect CLI signals. I incorrectly concluded the LinkedIn drift was fixed because a raw capture completed, but the browser was still ending in `similar-jobs`. For LinkedIn search capture, the correct rule is stricter: keep the search page read-only and do not click into card/detail state during raw capture at all.

- Do not mix source-run accounting with refresh-state status in stakeholder surfaces. If counts come from latest/cumulative run deltas, displayed servedFrom/status must prefer the latest run row unless there was a later failed attempt.
- For source-run reporting, do not let a later `cache_fresh` replay of the same `captured_at` outrank the live row that actually produced the capture. Latest-run truth and cumulative totals both need a trust ordering, not just `recorded_at DESC`.
- If the primary `Run search` action fails auth preflight or any other gate before a new batch is created, the UI must not leave the previous source table looking like the attempted run succeeded. A toast alone is insufficient; the dashboard needs an explicit failed-attempt state or refreshed run metadata.
- `run-all` must never sync a failed browser source from an older capture file. If a source does not complete in the current batch, exclude it from that batch's sync set; otherwise stale capture data gets re-labeled as current run output and destroys trust in the source table.
- If stakeholder QA is supposed to validate all enabled sources, QA mode must bypass refresh cooldowns and manual-refresh caps as well as cache. Otherwise `Run search` silently skips enabled sources and leaves stale rows looking current.
- Do not let stakeholder QA mode silently override quarantined ingest. If the user has rejected quarantine as a QA strategy, `JOB_FINDER_SOURCE_QA_MODE` must force live runs without accepting quarantined captures behind the scenes.
- For LinkedIn capture, never trust `detailDescription` unless the detail job id is present and matches the card job id. Missing detail ids are not a weak signal; they are an invalid provenance signal and can leak stale description text into unrelated jobs.
- After a crash or abrupt shutdown, do not assume newly dirty files came from someone else. First verify whether the changed files are on the current task path and whether the user has already told you the drift is from your own recent work.
- When validating live browser capture from a controller worktree, verify the browser bridge process is running that same checkout. A live capture routed through an older QA bridge can make a local fix look ineffective even when the current worktree code is correct.
- `capture-source-live` refreshes the source artifact only. It does not mint a new `source_run_deltas` row or update the Sources table. Treat it as capture evidence, not as synced source-row evidence.
- For LinkedIn, “safe” cannot mean “read-only.” If detail reads are disabled, valid PM/AI jobs collapse under hard filtering because the capture contains only `Company · Location` snippets. The safe design is card-click detail reads plus strict external-id provenance checks.
- If a stakeholder spots a source-native filter mismatch, do not trust the contract file or builder in isolation. Verify runtime builder output, inherited/default source URL params, and the live source page state together before claiming JobFinder-to-source parity.
- Do not silently inherit source-native filters like radius or date-posted when the JobFinder UI does not expose them. If a source requires an approximation, document it explicitly; otherwise generated source state must map directly from visible JobFinder criteria.
- Do not classify a source criterion as unsupported just because the current adapter ignores it. If the live source UI clearly exposes native filters/search inputs, treat that as evidence that the adapter contract is incomplete and redesign around the real source-native parameter surface.
- Source mapping should start from a comprehensive inventory of each source's real query parameters and result data shape. Then split parameters into `universal` (maps from JobFinder) and `non-universal` (source-specific extras). Do not invent ad hoc source strategies before doing that inventory.
- Do not evaluate a source only by on-platform application mechanics. `YC Jobs` has strategic value even if users often apply off-platform, because it exposes startups and roles that may be missing or delayed elsewhere. Source inclusion decisions should consider discovery value separately from apply-through friction.
- When a logged-in source exposes its real filter state and result set through browser app state, do not keep trying to recover it through a direct `curl` adapter. Treat browser/app-state capture as the authoritative path and redesign the source around that surface.
- When a source carries role intent in the path and additional criteria in query params, route detection must parse the URL pathname rather than regex the full string. Otherwise query params can silently disable the role-family guard and let off-target jobs leak back in.
- For LinkedIn extraction, provenance checks must apply to the fallback path as well as the optimistic path. If a detail pane job id is missing or mismatched, return blank detail hints; otherwise stale narrative text will still leak through the fallback return and poison unrelated cards.
- For LinkedIn pagination, stop before the next `start` offset exceeds the live `expectedCount`. Ending the run on a terminal empty page makes the automation look broken and obscures whether the last successful page was fully harvested.
- LinkedIn page-count parsing is not reliable enough to be the only pagination guard. Also stop after any short page (`<25` cards), because that is the real page-size boundary even when `expectedCount` is missing or delayed.
- Before narrowing a live extractor to a more specific DOM scope, verify the selector counts on the real page. Plausible-looking LinkedIn list-card selectors under-harvested badly in practice and regressed capture from `33/49` to `6/46`.
- For LinkedIn, do not conflate `captured` with `imported`. The regression here is first a raw capture shortfall against the live result count; filtering is a separate question that comes after the extractor can harvest a representative set of rows.
- If LinkedIn placeholder rows later hydrate on the same search page, add an explicit second pass over unresolved row ids. A single pass understates what the current DOM can reveal after the list settles.
- If a source exposes a stable row-id list and the extracted data shape is regular, do not rationalize partial coverage as inherently acceptable. Treat that as proof the traversal or data-access method is still wrong and keep pushing toward deterministic full coverage.
- Before doing another DOM-tuning pass on LinkedIn, inspect the saved page source for hidden BPR payloads. The sample page proves LinkedIn can embed regular `JobPostingCard` JSON in hidden `<code>` blocks, which is a better extraction surface than hydrated left-rail card DOM when the visible list is virtualized.
- A hidden structured payload can still be incomplete. On the live LinkedIn first search page, `voyagerJobsDashJobCards` yielded only `7` jobs while the visible page clearly contained more; treat structured payloads as a high-confidence seed or enrichment surface unless coverage is explicitly verified.
- Do not assume generic page scrolling will expand LinkedIn's hidden structured payloads. A live before/after-scroll probe kept `structuredCount` flat at `7` and showed no usable scroll capacity on the main-document candidates, so verify the actual lazy-load trigger before tying extraction to scroll behavior.
- On live LinkedIn search pages, `document.documentElement.outerHTML` can be a worse extraction surface than the browser resource/runtime layer. The live diagnostic saw `0` row ids in `outerHTML`, `7` jobs in hidden structured payloads, and `25` job ids in resource URLs. When the document snapshot and hidden payload are partial, inspect `performance` resource entries or runtime state before doing another DOM scraper rewrite.
- LinkedIn's live `voyagerJobsDashJobCards` response body is accessible from the page context if the request reuses the page's CSRF token and `x-restli-protocol-version: 2.0.0`. The response uses normalized recipe objects rather than the older hidden-payload `$type = JobPostingCard` shape, but it still contains the MVP fields directly (`jobPostingTitle`, `primaryDescription`, `secondaryDescription`, `tertiaryDescription`) and yielded `25` first-page jobs. This should be the primary extraction surface for LinkedIn MVP capture.
- When comparing live QA metrics against controller-side diagnostics, first prove both checkouts are using the same `config/source-criteria.json`. I misdiagnosed LinkedIn source-run drift because `/Users/admin/job-finder` had different scoring keywords than the controller worktree.
- Do not conflate `bucket=reject` with `hardFiltered`. If the approved product contract says `Filtered` means hard-filter failure only, metric builders and tests must enforce that exactly.
- Do not use `reject` as product language for rows that merely score low against current keywords. In this product, `hardFiltered` means ruled out; low-score rows are still valid opportunities and should be treated as "low signal" or similar, not true rejects.
- For stakeholder QA of source quality, do not offer or silently use cached runs. Every QA-triggered search must execute live so run observations map directly to source query construction, extraction, and scoring behavior.
- For Indeed MVP capture, do not run generic detail-page enrichment after search extraction. The product requirement is search, scroll, extract, and paginate only; fetching `viewjob` pages reintroduces bogus URLs and page-not-found failures that are outside MVP scope.
- When a source appears to load twice during `run-all`, inspect the route-level orchestration before blaming the source adapter. In this case the duplicate load came from a separate auth-preflight pass in `/api/sources/run-all`, not from the capture loop itself.
- When reconciling source `Imported` counts with queue `New`, first separate batch stamping from queue eligibility. After fixing batch stamping, the remaining gap here was caused by active-queue gating (`hardFiltered = false`, `bucket != reject`, non-terminal status), not by stale `last_import_batch_id` values.
- Source latest-run deltas that users compare to the review queue must be finalized after scoring, not before. Recording `importedCount` and `hardFilteredCount` during sync produced misleading source rows because later evaluations changed queue eligibility without updating `source_run_deltas`.
- Never run automation diagnostics in the user's active browser window. Always open a new window for any source testing or debugging.
- AppleScript `execute javascript` can return `missing value` for background tabs; if a capture needs JS execution, it must target an active tab (or activate a dedicated automation window) rather than scanning inactive tabs.
- If `execute javascript` keeps returning `missing value`, shrink the injected script to a minimal payload to isolate escaping/length issues before changing the broader extraction logic.
- When validating AppleScript behavior, reproduce with the same multi-line `tell application "Google Chrome"` block syntax the provider uses. The one-liner `execute javascript ... in active tab of front window` has a known grammar ambiguity and can fail with `-2740`, which is not representative of production behavior.
- YC companies pages include navigation/footer links under `/jobs/` (e.g., `/jobs/l/...`). Only treat numeric `/jobs/<id>` URLs as job cards to avoid importing non-job rows like "Product Manager Jobs".
