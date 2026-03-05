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
  const normalizedHash = hashValue(
    `${company.toLowerCase()}|${title.toLowerCase()}|${location.toLowerCase()}`
  );

  return {
    id: hashValue(`${source.id}|${sourceUrl}`),
    source: source.type,
    sourceId: source.id,
    sourceUrl,
    externalId: normalizeText(rawJob.externalId) || null,
    title,
    company,
    location: location || null,
    postedAt: parsePostedAt(rawJob.postedAt),
    employmentType: normalizeText(rawJob.employmentType) || null,
    easyApply: Boolean(rawJob.easyApply),
    salaryText: normalizeText(rawJob.salaryText) || null,
    description,
    normalizedHash,
    createdAt: now,
    updatedAt: retrievedAt
  };
}
