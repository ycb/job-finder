import {
  getSourceCaptureJobs,
  writeSourceCapturePayload
} from "./cache-policy.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.replace(/\s+/g, " ").trim();
}

function parseUrlSafe(rawUrl) {
  try {
    return new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }
}

function hostLooksLikeZipRecruiter(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "ziprecruiter.com" || host.endsWith(".ziprecruiter.com");
}

export function extractZipRecruiterDeepLinkId(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed || !hostLooksLikeZipRecruiter(parsed.hostname)) {
    return "";
  }

  const lk = normalizeText(parsed.searchParams.get("lk") || "");
  if (lk) {
    return lk;
  }

  return normalizeText(parsed.searchParams.get("uuid") || "");
}

export function canonicalizeZipRecruiterSourceUrl(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed) {
    return normalizeText(rawUrl);
  }

  if (!hostLooksLikeZipRecruiter(parsed.hostname)) {
    return parsed.toString();
  }

  const canonical = new URL(parsed.toString());
  const lk = normalizeText(parsed.searchParams.get("lk") || "");
  const uuid = normalizeText(parsed.searchParams.get("uuid") || "");

  canonical.hash = "";
  canonical.search = "";

  if (lk) {
    canonical.searchParams.set("lk", lk);
  } else if (uuid) {
    canonical.searchParams.set("uuid", uuid);
  }

  return canonical.toString();
}

function sanitizeZipRecruiterJob(job) {
  if (!job || typeof job !== "object") {
    return job;
  }

  const url = canonicalizeZipRecruiterSourceUrl(job.url || "");
  const inferredExternalId = extractZipRecruiterDeepLinkId(url);
  const externalId = normalizeText(job.externalId) || inferredExternalId || null;

  return {
    ...job,
    url,
    externalId
  };
}

function assertZipRecruiterSource(source) {
  if (!source || source.type !== "ziprecruiter_search") {
    throw new Error("ZipRecruiter capture write requires a ziprecruiter_search source.");
  }
}

export function writeZipRecruiterCaptureFile(source, jobs, options = {}) {
  assertZipRecruiterSource(source);
  const sanitizedJobs = Array.isArray(jobs) ? jobs.map((job) => sanitizeZipRecruiterJob(job)) : [];

  const capturePath = writeSourceCapturePayload(source, sanitizedJobs, options);
  return {
    source,
    capturePath,
    jobsImported: sanitizedJobs.length,
    capturedAt: options.capturedAt || new Date().toISOString(),
    pageUrl: options.pageUrl || null,
    expectedCount:
      Number.isFinite(Number(options.expectedCount)) && Number(options.expectedCount) > 0
        ? Math.round(Number(options.expectedCount))
        : null
  };
}

export function collectZipRecruiterJobsFromSearch(source) {
  const capturedJobs = getSourceCaptureJobs(source).map((job) => sanitizeZipRecruiterJob(job));
  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return capturedJobs.slice(0, source.maxJobs);
  }

  return capturedJobs;
}
