# Caching Policy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a simple, transparent caching experience for users while giving internal developers a safe way to probe refresh intervals without risking bans.

**Architecture:** Keep one user-visible refresh behavior (`Refresh`) and enforce source-specific throttling internally. Add a policy engine + lightweight refresh state store to decide live vs cache, expose clear status in API/UI, and add a dev-only `probe` profile with strict guardrails and telemetry.

**Tech Stack:** Node.js (ESM), local JSON capture files, existing SQLite job store, local HTTP review server, Node test runner (`node --test`).

---

### Task 1: Define Refresh Policy Engine (Pure Functions)

**Files:**
- Create: `src/sources/refresh-policy.js`
- Test: `test/refresh-policy.test.js`

**Step 1: Write failing tests for policy defaults**

Cover:
- source risk classes by type (`linkedin_capture_file`, `wellfound_search`, `google_search`, etc.)
- default safe constraints (`minIntervalMinutes`, `dailyLiveCap`, `cooldownMinutes`)
- profile behavior (`safe`, `probe`, `mock`)

**Step 2: Run test to verify it fails**

Run: `npm test -- test/refresh-policy.test.js`  
Expected: `ERR_MODULE_NOT_FOUND` or assertion failures.

**Step 3: Implement minimal policy module**

Export pure functions:
- `getSourceRiskClass(source)`
- `getRefreshPolicyForSource(source, { profile })`
- `isLiveRefreshAllowed(policyState)`
- `computeNextEligibleAt(policyState, now)`

**Step 4: Run test to verify it passes**

Run: `npm test -- test/refresh-policy.test.js`  
Expected: pass.

**Step 5: Commit**

```bash
git add src/sources/refresh-policy.js test/refresh-policy.test.js
git commit -m "feat: add refresh policy engine for source throttling"
```

### Task 2: Add Refresh Runtime State Store

**Files:**
- Create: `src/sources/refresh-state.js`
- Create: `data/refresh-state.example.json`
- Test: `test/refresh-state.test.js`

**Step 1: Write failing tests for refresh state transitions**

Cover:
- initialize missing state
- record live success/failure/challenge per source
- compute rolling daily count
- enforce cooldown after challenge

**Step 2: Run test to verify it fails**

Run: `npm test -- test/refresh-state.test.js`  
Expected: failing import or assertions.

**Step 3: Implement minimal file-backed state**

Implement read/write helpers for `data/refresh-state.json`:
- per-source `lastLiveAt`
- `events` (timestamp + outcome)
- `cooldownUntil`

**Step 4: Run test to verify it passes**

Run: `npm test -- test/refresh-state.test.js`  
Expected: pass.

**Step 5: Commit**

```bash
git add src/sources/refresh-state.js data/refresh-state.example.json test/refresh-state.test.js
git commit -m "feat: persist refresh state and cooldown metadata"
```

### Task 3: Integrate Policy Decisions into Capture Flow

**Files:**
- Modify: `src/cli.js`
- Modify: `src/review/server.js`
- Modify: `src/sources/cache-policy.js`
- Test: `test/capture-refresh-decision.test.js`

**Step 1: Write failing tests for live-vs-cache decisions**

Cover:
- cache used when policy blocks live
- live allowed when eligible
- `mock` profile always uses cache/capture file
- `probe` profile uses shorter intervals but still respects caps/cooldowns

**Step 2: Run test to verify it fails**

Run: `npm test -- test/capture-refresh-decision.test.js`  
Expected: failures.

**Step 3: Implement decision plumbing**

- Add refresh profile resolution (env + optional request flag):
  - `JOB_FINDER_REFRESH_PROFILE=safe|probe|mock`
- In `runSourceCapture`/`runAllCaptures`, replace bare `isSourceCaptureFresh` checks with policy decision using refresh state + cache summary.
- Standardize capture response payload fields:
  - `servedFrom: "live" | "cache"`
  - `policyReason`
  - `nextEligibleAt`

**Step 4: Run targeted tests**

Run:
- `npm test -- test/capture-refresh-decision.test.js`
- `npm test -- test/cache-policy.test.js`

Expected: pass.

**Step 5: Commit**

```bash
git add src/cli.js src/review/server.js src/sources/cache-policy.js test/capture-refresh-decision.test.js
git commit -m "feat: enforce refresh policy in capture run paths"
```

### Task 4: Detect and Record Challenge Signals

**Files:**
- Modify: `src/browser-bridge/providers/chrome-applescript.js`
- Modify: `src/sources/refresh-state.js`
- Test: `test/challenge-signal-detection.test.js`

**Step 1: Write failing tests for challenge detection**

Cover:
- detect anti-bot/captcha/challenge patterns in capture error payload/message
- state transitions to cooldown

**Step 2: Run test to verify it fails**

Run: `npm test -- test/challenge-signal-detection.test.js`  
Expected: fail.

**Step 3: Implement minimal challenge detection**

- Add helper to classify capture outcomes: `success | transient_error | challenge`.
- On challenge, write cooldown in refresh state.

**Step 4: Run targeted tests**

Run:
- `npm test -- test/challenge-signal-detection.test.js`
- `npm test -- test/refresh-state.test.js`

Expected: pass.

**Step 5: Commit**

```bash
git add src/browser-bridge/providers/chrome-applescript.js src/sources/refresh-state.js test/challenge-signal-detection.test.js
git commit -m "feat: detect bot challenges and enforce source cooldown"
```

### Task 5: Expose Clear Refresh Status in Dashboard API

**Files:**
- Modify: `src/review/server.js`
- Test: `test/dashboard-refresh-status.test.js`

**Step 1: Write failing test for source refresh status shape**

Expect each source in `/api/dashboard` includes:
- `refreshMode` (`safe|probe|mock`)
- `servedFrom`
- `lastLiveAt`
- `nextEligibleAt`
- `cooldownUntil`
- `statusLabel`
- `statusReason`

**Step 2: Run test to verify it fails**

Run: `npm test -- test/dashboard-refresh-status.test.js`  
Expected: fail.

**Step 3: Implement API enrichment**

In source mapping for dashboard response, include policy + refresh state + cache summary fields so UI can render clear status without inference.

**Step 4: Run targeted test**

Run: `npm test -- test/dashboard-refresh-status.test.js`  
Expected: pass.

**Step 5: Commit**

```bash
git add src/review/server.js test/dashboard-refresh-status.test.js
git commit -m "feat: expose explicit refresh status in dashboard API"
```

### Task 6: Simplify UI Messaging for Refresh Behavior

**Files:**
- Modify: `src/review/server.js`
- Test: `test/review-refresh-ui-copy.test.js` (string/render-level assertions)

**Step 1: Write failing UI copy/render tests**

Verify UI shows per-source:
- last live fetch
- cache age / served from cache vs live
- next eligible live time
- clear reason when live is blocked (`cooldown`, `min interval`, `daily cap`)

**Step 2: Run test to verify it fails**

Run: `npm test -- test/review-refresh-ui-copy.test.js`  
Expected: fail.

**Step 3: Implement UI changes**

- Keep one primary action: `Refresh`.
- After click, render explicit result message:
  - “Live refresh started”
  - “Using cache (next live at …)”
  - “Cooldown after challenge until …”

**Step 4: Run targeted test**

Run: `npm test -- test/review-refresh-ui-copy.test.js`  
Expected: pass.

**Step 5: Commit**

```bash
git add src/review/server.js test/review-refresh-ui-copy.test.js
git commit -m "feat: add clear per-source refresh status and messaging in UI"
```

### Task 7: Developer Probe Workflow + Documentation

**Files:**
- Modify: `README.md`
- Modify: `config/sources.example.json`
- Modify: `src/cli.js`
- Test: `test/refresh-profile-cli.test.js`

**Step 1: Write failing test for refresh profile parsing**

Cover:
- default profile is `safe`
- accepts `probe` and `mock`
- rejects unknown profile with actionable error

**Step 2: Run test to verify it fails**

Run: `npm test -- test/refresh-profile-cli.test.js`  
Expected: fail.

**Step 3: Implement and document**

- Add CLI/env parsing for refresh profile.
- Document:
  - user behavior (“Refresh may use cache; status tells you why”)
  - dev behavior (`JOB_FINDER_REFRESH_PROFILE=probe`)
  - anti-abuse guardrails and cooldown behavior.

**Step 4: Run targeted tests + smoke**

Run:
- `npm test -- test/refresh-profile-cli.test.js`
- `npm test`

Expected: all pass.

**Step 5: Commit**

```bash
git add README.md config/sources.example.json src/cli.js test/refresh-profile-cli.test.js
git commit -m "docs+feat: add refresh profile workflow and caching transparency"
```

### Task 8: Final Product Task (Post-Build)

**Files:**
- Create: `docs/plans/2026-03-xx-digest-automation-spec-draft.md` (date of execution)

**Step 1: Validate build completion with user**

Confirm caching behavior is understandable in UI and acceptable in real use.

**Step 2: Draft digest/automation spec with user**

Produce a focused spec covering:
- digest cadence options
- inclusion criteria (new high-signal, net-new by source, applied/skipped deltas)
- automation trigger model
- failure/quiet-period behavior

**Step 3: Capture acceptance criteria**

Write explicit success metrics before implementation.

**Step 4: Commit spec doc**

```bash
git add docs/plans/2026-03-xx-digest-automation-spec-draft.md
git commit -m "docs: draft digest and automation spec with user"
```

---

## Verification Gate (Before Merge)

Run:

```bash
npm test
npm run run
```

Expected:
- Tests all pass.
- `run` output clearly indicates, per source, whether it used live or cache and why.

## Rollout Notes

- Keep feature flag fallback for first rollout:
  - `JOB_FINDER_REFRESH_POLICY_ENABLED=1` (default on after validation).
- If unexpected behavior appears, disable flag and revert to existing TTL-only behavior while retaining telemetry data.
