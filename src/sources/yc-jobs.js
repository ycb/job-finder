import { execFileSync } from "node:child_process";

import { writeSourceCapturePayload } from "./cache-policy.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function decodeHtmlEntities(value) {
  const input = String(value || "");

  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d+);/g, (_, numeric) => {
      const code = Number.parseInt(numeric, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00a0/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "));
}

function normalizeText(value) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function assertYcSource(source) {
  if (!source || source.type !== "yc_jobs") {
    throw new Error("YC capture write requires a yc_jobs source.");
  }
}

function toAbsoluteUrl(inputUrl, baseUrl = "https://www.workatastartup.com") {
  const normalized = String(inputUrl || "").trim();
  if (!normalized) {
    return "";
  }

  try {
    return new URL(normalized, baseUrl).toString();
  } catch {
    return normalized;
  }
}

function extractDataPagePayload(html) {
  const match = String(html || "").match(/data-page=(['"])([\s\S]*?)\1/i);
  if (!match?.[2]) {
    return null;
  }

  const decoded = decodeHtmlEntities(match[2]);
  if (!decoded) {
    return null;
  }

  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function parseDataPagePayload(rawValue) {
  if (!rawValue) {
    return null;
  }

  if (typeof rawValue === "object" && !Array.isArray(rawValue)) {
    return rawValue;
  }

  const decoded = decodeHtmlEntities(rawValue);
  if (!decoded) {
    return null;
  }

  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function findJobsArray(value) {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return [];
  }

  if (Array.isArray(value.jobs)) {
    return value.jobs;
  }

  for (const child of Object.values(value)) {
    if (!child || typeof child !== "object") {
      continue;
    }

    if (Array.isArray(child)) {
      continue;
    }

    const nested = findJobsArray(child);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
}

function companyUrlForSlug(companySlug) {
  const slug = normalizeText(companySlug);
  if (!slug) {
    return "";
  }

  return toAbsoluteUrl(`/companies/${slug}`, "https://www.workatastartup.com");
}

function extractJobId(rawJob) {
  const directId =
    rawJob?.id === null || rawJob?.id === undefined
      ? ""
      : normalizeText(String(rawJob.id));
  if (directId) {
    return directId;
  }

  const applyUrl = toAbsoluteUrl(rawJob?.applyUrl || "");
  if (!applyUrl) {
    return "";
  }

  try {
    const parsed = new URL(applyUrl);
    return normalizeText(parsed.searchParams.get("signup_job_id") || "");
  } catch {
    return "";
  }
}

function jobUrlForId(jobId) {
  const normalizedId = normalizeText(jobId);
  if (!normalizedId) {
    return "";
  }

  return toAbsoluteUrl(`/jobs/${encodeURIComponent(normalizedId)}`);
}

function isProductManagerRoute(searchUrl) {
  const normalized = String(searchUrl || "").trim();
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized, "https://www.workatastartup.com");
    return /^\/jobs\/l\/product-manager\/?$/i.test(parsed.pathname);
  } catch {
    return /\/jobs\/l\/product-manager(?:\/|\?|$)/i.test(normalized);
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = [];
  for (const entry of value) {
    const text = normalizeText(entry);
    if (text && !normalized.includes(text)) {
      normalized.push(text);
    }
  }
  return normalized;
}

function parseYcSearchState(searchInput) {
  const baseState = {
    searchUrl: "",
    title: "",
    location: "",
    hardIncludeTerms: [],
    includeTerms: [],
    keywordMode: "",
    roleFamily: ""
  };

  if (!searchInput) {
    return baseState;
  }

  if (typeof searchInput === "string") {
    const searchUrl = normalizeText(searchInput);
    const next = {
      ...baseState,
      searchUrl
    };

    try {
      const parsed = new URL(searchUrl);
      next.title = normalizeText(parsed.searchParams.get("search"));
      next.location = normalizeText(parsed.searchParams.get("location"));
      next.keywordMode = normalizeText(parsed.searchParams.get("keywordMode")).toLowerCase();
      next.hardIncludeTerms = normalizeStringArray(
        String(parsed.searchParams.get("hardIncludeTerms") || "")
          .split(",")
          .map((term) => term.trim())
          .filter(Boolean)
      );
      next.includeTerms = normalizeStringArray(
        String(parsed.searchParams.get("includeTerms") || "")
          .split(",")
          .map((term) => term.trim())
          .filter(Boolean)
      );
      if (isProductManagerRoute(searchUrl)) {
        next.roleFamily = "product";
      }
    } catch {
      if (isProductManagerRoute(searchUrl)) {
        next.roleFamily = "product";
      }
    }

    return next;
  }

  if (typeof searchInput === "object" && !Array.isArray(searchInput)) {
    const criteria =
      searchInput.criteria && typeof searchInput.criteria === "object"
        ? searchInput.criteria
        : searchInput;
    const searchUrl = normalizeText(searchInput.searchUrl || criteria.searchUrl || "");
    const title = normalizeText(criteria.title);
    const location = normalizeText(criteria.location);
    const hardIncludeTerms = normalizeStringArray(criteria.hardIncludeTerms);
    const includeTerms = normalizeStringArray(criteria.includeTerms);
    const keywordMode = normalizeText(criteria.keywordMode).toLowerCase();
    const roleFamily =
      normalizeText(criteria.roleFamily).toLowerCase() ||
      (isProductManagerRoute(searchUrl) ? "product" : title.toLowerCase().includes("product") ? "product" : "");

    return {
      searchUrl,
      title,
      location,
      hardIncludeTerms,
      includeTerms,
      keywordMode,
      roleFamily
    };
  }

  return baseState;
}

function isRelevantProductRole(title) {
  const normalized = normalizeText(title).toLowerCase();
  if (!normalized) {
    return false;
  }

  const includePatterns = [
    /\bproduct manager\b/,
    /\bproduct owner\b/,
    /\bproduct lead\b/,
    /\bhead of product\b/,
    /\bvp product\b/,
    /\bdirector of product\b/
  ];

  const excludePatterns = [
    /\bdesigner\b/,
    /\bdesign engineer\b/,
    /\bfounder'?s office\b/,
    /\bgrowth marketer\b/,
    /\bsoftware engineer\b/,
    /\brecruiter\b/
  ];

  if (excludePatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return includePatterns.some((pattern) => pattern.test(normalized));
}

function buildSummary(job) {
  const parts = [
    normalizeText(job.companyOneLiner),
    normalizeText(job.roleType),
    normalizeText(job.companyBatch)
  ].filter(Boolean);

  return parts.join(" · ");
}

function buildSearchableYcText(rawJob) {
  return normalizeText(
    [
      rawJob?.title,
      rawJob?.companyName,
      rawJob?.companyOneLiner,
      rawJob?.location,
      rawJob?.roleType,
      rawJob?.companyBatch
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
}

function matchesAllTerms(text, terms) {
  if (!terms.length) {
    return true;
  }
  return terms.every((term) => text.includes(String(term || "").toLowerCase()));
}

function matchesLocation(rawJob, location) {
  const normalizedLocation = normalizeText(location).toLowerCase();
  if (!normalizedLocation) {
    return true;
  }
  return normalizeText(rawJob?.location).toLowerCase().includes(normalizedLocation);
}

function shouldIncludeYcJob(rawJob, searchState) {
  const text = buildSearchableYcText(rawJob);

  if (searchState.roleFamily === "product" && !isRelevantProductRole(rawJob?.title)) {
    return false;
  }

  if (!matchesLocation(rawJob, searchState.location)) {
    return false;
  }

  const hardTerms = normalizeStringArray(searchState.hardIncludeTerms);
  if (!matchesAllTerms(text, hardTerms)) {
    return false;
  }

  if (
    searchState.keywordMode === "and" &&
    !matchesAllTerms(text, normalizeStringArray(searchState.includeTerms))
  ) {
    return false;
  }

  return true;
}

function toJobRecord(rawJob, searchUrl) {
  const title = normalizeText(rawJob?.title);
  const company = normalizeText(rawJob?.companyName);
  const companySlug = normalizeText(rawJob?.companySlug);
  const jobId = extractJobId(rawJob);
  const url =
    jobUrlForId(jobId) ||
    toAbsoluteUrl(rawJob?.url || "") ||
    companyUrlForSlug(companySlug);

  if (!title || !company || !url) {
    return null;
  }

  const summary = buildSummary(rawJob);
  const description = [
    summary,
    normalizeText(rawJob?.location),
    normalizeText(rawJob?.jobType)
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    externalId: jobId || null,
    title,
    company,
    location: normalizeText(rawJob?.location) || null,
    postedAt: null,
    employmentType: normalizeText(rawJob?.jobType) || null,
    easyApply: false,
    salaryText: null,
    summary: summary || `${title} at ${company}`,
    description: description || `${title} at ${company}`,
    url,
    pageUrl: toAbsoluteUrl(searchUrl)
  };
}

export function parseYcJobsPayload(rawPayload, searchInput) {
  const payload = parseDataPagePayload(rawPayload);
  if (!payload) {
    return [];
  }

  const rawJobs = findJobsArray(payload);
  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    return [];
  }

  const searchState = parseYcSearchState(searchInput);
  const jobs = [];

  for (const rawJob of rawJobs) {
    if (!shouldIncludeYcJob(rawJob, searchState)) {
      continue;
    }

    const job = toJobRecord(rawJob, searchState.searchUrl);
    if (!job) {
      continue;
    }

    jobs.push(job);
  }

  return jobs;
}

export function parseYcJobsHtml(html, searchInput) {
  const payload = extractDataPagePayload(html);
  return parseYcJobsPayload(payload, searchInput);
}

function fetchYcJobsHtml(searchUrl, timeoutMs = 30_000) {
  const timeoutSeconds = Math.max(5, Math.ceil(timeoutMs / 1000));

  return execFileSync(
    "curl",
    [
      "-sS",
      "-L",
      "-A",
      DEFAULT_USER_AGENT,
      "--max-time",
      String(timeoutSeconds),
      String(searchUrl)
    ],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    }
  );
}

export function writeYcCaptureFile(source, jobs, options = {}) {
  assertYcSource(source);

  const capturePath = writeSourceCapturePayload(source, jobs, options);
  return {
    source,
    capturePath,
    jobsImported: Array.isArray(jobs) ? jobs.length : 0,
    capturedAt: options.capturedAt || new Date().toISOString(),
    pageUrl: options.pageUrl || null,
    expectedCount:
      Number.isFinite(Number(options.expectedCount)) && Number(options.expectedCount) > 0
        ? Math.round(Number(options.expectedCount))
        : null
  };
}

export function collectYcJobsFromSearch(source, options = {}) {
  assertYcSource(source);

  const htmlFetcher =
    typeof options.fetchHtml === "function" ? options.fetchHtml : fetchYcJobsHtml;
  const html = htmlFetcher(source.searchUrl, source.requestTimeoutMs || 30_000);
  const jobs = parseYcJobsHtml(html, source.searchUrl);
  const retrievedAt = new Date().toISOString();
  const jobsWithMetadata = jobs.map((job) => ({
    ...job,
    retrievedAt
  }));

  writeSourceCapturePayload(source, jobsWithMetadata, {
    capturedAt: retrievedAt,
    pageUrl: source.searchUrl,
    expectedCount: jobsWithMetadata.length
  });

  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return jobsWithMetadata.slice(0, source.maxJobs);
  }

  return jobsWithMetadata;
}
