const ACTIVE_QUEUE_KEY = "queue";
const JOB_GROUP_KEYS = ["queue", "appliedQueue", "skippedQueue", "rejectedQueue"];

function parseTerms(value) {
  const seen = new Set();
  const terms = [];

  for (const rawSegment of String(value || "").split(",")) {
    const normalized = rawSegment.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    terms.push(normalized);
  }

  return terms;
}

function parseSalary(value) {
  const normalized = String(value || "").replace(/[^0-9]/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function normalizeKeywordMode(value) {
  return String(value || "").trim().toLowerCase() === "or" ? "or" : "and";
}

function readCriteriaTerms(value) {
  if (Array.isArray(value)) {
    return value
      .map((term) => String(term || "").trim())
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

function normalizeRunCadence(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["12h", "daily", "weekly", "cached"].includes(normalized)) {
    return normalized;
  }
  return "12h";
}

function targetQueueKey(status) {
  if (status === "applied") {
    return "appliedQueue";
  }
  if (status === "skip_for_now") {
    return "skippedQueue";
  }
  if (status === "rejected") {
    return "rejectedQueue";
  }
  return ACTIVE_QUEUE_KEY;
}

export function normalizeSearchCriteriaDraft(criteria = {}) {
  return {
    title: typeof criteria?.title === "string" ? criteria.title : "",
    hardIncludeTerms:
      readCriteriaTerms(criteria?.hardIncludeTerms) ||
      readCriteriaTerms(criteria?.requiredTerms) ||
      "",
    hardIncludeMode: normalizeKeywordMode(criteria?.hardIncludeMode || criteria?.requiredTermsMode),
    hardExcludeTerms:
      readCriteriaTerms(criteria?.hardExcludeTerms) || readCriteriaTerms(criteria?.excludeTerms),
    additionalKeywords:
      readCriteriaTerms(criteria?.scoreKeywords) ||
      readCriteriaTerms(criteria?.additionalKeywords) ||
      (typeof criteria?.keywords === "string" ? criteria.keywords : ""),
    additionalKeywordMode: normalizeKeywordMode(
      criteria?.scoreKeywordMode || criteria?.additionalKeywordMode || criteria?.keywordMode,
    ),
    location: typeof criteria?.location === "string" ? criteria.location : "",
    minSalary:
      Number.isFinite(Number(criteria?.minSalary)) && Number(criteria.minSalary) > 0
        ? String(Math.round(Number(criteria.minSalary)))
        : "",
    datePosted: typeof criteria?.datePosted === "string" ? criteria.datePosted : "",
  };
}

export function buildSearchCriteriaPayload(draft = {}) {
  const hardIncludeTerms = parseTerms(draft?.hardIncludeTerms);
  const hardExcludeTerms = parseTerms(draft?.hardExcludeTerms);
  const scoreKeywords = parseTerms(draft?.additionalKeywords);
  const hardIncludeMode = normalizeKeywordMode(draft?.hardIncludeMode);
  const scoreKeywordMode = normalizeKeywordMode(draft?.additionalKeywordMode);

  return {
    title: typeof draft?.title === "string" ? draft.title : "",
    hardIncludeTerms,
    hardIncludeMode,
    hardExcludeTerms,
    scoreKeywords,
    scoreKeywordMode,
    // Legacy compatibility fields retained while the broader codebase migrates.
    keywords: "",
    keywordMode: scoreKeywordMode,
    includeTerms: [],
    excludeTerms: hardExcludeTerms,
    location: typeof draft?.location === "string" ? draft.location : "",
    minSalary: parseSalary(draft?.minSalary),
    datePosted: typeof draft?.datePosted === "string" ? draft.datePosted : "",
  };
}

export function buildRunAllPayload(searchRunCadence) {
  const cadence = normalizeRunCadence(searchRunCadence);
  if (cadence === "cached") {
    return { refreshProfile: "mock" };
  }
  if (cadence === "weekly") {
    return { refreshProfile: "safe", cacheTtlHours: 168 };
  }
  if (cadence === "daily") {
    return { refreshProfile: "safe", cacheTtlHours: 24 };
  }
  return { refreshProfile: "safe", cacheTtlHours: 12 };
}

export async function runAllSourcesAndSync(requestJson, payload = {}) {
  const runAllPayload = await requestJson("/api/sources/run-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (runAllPayload?.sync) {
    return runAllPayload;
  }

  const syncPayload = await requestJson("/api/sync-score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  return {
    ...runAllPayload,
    sync: syncPayload?.sync || null,
  };
}

export async function saveSearchCriteriaAndRun(requestJson, draft, searchRunCadence) {
  const criteria = buildSearchCriteriaPayload(draft);
  const criteriaPayload = await requestJson("/api/search-criteria", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(criteria),
  });
  const runAllPayload = await runAllSourcesAndSync(requestJson, buildRunAllPayload(searchRunCadence));
  return { criteriaPayload, runAllPayload };
}

export async function persistJobStatus(requestJson, jobId, status, reason = "") {
  return requestJson(`/api/jobs/${encodeURIComponent(jobId)}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      reason: typeof reason === "string" ? reason.trim() : "",
    }),
  });
}

export function applyJobStatusToDashboard(dashboard, jobId, status, reason = "") {
  const nextDashboard = {
    ...(dashboard || {}),
  };

  const groups = Object.fromEntries(
    JOB_GROUP_KEYS.map((groupKey) => [
      groupKey,
      Array.isArray(dashboard?.[groupKey]) ? dashboard[groupKey].map((job) => ({ ...job })) : [],
    ]),
  );

  let targetJob = null;

  for (const groupKey of JOB_GROUP_KEYS) {
    const nextGroup = [];
    for (const job of groups[groupKey]) {
      if (job.id === jobId) {
        targetJob = job;
      } else {
        nextGroup.push(job);
      }
    }
    groups[groupKey] = nextGroup;
  }

  if (!targetJob) {
    return dashboard;
  }

  const nextJob = {
    ...targetJob,
    status,
    notes: status === "rejected" ? String(reason || "").trim() : targetJob.notes,
  };
  groups[targetQueueKey(status)].unshift(nextJob);

  for (const groupKey of JOB_GROUP_KEYS) {
    nextDashboard[groupKey] = groups[groupKey];
  }

  return nextDashboard;
}
