import fs from "node:fs";
import path from "node:path";

const HTTP_SOURCE_TYPES = new Set(["builtin_search", "google_search"]);

export function getDefaultCacheTtlHours(sourceType) {
  if (HTTP_SOURCE_TYPES.has(String(sourceType || "").trim())) {
    return 12;
  }

  return 24;
}

export function getSourceCacheTtlHours(source) {
  const configured = Number(source?.cacheTtlHours);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return getDefaultCacheTtlHours(source?.type);
}

export function readSourceCaptureSummary(source) {
  const rawCapturePath = String(source?.capturePath || "").trim();
  if (!rawCapturePath) {
    return {
      capturePath: null,
      capturedAt: null,
      jobCount: 0,
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

    return {
      capturePath,
      capturedAt,
      jobCount: jobs.length,
      pageUrl: typeof payload?.pageUrl === "string" ? payload.pageUrl : null,
      status: "ready",
      payload: {
        sourceId: payload?.sourceId,
        sourceName: payload?.sourceName,
        searchUrl: payload?.searchUrl,
        capturedAt,
        jobs,
        pageUrl: typeof payload?.pageUrl === "string" ? payload.pageUrl : null
      }
    };
  } catch {
    return {
      capturePath,
      capturedAt: null,
      jobCount: 0,
      pageUrl: null,
      status: "capture_error"
    };
  }
}

export function isTimestampFresh(capturedAt, ttlHours, nowMs = Date.now()) {
  const normalizedTtl = Number(ttlHours);
  if (!Number.isFinite(normalizedTtl) || normalizedTtl <= 0) {
    return false;
  }

  const capturedAtMs = Date.parse(String(capturedAt || "").trim());
  if (!Number.isFinite(capturedAtMs)) {
    return false;
  }

  const maxAgeMs = normalizedTtl * 60 * 60 * 1000;
  return nowMs - capturedAtMs <= maxAgeMs;
}

export function isSourceCaptureFresh(source, nowMs = Date.now()) {
  const summary = readSourceCaptureSummary(source);
  if (summary.status !== "ready" || !summary.capturedAt) {
    return false;
  }

  return isTimestampFresh(summary.capturedAt, getSourceCacheTtlHours(source), nowMs);
}

export function getFreshCachedJobs(source, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const summary = readSourceCaptureSummary(source);
  if (summary.status !== "ready" || !summary.payload) {
    return null;
  }

  if (!isTimestampFresh(summary.payload.capturedAt, getSourceCacheTtlHours(source), nowMs)) {
    return null;
  }

  const pageUrl = summary.payload.pageUrl;
  const capturedAt = summary.payload.capturedAt || new Date(nowMs).toISOString();
  return summary.payload.jobs.map((job) => ({
    ...job,
    retrievedAt: capturedAt,
    pageUrl: typeof pageUrl === "string" ? pageUrl : null
  }));
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

  if (typeof options.pageUrl === "string" && options.pageUrl.trim()) {
    payload.pageUrl = options.pageUrl.trim();
  }

  fs.writeFileSync(capturePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return capturePath;
}
