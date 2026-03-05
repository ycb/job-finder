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
    .replace(/&#x2B;/g, "+")
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
    const base = new URL(String(baseUrl || "").trim());
    const fallbackBase = "https://www.builtinsf.com";
    const effectiveBase =
      base.protocol === "http:" || base.protocol === "https:" ? base.toString() : fallbackBase;

    return new URL(normalized, effectiveBase).toString();
  } catch {
    if (normalized.startsWith("/")) {
      return `https://www.builtinsf.com${normalized}`;
    }

    return normalized;
  }
}

function extractFirst(block, pattern) {
  const match = block.match(pattern);
  return match ? normalizeText(match[1]) : "";
}

function extractAll(block, pattern) {
  const values = [];
  for (const match of block.matchAll(pattern)) {
    const normalized = normalizeText(match[1]);
    if (normalized) {
      values.push(normalized);
    }
  }
  return values;
}

function extractAttribute(tag, attribute) {
  const match = String(tag || "").match(
    new RegExp(`${String(attribute || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}="([^"]+)"`)
  );

  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractAnchorByDataId(block, dataId) {
  const anchorMatch = String(block || "").match(
    new RegExp(
      `<a[^>]*data-id="${String(dataId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([\\s\\S]*?)<\\/a>`
    )
  );

  if (!anchorMatch) {
    return null;
  }

  const openingTagMatch = anchorMatch[0].match(/^<a[^>]*>/);
  const openingTag = openingTagMatch ? openingTagMatch[0] : "";

  return {
    text: normalizeText(anchorMatch[1]),
    href: extractAttribute(openingTag, "href")
  };
}

function parsePublishedDates(html) {
  const byId = new Map();
  const pattern = /'id':\s*(\d+)\s*,\s*'published_date':'([^']+)'/g;

  for (const match of html.matchAll(pattern)) {
    const [, jobId, publishedDate] = match;
    byId.set(jobId, normalizeText(publishedDate));
  }

  return byId;
}

function extractJobCardBlocks(html) {
  const blocks = [];
  const pattern =
    /<div id="job-card-(\d+)"[\s\S]*?(?=<div id="job-card-\d+"|<style onload=|<\/main>)/g;

  for (const match of html.matchAll(pattern)) {
    blocks.push({
      externalId: match[1],
      block: match[0]
    });
  }

  return blocks;
}

export function parseBuiltInSearchHtml(html, searchUrl) {
  const publishedById = parsePublishedDates(html);
  const cards = extractJobCardBlocks(html);
  const jobs = [];

  for (const card of cards) {
    const titleLink = extractAnchorByDataId(card.block, "job-card-title");
    const companyLink = extractAnchorByDataId(card.block, "company-title");
    const title = titleLink ? titleLink.text : "";
    const url = titleLink ? toAbsoluteUrl(titleLink.href, searchUrl) : "";
    const company = companyLink ? companyLink.text : "";

    if (!title || !company || !url) {
      continue;
    }

    const location = extractFirst(
      card.block,
      /fa-regular fa-location-dot[\s\S]*?<span[^>]*class="font-barlow text-gray-04">([\s\S]*?)<\/span>/
    );
    const workModel = extractFirst(
      card.block,
      /fa-regular fa-house-building[\s\S]*?<span[^>]*class="font-barlow text-gray-04">([\s\S]*?)<\/span>/
    );
    const salaryText = extractFirst(
      card.block,
      /fa-regular fa-sack-dollar[\s\S]*?<span[^>]*class="font-barlow text-gray-04">([\s\S]*?)<\/span>/
    );
    const seniority = extractFirst(
      card.block,
      /fa-regular fa-trophy[\s\S]*?<span[^>]*class="font-barlow text-gray-04">([\s\S]*?)<\/span>/
    );
    const relativePosted = extractFirst(
      card.block,
      /fa-regular fa-clock[\s\S]*?<\/i>([\s\S]*?)<\/span>/
    );
    const summary = extractFirst(
      card.block,
      /<div class="fs-sm fw-regular mb-md text-gray-04">([\s\S]*?)<\/div>/
    );
    const topSkills = extractAll(
      card.block,
      /<span class="fs-xs text-gray-04 mx-sm">([\s\S]*?)<\/span>/g
    );
    const postedAt = publishedById.get(card.externalId) || relativePosted || null;
    const employmentType = [workModel, seniority].filter(Boolean).join(" · ") || null;

    const descriptionParts = [];
    if (summary) {
      descriptionParts.push(summary);
    }
    if (topSkills.length > 0) {
      descriptionParts.push(`Top Skills: ${topSkills.join(", ")}`);
    }

    jobs.push({
      externalId: card.externalId,
      title,
      company,
      location: location || null,
      postedAt,
      employmentType,
      easyApply: false,
      salaryText: salaryText || null,
      summary: summary || `${title} at ${company}`,
      description: descriptionParts.join("\n\n") || `${title} at ${company}`,
      url
    });
  }

  return jobs;
}

function fetchBuiltInSearchHtml(searchUrl, timeoutMs = 30_000) {
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

export function collectBuiltInJobsFromSearch(source) {
  const html = fetchBuiltInSearchHtml(source.searchUrl, source.requestTimeoutMs || 30_000);
  const jobs = parseBuiltInSearchHtml(html, source.searchUrl);
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
