import { filterActiveQueueJobs as filterSharedActiveQueueJobs } from "../../../../../jobs/active-queue.js";

export const JOBS_PAGE_SIZE = 10;

const JOB_VIEW_VALUES = new Set([
  "all",
  "new",
  "unread",
  "best_match",
  "applied",
  "skipped",
  "rejected",
]);

const JOB_SORT_VALUES = new Set(["score", "date"]);

const SOURCE_KIND_ORDER = ["li", "bi", "id", "zr", "lf", "yc", "ah", "gg", "wf", "ro", "unknown"];

const QUEUE_GROUP_KEYS = ["queue", "appliedQueue", "skippedQueue", "rejectedQueue"];

export function filterActiveQueueJobs(queue = []) {
  return filterSharedActiveQueueJobs(queue);
}

export function normalizeJobsView(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return JOB_VIEW_VALUES.has(normalized) ? normalized : "all";
}

export function normalizeJobsSort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return JOB_SORT_VALUES.has(normalized) ? normalized : "score";
}

export function sourceKindFromType(type) {
  if (type === "linkedin_capture_file") {
    return "li";
  }
  if (type === "builtin_search") {
    return "bi";
  }
  if (type === "wellfound_search") {
    return "wf";
  }
  if (type === "ashby_search") {
    return "ah";
  }
  if (type === "google_search") {
    return "gg";
  }
  if (type === "indeed_search") {
    return "id";
  }
  if (type === "ziprecruiter_search") {
    return "zr";
  }
  if (type === "levelsfyi_search") {
    return "lf";
  }
  if (type === "yc_jobs") {
    return "yc";
  }
  if (type === "remoteok_search") {
    return "ro";
  }
  return "unknown";
}

export function sourceKindLabel(kind) {
  if (kind === "bi") {
    return "Built In";
  }
  if (kind === "li") {
    return "LinkedIn";
  }
  if (kind === "wf") {
    return "Wellfound";
  }
  if (kind === "ah") {
    return "Ashby";
  }
  if (kind === "gg") {
    return "Google";
  }
  if (kind === "id") {
    return "Indeed";
  }
  if (kind === "zr") {
    return "ZipRecruiter";
  }
  if (kind === "lf") {
    return "Levels.fyi";
  }
  if (kind === "yc") {
    return "YC Jobs";
  }
  if (kind === "ro") {
    return "RemoteOK";
  }
  if (kind === "mixed") {
    return "Multiple";
  }
  return "Unknown";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function scoreValue(job) {
  const parsed = Number(job?.score);
  return Number.isFinite(parsed) ? parsed : -1;
}

function dateValue(job) {
  const posted = Date.parse(typeof job?.postedAt === "string" ? job.postedAt : "");
  if (Number.isFinite(posted)) {
    return posted;
  }

  const updated = Date.parse(typeof job?.updatedAt === "string" ? job.updatedAt : "");
  return Number.isFinite(updated) ? updated : 0;
}

function compareSourceKinds(left, right) {
  const leftIndex = SOURCE_KIND_ORDER.indexOf(left.kind);
  const rightIndex = SOURCE_KIND_ORDER.indexOf(right.kind);
  const normalizedLeft = leftIndex >= 0 ? leftIndex : SOURCE_KIND_ORDER.length;
  const normalizedRight = rightIndex >= 0 ? rightIndex : SOURCE_KIND_ORDER.length;
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft - normalizedRight;
  }
  return left.label.localeCompare(right.label);
}

function matchingSourceIdsByKind(sources, sourceFilter) {
  const normalizedFilter = String(sourceFilter || "all").trim().toLowerCase() || "all";
  if (normalizedFilter === "all") {
    return null;
  }

  return new Set(
    asArray(sources)
      .filter(Boolean)
      .filter((source) => sourceKindFromType(source.type) === normalizedFilter)
      .map((source) => source.id),
  );
}

export function parseTerms(value) {
  const seen = new Set();
  const terms = [];
  for (const part of String(value || "").split(",")) {
    const normalized = part.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms;
}

export function parseSalaryValue(value) {
  const text = String(value || "").toLowerCase();
  if (!text) {
    return 0;
  }
  const matches = [...text.matchAll(/([0-9]+(?:[.,][0-9]{3})*(?:\.[0-9]+)?)(\s*k)?/g)];
  if (matches.length === 0) {
    return 0;
  }
  const numbers = matches
    .map((match) => {
      const amount = Number(String(match[1] || "").replace(/,/g, ""));
      if (!Number.isFinite(amount)) {
        return 0;
      }
      return match[2] ? amount * 1000 : amount;
    })
    .filter((amount) => amount > 0);
  if (numbers.length === 0) {
    return 0;
  }
  return Math.max(...numbers);
}

export function formatCurrency(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    return "—";
  }
  return `$${Math.round(Number(value)).toLocaleString("en-US")}`;
}

export function jobSearchHaystack(job) {
  return [
    job?.title,
    job?.summary,
    Array.isArray(job?.reasons) ? job.reasons.join(" ") : "",
    job?.location,
    job?.company,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function countKeywordHits(jobs, term) {
  if (!term) {
    return 0;
  }
  const normalized = term.toLowerCase();
  return asArray(jobs).reduce((count, job) => {
    const haystack = jobSearchHaystack(job);
    return haystack.includes(normalized) ? count + 1 : count;
  }, 0);
}

export function normalizeTitleKey(value) {
  const title = String(value || "").trim();
  if (!title) {
    return "Unknown";
  }
  return title;
}

export function computeTitleBreakdown(jobs, limit = 5) {
  const counts = new Map();
  for (const job of asArray(jobs)) {
    const key = normalizeTitleKey(job?.title);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

export function computeSalarySummary(jobs) {
  const values = asArray(jobs)
    .map((job) => parseSalaryValue(job?.salaryText))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (values.length === 0) {
    return {
      min: null,
      avg: null,
      max: null,
      p75: null,
      aboveAvgCount: 0,
      topBandCount: 0,
      withSalaryCount: 0,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const avg = total / values.length;
  const p75Index = Math.floor((values.length - 1) * 0.75);
  const p75 = values[p75Index] || values[values.length - 1];
  const topBandCount = Math.max(1, Math.ceil(values.length * 0.25));
  const topBandThreshold = values[Math.max(0, values.length - topBandCount)];
  return {
    min: values[0],
    avg,
    max: values[values.length - 1],
    p75,
    aboveAvgCount: values.filter((value) => value > avg).length,
    topBandCount: values.filter((value) => value >= topBandThreshold).length,
    withSalaryCount: values.length,
  };
}

export function buildNumericHistogram(values = [], { bucketCount = 8 } = {}) {
  const numericValues = asArray(values)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (numericValues.length === 0) {
    return {
      min: null,
      max: null,
      withValueCount: 0,
      buckets: [],
    };
  }

  const min = numericValues[0];
  const max = numericValues[numericValues.length - 1];
  const resolvedBucketCount = Math.max(1, Math.floor(bucketCount) || 1);

  if (min === max) {
    return {
      min,
      max,
      withValueCount: numericValues.length,
      buckets: [
        {
          key: `${min}-${max}`,
          min,
          max,
          count: numericValues.length,
        },
      ],
    };
  }

  const width = (max - min) / resolvedBucketCount;
  const buckets = Array.from({ length: resolvedBucketCount }, (_, index) => {
    const bucketMin = min + width * index;
    const bucketMax = index === resolvedBucketCount - 1 ? max : min + width * (index + 1);
    return {
      key: `${Math.round(bucketMin)}-${Math.round(bucketMax)}`,
      min: Math.round(bucketMin),
      max: Math.round(bucketMax),
      count: 0,
    };
  });

  for (const value of numericValues) {
    const rawIndex = width === 0 ? 0 : Math.floor((value - min) / width);
    const index = Math.min(resolvedBucketCount - 1, Math.max(0, rawIndex));
    buckets[index].count += 1;
  }

  buckets[0].min = min;
  buckets[buckets.length - 1].max = max;

  return {
    min,
    max,
    withValueCount: numericValues.length,
    buckets,
  };
}

export function buildJobsSalaryHistogram(jobs, options = {}) {
  return buildNumericHistogram(
    asArray(jobs)
      .map((job) => parseSalaryValue(job?.salaryText))
      .filter((value) => value > 0),
    options,
  );
}

export function buildJobsScoreHistogram(jobs, options = {}) {
  return buildNumericHistogram(
    asArray(jobs)
      .map((job) => {
        const raw = job?.score;
        if (raw === null || raw === undefined || raw === "") {
          return NaN;
        }
        return Number(raw);
      })
      .filter((value) => Number.isFinite(value)),
    options,
  );
}

export function countJobsInSalaryRange(jobs, range = null) {
  const values = asArray(jobs)
    .map((job) => parseSalaryValue(job?.salaryText))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!range || !Number.isFinite(Number(range.min)) || !Number.isFinite(Number(range.max))) {
    return values.length;
  }

  const min = Number(range.min);
  const max = Number(range.max);
  return values.filter((value) => value >= min && value <= max).length;
}

export function countJobsInScoreRange(jobs, range = null) {
  const values = asArray(jobs)
    .map((job) => {
      const raw = job?.score;
      if (raw === null || raw === undefined || raw === "") {
        return NaN;
      }
      return Number(raw);
    })
    .filter((value) => Number.isFinite(value));

  if (!range || !Number.isFinite(Number(range.min)) || !Number.isFinite(Number(range.max))) {
    return values.length;
  }

  const min = Number(range.min);
  const max = Number(range.max);
  return values.filter((value) => value >= min && value <= max).length;
}

export function buildJobsSalaryMatrix(jobs) {
  const summary = computeSalarySummary(jobs);
  const salaries = asArray(jobs)
    .map((job) => parseSalaryValue(job?.salaryText))
    .filter((value) => Number.isFinite(value) && value > 0);

  const minToAvgCount =
    Number.isFinite(summary.avg) && Number.isFinite(summary.min)
      ? salaries.filter((value) => value >= summary.min && value <= summary.avg).length
      : 0;

  return {
    withSalary: {
      key: "has_salary",
      label: "With salary",
      count: summary.withSalaryCount,
      value: formatCurrency(summary.min),
    },
    minToAvg: {
      key: "min_to_avg",
      label: "Min → Avg",
      count: minToAvgCount,
      value:
        summary.min && summary.avg
          ? `${formatCurrency(summary.min)} → ${formatCurrency(summary.avg)}`
          : "—",
    },
    aboveAvg: {
      key: "above_avg",
      label: "Above avg",
      count: summary.aboveAvgCount,
      value: formatCurrency(summary.avg),
    },
    bestPaying: {
      key: "best_paying",
      label: "Best paying",
      count: summary.topBandCount,
      value: formatCurrency(summary.max),
    },
  };
}

export function ageInDays(timestamp) {
  const parsed = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor((Date.now() - parsed) / (1000 * 60 * 60 * 24));
}

export function matchesPostedWindow(job, windowKey) {
  if (windowKey === "all") {
    return true;
  }
  const days = ageInDays(job?.postedAt);
  if (!Number.isFinite(days)) {
    return false;
  }
  if (windowKey === "24h") {
    return days <= 1;
  }
  if (windowKey === "3d") {
    return days <= 3;
  }
  if (windowKey === "1w") {
    return days <= 7;
  }
  if (windowKey === "2w") {
    return days <= 14;
  }
  if (windowKey === "1m") {
    return days <= 30;
  }
  return true;
}

export function buildJobsActiveFilterChips({
  sourceFilter = "all",
  sourceOptions = [],
  postedFilter = "all",
  postedOptions = [],
  salaryRangeFilter = null,
  salaryPresenceFilter = "all",
  widgetKeywordFilter = "",
  widgetTitleFilter = "",
} = {}) {
  const chips = [];
  if (sourceFilter !== "all") {
    const match = asArray(sourceOptions).find((option) => option.kind === sourceFilter);
    chips.push({
      key: "source",
      label: `Source: ${match?.label || sourceFilter}`,
    });
  }
  if (postedFilter !== "all") {
    const match = asArray(postedOptions).find((option) => option.value === postedFilter);
    chips.push({
      key: "posted",
      label: `Posted: ${match?.label || postedFilter}`,
    });
  }
  if (
    salaryRangeFilter &&
    Number.isFinite(Number(salaryRangeFilter.min)) &&
    Number.isFinite(Number(salaryRangeFilter.max))
  ) {
    chips.push({
      key: "salary-range",
      label: `Salary: ${formatCurrency(salaryRangeFilter.min)} - ${formatCurrency(salaryRangeFilter.max)}`,
    });
  }
  if (salaryPresenceFilter === "has_salary") {
    chips.push({
      key: "salary-presence",
      label: "Salary: has salary",
    });
  } else if (salaryPresenceFilter === "missing_salary") {
    chips.push({
      key: "salary-presence",
      label: "Salary: missing salary",
    });
  }
  if (widgetKeywordFilter) {
    chips.push({
      key: "widget-keyword",
      label: `Keyword: ${widgetKeywordFilter}`,
    });
  }
  if (widgetTitleFilter) {
    chips.push({
      key: "widget-title",
      label: `Title: ${widgetTitleFilter}`,
    });
  }
  return chips;
}

function mapQueuesStatus(queues, jobId, status) {
  return QUEUE_GROUP_KEYS.reduce((accumulator, key) => {
    accumulator[key] = asArray(queues?.[key]).map((job) => (
      job?.id === jobId ? { ...job, status } : job
    ));
    return accumulator;
  }, {});
}

export function selectJobsForView({
  view,
  queue = [],
  appliedQueue = [],
  skippedQueue = [],
  rejectedQueue = [],
}) {
  const normalizedView = normalizeJobsView(view);

  if (normalizedView === "applied") {
    return asArray(appliedQueue);
  }
  if (normalizedView === "skipped") {
    return asArray(skippedQueue);
  }
  if (normalizedView === "rejected") {
    return asArray(rejectedQueue);
  }

  const activeQueue = filterActiveQueueJobs(queue);
  if (normalizedView === "new") {
    return activeQueue.filter((job) => job?.isNew === true);
  }
  if (normalizedView === "unread") {
    return activeQueue.filter((job) => job?.isUnread === true);
  }
  if (normalizedView === "best_match") {
    return activeQueue.filter((job) => job?.bucket === "high_signal");
  }
  return activeQueue;
}

export function buildSourceFilterOptions({
  jobs = [],
  sources = [],
  selectedSourceFilter = "all",
}) {
  const totals = new Map();
  for (const source of asArray(sources).filter(Boolean)) {
    const kind = sourceKindFromType(source.type);
    if (!totals.has(kind)) {
      totals.set(kind, {
        kind,
        label: sourceKindLabel(kind),
        count: 0,
      });
    }
  }

  const sourceKindById = new Map(
    asArray(sources)
      .filter(Boolean)
      .map((source) => [source.id, sourceKindFromType(source.type)]),
  );

  for (const job of asArray(jobs)) {
    const seenKinds = new Set();
    for (const sourceId of asArray(job?.sourceIds)) {
      const kind = sourceKindById.get(sourceId);
      if (kind) {
        seenKinds.add(kind);
      }
    }
    for (const kind of seenKinds) {
      const current = totals.get(kind);
      if (current) {
        current.count += 1;
      }
    }
  }

  const options = [...totals.values()].sort(compareSourceKinds);
  const normalizedSelection = String(selectedSourceFilter || "all").trim().toLowerCase() || "all";
  const resolvedSelection =
    normalizedSelection !== "all" && !options.some((option) => option.kind === normalizedSelection)
      ? "all"
      : normalizedSelection;

  return {
    options,
    selectedSourceFilter: resolvedSelection,
  };
}

export function filterJobsBySource(jobs = [], { sources = [], sourceFilter = "all" } = {}) {
  const matchingSourceIds = matchingSourceIdsByKind(sources, sourceFilter);
  if (matchingSourceIds === null) {
    return asArray(jobs);
  }
  if (matchingSourceIds.size === 0) {
    return [];
  }

  return asArray(jobs).filter((job) => (
    asArray(job?.sourceIds).some((sourceId) => matchingSourceIds.has(sourceId))
  ));
}

export function sortJobs(jobs = [], sort = "score") {
  const normalizedSort = normalizeJobsSort(sort);
  return [...asArray(jobs)].sort((left, right) => {
    if (normalizedSort === "date") {
      const freshnessDiff = dateValue(right) - dateValue(left);
      if (freshnessDiff !== 0) {
        return freshnessDiff;
      }

      const scoreDiff = scoreValue(right) - scoreValue(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
    } else {
      const scoreDiff = scoreValue(right) - scoreValue(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const freshnessDiff = dateValue(right) - dateValue(left);
      if (freshnessDiff !== 0) {
        return freshnessDiff;
      }
    }

    return String(left?.title || "").localeCompare(String(right?.title || ""));
  });
}

export function reconcileSelectedJobId(jobs = [], selectedJobId = null) {
  const items = asArray(jobs);
  if (items.length === 0) {
    return null;
  }
  return items.some((job) => job?.id === selectedJobId) ? selectedJobId : items[0].id;
}

export function getPageForSelectedJob(jobs = [], selectedJobId = null, pageSize = JOBS_PAGE_SIZE) {
  const items = asArray(jobs);
  const normalizedPageSize = Math.max(1, Number(pageSize) || JOBS_PAGE_SIZE);
  if (!items.length || !selectedJobId) {
    return 1;
  }

  const index = items.findIndex((job) => job?.id === selectedJobId);
  if (index < 0) {
    return 1;
  }

  return Math.floor(index / normalizedPageSize) + 1;
}

export function paginateJobs(jobs = [], page = 1, pageSize = JOBS_PAGE_SIZE) {
  const items = asArray(jobs);
  const normalizedPageSize = Math.max(1, Number(pageSize) || JOBS_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(items.length / normalizedPageSize));
  const nextPage = Math.max(1, Math.min(totalPages, Number(page) || 1));
  const pageStart = (nextPage - 1) * normalizedPageSize;
  const pageEnd = Math.min(pageStart + normalizedPageSize, items.length);

  return {
    page: nextPage,
    totalPages,
    pageStart,
    pageEnd,
    items: items.slice(pageStart, pageEnd),
  };
}

export function applyViewedStatus(queues, jobId) {
  const target = asArray(queues?.queue).find((job) => job?.id === jobId);
  if (!target || target.isUnread !== true) {
    return {
      changed: false,
      previousStatus: null,
      previousFirstViewedAt: null,
      queues,
    };
  }

  const viewedAt = new Date().toISOString();
  const nextQueues = QUEUE_GROUP_KEYS.reduce((accumulator, key) => {
    accumulator[key] = asArray(queues?.[key]).map((job) => {
      if (job?.id !== jobId) {
        return job;
      }
      return {
        ...job,
        status: "viewed",
        firstViewedAt: job.firstViewedAt || viewedAt,
        isUnread: false,
      };
    });
    return accumulator;
  }, {});

  return {
    changed: true,
    previousStatus: target.status,
    previousFirstViewedAt: target.firstViewedAt ?? null,
    queues: nextQueues,
  };
}

export function restoreViewedStatus(queues, jobId, previousStatus, previousFirstViewedAt = null) {
  if (previousStatus === null || previousStatus === undefined) {
    return queues;
  }
  return QUEUE_GROUP_KEYS.reduce((accumulator, key) => {
    accumulator[key] = asArray(queues?.[key]).map((job) => {
      if (job?.id !== jobId) {
        return job;
      }
      return {
        ...job,
        status: previousStatus,
        firstViewedAt: previousFirstViewedAt,
        isUnread: !previousFirstViewedAt,
      };
    });
    return accumulator;
  }, {});
}
