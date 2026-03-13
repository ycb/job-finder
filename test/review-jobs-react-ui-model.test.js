import test from "node:test";
import assert from "node:assert/strict";

import { buildJobsPresentationalModel } from "../src/review/web/src/features/jobs/presentational-model.js";

test("buildJobsPresentationalModel falls back to mock jobs and criteria when dashboard is empty", () => {
  const model = buildJobsPresentationalModel();

  assert.equal(model.criteria.title, "Senior Product Manager");
  assert.equal(model.findJobsLabel, "Find Jobs");
  assert.equal(model.controls.selectedView, "all");
  assert.equal(model.queue.jobs.length > 0, true);
  assert.equal(model.detail.job !== null, true);
  assert.equal(model.controls.sourceOptions[0].label, "All Results");
});

test("buildJobsPresentationalModel respects view, source, sort, and page state against dashboard queues", () => {
  const dashboard = {
    searchCriteria: {
      title: "Principal Product Manager",
      keywords: "platform, analytics",
      keywordMode: "or",
      includeTerms: ["api"],
      excludeTerms: ["intern"],
      location: "Remote",
      minSalary: 210000,
      datePosted: "1d",
    },
    sources: [
      { id: "source-a", name: "LinkedIn", type: "linkedin" },
      { id: "source-b", name: "Google Jobs", type: "google" },
    ],
    queue: [
      {
        id: "job-a",
        title: "A role",
        company: "Alpha",
        location: "Remote",
        bucket: "high_signal",
        status: "new",
        score: 92,
        confidence: 81,
        sourceIds: ["source-a"],
        reviewTarget: { url: "https://example.com/a", label: "Open role" },
        postedAt: "2026-03-10T12:00:00.000Z",
      },
      {
        id: "job-b",
        title: "B role",
        company: "Beta",
        location: "Remote",
        bucket: "medium_signal",
        status: "viewed",
        score: 78,
        confidence: 70,
        sourceIds: ["source-b"],
        reviewTarget: { url: "https://example.com/b", label: "Open role" },
        postedAt: "2026-03-12T12:00:00.000Z",
      },
    ],
    appliedQueue: [
      {
        id: "job-c",
        title: "C role",
        company: "Gamma",
        location: "Austin, TX",
        bucket: "medium_signal",
        status: "applied",
        score: 85,
        confidence: 72,
        sourceIds: ["source-a"],
        reviewTarget: { url: "https://example.com/c", label: "Open role" },
        postedAt: "2026-03-11T12:00:00.000Z",
      },
    ],
  };

  const model = buildJobsPresentationalModel({
    dashboard,
    state: {
      criteria: dashboard.searchCriteria,
      view: "all",
      source: "source-b",
      sort: "date",
      page: 1,
      selectedJobId: "job-b",
    },
  });

  assert.equal(model.criteria.title, "Principal Product Manager");
  assert.equal(model.criteria.keywordMode, "or");
  assert.equal(model.controls.selectedSource, "source-b");
  assert.equal(model.queue.jobs.length, 1);
  assert.equal(model.queue.jobs[0].id, "job-b");
  assert.equal(model.detail.job.id, "job-b");
  assert.equal(
    model.controls.viewOptions.find((option) => option.value === "applied")?.count,
    1,
  );
});

test("buildJobsPresentationalModel preserves empty queue and empty criteria from a real dashboard", () => {
  const model = buildJobsPresentationalModel({
    dashboard: {
      searchCriteria: {},
      queue: [],
      appliedQueue: [],
      skippedQueue: [],
      rejectedQueue: [],
      sources: [],
    },
  });

  assert.equal(model.queue.total, 0);
  assert.deepEqual(model.queue.jobs, []);
  assert.equal(model.criteria.title, "");
  assert.equal(model.criteria.keywords, "");
  assert.equal(model.criteria.includeTerms, "");
  assert.equal(model.criteria.excludeTerms, "");
  assert.equal(model.criteria.location, "");
  assert.equal(model.criteria.minSalary, "");
  assert.equal(model.criteria.datePosted, "");
});

test("buildJobsPresentationalModel keeps best-match counts aligned with rendered queue", () => {
  const model = buildJobsPresentationalModel({
    dashboard: {
      queue: [
        {
          id: "job-new",
          title: "New high-signal role",
          company: "Alpha",
          location: "Remote",
          bucket: "high_signal",
          status: "new",
        },
        {
          id: "job-rejected",
          title: "Rejected high-signal role",
          company: "Beta",
          location: "Remote",
          bucket: "high_signal",
          status: "rejected",
        },
      ],
    },
    state: {
      view: "best_match",
    },
  });

  assert.equal(
    model.controls.viewOptions.find((option) => option.value === "best_match")?.count,
    1,
  );
  assert.equal(model.queue.total, 1);
  assert.equal(model.queue.jobs[0].id, "job-new");
});
