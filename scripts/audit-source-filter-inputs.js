export function normalizeAuditResult(raw) {
  return {
    sourceId: String(raw.sourceId || ""),
    sourceType: String(raw.sourceType || ""),
    searchUrl: String(raw.searchUrl || ""),
    pageTitle: String(raw.pageTitle || ""),
    finalUrl: String(raw.finalUrl || ""),
    status: String(raw.status || "ok"),
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : null,
    filters: Array.isArray(raw.filters) ? raw.filters : []
  };
}
