import { execFileSync } from "node:child_process";

import {
  getFreshCachedJobs,
  writeSourceCapturePayload
} from "./cache-policy.js";

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

function isProductManagerRoute(searchUrl) {
  return /\/jobs\/l\/product-manager\/?$/i.test(String(searchUrl || "").trim());
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

function toJobRecord(rawJob, searchUrl) {
  const title = normalizeText(rawJob?.title);
  const company = normalizeText(rawJob?.companyName);
  const companySlug = normalizeText(rawJob?.companySlug);
  const url = companyUrlForSlug(companySlug);

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
    externalId:
      rawJob?.id === null || rawJob?.id === undefined
        ? null
        : String(rawJob.id),
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

export function parseYcJobsHtml(html, searchUrl) {
  const payload = extractDataPagePayload(html);
  if (!payload) {
    return [];
  }

  const rawJobs = findJobsArray(payload);
  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    return [];
  }

  const filterProductRoles = isProductManagerRoute(searchUrl);
  const jobs = [];

  for (const rawJob of rawJobs) {
    const job = toJobRecord(rawJob, searchUrl);
    if (!job) {
      continue;
    }

    if (filterProductRoles && !isRelevantProductRole(job.title)) {
      continue;
    }

    jobs.push(job);
  }

  return jobs;
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

  const cachedJobs = getFreshCachedJobs(source);
  if (Array.isArray(cachedJobs)) {
    if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
      return cachedJobs.slice(0, source.maxJobs);
    }
    return cachedJobs;
  }

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
