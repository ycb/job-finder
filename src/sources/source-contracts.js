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

const FULL_JOB_DESCRIPTION_MODES = new Set([
  "unknown",
  "none",
  "partial",
  "full"
]);

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

function normalizeCriteriaFieldArray(value, label) {
  const output = normalizeStringArray(value);
  for (const field of output) {
    if (!CRITERIA_FIELDS.includes(field)) {
      throw new Error(
        `${label} includes unsupported criteria field "${field}". Supported fields: ${CRITERIA_FIELDS.join(", ")}.`
      );
    }
  }
  return output;
}

function buildUnsupportedCriteriaFields(supportedFields) {
  const supportedSet = new Set(supportedFields);
  return CRITERIA_FIELDS.filter((field) => !supportedSet.has(field));
}

function ensureNoOverlap(fieldGroups, label) {
  const seen = new Map();
  for (const [groupName, fields] of fieldGroups) {
    for (const field of fields) {
      const previous = seen.get(field);
      if (previous) {
        throw new Error(
          `${label} field "${field}" appears in both "${previous}" and "${groupName}".`
        );
      }
      seen.set(field, groupName);
    }
  }
}

function normalizeSearchParameterShape(rawShape, criteriaMapping, label) {
  const safeShape =
    rawShape && typeof rawShape === "object" && !Array.isArray(rawShape)
      ? rawShape
      : {};
  const supportedFromMapping = CRITERIA_FIELDS.filter(
    (field) => criteriaMapping[field] !== "unsupported"
  );
  const supportedProvided = normalizeCriteriaFieldArray(
    safeShape.supported,
    `${label}.supported`
  );
  const required = normalizeCriteriaFieldArray(
    safeShape.required,
    `${label}.required`
  );
  const optional = normalizeCriteriaFieldArray(
    safeShape.optional,
    `${label}.optional`
  );
  const uiDrivenOnly = normalizeCriteriaFieldArray(
    safeShape.uiDrivenOnly,
    `${label}.uiDrivenOnly`
  );

  ensureNoOverlap(
    [
      ["required", required],
      ["optional", optional],
      ["uiDrivenOnly", uiDrivenOnly]
    ],
    label
  );

  const union = normalizeStringArray([...required, ...optional, ...uiDrivenOnly]);
  const supported = supportedProvided.length > 0 ? supportedProvided : union.length > 0 ? union : supportedFromMapping;
  const supportedSet = new Set(supported);
  const unionSet = new Set(union);

  if (supportedProvided.length > 0) {
    const mismatch = supported.some((field) => !unionSet.has(field)) || union.some((field) => !supportedSet.has(field));
    if (mismatch) {
      throw new Error(
        `${label}.supported must exactly match required + optional + uiDrivenOnly.`
      );
    }
  }

  for (const field of union) {
    if (!supportedSet.has(field)) {
      throw new Error(`${label} field "${field}" must be listed in supported.`);
    }
  }

  for (const field of CRITERIA_FIELDS) {
    const mode = criteriaMapping[field];
    const isSupported = supportedSet.has(field);
    if (mode === "unsupported" && isSupported) {
      throw new Error(
        `${label} marks "${field}" as supported but criteriaMapping.${field} is unsupported.`
      );
    }
    if (mode !== "unsupported" && !isSupported) {
      throw new Error(
        `${label} must include "${field}" in supported because criteriaMapping.${field} is "${mode}".`
      );
    }
  }

  for (const field of uiDrivenOnly) {
    if (criteriaMapping[field] !== "ui_bootstrap") {
      throw new Error(
        `${label}.uiDrivenOnly field "${field}" requires criteriaMapping.${field}="ui_bootstrap".`
      );
    }
  }

  return {
    supported,
    required,
    optional,
    uiDrivenOnly,
    unsupported: buildUnsupportedCriteriaFields(supported)
  };
}

function normalizeFieldThresholdMap(value, label, requiredMetadata) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const requiredSet = new Set(requiredMetadata);
  const output = {};
  for (const [field, rawRatio] of Object.entries(value)) {
    const normalizedField = normalizeString(field);
    if (!normalizedField) {
      continue;
    }
    if (!requiredSet.has(normalizedField)) {
      throw new Error(
        `${label}.${normalizedField} must reference a requiredMetadata field.`
      );
    }
    const ratio = Number(rawRatio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      throw new Error(`${label}.${normalizedField} must be a number between 0 and 1.`);
    }
    output[normalizedField] = Math.round(ratio * 1000) / 1000;
  }
  return output;
}

function normalizeExtractionShape(rawExtraction, label) {
  const extraction =
    rawExtraction && typeof rawExtraction === "object" && !Array.isArray(rawExtraction)
      ? rawExtraction
      : {};
  const requiredMetadata = normalizeStringArray(
    extraction.requiredMetadata || extraction.requiredFields
  );
  const optionalMetadata = normalizeStringArray(
    extraction.optionalMetadata || extraction.optionalFields
  );

  ensureNoOverlap(
    [
      ["requiredMetadata", requiredMetadata],
      ["optionalMetadata", optionalMetadata]
    ],
    label
  );

  const fullJobDescription = normalizeString(extraction.fullJobDescription, "unknown");
  if (!FULL_JOB_DESCRIPTION_MODES.has(fullJobDescription)) {
    throw new Error(
      `${label}.fullJobDescription must be one of: ${Array.from(FULL_JOB_DESCRIPTION_MODES).join(", ")}.`
    );
  }

  const qualityThresholdsRaw =
    extraction.qualityThresholds &&
    typeof extraction.qualityThresholds === "object" &&
    !Array.isArray(extraction.qualityThresholds)
      ? extraction.qualityThresholds
      : {};
  const rollingMinCoverageRaw = qualityThresholdsRaw.rollingMinCoverage;
  const rollingMinCoverage =
    Number.isFinite(Number(rollingMinCoverageRaw)) &&
    Number(rollingMinCoverageRaw) >= 0 &&
    Number(rollingMinCoverageRaw) <= 1
      ? Math.round(Number(rollingMinCoverageRaw) * 1000) / 1000
      : null;
  const minSampleSizeRaw = qualityThresholdsRaw.minSampleSize;
  const minSampleSize =
    Number.isFinite(Number(minSampleSizeRaw)) && Number(minSampleSizeRaw) >= 0
      ? Math.round(Number(minSampleSizeRaw))
      : 0;
  const minCoverageByField = normalizeFieldThresholdMap(
    qualityThresholdsRaw.minCoverageByField,
    `${label}.qualityThresholds.minCoverageByField`,
    requiredMetadata
  );
  const detailDescriptionMinCoverage = normalizeCoverageRatio(
    qualityThresholdsRaw.detailDescriptionMinCoverage
  );

  return {
    requiredMetadata,
    optionalMetadata,
    requiredFields: requiredMetadata,
    optionalFields: optionalMetadata,
    fullJobDescription,
    qualityThresholds: {
      rollingMinCoverage,
      minSampleSize,
      minCoverageByField,
      detailDescriptionMinCoverage
    }
  };
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

  const searchParameterShape = normalizeSearchParameterShape(
    rawContract.searchParameterShape,
    criteriaMapping,
    `${label}.searchParameterShape`
  );
  const extractionShape = normalizeExtractionShape(
    rawContract.extractionShape || rawContract.extraction,
    `${label}.extraction`
  );
  const sourceId = normalizeString(rawContract.sourceId) || null;

  return {
    sourceType,
    sourceId,
    contractVersion: normalizeString(rawContract.contractVersion, "1.0.0"),
    lastVerified: normalizeString(rawContract.lastVerified),
    criteriaMapping,
    searchParameterShape,
    extraction: extractionShape,
    extractionShape,
    expectedCountStrategy: normalizeString(rawContract.expectedCountStrategy, "none"),
    paginationStrategy: normalizeString(rawContract.paginationStrategy, "unknown")
  };
}

function buildSourceContractKey(sourceType, sourceId) {
  return `${normalizeString(sourceType)}::${normalizeString(sourceId)}`;
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
  const bySourceKey = new Map();
  for (const contract of normalizedContracts) {
    if (contract.sourceId) {
      const key = buildSourceContractKey(contract.sourceType, contract.sourceId);
      if (bySourceKey.has(key)) {
        throw new Error(
          `Duplicate source contract for type "${contract.sourceType}" and sourceId "${contract.sourceId}" in ${resolvedPath}.`
        );
      }
      bySourceKey.set(key, contract);
      continue;
    }

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
    byType,
    bySourceKey
  };
}

export function resolveSourceContract(contracts, source) {
  if (!contracts || !(contracts.byType instanceof Map)) {
    return null;
  }
  const sourceType = normalizeString(source?.type);
  const sourceId = normalizeString(source?.id);
  if (sourceType && sourceId && contracts.bySourceKey instanceof Map) {
    const specific = contracts.bySourceKey.get(
      buildSourceContractKey(sourceType, sourceId)
    );
    if (specific) {
      return specific;
    }
  }
  return contracts.byType.get(sourceType) || null;
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

function parseStructuredMeta(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeDescriptionSource(value) {
  const source = normalizeString(value).toLowerCase();
  if (source === "detail" || source === "card" || source === "fallback_unknown") {
    return source;
  }
  return "";
}

function resolveDescriptionSource(job) {
  if (!job || typeof job !== "object") {
    return "";
  }

  const direct = normalizeDescriptionSource(job.descriptionSource || job.description_source);
  if (direct) {
    return direct;
  }

  const extractorProvenance =
    job.extractorProvenance &&
    typeof job.extractorProvenance === "object" &&
    !Array.isArray(job.extractorProvenance)
      ? job.extractorProvenance
      : null;
  const provenanceSource = normalizeDescriptionSource(extractorProvenance?.description);
  if (provenanceSource) {
    return provenanceSource;
  }

  const structuredMeta = parseStructuredMeta(job.structuredMeta || job.structured_meta);
  const structuredSource = normalizeDescriptionSource(
    structuredMeta?.descriptionSource || structuredMeta?.extractorProvenance?.description
  );
  if (structuredSource) {
    return structuredSource;
  }

  return "";
}

function sanitizeFileToken(value, fallback = "unknown") {
  const normalized = normalizeString(value)
    .replace(/[:.]/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  return normalized || fallback;
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

function computeDetailDescriptionCoverage(jobs) {
  const samples = Array.isArray(jobs) ? jobs : [];
  if (samples.length === 0) {
    return {
      coverage: null,
      sampleSize: 0,
      detailCount: 0
    };
  }

  let sampleSize = 0;
  let detailCount = 0;

  for (const job of samples) {
    const description = extractJobFieldValue(job, "description");
    if (!description || description.toLowerCase() === "unknown") {
      continue;
    }

    const descriptionSource = resolveDescriptionSource(job);
    if (!descriptionSource) {
      continue;
    }

    sampleSize += 1;
    if (descriptionSource === "detail") {
      detailCount += 1;
    }
  }

  if (sampleSize === 0) {
    return {
      coverage: null,
      sampleSize: 0,
      detailCount: 0
    };
  }

  return {
    coverage: Math.round((detailCount / sampleSize) * 1000) / 1000,
    sampleSize,
    detailCount
  };
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

function averageCoverageValue(entries, key) {
  const rows = Array.isArray(entries) ? entries : [];
  const ratios = rows
    .map((entry) => normalizeCoverageRatio(entry?.[key]))
    .filter((ratio) => ratio !== null);
  if (ratios.length === 0) {
    return null;
  }
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  return Math.round((total / ratios.length) * 1000) / 1000;
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
      : 0.9;
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
    const contract = resolveSourceContract(contracts, source);
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
        passRequiredCoverageGate: false,
        passCoverageGate: false,
        detailDescriptionCoverage: null,
        detailDescriptionSampleSize: 0,
        detailDescriptionCount: 0,
        rollingDetailDescriptionCoverage: null,
        rollingDetailDescriptionSampleSize: 0,
        detailDescriptionMinCoverage: minCoverage,
        passDetailCoverageGate: false,
        detailCoverageMismatch: null,
        coverageMismatches: [],
        issues: [`Missing contract for source type "${source.type}".`]
      });
      continue;
    }

    const coverageByField = computeCoverageByField(jobs, contract.extraction.requiredFields);
    const detailDescriptionCoverage = computeDetailDescriptionCoverage(jobs);
    const capturedAt = normalizeString(capture?.capturedAt || capture?.payload?.capturedAt);
    if (persistHistory && capturedAt) {
      upsertCoverageHistoryEntry(history, source.id, {
        capturedAt,
        sourceType: source.type,
        contractVersion: contract.contractVersion,
        sampleSize: jobs.length,
        coverageByField,
        detailDescriptionCoverage: detailDescriptionCoverage.coverage,
        detailDescriptionSampleSize: detailDescriptionCoverage.sampleSize
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
    const rollingDetailDescriptionCoverage = averageCoverageValue(
      rollingEntries,
      "detailDescriptionCoverage"
    );
    const rollingDetailDescriptionSampleSize = rollingEntries.reduce((sum, entry) => {
      const sampleSize = Number(entry?.detailDescriptionSampleSize);
      if (!Number.isFinite(sampleSize) || sampleSize < 0) {
        return sum;
      }
      return sum + Math.round(sampleSize);
    }, 0);

    const stale = isDateOlderThanDays(contract.lastVerified, staleAfterDays);
    const fieldThresholds =
      contract?.extraction?.qualityThresholds?.minCoverageByField &&
      typeof contract.extraction.qualityThresholds.minCoverageByField === "object"
        ? contract.extraction.qualityThresholds.minCoverageByField
        : {};
    const configuredCoverageGateFloor = normalizeCoverageRatio(
      contract?.extraction?.qualityThresholds?.rollingMinCoverage
    );
    const coverageGateFloor =
      configuredCoverageGateFloor !== null ? configuredCoverageGateFloor : minCoverage;
    const coverageMismatches = [];
    for (const field of contract.extraction.requiredFields) {
      const rollingCoverage = normalizeCoverageRatio(rollingCoverageByField[field]);
      if (rollingCoverage === null) {
        continue;
      }
      const configuredFieldThreshold = normalizeCoverageRatio(fieldThresholds[field]);
      const threshold =
        configuredFieldThreshold !== null ? configuredFieldThreshold : coverageGateFloor;
      if (rollingCoverage < threshold) {
        coverageMismatches.push({
          field,
          rollingCoverage,
          latestCoverage: normalizeCoverageRatio(coverageByField[field]),
          threshold,
          thresholdSource: configuredFieldThreshold !== null ? "field" : "default"
        });
      }
    }
    const lowCoverageFields = coverageMismatches.map((mismatch) => mismatch.field);
    const hasRollingCoverage = Object.values(rollingCoverageByField).some(
      (ratio) => ratio !== null && Number.isFinite(Number(ratio))
    );
    const passRequiredCoverageGate =
      !hasRollingCoverage || lowCoverageFields.length === 0;

    const configuredDetailCoverageGateFloor = normalizeCoverageRatio(
      contract?.extraction?.qualityThresholds?.detailDescriptionMinCoverage
    );
    const detailCoverageGateFloor =
      configuredDetailCoverageGateFloor !== null
        ? configuredDetailCoverageGateFloor
        : coverageGateFloor;
    const hasRollingDetailCoverage =
      rollingDetailDescriptionCoverage !== null &&
      Number.isFinite(Number(rollingDetailDescriptionCoverage));
    const detailCoverageMismatch = hasRollingDetailCoverage &&
      rollingDetailDescriptionCoverage < detailCoverageGateFloor
      ? {
          rollingCoverage: rollingDetailDescriptionCoverage,
          latestCoverage: detailDescriptionCoverage.coverage,
          threshold: detailCoverageGateFloor
        }
      : null;
    const passDetailCoverageGate =
      !hasRollingDetailCoverage || detailCoverageMismatch === null;
    const passCoverageGate = passRequiredCoverageGate && passDetailCoverageGate;
    const issues = [];
    if (stale) {
      issues.push(
        `Contract lastVerified ${contract.lastVerified || "unknown"} exceeds ${staleAfterDays} days.`
      );
    }
    if (lowCoverageFields.length > 0) {
      issues.push(
        `Rolling coverage below configured threshold(s) for: ${lowCoverageFields.join(", ")}.`
      );
    }
    if (detailCoverageMismatch) {
      issues.push(
        `Rolling detail-description coverage below threshold (${Math.round(
          detailCoverageMismatch.rollingCoverage * 100
        )}% < ${Math.round(detailCoverageMismatch.threshold * 100)}%).`
      );
    }

    const status =
      issues.length === 0
        ? "ok"
        : lowCoverageFields.length > 0 || Boolean(detailCoverageMismatch)
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
      passRequiredCoverageGate,
      passCoverageGate,
      detailDescriptionCoverage: detailDescriptionCoverage.coverage,
      detailDescriptionSampleSize: detailDescriptionCoverage.sampleSize,
      detailDescriptionCount: detailDescriptionCoverage.detailCount,
      rollingDetailDescriptionCoverage,
      rollingDetailDescriptionSampleSize,
      detailDescriptionMinCoverage: detailCoverageGateFloor,
      passDetailCoverageGate,
      detailCoverageMismatch,
      coverageMismatches,
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

function resolveContractDiagnosticsRootDir(rootDir, sourcesPath) {
  const explicit = normalizeString(rootDir);
  if (explicit) {
    return path.resolve(explicit);
  }

  const resolvedSourcesPath = path.resolve(String(sourcesPath || "config/sources.json"));
  return path.resolve(path.dirname(path.dirname(resolvedSourcesPath)), "data", "quality", "contract-drift");
}

export function writeSourceContractDiagnostics(report, options = {}) {
  const rootDir = resolveContractDiagnosticsRootDir(options.rootDir, report?.sourcesPath);
  fs.mkdirSync(rootDir, { recursive: true });

  const generatedAt = normalizeString(report?.generatedAt) || new Date().toISOString();
  const token = sanitizeFileToken(generatedAt, new Date().toISOString());
  const timestampedPath = path.join(rootDir, `${token}.json`);
  const latestPath = path.join(rootDir, "latest.json");

  const payload = {
    generatedAt,
    contractsPath: normalizeString(report?.contractsPath),
    sourcesPath: normalizeString(report?.sourcesPath),
    historyPath: normalizeString(report?.historyPath),
    window:
      Number.isInteger(Number(report?.window)) && Number(report.window) > 0
        ? Math.round(Number(report.window))
        : null,
    minCoverage: normalizeCoverageRatio(report?.minCoverage),
    staleAfterDays:
      Number.isInteger(Number(report?.staleAfterDays)) && Number(report.staleAfterDays) > 0
        ? Math.round(Number(report.staleAfterDays))
        : null,
    rows: Array.isArray(report?.rows) ? report.rows : []
  };

  fs.writeFileSync(timestampedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    rootDir,
    timestampedPath,
    latestPath
  };
}

export function runSourceContractDiagnostics(options = {}) {
  const report = evaluateSourceContractDrift(options);
  const diagnostics = writeSourceContractDiagnostics(
    {
      ...report,
      generatedAt: new Date().toISOString()
    },
    {
      rootDir: options.rootDir
    }
  );

  return {
    ...report,
    diagnostics
  };
}
