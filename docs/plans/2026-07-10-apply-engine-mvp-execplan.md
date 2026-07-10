# Apply Engine MVP: Draft-and-Confirm Job Applications with a Reusable Answer Library

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document must be maintained in accordance with `/Users/admin/job-finder/PLANS.md`.

## Purpose / Big Picture

Job Finder today discovers and ranks jobs but leaves the most tedious part of a job search — filling out application forms — entirely manual. After this change, a user reviewing a high-signal job in the dashboard can click "Prepare application," watch Job Finder open the job's application form in their own Chrome browser and pre-fill every field it can answer from a locally stored, reusable answer library, then personally review the drafted form and click the site's own submit button. Job Finder never submits on its own; the human always performs the final submit. Questions the library cannot answer are surfaced to the user, and their answer is saved back to the library so the same question is never typed twice.

This converts Job Finder from a ranked reading list into an end-to-end job search product: discover, rank, prepare, apply, track. The stakeholder acceptance bar is concrete: the primary user (Peter) submits 10 or more real applications per week through the draft-and-confirm flow across Greenhouse and LinkedIn Easy Apply, with fewer than 2 manual field corrections per application by the second week of use.

Two explicit non-goals for this plan: no zero-click ("full auto") submission anywhere, and no new discovery sources. Discovery work is frozen to maintenance plus one bounded trust fix (Milestone 5) for the existing enabled sources.

## Progress

- [x] (2026-07-10) ExecPlan authored and checked in for stakeholder review.
- [x] (2026-07-10) Stakeholder approval obtained for enabling write primitives under a draft-and-confirm boundary (recorded in `docs/roadmap/decision-log.md` and in the Decision Log below).
- [x] (2026-07-10 20:15Z) Repo stabilization: stale `index.lock` cleared; ~24 files of uncommitted drift on the QA checkout preserved on branch `wip/2026-07-10-qa-checkout-rescue` (`3c7cf86`) — needs stakeholder review; `feature/apply-engine-mvp` based on the rescue commit because committed `qa/current` fails 13 tests that the drift fixes.
- [x] (2026-07-10 20:20Z) Green baseline on fresh checkouts (`665ccc0`): `posthog-node` added to dependencies; LinkedIn structured-payload tests skip when the gitignored fixture is absent (resolved repo-relative); `node:sqlite` null-prototype row normalization in run-deltas test. Full suite 488 pass / 0 fail.
- [x] (2026-07-10 20:40Z) Milestone 0 (`ad0c192`): `apply_v1` surface with per-surface write allowlist; `jobs.apply_click` + `dialogs.confirm_action` never-exposable on any surface; unknown surfaces rejected; `forms.extract_schema` read primitive; `/apply/*` routes consent-gated via `src/apply/consent.js`; noop provider implements apply ops for tests. Suite 498 pass / 0 fail. Remaining from M0 scope: live chrome_applescript apply implementations (deferred to Milestone 3 where they can be verified against a real form; stubs return 501).
- [ ] Milestone 1: Answer library schema, repository module, and seed/import CLI.
- [ ] Milestone 2: Transport-agnostic apply engine core (schema detection contract, field mapping, draft plan) with unit tests against saved form fixtures.
- [ ] Milestone 3a: Prepare-flow design artifact (screen states, copy, error states) approved by stakeholder before implementation.
- [ ] Milestone 3: Greenhouse adapter + dashboard "Prepare application" flow, live-verified on a real Greenhouse posting; meets UX Standards section.
- [ ] Milestone 4: LinkedIn Easy Apply adapter with multi-step modal support and strict no-submit guardrails, live-verified.
- [ ] Milestone 5: Import-count trust: expected-versus-imported surfaced per source row in the Sources table for every run.
- [ ] Milestone 6 (stretch): Lever and Ashby adapters; answer-gap review queue.
- [ ] TERMS.md / PRIVACY.md updated for apply actions (launch-readiness gate, before any public release).
- [ ] Final QA: one week of real usage meeting the acceptance bar; retro written.

## Surprises & Discoveries

- Observation: The QA checkout (`/Users/admin/job-finder`, branch `qa/current`) carried ~24 files of uncommitted code+test changes, and committed `qa/current` fails 13 tests that this drift fixes (refresh-state, cache-policy, dashboard status). The drift is real unlanded work of unclear provenance.
  Evidence: `npm test` on committed `qa/current` = 457 pass / 16 fail; the same suites pass with drift applied. Preserved as `wip/2026-07-10-qa-checkout-rescue` (`3c7cf86`) without touching the working tree.
- Observation: `posthog-node` is imported by `src/analytics/posthog-config.js` but was never declared in `package.json`, so every fresh install failed `test/posthog-error-tracking.test.js` with ERR_MODULE_NOT_FOUND.
  Evidence: `ls node_modules/posthog-node` → not found on a clean install; fixed in `665ccc0`.
- Observation: `node:sqlite` (Node ≥22) returns null-prototype row objects, which `assert.deepEqual` distinguishes from plain literals. Two assertions in `test/run-deltas.test.js` already normalized rows with `({ ...row })`; one did not and failed only on newer Node.
  Evidence: `[Object: null prototype]` in the assertion diff for the `listImportedJobCountsBySourceId` test; fixed in `665ccc0`.
- Observation: JavaScript injection cannot populate `<input type="file">` (browser security), so the chrome_applescript provider can never attach resumes via injected JS. File upload needs the Playwright/extension provider (CDP `DOM.setFileInputFiles`) or manual attachment by the user during the confirm step.
  Evidence: standard browser security model — no page-context API sets a file input from a local path. MVP consequence: draft plans mark resume fields "attach manually" under chrome_applescript; `/apply/upload-file` remains on the surface for providers that can support it.
- Observation: git worktrees created inside the agent sandbox record absolute paths that don't resolve on the host Mac, and vice versa — a prior session's `hopeful-jackson` worktree pointer broke `git status` inside the sandbox entirely.
  Evidence: `fatal: not a git repository: /Users/admin/job-finder/.git/worktrees/hopeful-jackson`. Fix: rewrite the worktree's `.git` pointer file to a relative path (`gitdir: ../../../.git/worktrees/<name>`) and keep the reverse `gitdir` metadata file Mac-absolute.

## Decision Log

- Decision: Enable browser-bridge write primitives (`forms.type_text`, `forms.upload_file`) for a new `apply_v1` surface, keeping `mcp_v1` read-only and keeping `jobs.apply_click` and `dialogs.confirm_action` unexposed.
  Rationale: The read-only `mcp_v1` boundary was an intentional policy requiring explicit stakeholder approval to change. Stakeholder (Peter Spannagle) approved on 2026-07-10, scoped strictly to draft-and-confirm: the system may type into and upload files to form fields, but the human always clicks submit. Excluding `apply_click`/`confirm_action` from the surface makes zero-click submission structurally impossible rather than merely policy-forbidden.
  Date/Author: 2026-07-10 / Peter Spannagle (approval), Claude (recording).

- Decision: Consent gates every `/apply/*` route, including read-only schema extraction, and is re-read from `data/user-settings.json` on each request.
  Rationale: Schema extraction opens a window in the user's real browser — an intrusive act even though it writes nothing. One uniform gate is simpler to reason about and to test than a split policy, and per-request reads mean consent granted from the dashboard takes effect without a bridge restart.
  Date/Author: 2026-07-10 / Claude (autonomous, within plan scope).

- Decision: chrome_applescript apply operations ship as explicit 501 stubs in Milestone 0; real implementations land in Milestone 3 alongside the Greenhouse adapter.
  Rationale: Writing AppleScript window/tab management blind, with no way to live-verify against a real form in this milestone, violates the repo's verification-before-done rule. M0's acceptance is the policy boundary and consent gate, which unit tests fully prove via the noop provider. Failing loudly with 501 is honest; pretending to fill would not be.
  Date/Author: 2026-07-10 / Claude (autonomous, within plan scope).

- Decision: One shared apply engine with per-site adapters; adapter order is Greenhouse, then LinkedIn Easy Apply, then Lever/Ashby.
  Rationale: Greenhouse forms are the most schema-predictable and prove the engine with the least adversarial surface. Easy Apply is the highest-volume surface and stakeholder-required, but is a semi-structured multi-step modal on an automation-hostile site, so it goes second, after the engine is proven. Stakeholder wanted "both in parallel"; the compromise is a shared engine so both are in the MVP without divergent codepaths.
  Date/Author: 2026-07-10 / agreed in stakeholder session.

- Decision: Answer library lives in local SQLite (`data/jobs.db`), with a schema designed to be syncable to Narrata's Supabase later. Narrata is not called live in the MVP.
  Rationale: Job Finder is local-first and the MVP user is local. Narrata (github.com/ycb/narrata-cover-letter-agent, React/TypeScript/Supabase) contributes the concepts — reusable, truth-grounded content blocks with human approval — not a runtime dependency. A future browser-extension packaging with Supabase-backed accounts is the anticipated PLG/monetization wedge; the engine core must therefore stay transport-agnostic and the schema portable (UUID keys, updated_at timestamps, no SQLite-specific types).
  Date/Author: 2026-07-10 / Peter Spannagle.

- Decision: UX standards are baked in from the start, not deferred to a polish pass. The apply flow is design-first: Milestone 3 begins with a flow/copy/state design artifact reviewed by the stakeholder before implementation, and every milestone that touches UI carries the design-skill-pack + Playwright gate. A wholesale redesign of the existing dashboard is out of scope, but every surface this plan touches must meet the bar defined in "UX Standards" below.
  Rationale: Stakeholder stated the current product does not meet their bar for ease of use and delight. The confirm step is the product in a draft-and-confirm model — if reviewing a drafted application feels clumsy or untrustworthy, the automation is worthless. The repo's own history (`docs/learnings.md`, "UX Quality Bar for Onboarding" and dozens of table/control corrections) shows that retrofitting UX costs far more than designing first.
  Date/Author: 2026-07-10 / Peter Spannagle (direction), Claude (recording).

- Decision: Discovery is frozen: the five enabled sources (LinkedIn, Indeed, ZipRecruiter, Built In SF, Levels.fyi) stay live, but the only discovery engineering permitted in this plan is Milestone 5 (import-count trust). No new sources, no parity tuning.
  Rationale: Source-quality work stalled the project for months (see `docs/learnings.md`). Apply automation is the value frontier. The one exception exists because the stakeholder explicitly distrusts current import counts versus what portals show, and that trust is also a public-release requirement.
  Date/Author: 2026-07-10 / agreed in stakeholder session.

## Outcomes & Retrospective

- (to be written at milestone completions and at the end)

## Context and Orientation

Job Finder is a local-first Node.js (ES modules, Node >= 20) CLI plus a local web dashboard. Everything runs on the user's machine; state lives in a SQLite database at `data/jobs.db`. There is no test framework dependency: tests use Node's built-in runner (`node:test`, `node:assert/strict`) and run with `npm test` from the repository root. The repository root in this plan is the directory containing `package.json` with `"name": "job-finder"`.

Key modules, by full path:

`src/cli.js` is the CLI entry point (`jf` binary). `src/review/server.js` is an Express-style HTTP server (`npm run review`) serving the React dashboard from `src/review/web/` on `http://127.0.0.1:4311`; the dashboard's Jobs tab shows a ranked queue with a job-detail panel and quick actions (mark applied, skip, reject). `src/db/client.js` opens SQLite; `src/db/migrations.js` runs migrations on every database open and uses an `addColumnIfMissing(db, table, column, type)` helper for backwards-compatible changes. `src/jobs/repository.js` is the database access layer for jobs/evaluations/applications. The `applications` table (one row per job) tracks `status` (`new`, `viewed`, `applied`, `skip_for_now`, `rejected`), `notes`, `draft_path`, and timestamps including `submitted_at`.

The "browser bridge" is a small local HTTP server (`src/browser-bridge/server.js`, default port 4315, started with `npm run bridge` or auto-started by runs) that executes actions in the user's real Chrome browser. Its default provider, `src/browser-bridge/providers/chrome-applescript.js`, drives Chrome on macOS via AppleScript `execute javascript` (requires Chrome's "Allow JavaScript from Apple Events" and macOS Automation permission; see `docs/learnings.md` "AppleScript Automation Permissions"). Every bridge capability is classified in `src/browser-bridge/primitives.js` as `read` or `write`. The catalog already defines write primitives — `forms.type_text`, `forms.upload_file`, `jobs.apply_click`, `dialogs.confirm_action` — but the only registered HTTP surface, `mcp_v1`, is validated to reject write primitives (`validatePrimitiveSurfaceRegistration` in `src/browser-bridge/primitives.js`, enforced in `buildBridgeRouteMap` in `src/browser-bridge/server.js`). That read-only boundary stays intact; this plan adds a second surface rather than loosening the first.

Hard-won operational rules from `docs/learnings.md` that this plan must respect: never drive the user's active Chrome window — always open a dedicated automation window/tab; use the block-form `tell active tab of _window` AppleScript syntax (the one-liner form fails with error -2740); AppleScript `execute javascript` returns `missing value` for background tabs, so the automation tab must be active; and on LinkedIn, any DOM interaction risks navigating away from the intended context, so guard against navigation and verify state after each step.

"Narrata" (github.com/ycb/narrata-cover-letter-agent) is the stakeholder's separate cover-letter product: a React/TypeScript/Supabase app built around a human-in-the-loop, truth-grounded reusable content library (STAR-format achievements, approved content blocks). Job Finder already has a shallow integration (`connect-narrata-file` / `connect-narrata-supabase` CLI commands in `src/config/load-config.js`) that uses Narrata only as a profile/goals provider for scoring. This plan ports Narrata's *answer library concept* into Job Finder locally; it does not talk to Narrata's backend.

Terms used below: an "adapter" is a per-site module that knows how to recognize and describe that site's application form; a "form schema" is a plain JSON description of a form's fields (id, label, type, required, options); a "draft plan" is the engine's output — a list of (field, proposed value, answer source, confidence) entries — which is both rendered to the user and executed as fill actions.

## Plan of Work

The work is one engine, several thin edges. The engine (`src/apply/`) is pure logic with no browser or HTTP dependency, so it is testable with fixtures and portable to a future browser extension. The bridge gains an `apply_v1` surface that exposes exactly two write routes (type text, upload file) plus a read route that extracts the current page's form schema. The dashboard gains a "Prepare application" flow on the job detail panel. The database gains two tables (answer library, application drafts). Milestone 5 is independent of the engine and touches the sync/reporting path only.

## UX Standards (baked in, not polish)

These standards govern every user-facing surface this plan creates or modifies. They are acceptance criteria, not aspirations. The skill pack at `.codex/skills/ux-flow-content/SKILL.md`, `.codex/skills/design-system-ui/SKILL.md`, and `.codex/skills/microinteractions-motion/SKILL.md` must be applied before any UI milestone is marked complete.

Trust through transparency: the confirm surface is the product. Every drafted value shows its provenance (which library answer, or derived from the job) and confidence at a glance; the user should never wonder "where did this come from" or "what will happen when I click this." Nothing irreversible ever happens from the dashboard — the design must make that legible, not just true.

One clear next action per state: each screen state (no consent yet, drafting, plan ready with gaps, plan ready complete, filled awaiting user submit, confirmed) has exactly one primary CTA, honest progress feedback while the bridge works (drafting takes seconds — show what is happening, e.g. "Opening form… Reading fields… Matching 14 of 17"), and explicit, recoverable failure states with plain-language remediation. No silent failures, no stacked/competing affordances, no destructive actions in overflow menus (both rules already burned into `docs/learnings.md`).

Answer-gap flow is delightful, not a form: unanswered questions are presented one at a time inline with the question's original wording, save-to-library is a single confirmation, and the second application visibly benefits from the first ("12 of 13 answered from your library") — that moment is the product's core delight loop and should be designed as such.

Standard primitives, compact density: shadcn/Radix primitives already in the repo, existing status vocabulary and action hierarchy, no bespoke one-off components, no redundant labels/chrome restating what a control already communicates.

Design-first sequencing: Milestone 3 starts with a lightweight design artifact (screen states, copy, empty/error states for the Prepare flow) checked into `docs/plans/` and approved by the stakeholder before implementation. This is deliberately cheap — a markdown state map with copy, not high-fidelity mocks — but it is a gate.

Out of scope: redesigning existing dashboard surfaces this plan doesn't touch. Candidate follow-on workstream: a dashboard-wide UX audit against these same standards once the apply flow ships.

## Milestones

### Milestone 0 — `apply_v1` bridge surface and consent gate

Scope: make write actions possible without weakening `mcp_v1`. In `src/browser-bridge/primitives.js`, introduce a surface policy map: `mcp_v1` allows read-only (unchanged); new surface `apply_v1` allows `read` primitives plus exactly `forms.type_text` and `forms.upload_file`. `jobs.apply_click` and `dialogs.confirm_action` remain unregisterable on every surface; a test must prove that registering them on `apply_v1` throws. In `src/browser-bridge/server.js`, add routes `POST /apply/type-text`, `POST /apply/upload-file`, and `POST /apply/extract-form-schema` (the last is a read primitive — add `forms.extract_schema` to the catalog as `read`). The chrome-applescript provider gains corresponding methods that operate only on a tab it opened itself (tracked by tab id/window id), never the user's active window. Add a consent gate: apply routes refuse (HTTP 403 with a clear message) unless `data/user-settings.json` contains `applyAutomationConsent: { acceptedAt: <ISO date> }`; the dashboard prompts for this consent the first time the user clicks "Prepare application," with copy stating that Job Finder fills forms but never submits, and that automating third-party sites may violate their terms of service.

At the end of this milestone nothing is user-visible yet, but `npm test` proves the boundary: existing `test/browser-bridge-primitives.test.js` still passes (mcp_v1 read-only), and new tests show apply_v1 accepts the two write primitives, rejects `apply_click`, and that apply routes 403 without consent.

### Milestone 1 — Answer library

Scope: the durable store of everything the user has ever answered. In `src/db/migrations.js`, add:

    CREATE TABLE IF NOT EXISTS answer_library (
      id TEXT PRIMARY KEY,              -- UUID
      kind TEXT NOT NULL,               -- 'identity' | 'link' | 'document' | 'screener' | 'freeform'
      question_key TEXT NOT NULL,       -- canonical key, e.g. 'identity.full_name', 'screener.work_authorization_us'
      question_text TEXT,               -- original question wording when kind='screener'/'freeform'
      answer_value TEXT NOT NULL,       -- the answer (JSON string when structured, e.g. select options)
      answer_type TEXT NOT NULL,        -- 'text' | 'boolean' | 'select' | 'file_path' | 'url' | 'number'
      tags TEXT,                        -- JSON array for retrieval hints
      approved INTEGER NOT NULL DEFAULT 1,  -- human-approved flag (Narrata truth-fidelity principle)
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_library_key ON answer_library (question_key);

    CREATE TABLE IF NOT EXISTS application_drafts (
      id TEXT PRIMARY KEY,              -- UUID
      job_id TEXT NOT NULL,
      adapter TEXT NOT NULL,            -- 'greenhouse' | 'linkedin_easy_apply' | ...
      form_schema TEXT NOT NULL,        -- JSON: extracted schema
      draft_plan TEXT NOT NULL,         -- JSON: proposed field values + provenance + confidence
      unanswered TEXT,                  -- JSON: fields the library could not answer
      status TEXT NOT NULL,             -- 'drafted' | 'filled' | 'submitted_by_user' | 'abandoned'
      corrections_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
    );

UUID keys and ISO timestamps keep the schema portable to Supabase/Postgres later. Create `src/apply/answer-store.js` with `getAnswer(questionKey)`, `findAnswerForField(field)` (exact key match, then question-text similarity against `screener` entries using normalized token overlap — no ML dependency), `saveAnswer(entry)`, and `recordUsage(id)`. Add CLI command `jf answers` (list) and `jf answers-seed` which interactively seeds the identity basics (name, email, phone, location, LinkedIn URL, resume file path, work authorization, salary expectation) into the library. Seed data can also bootstrap from `config/profile.json` when present.

Acceptance: `node src/cli.js answers-seed` then `node src/cli.js answers` shows the seeded entries; unit tests cover key lookup, similarity matching (a saved "Are you authorized to work in the United States?" answer is found for "Do you have US work authorization?"), and the approved-flag default.

### Milestone 2 — Apply engine core (transport-agnostic)

Scope: pure logic, no browser. Create `src/apply/engine.js` exporting `buildDraftPlan({ formSchema, answerStore, job })` which returns `{ plan: [...], unanswered: [...] }` where each plan entry is `{ fieldId, label, proposedValue, source: 'library'|'job'|'derived', questionKey, confidence: 'exact'|'fuzzy' }`. Field mapping rules live in `src/apply/field-mapping.js`: canonical question keys, label-normalization (lowercase, strip punctuation, collapse whitespace), synonym table for common ATS labels ("Full name"/"Your name", "Phone"/"Mobile number", EEO/demographic questions mapped to a `skip_by_default` class that is never auto-filled — demographic questions are drafted blank unless the user has explicitly saved answers for them). The form-schema shape is defined in `src/apply/form-schema.js` with a validator, so adapters and the engine share one contract:

    {
      url, adapter, fields: [
        { fieldId, label, type: 'text'|'textarea'|'select'|'radio'|'checkbox'|'file'|'multistep_marker',
          required: boolean, options: [ { value, label } ] | null, sectionLabel: string | null }
      ]
    }

Fixtures: save two real Greenhouse application pages and one Easy Apply modal DOM (sanitized) under `test/fixtures/apply/`, plus expected schemas. Tests prove: schema validation, mapping of a realistic Greenhouse form to >= 90% of its standard fields from a seeded library, fuzzy screener matching, EEO fields left blank, and unanswered fields reported rather than guessed. Never fabricate an answer: if the library has nothing, the field goes to `unanswered` — this is the Narrata truth-fidelity principle enforced in code.

Acceptance: `npm test` shows the new engine suite passing; the engine module imports nothing from `src/browser-bridge/` or `src/review/` (enforced by a test that reads the file and asserts on its import statements, keeping the extension-portability constraint honest).

### Milestone 3 — Greenhouse adapter and dashboard confirm flow

Scope: first end-to-end draft-and-confirm on the easiest surface. This milestone begins with the design gate (Milestone 3a in Progress): author the Prepare-flow state map — every screen state named in the UX Standards section, with real copy and error states — as `docs/plans/2026-07-10-apply-flow-design.md`, get stakeholder approval, then implement. Greenhouse application forms live at URLs matching `boards.greenhouse.io/<company>/jobs/<id>` or embedded `job-boards.greenhouse.io` pages; fields are standard HTML inputs inside `#application_form` (or `#application-form` on the newer job-boards layout) with stable name attributes (`first_name`, `last_name`, `email`, `phone`, resume upload, plus per-company custom questions rendered as labeled inputs/selects). Create `src/apply/adapters/greenhouse.js` with `matches(url)` and `extractFormSchema(document)` logic expressed as an injected JavaScript snippet the bridge executes to return the schema JSON, and `buildFillActions(plan)` translating a draft plan into bridge calls (type-text per field; upload for the resume field using the library's `file_path` answer).

Dashboard flow in `src/review/server.js` + `src/review/web/src/features/jobs/`: on the job detail panel, a primary "Prepare application" button appears when the job's apply URL matches a supported adapter (server exposes `GET /api/apply/support?jobId=...`). Clicking it: (1) prompts consent if not yet granted; (2) `POST /api/apply/draft` — server opens the apply URL in a new automation Chrome window via the bridge, extracts the schema, builds the draft plan, persists an `application_drafts` row, and returns the plan; (3) the panel renders the plan — every field, its proposed value, provenance badge, and unanswered fields highlighted with inline inputs; the user edits/fills these inline (each edit increments `corrections_count`; answers to unanswered screeners are saved to the library after an explicit "save to library" confirmation per Narrata's human-approval principle); (4) "Fill form in browser" executes the fill actions; (5) the user switches to the Chrome window, reviews, and clicks the site's own submit; (6) back in the dashboard, "I submitted it" marks the draft `submitted_by_user` and the application `applied` (reusing the existing mark-applied path). UX must follow the design skill pack (`.codex/skills/ux-flow-content/SKILL.md`, `design-system-ui`, `microinteractions-motion`) and existing action-hierarchy conventions (primary CTA on the row/panel, no destructive actions hidden in overflow).

Acceptance (behavioral, live): with the bridge running and a seeded library, pick any live Greenhouse posting; "Prepare application" produces a plan covering at minimum name/email/phone/resume plus visible custom questions; "Fill form in browser" visibly populates the real form in a new Chrome window; nothing is submitted by the system; after the user submits and confirms, the job shows `applied` in the queue. Also run a Playwright smoke (extend `scripts/playwright-dashboard-smoke.js` pattern) asserting the Prepare flow renders plan rows for a fixture job. Per the roadmap's Playwright verification gate, UI work is not complete without this artifact.

### Milestone 4 — LinkedIn Easy Apply adapter

Scope: highest-volume surface, hardest constraints. Easy Apply is a multi-step modal on `linkedin.com/jobs/view/<id>` pages behind the "Easy Apply" button. Create `src/apply/adapters/linkedin-easy-apply.js`. Constraints, all mandatory: operate only in a dedicated automation window; verify after every step that `location.href` still matches the expected job (LinkedIn navigation-drift lessons in `docs/learnings.md` — the `similar-jobs` poisoning incident); the adapter may click "Next"/"Review" pagination buttons inside the modal to traverse steps (these do not submit) but the "Submit application" button is never clicked — its detection is used only to know the draft is complete, and the engine stops there with the modal open for the user; if LinkedIn presents an unexpected dialog or layout, abort the draft cleanly, close the automation window, and report rather than guess. Easy Apply steps commonly contain contact info (pre-filled by LinkedIn), resume selection, and screener questions (text/number/select/radio); map them through the same engine, and route unanswered screeners through the same dashboard flow before filling.

Acceptance (behavioral, live): on a real Easy Apply job, the flow drafts, fills through all modal steps, and leaves the modal open at the review/submit step with everything populated; user clicks submit themselves; drift guard demonstrably aborts if the page navigates (covered by a unit test of the guard logic plus a recorded live transcript in Artifacts). ToS note for launch readiness: Easy Apply automation is against LinkedIn's user agreement even in assisted form; the consent copy (Milestone 0) and TERMS.md must state this plainly, and per-user pacing (no more than one fill action per ~1–2 seconds, human-triggered sessions only, no background/scheduled applying) is a hard design rule.

### Milestone 5 — Import-count trust (discovery's one allowed fix)

Scope: the stakeholder does not trust "Imported" versus what the portal shows. For each capture, sources already record an expected count where the page advertises one (`expectedCount` handling exists in capture paths; see learnings entries about `expectedCount >> captured`). Surface it: extend `source_run_deltas` usage so each run row persists `expected_count` (add via `addColumnIfMissing`), have each source's capture path populate it when the portal exposes a total, and render in the dashboard Sources table a per-run funnel — `Expected → Captured → Filtered → Imported` — with an explicit `n/a` when a source doesn't expose totals (never coerce missing history to zero; see learnings). Where `captured/expected < 0.6` on a live run, show an attention state on the row instead of silently looking healthy. No extraction tuning is in scope; this milestone only makes the existing truth visible.

Acceptance: run `npm run run` (or dashboard Run All) live; every source row shows the funnel with real numbers or honest `n/a`; a deliberately under-captured fixture in tests produces the attention state.

### Milestone 6 (stretch) — Lever/Ashby adapters and answer-gap queue

Lever (`jobs.lever.co/<company>/<id>/apply`) and Ashby (`jobs.ashbyhq.com/<company>/<id>`) adapters reuse the engine and the Greenhouse adapter's shape; budget them only after Milestones 3–4 meet the acceptance bar in real use. The answer-gap queue is a small dashboard view listing screener questions encountered but unanswered across drafts, so the user can batch-fill the library. Defer freely; do not let this milestone delay the acceptance week.

## Concrete Steps

All commands run from the repository root.

    npm test                       # before starting: green baseline
    npm run bridge                 # terminal A: bridge on 4315 (needed from M0 live checks onward)
    npm run review:qa              # terminal B: dashboard QA server per QA Process Contract

Implement milestones in order; commit per milestone (or finer), keeping `npm test` green at every commit. Feature branch, then push and refresh `qa/current` before requesting stakeholder QA, per `docs/learnings.md` "QA Process Contract": stakeholder QA happens only in `/Users/admin/job-finder` at `http://127.0.0.1:4311` with a visible build stamp. Live adapter verification requires macOS Chrome with "Allow JavaScript from Apple Events" enabled and Automation permission granted to the host terminal; if AppleScript returns `-2740` or `Connection Invalid`, fix permissions before touching code (learnings: "AppleScript Automation Permissions").

Expected shape of a passing engine test run:

    node --test test/apply-engine.test.js
    # pass: builds draft plan covering standard greenhouse fields
    # pass: unanswered screener reported, never guessed
    # pass: eeo fields skipped by default
    # pass: engine has no browser-bridge imports

## Validation and Acceptance

Automated: `npm test` passes with new suites for surface policy (M0), answer store (M1), engine + fixtures (M2), adapter schema extraction against saved fixtures (M3/M4), drift guard (M4), and funnel accounting (M5). Playwright smoke artifact for the dashboard Prepare flow (M3).

Behavioral: the Milestone 3 and 4 live transcripts (screen recording or annotated screenshots stored under `docs/roadmap/` daily notes) showing draft → review → fill → human submit on one real Greenhouse job and one real Easy Apply job, with zero system-initiated submissions.

Product acceptance (two weeks of real use): 10+ real applications/week via the flow; fewer than 2 manual field corrections per application by week two (`corrections_count` in `application_drafts` makes this measurable: `SELECT AVG(corrections_count) FROM application_drafts WHERE status='submitted_by_user' AND created_at > ...`). PostHog events for draft/fill/submit-confirmed/abandoned follow the canonical envelope in `docs/analytics/event-schema.md`.

## Idempotence and Recovery

Migrations use `CREATE TABLE IF NOT EXISTS` and `addColumnIfMissing`, so re-running is safe. Draft creation is re-runnable: re-drafting a job supersedes the prior `application_drafts` row (keep history; mark the old row `abandoned`). Fill actions are idempotent per field (set value, not append). If a fill session dies mid-way, the automation window can be closed and the draft re-run; nothing external has been committed because submission is always human. If a milestone must be rolled back, the apply feature is additive — reverting the branch restores the read-only status quo; `mcp_v1` behavior never changes at any point.

## Artifacts and Notes

- (add live transcripts, fixture provenance notes, and key diffs here as milestones land)

## Interfaces and Dependencies

No new npm dependencies are expected; the engine is plain ES modules, fixtures are static HTML/JSON, and similarity matching is token-based. The contracts that must exist at the end:

In `src/apply/form-schema.js`:

    export function validateFormSchema(schema) -> throws on invalid
    // schema shape documented in Milestone 2

In `src/apply/answer-store.js`:

    export function createAnswerStore(db)
    // -> { getAnswer(questionKey), findAnswerForField(field), saveAnswer(entry), recordUsage(id), listAnswers() }

In `src/apply/engine.js`:

    export function buildDraftPlan({ formSchema, answerStore, job })
    // -> { plan: [{ fieldId, label, proposedValue, source, questionKey, confidence }], unanswered: [field...] }

In `src/apply/adapters/<name>.js` (each adapter):

    export const adapterId
    export function matches(url) -> boolean
    export function buildSchemaExtractionScript() -> string   // JS injected via bridge, returns schema JSON
    export function buildFillActions(plan) -> [{ primitive: 'forms.type_text'|'forms.upload_file', fieldId, value }]

In `src/browser-bridge/primitives.js`: surface policy such that `validatePrimitiveSurfaceRegistration({ surface: 'apply_v1', ... })` accepts read primitives plus `forms.type_text`/`forms.upload_file` only, and continues to reject all write primitives for `mcp_v1`. `jobs.apply_click` and `dialogs.confirm_action` are rejected on every surface.

Revision note (2026-07-10, initial): Plan authored from stakeholder session decisions of 2026-07-10 (draft-and-confirm autonomy; shared engine with Greenhouse→Easy Apply adapter order; local SQLite answer library with Supabase-portable schema; discovery freeze except import-count trust). This is the pre-implementation check-in artifact required by CLAUDE.md for feature work.

Revision note (2026-07-10, rev 2): Added the "UX Standards (baked in, not polish)" section, the design-first gate for Milestone 3 (new Progress item 3a), and the corresponding Decision Log entry, after the stakeholder raised that the current product misses their ease-of-use/delight bar and asked whether UX should be baked in or deferred. Decision: baked in for all touched surfaces; dashboard-wide redesign explicitly out of scope as a follow-on candidate.
