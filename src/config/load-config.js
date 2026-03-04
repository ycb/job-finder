import fs from "node:fs";
import path from "node:path";

import { validateProfile, validateSources } from "./schema.js";

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

export function loadSources(sourcesPath = "config/sources.json") {
  return validateSources(readJsonFileWithPath(sourcesPath).data);
}

export function loadSourcesWithPath(sourcesPath = "config/sources.json") {
  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);

  return {
    path: resolvedPath,
    sources: validateSources(data)
  };
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
  if (!source || source.type !== "linkedin_capture_file") {
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
  const nextSearchUrl =
    updates && typeof updates.searchUrl === "string"
      ? normalizeLinkedInSearchUrl(updates.searchUrl)
      : null;

  if (!normalizedSourceIdOrName) {
    throw new Error("Source id or label is required.");
  }

  if (nextName !== null && !nextName) {
    throw new Error("Source label is required.");
  }

  if (nextSearchUrl !== null && !nextSearchUrl) {
    throw new Error("Search URL is required.");
  }

  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const sources = requireSourcesArray(data, resolvedPath);

  const sourceIndex = findSourceIndexByIdOrName(sources, normalizedSourceIdOrName);

  if (sourceIndex === -1) {
    throw new Error(`Source not found: ${normalizedSourceIdOrName}`);
  }

  const source = sources[sourceIndex];

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

export function normalizeAllSourceSearchUrls(sourcesPath = "config/sources.json") {
  const { resolvedPath, data } = readJsonFileWithPath(sourcesPath);
  const sources = requireSourcesArray(data, resolvedPath);

  let changed = 0;

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const nextUrl = normalizeLinkedInSearchUrl(source.searchUrl);
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
  const sources = requireSourcesArray(data, resolvedPath);
  const validated = validateSources(data);
  const sourceIndex = findSourceIndexByIdOrName(sources, sourceIdOrName);

  if (sourceIndex === -1) {
    throw new Error(`Source not found: ${String(sourceIdOrName || "").trim()}`);
  }

  return validated.sources[sourceIndex];
}

export function loadAppConfig() {
  return {
    profile: loadProfile(),
    sources: loadSources()
  };
}
