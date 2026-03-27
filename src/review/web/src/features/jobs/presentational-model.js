import { filterActiveQueueJobs } from "./logic.js";

const JOBS_PAGE_SIZE = 6;

const DEFAULT_CRITERIA = {
  title: "Senior Product Manager",
  keywords: "payments, growth",
  keywordMode: "and",
  includeTerms: "AI, B2B",
  excludeTerms: "intern, contract",
  location: "San Francisco, CA",
  minSalary: "195000",
  datePosted: "1w",
};

const EMPTY_CRITERIA = {
  title: "",
  keywords: "",
  keywordMode: "and",
  includeTerms: "",
  excludeTerms: "",
  location: "",
  minSalary: "",
  datePosted: "",
};

const VIEW_OPTIONS = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "unread", label: "Unread" },
  { value: "best_match", label: "Best Match" },
  { value: "applied", label: "Applied" },
  { value: "skipped", label: "Skipped" },
  { value: "rejected", label: "Rejected" },
];

const SORT_OPTIONS = [
  { value: "score", label: "Score" },
  { value: "date", label: "Date" },
];

const DATE_POSTED_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "any", label: "Any time" },
  { value: "1d", label: "Past 24 hours" },
  { value: "3d", label: "Past 3 days" },
  { value: "1w", label: "Past week" },
  { value: "2w", label: "Past 2 weeks" },
  { value: "1m", label: "Past month" },
];

const DEMO_SOURCES = [
  { id: "linkedin_saved", name: "LinkedIn", type: "linkedin" },
  { id: "google_search", name: "Google Jobs", type: "google" },
  { id: "ashby_board", name: "Ashby", type: "ashby" },
];

const DEMO_JOBS = [
  {
    id: "job-demo-1",
    title: "Senior Product Manager, Growth Platform",
    company: "Northstar Finance",
    location: "San Francisco, CA",
    bucket: "high_signal",
    status: "new",
    score: 94,
    confidence: 88,
    summary: "Ownership spans search acquisition, payments growth, and lifecycle experiments.",
    reasons: [
      "Strong alignment with product-led growth and marketplace experience.",
      "Leadership scope maps to search + activation programs.",
    ],
    salaryText: "$210k - $245k",
    employmentType: "Full-time",
    notes: "",
    duplicateCount: 2,
    sourceIds: ["linkedin_saved", "google_search"],
    reviewTarget: {
      url: "https://example.com/jobs/demo-1",
      label: "Open role",
    },
    postedAt: "2026-03-10T18:00:00.000Z",
  },
  {
    id: "job-demo-2",
    title: "Principal Product Manager, AI Assistants",
    company: "Canvas Health",
    location: "Remote",
    bucket: "high_signal",
    status: "viewed",
    score: 91,
    confidence: 84,
    summary: "Build AI workflows across provider operations and member experience.",
    reasons: [
      "Matches healthcare and workflow automation keywords.",
      "Remote role with strong compensation band.",
    ],
    salaryText: "$205k - $235k",
    employmentType: "Full-time",
    notes: "Worth revisiting after recruiter reply.",
    duplicateCount: 1,
    sourceIds: ["ashby_board"],
    reviewTarget: {
      url: "https://example.com/jobs/demo-2",
      label: "Open role",
    },
    postedAt: "2026-03-08T18:00:00.000Z",
  },
  {
    id: "job-demo-3",
    title: "Group Product Manager, Merchant Tools",
    company: "Orbital Commerce",
    location: "New York, NY",
    bucket: "medium_signal",
    status: "new",
    score: 86,
    confidence: 79,
    summary: "Drive merchant onboarding, payments visibility, and dashboard instrumentation.",
    reasons: [
      "Strong B2B payments overlap.",
      "Experience with analytics-heavy product areas is called out.",
    ],
    salaryText: "$220k - $255k",
    employmentType: "Full-time",
    notes: "",
    duplicateCount: 1,
    sourceIds: ["google_search"],
    reviewTarget: {
      url: "https://example.com/jobs/demo-3",
      label: "Open role",
    },
    postedAt: "2026-03-07T18:00:00.000Z",
  },
  {
    id: "job-demo-4",
    title: "Senior Product Manager, Platform Ecosystem",
    company: "Sparrow Cloud",
    location: "Seattle, WA",
    bucket: "medium_signal",
    status: "applied",
    score: 89,
    confidence: 82,
    summary: "Platform and partner ecosystem roadmap with strong developer tooling exposure.",
    reasons: [
      "Strong platform leadership scope.",
      "Direct match for ecosystem and integrations focus.",
    ],
    salaryText: "$198k - $225k",
    employmentType: "Full-time",
    notes: "Applied through company site on March 9.",
    duplicateCount: 1,
    sourceIds: ["linkedin_saved"],
    reviewTarget: {
      url: "https://example.com/jobs/demo-4",
      label: "Open role",
    },
    postedAt: "2026-03-05T18:00:00.000Z",
  },
  {
    id: "job-demo-5",
    title: "Lead Product Manager, Risk Operations",
    company: "Harbor Card",
    location: "Chicago, IL",
    bucket: "medium_signal",
    status: "skip_for_now",
    score: 80,
    confidence: 75,
    summary: "Operational tooling for underwriting and risk analysts.",
    reasons: [
      "Payments adjacency is strong.",
      "Operational product domain is relevant but not top-priority.",
    ],
    salaryText: "$185k - $210k",
    employmentType: "Full-time",
    notes: "Interesting, but lower urgency than platform roles.",
    duplicateCount: 1,
    sourceIds: ["google_search"],
    reviewTarget: {
      url: "https://example.com/jobs/demo-5",
      label: "Open role",
    },
    postedAt: "2026-03-03T18:00:00.000Z",
  },
  {
    id: "job-demo-6",
    title: "Product Director, Consumer Wallet",
    company: "Mercury Lane",
    location: "Los Angeles, CA",
    bucket: "low_signal",
    status: "rejected",
    score: 71,
    confidence: 61,
    summary: "Consumer wallet growth work with lower enterprise relevance.",
    reasons: [
      "Compelling brand, but product scope is too consumer-heavy.",
      "Location and market focus are weaker fits.",
    ],
    salaryText: "$190k - $215k",
    employmentType: "Full-time",
    notes: "Rejected: consumer wallet scope is off-target.",
    duplicateCount: 1,
    sourceIds: ["linkedin_saved"],
    reviewTarget: {
      url: "https://example.com/jobs/demo-6",
      label: "Open role",
    },
    postedAt: "2026-03-01T18:00:00.000Z",
  },
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeCriteria(criteria, options = {}) {
  const raw = criteria && typeof criteria === "object" ? criteria : {};
  const fallback = options.useDemoFallback ? DEFAULT_CRITERIA : EMPTY_CRITERIA;
  return {
    title: typeof raw.title === "string" ? raw.title : fallback.title,
    keywords: typeof raw.keywords === "string" ? raw.keywords : fallback.keywords,
    keywordMode:
      String(raw.keywordMode || raw.keyword_mode || fallback.keywordMode).toLowerCase() === "or"
        ? "or"
        : "and",
    includeTerms: Array.isArray(raw.includeTerms)
      ? raw.includeTerms.join(", ")
      : typeof raw.includeTerms === "string"
        ? raw.includeTerms
        : fallback.includeTerms,
    excludeTerms: Array.isArray(raw.excludeTerms)
      ? raw.excludeTerms.join(", ")
      : typeof raw.excludeTerms === "string"
        ? raw.excludeTerms
        : fallback.excludeTerms,
    location: typeof raw.location === "string" ? raw.location : fallback.location,
    minSalary:
      raw.minSalary === null || raw.minSalary === undefined || raw.minSalary === ""
        ? fallback.minSalary
        : String(raw.minSalary),
    datePosted: typeof raw.datePosted === "string" ? raw.datePosted : fallback.datePosted,
  };
}

function normalizeJobs(rawJobs) {
  return asArray(rawJobs)
    .filter((job) => job && typeof job === "object" && typeof job.id === "string" && job.id.trim())
    .map((job) => {
      const reviewTarget =
        job.reviewTarget && typeof job.reviewTarget === "object" && typeof job.reviewTarget.url === "string"
          ? job.reviewTarget
          : {
              url: typeof job.url === "string" ? job.url : "#",
              label: "Open role",
            };
      const status = String(job.status || "new");
      const firstViewedAt =
        typeof job.firstViewedAt === "string" && job.firstViewedAt.trim() ? job.firstViewedAt : null;
      return {
        id: job.id,
        title: String(job.title || "Untitled role"),
        company: String(job.company || "Unknown company"),
        location: String(job.location || "Location unknown"),
        bucket: String(job.bucket || "unscored"),
        status,
        firstViewedAt,
        lastImportBatchId:
          typeof job.lastImportBatchId === "string" && job.lastImportBatchId.trim()
            ? job.lastImportBatchId
            : null,
        isUnread:
          typeof job.isUnread === "boolean" ? job.isUnread : firstViewedAt === null && status === "new",
        isNew: typeof job.isNew === "boolean" ? job.isNew : status === "new",
        score: asFiniteNumber(job.score),
        confidence: asFiniteNumber(job.confidence),
        summary: String(job.summary || "No summary captured yet."),
        reasons: asArray(job.reasons).map((reason) => String(reason)),
        salaryText: String(job.salaryText || "Unknown"),
        employmentType: String(job.employmentType || "Unknown"),
        notes: typeof job.notes === "string" ? job.notes : "",
        duplicateCount: Math.max(1, Math.round(asFiniteNumber(job.duplicateCount) || 1)),
        sourceIds: uniqueStrings(job.sourceIds || [job.sourceId]),
        reviewTarget: {
          url: reviewTarget.url,
          label: typeof reviewTarget.label === "string" ? reviewTarget.label : "Open role",
        },
        postedAt: typeof job.postedAt === "string" ? job.postedAt : null,
      };
    });
}

function dedupeJobs(jobs) {
  const seen = new Set();
  const result = [];
  for (const job of jobs) {
    if (seen.has(job.id)) {
      continue;
    }
    seen.add(job.id);
    result.push(job);
  }
  return result;
}

function collectJobsFromDashboard(dashboard) {
  const dashboardJobs = dedupeJobs(
    normalizeJobs([
      ...asArray(dashboard?.queue),
      ...asArray(dashboard?.appliedQueue),
      ...asArray(dashboard?.skippedQueue),
      ...asArray(dashboard?.rejectedQueue),
    ]),
  );
  if (dashboardJobs.length > 0) {
    return dashboardJobs;
  }
  return dashboard && typeof dashboard === "object" ? [] : DEMO_JOBS;
}

function collectSourcesFromDashboard(dashboard, jobs) {
  const sourceMap = new Map();
  for (const source of asArray(dashboard?.sources)) {
    if (!source || typeof source.id !== "string" || !source.id.trim()) {
      continue;
    }
    sourceMap.set(source.id, {
      id: source.id,
      name: String(source.name || source.id),
      type: String(source.type || "source"),
    });
  }
  for (const source of DEMO_SOURCES) {
    if (!sourceMap.has(source.id)) {
      sourceMap.set(source.id, source);
    }
  }
  for (const job of jobs) {
    for (const sourceId of asArray(job.sourceIds)) {
      if (!sourceMap.has(sourceId)) {
        sourceMap.set(sourceId, {
          id: sourceId,
          name: sourceId.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
          type: "source",
        });
      }
    }
  }
  return [...sourceMap.values()];
}

function countJobsForView(jobs, view) {
  const activeJobs = filterActiveQueueJobs(jobs);
  if (view === "new") {
    return activeJobs.filter((job) => job.isNew === true).length;
  }
  if (view === "unread") {
    return activeJobs.filter((job) => job.isUnread === true).length;
  }
  if (view === "best_match") {
    return activeJobs.filter((job) => job.bucket === "high_signal").length;
  }
  if (view === "applied") {
    return jobs.filter((job) => job.status === "applied").length;
  }
  if (view === "skipped") {
    return jobs.filter((job) => job.status === "skip_for_now").length;
  }
  if (view === "rejected") {
    return jobs.filter((job) => job.status === "rejected").length;
  }
  return activeJobs.length;
}

function filterJobsByView(jobs, view) {
  const activeJobs = filterActiveQueueJobs(jobs);
  if (view === "new") {
    return activeJobs.filter((job) => job.isNew === true);
  }
  if (view === "unread") {
    return activeJobs.filter((job) => job.isUnread === true);
  }
  if (view === "best_match") {
    return activeJobs.filter((job) => job.bucket === "high_signal");
  }
  if (view === "applied") {
    return jobs.filter((job) => job.status === "applied");
  }
  if (view === "skipped") {
    return jobs.filter((job) => job.status === "skip_for_now");
  }
  if (view === "rejected") {
    return jobs.filter((job) => job.status === "rejected");
  }
  return activeJobs;
}

function filterJobsBySource(jobs, selectedSource) {
  if (selectedSource === "all") {
    return jobs;
  }
  return jobs.filter((job) => asArray(job.sourceIds).includes(selectedSource));
}

function sortJobs(jobs, sort) {
  return [...jobs].sort((left, right) => {
    if (sort === "date") {
      const leftTime = Date.parse(left.postedAt || "") || 0;
      const rightTime = Date.parse(right.postedAt || "") || 0;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
    }
    const leftScore = asFiniteNumber(left.score) ?? -1;
    const rightScore = asFiniteNumber(right.score) ?? -1;
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return String(left.title).localeCompare(String(right.title));
  });
}

function formatRelativeDate(rawValue) {
  if (!rawValue) {
    return "Freshness unknown";
  }
  const timestamp = Date.parse(rawValue);
  if (!Number.isFinite(timestamp)) {
    return "Freshness unknown";
  }
  const diffHours = Math.max(1, Math.round((Date.now() - timestamp) / (1000 * 60 * 60)));
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatBucket(bucket) {
  if (bucket === "high_signal") {
    return "High signal";
  }
  if (bucket === "medium_signal") {
    return "Medium signal";
  }
  if (bucket === "low_signal") {
    return "Low signal";
  }
  return "Unscored";
}

function formatStatus(status) {
  if (status === "skip_for_now") {
    return "Skipped";
  }
  return String(status || "new")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildSourceOptions(jobsInView, sources, selectedSource) {
  const counts = new Map();
  for (const job of jobsInView) {
    for (const sourceId of asArray(job.sourceIds)) {
      counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
    }
  }

  const sourceOptions = sources
    .filter((source) => counts.has(source.id))
    .map((source) => ({
      value: source.id,
      label: source.name,
      count: counts.get(source.id) || 0,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const validValues = new Set(["all", ...sourceOptions.map((option) => option.value)]);
  return {
    selectedSource: validValues.has(selectedSource) ? selectedSource : "all",
    options: [
      {
        value: "all",
        label: "All Results",
        count: jobsInView.length,
      },
      ...sourceOptions,
    ],
  };
}

function buildJobDetail(job, sources, pagedJobs) {
  if (!job) {
    return {
      job: null,
      positionLabel: "0 of 0",
      actionNote: "Queue actions and reject flow land in J3.",
    };
  }

  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const sourceLabels = asArray(job.sourceIds).map((sourceId) => sourcesById.get(sourceId) || {
    id: sourceId,
    name: sourceId,
    type: "source",
  });
  const position = pagedJobs.findIndex((item) => item.id === job.id);

  return {
    job: {
      ...job,
      bucketLabel: formatBucket(job.bucket),
      statusLabel: formatStatus(job.status),
      freshnessLabel: formatRelativeDate(job.postedAt),
      confidenceLabel:
        Number.isFinite(job.confidence) ? `${job.confidence}% confidence` : "Confidence n/a",
      scoreLabel: Number.isFinite(job.score) ? `Score ${job.score}` : "Score n/a",
      sourceLabels,
    },
    positionLabel: `${position + 1} of ${pagedJobs.length}`,
    actionNote: "Queue actions and reject flow land in J3.",
  };
}

export function buildJobsPresentationalModel({ dashboard, state = {} } = {}) {
  const useDemoFallback = !dashboard && state.criteria === undefined;
  const criteria = normalizeCriteria(state.criteria || dashboard?.searchCriteria, { useDemoFallback });
  const allJobs = collectJobsFromDashboard(dashboard);
  const sources = collectSourcesFromDashboard(dashboard, allJobs);
  const requestedView = VIEW_OPTIONS.some((option) => option.value === state.view) ? state.view : "all";
  const jobsInRequestedView = filterJobsByView(allJobs, requestedView);
  const sourceRail = buildSourceOptions(jobsInRequestedView, sources, state.source);
  const requestedSort = SORT_OPTIONS.some((option) => option.value === state.sort) ? state.sort : "score";
  const jobsInView = sortJobs(
    filterJobsBySource(jobsInRequestedView, sourceRail.selectedSource),
    requestedSort,
  );
  const totalPages = Math.max(1, Math.ceil(jobsInView.length / JOBS_PAGE_SIZE));
  const selectedPage = Math.min(Math.max(1, Math.round(Number(state.page) || 1)), totalPages);
  const pageStartIndex = (selectedPage - 1) * JOBS_PAGE_SIZE;
  const pagedJobs = jobsInView.slice(pageStartIndex, pageStartIndex + JOBS_PAGE_SIZE);
  const selectedJob =
    pagedJobs.find((job) => job.id === state.selectedJobId) || pagedJobs[0] || null;
  const detail = buildJobDetail(selectedJob, sources, pagedJobs);

  return {
    criteria,
    criteriaHint: `Keyword mode ${criteria.keywordMode.toUpperCase()} with excludes held locally until API wiring lands.`,
    criteriaStatus:
      "Presentational shell only in J2. Saving criteria and running sources land in J3.",
    datePostedOptions: DATE_POSTED_OPTIONS,
    findJobsLabel: "Find Jobs",
    summary: {
      activeCount: countJobsForView(allJobs, "all"),
      newCount: countJobsForView(allJobs, "new"),
      unreadCount: countJobsForView(allJobs, "unread"),
      appliedCount: countJobsForView(allJobs, "applied"),
      skippedCount: countJobsForView(allJobs, "skipped"),
      rejectedCount: countJobsForView(allJobs, "rejected"),
    },
    controls: {
      selectedView: requestedView,
      selectedSort: requestedSort,
      selectedSource: sourceRail.selectedSource,
      viewOptions: VIEW_OPTIONS.map((option) => ({
        ...option,
        count: countJobsForView(allJobs, option.value),
      })),
      sortOptions: SORT_OPTIONS,
      sourceOptions: sourceRail.options,
      pagination: {
        page: selectedPage,
        totalPages,
        total: jobsInView.length,
        start: jobsInView.length === 0 ? 0 : pageStartIndex + 1,
        end: Math.min(pageStartIndex + JOBS_PAGE_SIZE, jobsInView.length),
      },
    },
    queue: {
      jobs: pagedJobs.map((job) => ({
        ...job,
        bucketLabel: formatBucket(job.bucket),
        statusLabel: formatStatus(job.status),
        freshnessLabel: formatRelativeDate(job.postedAt),
        scoreLabel:
          job.status === "applied"
            ? "Applied"
            : job.status === "skip_for_now"
              ? "Skipped"
              : Number.isFinite(job.score)
                ? `Score ${job.score}`
                : "Score n/a",
      })),
      selectedJobId: selectedJob?.id || null,
      total: jobsInView.length,
      emptyLabel: "No jobs match this filter yet.",
    },
    detail,
  };
}

export { DATE_POSTED_OPTIONS, DEFAULT_CRITERIA, JOBS_PAGE_SIZE, normalizeCriteria };
