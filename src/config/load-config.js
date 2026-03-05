import fs from "node:fs";
import path from "node:path";

import {
  validateGoals,
  validateProfile,
  validateProfileSource,
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

export function loadProfile(profilePath = "config/profile.json") {
  return validateProfile(readJsonFileWithPath(profilePath).data);
}

export function loadGoals(goalsPath = "config/my-goals.json") {
  return validateGoals(readJsonFileWithPath(goalsPath).data);
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

export function loadSourcesWithPath(sourcesPath = "config/sources.json") {
  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const changed = ensureDerivedSourceMetadata(data, resolvedPath);
  const validated = validateSources(data);

  if (changed) {
    fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  return {
    path: resolvedPath,
    sources: validated.sources
  };
}

function ensureDerivedSourceMetadata(raw, resolvedPath) {
  if (!raw || !Array.isArray(raw.sources)) {
    return false;
  }

  let changed = false;

  for (const source of raw.sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    if (source.type !== "wellfound_search") {
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
    (source.type !== "linkedin_capture_file" && source.type !== "wellfound_search")
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

function normalizeSearchUrlForSourceType(rawUrl, sourceType) {
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
  const nextSearchUrl =
    rawNextSearchUrl !== null
      ? normalizeSearchUrlForSourceType(rawNextSearchUrl, source.type)
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

function addLiveFetchSource(
  name,
  searchUrl,
  type,
  sourcesPath = "config/sources.json"
) {
  const allowedTypes = new Set(["builtin_search", "wellfound_search", "ashby_search"]);
  if (!allowedTypes.has(type)) {
    throw new Error(`Unsupported live-fetch source type: ${type}`);
  }

  const normalizedName = String(name || "").trim();
  const normalizedSearchUrl = normalizeSearchUrlForSourceType(searchUrl, type);

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

  if (type === "wellfound_search") {
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
  sourcesPath = "config/sources.json"
) {
  return addLiveFetchSource(name, searchUrl, "ashby_search", sourcesPath);
}

export function normalizeAllSourceSearchUrls(sourcesPath = "config/sources.json") {
  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const sources = requireSourcesArray(data, resolvedPath);

  let changed = 0;

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const nextUrl = normalizeSearchUrlForSourceType(source.searchUrl, source.type);
    if (nextUrl && nextUrl !== source.searchUrl) {
      source.searchUrl = nextUrl;
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

export function getSourceByIdOrName(sourceIdOrName, sourcesPath = "config/sources.json") {
  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const changed = ensureDerivedSourceMetadata(data, resolvedPath);
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
    sources: loadSources()
  };
}
