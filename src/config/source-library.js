const SOURCE_LIBRARY = Object.freeze([
  {
    id: "linkedin-live-capture",
    name: "LinkedIn",
    type: "linkedin_capture_file",
    legacySourceIds: ["linkedin-main", "growth-pm", "founding-pm", "ai-pm", "pm-remote-linkedin"],
    enabled: false,
    searchUrl: "https://www.linkedin.com/jobs/search/",
    capturePath: "data/captures/linkedin-live-capture.json",
    cacheTtlHours: 24
  },
  {
    id: "builtin-sf-ai-pm",
    name: "Built In",
    type: "builtin_search",
    legacySourceIds: ["builtin-main"],
    enabled: true,
    searchUrl: "https://www.builtinsf.com/jobs/product-management/product-manager",
    maxJobs: 50,
    cacheTtlHours: 12
  },
  {
    id: "indeed-ai-pm",
    name: "Indeed",
    type: "indeed_search",
    legacySourceIds: ["indeed-main", "indeed-ai-pm-sf"],
    enabled: false,
    searchUrl: "https://www.indeed.com/jobs?l=San+Francisco%2C+CA",
    cacheTtlHours: 24
  },
  {
    id: "zip-ai-pm",
    name: "ZipRecruiter",
    type: "ziprecruiter_search",
    legacySourceIds: ["ziprecruiter-main", "ziprecruiter-ai-pm-sf"],
    enabled: false,
    searchUrl:
      "https://www.ziprecruiter.com/jobs-search?location=San+Francisco%2C+CA&page=1",
    cacheTtlHours: 24
  },
  {
    id: "yc-product-jobs",
    name: "YC Jobs",
    type: "yc_jobs",
    enabled: false,
    searchUrl: "https://www.workatastartup.com/jobs",
    maxJobs: 50,
    cacheTtlHours: 12
  },
  {
    id: "levelsfyi-ai-pm",
    name: "Levels.fyi",
    type: "levelsfyi_search",
    enabled: false,
    searchUrl: "https://www.levels.fyi/jobs/",
    maxJobs: 50,
    cacheTtlHours: 12
  }
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeEnabledEntry(rawEntry, defaultEnabled) {
  if (typeof rawEntry === "boolean") {
    return {
      enabled: rawEntry,
      overrides: Object.create(null)
    };
  }

  if (!isPlainObject(rawEntry)) {
    return {
      enabled: defaultEnabled,
      overrides: Object.create(null)
    };
  }
  const enabled =
    typeof rawEntry.enabled === "boolean" ? rawEntry.enabled : defaultEnabled;

  return {
    enabled,
    // sources.json map mode is enablement-only; ignore legacy per-source metadata
    // to prevent old manual-search labels/URLs from leaking into source library rows.
    overrides: Object.create(null)
  };
}

export function listSourceLibraryDefinitions() {
  return SOURCE_LIBRARY.map((entry) => clone(entry));
}

export function getSourceAggregationIds(source) {
  const ids = [String(source?.id || "").trim()];
  const legacyIds = Array.isArray(source?.legacySourceIds) ? source.legacySourceIds : [];
  for (const rawId of legacyIds) {
    const id = String(rawId || "").trim();
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids.filter(Boolean);
}

export function defaultSourceEnabledMap() {
  const enabledMap = {};
  for (const source of SOURCE_LIBRARY) {
    enabledMap[source.id] = Boolean(source.enabled);
  }
  return enabledMap;
}

export function materializeSourcesFromLibraryMap(rawSourcesMap) {
  const sourcesMap =
    rawSourcesMap && typeof rawSourcesMap === "object" && !Array.isArray(rawSourcesMap)
      ? rawSourcesMap
      : {};

  return SOURCE_LIBRARY.map((source) => {
    const { enabled, overrides } = normalizeEnabledEntry(
      sourcesMap[source.id],
      Boolean(source.enabled)
    );
    return {
      ...clone(source),
      ...overrides,
      enabled
    };
  });
}
