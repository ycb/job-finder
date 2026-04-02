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
        isNew: true,
        isUnread: true,
        lastImportBatchId: "run-latest",
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
        isNew: true,
        isUnread: false,
        firstViewedAt: "2026-03-12T12:30:00.000Z",
        lastImportBatchId: "run-latest",
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
          isNew: true,
          isUnread: true,
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

test("buildJobsPresentationalModel separates new and unread cohorts", () => {
  const model = buildJobsPresentationalModel({
    dashboard: {
      queue: [
        {
          id: "job-new-unread",
          title: "Latest unread role",
          company: "Alpha",
          location: "Remote",
          bucket: "medium_signal",
          status: "new",
          isNew: true,
          isUnread: true,
        },
        {
          id: "job-new-viewed",
          title: "Latest viewed role",
          company: "Beta",
          location: "Remote",
          bucket: "medium_signal",
          status: "viewed",
          isNew: true,
          isUnread: false,
          firstViewedAt: "2026-03-12T12:00:00.000Z",
        },
        {
          id: "job-old-unread",
          title: "Older unread role",
          company: "Gamma",
          location: "Remote",
          bucket: "medium_signal",
          status: "new",
          isNew: false,
          isUnread: true,
        },
      ],
    },
    state: {
      view: "unread",
    },
  });

  assert.equal(
    model.controls.viewOptions.find((option) => option.value === "new")?.count,
    2,
  );
  assert.equal(
    model.controls.viewOptions.find((option) => option.value === "unread")?.count,
    2,
  );
  assert.deepEqual(
    model.queue.jobs.map((job) => job.id),
    ["job-new-unread", "job-old-unread"],
  );
});

test("buildJobsPresentationalModel excludes reject-bucket jobs from active views", () => {
  const model = buildJobsPresentationalModel({
    dashboard: {
      queue: [
        {
          id: "job-valid",
          title: "AI Product Manager",
          company: "Alpha",
          location: "San Francisco, CA",
          bucket: "high_signal",
          status: "new",
          isNew: true,
          isUnread: true,
        },
        {
          id: "job-reject",
          title: "Engineering Lead",
          company: "Beta",
          location: "San Francisco, CA",
          bucket: "reject",
          hardFiltered: 1,
          status: "new",
          isNew: true,
          isUnread: true,
        },
      ],
    },
    state: {
      view: "all",
    },
  });

  assert.equal(model.controls.viewOptions.find((option) => option.value === "all")?.count, 1);
  assert.equal(model.controls.viewOptions.find((option) => option.value === "new")?.count, 1);
  assert.equal(model.controls.viewOptions.find((option) => option.value === "unread")?.count, 1);
  assert.deepEqual(model.queue.jobs.map((job) => job.id), ["job-valid"]);
});

test("buildJobsPresentationalModel maps scoring buckets to user-facing labels", () => {
  const model = buildJobsPresentationalModel({
    dashboard: {
      queue: [
        {
          id: "job-best",
          title: "AI Product Manager",
          company: "Alpha",
          location: "San Francisco, CA",
          bucket: "high_signal",
          status: "new",
          isNew: true,
          isUnread: true,
        },
        {
          id: "job-possible",
          title: "Platform Product Manager",
          company: "Beta",
          location: "San Francisco, CA",
          bucket: "review_later",
          status: "new",
          isNew: true,
          isUnread: true,
        },
        {
          id: "job-low",
          title: "Director of Software & Product",
          company: "Gamma",
          location: "San Francisco, CA",
          bucket: "low_signal",
          status: "new",
          isNew: true,
          isUnread: true,
        },
      ],
    },
  });

  assert.equal(model.queue.jobs.find((job) => job.id === "job-best")?.bucketLabel, "Best match");
  assert.equal(model.queue.jobs.find((job) => job.id === "job-possible")?.bucketLabel, "Possible match");
  assert.equal(model.queue.jobs.find((job) => job.id === "job-low")?.bucketLabel, "Low signal");
});
