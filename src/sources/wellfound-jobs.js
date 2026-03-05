import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
    const base = new URL(String(baseUrl || "").trim() || "https://wellfound.com");
    return new URL(normalized, base.toString()).toString();
  } catch {
    if (normalized.startsWith("/")) {
      return `https://wellfound.com${normalized}`;
    }
    return normalized;
  }
}

function extractWellfoundExternalId(url) {
  const match = String(url || "").match(/\/jobs\/(\d+)/i);
  return match?.[1] || null;
}

function parseSalary(baseSalary) {
  if (!baseSalary) {
    return null;
  }

  if (typeof baseSalary === "string") {
    return normalizeText(baseSalary) || null;
  }

  if (typeof baseSalary === "number") {
    return `$${Math.round(baseSalary).toLocaleString()}`;
  }

  if (typeof baseSalary === "object") {
    const value = baseSalary.value || baseSalary;
    if (typeof value === "number") {
      return `$${Math.round(value).toLocaleString()}`;
    }

    if (value && typeof value === "object") {
      const minValue = Number(value.minValue);
      const maxValue = Number(value.maxValue);
      const unit = normalizeText(value.unitText || "");
      if (Number.isFinite(minValue) && Number.isFinite(maxValue)) {
        return `$${Math.round(minValue).toLocaleString()} - $${Math.round(maxValue).toLocaleString()}${unit ? ` ${unit}` : ""}`;
      }
      if (Number.isFinite(minValue)) {
        return `$${Math.round(minValue).toLocaleString()}${unit ? ` ${unit}` : ""}`;
      }
    }
  }

  return null;
}

function stringifyDescription(value) {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (Array.isArray(value)) {
    return normalizeText(value.map((item) => stringifyDescription(item)).join(" "));
  }
  if (value && typeof value === "object") {
    return normalizeText(
      Object.values(value)
        .map((item) => stringifyDescription(item))
        .join(" ")
    );
  }
  return "";
}

function toJobFromJsonLd(candidate, searchUrl) {
  const title = normalizeText(candidate?.title || candidate?.name);
  const company = normalizeText(
    candidate?.hiringOrganization?.name ||
      candidate?.organization?.name ||
      candidate?.company?.name ||
      candidate?.companyName
  );
  const url = toAbsoluteUrl(candidate?.url || candidate?.sameAs, searchUrl);

  if (!title || !company || !url) {
    return null;
  }

  const jobLocation = Array.isArray(candidate?.jobLocation)
    ? candidate.jobLocation[0]
    : candidate?.jobLocation;
  const location = normalizeText(
    jobLocation?.address?.addressLocality ||
      jobLocation?.address?.addressRegion ||
      jobLocation?.name ||
      candidate?.jobLocationType ||
      candidate?.applicantLocationRequirements?.name
  );
  const employmentType = Array.isArray(candidate?.employmentType)
    ? candidate.employmentType.map((item) => normalizeText(item)).filter(Boolean).join(" · ")
    : normalizeText(candidate?.employmentType);
  const salaryText = parseSalary(candidate?.baseSalary);
  const description =
    stringifyDescription(candidate?.description) || `${title} at ${company}`;
  const postedAt =
    normalizeText(candidate?.datePosted || candidate?.datePublished) || null;

  return {
    externalId:
      normalizeText(candidate?.identifier?.value || candidate?.identifier) ||
      extractWellfoundExternalId(url),
    title,
    company,
    location: location || null,
    postedAt,
    employmentType: employmentType || null,
    easyApply: false,
    salaryText: salaryText || null,
    summary: description.slice(0, 320),
    description,
    url
  };
}

function collectJobsFromJsonLd(html, searchUrl) {
  const jobs = [];
  const scriptPattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptPattern)) {
    const payloadText = decodeHtmlEntities(String(match[1] || "").trim());
    if (!payloadText) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      continue;
    }

    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || typeof next !== "object") {
        continue;
      }

      if (Array.isArray(next)) {
        queue.push(...next);
        continue;
      }

      const typeField = next["@type"];
      const isJobPosting = Array.isArray(typeField)
        ? typeField.some((item) => normalizeText(item).toLowerCase() === "jobposting")
        : normalizeText(typeField).toLowerCase() === "jobposting";
      if (isJobPosting) {
        const job = toJobFromJsonLd(next, searchUrl);
        if (job) {
          jobs.push(job);
        }
      }

      for (const value of Object.values(next)) {
        if (value && typeof value === "object") {
          queue.push(value);
        }
      }
    }
  }

  return jobs;
}

function extractFirst(block, patterns) {
  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (match?.[1]) {
      const normalized = normalizeText(match[1]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return "";
}

function collectJobsFromAnchors(html, searchUrl) {
  const jobs = [];
  const seen = new Set();
  const anchorPattern = /<a[^>]*href="([^"]*\/jobs\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const href = toAbsoluteUrl(match[1], searchUrl);
    const title = normalizeText(match[2]);
    if (!href || !title || title.length < 4) {
      continue;
    }

    if (seen.has(href)) {
      continue;
    }
    seen.add(href);

    const startIndex = Math.max(0, (match.index || 0) - 800);
    const endIndex = Math.min(html.length, (match.index || 0) + match[0].length + 800);
    const block = html.slice(startIndex, endIndex);

    const company = extractFirst(block, [
      /data-test(?:id)?="(?:startup|company)[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|div)>/i,
      /class="[^"]*(?:startup|company)[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|div)>/i
    ]);
    if (!company) {
      continue;
    }

    const location = extractFirst(block, [
      /data-test(?:id)?="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|div)>/i,
      /class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|div)>/i
    ]);
    const postedAt = extractFirst(block, [
      /(\d+\s+(?:hour|day|week|month|year)s?\s+ago)/i,
      /\b(today|yesterday)\b/i
    ]);

    jobs.push({
      externalId: extractWellfoundExternalId(href),
      title,
      company,
      location: location || null,
      postedAt: postedAt || null,
      employmentType: null,
      easyApply: false,
      salaryText: null,
      summary: `${title} at ${company}`,
      description: `${title} at ${company}`,
      url: href
    });
  }

  return jobs;
}

export function parseWellfoundSearchHtml(html, searchUrl) {
  const jsonLdJobs = collectJobsFromJsonLd(html, searchUrl);
  const anchorJobs = collectJobsFromAnchors(html, searchUrl);

  const merged = new Map();
  for (const job of [...jsonLdJobs, ...anchorJobs]) {
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

function fetchWellfoundSearchHtml(searchUrl, timeoutMs = 30_000) {
  const timeoutSeconds = Math.max(5, Math.ceil(timeoutMs / 1000));
  return execFileSync(
    "curl",
    ["-sS", "-L", "--max-time", String(timeoutSeconds), String(searchUrl)],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    }
  );
}

export function writeWellfoundCaptureFile(source, jobs, options = {}) {
  if (!source || source.type !== "wellfound_search") {
    throw new Error("Wellfound capture write requires a wellfound_search source.");
  }

  if (!source.capturePath) {
    throw new Error(
      `Wellfound source "${source.name}" is missing capturePath. Re-add the source or set capturePath in config/sources.json.`
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

  fs.writeFileSync(capturePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    source,
    capturePath,
    jobsImported: payload.jobs.length,
    capturedAt: payload.capturedAt,
    pageUrl: payload.pageUrl || null
  };
}

export function collectWellfoundCaptureFile(source) {
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

export function collectWellfoundJobsFromSearch(source) {
  const capturedJobs = collectWellfoundCaptureFile(source);
  if (capturedJobs.length > 0) {
    if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
      return capturedJobs.slice(0, source.maxJobs);
    }
    return capturedJobs;
  }

  const html = fetchWellfoundSearchHtml(source.searchUrl, source.requestTimeoutMs || 30_000);
  const jobs = parseWellfoundSearchHtml(html, source.searchUrl);
  const retrievedAt = new Date().toISOString();
  const jobsWithMetadata = jobs.map((job) => ({
    ...job,
    retrievedAt
  }));

  if (Number.isInteger(source.maxJobs) && source.maxJobs > 0) {
    return jobsWithMetadata.slice(0, source.maxJobs);
  }

  return jobsWithMetadata;
}
