import fs from "node:fs";
import path from "node:path";

import { readSourceCaptureSummary } from "./cache-policy.js";
import { loadSourcesWithPath } from "../config/load-config.js";

const SUPPORTED_SOURCE_TYPES = new Set([
  "linkedin_capture_file",
  "builtin_search",
  "wellfound_search",
  "ashby_search",
  "google_search",
  "indeed_search",
  "ziprecruiter_search",
  "remoteok_search"
]);

const SUPPORTED_MAPPING_MODES = new Set([
  "url",
  "ui_bootstrap",
  "post_capture",
  "unsupported"
]);

const CRITERIA_FIELDS = [
  "title",
  "keywords",
  "location",
  "distanceMiles",
  "datePosted",
  "experienceLevel",
  "minSalary"
];

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  for (const entry of value) {
    const normalized = normalizeString(entry);
    if (normalized && !output.includes(normalized)) {
      output.push(normalized);
    }
  }
  return output;
}

function validateContract(rawContract, label) {
  assertObject(rawContract, label);
  const sourceType = normalizeString(rawContract.sourceType);
  if (!SUPPORTED_SOURCE_TYPES.has(sourceType)) {
    throw new Error(
      `${label}.sourceType must be one of: ${Array.from(SUPPORTED_SOURCE_TYPES).join(", ")}.`
    );
  }

  const criteriaMapping = {};
  const rawCriteriaMapping =
    rawContract.criteriaMapping &&
    typeof rawContract.criteriaMapping === "object" &&
    !Array.isArray(rawContract.criteriaMapping)
      ? rawContract.criteriaMapping
      : {};

  for (const field of CRITERIA_FIELDS) {
    const mode = normalizeString(rawCriteriaMapping[field], "unsupported");
    if (!SUPPORTED_MAPPING_MODES.has(mode)) {
      throw new Error(
        `${label}.criteriaMapping.${field} must be one of: ${Array.from(SUPPORTED_MAPPING_MODES).join(", ")}.`
      );
    }
    criteriaMapping[field] = mode;
  }

  const extraction =
    rawContract.extraction &&
    typeof rawContract.extraction === "object" &&
    !Array.isArray(rawContract.extraction)
      ? rawContract.extraction
      : {};

  return {
    sourceType,
    contractVersion: normalizeString(rawContract.contractVersion, "1.0.0"),
    lastVerified: normalizeString(rawContract.lastVerified),
    criteriaMapping,
    extraction: {
      requiredFields: normalizeStringArray(extraction.requiredFields),
      fullJobDescription: normalizeString(extraction.fullJobDescription, "unknown")
    },
    expectedCountStrategy: normalizeString(rawContract.expectedCountStrategy, "none"),
    paginationStrategy: normalizeString(rawContract.paginationStrategy, "unknown")
  };
}

export function loadSourceContracts(contractsPath = "config/source-contracts.json") {
  const resolvedPath = path.resolve(String(contractsPath || "config/source-contracts.json"));
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Missing source contracts file: ${resolvedPath}`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${resolvedPath}: ${error.message}`);
  }

  assertObject(raw, "Source contracts");
  const contracts = Array.isArray(raw.contracts) ? raw.contracts : [];
  const normalizedContracts = contracts.map((contract, index) =>
    validateContract(contract, `Source contracts.contracts[${index}]`)
  );

  const byType = new Map();
  for (const contract of normalizedContracts) {
    if (byType.has(contract.sourceType)) {
      throw new Error(
        `Duplicate source contract for type "${contract.sourceType}" in ${resolvedPath}.`
      );
    }
    byType.set(contract.sourceType, contract);
  }

  return {
    path: resolvedPath,
    version: normalizeString(raw.version, "unknown"),
    contracts: normalizedContracts,
    byType
  };
}

function isDateOlderThanDays(rawDate, days) {
  const parsed = Date.parse(String(rawDate || ""));
  if (!Number.isFinite(parsed)) {
    return true;
  }
  const ageMs = Date.now() - parsed;
  return ageMs > days * 24 * 60 * 60 * 1000;
}

function extractJobFieldValue(job, fieldName) {
  if (!job || typeof job !== "object") {
    return "";
  }
  return normalizeString(job[fieldName]);
}

function normalizeCoverageRatio(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    return null;
  }
  return Math.round(numeric * 1000) / 1000;
}

function computeCoverageByField(jobs, requiredFields) {
  const coverageByField = {};
  const samples = Array.isArray(jobs) ? jobs : [];
  const fields = Array.isArray(requiredFields) ? requiredFields : [];

  for (const field of fields) {
    if (samples.length === 0) {
      coverageByField[field] = null;
      continue;
    }
    let present = 0;
    for (const job of samples) {
      const value = extractJobFieldValue(job, field);
      if (value && value.toLowerCase() !== "unknown") {
        present += 1;
      }
    }
    coverageByField[field] = Math.round((present / samples.length) * 1000) / 1000;
  }

  return coverageByField;
}

function resolveQualityHistoryPath(historyPath, sourcesPath) {
  const explicit = normalizeString(historyPath);
  if (explicit) {
    return path.resolve(explicit);
  }

  const resolvedSourcesPath = path.resolve(String(sourcesPath || "config/sources.json"));
  return path.resolve(path.dirname(path.dirname(resolvedSourcesPath)), "data", "quality", "source-coverage-history.json");
}

function loadCoverageHistory(historyPath) {
  const resolvedPath = path.resolve(String(historyPath || ""));
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      version: "1.0.0",
      bySource: {}
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    const bySource =
      parsed?.bySource && typeof parsed.bySource === "object" && !Array.isArray(parsed.bySource)
        ? parsed.bySource
        : {};
    return {
      path: resolvedPath,
      version: normalizeString(parsed?.version, "1.0.0"),
      bySource
    };
  } catch {
    return {
      path: resolvedPath,
      version: "1.0.0",
      bySource: {}
    };
  }
}

function saveCoverageHistory(history) {
  const historyPath = path.resolve(String(history?.path || ""));
  if (!historyPath) {
    return;
  }

  const payload = {
    version: normalizeString(history?.version, "1.0.0"),
    updatedAt: new Date().toISOString(),
    bySource:
      history?.bySource && typeof history.bySource === "object" && !Array.isArray(history.bySource)
        ? history.bySource
        : {}
  };

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function sortHistoryEntriesNewestFirst(entries) {
  return [...entries].sort((left, right) => {
    const leftMs = Date.parse(String(left?.capturedAt || ""));
    const rightMs = Date.parse(String(right?.capturedAt || ""));
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });
}

function filterFreshHistoryEntries(entries, staleAfterDays) {
  return entries.filter((entry) => {
    const capturedAt = normalizeString(entry?.capturedAt);
    if (!capturedAt) {
      return false;
    }
    return !isDateOlderThanDays(capturedAt, staleAfterDays);
  });
}

function upsertCoverageHistoryEntry(history, sourceId, entry) {
  if (!history?.bySource || typeof history.bySource !== "object") {
    history.bySource = {};
  }

  const sourceKey = normalizeString(sourceId);
  if (!sourceKey) {
    return;
  }

  const currentEntries = Array.isArray(history.bySource[sourceKey])
    ? history.bySource[sourceKey]
    : [];
  const normalizedCapturedAt = normalizeString(entry?.capturedAt);
  const deduped = currentEntries.filter(
    (item) => normalizeString(item?.capturedAt) !== normalizedCapturedAt
  );
  deduped.push(entry);
  history.bySource[sourceKey] = sortHistoryEntriesNewestFirst(deduped).slice(0, 50);
}

function averageCoverageByField(entries, requiredFields) {
  const averages = {};
  const fields = Array.isArray(requiredFields) ? requiredFields : [];
  const rows = Array.isArray(entries) ? entries : [];

  for (const field of fields) {
    const ratios = rows
      .map((entry) => normalizeCoverageRatio(entry?.coverageByField?.[field]))
      .filter((ratio) => ratio !== null);
    if (ratios.length === 0) {
      averages[field] = null;
      continue;
    }
    const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
    averages[field] = Math.round((total / ratios.length) * 1000) / 1000;
  }

  return averages;
}

export function evaluateSourceContractDrift(options = {}) {
  const sourcesPath = options.sourcesPath || "config/sources.json";
  const contractsPath = options.contractsPath || "config/source-contracts.json";
  const windowSize =
    Number.isInteger(Number(options.window)) && Number(options.window) > 0
      ? Math.round(Number(options.window))
      : 3;
  const minCoverageRaw = Number(options.minCoverage);
  const minCoverage =
    Number.isFinite(minCoverageRaw) && minCoverageRaw >= 0 && minCoverageRaw <= 1
      ? Math.round(minCoverageRaw * 1000) / 1000
      : 0.7;
  const staleAfterDays =
    Number.isFinite(Number(options.staleAfterDays)) && Number(options.staleAfterDays) > 0
      ? Math.round(Number(options.staleAfterDays))
      : 30;
  const historyPath = resolveQualityHistoryPath(options.historyPath, sourcesPath);
  const persistHistory = options.persistHistory !== false;
  const includeDisabled = options.includeDisabled === true;

  const contracts = loadSourceContracts(contractsPath);
  const sources = loadSourcesWithPath(sourcesPath).sources.filter(
    (source) => includeDisabled || source?.enabled !== false
  );
  const history = loadCoverageHistory(historyPath);
  const rows = [];

  for (const source of sources) {
    const contract = contracts.byType.get(source.type) || null;
    const capture = readSourceCaptureSummary(source);
    const jobs = Array.isArray(capture?.payload?.jobs) ? capture.payload.jobs : [];

    if (!contract) {
      rows.push({
        sourceId: source.id,
        sourceType: source.type,
        contractVersion: null,
        stale: true,
        status: "error",
        sampleSize: jobs.length,
        coverageByField: {},
        latestCoverageByField: {},
        rollingCoverageByField: {},
        rollingSamplesUsed: 0,
        rollingWindow: windowSize,
        minCoverage,
        passCoverageGate: false,
        issues: [`Missing contract for source type "${source.type}".`]
      });
      continue;
    }

    const coverageByField = computeCoverageByField(jobs, contract.extraction.requiredFields);
    const capturedAt = normalizeString(capture?.capturedAt || capture?.payload?.capturedAt);
    if (persistHistory && capturedAt) {
      upsertCoverageHistoryEntry(history, source.id, {
        capturedAt,
        sourceType: source.type,
        contractVersion: contract.contractVersion,
        sampleSize: jobs.length,
        coverageByField
      });
    }

    const sourceHistory = Array.isArray(history.bySource?.[source.id])
      ? history.bySource[source.id].filter((entry) => {
          const entrySourceType = normalizeString(entry?.sourceType);
          const entryContractVersion = normalizeString(entry?.contractVersion);
          const currentContractVersion = normalizeString(contract.contractVersion);
          return (
            entrySourceType === source.type &&
            entryContractVersion === currentContractVersion
          );
        })
      : [];
    const freshHistory = filterFreshHistoryEntries(sourceHistory, staleAfterDays);
    const rollingEntries = sortHistoryEntriesNewestFirst(freshHistory).slice(0, windowSize);
    const rollingCoverageByField = averageCoverageByField(
      rollingEntries,
      contract.extraction.requiredFields
    );

    const stale = isDateOlderThanDays(contract.lastVerified, staleAfterDays);
    const lowCoverageFields = Object.entries(rollingCoverageByField)
      .filter(([, ratio]) => ratio !== null && Number.isFinite(Number(ratio)) && Number(ratio) < minCoverage)
      .map(([field]) => field);
    const hasRollingCoverage = Object.values(rollingCoverageByField).some(
      (ratio) => ratio !== null && Number.isFinite(Number(ratio))
    );
    const passCoverageGate = !hasRollingCoverage || lowCoverageFields.length === 0;
    const issues = [];
    if (stale) {
      issues.push(
        `Contract lastVerified ${contract.lastVerified || "unknown"} exceeds ${staleAfterDays} days.`
      );
    }
    if (lowCoverageFields.length > 0) {
      issues.push(
        `Rolling coverage below ${(minCoverage * 100).toFixed(0)}% for: ${lowCoverageFields.join(", ")}.`
      );
    }

    const status =
      issues.length === 0
        ? "ok"
        : lowCoverageFields.length > 0
          ? "error"
          : "warning";

    rows.push({
      sourceId: source.id,
      sourceType: source.type,
      contractVersion: contract.contractVersion,
      stale,
      status,
      sampleSize: jobs.length,
      coverageByField,
      latestCoverageByField: coverageByField,
      rollingCoverageByField,
      rollingSamplesUsed: rollingEntries.length,
      rollingWindow: windowSize,
      minCoverage,
      passCoverageGate,
      issues
    });
  }

  if (persistHistory) {
    saveCoverageHistory(history);
  }

  return {
    contractsPath: contracts.path,
    sourcesPath: path.resolve(String(sourcesPath || "config/sources.json")),
    historyPath,
    window: windowSize,
    minCoverage,
    includeDisabled,
    staleAfterDays,
    rows
  };
}
