const SOURCE_LIBRARY = Object.freeze([
  {
    id: "linkedin-live-capture",
    name: "LinkedIn",
    type: "linkedin_capture_file",
    enabled: false,
    searchUrl: "https://www.linkedin.com/jobs/search/",
    capturePath: "data/captures/linkedin-live-capture.json",
    cacheTtlHours: 24
  },
  {
    id: "builtin-sf-ai-pm",
    name: "Built In",
    type: "builtin_search",
    enabled: true,
    searchUrl: "https://www.builtinsf.com/jobs/product-management/product-manager",
    maxJobs: 50,
    cacheTtlHours: 12
  },
  {
    id: "ashby-pm-roles",
    name: "Ashby",
    type: "ashby_search",
    enabled: true,
    searchUrl: "https://jobs.ashbyhq.com/",
    maxJobs: 50,
    recencyWindow: "1w",
    cacheTtlHours: 24
  },
  {
    id: "indeed-ai-pm",
    name: "Indeed",
    type: "indeed_search",
    enabled: false,
    searchUrl: "https://www.indeed.com/jobs",
    cacheTtlHours: 24
  },
  {
    id: "zip-ai-pm",
    name: "ZipRecruiter",
    type: "ziprecruiter_search",
    enabled: false,
    searchUrl: "https://www.ziprecruiter.com/jobs-search",
    cacheTtlHours: 24
  },
  {
    id: "google-ai-pm",
    name: "Google",
    type: "google_search",
    enabled: true,
    searchUrl: "https://www.google.com/search",
    recencyWindow: "1w",
    cacheTtlHours: 12
  },
  {
    id: "wellfound-ai-pm",
    name: "Wellfound",
    type: "wellfound_search",
    enabled: false,
    searchUrl: "https://wellfound.com/jobs",
    maxJobs: 50,
    cacheTtlHours: 24
  },
  {
    id: "remoteok-ai-pm",
    name: "RemoteOK",
    type: "remoteok_search",
    enabled: false,
    searchUrl: "https://remoteok.com/remote-product-manager-jobs",
    cacheTtlHours: 24
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
