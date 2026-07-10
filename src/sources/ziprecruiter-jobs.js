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

export function parseZipRecruiterDeepLink(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed || !hostLooksLikeZipRecruiter(parsed.hostname)) {
    return {
      lk: "",
      uuid: ""
    };
  }

  return {
    lk: normalizeText(parsed.searchParams.get("lk") || ""),
    uuid: normalizeText(parsed.searchParams.get("uuid") || "")
  };
}

export function extractZipRecruiterDeepLinkId(rawUrl) {
  const { lk, uuid } = parseZipRecruiterDeepLink(rawUrl);
  if (lk) {
    return lk;
  }

  return uuid;
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
  canonical.hash = "";

  return canonical.toString();
}

function parseZipRecruiterUrlSafe(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed || !hostLooksLikeZipRecruiter(parsed.hostname)) {
    return null;
  }
  return parsed;
}

export function selectZipRecruiterJobUrl({ primaryUrl, detailUrl } = {}) {
  const primaryParsed = parseZipRecruiterUrlSafe(primaryUrl);
  const detailParsed = parseZipRecruiterUrlSafe(detailUrl);

  if (!primaryParsed && !detailParsed) {
    return normalizeText(primaryUrl || detailUrl || "");
  }
  if (!primaryParsed) {
    return canonicalizeZipRecruiterSourceUrl(detailParsed.toString());
  }
  if (!detailParsed) {
    return canonicalizeZipRecruiterSourceUrl(primaryParsed.toString());
  }

  const primaryIdentity = parseZipRecruiterDeepLink(primaryParsed.toString());
  const detailIdentity = parseZipRecruiterDeepLink(detailParsed.toString());
  const samePath = primaryParsed.pathname === detailParsed.pathname;
  const sameUuid =
    primaryIdentity.uuid &&
    detailIdentity.uuid &&
    primaryIdentity.uuid === detailIdentity.uuid;

  if (detailIdentity.lk && (!primaryIdentity.lk || sameUuid || samePath)) {
    return canonicalizeZipRecruiterSourceUrl(detailParsed.toString());
  }

  return canonicalizeZipRecruiterSourceUrl(primaryParsed.toString());
}

function sanitizeZipRecruiterJob(job) {
  if (!job || typeof job !== "object") {
    return job;
  }

  const url = selectZipRecruiterJobUrl({
    primaryUrl: job.url || "",
    detailUrl: job.detailUrl || job.detail_url || ""
  });
  const inferredExternalId = extractZipRecruiterDeepLinkId(url);
  const externalId = normalizeText(job.externalId) || inferredExternalId || null;

  return {
    ...job,
    detailUrl: undefined,
    detail_url: undefined,
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
