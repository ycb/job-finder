function normalizeId(value) {
  return String(value || "").trim();
}

function isHydratedSnapshot(snapshot) {
  return Boolean(String(snapshot?.title || "").trim() && String(snapshot?.company || "").trim());
}

export function buildLinkedInDiagnosticSummary({
  rowSnapshots = [],
  structuredJobIds = [],
  activationResults = [],
  resourceJobIds = []
} = {}) {
  const rowIds = rowSnapshots.map((row) => normalizeId(row?.rowId)).filter(Boolean);
  const structuredIds = structuredJobIds.map((id) => normalizeId(id)).filter(Boolean);
  const resourceIds = resourceJobIds.map((id) => normalizeId(id)).filter(Boolean);
  const hydratedRowIds = rowSnapshots
    .filter((row) => isHydratedSnapshot(row))
    .map((row) => normalizeId(row?.rowId))
    .filter(Boolean);
  const activationRecovered = activationResults
    .filter((result) => normalizeId(result?.rowId) && result?.selectedJobMatched === true)
    .map((result) => normalizeId(result.rowId));

  const rowSet = new Set(rowIds);
  const structuredSet = new Set(structuredIds);
  const resourceSet = new Set(resourceIds);
  const recoveredSet = new Set(activationRecovered);

  const missingFromStructured = rowIds.filter((id) => !structuredSet.has(id));
  const structuredOnly = structuredIds.filter((id) => !rowSet.has(id));
  const resourceOnly = resourceIds.filter((id) => !rowSet.has(id) && !structuredSet.has(id));
  const unresolved = rowIds.filter((id) => !structuredSet.has(id) && !recoveredSet.has(id));

  return {
    rowIdCount: rowIds.length,
    hydratedVisibleRowCount: hydratedRowIds.length,
    structuredCount: structuredIds.length,
    resourceJobCount: resourceIds.length,
    activationAttemptCount: activationResults.length,
    activationRecoveredCount: activationRecovered.length,
    hydratedVisibleRowIds: hydratedRowIds,
    missingFromStructured,
    structuredOnly,
    resourceOnly,
    recoveredByActivation: activationRecovered,
    unresolved
  };
}

export function extractLinkedInJobIdsFromResourceNames(resourceNames = []) {
  const ids = new Set();
  for (const rawName of resourceNames) {
    const name = String(rawName || "");
    for (const match of name.matchAll(/fsd_jobPostingCard%3A%28(\d+)%2CJOB_DETAILS%29/g)) {
      ids.add(match[1]);
    }
    for (const match of name.matchAll(/fsd_jobPosting:(\d+)/g)) {
      ids.add(match[1]);
    }
    for (const match of name.matchAll(/jobPostingUrn:urn%3Ali%3Afsd_jobPosting%3A(\d+)/g)) {
      ids.add(match[1]);
    }
  }
  return Array.from(ids);
}
