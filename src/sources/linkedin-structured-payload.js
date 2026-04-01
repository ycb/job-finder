function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#61;/g, "=")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractHiddenCodeBlocks(html) {
  const blocks = new Map();
  const pattern = /<code style="display: none" id="([^"]+)">([\s\S]*?)<\/code>/g;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    blocks.set(match[1], match[2].trim());
  }
  return blocks;
}

function parseJsonSafely(raw, { decodeEntities = false } = {}) {
  const input = decodeEntities ? decodeHtmlEntities(raw) : String(raw || "");
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function buildStructuredPayloadResponses(html) {
  const codeBlocks = extractHiddenCodeBlocks(html);
  const responses = [];

  for (const [id, raw] of codeBlocks.entries()) {
    if (!id.startsWith("datalet-bpr-guid-")) {
      continue;
    }
    const datalet = parseJsonSafely(raw);
    if (!datalet || typeof datalet !== "object" || !datalet.body) {
      continue;
    }
    const bodyRaw = codeBlocks.get(datalet.body);
    if (!bodyRaw) {
      continue;
    }
    const body = parseJsonSafely(bodyRaw, { decodeEntities: true });
    if (!body || typeof body !== "object") {
      continue;
    }
    responses.push({
      id,
      request: String(datalet.request || ""),
      bodyId: String(datalet.body),
      body
    });
  }

  return responses;
}

function collectByType(value, expectedType, results = []) {
  if (!value || typeof value !== "object") {
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectByType(item, expectedType, results);
    }
    return results;
  }

  if (value.$type === expectedType) {
    results.push(value);
  }

  for (const nested of Object.values(value)) {
    collectByType(nested, expectedType, results);
  }
  return results;
}

function extractLinkedInJobId(card) {
  const raw = String(
    card?.["*jobPosting"] ||
      card?.jobPostingUrn ||
      card?.jobPosting?.entityUrn ||
      card?.jobPosting?.trackingUrn ||
      card?.entityUrn ||
      ""
  );
  const match =
    raw.match(/urn:li:fsd_jobPosting:(\d+)/) ||
    raw.match(/urn:li:jobPosting:(\d+)/) ||
    raw.match(/urn:li:fsd_jobPostingCard:\((\d+),/);
  return match ? match[1] : null;
}

function textFromViewModel(viewModel) {
  return String(viewModel?.text || "").trim() || null;
}

function extractLocation(tertiaryDescription) {
  const text = textFromViewModel(tertiaryDescription);
  if (!text) {
    return null;
  }

  const firstSegment = text.split("·")[0]?.trim() || "";
  return firstSegment || null;
}

function extractPostedAt(tertiaryDescription) {
  const text = textFromViewModel(tertiaryDescription);
  if (!text) {
    return null;
  }

  const naturalMatch = text.match(/\b\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago\b/i);
  if (naturalMatch) {
    return naturalMatch[0];
  }

  const withEpoch = Array.isArray(tertiaryDescription?.attributesV2)
    ? tertiaryDescription.attributesV2.find((attribute) => attribute?.detailData?.epoch?.type === "TIME_AGO")
    : null;
  if (withEpoch && Number.isInteger(withEpoch.start) && Number.isInteger(withEpoch.length)) {
    const slice = text.slice(withEpoch.start, withEpoch.start + withEpoch.length).trim();
    if (slice) {
      return slice;
    }
  }
  return null;
}

function extractPostedAtFromFooterItems(footerItems) {
  const item = Array.isArray(footerItems)
    ? footerItems.find((entry) => entry?.type === "LISTED_DATE" && Number.isFinite(entry?.timeAt))
    : null;
  if (!item) {
    return null;
  }
  const deltaMs = Date.now() - Number(item.timeAt);
  const deltaHours = Math.max(0, Math.floor(deltaMs / (60 * 60 * 1000)));
  if (deltaHours < 24) {
    return `${Math.max(1, deltaHours)} hour${deltaHours === 1 ? "" : "s"} ago`;
  }
  const deltaDays = Math.max(1, Math.floor(deltaHours / 24));
  if (deltaDays < 30) {
    return `${deltaDays} day${deltaDays === 1 ? "" : "s"} ago`;
  }
  const deltaMonths = Math.max(1, Math.floor(deltaDays / 30));
  return `${deltaMonths} month${deltaMonths === 1 ? "" : "s"} ago`;
}

function normalizeStructuredJob(card, workplaceType) {
  const externalId = extractLinkedInJobId(card);
  if (!externalId) {
    return null;
  }

  const title = String(card?.jobPostingTitle || textFromViewModel(card?.title) || "").trim();
  const company = textFromViewModel(card?.primaryDescription);
  const location =
    extractLocation(card?.secondaryDescription) ||
    extractLocation(card?.tertiaryDescription);
  const postedAt =
    extractPostedAt(card?.tertiaryDescription) ||
    extractPostedAtFromFooterItems(card?.footerItems);
  const workplaceTypeEnum = String(workplaceType?.workplaceTypeEnum || "").trim() || null;
  const url = `https://www.linkedin.com/jobs/view/${externalId}/`;
  const summary = [title, company, location].filter(Boolean).join(" · ");

  return {
    externalId,
    title,
    company,
    location,
    postedAt,
    workplaceType: workplaceTypeEnum,
    url,
    summary
  };
}

function extractStructuredJobsFromResponseBodyObject(body) {
  if (!body || typeof body !== "object") {
    return [];
  }

  const jobs = [];
  const seen = new Set();
  const cards = collectByType(
    body,
    "com.linkedin.voyager.dash.jobs.JobPostingCard"
  );
  const normalizedCards = [];
  collectObjectsWithJobPostingShape(body, normalizedCards);
  const workplaceTypes = collectByType(
    body,
    "com.linkedin.voyager.dash.jobs.WorkplaceType"
  );
  const defaultWorkplaceType = workplaceTypes.length === 1 ? workplaceTypes[0] : null;

  for (const card of [...cards, ...normalizedCards]) {
    const externalId = extractLinkedInJobId(card);
    if (!externalId || seen.has(externalId)) {
      continue;
    }
    const normalized = normalizeStructuredJob(card, defaultWorkplaceType);
    if (!normalized || !normalized.title || !normalized.company) {
      continue;
    }
    seen.add(externalId);
    jobs.push(normalized);
  }

  return jobs;
}

function collectObjectsWithJobPostingShape(value, results = []) {
  if (!value || typeof value !== "object") {
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectsWithJobPostingShape(item, results);
    }
    return results;
  }

  const hasJobPostingShape =
    typeof value.jobPostingTitle === "string" &&
    value.primaryDescription &&
    (value.jobPostingUrn || value.jobPosting?.entityUrn || value.entityUrn);

  if (hasJobPostingShape) {
    results.push(value);
  }

  for (const nested of Object.values(value)) {
    collectObjectsWithJobPostingShape(nested, results);
  }
  return results;
}

export function listLinkedInStructuredPayloadRequests(html) {
  return buildStructuredPayloadResponses(html).map((response) => response.request);
}

export function extractLinkedInStructuredJobsFromResponseBody(rawBody) {
  const body =
    typeof rawBody === "string"
      ? parseJsonSafely(rawBody, { decodeEntities: true })
      : rawBody;
  return extractStructuredJobsFromResponseBodyObject(body);
}

export function extractLinkedInStructuredPageFromResponseBody(rawBody) {
  const body =
    typeof rawBody === "string"
      ? parseJsonSafely(rawBody, { decodeEntities: true })
      : rawBody;
  const jobs = extractStructuredJobsFromResponseBodyObject(body);
  const paging =
    body && typeof body === "object" && !Array.isArray(body) && body.paging
      ? body.paging
      : null;

  const start = Number(paging?.start);
  const count = Number(paging?.count);
  const total = Number(paging?.total);

  return {
    jobs,
    paging: {
      start: Number.isFinite(start) && start >= 0 ? Math.round(start) : null,
      count: Number.isFinite(count) && count > 0 ? Math.round(count) : null,
      total: Number.isFinite(total) && total > 0 ? Math.round(total) : null
    }
  };
}

export function extractLinkedInStructuredJobsFromHtml(html) {
  const responses = buildStructuredPayloadResponses(html);
  const jobs = [];
  const seen = new Set();

  for (const response of responses) {
    if (!response.request.includes("voyagerJobsDash")) {
      continue;
    }

    for (const job of extractStructuredJobsFromResponseBodyObject(response.body)) {
      if (seen.has(job.externalId)) {
        continue;
      }
      seen.add(job.externalId);
      jobs.push(job);
    }
  }

  return jobs;
}
