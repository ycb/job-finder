# MVP Sources Parallel Handoff Packet

## Header

- `lane_id`: multi-lane controller packet
- `priority`: `P0/P1`
- `theme`: MVP source-slate delivery and source-quality reliability
- `branch`: `codex/controller-source-data-quality`
- `worktree`: `/Users/admin/.codex/worktrees/51f6/job-finder`
- `dependency`: soft-coupled lanes, controller-integrated

## Lane Map

## Reusable Artifact Requirement

Every MVP source lane must leave behind reusable artifacts for future source addition. A lane is not complete if it only lands adapter code.

Required reusable outputs per source:

- source type classification
  - `http_direct`, `browser_auth`, `company_portal`, or other explicit type
- search-construction notes
  - what criteria map cleanly
  - what criteria are unsupported
  - what URL/state semantics are source-specific
- extraction contract
  - minimum fields required for trustworthy ingest
  - detail-enrichment policy
  - canonical review-target rule
- quality rubric notes
  - expected yield/redundancy
  - common failure modes
  - challenge/degradation behavior
- verification pattern
  - source-specific parser tests
  - registration/reporting tests
  - smoke or sample-capture proof where relevant

Artifact destination:

- source-specific backlog/spec doc if new
- roadmap progress note when the lane lands
- tests/docs that make the source pattern reusable by the future `add a source` workflow

### L1 — LinkedIn

- One-sentence objective: fix LinkedIn source-specific search construction and extraction quality so captured rows are canonical and relevant.
- Acceptance criteria:
  1. LinkedIn-specific tests cover malformed/off-target row regressions.
  2. Extraction/search-construction fixes stay confined to LinkedIn-related files.
  3. Targeted verification passes.
- Handoff launch evidence:
  - `launched_by`: controller
  - `launched_at`: `2026-03-20`
  - `session_id_or_link`: `019d0a14-d26b-7240-b5ad-c4c12f751c64`

### L2 — Indeed

- One-sentence objective: make Indeed degraded-but-honest and shippable under intermittent Cloudflare interference.
- Acceptance criteria:
  1. Cloudflare / verification gates classify as `challenge`.
  2. Challenge/error reporting is user-honest and owner-actionable.
  3. Targeted verification passes and live QA can distinguish last attempted vs last successful.
- Handoff launch evidence:
  - `launched_by`: controller
  - `launched_at`: `2026-03-20`
  - `session_id_or_link`: `019d0a14-dc38-76f1-a45c-bb3fb9c8dba3`

### L3 — ZipRecruiter

- One-sentence objective: fix ZipRecruiter so `View Job` opens the job-specific posting rather than the generic company jobs surface.
- Acceptance criteria:
  1. Posting-specific `lk=` deep links are preserved through import and review.
  2. `View Job` opens the intended posting, not the generic company list.
  3. Targeted verification passes.
- Handoff launch evidence:
  - `launched_by`: controller
  - `launched_at`: `2026-03-20`
  - `session_id_or_link`: `019d0a27-f116-79b0-b5b5-7daf3449269f`

### L4 — YC Jobs

- One-sentence objective: build YC Jobs as a direct unauth MVP source with working capture, import, reporting, and review integration.
- Acceptance criteria:
  1. Source adapter exists and is wired into captures and review.
  2. Targeted tests cover source-specific parsing and URL construction.
  3. Dashboard/reporting path recognizes the source coherently.
  4. Lane leaves behind reusable direct-source guidance for future source addition.
- Handoff launch evidence:
  - `launched_by`: controller
  - `launched_at`: `2026-03-20`
  - `session_id_or_link`: `019d0a27-f834-7962-8c0b-b6340f0aaf24`

### L5 — Levels.fyi

- One-sentence objective: build Levels.fyi as a direct unauth MVP source with working capture, import, reporting, and review integration.
- Acceptance criteria:
  1. Source adapter exists and is wired into captures and review.
  2. Source-specific parsing and URL construction are covered by targeted tests.
  3. Salary-rich metadata survives into imported jobs where available.
  4. Lane leaves behind reusable direct-source guidance for future source addition.
- Handoff launch evidence:
  - `launched_by`: controller
  - `launched_at`: `2026-03-20`
  - `session_id_or_link`: `019d0d86-efcb-71f2-aa59-c07777aa6732`

### L6 — Built In Baseline Guard

- One-sentence objective: guard Built In as the healthy MVP baseline and codify/verify the regression rubric that other launch sources must meet.
- Acceptance criteria:
  1. Built In baseline behavior is captured in targeted verification.
  2. Regression guard exists for source-row funnel/reporting sanity.
  3. Output produces a concise MVP-source health rubric.
  4. Output is reusable as an acceptance reference for future direct non-auth sources.
- Handoff launch evidence:
  - `launched_by`: controller
  - `launched_at`: `2026-03-20`
  - `session_id_or_link`: `019d0d86-fbbd-7270-a7b9-d32ac13700f2`

## Stop Conditions

- Stop and escalate if:
  - a lane needs broad UI edits
  - a lane discovers missing baseline commits on `main`
  - a lane needs to change MVP scope/priority without explicit stakeholder approval
