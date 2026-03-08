import fs from "node:fs";
import path from "node:path";

import { readSourceCaptureSummary } from "./cache-policy.js";
import { evaluateCaptureRun } from "./capture-validation.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric < 0 || numeric > 1) {
    return null;
  }

  return Math.round(numeric * 1000) / 1000;
}

function toPositiveInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.round(numeric);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const output = [];
  for (const entry of value) {
    const normalized = normalizeText(entry);
    if (normalized && !output.includes(normalized)) {
      output.push(normalized);
    }
  }
  return output;
}

function isPresent(value) {
  const normalized = normalizeText(value);
  return normalized !== "" && normalized.toLowerCase() !== "unknown";
}

function computeCoverageForField(jobs, fieldName) {
  const rows = Array.isArray(jobs) ? jobs : [];
  if (rows.length === 0) {
    return null;
  }

  let presentCount = 0;
  for (const job of rows) {
    if (isPresent(job?.[fieldName])) {
      presentCount += 1;
    }
  }

  return Math.round((presentCount / rows.length) * 1000) / 1000;
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }

  return `${Math.round(numeric * 100)}%`;
}

function normalizeCheck(rawCheck = {}) {
  const kind = normalizeText(rawCheck.kind);

  if (kind === "min_samples") {
    return {
      kind,
      min: toPositiveInt(rawCheck.min) ?? 1
    };
  }

  if (kind === "required_coverage") {
    return {
      kind,
      min: toRatio(rawCheck.min) ?? 0.7,
      fields: normalizeStringArray(rawCheck.fields).length
        ? normalizeStringArray(rawCheck.fields)
        : ["title", "company", "url"]
    };
  }

  if (kind === "max_unknown_rate") {
    return {
      kind,
      max: toRatio(rawCheck.max) ?? 1,
      fields: normalizeStringArray(rawCheck.fields).length
        ? normalizeStringArray(rawCheck.fields)
        : ["location", "postedAt", "salaryText", "employmentType"]
    };
  }

  if (kind === "min_url_validity") {
    return {
      kind,
      min: toRatio(rawCheck.min) ?? 0.7
    };
  }

  if (kind === "min_unique_ratio") {
    return {
      kind,
      min: toRatio(rawCheck.min) ?? 0.4
    };
  }

  return null;
}

function normalizeCanary(rawCanary = {}, index = 0) {
  const sourceType = normalizeText(rawCanary.sourceType);
  const sourceId = normalizeText(rawCanary.sourceId);
  if (!sourceType && !sourceId) {
    throw new Error(
      `source-canaries.canaries[${index}] must include sourceType or sourceId`
    );
  }

  const checks = (Array.isArray(rawCanary.checks) ? rawCanary.checks : [])
    .map((check) => normalizeCheck(check))
    .filter(Boolean);

  return {
    id: normalizeText(rawCanary.id) || `${sourceType || sourceId}-canary-${index + 1}`,
    sourceType: sourceType || null,
    sourceId: sourceId || null,
    enabled: rawCanary.enabled !== false,
    checks
  };
}

export function loadSourceCanaries(canariesPath = "config/source-canaries.json") {
  const resolvedPath = path.resolve(String(canariesPath || "config/source-canaries.json"));
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Missing source canaries file: ${resolvedPath}`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${resolvedPath}: ${error.message}`);
  }

  const canaries = (Array.isArray(raw?.canaries) ? raw.canaries : []).map((canary, index) =>
    normalizeCanary(canary, index)
  );

  const bySourceType = new Map();
  const bySourceId = new Map();

  for (const canary of canaries) {
    if (!canary.enabled) {
      continue;
    }

    if (canary.sourceType && !bySourceType.has(canary.sourceType)) {
      bySourceType.set(canary.sourceType, canary);
    }

    if (canary.sourceId && !bySourceId.has(canary.sourceId)) {
      bySourceId.set(canary.sourceId, canary);
    }
  }

  return {
    path: resolvedPath,
    version: normalizeText(raw?.version) || "1.0.0",
    canaries,
    bySourceType,
    bySourceId
  };
}

function resolveCanaryForSource(source, canaries) {
  if (!source || !canaries) {
    return null;
  }

  if (canaries.bySourceId instanceof Map) {
    const byId = canaries.bySourceId.get(source.id);
    if (byId) {
      return byId;
    }
  }

  if (canaries.bySourceType instanceof Map) {
    const byType = canaries.bySourceType.get(source.type);
    if (byType) {
      return byType;
    }
  }

  return null;
}

function evaluateCanaryCheck(check, payload, captureEvaluation) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const sampleSize = jobs.length;
  const metrics = captureEvaluation?.metrics || {};

  if (check.kind === "min_samples") {
    const pass = sampleSize >= check.min;
    return {
      kind: check.kind,
      pass,
      message: pass
        ? `sample size ${sampleSize} >= ${check.min}`
        : `sample size ${sampleSize} < ${check.min}`
    };
  }

  if (check.kind === "required_coverage") {
    const failedFields = [];
    const fieldDetails = [];

    for (const field of check.fields) {
      const metricCoverage =
        field === "title" || field === "company" || field === "url"
          ? metrics.requiredCoverage?.[field]
          : computeCoverageForField(jobs, field);
      const coverage = toRatio(metricCoverage);
      fieldDetails.push(`${field}=${formatPercent(coverage)}`);
      if (coverage === null || coverage < check.min) {
        failedFields.push(field);
      }
    }

    const pass = failedFields.length === 0;
    return {
      kind: check.kind,
      pass,
      message: pass
        ? `required coverage pass (${fieldDetails.join(", ")})`
        : `required coverage fail (${fieldDetails.join(", ")}); below threshold for ${failedFields.join(", ")}`
    };
  }

  if (check.kind === "max_unknown_rate") {
    const failedFields = [];
    const details = [];

    for (const field of check.fields) {
      const metricUnknown = metrics.optionalUnknownRates?.[field];
      const coverage =
        metricUnknown !== undefined && metricUnknown !== null
          ? toRatio(1 - Number(metricUnknown))
          : computeCoverageForField(jobs, field);
      const unknownRate = coverage === null ? null : toRatio(1 - coverage);
      details.push(`${field}=${formatPercent(unknownRate)}`);
      if (unknownRate === null || unknownRate > check.max) {
        failedFields.push(field);
      }
    }

    const pass = failedFields.length === 0;
    return {
      kind: check.kind,
      pass,
      message: pass
        ? `unknown-rate check pass (${details.join(", ")})`
        : `unknown-rate check fail (${details.join(", ")}); above threshold for ${failedFields.join(", ")}`
    };
  }

  if (check.kind === "min_url_validity") {
    const ratio = toRatio(metrics.urlValidityRatio);
    const pass = ratio !== null && ratio >= check.min;
    return {
      kind: check.kind,
      pass,
      message: pass
        ? `url validity ${formatPercent(ratio)} >= ${formatPercent(check.min)}`
        : `url validity ${formatPercent(ratio)} < ${formatPercent(check.min)}`
    };
  }

  if (check.kind === "min_unique_ratio") {
    const ratio = toRatio(metrics.uniqueJobRatio);
    const pass = ratio !== null && ratio >= check.min;
    return {
      kind: check.kind,
      pass,
      message: pass
        ? `unique ratio ${formatPercent(ratio)} >= ${formatPercent(check.min)}`
        : `unique ratio ${formatPercent(ratio)} < ${formatPercent(check.min)}`
    };
  }

  return {
    kind: check.kind,
    pass: true,
    message: `unsupported canary check kind "${check.kind}" ignored`
  };
}

export function evaluateSourceCanaries(source, options = {}) {
  const canaries = options.canaries || loadSourceCanaries(options.canariesPath);
  const canary = resolveCanaryForSource(source, canaries);

  if (!canary) {
    return {
      sourceId: source?.id || null,
      sourceType: source?.type || null,
      canaryId: null,
      status: "skipped",
      checks: [],
      reasons: ["no canary configured for source"]
    };
  }

  const payload =
    options.payload || readSourceCaptureSummary(source)?.payload || { jobs: [] };
  const captureEvaluation = evaluateCaptureRun(source, payload, {
    baselineCount: payload?.expectedCount
  });
  const checks = canary.checks.map((check) =>
    evaluateCanaryCheck(check, payload, captureEvaluation)
  );
  const failedChecks = checks.filter((check) => check.pass === false);

  return {
    sourceId: source?.id || null,
    sourceType: source?.type || null,
    canaryId: canary.id,
    status: failedChecks.length === 0 ? "pass" : "fail",
    checks,
    reasons: failedChecks.map((check) => check.message),
    payload,
    captureEvaluation
  };
}

function sanitizeFileToken(value, fallback = "unknown") {
  const normalized = normalizeText(value)
    .replace(/[:.]/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  return normalized || fallback;
}

export function writeSourceCanaryDiagnostics(report, options = {}) {
  const rootDir = path.resolve(options.rootDir || "data/quality/canary-checks");
  fs.mkdirSync(rootDir, { recursive: true });

  const generatedAt = normalizeText(report?.generatedAt) || new Date().toISOString();
  const token = sanitizeFileToken(generatedAt, new Date().toISOString());
  const timestampedPath = path.join(rootDir, `${token}.json`);
  const latestPath = path.join(rootDir, "latest.json");

  const payload = {
    generatedAt,
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
