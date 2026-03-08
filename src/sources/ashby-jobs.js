import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { enrichJobsWithDetailPages } from "./detail-enrichment.js";

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

function toAbsoluteUrl(inputUrl, baseUrl) {
  const normalized = String(inputUrl || "").trim();
  if (!normalized) {
    return "";
  }

  try {
    const base = new URL(String(baseUrl || "").trim() || "https://jobs.ashbyhq.com");
    return new URL(normalized, base.toString()).toString();
  } catch {
    if (normalized.startsWith("/")) {
      return `https://jobs.ashbyhq.com${normalized}`;
    }
    return normalized;
  }
}

function extractAshbyExternalId(url) {
  const match = String(url || "").match(/\/([a-f0-9]{24,}|[0-9]{5,})(?:[/?#]|$)/i);
  return match?.[1] || null;
}

function parseCompanyFromTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = normalizeText(titleMatch?.[1] || "");
  if (!title) {
    return "";
  }

  const patterns = [
    /^jobs at (.+)$/i,
    /^open roles at (.+)$/i,
    /^careers at (.+)$/i,
    /^(.+?) careers$/i,
    /^(.+?) jobs$/i
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) {
      return normalizeText(match[1]);
    }
  }

  const split = title.split("|")[0];
  return normalizeText(split.replace(/\b(open roles|jobs|careers)\b/gi, ""));
}

function isGoogleSearchUrl(searchUrl) {
  try {
    const parsed = new URL(String(searchUrl || "").trim());
    return /(^|\.)google\./i.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function parseGoogleSearchQuery(searchUrl) {
  try {
    const parsed = new URL(String(searchUrl || "").trim());
    if (!/(^|\.)google\./i.test(parsed.hostname)) {
      return "";
    }
    return decodeURIComponent(parsed.searchParams.get("q") || "").trim();
  } catch {
    return "";
  }
}

function extractQueryTerms(queryText) {
  const raw = normalizeText(queryText).toLowerCase();
  if (!raw) {
    return { phrases: [], tokens: [] };
  }

  const phrases = [];
  for (const match of raw.matchAll(/"([^"]+)"/g)) {
    const phrase = normalizeText(match[1]).toLowerCase();
    if (phrase) {
      phrases.push(phrase);
    }
  }

  const remainder = raw.replace(/"[^"]+"/g, " ");
  const tokens = remainder
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !token.startsWith("site:"))
    .filter((token) => !["and", "or", "not"].includes(token))
    .map((token) => token.replace(/^[^\w]+|[^\w]+$/g, ""))
    .filter((token) => token.length >= 2);

  return { phrases, tokens };
}

function jobMatchesQuery(job, queryText) {
  const { phrases, tokens } = extractQueryTerms(queryText);
  if (!phrases.length && !tokens.length) {
    return true;
  }

  const searchable = normalizeText(
    [
      job.title,
      job.company,
      job.location,
      job.description,
      job.summary,
      job.employmentType,
      job.salaryText
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  for (const phrase of phrases) {
    if (!searchable.includes(phrase)) {
      return false;
    }
  }

  if (!tokens.length) {
    return true;
  }

  const matchedTokenCount = tokens.reduce(
    (count, token) => (searchable.includes(token) ? count + 1 : count),
    0
  );

  const minRequired =
    tokens.length <= 2 ? tokens.length : Math.max(2, Math.ceil(tokens.length * 0.5));

  return matchedTokenCount >= minRequired;
}

function chooseFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function looksLikeJobTitle(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized || normalized.length < 4 || normalized.length > 180) {
    return false;
  }

  const blocked = new Set([
    "home",
    "about",
    "teams",
    "benefits",
    "locations",
    "privacy policy",
    "terms",
    "apply",
    "learn more",
    "view all",
    "all jobs",
    "careers"
  ]);

  if (blocked.has(normalized)) {
    return false;
  }

  return /[a-z]/i.test(normalized) && /\s/.test(normalized);
}

function parseJobsFromNextData(html, searchUrl) {
  const companyFromTitle = parseCompanyFromTitle(html);
  const match = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match?.[1]) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const jobs = [];
  const seen = new Set();
  const queue = [parsed];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || typeof next !== "object") {
      continue;
    }

    if (Array.isArray(next)) {
      queue.push(...next);
      continue;
    }

    const title = chooseFirstNonEmpty(next.title, next.name, next.jobTitle);
    const rawUrl = chooseFirstNonEmpty(
      next.jobUrl,
      next.absoluteUrl,
      next.url,
      next.applyUrl,
      next.canonicalUrl
    );
    const slug = chooseFirstNonEmpty(next.slug, next.jobSlug);
    const url = toAbsoluteUrl(rawUrl || slug, searchUrl);

    if (looksLikeJobTitle(title) && url) {
      const key = `${title.toLowerCase()}|${url.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        const company = chooseFirstNonEmpty(
          next.companyName,
          next.organizationName,
          next.company,
          next.organization,
          companyFromTitle
        );
        const location = chooseFirstNonEmpty(
          next.locationName,
          next.location?.name,
          next.location,
          next.workplaceType
        );
        const employmentType = chooseFirstNonEmpty(
          next.employmentType,
          next.commitment,
          next.workplaceType,
          next.departmentName
        );
        const description = chooseFirstNonEmpty(next.description, next.summary, title);

        if (company) {
          jobs.push({
            externalId:
              chooseFirstNonEmpty(next.jobPostingId, next.jobId, next.id) ||
              extractAshbyExternalId(url),
            title,
            company,
            location: location || null,
            postedAt:
              chooseFirstNonEmpty(next.publishedAt, next.postedAt, next.createdAt) || null,
            employmentType: employmentType || null,
            easyApply: false,
            salaryText: chooseFirstNonEmpty(next.salaryText, next.compensationText) || null,
            summary: description.slice(0, 320),
            description,
            url
          });
        }
      }
    }

    for (const value of Object.values(next)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return jobs;
}

function parseJobsFromAnchors(html, searchUrl) {
  const companyFromTitle = parseCompanyFromTitle(html);
  const jobs = [];
  const seen = new Set();
  const anchorPattern = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const hrefRaw = match[1];
    const title = normalizeText(match[2]);
    if (!looksLikeJobTitle(title)) {
      continue;
    }

    if (
      !/ashbyhq\.com/i.test(hrefRaw) &&
      !hrefRaw.startsWith("/") &&
      !hrefRaw.startsWith("./")
    ) {
      continue;
    }

    const href = toAbsoluteUrl(hrefRaw, searchUrl);
    if (!/ashbyhq\.com/i.test(href)) {
      continue;
    }

    const url = href.replace(/[?#].*$/, "");
    const key = `${title.toLowerCase()}|${url.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const blockStart = Math.max(0, (match.index || 0) - 600);
    const blockEnd = Math.min(html.length, (match.index || 0) + match[0].length + 600);
    const block = html.slice(blockStart, blockEnd);

    const location = chooseFirstNonEmpty(
      block.match(/(?:location|office|remote)[^<]{0,80}/i)?.[0],
      ""
    );
    const postedAt = chooseFirstNonEmpty(
      block.match(/(\d+\s+(?:hour|day|week|month|year)s?\s+ago)/i)?.[1],
      block.match(/\b(today|yesterday)\b/i)?.[1]
    );

    if (!companyFromTitle) {
      continue;
    }

    jobs.push({
      externalId: extractAshbyExternalId(url),
      title,
      company: companyFromTitle,
      location: location || null,
      postedAt: postedAt || null,
      employmentType: null,
      easyApply: false,
      salaryText: null,
      summary: `${title} at ${companyFromTitle}`,
      description: `${title} at ${companyFromTitle}`,
      url
    });
  }

  return jobs;
}

function canonicalizeAshbyBoardUrl(inputUrl) {
  try {
    const parsed = new URL(String(inputUrl || "").trim());
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("ashbyhq.com")) {
      return "";
    }

    parsed.hash = "";
    parsed.search = "";

    if (host === "jobs.ashbyhq.com") {
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (!segments.length) {
        return "https://jobs.ashbyhq.com/";
      }
      return `https://jobs.ashbyhq.com/${segments[0]}`;
    }

    return `${parsed.protocol}//${parsed.hostname}/`;
  } catch {
    return "";
  }
}

export function extractAshbyBoardUrlsFromGoogleHtml(html) {
  const urls = new Set();
  const decodedHtml = decodeHtmlEntities(String(html || ""));

  const googleRedirectPattern = /href="\/url\?q=([^"&]+)[^"]*"/gi;
  for (const match of decodedHtml.matchAll(googleRedirectPattern)) {
    const candidate = decodeURIComponent(match[1] || "");
    const boardUrl = canonicalizeAshbyBoardUrl(candidate);
    if (boardUrl) {
      urls.add(boardUrl);
    }
  }

  const directPattern = /href="(https?:\/\/[^"]*ashbyhq\.com[^"]*)"/gi;
  for (const match of decodedHtml.matchAll(directPattern)) {
    const boardUrl = canonicalizeAshbyBoardUrl(match[1]);
    if (boardUrl) {
      urls.add(boardUrl);
    }
  }

  return [...urls];
}

export function parseAshbySearchHtml(html, searchUrl) {
  const jsonJobs = parseJobsFromNextData(html, searchUrl);
  const anchorJobs = parseJobsFromAnchors(html, searchUrl);

  const merged = new Map();
  for (const job of [...jsonJobs, ...anchorJobs]) {
    const key = String(job.externalId || job.url).toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, job);
      continue;
    }

    const existing = merged.get(key);
    merged.set(key, {
      ...existing,
      ...job,
      description: existing.description || job.description,
      summary: existing.summary || job.summary
    });
  }

  return [...merged.values()];
}

function fetchSearchHtml(searchUrl, timeoutMs = 30_000) {
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

export function writeAshbyCaptureFile(source, jobs, options = {}) {
  if (!source || source.type !== "ashby_search") {
    throw new Error("Ashby capture write requires an ashby_search source.");
  }

  if (!source.capturePath) {
    throw new Error(
      `Ashby source "${source.name}" is missing capturePath. Re-add the source or set capturePath in config/sources.json.`
    );
  }

  const capturePath = path.resolve(source.capturePath);
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });

  const payload = {
    sourceId: source.id,
    sourceName: source.name,
    searchUrl: source.searchUrl,
    capturedAt: options.capturedAt || new Date().toISOString(),
    jobs: Array.isArray(jobs) ? jobs : []
  };

  if (options.pageUrl) {
    payload.pageUrl = options.pageUrl;
  }

  const expectedCount = Number(options.expectedCount);
  if (Number.isFinite(expectedCount) && expectedCount > 0) {
    payload.expectedCount = Math.round(expectedCount);
  }

  fs.writeFileSync(capturePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    source,
    capturePath,
    jobsImported: payload.jobs.length,
    capturedAt: payload.capturedAt,
    pageUrl: payload.pageUrl || null,
    expectedCount: payload.expectedCount || null
  };
}

export function collectAshbyCaptureFile(source) {
  if (!source?.capturePath) {
    return [];
  }

  const capturePath = path.resolve(source.capturePath);
  if (!fs.existsSync(capturePath)) {
    return [];
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(capturePath, "utf8"));
  } catch {
    return [];
  }

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.jobs)) {
    return [];
  }

  const capturedAt =
    typeof payload.capturedAt === "string" && payload.capturedAt.trim()
      ? payload.capturedAt
      : new Date().toISOString();

  return payload.jobs.map((job) => ({
    ...job,
    retrievedAt: capturedAt,
    pageUrl: typeof payload.pageUrl === "string" ? payload.pageUrl : null
  }));
}

export function collectAshbyJobsFromSearch(source) {
  const capturedJobs = collectAshbyCaptureFile(source);
  if (source.capturePath) {
    if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
      return capturedJobs.slice(0, source.maxJobs);
    }

    return capturedJobs;
  }

  const timeoutMs = source.requestTimeoutMs || 30_000;
  let jobs = [];

  if (isGoogleSearchUrl(source.searchUrl)) {
    const queryText = parseGoogleSearchQuery(source.searchUrl);
    const discoveryHtml = fetchSearchHtml(source.searchUrl, timeoutMs);
    const boardUrls = extractAshbyBoardUrlsFromGoogleHtml(discoveryHtml).slice(0, 20);

    for (const boardUrl of boardUrls) {
      try {
        const boardHtml = fetchSearchHtml(boardUrl, timeoutMs);
        const boardJobs = parseAshbySearchHtml(boardHtml, boardUrl);
        jobs.push(...boardJobs);
      } catch {
        // ignore one failing board and continue
      }
    }

    if (queryText) {
      jobs = jobs.filter((job) => jobMatchesQuery(job, queryText));
    }
  } else {
    const html = fetchSearchHtml(source.searchUrl, timeoutMs);
    jobs = parseAshbySearchHtml(html, source.searchUrl);
  }

  const deduped = new Map();
  for (const job of jobs) {
    const key = String(job.externalId || job.url).toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, job);
    }
  }

  const retrievedAt = new Date().toISOString();
  const jobsEnriched = enrichJobsWithDetailPages(source.type, [...deduped.values()], {
    maxJobs: Number(source.maxJobs) > 0 ? Number(source.maxJobs) : 25,
    timeoutMs: Number(source.requestTimeoutMs) > 0 ? Number(source.requestTimeoutMs) : 30_000
  });
  const jobsWithMetadata = jobsEnriched.map((job) => ({
    ...job,
    retrievedAt
  }));

  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return jobsWithMetadata.slice(0, source.maxJobs);
  }

  return jobsWithMetadata;
}
