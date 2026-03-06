import fs from "node:fs";
import path from "node:path";
import {
  buildSearchUrlForSourceType,
  toGoogleRecencyWindowFromDatePosted
} from "../sources/search-url-builder.js";

import {
  validateGoals,
  validateProfile,
  validateProfileSource,
  validateSearchCriteria,
  validateSources
} from "./schema.js";

const DEFAULT_PROFILE_SOURCE_CONFIG = {
  provider: "legacy_profile",
  legacyProfilePath: "config/profile.json",
  goalsPath: "config/my-goals.json",
  narrata: {
    mode: "file",
    goalsPath: "config/my-goals.json",
    supabaseUrl: "",
    userId: "",
    serviceRoleEnv: "NARRATA_SUPABASE_SERVICE_ROLE_KEY"
  }
};
const DEFAULT_SEARCH_CRITERIA_PATH = "config/search-criteria.json";

const GOOGLE_RECENCY_WINDOWS = new Set(["any", "1d", "1w", "1m"]);
const GOOGLE_RECENCY_TO_QDR = new Map([
  ["1d", "d"],
  ["1w", "w"],
  ["1m", "m"]
]);

function resolveSearchCriteriaPathForSources(sourcesPath, explicitSearchCriteriaPath = "") {
  const explicit = String(explicitSearchCriteriaPath || "").trim();
  if (explicit) {
    return explicit;
  }

  const resolvedSourcesPath = path.resolve(
    String(sourcesPath || "config/sources.json")
  );
  return path.join(path.dirname(resolvedSourcesPath), "search-criteria.json");
}

function resolveDefaultProfileSourceConfig() {
  const goalsPath = path.resolve("config/my-goals.json");
  if (fs.existsSync(goalsPath)) {
    return {
      ...DEFAULT_PROFILE_SOURCE_CONFIG,
      provider: "my_goals",
      goalsPath: "config/my-goals.json",
      narrata: {
        ...DEFAULT_PROFILE_SOURCE_CONFIG.narrata,
        goalsPath: "config/my-goals.json"
      }
    };
  }

  return { ...DEFAULT_PROFILE_SOURCE_CONFIG };
}

function readJsonFileWithPath(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Missing config file: ${resolvedPath}. Copy the matching .example.json file first.`
    );
  }

  const rawText = fs.readFileSync(resolvedPath, "utf8");

  try {
    return {
      resolvedPath,
      data: JSON.parse(rawText)
    };
  } catch (error) {
    throw new Error(`Invalid JSON in ${resolvedPath}: ${error.message}`);
  }
}

function normalizeGoogleRecencyWindow(rawValue, fallback = "1m") {
  const normalized = String(rawValue ?? "").trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (!GOOGLE_RECENCY_WINDOWS.has(normalized)) {
    throw new Error(
      "Google recencyWindow must be one of: any, 1d, 1w, 1m."
    );
  }

  return normalized;
}

function recencyWindowFromGoogleSearchUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    return null;
  }

  if (!/(^|\.)google\./i.test(parsed.hostname)) {
    return null;
  }

  const tbs = String(parsed.searchParams.get("tbs") || "").trim().toLowerCase();
  if (!tbs) {
    return null;
  }

  const match = tbs.match(/(?:^|,)qdr:([dwm])(?:,|$)/);
  if (!match) {
    return "any";
  }

  if (match[1] === "d") {
    return "1d";
  }

  if (match[1] === "w") {
    return "1w";
  }

  if (match[1] === "m") {
    return "1m";
  }

  return "any";
}

function applyGoogleRecencyWindow(rawUrl, recencyWindow) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    return urlText;
  }

  if (!/(^|\.)google\./i.test(parsed.hostname)) {
    return urlText;
  }

  parsed.searchParams.delete("tbs");
  const qdr = GOOGLE_RECENCY_TO_QDR.get(recencyWindow);
  if (qdr) {
    parsed.searchParams.set("tbs", `qdr:${qdr}`);
  }

  return parsed.toString();
}

export function loadProfile(profilePath = "config/profile.json") {
  return validateProfile(readJsonFileWithPath(profilePath).data);
}

export function loadGoals(goalsPath = "config/my-goals.json") {
  return validateGoals(readJsonFileWithPath(goalsPath).data);
}

export function loadSearchCriteria(searchCriteriaPath = DEFAULT_SEARCH_CRITERIA_PATH) {
  const resolvedPath = path.resolve(searchCriteriaPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      criteria: {}
    };
  }

  const { data } = readJsonFileWithPath(searchCriteriaPath);
  return {
    path: resolvedPath,
    criteria: validateSearchCriteria(data, "Search criteria")
  };
}

export function saveSearchCriteria(criteria, searchCriteriaPath = DEFAULT_SEARCH_CRITERIA_PATH) {
  const normalizedCriteria = validateSearchCriteria(criteria, "Search criteria");
  const resolvedPath = path.resolve(searchCriteriaPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(normalizedCriteria, null, 2)}\n`, "utf8");

  return {
    path: resolvedPath,
    criteria: normalizedCriteria
  };
}

function deriveRemotePreferenceFromGoals(goals) {
  const workType = Array.isArray(goals?.workType)
    ? goals.workType.map((value) => String(value || "").toLowerCase())
    : [];

  const wantsRemote = workType.includes("remote");
  const wantsHybrid = workType.includes("hybrid");
  const wantsInPerson =
    workType.includes("in-person") || workType.includes("in person") || workType.includes("onsite");

  if (wantsRemote && !wantsHybrid && !wantsInPerson) {
    return "remote_only";
  }

  if (wantsRemote) {
    return "remote_friendly";
  }

  return "onsite_ok";
}

export function mapGoalsToProfile(goals, options = {}) {
  const fallbackProfile = options.fallbackProfile || null;
  const candidateName = String(goals.candidateName || fallbackProfile?.candidateName || "").trim();
  const resumePath = String(goals.resumePath || fallbackProfile?.resumePath || "").trim();

  if (!candidateName) {
    throw new Error(
      "Goals are missing candidateName. Set candidateName in config/my-goals.json or keep profile.json as fallback."
    );
  }

  if (!resumePath) {
    throw new Error(
      "Goals are missing resumePath. Set resumePath in config/my-goals.json or keep profile.json as fallback."
    );
  }

  const cityLocations = Array.isArray(goals.preferredCities)
    ? goals.preferredCities
    : [];
  const targetLocations =
    cityLocations.length > 0
      ? cityLocations
      : Array.isArray(fallbackProfile?.targetLocations)
        ? fallbackProfile.targetLocations
        : [];

  const includeKeywords = Array.from(
    new Set([
      ...(Array.isArray(goals.includeKeywords) ? goals.includeKeywords : []),
      ...(Array.isArray(goals.businessModels) ? goals.businessModels : [])
    ])
  );

  const salaryFloor =
    Number.isFinite(goals?.dealBreakers?.salaryMinimum) && goals.dealBreakers.salaryMinimum > 0
      ? Number(goals.dealBreakers.salaryMinimum)
      : Number.isFinite(goals.minimumSalary)
        ? Number(goals.minimumSalary)
        : Number(fallbackProfile?.salaryFloor || 0);

  return validateProfile({
    candidateName,
    resumePath,
    targetTitles:
      Array.isArray(goals.targetTitles) && goals.targetTitles.length > 0
        ? goals.targetTitles
        : fallbackProfile?.targetTitles || [],
    targetLocations,
    remotePreference: deriveRemotePreferenceFromGoals(goals),
    salaryFloor: Number.isFinite(salaryFloor) ? salaryFloor : 0,
    seniorityLevels:
      Array.isArray(goals.seniorityLevels) && goals.seniorityLevels.length > 0
        ? goals.seniorityLevels
        : fallbackProfile?.seniorityLevels || [],
    preferredIndustries:
      Array.isArray(goals.industries) && goals.industries.length > 0
        ? goals.industries
        : fallbackProfile?.preferredIndustries || [],
    targetCompanies:
      Array.isArray(goals.targetCompanies) && goals.targetCompanies.length > 0
        ? goals.targetCompanies
        : fallbackProfile?.targetCompanies || [],
    includeKeywords:
      includeKeywords.length > 0 ? includeKeywords : fallbackProfile?.includeKeywords || [],
    excludeKeywords:
      Array.isArray(goals.excludeKeywords) && goals.excludeKeywords.length > 0
        ? goals.excludeKeywords
        : fallbackProfile?.excludeKeywords || [],
    workTypePreferences:
      Array.isArray(goals.workType) && goals.workType.length > 0
        ? goals.workType
        : fallbackProfile?.workTypePreferences || [],
    preferredBusinessModels:
      Array.isArray(goals.businessModels) && goals.businessModels.length > 0
        ? goals.businessModels
        : fallbackProfile?.preferredBusinessModels || [],
    preferredCompanyMaturity:
      Array.isArray(goals.companyMaturity) && goals.companyMaturity.length > 0
        ? goals.companyMaturity
        : fallbackProfile?.preferredCompanyMaturity || [],
    dealBreakers: {
      salaryMinimum:
        goals?.dealBreakers?.salaryMinimum ?? fallbackProfile?.dealBreakers?.salaryMinimum ?? null,
      workType:
        Array.isArray(goals?.dealBreakers?.workType) &&
        goals.dealBreakers.workType.length > 0
          ? goals.dealBreakers.workType
          : fallbackProfile?.dealBreakers?.workType || [],
      companyMaturity:
        Array.isArray(goals?.dealBreakers?.companyMaturity) &&
        goals.dealBreakers.companyMaturity.length > 0
          ? goals.dealBreakers.companyMaturity
          : fallbackProfile?.dealBreakers?.companyMaturity || []
    }
  });
}

function maybeLoadLegacyProfile(profilePath) {
  try {
    return loadProfile(profilePath);
  } catch {
    return null;
  }
}

export function loadProfileSourceConfig(profileSourcePath = "config/profile-source.json") {
  const defaultConfig = resolveDefaultProfileSourceConfig();
  const resolvedPath = path.resolve(profileSourcePath);
  if (!fs.existsSync(resolvedPath)) {
    return validateProfileSource(defaultConfig);
  }

  const rawText = fs.readFileSync(resolvedPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Invalid JSON in ${resolvedPath}: ${error.message}`);
  }

  return validateProfileSource({
    ...defaultConfig,
    ...parsed,
    narrata: {
      ...defaultConfig.narrata,
      ...(parsed?.narrata || {})
    }
  });
}

export function writeProfileSourceConfig(
  nextConfig,
  profileSourcePath = "config/profile-source.json"
) {
  const resolvedPath = path.resolve(profileSourcePath);
  const validated = validateProfileSource(nextConfig);
  fs.writeFileSync(resolvedPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return validated;
}

export function updateProfileSourceConfig(
  updates,
  profileSourcePath = "config/profile-source.json"
) {
  const current = loadProfileSourceConfig(profileSourcePath);
  const next = {
    ...current,
    ...updates,
    narrata: {
      ...current.narrata,
      ...(updates?.narrata || {})
    }
  };
  return writeProfileSourceConfig(next, profileSourcePath);
}

export function useLegacyProfileSource(
  legacyProfilePath = "config/profile.json",
  profileSourcePath = "config/profile-source.json"
) {
  return updateProfileSourceConfig(
    {
      provider: "legacy_profile",
      legacyProfilePath
    },
    profileSourcePath
  );
}

export function useMyGoalsProfileSource(
  goalsPath = "config/my-goals.json",
  profileSourcePath = "config/profile-source.json"
) {
  return updateProfileSourceConfig(
    {
      provider: "my_goals",
      goalsPath
    },
    profileSourcePath
  );
}

export function connectNarrataGoalsFile(
  goalsPath = "config/my-goals.json",
  profileSourcePath = "config/profile-source.json"
) {
  return updateProfileSourceConfig(
    {
      provider: "narrata",
      narrata: {
        mode: "file",
        goalsPath
      }
    },
    profileSourcePath
  );
}

export function connectNarrataSupabase(
  { supabaseUrl, userId, serviceRoleEnv = "NARRATA_SUPABASE_SERVICE_ROLE_KEY" },
  profileSourcePath = "config/profile-source.json"
) {
  return updateProfileSourceConfig(
    {
      provider: "narrata",
      narrata: {
        mode: "supabase",
        supabaseUrl,
        userId,
        serviceRoleEnv
      }
    },
    profileSourcePath
  );
}

export function loadActiveProfile(profileSourcePath = "config/profile-source.json") {
  const sourceConfig = loadProfileSourceConfig(profileSourcePath);
  const fallbackProfile = maybeLoadLegacyProfile(sourceConfig.legacyProfilePath);

  if (sourceConfig.provider === "legacy_profile") {
    return {
      profile: loadProfile(sourceConfig.legacyProfilePath),
      source: {
        provider: "legacy_profile",
        profilePath: sourceConfig.legacyProfilePath
      }
    };
  }

  if (sourceConfig.provider === "my_goals") {
    const goals = loadGoals(sourceConfig.goalsPath);
    return {
      profile: mapGoalsToProfile(goals, { fallbackProfile }),
      source: {
        provider: "my_goals",
        goalsPath: sourceConfig.goalsPath
      }
    };
  }

  if (sourceConfig.narrata.mode === "file") {
    const goalsPath = sourceConfig.narrata.goalsPath || sourceConfig.goalsPath;
    const goals = loadGoals(goalsPath);
    return {
      profile: mapGoalsToProfile(goals, { fallbackProfile }),
      source: {
        provider: "narrata",
        mode: "file",
        goalsPath
      }
    };
  }

  throw new Error(
    "Narrata supabase mode is configured but not yet enabled for local run commands. Use Narrata file mode for first pass."
  );
}

export function loadSources(sourcesPath = "config/sources.json") {
  return {
    sources: loadSourcesWithPath(sourcesPath).sources
  };
}

export function loadSourcesWithPath(
  sourcesPath = "config/sources.json",
  options = {}
) {
  const searchCriteriaPath = resolveSearchCriteriaPathForSources(
    sourcesPath,
    options.searchCriteriaPath
  );
  const searchCriteria = loadSearchCriteria(searchCriteriaPath).criteria;
  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const changed = ensureDerivedSourceMetadata(data, resolvedPath, searchCriteria);
  const validated = validateSources(data);

  if (changed) {
    fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  return {
    path: resolvedPath,
    sources: validated.sources
  };
}

function resolveEffectiveSearchCriteria(source, globalSearchCriteria) {
  const globalCriteria =
    globalSearchCriteria &&
    typeof globalSearchCriteria === "object" &&
    !Array.isArray(globalSearchCriteria)
      ? globalSearchCriteria
      : null;
  const sourceCriteria =
    source?.searchCriteria &&
    typeof source.searchCriteria === "object" &&
    !Array.isArray(source.searchCriteria)
      ? source.searchCriteria
      : null;

  if (!globalCriteria && !sourceCriteria) {
    return null;
  }

  return {
    ...(globalCriteria || {}),
    ...(sourceCriteria || {})
  };
}

function ensureDerivedSourceMetadata(raw, resolvedPath, globalSearchCriteria = null) {
  if (!raw || !Array.isArray(raw.sources)) {
    return false;
  }

  let changed = false;

  for (const source of raw.sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    if (
      source.type !== "linkedin_capture_file" &&
      source.type !== "builtin_search" &&
      source.type !== "google_search" &&
      source.type !== "wellfound_search" &&
      source.type !== "ashby_search" &&
      source.type !== "indeed_search" &&
      source.type !== "ziprecruiter_search" &&
      source.type !== "remoteok_search"
    ) {
      continue;
    }

    const sourceId = String(source.id || "").trim();
    if (!sourceId) {
      continue;
    }

    let capturePath = String(source.capturePath || "").trim();
    if (!capturePath) {
      const capturesDir = path.resolve(path.dirname(resolvedPath), "..", "data", "captures");
      fs.mkdirSync(capturesDir, { recursive: true });
      capturePath = path.join(capturesDir, `${sourceId}.json`);
      source.capturePath = capturePath;
      changed = true;
    }

    const resolvedCapturePath = path.resolve(capturePath);
    if (!fs.existsSync(resolvedCapturePath)) {
      const emptyCapture = {
        sourceId,
        sourceName: String(source.name || "").trim() || sourceId,
        searchUrl: String(source.searchUrl || "").trim(),
        capturedAt: null,
        jobs: []
      };
      fs.mkdirSync(path.dirname(resolvedCapturePath), { recursive: true });
      fs.writeFileSync(
        resolvedCapturePath,
        `${JSON.stringify(emptyCapture, null, 2)}\n`,
        "utf8"
      );
    }

    const effectiveCriteria = resolveEffectiveSearchCriteria(
      source,
      globalSearchCriteria
    );

    if (effectiveCriteria) {
      const criteriaRecencyWindow =
        source.type === "ashby_search" || source.type === "google_search"
          ? toGoogleRecencyWindowFromDatePosted(effectiveCriteria.datePosted)
          : null;

      if (
        criteriaRecencyWindow &&
        (source.type === "ashby_search" || source.type === "google_search") &&
        source.recencyWindow !== criteriaRecencyWindow
      ) {
        source.recencyWindow = criteriaRecencyWindow;
        changed = true;
      }

      const built = buildSearchUrlForSourceType(source.type, effectiveCriteria, {
        baseUrl: source.searchUrl,
        recencyWindow: source.recencyWindow
      });
      if (
        built.url &&
        built.url !== String(source.searchUrl || "").trim()
      ) {
        source.searchUrl = built.url;
        changed = true;
      }
    }

    if (source.type === "ashby_search" || source.type === "google_search") {
      const defaultRecency = source.type === "google_search" ? "1w" : "1m";
      const recencyWindow = normalizeGoogleRecencyWindow(
        source.recencyWindow || recencyWindowFromGoogleSearchUrl(source.searchUrl) || defaultRecency,
        defaultRecency
      );

      if (source.recencyWindow !== recencyWindow) {
        source.recencyWindow = recencyWindow;
        changed = true;
      }

      const normalizedSearchUrl = normalizeSearchUrlForSourceType(
        source.searchUrl,
        source.type,
        { recencyWindow }
      );

      if (
        normalizedSearchUrl &&
        normalizedSearchUrl !== String(source.searchUrl || "").trim()
      ) {
        source.searchUrl = normalizedSearchUrl;
        changed = true;
      }
    }
  }

  return changed;
}

function slugifySourceId(label) {
  const slug = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "source";
}

function findSourceIndexByIdOrName(sources, sourceIdOrName) {
  const query = String(sourceIdOrName || "").trim();
  const queryLower = query.toLowerCase();

  if (!query) {
    return -1;
  }

  return sources.findIndex((source) => {
    if (!source || typeof source !== "object") {
      return false;
    }

    return source.id === query || String(source.name || "").toLowerCase() === queryLower;
  });
}

function requireSourcesArray(raw, resolvedPath) {
  if (!raw || !Array.isArray(raw.sources)) {
    throw new Error(`Sources in ${resolvedPath} must include a sources array.`);
  }

  return raw.sources;
}

function syncCaptureFileMetadata(source) {
  if (
    !source ||
    (source.type !== "linkedin_capture_file" &&
      source.type !== "builtin_search" &&
      source.type !== "google_search" &&
      source.type !== "wellfound_search" &&
      source.type !== "ashby_search" &&
      source.type !== "indeed_search" &&
      source.type !== "ziprecruiter_search" &&
      source.type !== "remoteok_search")
  ) {
    return;
  }

  const capturePath = String(source.capturePath || "").trim();
  if (!capturePath || !fs.existsSync(capturePath)) {
    return;
  }

  let payload = {
    jobs: []
  };

  try {
    const raw = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      payload = raw;
    }
  } catch {
    payload = { jobs: [] };
  }

  payload.sourceId = source.id;
  payload.sourceName = source.name;
  payload.searchUrl = source.searchUrl;
  payload.capturedAt = payload.capturedAt ?? null;
  payload.jobs = Array.isArray(payload.jobs) ? payload.jobs : [];

  fs.writeFileSync(capturePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const LINKEDIN_STABLE_SEARCH_KEYS = new Set([
  "keywords",
  "geoId",
  "distance",
  "location",
  "sortBy",
  "start"
]);

function normalizeLinkedInSearchUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();

  if (!urlText) {
    return "";
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(urlText);
  } catch {
    return urlText;
  }

  if (!/linkedin\.com$/i.test(parsedUrl.hostname)) {
    return urlText;
  }

  const normalizedParams = new URLSearchParams();

  for (const [key, value] of parsedUrl.searchParams.entries()) {
    if (LINKEDIN_STABLE_SEARCH_KEYS.has(key) || key.startsWith("f_")) {
      normalizedParams.append(key, value);
    }
  }

  parsedUrl.search = normalizedParams.toString();
  parsedUrl.hash = "";

  return parsedUrl.toString();
}

function normalizeSearchUrlForSourceType(rawUrl, sourceType, options = {}) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return "";
  }

  if (
    sourceType === "linkedin_capture_file" ||
    sourceType === "mock_linkedin_saved_search"
  ) {
    return normalizeLinkedInSearchUrl(urlText);
  }

  if (sourceType === "ashby_search" || sourceType === "google_search") {
    const defaultRecency = sourceType === "google_search" ? "1w" : "1m";
    const recencyWindow = normalizeGoogleRecencyWindow(
      options.recencyWindow || recencyWindowFromGoogleSearchUrl(urlText) || defaultRecency,
      defaultRecency
    );

    return applyGoogleRecencyWindow(urlText, recencyWindow);
  }

  return urlText;
}

export function updateSourceSearchUrl(
  sourceIdOrName,
  searchUrl,
  sourcesPath = "config/sources.json"
) {
  return updateSourceDefinition(
    sourceIdOrName,
    {
      searchUrl
    },
    sourcesPath
  );
}

export function updateSourceDefinition(
  sourceIdOrName,
  updates,
  sourcesPath = "config/sources.json"
) {
  const normalizedSourceIdOrName = String(sourceIdOrName || "").trim();
  const nextName =
    updates && typeof updates.name === "string" ? String(updates.name).trim() : null;
  const rawNextSearchUrl =
    updates && typeof updates.searchUrl === "string"
      ? String(updates.searchUrl)
      : null;
  const hasRecencyWindowUpdate =
    updates &&
    Object.prototype.hasOwnProperty.call(updates, "recencyWindow");
  const rawNextRecencyWindow =
    updates && typeof updates.recencyWindow === "string"
      ? String(updates.recencyWindow)
      : "";

  if (!normalizedSourceIdOrName) {
    throw new Error("Source id or label is required.");
  }

  if (nextName !== null && !nextName) {
    throw new Error("Source label is required.");
  }

  if (rawNextSearchUrl !== null && !rawNextSearchUrl.trim()) {
    throw new Error("Search URL is required.");
  }

  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const sources = requireSourcesArray(data, resolvedPath);

  const sourceIndex = findSourceIndexByIdOrName(sources, normalizedSourceIdOrName);

  if (sourceIndex === -1) {
    throw new Error(`Source not found: ${normalizedSourceIdOrName}`);
  }

  const source = sources[sourceIndex];
  const currentGoogleRecencyWindow =
    source.type === "ashby_search" || source.type === "google_search"
      ? normalizeGoogleRecencyWindow(
          source.recencyWindow ||
            recencyWindowFromGoogleSearchUrl(source.searchUrl) ||
            (source.type === "google_search" ? "1w" : "1m"),
          source.type === "google_search" ? "1w" : "1m"
        )
      : null;
  const nextGoogleRecencyWindow =
    source.type === "ashby_search" || source.type === "google_search"
      ? hasRecencyWindowUpdate
        ? normalizeGoogleRecencyWindow(
            rawNextRecencyWindow,
            currentGoogleRecencyWindow || (source.type === "google_search" ? "1w" : "1m")
          )
        : currentGoogleRecencyWindow
      : null;
  const nextSearchUrl =
    rawNextSearchUrl !== null
      ? normalizeSearchUrlForSourceType(rawNextSearchUrl, source.type, {
          recencyWindow: nextGoogleRecencyWindow
        })
      : null;

  if (nextName !== null) {
    const duplicateNameIndex = sources.findIndex((candidate, candidateIndex) => {
      if (candidateIndex === sourceIndex) {
        return false;
      }

      return String(candidate?.name || "").toLowerCase() === nextName.toLowerCase();
    });

    if (duplicateNameIndex !== -1) {
      throw new Error(`A source with that label already exists: ${nextName}`);
    }

    source.name = nextName;
  }

  if (nextSearchUrl !== null) {
    source.searchUrl = nextSearchUrl;
  }

  if ((source.type === "ashby_search" || source.type === "google_search") && nextGoogleRecencyWindow) {
    source.recencyWindow = nextGoogleRecencyWindow;
    if (nextSearchUrl === null) {
      source.searchUrl = normalizeSearchUrlForSourceType(
        source.searchUrl,
        source.type,
        { recencyWindow: nextGoogleRecencyWindow }
      );
    }
  }

  syncCaptureFileMetadata(sources[sourceIndex]);
  const validated = validateSources(data);
  fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  return validated.sources[sourceIndex];
}

export function addLinkedInCaptureSource(
  name,
  searchUrl,
  sourcesPath = "config/sources.json"
) {
  const normalizedName = String(name || "").trim();
  const normalizedSearchUrl = normalizeLinkedInSearchUrl(searchUrl);

  if (!normalizedName) {
    throw new Error("Source label is required.");
  }

  if (!normalizedSearchUrl) {
    throw new Error("Search URL is required.");
  }

  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const sources = requireSourcesArray(data, resolvedPath);

  const duplicateNameIndex = findSourceIndexByIdOrName(sources, normalizedName);
  if (duplicateNameIndex !== -1) {
    throw new Error(`A source with that label already exists: ${normalizedName}`);
  }

  const baseId = slugifySourceId(normalizedName);
  let sourceId = baseId;
  let suffix = 2;

  while (sources.some((source) => source && source.id === sourceId)) {
    sourceId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const capturesDir = path.resolve(path.dirname(resolvedPath), "..", "data", "captures");
  fs.mkdirSync(capturesDir, { recursive: true });

  const capturePath = path.join(capturesDir, `${sourceId}.json`);
  if (!fs.existsSync(capturePath)) {
    const emptyCapture = {
      sourceId,
      sourceName: normalizedName,
      searchUrl: normalizedSearchUrl,
      capturedAt: null,
      jobs: []
    };
    fs.writeFileSync(capturePath, `${JSON.stringify(emptyCapture, null, 2)}\n`, "utf8");
  }

  sources.push({
    id: sourceId,
    name: normalizedName,
    type: "linkedin_capture_file",
    enabled: true,
    searchUrl: normalizedSearchUrl,
    capturePath
  });

  syncCaptureFileMetadata(sources[sources.length - 1]);

  const validated = validateSources(data);
  fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  return validated.sources[validated.sources.length - 1];
}

export function addBuiltinSearchSource(
  name,
  searchUrl,
  sourcesPath = "config/sources.json"
) {
  return addLiveFetchSource(name, searchUrl, "builtin_search", sourcesPath);
}

export function addGoogleSearchSource(
  name,
  searchUrl,
  sourcesPath = "config/sources.json",
  recencyWindow
) {
  return addLiveFetchSource(name, searchUrl, "google_search", sourcesPath, {
    recencyWindow
  });
}

function addLiveFetchSource(
  name,
  searchUrl,
  type,
  sourcesPath = "config/sources.json",
  options = {}
) {
  const allowedTypes = new Set([
    "builtin_search",
    "google_search",
    "wellfound_search",
    "ashby_search",
    "indeed_search",
    "ziprecruiter_search",
    "remoteok_search"
  ]);
  if (!allowedTypes.has(type)) {
    throw new Error(`Unsupported live-fetch source type: ${type}`);
  }

  const normalizedName = String(name || "").trim();
  const recencyWindow =
    type === "ashby_search" || type === "google_search"
      ? normalizeGoogleRecencyWindow(
          options.recencyWindow ||
            recencyWindowFromGoogleSearchUrl(searchUrl) ||
            (type === "google_search" ? "1w" : "1m"),
          type === "google_search" ? "1w" : "1m"
        )
      : null;
  const normalizedSearchUrl = normalizeSearchUrlForSourceType(searchUrl, type, {
    recencyWindow
  });

  if (!normalizedName) {
    throw new Error("Source label is required.");
  }

  if (!normalizedSearchUrl) {
    throw new Error("Search URL is required.");
  }

  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const sources = requireSourcesArray(data, resolvedPath);

  const duplicateNameIndex = findSourceIndexByIdOrName(sources, normalizedName);
  if (duplicateNameIndex !== -1) {
    throw new Error(`A source with that label already exists: ${normalizedName}`);
  }

  const baseId = slugifySourceId(normalizedName);
  let sourceId = baseId;
  let suffix = 2;

  while (sources.some((source) => source && source.id === sourceId)) {
    sourceId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const nextSource = {
    id: sourceId,
    name: normalizedName,
    type,
    enabled: true,
    searchUrl: normalizedSearchUrl
  };

  if ((type === "ashby_search" || type === "google_search") && recencyWindow) {
    nextSource.recencyWindow = recencyWindow;
  }

  if (
    type === "builtin_search" ||
    type === "google_search" ||
    type === "wellfound_search" ||
    type === "ashby_search" ||
    type === "indeed_search" ||
    type === "ziprecruiter_search" ||
    type === "remoteok_search"
  ) {
    const capturesDir = path.resolve(path.dirname(resolvedPath), "..", "data", "captures");
    fs.mkdirSync(capturesDir, { recursive: true });
    const capturePath = path.join(capturesDir, `${sourceId}.json`);
    if (!fs.existsSync(capturePath)) {
      const emptyCapture = {
        sourceId,
        sourceName: normalizedName,
        searchUrl: normalizedSearchUrl,
        capturedAt: null,
        jobs: []
      };
      fs.writeFileSync(capturePath, `${JSON.stringify(emptyCapture, null, 2)}\n`, "utf8");
    }
    nextSource.capturePath = capturePath;
  }

  sources.push(nextSource);

  syncCaptureFileMetadata(sources[sources.length - 1]);

  const validated = validateSources(data);
  fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  return validated.sources[validated.sources.length - 1];
}

export function addWellfoundSearchSource(
  name,
  searchUrl,
  sourcesPath = "config/sources.json"
) {
  return addLiveFetchSource(name, searchUrl, "wellfound_search", sourcesPath);
}

export function addAshbySearchSource(
  name,
  searchUrl,
  sourcesPath = "config/sources.json",
  recencyWindow
) {
  return addLiveFetchSource(name, searchUrl, "ashby_search", sourcesPath, {
    recencyWindow
  });
}

export function addIndeedSearchSource(
  name,
  searchUrl,
  sourcesPath = "config/sources.json"
) {
  return addLiveFetchSource(name, searchUrl, "indeed_search", sourcesPath);
}

export function addZipRecruiterSearchSource(
  name,
  searchUrl,
  sourcesPath = "config/sources.json"
) {
  return addLiveFetchSource(name, searchUrl, "ziprecruiter_search", sourcesPath);
}

export function addRemoteOkSearchSource(
  name,
  searchUrl,
  sourcesPath = "config/sources.json"
) {
  return addLiveFetchSource(name, searchUrl, "remoteok_search", sourcesPath);
}

function deriveNextSearchMetadata(source, globalSearchCriteria = null) {
  const currentUrl = String(source?.searchUrl || "").trim();
  const isGoogleLike =
    source?.type === "ashby_search" || source?.type === "google_search";

  let nextRecencyWindow = null;
  if (isGoogleLike) {
    const defaultRecency = source.type === "google_search" ? "1w" : "1m";
    const existingRecency = String(source.recencyWindow || "").trim();
    nextRecencyWindow = normalizeGoogleRecencyWindow(
      existingRecency || recencyWindowFromGoogleSearchUrl(currentUrl) || defaultRecency,
      defaultRecency
    );
  }

  let nextSearchUrl = currentUrl;
  let unsupported = [];
  let notes = [];

  const effectiveCriteria = resolveEffectiveSearchCriteria(
    source,
    globalSearchCriteria
  );

  if (effectiveCriteria) {
    const criteriaRecencyWindow = isGoogleLike
      ? toGoogleRecencyWindowFromDatePosted(effectiveCriteria.datePosted)
      : null;
    if (criteriaRecencyWindow && isGoogleLike) {
      nextRecencyWindow = criteriaRecencyWindow;
    }

    const built = buildSearchUrlForSourceType(source.type, effectiveCriteria, {
      baseUrl: currentUrl,
      recencyWindow: nextRecencyWindow
    });
    if (built.url) {
      nextSearchUrl = built.url;
    }
    unsupported = Array.isArray(built.unsupported) ? built.unsupported : [];
    notes = Array.isArray(built.notes) ? built.notes : [];
  }

  if (isGoogleLike) {
    const normalized = normalizeSearchUrlForSourceType(nextSearchUrl, source.type, {
      recencyWindow: nextRecencyWindow
    });
    if (normalized) {
      nextSearchUrl = normalized;
    }
  }

  return {
    nextSearchUrl,
    nextRecencyWindow,
    unsupported,
    notes
  };
}

export function previewNormalizedSourceSearchUrls(
  sourcesPath = "config/sources.json",
  options = {}
) {
  const searchCriteriaPath = resolveSearchCriteriaPathForSources(
    sourcesPath,
    options.searchCriteriaPath
  );
  const globalSearchCriteria = loadSearchCriteria(searchCriteriaPath).criteria;
  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const sources = requireSourcesArray(data, resolvedPath);
  const previewRows = [];
  let changed = 0;

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const currentSearchUrl = String(source.searchUrl || "").trim();
    const currentRecencyWindow =
      source.type === "ashby_search" || source.type === "google_search"
        ? String(source.recencyWindow || "").trim()
        : null;
    const derived = deriveNextSearchMetadata(source, globalSearchCriteria);

    const recencyChanged =
      source.type === "ashby_search" || source.type === "google_search"
        ? currentRecencyWindow !== String(derived.nextRecencyWindow || "")
        : false;
    const searchUrlChanged = currentSearchUrl !== String(derived.nextSearchUrl || "");
    const rowChanged = recencyChanged || searchUrlChanged;
    if (rowChanged) {
      changed += 1;
    }

    previewRows.push({
      id: String(source.id || "").trim(),
      name: String(source.name || "").trim(),
      type: String(source.type || "").trim(),
      changed: rowChanged,
      currentSearchUrl,
      nextSearchUrl: String(derived.nextSearchUrl || ""),
      currentRecencyWindow,
      nextRecencyWindow:
        source.type === "ashby_search" || source.type === "google_search"
          ? String(derived.nextRecencyWindow || "")
          : null,
      unsupported: derived.unsupported,
      notes: derived.notes
    });
  }

  return {
    changed,
    sources: previewRows
  };
}

export function normalizeAllSourceSearchUrls(
  sourcesPath = "config/sources.json",
  options = {}
) {
  const searchCriteriaPath = resolveSearchCriteriaPathForSources(
    sourcesPath,
    options.searchCriteriaPath
  );
  const globalSearchCriteria = loadSearchCriteria(searchCriteriaPath).criteria;
  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const sources = requireSourcesArray(data, resolvedPath);

  let changed = 0;

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const derived = deriveNextSearchMetadata(source, globalSearchCriteria);

    if (
      (source.type === "ashby_search" || source.type === "google_search") &&
      source.recencyWindow !== derived.nextRecencyWindow
    ) {
      source.recencyWindow = derived.nextRecencyWindow;
      changed += 1;
    }

    if (derived.nextSearchUrl && derived.nextSearchUrl !== source.searchUrl) {
      source.searchUrl = derived.nextSearchUrl;
      changed += 1;
    }

    syncCaptureFileMetadata(source);
  }

  const validated = validateSources(data);
  fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  return {
    changed,
    sources: validated.sources
  };
}

export function getSourceByIdOrName(
  sourceIdOrName,
  sourcesPath = "config/sources.json",
  options = {}
) {
  const searchCriteriaPath = resolveSearchCriteriaPathForSources(
    sourcesPath,
    options.searchCriteriaPath
  );
  const globalSearchCriteria = loadSearchCriteria(searchCriteriaPath).criteria;
  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const changed = ensureDerivedSourceMetadata(data, resolvedPath, globalSearchCriteria);
  const sources = requireSourcesArray(data, resolvedPath);
  const validated = validateSources(data);
  const sourceIndex = findSourceIndexByIdOrName(sources, sourceIdOrName);

  if (changed) {
    fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  if (sourceIndex === -1) {
    throw new Error(`Source not found: ${String(sourceIdOrName || "").trim()}`);
  }

  return validated.sources[sourceIndex];
}

export function loadAppConfig() {
  const active = loadActiveProfile();
  return {
    profile: active.profile,
    profileSource: active.source,
    searchCriteria: loadSearchCriteria().criteria,
    sources: loadSources()
  };
}
