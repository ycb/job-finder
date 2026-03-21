import test from "node:test";
import assert from "node:assert/strict";

import { buildSourceRefreshMeta } from "../src/review/server.js";
import { buildSearchRows, presentSearchStatus } from "../src/review/web/src/features/searches/logic.js";

test("Built In stays a direct-fetch baseline source with live refresh reporting", () => {
  const meta = buildSourceRefreshMeta({
    id: "builtin-sf-ai-pm",
    type: "builtin_search"
  });

  assert.equal(meta.refreshMode, "safe");
  assert.equal(meta.statusLabel, "direct_fetch");
  assert.equal(meta.statusReason, "fetched_during_sync");
  assert.equal(meta.servedFrom, "live");
  assert.equal(meta.lastAttemptedAt, null);
  assert.equal(meta.lastAttemptOutcome, null);
  assert.equal(meta.lastAttemptError, null);
});

test("Built In source rows keep reporting sane when expected count is unknown", () => {
  const [row] = buildSearchRows([
    {
      id: "builtin-sf-ai-pm",
      name: "Built In",
      type: "builtin_search",
      searchUrl: "https://www.builtinsf.com/jobs?search=product+manager",
      enabled: true,
      authRequired: false,
      captureStatus: "ready",
      capturedAt: "2026-03-20T20:00:00.000Z",
      lastAttemptedAt: "2026-03-20T20:00:00.000Z",
      lastAttemptOutcome: "success",
      captureExpectedCount: null,
      importedCount: 19,
      avgScore: 41,
      runNewCount: 3,
      runUpdatedCount: 1,
      runUnchangedCount: 15,
      servedFrom: "live",
      statusReason: "fetched_during_sync"
    }
  ]);

  const status = presentSearchStatus(row);

  assert.equal(row.label, "Built In");
  assert.equal(row.refreshServedFrom, "live");
  assert.equal(row.refreshStatusReason, "fetched_during_sync");
  assert.equal(row.hasUnknownExpectedCount, true);
  assert.equal(row.expectedFoundCount, null);
  assert.equal(row.lastAttemptedAt, "2026-03-20T20:00:00.000Z");
  assert.equal(row.lastSuccessfulAt, "2026-03-20T20:00:00.000Z");
  assert.equal(row.lastAttemptOutcome, "success");
  assert.equal(row.avgScore, 41);
  assert.equal(status.label, "ready");
  assert.equal(status.tone, "ok");
  assert.equal(status.foundLabel, "19/?");
});
