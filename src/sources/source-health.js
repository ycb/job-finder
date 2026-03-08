import fs from "node:fs";
import path from "node:path";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toRatio(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const clamped = Math.min(1, Math.max(0, numeric));
  return Math.round(clamped * 1000) / 1000;
}

function toNonNegativeInt(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.round(numeric);
}

function isFreshTimestamp(capturedAt, staleAfterDays) {
  const parsed = Date.parse(normalizeText(capturedAt));
  if (!Number.isFinite(parsed)) {
    return false;
  }

  const staleDays = Number.isFinite(Number(staleAfterDays)) && Number(staleAfterDays) > 0
    ? Number(staleAfterDays)
    : 30;

  return Date.now() - parsed <= staleDays * 24 * 60 * 60 * 1000;
}

function resolveRepoRootFromSourcesPath(sourcesPath) {
  const resolvedSourcesPath = path.resolve(String(sourcesPath || "config/sources.json"));
  return path.dirname(path.dirname(resolvedSourcesPath));
}

export function resolveSourceHealthHistoryPath(historyPath, sourcesPath) {
  const explicit = normalizeText(historyPath);
  if (explicit) {
    return path.resolve(explicit);
  }

  return path.resolve(
    resolveRepoRootFromSourcesPath(sourcesPath),
    "data",
    "quality",
    "source-health-history.json"
  );
}

function normalizeRunEntry(runMetrics = {}) {
  const requiredCoverage = runMetrics.requiredCoverage && typeof runMetrics.requiredCoverage === "object"
    ? runMetrics.requiredCoverage
    : {};
  const optionalUnknownRates = runMetrics.optionalUnknownRates && typeof runMetrics.optionalUnknownRates === "object"
    ? runMetrics.optionalUnknownRates
    : {};

  const reasonDetails = Array.isArray(runMetrics.reasonDetails)
    ? runMetrics.reasonDetails
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const code = normalizeText(item.code);
          const message = normalizeText(item.message);
          if (!code && !message) {
            return null;
          }

          return {
            code: code || "unknown_reason",
            message
          };
        })
        .filter(Boolean)
    : [];

  return {
    capturedAt: normalizeText(runMetrics.capturedAt) || new Date().toISOString(),
    sourceType: normalizeText(runMetrics.sourceType) || "unknown",
    outcome: normalizeText(runMetrics.outcome) || "accept",
    reasons: Array.isArray(runMetrics.reasons)
      ? runMetrics.reasons.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    reasonDetails,
    sampleSize: toNonNegativeInt(runMetrics.sampleSize) ?? 0,
    baselineCount: toNonNegativeInt(runMetrics.baselineCount),
    baselineRatio: toRatio(runMetrics.baselineRatio),
    uniqueJobRatio: toRatio(runMetrics.uniqueJobRatio),
    urlValidityRatio: toRatio(runMetrics.urlValidityRatio),
    requiredCoverage: {
      title: toRatio(requiredCoverage.title),
      company: toRatio(requiredCoverage.company),
      url: toRatio(requiredCoverage.url)
    },
    optionalUnknownRates: {
      location: toRatio(optionalUnknownRates.location),
      postedAt: toRatio(optionalUnknownRates.postedAt),
      salaryText: toRatio(optionalUnknownRates.salaryText),
      employmentType: toRatio(optionalUnknownRates.employmentType)
    },
    recordedAt: new Date().toISOString()
  };
}

function sortHistoryNewestFirst(entries) {
  return [...entries].sort((left, right) => {
    const leftMs = Date.parse(normalizeText(left?.capturedAt));
    const rightMs = Date.parse(normalizeText(right?.capturedAt));
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });
}

export function loadSourceHealthHistory(historyPath, sourcesPath) {
  const resolvedPath = resolveSourceHealthHistoryPath(historyPath, sourcesPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      version: "1.0.0",
      bySource: {}
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    const bySource = parsed?.bySource && typeof parsed.bySource === "object" && !Array.isArray(parsed.bySource)
      ? parsed.bySource
      : {};

    return {
      path: resolvedPath,
      version: normalizeText(parsed?.version) || "1.0.0",
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

function saveSourceHealthHistory(history) {
  const historyPath = path.resolve(String(history?.path || ""));
  if (!historyPath) {
    return;
  }

  const payload = {
    version: normalizeText(history?.version) || "1.0.0",
    updatedAt: new Date().toISOString(),
    bySource:
      history?.bySource && typeof history.bySource === "object" && !Array.isArray(history.bySource)
        ? history.bySource
        : {}
  };

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function recordSourceHealthRun(sourceId, runMetrics, options = {}) {
  const sourceKey = normalizeText(sourceId);
  if (!sourceKey) {
    return null;
  }

  const history = loadSourceHealthHistory(options.historyPath, options.sourcesPath);
  const entry = normalizeRunEntry(runMetrics);

  const currentEntries = Array.isArray(history.bySource[sourceKey])
    ? history.bySource[sourceKey]
    : [];

  const deduped = currentEntries.filter(
    (item) => normalizeText(item?.capturedAt) !== normalizeText(entry.capturedAt)
  );
  deduped.push(entry);
  history.bySource[sourceKey] = sortHistoryNewestFirst(deduped).slice(0, 80);

  saveSourceHealthHistory(history);

  return {
    sourceId: sourceKey,
    ...entry
  };
}

export function recordSourceHealthFromCaptureEvaluation(
  source,
  capturePayload,
  evaluation,
  options = {}
) {
  const metrics =
    evaluation?.metrics && typeof evaluation.metrics === "object"
      ? evaluation.metrics
      : {};
  const jobs = Array.isArray(capturePayload?.jobs) ? capturePayload.jobs : [];

  return recordSourceHealthRun(
    source?.id,
    {
      capturedAt: normalizeText(capturePayload?.capturedAt) || new Date().toISOString(),
      sourceType: normalizeText(source?.type) || "unknown",
      outcome: normalizeText(evaluation?.outcome) || "accept",
      reasons: Array.isArray(evaluation?.reasons) ? evaluation.reasons : [],
      reasonDetails: Array.isArray(evaluation?.reasonDetails)
        ? evaluation.reasonDetails
        : [],
      sampleSize: toNonNegativeInt(metrics.sampleSize) ?? jobs.length,
      baselineCount: toNonNegativeInt(
        metrics.baselineCount ?? capturePayload?.expectedCount
      ),
      baselineRatio: toRatio(metrics.baselineRatio),
      uniqueJobRatio: toRatio(metrics.uniqueJobRatio),
      urlValidityRatio: toRatio(metrics.urlValidityRatio),
      requiredCoverage:
        metrics.requiredCoverage &&
        typeof metrics.requiredCoverage === "object" &&
        !Array.isArray(metrics.requiredCoverage)
          ? metrics.requiredCoverage
          : {},
      optionalUnknownRates:
        metrics.optionalUnknownRates &&
        typeof metrics.optionalUnknownRates === "object" &&
        !Array.isArray(metrics.optionalUnknownRates)
          ? metrics.optionalUnknownRates
          : {}
    },
    options
  );
}

function average(values) {
  const rows = values.filter((value) => Number.isFinite(Number(value)));
  if (rows.length === 0) {
    return null;
  }

  const total = rows.reduce((sum, value) => sum + Number(value), 0);
  return Math.round((total / rows.length) * 1000) / 1000;
}

function computeCoverageConfidence(latest) {
  const coverages = [
    latest?.requiredCoverage?.title,
    latest?.requiredCoverage?.company,
    latest?.requiredCoverage?.url
  ].map((value) => toRatio(value));

  const ratio = average(coverages);
  return ratio === null ? 1 : ratio;
}

function computeVolumeConfidence(latest, previousEntries) {
  const previousSampleSizes = previousEntries
    .map((entry) => toNonNegativeInt(entry?.sampleSize))
    .filter((value) => value !== null);

  const previousMean = average(previousSampleSizes);
  if (previousMean === null || previousMean < 5) {
    const baselineRatio = toRatio(latest?.baselineRatio);
    return {
      confidence: baselineRatio === null ? 1 : baselineRatio,
      anomaly: false,
      ratio: baselineRatio
    };
  }

  const latestSample = toNonNegativeInt(latest?.sampleSize) ?? 0;
  const ratio = toRatio(latestSample / previousMean);
  if (ratio === null) {
    return {
      confidence: 1,
      anomaly: false,
      ratio: null
    };
  }

  if (ratio >= 0.8) {
    return {
      confidence: 1,
      anomaly: false,
      ratio
    };
  }

  if (ratio <= 0.2) {
    return {
      confidence: 0,
      anomaly: true,
      ratio
    };
  }

  return {
    confidence: Math.round(((ratio - 0.2) / 0.6) * 1000) / 1000,
    anomaly: ratio < 0.5,
    ratio
  };
}

function computeNullRateConfidence(latest, previousEntries) {
  const fields = ["location", "postedAt", "salaryText", "employmentType"];
  const spikes = [];

  for (const field of fields) {
    const latestUnknown = toRatio(latest?.optionalUnknownRates?.[field]);
    const previousUnknownMean = average(
      previousEntries
        .map((entry) => toRatio(entry?.optionalUnknownRates?.[field]))
        .filter((ratio) => ratio !== null)
    );

    if (latestUnknown === null || previousUnknownMean === null) {
      continue;
    }

    const delta = Math.round((latestUnknown - previousUnknownMean) * 1000) / 1000;
    if (latestUnknown >= 0.85 && delta >= 0.2) {
      spikes.push({
        field,
        latestUnknown,
        previousUnknownMean,
        delta
      });
    }
  }

  if (spikes.length === 0) {
    return {
      confidence: 1,
      spikes
    };
  }

  const maxDelta = Math.max(...spikes.map((spike) => spike.delta));
  const penalty = Math.min(1, Math.max(0, (maxDelta - 0.2) / 0.5));

  return {
    confidence: Math.round((1 - penalty) * 1000) / 1000,
    spikes
  };
}

export function computeSourceHealthStatus(sourceId, options = {}) {
  const sourceKey = normalizeText(sourceId);
  if (!sourceKey) {
    return {
      sourceId: sourceKey,
      status: "unknown",
      score: null,
      reasons: ["missing source id"],
      reasonDetails: [],
      updatedAt: null,
      window: 0,
      samplesUsed: 0,
      latest: null,
      components: null
    };
  }

  const history = loadSourceHealthHistory(options.historyPath, options.sourcesPath);
  const windowSize =
    Number.isInteger(Number(options.window)) && Number(options.window) > 0
      ? Math.round(Number(options.window))
      : 3;
  const staleAfterDays =
    Number.isInteger(Number(options.staleAfterDays)) && Number(options.staleAfterDays) > 0
      ? Math.round(Number(options.staleAfterDays))
      : 30;

  const sourceEntries = Array.isArray(history.bySource[sourceKey])
    ? history.bySource[sourceKey]
    : [];
  const freshEntries = sortHistoryNewestFirst(sourceEntries).filter((entry) =>
    isFreshTimestamp(entry?.capturedAt, staleAfterDays)
  );
  const entries = freshEntries.slice(0, windowSize);

  if (entries.length === 0) {
    return {
      sourceId: sourceKey,
      status: "unknown",
      score: null,
      reasons: ["no recent runs in source health history"],
      reasonDetails: [],
      updatedAt: null,
      window: windowSize,
      samplesUsed: 0,
      latest: null,
      components: null
    };
  }

  const [latest, ...previous] = entries;
  const reasons = [];

  const coverageConfidence = computeCoverageConfidence(latest);
  if (coverageConfidence < 0.7) {
    reasons.push(
      `required-field confidence below threshold (${Math.round(coverageConfidence * 100)}%)`
    );
  }

  const volume = computeVolumeConfidence(latest, previous);
  if (volume.anomaly) {
    reasons.push(
      `volume anomaly detected (latest/previous ratio=${volume.ratio === null ? "n/a" : Math.round(volume.ratio * 100) + "%"})`
    );
  }

  const nullRates = computeNullRateConfidence(latest, previous);
  if (nullRates.spikes.length > 0) {
    reasons.push(
      `null-rate spike detected for ${nullRates.spikes.map((spike) => spike.field).join(", ")}`
    );
  }

  const outcome = normalizeText(latest?.outcome).toLowerCase();
  if (outcome === "reject") {
    reasons.push("latest run marked reject");
  } else if (outcome === "quarantine") {
    reasons.push("latest run marked quarantine");
  }

  const score = Math.round(
    (
      coverageConfidence * 0.5 +
      volume.confidence * 0.25 +
      nullRates.confidence * 0.25
    ) *
      1000
  ) / 1000;

  let status = "ok";
  if (outcome === "reject" || score < 0.45) {
    status = "failing";
  } else if (outcome === "quarantine" || score < 0.7 || reasons.length > 0) {
    status = "degraded";
  }

  return {
    sourceId: sourceKey,
    status,
    score,
    reasons,
    reasonDetails: Array.isArray(latest?.reasonDetails) ? latest.reasonDetails : [],
    updatedAt: normalizeText(latest?.recordedAt) || null,
    window: windowSize,
    samplesUsed: entries.length,
    latest,
    components: {
      coverageConfidence,
      volumeConfidence: volume.confidence,
      nullRateConfidence: nullRates.confidence,
      volumeRatio: volume.ratio,
      nullRateSpikes: nullRates.spikes
    }
  };
}

export function computeAllSourceHealthStatuses(options = {}) {
  const history = loadSourceHealthHistory(options.historyPath, options.sourcesPath);
  const sourceIds = Object.keys(history.bySource || {});

  return sourceIds.map((sourceId) =>
    computeSourceHealthStatus(sourceId, {
      ...options,
      historyPath: history.path
    })
  );
}
