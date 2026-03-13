export const JOBS_PAGE_SIZE = 10;

const JOB_VIEW_VALUES = new Set([
  "all",
  "new",
  "best_match",
  "applied",
  "skipped",
  "rejected",
]);

const JOB_SORT_VALUES = new Set(["score", "date"]);

const SOURCE_KIND_ORDER = ["li", "bi", "ah", "id", "zr", "gg", "wf", "ro", "unknown"];

const QUEUE_GROUP_KEYS = ["queue", "appliedQueue", "skippedQueue", "rejectedQueue"];

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
  if (kind === "ro") {
    return "RemoteOK";
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

  const activeQueue = asArray(queue);
  if (normalizedView === "new") {
    return activeQueue.filter((job) => job?.status === "new");
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
  if (!target || target.status !== "new") {
    return {
      changed: false,
      previousStatus: null,
      queues,
    };
  }

  return {
    changed: true,
    previousStatus: target.status,
    queues: mapQueuesStatus(queues, jobId, "viewed"),
  };
}

export function restoreViewedStatus(queues, jobId, previousStatus) {
  if (previousStatus === null || previousStatus === undefined) {
    return queues;
  }
  return mapQueuesStatus(queues, jobId, previousStatus);
}
