import { execFileSync } from "node:child_process";

import {
  getFreshCachedJobs,
  writeSourceCapturePayload
} from "./cache-policy.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

export const LEVELSFYI_SOURCE_NOTES = Object.freeze({
  sourceType: "levelsfyi_search",
  canonicalReviewTarget: "https://www.levels.fyi/jobs?jobId=<id>",
  supportedCriteria: Object.freeze([
    "title -> /jobs/title/<slug>",
    "location -> /jobs/location/<slug>",
    "searchText / keywords / include terms -> searchText",
    "minSalary -> minBaseCompensation",
    "minBaseCompensation -> minBaseCompensation",
    "minMedianTotalCompensation -> minMedianTotalCompensation",
    "postedAfterTimeType + postedAfterValue -> query params",
    "sortBy -> query param passthrough"
  ]),
  unsupportedCriteria: Object.freeze([
    "exclude terms",
    "distanceMiles",
    "experienceLevel",
    "remote",
    "company"
  ]),
  minimumExtractionContract: Object.freeze([
    "title",
    "company",
    "location",
    "description or summary",
    "salaryText when present",
    "canonical review target via jobId"
  ]),
  boundedDetailEnrichment: Object.freeze({
    allowedWhen: "only to merge the page's matched initialJobDetails into the corresponding result job",
    rule: "keep the canonical Levels.fyi job detail URL as the review target; do not widen to shared browser flows"
  }),
  verification: Object.freeze([
    "builder test: path/query mapping",
    "parser test: __NEXT_DATA__ extraction and canonical review target",
    "collector test: capture write + maxJobs + bounded detail merge"
  ])
});

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

function slugifyPathSegment(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toAbsoluteUrl(inputUrl, baseUrl = "https://www.levels.fyi") {
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

function extractNextDataPayload(html) {
  const match = String(html || "").match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i
  );
  if (!match?.[1]) {
    return null;
  }

  const payloadText = decodeHtmlEntities(match[1]);
  if (!payloadText) {
    return null;
  }

  try {
    return JSON.parse(payloadText);
  } catch {
    return null;
  }
}

function normalizeLocation(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  return text.replace(/\s+/g, " ");
}

function normalizeSalaryCurrency(currency) {
  const normalized = normalizeText(currency).toUpperCase();
  if (!normalized) {
    return "";
  }

  if (normalized === "USD") return "$";
  if (normalized === "JPY") return "¥";
  if (normalized === "EUR") return "€";
  if (normalized === "GBP") return "£";
  return `${normalized} `;
}

function formatMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "";
  }

  const symbol = normalizeSalaryCurrency(currency);
  return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
}

function formatSalaryRange(minValue, maxValue, currency) {
  const minText = formatMoney(minValue, currency);
  const maxText = formatMoney(maxValue, currency);

  if (!minText && !maxText) {
    return "";
  }
  if (minText && !maxText) {
    return minText;
  }
  if (!minText && maxText) {
    return maxText;
  }
  if (minText === maxText) {
    return minText;
  }

  return `${minText} - ${maxText}`;
}

function buildSalaryText(job) {
  const baseSalary = formatSalaryRange(
    job?.minBaseSalary,
    job?.maxBaseSalary,
    job?.baseSalaryCurrency
  );
  if (baseSalary) {
    return baseSalary;
  }

  return formatSalaryRange(job?.minTotalSalary, job?.maxTotalSalary, job?.baseSalaryCurrency);
}

function buildSalarySummary(job) {
  const parts = [];
  const baseSalary = formatSalaryRange(
    job?.minBaseSalary,
    job?.maxBaseSalary,
    job?.baseSalaryCurrency
  );
  const totalSalary = formatSalaryRange(
    job?.minTotalSalary,
    job?.maxTotalSalary,
    job?.baseSalaryCurrency
  );

  if (baseSalary) {
    parts.push(`Base compensation: ${baseSalary}`);
  }
  if (totalSalary && totalSalary !== baseSalary) {
    parts.push(`Total compensation: ${totalSalary}`);
  }

  return parts.join(" · ");
}

function buildLocation(job, detail) {
  const resultLocations = Array.isArray(job?.locations)
    ? job.locations.map((location) => normalizeLocation(location)).filter(Boolean)
    : [];

  if (resultLocations.length > 0) {
    return resultLocations[0];
  }

  const detailLocations = Array.isArray(detail?.locations)
    ? detail.locations.map((location) => normalizeLocation(location)).filter(Boolean)
    : [];

  if (detailLocations.length > 0) {
    return detailLocations[0];
  }

  const postalAddress = Array.isArray(detail?.postalAddresses) ? detail.postalAddresses[0] : null;
  if (postalAddress && typeof postalAddress === "object") {
    const parts = [
      normalizeLocation(postalAddress.locality),
      normalizeLocation(postalAddress.administrativeArea),
      normalizeLocation(postalAddress.regionCode)
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join(", ");
    }
  }

  return "";
}

function buildEmploymentType(job, detail) {
  const types = Array.isArray(detail?.employmentTypes)
    ? detail.employmentTypes.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];

  if (types.length > 0) {
    return types.join(" · ");
  }

  const workArrangement = normalizeText(detail?.workArrangement);
  if (workArrangement) {
    return workArrangement;
  }

  return normalizeText(job?.employmentType);
}

function buildSummary(company, job) {
  const parts = [];
  const shortDescription = normalizeText(company?.shortDescription);
  const salarySummary = buildSalarySummary(job);

  if (shortDescription) {
    parts.push(shortDescription);
  }
  if (salarySummary) {
    parts.push(salarySummary);
  }

  return parts.join(" · ");
}

function buildDescription(company, job, detail) {
  if (detail) {
    const detailDescription = normalizeText(detail.description);
    if (detailDescription) {
      return detailDescription;
    }
  }

  const parts = [
    normalizeText(company?.shortDescription),
    buildSalarySummary(job),
    buildEmploymentType(job, detail),
    buildLocation(job, detail)
  ].filter(Boolean);

  return parts.join("\n\n") || `${normalizeText(job?.title)} at ${normalizeText(company?.companyName)}`;
}

function buildCanonicalReviewUrl(jobId) {
  const normalizedId = normalizeText(jobId);
  if (!normalizedId) {
    return "";
  }

  return `https://www.levels.fyi/jobs?jobId=${encodeURIComponent(normalizedId)}`;
}

export function toLevelsFyiReviewUrl(jobId) {
  return buildCanonicalReviewUrl(jobId);
}

function normalizeCriteriaText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSearchText(criteria = {}) {
  const pieces = [];
  const push = (value) => {
    const normalized = normalizeText(value).replace(/,+/g, " ");
    if (normalized) {
      pieces.push(normalized);
    }
  };

  push(criteria.searchText);
  push(criteria.keywords);

  if (Array.isArray(criteria.includeTerms)) {
    push(criteria.includeTerms.join(" "));
  }
  if (Array.isArray(criteria.hardIncludeTerms)) {
    push(criteria.hardIncludeTerms.join(" "));
  }

  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

function resolveDatePostedCriteria(criteria = {}) {
  const rawType = normalizeCriteriaText(criteria.postedAfterTimeType);
  const rawValue = normalizeCriteriaText(criteria.postedAfterValue);

  if (rawType && rawValue) {
    return {
      postedAfterTimeType: rawType,
      postedAfterValue: rawValue
    };
  }

  const rawDatePosted = normalizeCriteriaText(criteria.datePosted);
  if (!rawDatePosted) {
    return null;
  }

  if (rawDatePosted === "1d") {
    return {
      postedAfterTimeType: "days",
      postedAfterValue: "1"
    };
  }

  if (rawDatePosted === "3d") {
    return {
      postedAfterTimeType: "days",
      postedAfterValue: "3"
    };
  }

  if (rawDatePosted === "1w") {
    return {
      postedAfterTimeType: "days",
      postedAfterValue: "7"
    };
  }

  if (rawDatePosted === "2w") {
    return {
      postedAfterTimeType: "days",
      postedAfterValue: "14"
    };
  }

  if (rawDatePosted === "1m") {
    return {
      postedAfterTimeType: "days",
      postedAfterValue: "30"
    };
  }

  const dayMatch = rawDatePosted.match(/^(\d+)\s*(?:d|day|days)?$/i);
  if (dayMatch?.[1]) {
    return {
      postedAfterTimeType: "days",
      postedAfterValue: dayMatch[1]
    };
  }

  return null;
}

function buildPathSegments(criteria = {}) {
  const segments = ["/jobs"];
  const title = normalizeText(criteria.title);
  const location = normalizeText(criteria.location);

  if (title) {
    segments.push("title", slugifyPathSegment(title));
  }
  if (location) {
    segments.push("location", slugifyPathSegment(location));
  }

  return segments.filter(Boolean).join("/");
}

export function buildLevelsFyiSearchUrl(criteria = {}) {
  const baseUrl = new URL("https://www.levels.fyi");
  baseUrl.pathname = buildPathSegments(criteria);

  const searchText = normalizeSearchText(criteria);
  if (searchText) {
    baseUrl.searchParams.set("searchText", searchText);
  }

  const minBaseCompensation = Number(criteria.minBaseCompensation ?? criteria.minSalary);
  if (Number.isFinite(minBaseCompensation) && minBaseCompensation > 0) {
    baseUrl.searchParams.set("minBaseCompensation", String(Math.round(minBaseCompensation)));
  }

  const minMedianTotalCompensation = Number(criteria.minMedianTotalCompensation);
  if (
    Number.isFinite(minMedianTotalCompensation) &&
    minMedianTotalCompensation > 0
  ) {
    baseUrl.searchParams.set(
      "minMedianTotalCompensation",
      String(Math.round(minMedianTotalCompensation))
    );
  }

  const postedAfter = resolveDatePostedCriteria(criteria);
  if (postedAfter) {
    baseUrl.searchParams.set("postedAfterTimeType", postedAfter.postedAfterTimeType);
    baseUrl.searchParams.set("postedAfterValue", postedAfter.postedAfterValue);
  }

  const sortBy = normalizeText(criteria.sortBy);
  if (sortBy) {
    baseUrl.searchParams.set("sortBy", sortBy);
  }

  return baseUrl.toString();
}

function extractJobPostingData(pageProps = {}) {
  const results = Array.isArray(pageProps.initialJobsData?.results)
    ? pageProps.initialJobsData.results
    : [];
  const detail = pageProps.initialJobDetails || null;
  const detailJobId = normalizeText(detail?.id);

  const jobs = [];

  for (const company of results) {
    const companyName = normalizeText(company?.companyName);
    const companySlug = normalizeText(company?.companySlug);
    const shortDescription = normalizeText(company?.shortDescription);
    const jobList = Array.isArray(company?.jobs) ? company.jobs : [];

    for (const job of jobList) {
      const jobId = normalizeText(job?.id);
      const title = normalizeText(job?.title);
      if (!jobId || !title || !companyName) {
        continue;
      }

      const matchedDetail = detailJobId && detailJobId === jobId ? detail : null;
      const location = buildLocation(job, matchedDetail);
      const salaryText = buildSalaryText(job);
      const summary = buildSummary(
        {
          ...company,
          shortDescription
        },
        job
      );
      const detailDescription = buildDescription(company, job, matchedDetail);
      const employmentType = buildEmploymentType(job, matchedDetail);
      const postedAt = normalizeText(matchedDetail?.postingDate || job.postingDate || "");

      jobs.push({
        externalId: jobId,
        title,
        company: companyName,
        location: location || null,
        postedAt: postedAt || null,
        employmentType: employmentType || null,
        easyApply: false,
        salaryText: salaryText || null,
        summary: summary || `${title} at ${companyName}`,
        description: detailDescription || `${title} at ${companyName}`,
        url: buildCanonicalReviewUrl(jobId),
        pageUrl: null,
        sourceJobId: jobId,
        companySlug: companySlug || null,
        applicationUrl: normalizeText(matchedDetail?.applicationUrl || job.applicationUrl || ""),
        compensationDetails: {
          base: formatSalaryRange(job.minBaseSalary, job.maxBaseSalary, job.baseSalaryCurrency) || null,
          total: formatSalaryRange(job.minTotalSalary, job.maxTotalSalary, job.baseSalaryCurrency) || null,
          currency: normalizeText(job.baseSalaryCurrency) || null
        }
      });
    }
  }

  return jobs;
}

export function parseLevelsFyiSearchHtml(html, searchUrl) {
  const payload = extractNextDataPayload(html);
  if (!payload) {
    return [];
  }

  const pageProps = payload?.props?.pageProps || {};
  const jobs = extractJobPostingData(pageProps);

  return jobs.map((job) => ({
    ...job,
    pageUrl: toAbsoluteUrl(searchUrl)
  }));
}

function fetchLevelsFyiSearchHtml(searchUrl, timeoutMs = 30_000) {
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

export function writeLevelsFyiCaptureFile(source, jobs, options = {}) {
  if (!source || source.type !== "levelsfyi_search") {
    throw new Error("Levels.fyi capture write requires a levelsfyi_search source.");
  }

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

export function collectLevelsFyiJobsFromSearch(source, options = {}) {
  const cachedJobs = getFreshCachedJobs(source);
  if (Array.isArray(cachedJobs)) {
    if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
      return cachedJobs.slice(0, source.maxJobs);
    }
    return cachedJobs;
  }

  const fetchHtml =
    typeof options.fetchHtml === "function"
      ? options.fetchHtml
      : (searchUrl) => fetchLevelsFyiSearchHtml(searchUrl, options.timeoutMs || 30_000);

  const html = fetchHtml(source.searchUrl);
  const jobs = parseLevelsFyiSearchHtml(html, source.searchUrl);
  const capturedAt = new Date().toISOString();
  const pageProps = extractNextDataPayload(html)?.props?.pageProps || {};
  const expectedCount = Number(pageProps.initialJobsData?.totalMatchingJobs || pageProps.initialJobsData?.total);
  const jobsWithMetadata = jobs.map((job) => ({
    ...job,
    retrievedAt: capturedAt
  }));

  writeSourceCapturePayload(source, jobsWithMetadata, {
    capturedAt,
    pageUrl: source.searchUrl,
    expectedCount:
      Number.isFinite(expectedCount) && expectedCount > 0 ? Math.round(expectedCount) : null
  });

  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return jobsWithMetadata.slice(0, source.maxJobs);
  }

  return jobsWithMetadata;
}
