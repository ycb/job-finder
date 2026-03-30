import crypto from "node:crypto";
import {
  canonicalizeZipRecruiterSourceUrl,
  extractZipRecruiterDeepLinkId
} from "../sources/ziprecruiter-jobs.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.replace(/\s+/g, " ").trim();
}

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseUrlSafe(rawUrl) {
  try {
    return new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }
}

function hostLooksLikeLinkedIn(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}

function hostLooksLikeIndeed(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "indeed.com" || host.endsWith(".indeed.com");
}

function hostLooksLikeGoogle(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "google.com" || host.endsWith(".google.com");
}

function hostLooksLikeZipRecruiter(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "ziprecruiter.com" || host.endsWith(".ziprecruiter.com");
}

function hostLooksLikeLevelsFyi(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "levels.fyi" || host.endsWith(".levels.fyi");
}

function hostLooksLikeWorkAtAStartup(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "workatastartup.com" || host.endsWith(".workatastartup.com");
}

function extractLinkedInJobIdFromUrl(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed) {
    return "";
  }

  const pathMatch = parsed.pathname.match(/\/jobs\/view\/(\d+)/i);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const paramId = parsed.searchParams.get("currentJobId") || parsed.searchParams.get("jobId");
  if (paramId && /^\d+$/.test(paramId)) {
    return paramId;
  }

  return "";
}

function extractIndeedJobIdFromUrl(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed || !hostLooksLikeIndeed(parsed.hostname)) {
    return "";
  }

  const directId = parsed.searchParams.get("jk") || parsed.searchParams.get("vjk");
  if (directId) {
    return normalizeText(directId);
  }

  return "";
}

function extractGoogleJobsDocIdFromHash(hashValue) {
  const rawHash = String(hashValue || "").replace(/^#/, "");
  if (!rawHash) {
    return "";
  }

  const hashParams = new URLSearchParams(rawHash);
  const vhid = normalizeText(hashParams.get("vhid") || "");
  if (vhid) {
    const docIdFromVhid = vhid.match(/(?:^|\/)docid=([^&/]+)/i);
    if (docIdFromVhid?.[1]) {
      return normalizeText(docIdFromVhid[1]);
    }
  }

  const decodedHash = normalizeText(decodeURIComponent(rawHash));
  if (!decodedHash) {
    return "";
  }

  const docIdFromDecoded = decodedHash.match(/(?:^|[/?&])docid=([^&/]+)/i);
  if (docIdFromDecoded?.[1]) {
    return normalizeText(docIdFromDecoded[1]);
  }

  return "";
}

function extractGoogleJobsDocIdFromUrl(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed || !hostLooksLikeGoogle(parsed.hostname)) {
    return "";
  }

  const directId = normalizeText(parsed.searchParams.get("docid") || "");
  if (directId) {
    return directId;
  }

  return extractGoogleJobsDocIdFromHash(parsed.hash);
}

function extractLevelsFyiJobIdFromUrl(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed || !hostLooksLikeLevelsFyi(parsed.hostname)) {
    return "";
  }

  const directId = normalizeText(parsed.searchParams.get("jobId") || "");
  if (directId) {
    return directId;
  }

  return "";
}

function extractYcJobIdFromUrl(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed || !hostLooksLikeWorkAtAStartup(parsed.hostname)) {
    return "";
  }

  const pathMatch = parsed.pathname.match(/^\/jobs\/([^/?#]+)/i);
  if (pathMatch?.[1]) {
    return normalizeText(pathMatch[1]);
  }

  const signupId = normalizeText(parsed.searchParams.get("signup_job_id") || "");
  if (signupId) {
    return signupId;
  }

  return "";
}

function canonicalizeSourceUrl(rawUrl) {
  const parsed = parseUrlSafe(rawUrl);
  if (!parsed) {
    return normalizeText(rawUrl);
  }

  if (hostLooksLikeLinkedIn(parsed.hostname)) {
    const linkedInId = extractLinkedInJobIdFromUrl(parsed.toString());
    if (linkedInId) {
      return `https://www.linkedin.com/jobs/view/${linkedInId}/`;
    }
  }

  if (hostLooksLikeIndeed(parsed.hostname)) {
    const indeedJobId = extractIndeedJobIdFromUrl(parsed.toString());
    if (indeedJobId) {
      return `https://www.indeed.com/viewjob?jk=${encodeURIComponent(indeedJobId)}`;
    }
  }

  if (hostLooksLikeGoogle(parsed.hostname) && parsed.pathname === "/search") {
    const googleDocId = extractGoogleJobsDocIdFromUrl(parsed.toString());
    if (googleDocId) {
      return `https://www.google.com/search?docid=${encodeURIComponent(googleDocId)}`;
    }
  }

  if (hostLooksLikeZipRecruiter(parsed.hostname)) {
    return canonicalizeZipRecruiterSourceUrl(parsed.toString());
  }

  if (hostLooksLikeLevelsFyi(parsed.hostname) && parsed.pathname === "/jobs") {
    const levelsJobId = extractLevelsFyiJobIdFromUrl(parsed.toString());
    if (levelsJobId) {
      return `https://www.levels.fyi/jobs?jobId=${encodeURIComponent(levelsJobId)}`;
    }
  }

  if (hostLooksLikeWorkAtAStartup(parsed.hostname)) {
    const ycJobId = extractYcJobIdFromUrl(parsed.toString());
    if (ycJobId) {
      return `https://www.workatastartup.com/jobs/${encodeURIComponent(ycJobId)}`;
    }
  }

  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function normalizeCompanyAndLocation(title, company, location) {
  const normalizedTitle = normalizeText(title);
  const normalizedCompany = normalizeText(company);
  const normalizedLocation = normalizeText(location);

  if (
    normalizedCompany &&
    normalizedLocation &&
    normalizedCompany.toLowerCase() === normalizedTitle.toLowerCase()
  ) {
    return {
      company: normalizedLocation,
      location: null
    };
  }

  return {
    company: normalizedCompany,
    location: normalizedLocation || null
  };
}

function inferExternalId(externalId, sourceUrl, sourceType) {
  const normalizedExternalId = normalizeText(externalId);
  if (normalizedExternalId) {
    return normalizedExternalId;
  }

  if (sourceType === "linkedin_capture_file") {
    return extractLinkedInJobIdFromUrl(sourceUrl) || null;
  }

  if (sourceType === "indeed_search") {
    return extractIndeedJobIdFromUrl(sourceUrl) || null;
  }

  if (sourceType === "google_search") {
    return extractGoogleJobsDocIdFromUrl(sourceUrl) || null;
  }

  if (sourceType === "ziprecruiter_search") {
    return extractZipRecruiterDeepLinkId(sourceUrl) || null;
  }

  if (sourceType === "levelsfyi_search") {
    return extractLevelsFyiJobIdFromUrl(sourceUrl) || null;
  }

  if (sourceType === "yc_jobs") {
    return extractYcJobIdFromUrl(sourceUrl) || null;
  }

  return null;
}

function buildJobIdentity({ sourceType, sourceId, sourceUrl, externalId, title, company, location }) {
  const canonicalSourceUrl = canonicalizeSourceUrl(sourceUrl);
  const inferredExternalId = inferExternalId(externalId, canonicalSourceUrl || sourceUrl, sourceType);
  const normalizedRole = normalizeCompanyAndLocation(title, company, location);
  const roleSeed = `${normalizedRole.company.toLowerCase()}|${normalizeText(title).toLowerCase()}`;

  let dedupeSeed = "";
  if (sourceType === "linkedin_capture_file") {
    // Keep LinkedIn dedupe stable across legacy captures (no external id)
    // and newer captures that include `/jobs/view/{id}` URLs.
    dedupeSeed = `linkedin:${roleSeed}`;
  } else if (inferredExternalId) {
    dedupeSeed = `${sourceType}:external:${inferredExternalId.toLowerCase()}`;
  } else if (canonicalSourceUrl && !/\/jobs\/search-results\//i.test(canonicalSourceUrl)) {
    dedupeSeed = `url:${canonicalSourceUrl.toLowerCase()}`;
  } else {
    dedupeSeed = `fallback:${roleSeed}`;
  }

  const recordKey = inferredExternalId
    ? `external:${inferredExternalId}`
    : canonicalSourceUrl || `${normalizeText(title)}|${normalizedRole.company}|${sourceId}`;

  return {
    id: hashValue(`${sourceId}|${recordKey}`),
    externalId: inferredExternalId,
    sourceUrl: canonicalSourceUrl || normalizeText(sourceUrl),
    company: normalizedRole.company,
    location: normalizedRole.location,
    normalizedHash: hashValue(dedupeSeed)
  };
}

function parsePostedAt(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw.replace(/^posted on\s+/i, ""));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  const relative = raw.toLowerCase().match(/^(\d+)\s+(hour|day|week|month|year)s?\s+ago$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const now = new Date();

    if (unit === "hour") now.setHours(now.getHours() - amount);
    if (unit === "day") now.setDate(now.getDate() - amount);
    if (unit === "week") now.setDate(now.getDate() - amount * 7);
    if (unit === "month") now.setMonth(now.getMonth() - amount);
    if (unit === "year") now.setFullYear(now.getFullYear() - amount);

    return now.toISOString();
  }

  if (raw.toLowerCase() === "today") {
    return new Date().toISOString();
  }

  if (raw.toLowerCase() === "yesterday") {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString();
  }

  return raw;
}

function parseRelativeFreshnessDays(rawText) {
  const normalized = normalizeText(rawText).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "today") {
    return 0;
  }
  if (normalized === "yesterday") {
    return 1;
  }

  const match = normalized.match(/^(\d+)\s+(hour|day|week|month|year)s?\s+ago$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  if (unit === "hour") {
    return Math.max(0, Math.floor(amount / 24));
  }
  if (unit === "day") {
    return amount;
  }
  if (unit === "week") {
    return amount * 7;
  }
  if (unit === "month") {
    return amount * 30;
  }
  if (unit === "year") {
    return amount * 365;
  }

  return null;
}

function toFreshnessMeta(rawPostedAt, postedAtIso) {
  const rawText = normalizeText(rawPostedAt);
  const postedAtMs = Date.parse(String(postedAtIso || ""));
  let relativeDays = null;

  if (Number.isFinite(postedAtMs)) {
    relativeDays = Math.max(
      0,
      Math.floor((Date.now() - postedAtMs) / (24 * 60 * 60 * 1000))
    );
  } else {
    relativeDays = parseRelativeFreshnessDays(rawText);
  }

  return {
    rawText: rawText || "unknown",
    postedAtIso: Number.isFinite(postedAtMs) ? new Date(postedAtMs).toISOString() : null,
    relativeDays: Number.isFinite(relativeDays) ? relativeDays : null
  };
}

function parseSalaryMeta(rawSalaryText) {
  const rawText = normalizeText(rawSalaryText);
  const matches = String(rawText).match(
    /\$?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?/g
  );

  if (!rawText) {
    return {
      rawText: "unknown",
      minAnnualUsd: null,
      maxAnnualUsd: null
    };
  }

  const parsedNumbers = [];
  for (const entry of matches || []) {
    const normalized = String(entry || "").toLowerCase();
    const suffixMatch = normalized.match(/[km]$/i);
    const suffix = suffixMatch ? suffixMatch[0].toLowerCase() : "";
    const numeric = Number(
      normalized
        .replace(/[,$\s]/g, "")
        .replace(/[km]$/i, "")
    );
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    const scaled =
      suffix === "k" ? numeric * 1000 : suffix === "m" ? numeric * 1000000 : numeric;
    parsedNumbers.push(Math.round(scaled));
  }

  if (parsedNumbers.length === 0) {
    return {
      rawText,
      minAnnualUsd: null,
      maxAnnualUsd: null
    };
  }

  parsedNumbers.sort((left, right) => left - right);
  return {
    rawText,
    minAnnualUsd: parsedNumbers[0],
    maxAnnualUsd: parsedNumbers[parsedNumbers.length - 1]
  };
}

function inferWorkModel(location, description) {
  const haystack = `${normalizeText(location)} ${normalizeText(description)}`.toLowerCase();
  if (!haystack) {
    return null;
  }
  if (/\bhybrid\b/.test(haystack)) {
    return "hybrid";
  }
  if (/\bremote\b/.test(haystack)) {
    return "remote";
  }
  if (/\bon[\s-]?site\b|\bin[\s-]?office\b/.test(haystack)) {
    return "on-site";
  }
  return null;
}

function extractTopSkills(description) {
  const text = normalizeText(description).toLowerCase();
  if (!text) {
    return [];
  }

  const knownSkills = [
    "ai",
    "machine learning",
    "llm",
    "python",
    "sql",
    "product management",
    "data infrastructure",
    "distributed systems"
  ];

  return knownSkills.filter((skill) => text.includes(skill)).slice(0, 8);
}

export function normalizeJobRecord(rawJob, source) {
  const title = normalizeText(rawJob.title);
  const company = normalizeText(rawJob.company);
  const location = normalizeText(rawJob.location);
  const description = normalizeText(
    rawJob.description || rawJob.summary || `${title} at ${company} ${location}`
  );
  const sourceUrl = normalizeText(rawJob.url || rawJob.sourceUrl || source.searchUrl);

  if (!title || !company || !description || !sourceUrl) {
    throw new Error(
      `Job from source ${source.id} is missing one of: title, company, description, url.`
    );
  }

  const now = new Date().toISOString();
  const retrievedAt = normalizeText(rawJob.retrievedAt) || now;
  const postedAt = parsePostedAt(rawJob.postedAt);
  const identity = buildJobIdentity({
    sourceType: source.type,
    sourceId: source.id,
    sourceUrl,
    externalId: rawJob.externalId,
    title,
    company,
    location
  });
  const normalizedLocation = identity.location || null;
  const normalizedSalaryText = normalizeText(rawJob.salaryText) || null;
  const normalizedEmploymentType = normalizeText(rawJob.employmentType) || null;
  const structuredLocation = normalizedLocation || "unknown";
  const structuredSalaryText = normalizedSalaryText || "unknown";
  const structuredEmploymentType = normalizedEmploymentType || "unknown";
  const freshness = toFreshnessMeta(rawJob.postedAt, postedAt);
  const salary = parseSalaryMeta(structuredSalaryText);
  const workModel = inferWorkModel(structuredLocation, description);
  const skills = extractTopSkills(description);
  const extractorProvenance =
    rawJob.extractorProvenance &&
    typeof rawJob.extractorProvenance === "object" &&
    !Array.isArray(rawJob.extractorProvenance)
      ? rawJob.extractorProvenance
      : null;
  const structuredMeta = {
    title,
    company: identity.company,
    location: structuredLocation,
    freshness,
    salary,
    description,
    employmentType: structuredEmploymentType
  };
  if (workModel) {
    structuredMeta.workModel = workModel;
  }
  if (skills.length > 0) {
    structuredMeta.skills = skills;
  }
  if (extractorProvenance) {
    structuredMeta.extractorProvenance = extractorProvenance;
    structuredMeta.descriptionSource =
      normalizeText(extractorProvenance.description) || "unknown";
  }

  const missingRequiredFields = [];
  if (structuredMeta.location === "unknown") {
    missingRequiredFields.push("location");
  }
  if (structuredMeta.salary.rawText === "unknown") {
    missingRequiredFields.push("salary");
  }
  if (structuredMeta.freshness.rawText === "unknown") {
    missingRequiredFields.push("freshness");
  }
  if (structuredMeta.employmentType === "unknown") {
    missingRequiredFields.push("employmentType");
  }
  const metadataQualityScore = Math.max(
    0,
    Math.round(((6 - missingRequiredFields.length) / 6) * 100)
  );

  return {
    id: identity.id,
    source: source.type,
    sourceId: source.id,
    sourceUrl: identity.sourceUrl,
    externalId: identity.externalId,
    title,
    company: identity.company,
    location: normalizedLocation,
    postedAt,
    employmentType: normalizedEmploymentType,
    easyApply: Boolean(rawJob.easyApply),
    salaryText: normalizedSalaryText,
    description,
    normalizedHash: identity.normalizedHash,
    structuredMeta,
    metadataQualityScore,
    missingRequiredFields,
    createdAt: now,
    updatedAt: retrievedAt
  };
}

export function normalizeStoredJobForDedupe(job) {
  return buildJobIdentity({
    sourceType: job.source,
    sourceId: job.source_id || job.sourceId || "",
    sourceUrl: job.source_url || job.sourceUrl || "",
    externalId: job.external_id || job.externalId || "",
    title: job.title || "",
    company: job.company || "",
    location: job.location || ""
  });
}
