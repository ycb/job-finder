import {
  sanitizeExpectedCount,
  getSourceCaptureJobs,
  writeSourceCapturePayload
} from "./cache-policy.js";

export const INDEED_EXPECTED_COUNT_SELECTORS = Object.freeze([
  "#searchCountPages",
  '[data-testid="searchCountPages"]',
  '[data-testid*="search-count"]',
  '[data-testid*="job-count"]',
  ".jobsearch-JobCountAndSortPane-jobCount",
  '[class*="jobCount"]'
]);

const INDEED_EXPECTED_COUNT_PATTERNS = Object.freeze([
  /page\s+\d+\s+of\s+([\d,]+)\s+jobs?\b/i,
  /showing\s+\d+\s*[-–]\s*\d+\s+of\s+([\d,]+)\s+jobs?\b/i
]);

const INDEED_JOB_URL_PATTERNS = Object.freeze([
  /\/viewjob(?:[/?#]|$)/i,
  /\/rc\/clk(?:[/?#]|$)/i
]);

const INDEED_BLOCKED_URL_PATTERNS = Object.freeze([
  /\/cmp(?:[/?#]|$)/i,
  /\/companies(?:[/?#]|$)/i,
  /\/career-advice(?:[/?#]|$)/i,
  /\/career(?:[/?#]|$)/i
]);

const INDEED_BLOCKED_JOB_IDS = new Set([
  "a1b2c3d4e5f67890",
  "123456789abcdef0",
  "456789abcdef0123",
  "890abcdef0123456",
  "cdef0123456789ab",
  "f1e2d3c4b5a67890"
]);

function assertIndeedSource(source) {
  if (!source || source.type !== "indeed_search") {
    throw new Error("Indeed capture write requires an indeed_search source.");
  }
}

export function getIndeedNativeFilterState(source) {
  try {
    const parsed = new URL(String(source?.searchUrl || "").trim());
    const queryValue = String(parsed.searchParams.get("q") || "").trim();
    const locationValue = String(parsed.searchParams.get("l") || "").trim();
    const salaryType = String(parsed.searchParams.get("salaryType") || "").trim();
    const fromage = Number(parsed.searchParams.get("fromage"));
    const radius = String(parsed.searchParams.get("radius") || "").trim();

    return {
      queryValue,
      locationValue,
      appliedPayFilter: salaryType || "",
      appliedDatePostedFilter:
        Number.isFinite(fromage) && fromage > 0 ? `last ${Math.round(fromage)} days` : "",
      appliedDistanceFilter:
        radius === "0" ? "exact location only" : radius ? `${radius} miles` : ""
    };
  } catch {
    return {
      queryValue: "",
      locationValue: "",
      appliedPayFilter: "",
      appliedDatePostedFilter: "",
      appliedDistanceFilter: ""
    };
  }
}

export function parseIndeedExpectedCountText(text) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const pattern of INDEED_EXPECTED_COUNT_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const parsed = Number(String(match[1]).replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }

  return null;
}

export function isIndeedJobUrl(url) {
  const normalized = String(url || "").trim();
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    const jk = String(parsed.searchParams.get("jk") || "").trim().toLowerCase();
    if (jk && INDEED_BLOCKED_JOB_IDS.has(jk)) {
      return false;
    }
  } catch {
    return false;
  }

  for (const pattern of INDEED_BLOCKED_URL_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }

  return INDEED_JOB_URL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function filterIndeedCapturedJobs(jobs) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => isIndeedJobUrl(job?.url));
}

export function filterIndeedCapturedJobsWithDiagnostics(jobs) {
  const input = Array.isArray(jobs) ? jobs : [];
  const accepted = [];
  const rejectedReasons = new Set();

  for (const job of input) {
    if (isIndeedJobUrl(job?.url)) {
      accepted.push(job);
    } else {
      rejectedReasons.add("blocked_url_or_job_id");
    }
  }

  return {
    jobs: accepted,
    diagnostics: {
      rawUrlCount: input.length,
      jobsAccepted: accepted.length,
      jobsRejected: Math.max(0, input.length - accepted.length),
      rejectedReasons: Array.from(rejectedReasons)
    }
  };
}

export function writeIndeedCaptureFile(source, jobs, options = {}) {
  assertIndeedSource(source);

  const captureDiagnostics =
    options.captureDiagnostics &&
    typeof options.captureDiagnostics === "object" &&
    !Array.isArray(options.captureDiagnostics)
      ? options.captureDiagnostics
      : {};
  const capturePath = writeSourceCapturePayload(source, jobs, {
    ...options,
    captureDiagnostics: {
      captureMode: "browser_capture",
      jobsAccepted: Array.isArray(jobs) ? jobs.length : 0,
      ...captureDiagnostics
    }
  });
  const expectedCount = sanitizeExpectedCount(
    source,
    options.expectedCount,
    Array.isArray(jobs) ? jobs.length : null
  );
  return {
    source,
    capturePath,
    jobsImported: Array.isArray(jobs) ? jobs.length : 0,
    capturedAt: options.capturedAt || new Date().toISOString(),
    pageUrl: options.pageUrl || null,
    expectedCount
  };
}

export function collectIndeedJobsFromSearch(source) {
  const capturedJobs = getSourceCaptureJobs(source);
  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return capturedJobs.slice(0, source.maxJobs);
  }

  return capturedJobs;
}
