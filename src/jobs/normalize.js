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
    postedAt: normalizeText(rawJob.postedAt) || null,
    employmentType: normalizeText(rawJob.employmentType) || null,
    easyApply: Boolean(rawJob.easyApply),
    salaryText: normalizeText(rawJob.salaryText) || null,
    description,
    normalizedHash,
    createdAt: now,
    updatedAt: now
  };
}
