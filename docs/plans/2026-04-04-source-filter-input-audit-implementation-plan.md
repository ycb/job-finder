# Source Filter Input Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an automated audit that maps each source’s filter controls (including input types) and writes JSON + Markdown artifacts.

**Architecture:** Add a small script that opens each source in a new Chrome window, runs a JS probe to extract filter controls, normalizes results, and writes analysis artifacts under `docs/analysis/`.

**Tech Stack:** Node.js, existing Chrome AppleScript bridge, URL builder, unit tests.

---

### Task 1: Add audit script skeleton + failing test

**Files:**
- Create: `/Users/admin/.codex/worktrees/51f6/job-finder/scripts/audit-source-filter-inputs.js`
- Create: `/Users/admin/.codex/worktrees/51f6/job-finder/test/audit-source-filter-inputs.test.js`

**Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAuditResult } from "../scripts/audit-source-filter-inputs.js";

test("normalizeAuditResult returns stable filter map shape", () => {
  const result = normalizeAuditResult({
    sourceId: "yc-product-jobs",
    filters: [{ inputType: "typeahead", label: "Location" }]
  });

  assert.equal(result.sourceId, "yc-product-jobs");
  assert.equal(Array.isArray(result.filters), true);
  assert.equal(result.filters[0].inputType, "typeahead");
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/audit-source-filter-inputs.test.js`  
Expected: FAIL (module missing).

**Step 3: Write minimal implementation**

```js
export function normalizeAuditResult(raw) {
  return {
    sourceId: String(raw.sourceId || ""),
    sourceType: String(raw.sourceType || ""),
    searchUrl: String(raw.searchUrl || ""),
    pageTitle: String(raw.pageTitle || ""),
    finalUrl: String(raw.finalUrl || ""),
    status: String(raw.status || "ok"),
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : null,
    filters: Array.isArray(raw.filters) ? raw.filters : []
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/audit-source-filter-inputs.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/audit-source-filter-inputs.js test/audit-source-filter-inputs.test.js
git commit -m "feat: add source filter audit scaffold"
```

### Task 2: Implement Chrome probe + filter extraction

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/scripts/audit-source-filter-inputs.js`
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/src/browser-bridge/providers/chrome-applescript.js`
- Test: `/Users/admin/.codex/worktrees/51f6/job-finder/test/audit-source-filter-inputs.test.js`

**Step 1: Write the failing test**

```js
import { classifyFilterElement } from "../scripts/audit-source-filter-inputs.js";

test("classifyFilterElement tags typeahead inputs", () => {
  const el = { role: "combobox", ariaAutocomplete: "list" };
  assert.equal(classifyFilterElement(el), "typeahead");
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/audit-source-filter-inputs.test.js`  
Expected: FAIL (function missing).

**Step 3: Write minimal implementation**

```js
export function classifyFilterElement(meta) {
  if (meta.role === "combobox" || meta.ariaAutocomplete === "list") return "typeahead";
  if (meta.type === "checkbox") return "checkbox";
  if (meta.tag === "SELECT") return "select";
  return "text";
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/audit-source-filter-inputs.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/audit-source-filter-inputs.js test/audit-source-filter-inputs.test.js
git commit -m "feat: classify filter input types"
```

### Task 3: Wire audit runner + artifacts

**Files:**
- Modify: `/Users/admin/.codex/worktrees/51f6/job-finder/scripts/audit-source-filter-inputs.js`
- Create: `/Users/admin/.codex/worktrees/51f6/job-finder/docs/analysis/2026-04-04-source-filter-input-audit.md`
- Create: `/Users/admin/.codex/worktrees/51f6/job-finder/docs/analysis/2026-04-04-source-filter-input-audit.json`

**Step 1: Write the failing test**

```js
import fs from "node:fs";
import path from "node:path";
import { renderAuditMarkdown } from "../scripts/audit-source-filter-inputs.js";

test("renderAuditMarkdown returns a markdown summary", () => {
  const md = renderAuditMarkdown([{ sourceId: "yc-product-jobs", filters: [] }]);
  assert.match(md, /yc-product-jobs/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/audit-source-filter-inputs.test.js`  
Expected: FAIL (function missing).

**Step 3: Write minimal implementation**

```js
export function renderAuditMarkdown(rows) {
  return rows.map(row => `- ${row.sourceId}: ${row.filters.length} filters`).join("\\n");
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/audit-source-filter-inputs.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/audit-source-filter-inputs.js test/audit-source-filter-inputs.test.js docs/analysis/2026-04-04-source-filter-input-audit.md docs/analysis/2026-04-04-source-filter-input-audit.json
git commit -m "feat: add source filter input audit artifacts"
```
