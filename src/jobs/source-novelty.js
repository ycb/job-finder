function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCount(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.round(numeric));
}

function roundRatio(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function buildHashSetBySourceId(importedJobs = []) {
  const hashesBySourceId = new Map();

  for (const job of Array.isArray(importedJobs) ? importedJobs : []) {
    const normalizedHash = normalizeString(job?.normalizedHash);
    if (!normalizedHash) {
      continue;
    }

    const sourceIds = Array.isArray(job?.sourceIds)
      ? job.sourceIds.map((value) => normalizeString(value)).filter(Boolean)
      : [normalizeString(job?.sourceId)].filter(Boolean);

    for (const sourceId of sourceIds) {
      const current = hashesBySourceId.get(sourceId) || new Set();
      current.add(normalizedHash);
      hashesBySourceId.set(sourceId, current);
    }
  }

  return hashesBySourceId;
}

function intersectionCount(leftSet, rightSet) {
  if (!(leftSet instanceof Set) || !(rightSet instanceof Set) || leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let count = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      count += 1;
    }
  }
  return count;
}

function unionHashesForSourceIds(hashesBySourceId, sourceIds = []) {
  const union = new Set();
  for (const sourceId of sourceIds) {
    const hashes = hashesBySourceId.get(sourceId);
    if (!(hashes instanceof Set)) {
      continue;
    }
    for (const hash of hashes) {
      union.add(hash);
    }
  }
  return union;
}

export function defaultNoveltyBaselineSourceIds(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => {
      const type = normalizeString(source?.type);
      return type === "linkedin_capture_file" || type === "indeed_search";
    })
    .map((source) => normalizeString(source?.id))
    .filter(Boolean);
}

export function computeSourceNoveltyBySourceId({
  sources = [],
  importedJobs = [],
  baselineSourceIds = null,
} = {}) {
  const sourceList = Array.isArray(sources) ? sources.filter(Boolean) : [];
  const defaultBaselineIds = defaultNoveltyBaselineSourceIds(sourceList);
  const normalizedBaselineIds = Array.isArray(baselineSourceIds) && baselineSourceIds.length > 0
    ? baselineSourceIds.map((value) => normalizeString(value)).filter(Boolean)
    : defaultBaselineIds;
  const hashesBySourceId = buildHashSetBySourceId(importedJobs);
  const sourceById = new Map(sourceList.map((source) => [normalizeString(source.id), source]));
  const noveltyBySourceId = Object.create(null);

  const linkedInSourceIds = sourceList
    .filter((source) => normalizeString(source?.type) === "linkedin_capture_file")
    .map((source) => normalizeString(source.id))
    .filter(Boolean);
  const indeedSourceIds = sourceList
    .filter((source) => normalizeString(source?.type) === "indeed_search")
    .map((source) => normalizeString(source.id))
    .filter(Boolean);

  for (const source of sourceList) {
    const sourceId = normalizeString(source.id);
    if (!sourceId) {
      continue;
    }

    const importedHashes = hashesBySourceId.get(sourceId) || new Set();
    const importedAfterFilters = normalizeCount(source.importedCount, importedHashes.size);
    const effectiveImportedCount = importedAfterFilters > 0 ? importedAfterFilters : importedHashes.size;
    const baselineComparisonSourceIds = normalizedBaselineIds.filter((candidateId) => candidateId !== sourceId);
    const baselineHashes = unionHashesForSourceIds(hashesBySourceId, baselineComparisonSourceIds);
    const duplicateWithBaselineCount = intersectionCount(importedHashes, baselineHashes);
    const uniqueImportedVsBaseline = Math.max(0, importedHashes.size - duplicateWithBaselineCount);

    const linkedInComparisonIds = linkedInSourceIds.filter((candidateId) => candidateId !== sourceId);
    const linkedInHashes = unionHashesForSourceIds(hashesBySourceId, linkedInComparisonIds);
    const duplicateWithLinkedInCount = intersectionCount(importedHashes, linkedInHashes);

    const indeedComparisonIds = indeedSourceIds.filter((candidateId) => candidateId !== sourceId);
    const indeedHashes = unionHashesForSourceIds(hashesBySourceId, indeedComparisonIds);
    const duplicateWithIndeedCount = intersectionCount(importedHashes, indeedHashes);

    noveltyBySourceId[sourceId] = {
      baselineSourceIds: [...normalizedBaselineIds],
      rawFound: normalizeCount(source.captureJobCount, 0),
      importedAfterFilters,
      dedupedOut: normalizeCount(source.droppedByDedupeCount, 0),
      uniqueImportedVsBaseline,
      noveltyRate:
        effectiveImportedCount > 0
          ? roundRatio(uniqueImportedVsBaseline / effectiveImportedCount)
          : null,
      overlap: {
        linkedin: {
          sourceIds: [...linkedInComparisonIds],
          duplicateCount: duplicateWithLinkedInCount,
          duplicateRate:
            effectiveImportedCount > 0 && linkedInComparisonIds.length > 0
              ? roundRatio(duplicateWithLinkedInCount / effectiveImportedCount)
              : null,
        },
        indeed: {
          sourceIds: [...indeedComparisonIds],
          duplicateCount: duplicateWithIndeedCount,
          duplicateRate:
            effectiveImportedCount > 0 && indeedComparisonIds.length > 0
              ? roundRatio(duplicateWithIndeedCount / effectiveImportedCount)
              : null,
        },
      },
      sourceType: normalizeString(sourceById.get(sourceId)?.type) || null,
    };
  }

  return noveltyBySourceId;
}
