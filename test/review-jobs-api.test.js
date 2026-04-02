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
      hardIncludeTerms: ["ml", "platform"],
      hardIncludeMode: "or",
      hardExcludeTerms: ["staffing", "intern"],
      scoreKeywords: ["growth", "payments"],
      scoreKeywordMode: "or",
      location: "San Francisco, CA",
      minSalary: 210000,
      datePosted: "1w",
    }),
    {
      title: "Senior Product Manager",
      hardIncludeTerms: "ml, platform",
      hardIncludeMode: "or",
      hardExcludeTerms: "staffing, intern",
      additionalKeywords: "growth, payments",
      additionalKeywordMode: "or",
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
      hardIncludeTerms: "ai, platform, ai",
      hardIncludeMode: "wat",
      hardExcludeTerms: "staffing,  intern ",
      additionalKeywords: "search, ranking",
      additionalKeywordMode: "wat",
      location: "Remote",
      minSalary: "$250,000",
      datePosted: "1d",
    }),
    {
      title: " PM ",
      hardIncludeTerms: ["ai", "platform"],
      hardIncludeMode: "and",
      hardExcludeTerms: ["staffing", "intern"],
      scoreKeywords: ["search", "ranking"],
      scoreKeywordMode: "and",
      keywords: "",
      keywordMode: "and",
      includeTerms: [],
      excludeTerms: ["staffing", "intern"],
      location: "Remote",
      minSalary: 250000,
      datePosted: "1d",
    },
  );
});

test("buildRunAllPayload maps saved search cadence to backend refresh options", () => {
  assert.deepEqual(buildRunAllPayload("cached"), { refreshProfile: "safe" });
  assert.deepEqual(buildRunAllPayload("weekly"), { refreshProfile: "safe" });
  assert.deepEqual(buildRunAllPayload("daily"), { refreshProfile: "safe" });
  assert.deepEqual(buildRunAllPayload("12h"), { refreshProfile: "safe" });
  assert.deepEqual(buildRunAllPayload("unknown"), { refreshProfile: "safe" });
});

test("normalizeSearchCriteriaDraft maps legacy keyword/include fields into the new model", () => {
  const draft = normalizeSearchCriteriaDraft({
    keywords: "ai, growth",
    keywordMode: "or",
    includeTerms: ["fintech"],
    excludeTerms: ["intern"],
  });

  assert.equal(draft.hardIncludeTerms, "");
  assert.equal(draft.hardIncludeMode, "and");
  assert.equal(draft.hardExcludeTerms, "intern");
  assert.equal(draft.additionalKeywords, "ai, growth");
  assert.equal(draft.additionalKeywordMode, "or");
});

test("applyJobStatusToDashboard moves jobs across queue groups and preserves reason notes", () => {
  const dashboard = {
    queue: [
      { id: "job-1", status: "new", notes: "", isUnread: true, firstViewedAt: null },
      {
        id: "job-2",
        status: "viewed",
        notes: "",
        isUnread: false,
        firstViewedAt: "2026-03-27T00:00:00.000Z",
      },
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
  assert.equal(updated.rejectedQueue[0].isUnread, false);
  assert.equal(typeof updated.rejectedQueue[0].firstViewedAt, "string");
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

  const payload = await runAllSourcesAndSync(requestJson, { refreshProfile: "safe" });

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
