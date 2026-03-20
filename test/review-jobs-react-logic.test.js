import test from "node:test";
import assert from "node:assert/strict";

import {
  JOBS_PAGE_SIZE,
  applyViewedStatus,
  buildJobsActiveFilterChips,
  buildJobsSalaryHistogram,
  buildJobsSalaryMatrix,
  buildJobsScoreHistogram,
  buildSourceFilterOptions,
  countJobsInSalaryRange,
  countJobsInScoreRange,
  filterJobsBySource,
  getPageForSelectedJob,
  paginateJobs,
  reconcileSelectedJobId,
  restoreViewedStatus,
  selectJobsForView,
  sortJobs,
} from "../src/review/web/src/features/jobs/logic.js";

const SOURCES = [
  { id: "linkedin-1", type: "linkedin_capture_file", name: "LinkedIn" },
  { id: "linkedin-2", type: "linkedin_capture_file", name: "LinkedIn Saved Search" },
  { id: "builtin-1", type: "builtin_search", name: "Built In AI" },
  { id: "remote-1", type: "remoteok_search", name: "RemoteOK" },
];

const ACTIVE_QUEUE = [
  {
    id: "job-new",
    title: "AI Product Lead",
    status: "new",
    bucket: "high_signal",
    score: 92,
    postedAt: "2026-03-11T12:00:00.000Z",
    updatedAt: "2026-03-11T13:00:00.000Z",
    sourceIds: ["linkedin-1", "builtin-1"],
  },
  {
    id: "job-viewed",
    title: "Platform PM",
    status: "viewed",
    bucket: "medium",
    score: 88,
    postedAt: "2026-03-10T12:00:00.000Z",
    updatedAt: "2026-03-10T12:30:00.000Z",
    sourceIds: ["linkedin-2"],
  },
  {
    id: "job-remote",
    title: "Remote Staff PM",
    status: "new",
    bucket: "medium",
    score: null,
    postedAt: "",
    updatedAt: "2026-03-09T15:00:00.000Z",
    sourceIds: ["remote-1"],
  },
];

const APPLIED_QUEUE = [
  {
    id: "job-applied",
    title: "Applied PM",
    status: "applied",
    bucket: "high_signal",
    score: 70,
    postedAt: "2026-03-08T10:00:00.000Z",
    updatedAt: "2026-03-08T10:00:00.000Z",
    sourceIds: ["builtin-1"],
  },
];

const SKIPPED_QUEUE = [
  {
    id: "job-skipped",
    title: "Skipped PM",
    status: "skip_for_now",
    bucket: "medium",
    score: 60,
    postedAt: "2026-03-07T10:00:00.000Z",
    updatedAt: "2026-03-07T10:00:00.000Z",
    sourceIds: ["linkedin-1"],
  },
];

const REJECTED_QUEUE = [
  {
    id: "job-rejected",
    title: "Rejected PM",
    status: "rejected",
    bucket: "low_signal",
    score: 40,
    postedAt: "2026-03-06T10:00:00.000Z",
    updatedAt: "2026-03-06T10:00:00.000Z",
    sourceIds: ["builtin-1"],
  },
];

test("selectJobsForView returns the expected queue slice for each jobs view", () => {
  const payload = {
    queue: ACTIVE_QUEUE,
    appliedQueue: APPLIED_QUEUE,
    skippedQueue: SKIPPED_QUEUE,
    rejectedQueue: REJECTED_QUEUE,
  };

  assert.deepEqual(
    selectJobsForView({ ...payload, view: "all" }).map((job) => job.id),
    ["job-new", "job-viewed", "job-remote"],
  );
  assert.deepEqual(
    selectJobsForView({ ...payload, view: "new" }).map((job) => job.id),
    ["job-new", "job-remote"],
  );
  assert.deepEqual(
    selectJobsForView({ ...payload, view: "best_match" }).map((job) => job.id),
    ["job-new"],
  );
  assert.deepEqual(
    selectJobsForView({ ...payload, view: "applied" }).map((job) => job.id),
    ["job-applied"],
  );
  assert.deepEqual(
    selectJobsForView({ ...payload, view: "skipped" }).map((job) => job.id),
    ["job-skipped"],
  );
  assert.deepEqual(
    selectJobsForView({ ...payload, view: "rejected" }).map((job) => job.id),
    ["job-rejected"],
  );
});

test("buildSourceFilterOptions groups counts by source kind, dedupes mixed attributions, and resets unavailable selections", () => {
  const jobs = [
    {
      id: "mixed-linkedin",
      sourceIds: ["linkedin-1", "linkedin-2"],
    },
    {
      id: "cross-posted",
      sourceIds: ["linkedin-1", "builtin-1"],
    },
  ];

  const model = buildSourceFilterOptions({
    jobs,
    sources: SOURCES,
    selectedSourceFilter: "wf",
  });

  assert.equal(model.selectedSourceFilter, "all");
  assert.deepEqual(
    model.options.map((option) => [option.kind, option.count]),
    [
      ["li", 2],
      ["bi", 1],
      ["ro", 0],
    ],
  );
});

test("filterJobsBySource keeps all jobs for all filter and narrows to matching source kinds", () => {
  const allJobs = filterJobsBySource(ACTIVE_QUEUE, {
    sources: SOURCES,
    sourceFilter: "all",
  });
  assert.equal(allJobs.length, ACTIVE_QUEUE.length);

  const linkedinJobs = filterJobsBySource(ACTIVE_QUEUE, {
    sources: SOURCES,
    sourceFilter: "li",
  });
  assert.deepEqual(
    linkedinJobs.map((job) => job.id),
    ["job-new", "job-viewed"],
  );

  const unknownJobs = filterJobsBySource(ACTIVE_QUEUE, {
    sources: SOURCES,
    sourceFilter: "wf",
  });
  assert.deepEqual(unknownJobs, []);
});

test("sortJobs orders by score or date with stable fallbacks", () => {
  const jobs = [
    {
      id: "alpha",
      title: "Alpha",
      score: 90,
      postedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    },
    {
      id: "beta",
      title: "Beta",
      score: 90,
      postedAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
    },
    {
      id: "gamma",
      title: "Gamma",
      score: 75,
      postedAt: "",
      updatedAt: "2026-03-06T00:00:00.000Z",
    },
    {
      id: "delta",
      title: "Delta",
      score: null,
      postedAt: "",
      updatedAt: "",
    },
  ];

  assert.deepEqual(
    sortJobs(jobs, "score").map((job) => job.id),
    ["beta", "alpha", "gamma", "delta"],
  );
  assert.deepEqual(
    sortJobs(jobs, "date").map((job) => job.id),
    ["gamma", "beta", "alpha", "delta"],
  );
});

test("paginateJobs clamps the page and returns the current slice metadata", () => {
  const jobs = Array.from({ length: JOBS_PAGE_SIZE + 3 }, (_, index) => ({
    id: `job-${index + 1}`,
  }));

  const page = paginateJobs(jobs, 99, JOBS_PAGE_SIZE);

  assert.equal(page.page, 2);
  assert.equal(page.totalPages, 2);
  assert.equal(page.pageStart, JOBS_PAGE_SIZE);
  assert.equal(page.pageEnd, JOBS_PAGE_SIZE + 3);
  assert.deepEqual(
    page.items.map((job) => job.id),
    ["job-11", "job-12", "job-13"],
  );
});

test("reconcileSelectedJobId and getPageForSelectedJob keep selection aligned to the filtered queue", () => {
  const jobs = Array.from({ length: JOBS_PAGE_SIZE + 2 }, (_, index) => ({
    id: `job-${index + 1}`,
  }));

  assert.equal(reconcileSelectedJobId(jobs, "job-3"), "job-3");
  assert.equal(reconcileSelectedJobId(jobs, "missing"), "job-1");
  assert.equal(reconcileSelectedJobId([], "job-3"), null);

  assert.equal(getPageForSelectedJob(jobs, "job-12", JOBS_PAGE_SIZE), 2);
  assert.equal(getPageForSelectedJob(jobs, "missing", JOBS_PAGE_SIZE), 1);
});

test("applyViewedStatus only marks new active jobs as viewed and can restore them", () => {
  const queues = {
    queue: ACTIVE_QUEUE,
    appliedQueue: [
      ...APPLIED_QUEUE,
      {
        id: "job-new",
        status: "applied",
      },
    ],
    skippedQueue: SKIPPED_QUEUE,
    rejectedQueue: REJECTED_QUEUE,
  };

  const mutation = applyViewedStatus(queues, "job-new");
  assert.equal(mutation.changed, true);
  assert.equal(mutation.previousStatus, "new");
  assert.equal(mutation.queues.queue.find((job) => job.id === "job-new").status, "viewed");
  assert.equal(mutation.queues.appliedQueue.find((job) => job.id === "job-new").status, "viewed");

  const restored = restoreViewedStatus(mutation.queues, "job-new", mutation.previousStatus);
  assert.equal(restored.queue.find((job) => job.id === "job-new").status, "new");
  assert.equal(restored.appliedQueue.find((job) => job.id === "job-new").status, "new");

  const noOp = applyViewedStatus(queues, "job-viewed");
  assert.equal(noOp.changed, false);
  assert.equal(noOp.previousStatus, null);
  assert.equal(noOp.queues, queues);
});

test("buildJobsSalaryMatrix groups salary buckets for widgets", () => {
  const matrix = buildJobsSalaryMatrix([
    { id: "a", salaryText: "$100,000" },
    { id: "b", salaryText: "$150,000" },
    { id: "c", salaryText: "$220,000" },
    { id: "d", salaryText: "$260,000" },
  ]);

  assert.equal(matrix.withSalary.count, 4);
  assert.equal(matrix.minToAvg.count, 2);
  assert.equal(matrix.aboveAvg.count, 2);
  assert.equal(matrix.bestPaying.count, 1);
});

test("buildJobsSalaryHistogram returns an ordered salary distribution with counts and bounds", () => {
  const histogram = buildJobsSalaryHistogram(
    [
      { id: "a", salaryText: "$100,000" },
      { id: "b", salaryText: "$150,000" },
      { id: "c", salaryText: "$220,000" },
      { id: "d", salaryText: "$260,000" },
    ],
    { bucketCount: 4 },
  );

  assert.equal(histogram.withValueCount, 4);
  assert.equal(histogram.min, 100000);
  assert.equal(histogram.max, 260000);
  assert.equal(histogram.buckets.length, 4);
  assert.equal(
    histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    4,
  );
  assert.equal(histogram.buckets[0].min, 100000);
  assert.equal(histogram.buckets.at(-1).max, 260000);
});

test("buildJobsScoreHistogram returns an ordered score distribution with counts and bounds", () => {
  const histogram = buildJobsScoreHistogram(
    [
      { id: "a", score: 35 },
      { id: "b", score: 65 },
      { id: "c", score: 72 },
      { id: "d", score: 92 },
    ],
    { bucketCount: 5 },
  );

  assert.equal(histogram.withValueCount, 4);
  assert.equal(histogram.min, 35);
  assert.equal(histogram.max, 92);
  assert.equal(histogram.buckets.length, 5);
  assert.equal(
    histogram.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    4,
  );
  assert.equal(histogram.buckets[0].min, 35);
  assert.equal(histogram.buckets.at(-1).max, 92);
});

test("buildJobsActiveFilterChips unifies explicit and widget-driven filters into one chip rail", () => {
  const chips = buildJobsActiveFilterChips({
    sourceFilter: "li",
    sourceOptions: [{ kind: "li", label: "LinkedIn", count: 4 }],
    postedFilter: "1w",
    postedOptions: [{ value: "1w", label: "1 week", count: 3 }],
    salaryRangeFilter: { min: 180000, max: 260000 },
    salaryPresenceFilter: "missing_salary",
    widgetKeywordFilter: "growth",
    widgetTitleFilter: "Senior Product Manager",
  });

  assert.deepEqual(
    chips.map((chip) => chip.label),
    [
      "Source: LinkedIn",
      "Posted: 1 week",
      "Salary: $180,000 - $260,000",
      "Salary: missing salary",
      "Keyword: growth",
      "Title: Senior Product Manager",
    ],
  );
});

test("countJobsInSalaryRange and countJobsInScoreRange return exact matches for the selected range", () => {
  const jobs = [
    { id: "a", salaryText: "$120,000", score: 35 },
    { id: "b", salaryText: "$180,000", score: 62 },
    { id: "c", salaryText: "$245,000", score: 78 },
    { id: "d", salaryText: "$310,000", score: 91 },
    { id: "e", salaryText: "", score: null },
  ];

  assert.equal(countJobsInSalaryRange(jobs, { min: 170000, max: 260000 }), 2);
  assert.equal(countJobsInSalaryRange(jobs, { min: 300000, max: 320000 }), 1);
  assert.equal(countJobsInSalaryRange(jobs, null), 4);

  assert.equal(countJobsInScoreRange(jobs, { min: 60, max: 90 }), 2);
  assert.equal(countJobsInScoreRange(jobs, { min: 90, max: 100 }), 1);
  assert.equal(countJobsInScoreRange(jobs, null), 4);
});
