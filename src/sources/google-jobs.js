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

function toAbsoluteUrl(inputUrl, baseUrl) {
  const normalized = String(inputUrl || "").trim();
  if (!normalized) {
    return "";
  }

  try {
    const base = new URL(String(baseUrl || "").trim() || "https://www.google.com");
    return new URL(normalized, base.toString()).toString();
  } catch {
    return normalized;
  }
}

function decodeGoogleRedirect(urlText) {
  const resolved = toAbsoluteUrl(urlText, "https://www.google.com");
  if (!resolved) {
    return "";
  }

  try {
    const parsed = new URL(resolved);
    if (!/(^|\.)google\./i.test(parsed.hostname)) {
      return resolved;
    }

    const redirected = parsed.searchParams.get("q") || parsed.searchParams.get("url");
    if (!redirected) {
      return resolved;
    }

    return toAbsoluteUrl(decodeURIComponent(redirected), "https://www.google.com");
  } catch {
    return resolved;
  }
}

function isGoogleUrl(urlText) {
  try {
    const parsed = new URL(String(urlText || "").trim());
    return /(^|\.)google\./i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isLikelyJobUrl(urlText) {
  const normalized = String(urlText || "").toLowerCase();
  return (
    /\/jobs?\//.test(normalized) ||
    /jobid=|gh_jid=|jk=|lever\.co|greenhouse\.io|ashbyhq\.com/.test(normalized)
  );
}

function guessCompanyFromUrl(urlText) {
  try {
    const parsed = new URL(String(urlText || "").trim());
    const hostParts = parsed.hostname
      .replace(/^www\./i, "")
      .split(".")
      .filter(Boolean);
    if (hostParts.length === 0) {
      return "";
    }

    const root = hostParts.length > 1 ? hostParts[hostParts.length - 2] : hostParts[0];
    return normalizeText(root.replace(/[-_]+/g, " "));
  } catch {
    return "";
  }
}

function extractPostedAt(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const relative = normalized.match(
    /(\d+\s+(?:hour|day|week|month|year)s?\s+ago|today|yesterday)/i
  );
  return relative ? relative[1] : null;
}

export function parseGoogleSearchHtml(html, searchUrl) {
  const jobs = [];
  const seen = new Set();
  const anchorPattern = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeGoogleRedirect(match[1]);
    if (!href || isGoogleUrl(href)) {
      continue;
    }

    if (!isLikelyJobUrl(href)) {
      continue;
    }

    const title = normalizeText(match[2]);
    if (!title || title.length < 4 || title.length > 180) {
      continue;
    }

    const dedupeKey = `${title.toLowerCase()}|${href.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const start = Math.max(0, (match.index || 0) - 600);
    const end = Math.min(html.length, (match.index || 0) + match[0].length + 600);
    const block = html.slice(start, end);
    const blockText = normalizeText(block);

    const company = guessCompanyFromUrl(href);
    const locationMatch = blockText.match(
      /\b(san francisco|new york|remote|seattle|austin|los angeles|california)\b/i
    );
    const location = locationMatch ? locationMatch[1] : null;
    const postedAt = extractPostedAt(blockText);

    jobs.push({
      externalId: null,
      title,
      company: company || "Unknown company",
      location,
      postedAt,
      employmentType: null,
      easyApply: false,
      salaryText: null,
      summary: blockText.slice(0, 320) || `${title} via Google`,
      description: blockText || `${title} via Google`,
      url: href
    });
  }

  return jobs;
}

function assertGoogleSource(source) {
  if (!source || source.type !== "google_search") {
    throw new Error("Google capture write requires a google_search source.");
  }
}

export function writeGoogleCaptureFile(source, jobs, options = {}) {
  assertGoogleSource(source);

  const capturePath = writeSourceCapturePayload(source, jobs, options);
  return {
    source,
    capturePath,
    jobsImported: Array.isArray(jobs) ? jobs.length : 0,
    capturedAt: options.capturedAt || new Date().toISOString(),
    pageUrl: options.pageUrl || null
  };
}

function fetchGoogleSearchHtml(searchUrl, timeoutMs = 30_000) {
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

export function collectGoogleJobsFromSearch(source) {
  const cachedJobs = getFreshCachedJobs(source);
  if (Array.isArray(cachedJobs)) {
    if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
      return cachedJobs.slice(0, source.maxJobs);
    }
    return cachedJobs;
  }

  const html = fetchGoogleSearchHtml(source.searchUrl, source.requestTimeoutMs || 30_000);
  const jobs = parseGoogleSearchHtml(html, source.searchUrl);
  const retrievedAt = new Date().toISOString();
  const jobsWithMetadata = jobs.map((job) => ({
    ...job,
    retrievedAt
  }));

  writeSourceCapturePayload(source, jobs, {
    capturedAt: retrievedAt,
    pageUrl: source.searchUrl
  });

  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return jobsWithMetadata.slice(0, source.maxJobs);
  }

  return jobsWithMetadata;
}
