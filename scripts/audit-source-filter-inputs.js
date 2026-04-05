function normalizeFilterEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    inputType: String(entry.inputType || "unknown"),
    label: String(entry.label || ""),
    placeholder: entry.placeholder ? String(entry.placeholder) : "",
    ariaAutocomplete: entry.ariaAutocomplete ? String(entry.ariaAutocomplete) : "",
    role: entry.role ? String(entry.role) : "",
    selector: entry.selector ? String(entry.selector) : ""
  };
}

export function normalizeAuditResult(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const filters = Array.isArray(safe.filters)
    ? safe.filters
        .map((entry) => normalizeFilterEntry(entry))
        .filter(Boolean)
    : [];
  return {
    sourceId: String(safe.sourceId || ""),
    sourceType: String(safe.sourceType || ""),
    searchUrl: String(safe.searchUrl || ""),
    pageTitle: String(safe.pageTitle || ""),
    finalUrl: String(safe.finalUrl || ""),
    status: String(safe.status || "ok"),
    errorMessage: safe.errorMessage ? String(safe.errorMessage) : null,
    filters
  };
}
