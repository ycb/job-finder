import test from "node:test";
import assert from "node:assert/strict";

import {
  applyJobStatusToDashboard,
  buildRunAllPayload,
  buildSearchCriteriaPayload,
  normalizeSearchCriteriaDraft,
  runAllSourcesAndSync,
} from "../src/review/web/src/features/jobs/api.js";

test("normalizeSearchCriteriaDraft hydrates string form fields from dashboard criteria", () => {
  assert.deepEqual(
    normalizeSearchCriteriaDraft({
      title: "Senior Product Manager",
      keywords: "growth",
      keywordMode: "or",
      includeTerms: ["ai", "platform"],
      excludeTerms: ["staffing", "intern"],
      location: "San Francisco, CA",
      minSalary: 210000,
      datePosted: "1w",
    }),
    {
      title: "Senior Product Manager",
      keywords: "growth",
      keywordMode: "or",
      includeTerms: "ai, platform",
      excludeTerms: "staffing, intern",
      location: "San Francisco, CA",
      minSalary: "210000",
      datePosted: "1w",
    },
  );
});

test("buildSearchCriteriaPayload normalizes comma-separated terms and numeric salary", () => {
  assert.deepEqual(
    buildSearchCriteriaPayload({
      title: " PM ",
      keywords: "search, ranking",
      keywordMode: "wat",
      includeTerms: "ai, platform, ai",
      excludeTerms: "staffing,  intern ",
      location: "Remote",
      minSalary: "$250,000",
      datePosted: "1d",
    }),
    {
      title: " PM ",
      keywords: "search, ranking",
      keywordMode: "and",
      includeTerms: ["ai", "platform"],
      excludeTerms: ["staffing", "intern"],
      location: "Remote",
      minSalary: 250000,
      datePosted: "1d",
    },
  );
});

test("buildRunAllPayload maps saved search cadence to backend refresh options", () => {
  assert.deepEqual(buildRunAllPayload("cached"), { refreshProfile: "mock" });
  assert.deepEqual(buildRunAllPayload("weekly"), { refreshProfile: "safe", cacheTtlHours: 168 });
  assert.deepEqual(buildRunAllPayload("daily"), { refreshProfile: "safe", cacheTtlHours: 24 });
  assert.deepEqual(buildRunAllPayload("12h"), { refreshProfile: "safe", cacheTtlHours: 12 });
  assert.deepEqual(buildRunAllPayload("unknown"), { refreshProfile: "safe", cacheTtlHours: 12 });
});

test("applyJobStatusToDashboard moves jobs across queue groups and preserves reason notes", () => {
  const dashboard = {
    queue: [
      { id: "job-1", status: "new", notes: "" },
      { id: "job-2", status: "viewed", notes: "" },
    ],
    appliedQueue: [],
    skippedQueue: [],
    rejectedQueue: [],
  };

  const updated = applyJobStatusToDashboard(dashboard, "job-1", "rejected", "already closed");

  assert.equal(updated.queue.some((job) => job.id === "job-1"), false);
  assert.equal(updated.rejectedQueue.length, 1);
  assert.equal(updated.rejectedQueue[0].id, "job-1");
  assert.equal(updated.rejectedQueue[0].status, "rejected");
  assert.equal(updated.rejectedQueue[0].notes, "already closed");
  assert.equal(dashboard.rejectedQueue.length, 0);
});

test("runAllSourcesAndSync triggers sync-score when run-all omits sync details", async () => {
  const calls = [];
  const requestJson = async (pathname, options = {}) => {
    calls.push([pathname, options.method || "GET"]);
    if (pathname === "/api/sources/run-all") {
      return { ok: true, captures: [] };
    }
    if (pathname === "/api/sync-score") {
      return { ok: true, sync: { collected: 3 } };
    }
    throw new Error(`unexpected path: ${pathname}`);
  };

  const payload = await runAllSourcesAndSync(requestJson, { refreshProfile: "safe", cacheTtlHours: 24 });

  assert.deepEqual(calls, [
    ["/api/sources/run-all", "POST"],
    ["/api/sync-score", "POST"],
  ]);
  assert.deepEqual(payload, {
    ok: true,
    captures: [],
    sync: { collected: 3 },
  });
});
