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

function fetchAshbySearchHtml(searchUrl, timeoutMs = 30_000) {
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

export function collectAshbyJobsFromSearch(source) {
  const html = fetchAshbySearchHtml(source.searchUrl, source.requestTimeoutMs || 30_000);
  const jobs = parseAshbySearchHtml(html, source.searchUrl);
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
