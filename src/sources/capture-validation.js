import fs from "node:fs";
import path from "node:path";

const DEFAULT_THRESHOLDS = {
  minExpectedForBaseline: 10,
  minBaselineRatio: 0.15,
  minRequiredCoverageReject: 0.2,
  minRequiredCoverageQuarantine: 0.6,
  minUrlValidityRatio: 0.7,
  minUniqueJobRatio: 0.4,
  minSampleForDuplicateCheck: 8,
  severeUnknownRate: 0.98
};

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isPresentValue(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  return normalized.toLowerCase() !== "unknown";
}

function isLikelyHttpUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toRoundedRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric < 0) {
    return 0;
  }

  return Math.min(1, Math.round(numeric * 1000) / 1000);
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function computePresenceCoverage(jobs, fieldName) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return null;
  }

  let presentCount = 0;
  for (const job of jobs) {
    if (isPresentValue(job?.[fieldName])) {
      presentCount += 1;
    }
  }

  return toRoundedRatio(presentCount / jobs.length);
}

function computeUnknownRate(jobs, fieldName) {
  const coverage = computePresenceCoverage(jobs, fieldName);
  if (coverage === null) {
    return null;
  }
  return toRoundedRatio(1 - coverage);
}

function computeUniqueJobRatio(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return null;
  }

  const uniqueKeys = new Set();
  for (const job of jobs) {
    const key = normalizeText(job?.url).toLowerCase() || [
      normalizeText(job?.title).toLowerCase(),
      normalizeText(job?.company).toLowerCase(),
      normalizeText(job?.location).toLowerCase()
    ].join("|");

    if (key) {
      uniqueKeys.add(key);
    }
  }

  if (uniqueKeys.size === 0) {
    return null;
  }

  return toRoundedRatio(uniqueKeys.size / jobs.length);
}

function computeUrlValidityRatio(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return null;
  }

  let validUrls = 0;
  for (const job of jobs) {
    if (isLikelyHttpUrl(job?.url)) {
      validUrls += 1;
    }
  }

  return toRoundedRatio(validUrls / jobs.length);
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }

  return `${Math.round(numeric * 100)}%`;
}

function pushReason(reasonDetails, code, message) {
  reasonDetails.push({
    code: normalizeText(code) || "unknown_reason",
    message: normalizeText(message)
  });
}

function buildReasonResult(outcome, reasonDetails) {
  return {
    outcome,
    reasonDetails,
    reasons: reasonDetails.map((reason) => reason.message).filter(Boolean)
  };
}

function getEmptyMetrics() {
  return {
    sampleSize: 0,
    baselineCount: null,
    baselineRatio: null,
    uniqueJobRatio: null,
    urlValidityRatio: null,
    requiredCoverage: {
      title: null,
      company: null,
      url: null
    },
    optionalUnknownRates: {
      location: null,
      postedAt: null,
      salaryText: null,
      employmentType: null
    }
  };
}

function evaluateOutcome(metrics, thresholds) {
  const rejectReasonDetails = [];
  const quarantineReasonDetails = [];

  if (metrics.requiredCoverage.title !== null && metrics.requiredCoverage.title < thresholds.minRequiredCoverageReject) {
    pushReason(
      rejectReasonDetails,
      "required_coverage_title_low",
      `required field coverage too low: title ${formatPercent(metrics.requiredCoverage.title)} < ${formatPercent(thresholds.minRequiredCoverageReject)}`
    );
  }

  if (metrics.requiredCoverage.company !== null && metrics.requiredCoverage.company < thresholds.minRequiredCoverageReject) {
    pushReason(
      rejectReasonDetails,
      "required_coverage_company_low",
      `required field coverage too low: company ${formatPercent(metrics.requiredCoverage.company)} < ${formatPercent(thresholds.minRequiredCoverageReject)}`
    );
  }

  if (metrics.requiredCoverage.url !== null && metrics.requiredCoverage.url < thresholds.minRequiredCoverageReject) {
    pushReason(
      rejectReasonDetails,
      "required_coverage_url_low",
      `required field coverage too low: url ${formatPercent(metrics.requiredCoverage.url)} < ${formatPercent(thresholds.minRequiredCoverageReject)}`
    );
  }

  if (rejectReasonDetails.length === 0) {
    if (
      metrics.baselineCount !== null &&
      metrics.baselineCount >= thresholds.minExpectedForBaseline &&
      metrics.baselineRatio !== null &&
      metrics.baselineRatio < thresholds.minBaselineRatio
    ) {
      pushReason(
        quarantineReasonDetails,
        "baseline_volume_low",
        `capture volume below baseline: ${metrics.sampleSize}/${metrics.baselineCount} (${formatPercent(metrics.baselineRatio)}) < ${formatPercent(thresholds.minBaselineRatio)}`
      );
    }

    if (
      metrics.sampleSize >= thresholds.minSampleForDuplicateCheck &&
      metrics.uniqueJobRatio !== null &&
      metrics.uniqueJobRatio < thresholds.minUniqueJobRatio
    ) {
      pushReason(
        quarantineReasonDetails,
        "duplicate_ratio_low",
        `duplicate inflation detected: unique ratio ${formatPercent(metrics.uniqueJobRatio)} < ${formatPercent(thresholds.minUniqueJobRatio)}`
      );
    }

    if (
      metrics.urlValidityRatio !== null &&
      metrics.urlValidityRatio < thresholds.minUrlValidityRatio
    ) {
      pushReason(
        quarantineReasonDetails,
        "url_validity_low",
        `invalid URL rate too high: valid ratio ${formatPercent(metrics.urlValidityRatio)} < ${formatPercent(thresholds.minUrlValidityRatio)}`
      );
    }

    for (const [fieldName, coverage] of Object.entries(metrics.requiredCoverage)) {
      if (
        coverage !== null &&
        coverage < thresholds.minRequiredCoverageQuarantine
      ) {
        pushReason(
          quarantineReasonDetails,
          `required_coverage_${fieldName}_degraded`,
          `required field coverage degraded: ${fieldName} ${formatPercent(coverage)} < ${formatPercent(thresholds.minRequiredCoverageQuarantine)}`
        );
      }
    }

    const unknownRates = Object.values(metrics.optionalUnknownRates).filter(
      (ratio) => ratio !== null
    );
    if (
      unknownRates.length === 4 &&
      unknownRates.every((ratio) => ratio >= thresholds.severeUnknownRate) &&
      metrics.sampleSize >= thresholds.minSampleForDuplicateCheck
    ) {
      pushReason(
        quarantineReasonDetails,
        "optional_fields_near_empty",
        `all optional fields near-empty (unknown rate >= ${formatPercent(thresholds.severeUnknownRate)})`
      );
    }
  }

  if (rejectReasonDetails.length > 0) {
    return buildReasonResult("reject", rejectReasonDetails);
  }

  if (quarantineReasonDetails.length > 0) {
    return buildReasonResult("quarantine", quarantineReasonDetails);
  }

  return buildReasonResult("accept", []);
}

export function evaluateCaptureRun(source, payload, options = {}) {
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(options.thresholds && typeof options.thresholds === "object" ? options.thresholds : {})
  };

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const reasonDetails = [
      {
        code: "payload_invalid_object",
        message: "capture payload must be an object"
      }
    ];
    return {
      outcome: "reject",
      reasons: reasonDetails.map((reason) => reason.message),
      reasonDetails,
      metrics: getEmptyMetrics(),
      evaluatedAt: new Date().toISOString(),
      sourceId: source?.id || null,
      sourceType: source?.type || null
    };
  }

  if (!Array.isArray(payload.jobs)) {
    const reasonDetails = [
      {
        code: "payload_jobs_missing",
        message: "capture payload must include a jobs array"
      }
    ];
    return {
      outcome: "reject",
      reasons: reasonDetails.map((reason) => reason.message),
      reasonDetails,
      metrics: getEmptyMetrics(),
      evaluatedAt: new Date().toISOString(),
      sourceId: source?.id || null,
      sourceType: source?.type || null
    };
  }

  const jobs = payload.jobs;
  const sampleSize = jobs.length;
  const baselineCount = safeNumber(
    options.baselineCount ?? payload.expectedCount ?? options.expectedCount
  );
  const baselineRatio =
    baselineCount && baselineCount > 0
      ? toRoundedRatio(sampleSize / baselineCount)
      : null;

  const metrics = {
    sampleSize,
    baselineCount: baselineCount !== null && baselineCount >= 0 ? Math.round(baselineCount) : null,
    baselineRatio,
    uniqueJobRatio: computeUniqueJobRatio(jobs),
    urlValidityRatio: computeUrlValidityRatio(jobs),
    requiredCoverage: {
      title: computePresenceCoverage(jobs, "title"),
      company: computePresenceCoverage(jobs, "company"),
      url: computePresenceCoverage(jobs, "url")
    },
    optionalUnknownRates: {
      location: computeUnknownRate(jobs, "location"),
      postedAt: computeUnknownRate(jobs, "postedAt"),
      salaryText: computeUnknownRate(jobs, "salaryText"),
      employmentType: computeUnknownRate(jobs, "employmentType")
    }
  };

  const evaluated = evaluateOutcome(metrics, thresholds);

  return {
    sourceId: source?.id || null,
    sourceType: source?.type || null,
    outcome: evaluated.outcome,
    reasons: evaluated.reasons,
    reasonDetails: evaluated.reasonDetails,
    metrics,
    evaluatedAt: new Date().toISOString()
  };
}

export function shouldIngestCaptureEvaluation(evaluation, options = {}) {
  if (!evaluation || typeof evaluation !== "object") {
    return true;
  }

  const allowQuarantined =
    options.allowQuarantined === true ||
    String(process.env.JOB_FINDER_ALLOW_QUARANTINED_CAPTURE || "").trim() === "1";

  if (evaluation.outcome === "accept") {
    return true;
  }

  if (allowQuarantined && evaluation.outcome === "quarantine") {
    return true;
  }

  return false;
}

function sanitizeFileToken(value, fallback = "unknown") {
  const normalized = normalizeText(value)
    .replace(/[:.]/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  return normalized || fallback;
}

export function writeCaptureQuarantineArtifact(source, payload, evaluation, options = {}) {
  const rootDir = path.resolve(options.rootDir || "data/quality/quarantine");
  const sourceId = sanitizeFileToken(source?.id, "unknown-source");
  const sourceDir = path.join(rootDir, sourceId);

  const capturedAt =
    normalizeText(payload?.capturedAt) || normalizeText(evaluation?.evaluatedAt) || new Date().toISOString();
  const capturedToken = sanitizeFileToken(capturedAt, new Date().toISOString());
  const outcomeToken = sanitizeFileToken(evaluation?.outcome, "quarantine");
  const filePath = path.join(sourceDir, `${capturedToken}-${outcomeToken}.json`);

  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const maxJobs = Number.isFinite(Number(options.maxJobs)) && Number(options.maxJobs) > 0
    ? Math.round(Number(options.maxJobs))
    : 200;

  const artifact = {
    storedAt: new Date().toISOString(),
    source: {
      id: source?.id || null,
      name: source?.name || null,
      type: source?.type || null,
      searchUrl: source?.searchUrl || null,
      capturePath: source?.capturePath || null
    },
    capture: {
      capturedAt: capturedAt || null,
      expectedCount:
        Number.isFinite(Number(payload?.expectedCount)) && Number(payload.expectedCount) >= 0
          ? Math.round(Number(payload.expectedCount))
          : null,
      pageUrl: normalizeText(payload?.pageUrl) || null
    },
    evaluation: evaluation || null,
    totalJobs: jobs.length,
    jobsSample: jobs.slice(0, maxJobs),
    truncated: jobs.length > maxJobs
  };

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return filePath;
}
