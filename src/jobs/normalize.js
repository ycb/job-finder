import crypto from "node:crypto";

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
  const identity = buildJobIdentity({
    sourceType: source.type,
    sourceId: source.id,
    sourceUrl,
    externalId: rawJob.externalId,
    title,
    company,
    location
  });

  return {
    id: identity.id,
    source: source.type,
    sourceId: source.id,
    sourceUrl: identity.sourceUrl,
    externalId: identity.externalId,
    title,
    company: identity.company,
    location: identity.location,
    postedAt: parsePostedAt(rawJob.postedAt),
    employmentType: normalizeText(rawJob.employmentType) || null,
    easyApply: Boolean(rawJob.easyApply),
    salaryText: normalizeText(rawJob.salaryText) || null,
    description,
    normalizedHash: identity.normalizedHash,
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
