import fs from "node:fs";
import path from "node:path";


function normalizeExpectedCountValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

function shouldIgnoreExpectedCount(source, expectedCount, jobCount = null) {
  if (!Number.isFinite(expectedCount) || expectedCount <= 0) {
    return true;
  }

  if (Number.isFinite(jobCount) && jobCount > 0) {
    if (expectedCount < jobCount) {
      return true;
    }

    if (expectedCount > jobCount * 250 && expectedCount > 10000) {
      return true;
    }
  }

  return false;
}

export function sanitizeExpectedCount(source, value, jobCount = null) {
  const normalized = normalizeExpectedCountValue(value);
  if (normalized === null) {
    return null;
  }

  return shouldIgnoreExpectedCount(source, normalized, jobCount) ? null : normalized;
}

export function readSourceCaptureSummary(source) {
  const rawCapturePath = String(source?.capturePath || "").trim();
  if (!rawCapturePath) {
    return {
      capturePath: null,
      capturedAt: null,
      jobCount: 0,
      expectedCount: null,
      pageUrl: null,
      status: "no_capture_path"
    };
  }

  const capturePath = path.resolve(rawCapturePath);
  if (!fs.existsSync(capturePath)) {
    return {
      capturePath,
      capturedAt: null,
      jobCount: 0,
      expectedCount: null,
      pageUrl: null,
      status: "never_run"
    };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    const capturedAt =
      typeof payload?.capturedAt === "string" && payload.capturedAt.trim()
        ? payload.capturedAt
        : null;
    const rawCaptureFunnel =
      payload?.captureFunnel &&
      typeof payload.captureFunnel === "object" &&
      !Array.isArray(payload.captureFunnel)
        ? payload.captureFunnel
        : null;
    const normalizeCount = (value) => {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
    };

    const expectedCount = sanitizeExpectedCount(source, payload?.expectedCount, jobs.length);

    return {
      capturePath,
      capturedAt,
      jobCount: jobs.length,
      expectedCount,
      pageUrl: typeof payload?.pageUrl === "string" ? payload.pageUrl : null,
      status: "ready",
      payload: {
        sourceId: payload?.sourceId,
        sourceName: payload?.sourceName,
        searchUrl: payload?.searchUrl,
        capturedAt,
        jobs,
        expectedCount,
        captureFunnel: rawCaptureFunnel
          ? {
              availableCount: sanitizeExpectedCount(
                source,
                rawCaptureFunnel.availableCount,
                jobs.length
              ),
              capturedRawCount: normalizeCount(rawCaptureFunnel.capturedRawCount),
              postHardFilterCount: normalizeCount(rawCaptureFunnel.postHardFilterCount),
              postDedupeCount: normalizeCount(rawCaptureFunnel.postDedupeCount),
              importedCount: normalizeCount(rawCaptureFunnel.importedCount)
            }
          : null,
        captureDiagnostics:
          payload?.captureDiagnostics &&
          typeof payload.captureDiagnostics === "object" &&
          !Array.isArray(payload.captureDiagnostics)
            ? payload.captureDiagnostics
            : null,
        captureTelemetry:
          payload?.captureTelemetry &&
          typeof payload.captureTelemetry === "object" &&
          !Array.isArray(payload.captureTelemetry)
            ? payload.captureTelemetry
            : null,
        pageUrl: typeof payload?.pageUrl === "string" ? payload.pageUrl : null
      }
    };
  } catch {
    return {
      capturePath,
      capturedAt: null,
      jobCount: 0,
      expectedCount: null,
      pageUrl: null,
      status: "capture_error"
    };
  }
}

export function getSourceCaptureJobs(source) {
  const summary = readSourceCaptureSummary(source);
  if (summary.status !== "ready" || !summary.payload) {
    return [];
  }

  const pageUrl = summary.payload.pageUrl;
  const capturedAt = summary.payload.capturedAt || new Date().toISOString();
  return summary.payload.jobs.map((job) => ({
    ...job,
    retrievedAt: capturedAt,
    pageUrl: typeof pageUrl === "string" ? pageUrl : null
  }));
}

export function writeSourceCapturePayload(source, jobs, options = {}) {
  const rawCapturePath = String(source?.capturePath || "").trim();
  if (!rawCapturePath) {
    return null;
  }

  const capturePath = path.resolve(rawCapturePath);
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });

  const payload = {
    sourceId: source.id,
    sourceName: source.name,
    searchUrl: source.searchUrl,
    capturedAt: options.capturedAt || new Date().toISOString(),
    jobs: Array.isArray(jobs) ? jobs : []
  };
  const expectedCount = sanitizeExpectedCount(
    source,
    options.expectedCount,
    Array.isArray(jobs) ? jobs.length : null
  );

  if (typeof options.pageUrl === "string" && options.pageUrl.trim()) {
    payload.pageUrl = options.pageUrl.trim();
  }

  if (expectedCount !== null) {
    payload.expectedCount = expectedCount;
  }

  if (
    options.captureDiagnostics &&
    typeof options.captureDiagnostics === "object" &&
    !Array.isArray(options.captureDiagnostics)
  ) {
    payload.captureDiagnostics = options.captureDiagnostics;
  }

  if (
    options.captureTelemetry &&
    typeof options.captureTelemetry === "object" &&
    !Array.isArray(options.captureTelemetry)
  ) {
    payload.captureTelemetry = options.captureTelemetry;
  }

  const rawFunnel = options.captureFunnel;
  if (rawFunnel && typeof rawFunnel === "object" && !Array.isArray(rawFunnel)) {
    const normalizeCount = (value) => {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
    };

    payload.captureFunnel = {
      availableCount: sanitizeExpectedCount(
        source,
        rawFunnel.availableCount ?? expectedCount,
        payload.jobs.length
      ),
      capturedRawCount: normalizeCount(
        rawFunnel.capturedRawCount ?? payload.jobs.length
      ),
      postHardFilterCount: normalizeCount(rawFunnel.postHardFilterCount),
      postDedupeCount: normalizeCount(rawFunnel.postDedupeCount),
      importedCount: normalizeCount(rawFunnel.importedCount)
    };
  } else {
    payload.captureFunnel = {
      availableCount: expectedCount,
      capturedRawCount: payload.jobs.length,
      postHardFilterCount: null,
      postDedupeCount: null,
      importedCount: null
    };
  }

  fs.writeFileSync(capturePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return capturePath;
}

