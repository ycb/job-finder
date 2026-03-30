function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.round(numeric);
}

function normalizeBooleanFlag(value) {
  return value ? 1 : 0;
}

function stableJson(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }

  return JSON.stringify(value);
}

function normalizeMissingRequiredFields(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return stableJson(value.map((field) => normalizeText(field)).filter(Boolean));
  }

  return stableJson(value);
}

function buildExistingIdentity(row) {
  const sourceId = normalizeText(row?.source_id);
  const sourceUrl = normalizeText(row?.source_url);
  return sourceId && sourceUrl ? `${sourceId}::${sourceUrl}` : null;
}

function buildIncomingIdentity(job) {
  const sourceId = normalizeText(job?.sourceId);
  const sourceUrl = normalizeText(job?.sourceUrl);
  return sourceId && sourceUrl ? `${sourceId}::${sourceUrl}` : null;
}

function buildExistingSignature(row) {
  return {
    sourceId: normalizeText(row?.source_id),
    sourceUrl: normalizeText(row?.source_url),
    externalId: normalizeText(row?.external_id),
    title: normalizeText(row?.title),
    company: normalizeText(row?.company),
    location: normalizeText(row?.location),
    postedAt: normalizeText(row?.posted_at),
    employmentType: normalizeText(row?.employment_type),
    easyApply: normalizeBooleanFlag(Number(row?.easy_apply) === 1),
    salaryText: normalizeText(row?.salary_text),
    description: normalizeText(row?.description),
    normalizedHash: normalizeText(row?.normalized_hash),
    structuredMeta: stableJson(row?.structured_meta),
    metadataQualityScore: normalizeInteger(row?.metadata_quality_score),
    missingRequiredFields: normalizeMissingRequiredFields(row?.missing_required_fields)
  };
}

function buildIncomingSignature(job) {
  return {
    sourceId: normalizeText(job?.sourceId),
    sourceUrl: normalizeText(job?.sourceUrl),
    externalId: normalizeText(job?.externalId),
    title: normalizeText(job?.title),
    company: normalizeText(job?.company),
    location: normalizeText(job?.location),
    postedAt: normalizeText(job?.postedAt),
    employmentType: normalizeText(job?.employmentType),
    easyApply: normalizeBooleanFlag(Boolean(job?.easyApply)),
    salaryText: normalizeText(job?.salaryText),
    description: normalizeText(job?.description),
    normalizedHash: normalizeText(job?.normalizedHash),
    structuredMeta: stableJson(job?.structuredMeta),
    metadataQualityScore: normalizeInteger(job?.metadataQualityScore),
    missingRequiredFields: normalizeMissingRequiredFields(job?.missingRequiredFields)
  };
}

function signaturesMatch(existingSignature, incomingSignature) {
  const keys = Object.keys(existingSignature);
  for (const key of keys) {
    if (existingSignature[key] !== incomingSignature[key]) {
      return false;
    }
  }
  return true;
}

export function classifyRunDeltas({ existingRows = [], incomingJobs = [] } = {}) {
  const existingById = new Map();
  const existingByIdentity = new Map();

  for (const row of Array.isArray(existingRows) ? existingRows : []) {
    const rowId = normalizeText(row?.id);
    if (rowId) {
      existingById.set(rowId, row);
    }

    const identity = buildExistingIdentity(row);
    if (identity) {
      existingByIdentity.set(identity, row);
    }
  }

  const seenIncoming = new Set();
  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const job of Array.isArray(incomingJobs) ? incomingJobs : []) {
    const incomingId = normalizeText(job?.id);
    const incomingIdentity = buildIncomingIdentity(job);
    const dedupeKey = incomingId ? `id:${incomingId}` : `identity:${incomingIdentity}`;

    if (!dedupeKey || seenIncoming.has(dedupeKey)) {
      continue;
    }
    seenIncoming.add(dedupeKey);

    const existingRow =
      (incomingId ? existingById.get(incomingId) : null) ||
      (incomingIdentity ? existingByIdentity.get(incomingIdentity) : null);

    if (!existingRow) {
      newCount += 1;
      continue;
    }

    const existingSignature = buildExistingSignature(existingRow);
    const incomingSignature = buildIncomingSignature(job);
    if (signaturesMatch(existingSignature, incomingSignature)) {
      unchangedCount += 1;
    } else {
      updatedCount += 1;
    }
  }

  return {
    newCount,
    updatedCount,
    unchangedCount
  };
}

export function buildSourceRunSemanticMetrics({
  normalizedJobs = [],
  evaluations = [],
  knownNormalizedHashes = new Set()
} = {}) {
  const jobs = Array.isArray(normalizedJobs) ? normalizedJobs : [];
  const evaluationMap = new Map(
    (Array.isArray(evaluations) ? evaluations : [])
      .filter((evaluation) => evaluation?.jobId)
      .map((evaluation) => [String(evaluation.jobId), evaluation])
  );

  const seenIncomingHashes = new Set();
  const keptNormalizedHashes = new Set();
  let rawFoundCount = 0;
  let hardFilteredCount = 0;
  let duplicateCollapsedCount = 0;
  let importedKeptCount = 0;

  for (const job of jobs) {
    const normalizedHash = normalizeText(job?.normalizedHash);
    const evaluation = evaluationMap.get(String(job?.id || ""));
    rawFoundCount += 1;

    if (evaluation?.hardFiltered) {
      hardFilteredCount += 1;
      continue;
    }

    if (
      normalizedHash &&
      (seenIncomingHashes.has(normalizedHash) || knownNormalizedHashes.has(normalizedHash))
    ) {
      duplicateCollapsedCount += 1;
      continue;
    }

    importedKeptCount += 1;

    if (normalizedHash) {
      seenIncomingHashes.add(normalizedHash);
      keptNormalizedHashes.add(normalizedHash);
    }
  }

  return {
    rawFoundCount,
    hardFilteredCount,
    duplicateCollapsedCount,
    importedKeptCount,
    keptNormalizedHashes
  };
}
