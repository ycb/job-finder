import fs from "node:fs";
import path from "node:path";
import { getRefreshPolicyForSource, isLiveRefreshAllowed } from "./refresh-policy.js";
import { isSourceQaModeEnabled } from "./qa-mode.js";
import {
  countSourceEventsForUtcDay,
  readRefreshState,
  resolveSourceRefreshState
} from "./refresh-state.js";

const HTTP_SOURCE_TYPES = new Set([
  "builtin_search",
  "google_search",
  "yc_jobs",
  "levelsfyi_search"
]);
const REFRESH_PROFILES = new Set(["safe", "probe", "mock"]);

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
  return null;
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

export function normalizeRefreshProfile(value, options = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "safe";
  }

  if (!REFRESH_PROFILES.has(normalized)) {
    if (options.strict) {
      throw new Error(
        `Invalid refresh profile "${value}". Expected one of: safe, probe, mock.`
      );
    }
    return "safe";
  }

  return normalized;
}

export function getSourceRefreshDecision(source, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const forceRefresh = options.forceRefresh === true;
  const bypassRefreshGuards =
    options.bypassRefreshGuards === true || isSourceQaModeEnabled(options.env || process.env);
  const profile = normalizeRefreshProfile(
    options.profile || process.env.JOB_FINDER_REFRESH_PROFILE || "safe"
  );

  const cacheSummary = readSourceCaptureSummary(source);
  const cacheFresh = isTimestampFresh(
    cacheSummary.capturedAt,
    getSourceCacheTtlHours(source),
    nowMs
  );

  const policy = getRefreshPolicyForSource(source, { profile });
  const refreshState = readRefreshState(options.statePath);
  const sourceState = resolveSourceRefreshState(refreshState, source?.id || "");
  const liveEventsTodayCount = countSourceEventsForUtcDay(
    refreshState,
    source?.id || "",
    nowIso
  );
  if (bypassRefreshGuards) {
    return {
      profile,
      policy,
      cacheSummary,
      cacheFresh,
      sourceState,
      liveEventsTodayCount,
      servedFrom: "live",
      allowLive: true,
      cached: false,
      reason: "qa_live",
      nextEligibleAt: null
    };
  }

  return {
    profile,
    policy,
    cacheSummary,
    cacheFresh,
    sourceState,
    liveEventsTodayCount,
    servedFrom: "live",
    allowLive: true,
    cached: false,
    reason: forceRefresh ? "force_refresh" : "eligible",
    nextEligibleAt: null
  };
}
