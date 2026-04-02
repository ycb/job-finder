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
  "123456789abcdef0"
]);

function assertIndeedSource(source) {
  if (!source || source.type !== "indeed_search") {
    throw new Error("Indeed capture write requires an indeed_search source.");
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

export function writeIndeedCaptureFile(source, jobs, options = {}) {
  assertIndeedSource(source);

  const capturePath = writeSourceCapturePayload(source, jobs, options);
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
