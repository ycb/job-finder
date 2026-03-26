import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createAnalyticsClient } from "../analytics/client.js";

import {
  captureSourceViaBridge,
  probeSourceAccessViaBridge,
  resolveBrowserBridgeBaseUrl
} from "../browser-bridge/client.js";
import { startBrowserBridgeServer } from "../browser-bridge/server.js";
import {
  addAshbySearchSource,
  addBuiltinSearchSource,
  addGoogleSearchSource,
  addIndeedSearchSource,
  addLinkedInCaptureSource,
  addRemoteOkSearchSource,
  addZipRecruiterSearchSource,
  addWellfoundSearchSource,
  connectNarrataGoalsFile,
  loadActiveProfile,
  loadSearchCriteria,
  normalizeAllSourceSearchUrls,
  saveSearchCriteria,
  setEnabledSources,
  useLegacyProfileSource,
  useMyGoalsProfileSource,
  loadSources,
  updateSourceDefinition
} from "../config/load-config.js";
import {
  isAnalyticsEnabledByFlag,
  isMonetizationLimitsEnabled,
  isOnboardingWizardEnabled
} from "../config/feature-flags.js";
import { loadRetentionPolicy } from "../config/retention-policy.js";
import { openDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import { normalizeJobRecord } from "../jobs/normalize.js";
import { applyRetentionPolicyCleanup, writeRetentionCleanupAudit } from "../jobs/retention.js";
import {
  listAllJobs,
  listAllJobsWithStatus,
  listLatestSourceRunDeltas,
  listSourceJobsForDelta,
  listReviewQueue,
  markApplicationStatusByNormalizedHash,
  pruneSourceJobs,
  recordSourceRunDeltas,
  upsertEvaluations,
  upsertJobs
} from "../jobs/repository.js";
import { computeSourceNoveltyBySourceId } from "../jobs/source-novelty.js";
import { classifyRunDeltas } from "../jobs/run-deltas.js";
import { evaluateJobsFromSearchCriteria } from "../jobs/score.js";
import {
  getSourceRefreshDecision,
  normalizeRefreshProfile,
  readSourceCaptureSummary
} from "../sources/cache-policy.js";
import { sanitizeLinkedInJob } from "../sources/linkedin-cleanup.js";
import {
  evaluateCaptureRun,
  shouldIngestCaptureEvaluation,
  writeCaptureQuarantineArtifact
} from "../sources/capture-validation.js";
import {
  classifyRefreshErrorOutcome,
  countSourceEventsForUtcDay,
  readRefreshState,
  recordRefreshEvent
} from "../sources/refresh-state.js";
import {
  computeAllSourceHealthStatuses,
  recordSourceHealthFromCaptureEvaluation
} from "../sources/source-health.js";
import { collectJobsFromSource } from "../sources/linkedin-saved-search.js";
import { buildAnalyticsEvent, recordAnalyticsEvent } from "../analytics/events.js";
import { getEntitlementState } from "../monetization/entitlements.js";
import {
  checkEnvironmentReadiness,
  checkSourceAccess,
  isSourceAuthRequired,
  normalizeSourceCheckResult
} from "../onboarding/source-access.js";
import {
  getEffectiveOnboardingChannel,
  incrementMonthlySearchUsage,
  loadUserSettings,
  markFirstRunCompleted,
  markOnboardingCompleted,
  updateInstallConsent,
  updateAnalyticsPreference,
  updateOnboardingChannel,
  updateOnboardingSourceCheck,
  updateOnboardingSources
} from "../onboarding/state.js";

const dashboardAnalytics = createAnalyticsClient({ channel: "dashboard" });

function trackDashboardEvent(eventName, properties = {}) {
  try {
    void dashboardAnalytics.track(eventName, properties);
  } catch {
    // Never block dashboard API flow on analytics.
  }
}

const REVIEW_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(REVIEW_MODULE_DIR, "../..");
const LEGAL_TERMS_PATH = path.join(PROJECT_ROOT, "TERMS.md");
const LEGAL_PRIVACY_PATH = path.join(PROJECT_ROOT, "PRIVACY.md");
const REVIEW_WEB_DIST_PATH = path.join(REVIEW_MODULE_DIR, "web", "dist");
const REVIEW_WEB_INDEX_PATH = path.join(REVIEW_WEB_DIST_PATH, "index.html");
const REVIEW_WEB_ASSETS_PATH = path.join(REVIEW_WEB_DIST_PATH, "assets");
const MANUAL_REFRESH_DAILY_CAP = 3;

function normalizeConsent(input) {
  const consent =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    termsAccepted: Boolean(consent.termsAccepted),
    privacyAccepted: Boolean(consent.privacyAccepted),
    rateLimitPolicyAccepted: Boolean(consent.rateLimitPolicyAccepted),
    tosRiskAccepted: Boolean(consent.tosRiskAccepted),
    acceptedAt:
      consent.acceptedAt && String(consent.acceptedAt).trim()
        ? String(consent.acceptedAt)
        : null,
    updatedAt:
      consent.updatedAt && String(consent.updatedAt).trim()
        ? String(consent.updatedAt)
        : null
  };
}

function isConsentComplete(consent) {
  const normalized = normalizeConsent(consent);
  return (
    normalized.termsAccepted &&
    normalized.privacyAccepted &&
    normalized.tosRiskAccepted
  );
}

function nextUtcDayStartIso(nowMs = Date.now()) {
  const now = new Date(nowMs);
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  ).toISOString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
}

function withDatabase(work) {
  const { db } = openDatabase();
  runMigrations(db);

  try {
    return work(db);
  } finally {
    db.close();
  }
}

let managedBridgeSession = null;

function resolveLocalBridgePort(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();

    if (host !== "127.0.0.1" && host !== "localhost") {
      return null;
    }

    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port <= 0) {
      return null;
    }

    return port;
  } catch {
    return null;
  }
}

async function isBridgeAvailable(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(1_500)
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.ok === true;
  } catch {
    return false;
  }
}

async function ensureBridgeForSources(sources) {
  const requiresBridge = Array.isArray(sources)
    ? sources.some(
        (source) =>
          source &&
          (source.type === "linkedin_capture_file" ||
            source.type === "wellfound_search" ||
            source.type === "ashby_search" ||
            source.type === "google_search" ||
            source.type === "indeed_search" ||
            source.type === "ziprecruiter_search" ||
            source.type === "remoteok_search")
      )
    : false;

  if (!requiresBridge) {
    return null;
  }

  const baseUrl = resolveBrowserBridgeBaseUrl();
  if (await isBridgeAvailable(baseUrl)) {
    return {
      baseUrl,
      started: false
    };
  }

  if (managedBridgeSession?.baseUrl === baseUrl) {
    return {
      baseUrl,
      started: true
    };
  }

  const port = resolveLocalBridgePort(baseUrl);
  if (!port) {
    throw new Error(
      `Browser capture requires a local bridge. Current bridge URL is ${baseUrl}. Set JOB_FINDER_BROWSER_BRIDGE_URL to http://127.0.0.1:<port> or start the bridge manually.`
    );
  }

  const providerName = String(
    process.env.JOB_FINDER_BRIDGE_PROVIDER || "chrome_applescript"
  );
  const started = await startBrowserBridgeServer({ port, providerName });
  managedBridgeSession = {
    baseUrl,
    server: started.server,
    provider: started.provider
  };
  console.log(
    `[review] Auto-started browser bridge at ${baseUrl} (provider=${started.provider}).`
  );

  process.once("exit", () => {
    try {
      managedBridgeSession?.server?.close();
    } catch {
      // noop
    }
  });

  return {
    baseUrl,
    started: true
  };
}

function summarizeBuckets(evaluations) {
  return evaluations.reduce(
    (accumulator, evaluation) => {
      accumulator[evaluation.bucket] = (accumulator[evaluation.bucket] || 0) + 1;
      return accumulator;
    },
    { high_signal: 0, review_later: 0, reject: 0 }
  );
}

function buildSourceImportVerification(expectedCount, importedCount) {
  const expected = normalizeExpectedCount(expectedCount);
  const imported = Number.isFinite(Number(importedCount)) ? Math.max(0, Math.round(Number(importedCount))) : 0;

  if (!expected || expected <= 0) {
    return {
      expectedCount: null,
      importedCount: imported,
      ratio: null,
      status: "unknown"
    };
  }

  const ratio = imported / expected;
  const roundedRatio = Math.round(ratio * 1000) / 1000;
  let status = "critical";
  if (roundedRatio >= 0.7) {
    status = "ok";
  } else if (roundedRatio >= 0.4) {
    status = "warning";
  }

  return {
    expectedCount: expected,
    importedCount: imported,
    ratio: roundedRatio,
    status
  };
}

function isCaptureFunnelReadSafeSource(source) {
  return (
    source?.type === "linkedin_capture_file" ||
    source?.type === "builtin_search" ||
    source?.type === "wellfound_search" ||
    source?.type === "ashby_search" ||
    source?.type === "google_search" ||
    source?.type === "indeed_search" ||
    source?.type === "ziprecruiter_search" ||
    source?.type === "remoteok_search"
  );
}

export function computeImportedAverageScore(
  sourceId,
  importedNormalizedHashes,
  scoresBySourceIdAndHash
) {
  const normalizedHashes = Array.isArray(importedNormalizedHashes)
    ? importedNormalizedHashes
    : [];
  const scores = scoresBySourceIdAndHash instanceof Map ? scoresBySourceIdAndHash : new Map();
  let importedScoreTotal = 0;
  let importedScoredCount = 0;

  for (const importedHash of normalizedHashes) {
    const scoreValue = Number(scores.get(`${sourceId}::${importedHash}`));
    if (Number.isFinite(scoreValue)) {
      importedScoreTotal += scoreValue;
      importedScoredCount += 1;
    }
  }

  return importedScoredCount > 0
    ? Math.round(importedScoreTotal / importedScoredCount)
    : null;
}

function buildSourceCaptureFunnel(source, captureSummary) {
  const captureJobCount = Number.isFinite(Number(captureSummary?.jobCount))
    ? Math.max(0, Math.round(Number(captureSummary.jobCount)))
    : null;

  if (!source?.capturePath) {
    return {
      captureJobCount,
      keptAfterHardFilterCount: null,
      keptAfterDedupeCount: null,
      droppedByHardFilterCount: null,
      droppedByDedupeCount: null,
      captureFunnelError: null,
      importedNormalizedHashes: []
    };
  }

  if (!isCaptureFunnelReadSafeSource(source)) {
    return {
      captureJobCount,
      keptAfterHardFilterCount: null,
      keptAfterDedupeCount: null,
      droppedByHardFilterCount: null,
      droppedByDedupeCount: null,
      captureFunnelError: null,
      importedNormalizedHashes: []
    };
  }

  try {
    const filteredJobs = collectJobsFromSource(source);
    const keptAfterHardFilterCount = filteredJobs.length;
    const normalizedHashes = new Set();

    for (const job of filteredJobs) {
      try {
        const normalizedJob = normalizeJobRecord(job, source);
        if (normalizedJob?.normalizedHash) {
          normalizedHashes.add(normalizedJob.normalizedHash);
        }
      } catch {
        // Keep funnel metrics resilient even if one record is malformed.
      }
    }

    const keptAfterDedupeCount = normalizedHashes.size;
    const droppedByHardFilterCount =
      captureJobCount !== null
        ? Math.max(0, captureJobCount - keptAfterHardFilterCount)
        : null;
    const droppedByDedupeCount = Math.max(
      0,
      keptAfterHardFilterCount - keptAfterDedupeCount
    );

    return {
      captureJobCount,
      keptAfterHardFilterCount,
      keptAfterDedupeCount,
      droppedByHardFilterCount,
      droppedByDedupeCount,
      captureFunnelError: null,
      importedNormalizedHashes: [...normalizedHashes.values()]
    };
  } catch (error) {
    return {
      captureJobCount,
      keptAfterHardFilterCount: null,
      keptAfterDedupeCount: null,
      droppedByHardFilterCount: null,
      droppedByDedupeCount: null,
      captureFunnelError: String(error?.message || "capture_funnel_failed"),
      importedNormalizedHashes: []
    };
  }
}

function getReviewQueue(limit = 200) {
  return withDatabase((db) => listReviewQueue(db, limit));
}

function getAllJobsWithStatus(limit = 5000) {
  return withDatabase((db) => listAllJobsWithStatus(db, limit));
}

function getSourceLastSeenAtMap() {
  return withDatabase((db) => {
    const rows = db
      .prepare(
        `
        SELECT source_id AS sourceId, MAX(updated_at) AS lastSeenAt
        FROM jobs
        GROUP BY source_id;
      `
      )
      .all();

    const map = new Map();
    for (const row of rows) {
      if (row?.sourceId) {
        map.set(row.sourceId, row.lastSeenAt || null);
      }
    }
    return map;
  });
}

function updateStatus(jobKey, status, reason = "") {
  return withDatabase((db) =>
    markApplicationStatusByNormalizedHash(db, jobKey, status, reason)
  );
}

function normalizeExpectedCount(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

function isLinkedInSourceType(sourceType) {
  return (
    sourceType === "linkedin_capture_file" || sourceType === "mock_linkedin_saved_search"
  );
}

export function buildLinkedInSearchUrl(job) {
  const query = [job.title, job.company].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    keywords: query
  });
  return `https://www.linkedin.com/jobs/search-results/?${params.toString()}`;
}

export function resolveReviewTarget(job, options = {}) {
  const sourceUrl = typeof job.sourceUrl === "string" ? job.sourceUrl : "";
  const externalId = typeof job.externalId === "string" ? job.externalId : "";
  const sourceType =
    typeof options.sourceType === "string" && options.sourceType.trim().length > 0
      ? options.sourceType
      : options.sourceById instanceof Map && job?.sourceId
        ? options.sourceById.get(job.sourceId)?.type || ""
        : typeof job?.source === "string"
          ? job.source
          : "";
  const isLinkedInSource = isLinkedInSourceType(sourceType);

  if (sourceUrl.startsWith("https://www.linkedin.com/jobs/search-results/")) {
    return {
      url: sourceUrl,
      mode: "search"
    };
  }

  if (sourceUrl.startsWith("https://www.linkedin.com/jobs/view/")) {
    try {
      const parsed = new URL(sourceUrl);
      if (/^\/jobs\/view\/\d+\/?$/i.test(parsed.pathname)) {
        return {
          url: sourceUrl,
          mode: "direct"
        };
      }
    } catch {
      // fall through to the source-specific fallback checks below
    }
  }

  if (isLinkedInSource && /^\d+$/.test(externalId)) {
    return {
      url: `https://www.linkedin.com/jobs/view/${externalId}/`,
      mode: "direct"
    };
  }

  if (sourceUrl.startsWith("https://www.linkedin.com/jobs/view/")) {
    return {
      url: buildLinkedInSearchUrl(job),
      mode: "search"
    };
  }

  if (sourceUrl) {
    return {
      url: sourceUrl,
      mode: "direct"
    };
  }

  if (isLinkedInSource) {
    return {
      url: buildLinkedInSearchUrl(job),
      mode: "search"
    };
  }

  return {
    url: null,
    mode: "unavailable"
  };
}

function normalizeStatus(status) {
  if (status === "reviewed" || status === "drafted") {
    return "viewed";
  }

  if (
    status === "applied" ||
    status === "rejected" ||
    status === "viewed" ||
    status === "skip_for_now"
  ) {
    return status;
  }

  return "new";
}

function parseReasons(rawReasons) {
  if (typeof rawReasons !== "string" || rawReasons.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawReasons);
    return Array.isArray(parsed)
      ? parsed.filter((value) => typeof value === "string" && value.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function isBuiltInJobsUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return false;
  }

  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();

    return (
      host === "builtin.com" ||
      host.endsWith(".builtin.com") ||
      /^builtin[a-z0-9-]+\.com$/.test(host)
    );
  } catch {
    return false;
  }
}

function isWellfoundJobsUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return false;
  }

  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    return host === "wellfound.com" || host.endsWith(".wellfound.com");
  } catch {
    return false;
  }
}

function isAshbyJobsUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return false;
  }

  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    return host === "jobs.ashbyhq.com" || host.endsWith(".ashbyhq.com");
  } catch {
    return false;
  }
}

function isGoogleAshbyDiscoveryUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return false;
  }

  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    if (!/(^|\.)google\./i.test(host)) {
      return false;
    }
    const query = String(parsed.searchParams.get("q") || "").toLowerCase();
    return query.includes("ashbyhq.com");
  } catch {
    return false;
  }
}

function isGoogleJobsUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return false;
  }

  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    if (!/(^|\.)google\./i.test(host)) {
      return false;
    }

    return Boolean(String(parsed.searchParams.get("q") || "").trim());
  } catch {
    return false;
  }
}

function isIndeedJobsUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return false;
  }

  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    return host === "indeed.com" || host.endsWith(".indeed.com");
  } catch {
    return false;
  }
}

function isZipRecruiterJobsUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return false;
  }

  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    return host === "ziprecruiter.com" || host.endsWith(".ziprecruiter.com");
  } catch {
    return false;
  }
}

function isRemoteOkJobsUrl(rawUrl) {
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    return false;
  }

  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    return host === "remoteok.com" || host.endsWith(".remoteok.com");
  } catch {
    return false;
  }
}

function pickStatus(statuses) {
  const normalized = statuses.map((status) => normalizeStatus(status));

  if (normalized.includes("applied")) {
    return "applied";
  }

  if (normalized.includes("rejected")) {
    return "rejected";
  }

  if (normalized.includes("skip_for_now")) {
    return "skip_for_now";
  }

  if (normalized.includes("viewed")) {
    return "viewed";
  }

  return "new";
}

function hydrateQueue(queue, options = {}) {
  const includeRejected = options.includeRejected === true;
  const sourceById = options.sourceById instanceof Map ? options.sourceById : null;
  const groups = new Map();

  for (const rawJob of queue) {
    const sanitizedJob = sanitizeLinkedInJob(rawJob);
    const groupKey =
      typeof sanitizedJob.normalizedHash === "string" && sanitizedJob.normalizedHash.trim()
        ? sanitizedJob.normalizedHash
        : sanitizedJob.id;

    const existing = groups.get(groupKey);
    const status = normalizeStatus(sanitizedJob.status);
    const reasons = parseReasons(sanitizedJob.reasons);
    const note =
      typeof sanitizedJob.notes === "string" && sanitizedJob.notes.trim().length > 0
        ? sanitizedJob.notes.trim()
        : "";

    if (!existing) {
      groups.set(groupKey, {
        ...sanitizedJob,
        id: groupKey,
        groupKey,
        primaryJobId: sanitizedJob.id,
        status,
        reasons: [...reasons],
        reviewTarget: resolveReviewTarget(sanitizedJob, { sourceById }),
        sourceIds: sanitizedJob.sourceId ? [sanitizedJob.sourceId] : [],
        duplicateCount: 1,
        notes: note,
        _statuses: [status]
      });
      continue;
    }

    existing.duplicateCount += 1;

    if (sanitizedJob.sourceId && !existing.sourceIds.includes(sanitizedJob.sourceId)) {
      existing.sourceIds.push(sanitizedJob.sourceId);
    }

    for (const reasonItem of reasons) {
      if (!existing.reasons.includes(reasonItem)) {
        existing.reasons.push(reasonItem);
      }
    }

    if (note && !existing.notes) {
      existing.notes = note;
    }

    const reviewTarget = resolveReviewTarget(sanitizedJob, { sourceById });
    if (!existing.reviewTarget?.url && reviewTarget?.url) {
      existing.reviewTarget = reviewTarget;
    } else if (
      existing.reviewTarget?.mode !== "direct" &&
      reviewTarget?.mode === "direct"
    ) {
      existing.reviewTarget = reviewTarget;
    }

    existing._statuses.push(status);
    existing.status = pickStatus(existing._statuses);
  }

  const result = [...groups.values()].map((job) => {
    delete job._statuses;
    return job;
  });

  return includeRejected ? result : result.filter((job) => job.status !== "rejected");
}

function readCaptureSummary(source) {
  return readSourceCaptureSummary(source);
}

function buildSourceSnapshotPath(source) {
  return path.resolve("output/playwright", `${source.id}-snapshot.md`);
}

function isBrowserCaptureSource(source) {
  return (
    source?.type === "linkedin_capture_file" ||
    source?.type === "wellfound_search" ||
    source?.type === "ashby_search" ||
    source?.type === "google_search" ||
    source?.type === "indeed_search" ||
    source?.type === "ziprecruiter_search" ||
    source?.type === "remoteok_search"
  );
}

export function buildSourceRefreshMeta(source, options = {}) {
  const refreshProfile = normalizeRefreshProfile(
    options.refreshProfile || process.env.JOB_FINDER_REFRESH_PROFILE || "safe"
  );

  if (!isBrowserCaptureSource(source)) {
    return {
      refreshMode: refreshProfile,
      servedFrom: "live",
      lastLiveAt: null,
      lastAttemptedAt: null,
      lastAttemptOutcome: null,
      lastAttemptError: null,
      nextEligibleAt: null,
      cooldownUntil: null,
      statusLabel: "direct_fetch",
      statusReason: "fetched_during_sync"
    };
  }

  const decision = getSourceRefreshDecision(source, {
    profile: refreshProfile,
    forceRefresh: Boolean(options.forceRefresh),
    statePath: options.refreshStatePath,
    nowMs: options.nowMs
  });
  const sourceState = decision.sourceState || {};
  const lastAttemptedAt = sourceState.lastAttemptedAt || null;
  const lastAttemptOutcome = sourceState.lastAttemptOutcome || null;
  const lastAttemptError = sourceState.lastError || null;
  const lastAttemptMs = Date.parse(String(lastAttemptedAt || ""));
  const lastLiveMs = Date.parse(String(sourceState.lastLiveAt || ""));
  const latestAttemptFailed =
    lastAttemptOutcome &&
    lastAttemptOutcome !== "success" &&
    Number.isFinite(lastAttemptMs) &&
    (!Number.isFinite(lastLiveMs) || lastAttemptMs >= lastLiveMs);
  let statusReason = decision.reason || "eligible";
  const statusLabelMap = {
    eligible: "ready_live",
    force_refresh: "ready_live",
    cache_fresh: "cache_fresh",
    cooldown: "cooldown",
    min_interval: "throttled",
    daily_cap: "daily_cap",
    mock_profile: "cache_only"
  };
  if (latestAttemptFailed) {
    statusReason = lastAttemptOutcome === "challenge" ? "challenge" : "attempt_failed";
  }
  const statusLabelOverrideMap = {
    challenge: "challenge",
    attempt_failed: "attempt_failed"
  };

  return {
    refreshMode: refreshProfile,
    servedFrom: decision.servedFrom,
    lastLiveAt: sourceState.lastLiveAt || null,
    lastAttemptedAt,
    lastAttemptOutcome,
    lastAttemptError,
    nextEligibleAt: decision.nextEligibleAt || null,
    cooldownUntil: sourceState.cooldownUntil || null,
    statusLabel: statusLabelOverrideMap[statusReason] || statusLabelMap[statusReason] || "cache_only",
    statusReason
  };
}

function resolveAllowQuarantinedIngest(options = {}) {
  if (options.allowQuarantined === true) {
    return true;
  }

  const envValue = String(
    process.env.JOB_FINDER_ALLOW_QUARANTINED_CAPTURE || ""
  ).trim().toLowerCase();

  return envValue === "1" || envValue === "true" || envValue === "yes";
}

function buildRejectedEvaluation(reason) {
  const normalizedReason = String(
    reason || "capture validation rejected source ingest"
  );
  return {
    outcome: "reject",
    reasons: [normalizedReason],
    reasonDetails: [
      {
        code: "ingest_runtime_failure",
        message: normalizedReason
      }
    ],
    metrics: {
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
    },
    evaluatedAt: new Date().toISOString()
  };
}

function runSyncAndScore() {
  const { criteria } = loadSearchCriteria();
  const sources = loadSources().sources.filter((source) => source.enabled);
  const allowQuarantined = resolveAllowQuarantinedIngest();
  const retentionPolicy = loadRetentionPolicy();
  const runId = randomUUID();
  const runRecordedAt = new Date().toISOString();

  return withDatabase((db) => {
    let totalCollected = 0;
    let totalUpserted = 0;
    let totalPruned = 0;
    let totalNew = 0;
    let totalUpdated = 0;
    let totalUnchanged = 0;
    let skippedByQuality = 0;
    const qualityMessages = [];
    const sourceDeltaRows = [];

    for (const source of sources) {
      const captureSummary = readSourceCaptureSummary(source);
      let rawJobs;
      try {
        rawJobs = collectJobsFromSource(source);
      } catch (error) {
        const evaluation = buildRejectedEvaluation(`collection failed: ${error.message}`);
        const failurePayload = {
          capturedAt: captureSummary.capturedAt || new Date().toISOString(),
          expectedCount: captureSummary.expectedCount,
          pageUrl: captureSummary.pageUrl,
          jobs: []
        };
        recordSourceHealthFromCaptureEvaluation(source, failurePayload, evaluation);
        const artifactPath = writeCaptureQuarantineArtifact(
          source,
          failurePayload,
          evaluation
        );
        skippedByQuality += 1;
        qualityMessages.push(
          `${source.id}: rejected (collection failure). artifact=${artifactPath}`
        );
        continue;
      }

      const capturePayload = {
        capturedAt: captureSummary.capturedAt || new Date().toISOString(),
        expectedCount: captureSummary.expectedCount,
        pageUrl: captureSummary.pageUrl,
        jobs: rawJobs
      };
      const evaluation = evaluateCaptureRun(source, capturePayload, {
        baselineCount: captureSummary.expectedCount
      });
      recordSourceHealthFromCaptureEvaluation(source, capturePayload, evaluation);
      const shouldIngest = shouldIngestCaptureEvaluation(evaluation, {
        allowQuarantined
      });
      if (!shouldIngest) {
        const artifactPath = writeCaptureQuarantineArtifact(
          source,
          capturePayload,
          evaluation
        );
        skippedByQuality += 1;
        qualityMessages.push(
          `${source.id}: ${evaluation.outcome}. ${evaluation.reasons.join(" | ") || "no reason"} artifact=${artifactPath}`
        );
        continue;
      }

      if (evaluation.outcome !== "accept" && allowQuarantined) {
        qualityMessages.push(
          `${source.id}: ${evaluation.outcome} accepted via override (--allow-quarantined).`
        );
      }

      let normalizedJobs;
      try {
        normalizedJobs = rawJobs.map((job) => normalizeJobRecord(job, source));
      } catch (error) {
        const evaluationOnNormalizeError = buildRejectedEvaluation(
          `normalization failed: ${error.message}`
        );
        recordSourceHealthFromCaptureEvaluation(
          source,
          capturePayload,
          evaluationOnNormalizeError
        );
        const artifactPath = writeCaptureQuarantineArtifact(
          source,
          capturePayload,
          evaluationOnNormalizeError
        );
        skippedByQuality += 1;
        qualityMessages.push(
          `${source.id}: rejected (normalization failure). artifact=${artifactPath}`
        );
        continue;
      }

      const existingRows = listSourceJobsForDelta(db, source.id);
      const deltas = classifyRunDeltas({
        existingRows,
        incomingJobs: normalizedJobs
      });
      const refreshMeta = buildSourceRefreshMeta(source);

      totalCollected += normalizedJobs.length;
      totalUpserted += upsertJobs(db, normalizedJobs);
      totalPruned += pruneSourceJobs(
        db,
        source.id,
        normalizedJobs.map((job) => job.id)
      );
      totalNew += deltas.newCount;
      totalUpdated += deltas.updatedCount;
      totalUnchanged += deltas.unchangedCount;
      sourceDeltaRows.push({
        runId,
        sourceId: source.id,
        newCount: deltas.newCount,
        updatedCount: deltas.updatedCount,
        unchangedCount: deltas.unchangedCount,
        importedCount: normalizedJobs.length,
        refreshMode: refreshMeta.refreshMode,
        servedFrom: refreshMeta.servedFrom,
        statusReason: refreshMeta.statusReason,
        statusLabel: refreshMeta.statusLabel,
        capturedAt: capturePayload.capturedAt,
        recordedAt: runRecordedAt
      });
    }

    recordSourceRunDeltas(db, sourceDeltaRows);

    const retentionCleanup = applyRetentionPolicyCleanup(
      db,
      retentionPolicy.policy
    );
    const retentionAuditPath = writeRetentionCleanupAudit(retentionCleanup);

    const jobs = listAllJobs(db);
    const evaluations = evaluateJobsFromSearchCriteria(criteria, jobs);
    upsertEvaluations(db, evaluations);

    return {
      runId,
      collected: totalCollected,
      upserted: totalUpserted,
      pruned: totalPruned,
      newCount: totalNew,
      updatedCount: totalUpdated,
      unchangedCount: totalUnchanged,
      skippedByQuality,
      qualityMessages,
      retentionCleanup,
      retentionAuditPath,
      evaluated: evaluations.length,
      buckets: summarizeBuckets(evaluations)
    };
  });
}

async function runSourceCapture(sourceId) {
  return runSourceCaptureWithOptions(sourceId, {});
}

function describeRefreshDecision(source, decision) {
  if (decision.allowLive) {
    return null;
  }

  const sourceName = source?.name || source?.id || "source";
  const capturedAt = decision?.cacheSummary?.capturedAt || "unknown";
  const cachedCount = Number(decision?.cacheSummary?.jobCount || 0);

  if (decision.reason === "cache_fresh") {
    return `Skipped fresh capture for "${sourceName}" (capturedAt=${capturedAt}; jobs=${cachedCount}).`;
  }

  if (decision.reason === "mock_profile") {
    return `Using cache for "${sourceName}" (mock profile disables live refresh).`;
  }

  return `Using cache for "${sourceName}" (live refresh blocked: ${decision.reason}; next eligible=${decision.nextEligibleAt || "unknown"}; capturedAt=${capturedAt}).`;
}

function sourceWithCadenceCacheTtl(source, options = {}) {
  const overrideHours = Number(options.cacheTtlHours);
  if (!Number.isFinite(overrideHours) || overrideHours <= 0) {
    return source;
  }

  return {
    ...source,
    cacheTtlHours: overrideHours
  };
}

async function runSourceCaptureWithOptions(sourceId, options = {}) {
  const source = loadSources().sources.find((item) => item.id === sourceId);

  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  if (!isBrowserCaptureSource(source)) {
    return {
      capture: {
        provider: "source_fetch",
        status: "completed",
        jobsImported: null,
        message: `Synced source "${source.name}" via direct fetch.`
      },
      sync: options.skipSync ? null : runSyncAndScore()
    };
  }

  const refreshProfile = normalizeRefreshProfile(
    options.refreshProfile || process.env.JOB_FINDER_REFRESH_PROFILE || "safe"
  );
  const decisionSource = sourceWithCadenceCacheTtl(source, options);
  const decision = getSourceRefreshDecision(decisionSource, {
    profile: refreshProfile,
    forceRefresh: Boolean(options.forceRefresh),
    statePath: options.refreshStatePath
  });

  if (!decision.allowLive) {
      return {
        capture: {
        provider: "cache",
        status: "completed",
        cached: true,
        jobsImported: decision.cacheSummary?.jobCount || 0,
        servedFrom: "cache",
        policyReason: decision.reason,
        nextEligibleAt: decision.nextEligibleAt || null,
          message: describeRefreshDecision(source, decision)
        },
        sync: options.skipSync ? null : runSyncAndScore()
      };
    }

  await ensureBridgeForSources([source]);
  let capture;
  try {
    capture = await captureSourceViaBridge(source, buildSourceSnapshotPath(source));
  } catch (error) {
    const outcome = classifyRefreshErrorOutcome(error);
    recordRefreshEvent({
      statePath: options.refreshStatePath,
      sourceId: source.id,
      outcome,
      mode: options.runMode === "manual" ? "manual" : "scheduled",
      at: new Date().toISOString(),
      cooldownMinutes:
        outcome === "challenge" ? Number(decision?.policy?.cooldownMinutes || 0) : 0
    });
    throw error;
  }

  if (capture.status === "completed") {
    recordRefreshEvent({
      statePath: options.refreshStatePath,
        sourceId: source.id,
        outcome: "success",
        mode: options.runMode === "manual" ? "manual" : "scheduled",
        at: capture.capturedAt || new Date().toISOString()
      });
  }

  const sync =
    capture.status === "completed" && !options.skipSync ? runSyncAndScore() : null;

  return {
    capture,
    sync
  };
}

function buildAuthPreflightFailure(source, error) {
  const outcome = classifyRefreshErrorOutcome(error);
  const technicalDetails = {
    sourceId: source.id,
    error: String(error?.message || error || "unknown")
  };

  if (outcome === "challenge") {
    return normalizeSourceCheckResult({
      status: "fail",
      reasonCode: "auth_challenge",
      userMessage:
        "Sign-in could not be confirmed. Open source site, sign in, then check access again.",
      technicalDetails
    });
  }

  return normalizeSourceCheckResult({
    status: "fail",
    reasonCode: "auth_check_failed",
    userMessage: "Auth check failed. Open source site, sign in, then retry.",
    technicalDetails
  });
}

function mapAuthProbeToCheckResult(source, probeResult) {
  const status = String(probeResult?.status || "").trim().toLowerCase();
  const isAuthorized = status === "authorized";
  const pageUrl = String(probeResult?.pageUrl || source.searchUrl || "");
  const pageTitle = String(probeResult?.pageTitle || "");

  return normalizeSourceCheckResult({
    status: isAuthorized ? "pass" : "fail",
    reasonCode: isAuthorized ? "auth_ok" : "auth_required",
    userMessage: isAuthorized
      ? "Access confirmed."
      : "Sign-in could not be confirmed. Open source site, sign in, then retry.",
    technicalDetails: {
      sourceId: source.id,
      sourceType: source.type,
      pageUrl,
      pageTitle,
      provider: probeResult?.provider || null
    }
  });
}

async function runSourceAuthProbe(source, options = {}) {
  await ensureBridgeForSources([source]);
  const probeResult = await probeSourceAccessViaBridge(source, {
    settleMs: 1200,
    timeoutMs: 15_000,
    closeWindowAfterProbe: options.closeWindowAfterProbe === true
  });
  return mapAuthProbeToCheckResult(source, probeResult);
}

async function runAuthPreflightForEnabledSources(options = {}) {
  const enabledAuthSources = loadSources().sources.filter(
    (source) => source.enabled && isSourceAuthRequired(source.type)
  );
  const blockedSources = [];

  if (enabledAuthSources.length === 0) {
    return blockedSources;
  }

  await ensureBridgeForSources(enabledAuthSources);

  for (const source of enabledAuthSources) {
    let result;
    try {
      result = await runSourceAuthProbe(source);
    } catch (error) {
      result = buildAuthPreflightFailure(source, error);
    }

    updateOnboardingSourceCheck(source.id, result);
    if (result.status !== "pass") {
      blockedSources.push({
        sourceId: source.id,
        sourceName: source.name,
        searchUrl: source.searchUrl,
        result
      });
    }
  }

  return blockedSources;
}

async function runAllCaptures() {
  return runAllCapturesWithOptions({});
}

export async function runAllCapturesWithOptions(options = {}, overrides = {}) {
  const loadSourcesFn = overrides.loadSourcesFn || loadSources;
  const isBrowserCaptureSourceFn = overrides.isBrowserCaptureSourceFn || isBrowserCaptureSource;
  const sourceWithCadenceCacheTtlFn =
    overrides.sourceWithCadenceCacheTtlFn || sourceWithCadenceCacheTtl;
  const getSourceRefreshDecisionFn =
    overrides.getSourceRefreshDecisionFn || getSourceRefreshDecision;
  const ensureBridgeFn = overrides.ensureBridgeFn || ensureBridgeForSources;
  const captureSourceFn = overrides.captureSourceFn || captureSourceViaBridge;
  const recordRefreshEventFn = overrides.recordRefreshEventFn || recordRefreshEvent;
  const classifyRefreshErrorOutcomeFn =
    overrides.classifyRefreshErrorOutcomeFn || classifyRefreshErrorOutcome;
  const buildSourceSnapshotPathFn =
    overrides.buildSourceSnapshotPathFn || buildSourceSnapshotPath;
  const runSyncAndScoreFn = overrides.runSyncAndScoreFn || runSyncAndScore;
  const normalizeRefreshProfileFn =
    overrides.normalizeRefreshProfileFn || normalizeRefreshProfile;

  const sources = loadSourcesFn().sources.filter((source) => source.enabled);
  const captures = [];
  const failures = [];
  let completedCount = 0;
  const refreshProfile = normalizeRefreshProfileFn(
    options.refreshProfile || process.env.JOB_FINDER_REFRESH_PROFILE || "safe"
  );
  const liveBrowserSources = [];
  const decisions = new Map();

  for (const source of sources) {
    if (!isBrowserCaptureSourceFn(source)) {
      continue;
    }

    const decision = getSourceRefreshDecisionFn(sourceWithCadenceCacheTtlFn(source, options), {
      profile: refreshProfile,
      forceRefresh: Boolean(options.forceRefresh),
      statePath: options.refreshStatePath
    });
    decisions.set(source.id, decision);
    if (decision.allowLive) {
      liveBrowserSources.push(source);
    }
  }

  if (liveBrowserSources.length > 0) {
    await ensureBridgeFn(liveBrowserSources);
  }

  for (const source of sources) {
    let capture;

    if (isBrowserCaptureSourceFn(source)) {
      const decision =
        decisions.get(source.id) ||
        getSourceRefreshDecisionFn(sourceWithCadenceCacheTtlFn(source, options), {
          profile: refreshProfile,
          forceRefresh: Boolean(options.forceRefresh),
          statePath: options.refreshStatePath
        });

      if (!decision.allowLive) {
        capture = {
          provider: "cache",
          status: "completed",
          cached: true,
          servedFrom: "cache",
          policyReason: decision.reason,
          nextEligibleAt: decision.nextEligibleAt || null,
          jobsImported: decision.cacheSummary?.jobCount || 0,
          message: describeRefreshDecision(source, decision)
        };
      } else {
        try {
          capture = await captureSourceFn(
            source,
            buildSourceSnapshotPathFn(source)
          );
        } catch (error) {
          const outcome = classifyRefreshErrorOutcomeFn(error);
          const decision = decisions.get(source.id);
          const errorMessage = String(error?.message || error || "capture_failed");
          recordRefreshEventFn({
            statePath: options.refreshStatePath,
            sourceId: source.id,
            outcome,
            mode: options.runMode === "manual" ? "manual" : "scheduled",
            at: new Date().toISOString(),
            cooldownMinutes:
              outcome === "challenge" ? Number(decision?.policy?.cooldownMinutes || 0) : 0,
            error: errorMessage
          });
          capture = {
            provider: "bridge",
            status: "failed",
            outcome,
            error: errorMessage,
            jobsImported: 0,
            nextEligibleAt:
              outcome === "challenge" ? decision?.nextEligibleAt || null : null
          };
          failures.push({
            sourceId: source.id,
            sourceName: source.name,
            outcome,
            error: errorMessage
          });
        }

        if (capture.status === "completed") {
          recordRefreshEventFn({
            statePath: options.refreshStatePath,
            sourceId: source.id,
            outcome: "success",
            mode: options.runMode === "manual" ? "manual" : "scheduled",
            at: capture.capturedAt || new Date().toISOString()
          });
        }
      }
    } else {
      capture = {
        provider: "source_fetch",
        status: "completed",
        jobsImported: null,
        message: `Source "${source.name}" will be fetched during sync.`
      };
    }

    captures.push({
      sourceId: source.id,
      sourceName: source.name,
      ...capture
    });

    if (capture.status === "completed") {
      completedCount += 1;
    }
  }

  return {
    captures,
    failures,
    sync: completedCount > 0 ? runSyncAndScoreFn() : null
  };
}

function buildDashboardData(limit = 200) {
  const activeProfile = loadActiveProfile();
  const profile = activeProfile.profile;
  const searchCriteria = loadSearchCriteria();
  const userSettings = loadUserSettings();
  const settings = userSettings.settings;
  const hasConfiguredOnboardingSources = Boolean(settings?.onboarding?.sourcesConfiguredAt);
  const effectiveChannel = getEffectiveOnboardingChannel(settings);
  const onboardingEnabled = isOnboardingWizardEnabled();
  let sources = loadSources().sources;
  if (
    onboardingEnabled &&
    settings?.onboarding?.completed !== true &&
    !settings?.onboarding?.firstRunAt &&
    !hasConfiguredOnboardingSources
  ) {
    const enabledIds = new Set(
      sources.filter((source) => source.enabled).map((source) => source.id)
    );
    const noAuthDefaultIds = sources
      .filter((source) => !isSourceAuthRequired(source.type))
      .map((source) => source.id);
    let changed = false;
    for (const sourceId of noAuthDefaultIds) {
      if (!enabledIds.has(sourceId)) {
        enabledIds.add(sourceId);
        changed = true;
      }
    }
    if (changed) {
      setEnabledSources([...enabledIds]);
      sources = loadSources().sources;
    }
  }
  const analyticsFlagEnabled = isAnalyticsEnabledByFlag();
  const monetizationLimitsEnabled = isMonetizationLimitsEnabled();
  const entitlement = getEntitlementState(settings);
  const refreshState = readRefreshState();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const statsQueue = hydrateQueue(getAllJobsWithStatus(5_000), {
    includeRejected: true,
    sourceById
  });
  const jobsStoredCount = statsQueue.length;
  const scoresBySourceIdAndHash = new Map();
  for (const job of statsQueue) {
    const sourceIds = Array.isArray(job?.sourceIds) ? job.sourceIds : [];
    const normalizedHash = typeof job?.normalizedHash === "string" ? job.normalizedHash : "";
    if (!normalizedHash || sourceIds.length === 0) {
      continue;
    }
    const scoreValue = Number(job?.score);
    if (!Number.isFinite(scoreValue)) {
      continue;
    }
    for (const sourceId of sourceIds) {
      const key = `${sourceId}::${normalizedHash}`;
      if (!scoresBySourceIdAndHash.has(key)) {
        scoresBySourceIdAndHash.set(key, scoreValue);
      }
    }
  }
  const sourceLastSeenAt = getSourceLastSeenAtMap();
  const sourceNoveltyBySourceId = computeSourceNoveltyBySourceId({
    sources,
    importedJobs: statsQueue
  });
  const sourceHealthRows = computeAllSourceHealthStatuses({ window: 3 });
  const sourceHealthBySourceId = new Map(
    sourceHealthRows.map((row) => [row.sourceId, row])
  );
  const latestSourceRunDeltas = withDatabase((db) => listLatestSourceRunDeltas(db));
  const latestSourceRunDeltaBySourceId = new Map(
    latestSourceRunDeltas.map((row) => [row.sourceId, row])
  );
  const queue = statsQueue
    .filter((job) => job.status === "new" || job.status === "viewed")
    .slice(0, limit);
  const appliedQueue = statsQueue.filter((job) => job.status === "applied").slice(0, limit);
  const skippedQueue = statsQueue
    .filter((job) => job.status === "skip_for_now")
    .slice(0, limit);
  const rejectedQueue = statsQueue.filter((job) => job.status === "rejected").slice(0, limit);

  const countsBySourceId = new Map();

  for (const job of statsQueue) {
    const sourceIds = Array.isArray(job.sourceIds) ? job.sourceIds : [];
    for (const sourceId of sourceIds) {
      const current = countsBySourceId.get(sourceId) || {
        totalCount: 0,
        activeCount: 0,
        appliedCount: 0,
        skippedCount: 0,
        rejectedCount: 0,
        highSignalCount: 0,
        scoredCount: 0,
        scoreTotal: 0
      };

      current.totalCount += 1;
      if (job.status === "applied") {
        current.appliedCount += 1;
      } else if (job.status === "skip_for_now") {
        current.skippedCount += 1;
      } else if (job.status === "rejected") {
        current.rejectedCount += 1;
      } else {
        current.activeCount += 1;
      }

      if (job.bucket === "high_signal") {
        current.highSignalCount += 1;
      }

      const scoreValue = Number(job.score);
      if (Number.isFinite(scoreValue)) {
        current.scoredCount += 1;
        current.scoreTotal += scoreValue;
      }

      countsBySourceId.set(sourceId, current);
    }
  }

  return {
    featureFlags: {
      onboardingWizard: onboardingEnabled,
      analytics: analyticsFlagEnabled,
      monetizationLimits: monetizationLimitsEnabled
    },
    onboarding: {
      enabled: onboardingEnabled,
      settingsPath: userSettings.path,
      completed: Boolean(settings?.onboarding?.completed),
      startedAt: settings?.onboarding?.startedAt || null,
      completedAt: settings?.onboarding?.completedAt || null,
      firstRunAt: settings?.onboarding?.firstRunAt || null,
      sourcesConfiguredAt: settings?.onboarding?.sourcesConfiguredAt || null,
      legalDocs: {
        termsUrl: "/policy/terms",
        privacyUrl: "/policy/privacy"
      },
      consent: normalizeConsent(settings?.onboarding?.consent),
      consentComplete: isConsentComplete(settings?.onboarding?.consent),
      selectedSourceIds: Array.isArray(settings?.onboarding?.selectedSourceIds)
        ? settings.onboarding.selectedSourceIds
        : [],
      channel: {
        value: String(effectiveChannel?.value || effectiveChannel?.channel || "unknown"),
        confidence: String(
          effectiveChannel?.confidence ||
            settings?.onboarding?.channel?.confidence ||
            "unknown"
        )
      },
      analyticsEnabled: Boolean(settings?.analytics?.enabled),
      checks:
        settings?.onboarding?.checks &&
        typeof settings.onboarding.checks === "object" &&
        !Array.isArray(settings.onboarding.checks)
          ? settings.onboarding.checks
          : { sources: {} },
      environmentChecks: checkEnvironmentReadiness()
    },
    monetization: {
      ...entitlement,
      jobsStored: jobsStoredCount,
      donationUrl:
        String(process.env.JOB_FINDER_DONATION_URL || "").trim() ||
        "https://github.com/sponsors"
    },
    profile: {
      candidateName: profile.candidateName,
      remotePreference: profile.remotePreference,
      salaryFloor: profile.salaryFloor,
      provider: activeProfile.source.provider,
      providerMode: activeProfile.source.mode || null,
      goalsPath: activeProfile.source.goalsPath || null,
      profileFilePath: activeProfile.source.profilePath || null,
      appliedCount: appliedQueue.length,
      skippedCount: skippedQueue.length,
      rejectedCount: rejectedQueue.length,
      activeCount: queue.length,
      profilePath: path.resolve(
        activeProfile.source.profilePath || "config/profile.json"
      ),
      goalsFilePath: path.resolve(activeProfile.source.goalsPath || "config/my-goals.json"),
      sourcesPath: path.resolve("config/sources.json"),
      searchCriteriaPath: searchCriteria.path,
      settingsPath: userSettings.path
    },
    searchCriteria: searchCriteria.criteria,
    sources: sources.map((source) => {
      const capture = readCaptureSummary(source);
      const captureFunnel = buildSourceCaptureFunnel(source, capture);
      const refreshMeta = buildSourceRefreshMeta(source);
      const health = sourceHealthBySourceId.get(source.id) || null;
      const latestRunDelta = latestSourceRunDeltaBySourceId.get(source.id) || null;
      const counts = countsBySourceId.get(source.id) || {
        totalCount: 0,
        activeCount: 0,
        appliedCount: 0,
        skippedCount: 0,
        highSignalCount: 0,
        scoredCount: 0,
        scoreTotal: 0
      };
      const isFileBackedCapture = Boolean(source.capturePath);
      const captureJobCount = isFileBackedCapture
        ? captureFunnel.captureJobCount
        : null;
      const captureExpectedCount =
        isFileBackedCapture
          ? normalizeExpectedCount(capture.expectedCount)
          : null;
      const jobCount = counts.totalCount;
      const importedCount = Number(
        Number.isFinite(Number(captureFunnel.keptAfterDedupeCount))
          ? captureFunnel.keptAfterDedupeCount
          : jobCount
      );
      const captureStatus = isFileBackedCapture ? capture.status : "ready";
      const capturedAt = isFileBackedCapture
        ? capture.capturedAt
        : sourceLastSeenAt.get(source.id) || null;
      const importedNormalizedHashes = Array.isArray(
        captureFunnel.importedNormalizedHashes
      )
        ? captureFunnel.importedNormalizedHashes
        : [];
      const avgScore = computeImportedAverageScore(
        source.id,
        importedNormalizedHashes,
        scoresBySourceIdAndHash
      );
      const importVerification = buildSourceImportVerification(
        captureExpectedCount,
        importedCount
      );
      const manualRefreshesToday = countSourceEventsForUtcDay(
        refreshState,
        source.id,
        nowIso,
        { mode: "manual" }
      );
      const manualRemaining = Math.max(0, MANUAL_REFRESH_DAILY_CAP - manualRefreshesToday);
      const manualCapNextEligibleAt =
        manualRemaining <= 0 ? nextUtcDayStartIso(nowMs) : null;
      const manualPolicyNextEligibleAt =
        typeof refreshMeta.nextEligibleAt === "string" && refreshMeta.nextEligibleAt.trim()
          ? refreshMeta.nextEligibleAt
          : null;
      const manualNextEligibleAt = manualCapNextEligibleAt || manualPolicyNextEligibleAt;
      const manualBlockedReason =
        manualCapNextEligibleAt
          ? "manual_daily_cap"
          : manualPolicyNextEligibleAt
            ? String(refreshMeta.statusReason || "min_interval")
            : null;
      const manualAllowed = source.enabled === true && !manualNextEligibleAt;
      const noveltyDiagnostics = sourceNoveltyBySourceId[source.id] || null;

      return {
        id: source.id,
        name: source.name,
        searchUrl: source.searchUrl,
        criteriaAccountability:
          source.criteriaAccountability || {
            appliedInUrl: [],
            appliedInUiBootstrap: [],
            appliedPostCapture: [],
            unsupported: []
          },
        formatterDiagnostics: source.formatterDiagnostics || null,
        recencyWindow: source.recencyWindow || null,
        enabled: source.enabled,
        authRequired: isSourceAuthRequired(source.type),
        type: source.type,
        capturePath: source.capturePath,
        capturedAt,
        jobCount,
        importedCount,
        captureJobCount,
        keptAfterHardFilterCount: captureFunnel.keptAfterHardFilterCount,
        keptAfterDedupeCount: captureFunnel.keptAfterDedupeCount,
        droppedByHardFilterCount: captureFunnel.droppedByHardFilterCount,
        droppedByDedupeCount: captureFunnel.droppedByDedupeCount,
        captureFunnelError: captureFunnel.captureFunnelError,
        captureExpectedCount,
        importVerification,
        pageUrl: capture.pageUrl,
        captureStatus,
        totalCount: counts.totalCount,
        activeCount: counts.activeCount,
        appliedCount: counts.appliedCount,
        skippedCount: counts.skippedCount,
        rejectedCount: counts.rejectedCount,
        highSignalCount: counts.highSignalCount,
        avgScore,
        noveltyDiagnostics,
        adapterHealthStatus: health?.status || "unknown",
        adapterHealthScore:
          Number.isFinite(Number(health?.score)) ? Number(health.score) : null,
        adapterHealthReasons: Array.isArray(health?.reasons) ? health.reasons : [],
        adapterHealthUpdatedAt:
          typeof health?.updatedAt === "string" && health.updatedAt.trim()
            ? health.updatedAt
            : null,
        runId: latestRunDelta?.runId || null,
        runNewCount:
          Number.isFinite(Number(latestRunDelta?.newCount))
            ? Math.max(0, Math.round(Number(latestRunDelta.newCount)))
            : null,
        runUpdatedCount:
          Number.isFinite(Number(latestRunDelta?.updatedCount))
            ? Math.max(0, Math.round(Number(latestRunDelta.updatedCount)))
            : null,
        runUnchangedCount:
          Number.isFinite(Number(latestRunDelta?.unchangedCount))
            ? Math.max(0, Math.round(Number(latestRunDelta.unchangedCount)))
            : null,
        runImportedCount:
          Number.isFinite(Number(latestRunDelta?.importedCount))
            ? Math.max(0, Math.round(Number(latestRunDelta.importedCount)))
            : null,
        runRecordedAt:
          typeof latestRunDelta?.recordedAt === "string" &&
          latestRunDelta.recordedAt.trim()
            ? latestRunDelta.recordedAt
            : null,
        runCapturedAt:
          typeof latestRunDelta?.capturedAt === "string" &&
          latestRunDelta.capturedAt.trim()
            ? latestRunDelta.capturedAt
            : null,
        manualRefreshCap: MANUAL_REFRESH_DAILY_CAP,
        manualRefreshesToday,
        manualRefreshRemaining: manualRemaining,
        manualRefreshNextEligibleAt: manualNextEligibleAt,
        manualRefreshAllowed: manualAllowed,
        manualRefreshBlockedReason: manualBlockedReason,
        ...refreshMeta
      };
    }),
    sourceHealthSummary: sourceHealthRows.reduce(
      (accumulator, row) => {
        const status = row?.status || "unknown";
        accumulator.total += 1;
        if (status === "ok") {
          accumulator.ok += 1;
        } else if (status === "degraded") {
          accumulator.degraded += 1;
        } else if (status === "failing") {
          accumulator.failing += 1;
        } else {
          accumulator.unknown += 1;
        }
        return accumulator;
      },
      {
        total: 0,
        ok: 0,
        degraded: 0,
        failing: 0,
        unknown: 0
      }
    ),
    queue,
    appliedQueue,
    skippedQueue,
    rejectedQueue
  };
}

function isEnabledFlag(rawValue) {
  const raw = String(rawValue || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isDashboardReactUiEnabled(env = process.env) {
  return String(env?.JOB_FINDER_DASHBOARD_UI || "").trim().toLowerCase() === "react";
}

function resolveStaticAssetPath(urlPath) {
  if (typeof urlPath !== "string" || !urlPath.startsWith("/assets/")) {
    return null;
  }

  const relativeAssetPath = urlPath.slice("/assets/".length);
  if (!relativeAssetPath || relativeAssetPath.includes("\0")) {
    return null;
  }

  const resolvedPath = path.resolve(REVIEW_WEB_ASSETS_PATH, relativeAssetPath);
  const assetsRootWithSeparator = `${REVIEW_WEB_ASSETS_PATH}${path.sep}`;
  if (
    resolvedPath !== REVIEW_WEB_ASSETS_PATH &&
    !resolvedPath.startsWith(assetsRootWithSeparator)
  ) {
    return null;
  }

  return resolvedPath;
}

function getStaticContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".ico") {
    return "image/x-icon";
  }
  if (extension === ".map") {
    return "application/json; charset=utf-8";
  }
  return "application/octet-stream";
}

export function isNarrataConnectEnabled(env = process.env) {
  return isEnabledFlag(env?.JOB_FINDER_ENABLE_NARRATA_CONNECT);
}

export function isWellfoundEnabled(env = process.env) {
  return isEnabledFlag(env?.JOB_FINDER_ENABLE_WELLFOUND);
}

export function isRemoteOkEnabled(env = process.env) {
  return isEnabledFlag(env?.JOB_FINDER_ENABLE_REMOTEOK);
}

export function renderDashboardPage(dashboard, options = {}) {
  const dashboardJson = JSON.stringify(dashboard);
  const narrataConnectEnabled =
    typeof options.narrataConnectEnabled === "boolean"
      ? options.narrataConnectEnabled
      : isNarrataConnectEnabled();
  const wellfoundEnabled =
    typeof options.wellfoundEnabled === "boolean"
      ? options.wellfoundEnabled
      : isWellfoundEnabled();
  const remoteokEnabled =
    typeof options.remoteokEnabled === "boolean"
      ? options.remoteokEnabled
      : isRemoteOkEnabled();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Job Finder Dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --panel: rgba(255, 252, 245, 0.94);
        --surface: rgba(255, 255, 255, 0.78);
        --surface-soft: rgba(252, 248, 239, 0.85);
        --ink: #1e2a26;
        --muted: #5e6b66;
        --line: #d8cfbd;
        --line-strong: #c8bea8;
        --accent: #1b3a33;
        --accent-soft: #e5f0ea;
        --high: #17643a;
        --review: #8a5a0a;
        --button: #1e2a26;
        --button-ink: #fdf9ef;
        --error: #8b1e1e;
        --new: #4f6275;
        --viewed: #6f6a58;
        --applied: #1e5c3f;
        --skip: #6b4c80;
        --reject: #7a1d1d;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: Georgia, "Iowan Old Style", serif;
        background:
          radial-gradient(circle at top right, rgba(210, 182, 126, 0.35), transparent 36%),
          linear-gradient(180deg, #f8f3e7 0%, #efe7d7 100%);
        color: var(--ink);
        min-height: 100vh;
      }

      .shell {
        max-width: 1360px;
        margin: 28px auto;
        padding: 0 18px 40px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
        box-shadow: 0 20px 40px rgba(52, 44, 29, 0.12);
        padding: 22px;
        backdrop-filter: blur(10px);
      }

      .panel.panel-consent-only {
        background: transparent;
        border: 0;
        box-shadow: none;
        padding: 0;
        backdrop-filter: none;
      }

      .header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .eyebrow,
      .section-label {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .eyebrow { margin-bottom: 8px; }
      .section-label { margin: 0 0 10px; }

      h1 {
        margin: 0;
        font-size: 34px;
        line-height: 1.1;
      }

      .subhead {
        margin-top: 8px;
        color: var(--muted);
        font-size: 15px;
      }

      .top-actions,
      .inline-actions,
      .filter-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
      }

      .top-actions { align-self: center; }

      button,
      a.button {
        appearance: none;
        border: 0;
        border-radius: 12px;
        padding: 10px 14px;
        font: inherit;
        font-size: 14px;
        text-decoration: none;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
      }

      button.primary,
      a.button.primary {
        background: var(--button);
        color: var(--button-ink);
      }

      button.secondary,
      a.button.secondary {
        background: rgba(255, 255, 255, 0.9);
        color: var(--ink);
        border: 1px solid var(--line);
      }

      button.ghost {
        background: transparent;
        color: var(--muted);
        border: 1px dashed var(--line);
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .stack {
        display: flex;
        flex-direction: column;
        gap: 18px;
        min-width: 0;
      }

      .card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 16px;
      }

      .card.inset {
        background: var(--surface-soft);
      }

      .meta-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 16px;
      }

      .meta-item dt {
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .meta-item dd {
        margin: 4px 0 0;
        font-size: 15px;
        word-break: break-word;
      }

      .search-form {
        display: grid;
        grid-template-columns: minmax(180px, 0.6fr) minmax(0, 1.4fr) auto;
        gap: 10px;
        align-items: end;
      }

      .search-criteria-form {
        display: grid;
        grid-template-columns: repeat(7, minmax(140px, 1fr));
        gap: 10px;
        align-items: end;
      }

      .search-criteria-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 12px;
      }

      .criteria-status {
        min-height: 20px;
        font-size: 0.86rem;
        color: var(--muted);
      }

      .criteria-status.error {
        color: var(--error);
      }

      .criteria-status.is-hidden {
        visibility: hidden;
      }

      .cta-find-jobs {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-width: 180px;
        padding: 12px 18px;
        font-size: 0.98rem;
      }

      .btn-spinner {
        display: none;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.42);
        border-top-color: rgba(255, 255, 255, 0.95);
      }

      .cta-find-jobs.is-loading .btn-spinner {
        display: inline-block;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--muted);
      }

      input,
      select {
        width: 100%;
        border-radius: 12px;
        border: 1px solid var(--line-strong);
        background: rgba(255, 255, 255, 0.9);
        color: var(--ink);
        padding: 11px 12px;
        font: inherit;
        font-size: 14px;
      }

      input[type="checkbox"] {
        width: auto;
        padding: 0;
        border-radius: 6px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 12px 10px;
        border-bottom: 1px solid rgba(216, 207, 189, 0.8);
        vertical-align: top;
        text-align: left;
        font-size: 14px;
      }

      th {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .search-name {
        font-weight: 700;
        font-size: 15px;
      }

      .search-link-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .search-name-link {
        color: inherit;
        text-decoration: none;
      }

      .search-name-link:hover {
        text-decoration: underline;
      }

      .external-link-icon {
        font-size: 12px;
        color: var(--muted);
      }

      .status-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        border: 1px solid rgba(0, 0, 0, 0.2);
        flex: 0 0 auto;
      }

      .status-dot[data-tone="ok"] {
        background: #2e8b57;
      }

      .status-dot[data-tone="warn"] {
        background: #d39c2f;
      }

      .status-dot[data-tone="error"] {
        background: #b64040;
      }

      .status-dot[data-tone="muted"] {
        background: #a3a3a3;
      }

      .search-row-hotspot[data-open-jobs-row] {
        cursor: pointer;
      }

      .search-row-hotspot[data-open-jobs-row]:hover {
        background: rgba(255, 255, 255, 0.5);
      }

      .search-totals-row td {
        font-weight: 700;
        background: rgba(229, 240, 234, 0.45);
      }

      .main-tabs {
        margin-top: 14px;
        display: inline-flex;
        gap: 4px;
        padding: 4px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.62);
      }

      .main-tab {
        background: transparent;
        border: 1px solid transparent;
        color: var(--muted);
        border-radius: 10px;
        padding: 9px 14px;
        font-weight: 700;
      }

      .main-tab.active {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--button-ink);
      }

      .sub-tabs {
        display: inline-flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .sub-tab {
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid var(--line-strong);
        color: var(--ink);
        border-radius: 999px;
        padding: 8px 14px;
        font-weight: 700;
      }

      .sub-tab.active {
        background: var(--accent-soft);
        border-color: rgba(27, 58, 51, 0.35);
        color: var(--accent);
        box-shadow: inset 0 0 0 1px rgba(27, 58, 51, 0.1);
      }

      .sub-tab:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .view-dropdown {
        display: inline-flex;
        position: relative;
      }

      .view-dropdown.active .view-select {
        background-color: var(--accent-soft);
        background-image: url('data:image/svg+xml;charset=UTF-8,<svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1.5L6 6.5L11 1.5" stroke="%231b3a33" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 12px;
        border-color: rgba(27, 58, 51, 0.35);
        color: var(--accent);
      }

      .view-select {
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid var(--line-strong);
        color: var(--ink);
        border-radius: 999px;
        padding: 8px 14px;
        padding-right: 32px;
        font-weight: 700;
        font-size: 14px;
        font-family: inherit;
        cursor: pointer;
        appearance: none;
        background-image: url('data:image/svg+xml;charset=UTF-8,<svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1.5L6 6.5L11 1.5" stroke="%23333" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 12px;
      }

      .view-select:hover {
        background-color: rgba(255, 255, 255, 1);
      }

      .view-select:focus {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      .view-select option:disabled {
        color: #999;
      }

      .sort-controls {
        display: flex;
        gap: 4px;
      }

      .sort-controls .sub-tab {
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 600;
        opacity: 0.7;
        transition: opacity 0.2s;
      }

      .sort-controls .sub-tab:hover:not(:disabled) {
        opacity: 1;
      }

      .sort-controls .sub-tab.active {
        opacity: 1;
      }

      .filter-chips {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .filter-chip {
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid var(--line);
        color: var(--ink);
        border-radius: 12px;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 700;
        text-align: center;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .filter-chip.active {
        color: var(--accent);
        border-color: rgba(27, 58, 51, 0.32);
        background: var(--accent-soft);
      }

      .filter-chip:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .filter-chip-main {
        font-weight: 700;
        color: inherit;
      }

      .tag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 7px 11px;
        border: 1px solid var(--line);
        font-size: 13px;
        background: rgba(255, 255, 255, 0.74);
        color: var(--muted);
      }

      .tag[data-tone="strong"] {
        color: var(--ink);
        background: rgba(255, 255, 255, 0.92);
      }

      .tag[data-bucket="high_signal"] {
        color: var(--high);
        border-color: rgba(23, 100, 58, 0.25);
        background: rgba(228, 246, 236, 0.85);
      }

      .tag[data-bucket="review_later"] {
        color: var(--review);
        border-color: rgba(138, 90, 10, 0.25);
        background: rgba(250, 242, 227, 0.9);
      }

      .search-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .search-actions button {
        padding: 8px 10px;
        font-size: 13px;
      }

      .search-header {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .search-controls-row {
        margin-top: 8px;
      }

      .search-welcome-toast {
        position: fixed;
        top: 20px;
        right: 20px;
        width: min(360px, calc(100vw - 24px));
        padding: 10px 34px 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(27, 58, 51, 0.2);
        background: rgba(232, 244, 238, 0.96);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        z-index: 95;
        box-shadow: 0 10px 28px rgba(14, 29, 27, 0.18);
        animation: search-toast-slide-in 220ms ease-out;
      }

      .search-welcome-toast-text {
        font-size: 13px;
        line-height: 1.4;
      }

      .search-welcome-toast-actions {
        margin-left: 0;
        justify-content: flex-end;
      }

      .search-welcome-toast-close {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 22px;
        height: 22px;
        border: 1px solid rgba(27, 58, 51, 0.25);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.76);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        line-height: 1;
      }

      @keyframes search-toast-slide-in {
        from {
          opacity: 0;
          transform: translateX(28px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      .auth-flow-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(14, 29, 27, 0.28);
        z-index: 90;
      }

      .auth-flow-modal {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: min(560px, calc(100vw - 24px));
        border: 1px solid var(--line-strong);
        border-radius: 14px;
        background: #fffdf9;
        box-shadow: 0 20px 50px rgba(14, 29, 27, 0.22);
        z-index: 91;
        padding: 16px;
      }

      .auth-flow-title {
        margin: 0;
        font-size: 22px;
      }

      .auth-flow-steps {
        margin: 10px 0 0;
        padding-left: 18px;
        color: var(--muted);
      }

      .auth-flow-steps li + li {
        margin-top: 4px;
      }

      .auth-flow-status {
        margin-top: 10px;
        border: 1px solid rgba(27, 58, 51, 0.2);
        background: rgba(232, 244, 238, 0.66);
        color: var(--accent);
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 14px;
      }

      .auth-flow-status.error {
        border-color: rgba(182, 64, 64, 0.32);
        background: rgba(252, 237, 237, 0.9);
        color: var(--error);
      }

      .searches-shell {
        margin-top: 18px;
      }

      .searches-tabs-row {
        display: flex;
        justify-content: flex-end;
        padding: 0 14px;
        margin-bottom: -1px;
      }

      .search-state-tabs {
        display: inline-flex;
        align-items: flex-end;
        gap: 6px;
        border-bottom: 1px solid var(--line);
      }

      .search-state-tab {
        border: 1px solid var(--line);
        border-bottom: 0;
        border-radius: 10px 10px 0 0;
        background: rgba(255, 252, 245, 0.96);
        color: var(--ink);
        padding: 8px 14px;
        font-weight: 700;
        white-space: nowrap;
      }

      .search-state-tab.active {
        background: var(--accent);
        color: var(--button-ink);
        border-color: var(--accent);
      }

      .run-cadence-control {
        min-width: 300px;
      }

      .source-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 40px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--line-strong);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        background: rgba(255, 255, 255, 0.9);
        font-weight: 700;
      }

      .source-badge[data-source-kind="li"] {
        color: #21406b;
        border-color: rgba(33, 64, 107, 0.28);
        background: rgba(233, 241, 251, 0.9);
      }

      .source-badge[data-source-kind="bi"] {
        color: #18633f;
        border-color: rgba(24, 99, 63, 0.28);
        background: rgba(229, 245, 236, 0.9);
      }

      .source-badge[data-source-kind="wf"] {
        color: #2f4d95;
        border-color: rgba(47, 77, 149, 0.28);
        background: rgba(235, 241, 252, 0.9);
      }

      .source-badge[data-source-kind="ah"] {
        color: #8a4f12;
        border-color: rgba(138, 79, 18, 0.28);
        background: rgba(252, 243, 232, 0.9);
      }

      .source-badge[data-source-kind="gg"] {
        color: #305999;
        border-color: rgba(48, 89, 153, 0.28);
        background: rgba(235, 243, 255, 0.9);
      }

      .source-badge[data-source-kind="id"] {
        color: #2f4f97;
        border-color: rgba(47, 79, 151, 0.28);
        background: rgba(235, 240, 255, 0.9);
      }

      .source-badge[data-source-kind="zr"] {
        color: #7b4514;
        border-color: rgba(123, 69, 20, 0.28);
        background: rgba(253, 241, 231, 0.9);
      }

      .source-badge[data-source-kind="ro"] {
        color: #2f5f57;
        border-color: rgba(47, 95, 87, 0.28);
        background: rgba(233, 246, 243, 0.9);
      }

      .source-badge[data-source-kind="mixed"] {
        color: #5f6368;
        border-color: rgba(95, 99, 104, 0.28);
        background: rgba(241, 242, 244, 0.9);
      }

      .search-empty {
        margin-top: 12px;
      }

      .onboarding-card {
        border-color: rgba(27, 58, 51, 0.22);
      }

      .onboarding-title {
        margin: 4px 0 0;
        font-size: 24px;
        line-height: 1.2;
      }

      .onboarding-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .onboarding-lede {
        margin-top: 8px;
        max-width: 940px;
      }

      .onboarding-stepper {
        margin-top: 14px;
        display: grid;
        gap: 12px;
      }

      .onboarding-step {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.75);
      }

      .onboarding-step-label {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .onboarding-step h4 {
        margin: 6px 0 0;
        font-size: 18px;
        line-height: 1.25;
      }

      .onboarding-source-list {
        margin-top: 10px;
        display: grid;
        gap: 8px;
      }

      .onboarding-source-group {
        margin: 0;
        border: 0;
        background: transparent;
        padding: 0;
      }

      .onboarding-source-group summary {
        cursor: pointer;
        font-weight: 700;
        color: var(--ink);
      }

      .onboarding-source-row {
        border: 1px solid rgba(216, 207, 189, 0.9);
        border-radius: 12px;
        padding: 9px 10px;
        background: rgba(255, 255, 255, 0.82);
      }

      .onboarding-source-row.compact {
        padding: 8px 10px;
      }

      .onboarding-source-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .onboarding-source-main {
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 14px;
        color: var(--ink);
      }

      .onboarding-source-name {
        font-weight: 700;
      }

      .onboarding-source-meta {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        margin-left: auto;
        flex: 0 0 auto;
        min-height: 24px;
        gap: 6px;
      }

      .auth-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 700;
        border: 1px solid var(--line-strong);
        color: var(--muted);
        background: rgba(255, 255, 255, 0.9);
      }

      .auth-chip[data-auth="required"] {
        color: #7a4a16;
        border-color: rgba(122, 74, 22, 0.34);
        background: rgba(253, 242, 228, 0.95);
      }

      .auth-chip[data-auth="none"] {
        color: #1f6a44;
        border-color: rgba(31, 106, 68, 0.32);
        background: rgba(234, 247, 240, 0.95);
      }

      .status-chip.compact {
        display: inline-flex;
        align-items: center;
        height: 24px;
        font-size: 12px;
        gap: 6px;
      }

      .onboarding-actions {
        margin-top: 10px;
      }

      .onboarding-source-actions {
        margin-top: 8px;
        align-items: center;
      }

      .onboarding-overflow-menu {
        position: relative;
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
      }

      .onboarding-overflow-menu summary {
        list-style: none;
        cursor: pointer;
        border: 0;
        border-radius: 8px;
        width: 24px;
        height: 24px;
        padding: 0;
        color: var(--muted);
        background: transparent;
        font-size: 16px;
        font-weight: 700;
        line-height: 1;
        user-select: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .onboarding-overflow-menu summary::-webkit-details-marker {
        display: none;
      }

      .onboarding-overflow-menu summary:hover {
        background: rgba(27, 58, 51, 0.08);
      }

      .onboarding-overflow-menu-items {
        position: absolute;
        right: 0;
        top: calc(100% + 6px);
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #fffdf9;
        box-shadow: 0 8px 20px rgba(14, 29, 27, 0.12);
        padding: 6px;
        z-index: 5;
      }

      .onboarding-progress {
        margin-top: 8px;
        font-size: 13px;
        color: var(--muted);
      }

      .onboarding-status {
        margin-top: 12px;
        border: 1px solid rgba(27, 58, 51, 0.2);
        background: rgba(232, 244, 238, 0.66);
        color: var(--accent);
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 14px;
      }

      .onboarding-status.error {
        border-color: rgba(147, 52, 52, 0.28);
        background: rgba(252, 239, 239, 0.9);
        color: var(--error);
      }

      .onboarding-source-empty {
        color: var(--muted);
        font-size: 14px;
      }

      .onboarding-checklist {
        margin-top: 10px;
        display: grid;
        gap: 8px;
      }

      .onboarding-checklist label {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr);
        align-items: start;
        column-gap: 10px;
        font-size: 14px;
        color: var(--ink);
      }

      .onboarding-checklist .consent-copy {
        display: inline-block;
        line-height: 1.5;
      }

      .onboarding-checklist input[type="checkbox"] {
        margin-top: 3px;
      }

      .onboarding-checklist a {
        font-weight: 600;
      }

      .onboarding-blocked-note {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
      }

      .jobs-layout {
        margin-top: 14px;
        display: grid;
        grid-template-columns: minmax(320px, 1fr) minmax(0, 2fr);
        gap: 18px;
        min-width: 0;
      }

      .jobs-controls-panel {
        margin-top: 8px;
      }

      .jobs-view-panel {
        margin-top: 12px;
      }

      .jobs-view-nav {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }

      .jobs-controls-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      .viewing-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }

      .viewing-label {
        font-size: 14px;
        font-weight: 700;
        color: var(--ink);
        margin-right: 4px;
      }

      .disclosure-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: transparent;
        border: 0;
        padding: 0;
        color: var(--ink);
        font-weight: 700;
      }

      .disclosure-caret {
        width: 14px;
        display: inline-flex;
        justify-content: center;
        color: var(--muted);
      }

      .ranked-controls {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .controls-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .controls-label {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        font-weight: 700;
      }

      .review-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 16px;
        align-items: start;
      }

      .review-title {
        margin: 0;
        font-size: clamp(30px, 4.2vw, 58px);
        line-height: 1.02;
        letter-spacing: -0.01em;
        overflow-wrap: anywhere;
      }

      .tag-row {
        margin-top: 14px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .review-controls {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: flex-end;
        flex-wrap: wrap;
      }

      .arrow-btn {
        width: 42px;
        height: 42px;
        border-radius: 999px;
        border: 1px solid var(--line-strong);
        background: rgba(255, 255, 255, 0.92);
        color: var(--ink);
        font-size: 22px;
        line-height: 1;
        padding: 0;
      }

      .position-indicator {
        min-width: 78px;
        text-align: center;
        color: var(--muted);
      }

      .decision-row {
        margin-top: 16px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
      }

      .decision-btn {
        border: 2px solid transparent;
        border-radius: 12px;
        padding: 10px 14px;
        font-weight: 700;
        background: rgba(255, 255, 255, 0.95);
        color: var(--ink);
      }

      .decision-btn[data-status="applied"] {
        border-color: rgba(30, 92, 63, 0.45);
      }

      .decision-btn[data-status="skip_for_now"] {
        border-color: rgba(107, 76, 128, 0.4);
      }

      .decision-btn[data-status="rejected"] {
        border-color: rgba(122, 29, 29, 0.4);
      }

      .decision-btn.active[data-status="applied"] {
        background: var(--applied);
        color: #f3fff9;
      }

      .decision-btn.active[data-status="skip_for_now"] {
        background: var(--skip);
        color: #fbf6ff;
      }

      .decision-btn.active[data-status="rejected"] {
        background: var(--reject);
        color: #fff4f4;
      }

      .review-body {
        margin-top: 16px;
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
        gap: 14px;
      }

      .review-sidebar {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .queue-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .queue-item {
        width: 100%;
        text-align: left;
        background: rgba(255, 255, 255, 0.82);
        color: var(--ink);
        border: 1px solid var(--line);
        padding: 10px 12px;
        border-radius: 14px;
      }

      .queue-item.active {
        border-color: rgba(23, 100, 58, 0.35);
        box-shadow: inset 0 0 0 1px rgba(23, 100, 58, 0.18);
      }

      .queue-item-header {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
      }

      .queue-item-title {
        font-size: 14px;
        line-height: 1.3;
        font-weight: 700;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .queue-item-score {
        font-size: 13px;
        white-space: nowrap;
        color: var(--high);
      }

      .queue-item-meta,
      .muted {
        color: var(--muted);
      }

      .queue-item-meta {
        margin-top: 6px;
        font-size: 13px;
        line-height: 1.4;
      }

      .reason-list {
        margin: 12px 0 0;
        padding-left: 18px;
      }

      .reason-list li + li {
        margin-top: 8px;
      }

      .feedback {
        margin-top: 12px;
        font-size: 13px;
        color: var(--muted);
        min-height: 1.2em;
      }

      .feedback.error {
        color: var(--error);
      }

      @media (max-width: 1040px) {
        .jobs-layout {
          grid-template-columns: 1fr;
        }

        .review-head {
          grid-template-columns: 1fr;
        }

        .review-controls {
          justify-content: flex-start;
        }

        .review-body {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 760px) {
        h1 {
          font-size: 28px;
        }

        .search-form,
        .search-criteria-form,
        .meta-grid {
          grid-template-columns: 1fr;
        }

        .search-criteria-actions {
          flex-direction: column;
          align-items: stretch;
        }

        .onboarding-source-top {
          flex-direction: column;
          align-items: flex-start;
        }

        .cta-find-jobs {
          width: 100%;
        }

        .search-welcome-toast {
          top: 12px;
          right: 12px;
          width: calc(100vw - 24px);
        }

        .searches-tabs-row {
          padding: 0;
          justify-content: flex-start;
        }

        .search-state-tabs {
          width: 100%;
          overflow-x: auto;
        }

        table,
        thead,
        tbody,
        th,
        td,
        tr {
          display: block;
        }

        thead {
          display: none;
        }

        td {
          padding: 8px 0;
          border-bottom: 0;
        }

        tr + tr {
          border-top: 1px solid rgba(216, 207, 189, 0.8);
          margin-top: 10px;
          padding-top: 10px;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="panel">
        <div id="app"></div>
      </div>
    </div>
    <script>
      let dashboard = ${dashboardJson};
      let selectedSourceFilter = "all";
      let selectedTab = "jobs";
      let selectedJobsView = "all";
      let selectedJobsSort = "score";
      let jobsFiltersCollapsed = true;
      let selectedJobsPage = 1;
      let selectedSearchStateFilter = "enabled";
      let selectedSearchRunCadence = "12h";
      let searchesWelcomeToastDismissed = false;
      let selectedJobId = dashboard.queue[0] ? dashboard.queue[0].id : null;
      let editingSourceId = null;
      let sourceFormOpen = false;
      let feedback = "";
      let feedbackError = false;
      let criteriaFeedback = "";
      let criteriaFeedbackError = false;
      let busy = false;
      let criteriaBusy = false;
      let onboardingBusy = false;
      let onboardingStepStatus = "";
      let onboardingStepStatusError = false;
      let onboardingVerifyProgress = "";
      let onboardingConsentDraft = null;
      let onboardingActiveSourceId = null;
      let onboardingSourcesCollapsed = false;
      let authFlowSourceId = null;
      let authFlowMessage = "";
      let authFlowError = false;
      let authFlowBusy = false;
      const narrataConnectEnabled = ${narrataConnectEnabled ? "true" : "false"};
      const wellfoundEnabled = ${wellfoundEnabled ? "true" : "false"};
      const remoteokEnabled = ${remoteokEnabled ? "true" : "false"};
      const onboardingEnabled =
        dashboard.featureFlags && dashboard.featureFlags.onboardingWizard !== false;

      const app = document.getElementById("app");
      const JOBS_PAGE_SIZE = 10;
      const SEARCHES_WELCOME_TOAST_SEEN_KEY = "jobFinder.searchesWelcomeToastSeen.v2";

      if (onboardingEnabled && dashboard.onboarding && dashboard.onboarding.completed !== true) {
        selectedTab = "searches";
      }

      try {
        const storedCadence = window.localStorage.getItem("jobFinder.searchRunCadence");
        selectedSearchRunCadence = normalizeRunCadence(storedCadence);
      } catch {
        selectedSearchRunCadence = "12h";
      }

      try {
        searchesWelcomeToastDismissed =
          window.localStorage.getItem(SEARCHES_WELCOME_TOAST_SEEN_KEY) === "1";
      } catch {
        searchesWelcomeToastDismissed = false;
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function filterBySource(jobs) {
        const items = Array.isArray(jobs) ? jobs : [];
        if (selectedSourceFilter === "all") {
          return items;
        }

        const matchingSourceIds = new Set(
          visibleSources()
            .filter((source) => sourceKindFromType(source.type) === selectedSourceFilter)
            .map((source) => source.id)
        );
        if (matchingSourceIds.size === 0) {
          return [];
        }

        return items.filter(
          (job) =>
            Array.isArray(job.sourceIds) &&
            job.sourceIds.some((sourceId) => matchingSourceIds.has(sourceId))
        );
      }

      function onboardingData() {
        return dashboard && typeof dashboard.onboarding === "object" ? dashboard.onboarding : {};
      }

      function onboardingConsentFromData() {
        const onboarding = onboardingData();
        const consent =
          onboarding &&
          onboarding.consent &&
          typeof onboarding.consent === "object" &&
          !Array.isArray(onboarding.consent)
            ? onboarding.consent
            : {};
        return {
          termsAccepted: Boolean(consent.termsAccepted),
          privacyAccepted: Boolean(consent.privacyAccepted),
          rateLimitPolicyAccepted: Boolean(consent.rateLimitPolicyAccepted),
          tosRiskAccepted: Boolean(consent.tosRiskAccepted),
          acceptedAt: consent.acceptedAt || null
        };
      }

      function onboardingConsentForRender() {
        return onboardingConsentDraft || onboardingConsentFromData();
      }

      function isOnboardingConsentComplete(consent = onboardingConsentForRender()) {
        return Boolean(
          consent &&
            consent.termsAccepted &&
            consent.privacyAccepted &&
            consent.rateLimitPolicyAccepted &&
            consent.tosRiskAccepted
        );
      }

      function onboardingChecksBySourceId() {
        const onboarding = onboardingData();
        const checks = onboarding && onboarding.checks && typeof onboarding.checks === "object"
          ? onboarding.checks
          : {};
        return checks.sources && typeof checks.sources === "object" ? checks.sources : {};
      }

      function sourceRequiresAuth(source) {
        return Boolean(source && source.authRequired);
      }

      function onboardingCandidateSources() {
        return (Array.isArray(dashboard.sources) ? dashboard.sources : []).filter(
          (source) => source && isSourceTypeEnabled(source.type)
        );
      }

      function defaultOnboardingSelection(sourceList) {
        return sourceList.filter((source) => !sourceRequiresAuth(source)).map((source) => source.id);
      }

      function onboardingSelectedSourceIdsForRender() {
        const onboarding = onboardingData();
        const sourceChecks = onboardingChecksBySourceId();
        const hasChecks = Object.keys(sourceChecks).length > 0;
        const hasConfiguredSources = Boolean(onboarding && onboarding.sourcesConfiguredAt);
        const isFirstRunSelection =
          onboardingEnabled &&
          onboarding &&
          onboarding.completed !== true &&
          !hasChecks &&
          !onboarding.firstRunAt &&
          !hasConfiguredSources;
        if (isFirstRunSelection) {
          return defaultOnboardingSelection(onboardingCandidateSources());
        }

        const saved = onboardingCandidateSources()
          .filter((source) => source.enabled)
          .map((source) => source.id);
        if (saved.length > 0) {
          return saved;
        }
        if (hasConfiguredSources) {
          return [];
        }
        return defaultOnboardingSelection(onboardingCandidateSources());
      }

      function onboardingStatusMeta(status) {
        if (status === "pass") {
          return { label: "Verified", tone: "ok" };
        }
        if (status === "fail") {
          return { label: "Blocked", tone: "error" };
        }
        if (status === "warn") {
          return { label: "Needs check", tone: "warn" };
        }
        return { label: "Pending", tone: "warn" };
      }

      function failedAuthSourceIds(checksBySourceId, selectedSourceIds = null) {
        const selectedSet = Array.isArray(selectedSourceIds)
          ? new Set(
              selectedSourceIds
                .map((value) => String(value || "").trim())
                .filter(Boolean)
            )
          : null;
        return onboardingCandidateSources()
          .filter((source) => sourceRequiresAuth(source))
          .filter((source) => (selectedSet ? selectedSet.has(source.id) : true))
          .filter((source) => Boolean(checksBySourceId[source.id]))
          .filter((source) => {
            const status = checksBySourceId[source.id] && checksBySourceId[source.id].status
              ? String(checksBySourceId[source.id].status).toLowerCase()
              : "warn";
            return status !== "pass";
          })
          .map((source) => source.id);
      }

      function isOnboardingIncomplete() {
        return onboardingEnabled && onboardingData().completed !== true;
      }

      function jobHasVisibleSource(job) {
        if (!Array.isArray(job?.sourceIds) || job.sourceIds.length === 0) {
          return true;
        }
        return sourceAttributions(job).length > 0;
      }

      function activeQueueAllSources() {
        return (Array.isArray(dashboard.queue) ? dashboard.queue : []).filter(jobHasVisibleSource);
      }

      function appliedQueueAllSources() {
        return (Array.isArray(dashboard.appliedQueue) ? dashboard.appliedQueue : []).filter(
          jobHasVisibleSource
        );
      }

      function skippedQueueAllSources() {
        return (Array.isArray(dashboard.skippedQueue) ? dashboard.skippedQueue : []).filter(
          jobHasVisibleSource
        );
      }

      function rejectedQueueAllSources() {
        return (Array.isArray(dashboard.rejectedQueue) ? dashboard.rejectedQueue : []).filter(
          jobHasVisibleSource
        );
      }

      function jobsForSelectedViewAllSources() {
        if (selectedJobsView === "applied") {
          return appliedQueueAllSources();
        }

        if (selectedJobsView === "skipped") {
          return skippedQueueAllSources();
        }

        if (selectedJobsView === "rejected") {
          return rejectedQueueAllSources();
        }

        const activeJobs = activeQueueAllSources();

        if (selectedJobsView === "new") {
          return activeJobs.filter((job) => job?.status === "new");
        }

        if (selectedJobsView === "best_match") {
          return activeJobs.filter((job) => job?.bucket === "high_signal");
        }

        // "all" - return all active jobs (new + viewed)
        return activeJobs;
      }

      function rankJobs(jobs) {
        const items = Array.isArray(jobs) ? [...jobs] : [];
        const dateValue = (job) => {
          const posted = Date.parse(typeof job?.postedAt === "string" ? job.postedAt : "");
          if (Number.isFinite(posted)) {
            return posted;
          }

          const retrieved = Date.parse(typeof job?.updatedAt === "string" ? job.updatedAt : "");
          return Number.isFinite(retrieved) ? retrieved : 0;
        };

        const scoreValue = (job) => {
          const parsed = Number(job?.score);
          return Number.isFinite(parsed) ? parsed : -1;
        };

        items.sort((left, right) => {
          if (selectedJobsSort === "date") {
            const freshnessDiff = dateValue(right) - dateValue(left);
            if (freshnessDiff !== 0) {
              return freshnessDiff;
            }

            const scoreDiff = scoreValue(right) - scoreValue(left);
            if (scoreDiff !== 0) {
              return scoreDiff;
            }
          } else {
            const scoreDiff = scoreValue(right) - scoreValue(left);
            if (scoreDiff !== 0) {
              return scoreDiff;
            }

            const freshnessDiff = dateValue(right) - dateValue(left);
            if (freshnessDiff !== 0) {
              return freshnessDiff;
            }
          }

          return String(left?.title || "").localeCompare(String(right?.title || ""));
        });

        return items;
      }

      function jobsForCurrentView() {
        return rankJobs(filterBySource(jobsForSelectedViewAllSources()));
      }

      function ensureSelectedJob() {
        const queue = jobsForCurrentView();

        if (queue.length === 0) {
          selectedJobId = null;
          return null;
        }

        const selected = queue.find((job) => job.id === selectedJobId);
        if (selected) {
          return selected;
        }

        selectedJobId = queue[0].id;
        return queue[0];
      }

      function currentJob() {
        return ensureSelectedJob();
      }

      function currentJobPosition() {
        const jobs = jobsForCurrentView();
        if (!jobs.length || !selectedJobId) {
          return {
            index: -1,
            total: jobs.length
          };
        }

        return {
          index: jobs.findIndex((job) => job.id === selectedJobId),
          total: jobs.length
        };
      }

      function formatBucket(bucket) {
        return bucket ? bucket.replaceAll("_", " ") : "unscored";
      }

      function formatValue(value, fallback) {
        return typeof value === "string" && value.trim() ? value : fallback;
      }

      function formatRemotePreference(value) {
        const normalized = typeof value === "string" ? value.trim() : "";

        if (normalized === "onsite_ok") {
          return "Any arrangement";
        }

        if (normalized === "remote_friendly") {
          return "Remote-friendly";
        }

        if (!normalized) {
          return "Not set";
        }

        return normalized.replaceAll("_", " ");
      }

      function parseCurrencyToNumber(value) {
        const normalized = String(value || "").replace(/[^0-9]/g, "");
        if (!normalized) {
          return null;
        }
        const parsed = Number(normalized);
        return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
      }

      function parseTermList(value) {
        const seen = new Set();
        const terms = [];

        for (const rawSegment of String(value || "").split(",")) {
          const term = rawSegment.trim().toLowerCase();
          if (!term || seen.has(term)) {
            continue;
          }
          seen.add(term);
          terms.push(term);
        }

        return terms;
      }

      function formatProfileProvider(provider, mode) {
        if (provider === "legacy_profile") {
          return "Standalone (profile.json)";
        }
        if (provider === "my_goals") {
          return "Standalone (my-goals.json)";
        }
        if (provider === "narrata") {
          return mode === "file" ? "Narrata (file sync)" : "Narrata";
        }
        return "Unknown";
      }

      function formatStatus(status) {
        if (status === "viewed" || status === "applied" || status === "rejected") {
          return status;
        }

        if (status === "skip_for_now") {
          return "skip for now";
        }

        return "new";
      }

      function formatSourceType(value) {
        const normalized = typeof value === "string" ? value.trim() : "";
        if (!normalized) {
          return "source";
        }

        if (normalized === "linkedin_capture_file") {
          return "LinkedIn";
        }

        if (normalized === "builtin_search") {
          return "Built In";
        }

        if (normalized === "wellfound_search") {
          return "Wellfound";
        }

        if (normalized === "ashby_search") {
          return "Ashby";
        }

        if (normalized === "google_search") {
          return "Google";
        }

        if (normalized === "indeed_search") {
          return "Indeed";
        }

        if (normalized === "ziprecruiter_search") {
          return "ZipRecruiter";
        }

        if (normalized === "remoteok_search") {
          return "RemoteOK";
        }

        return normalized.replaceAll("_", " ");
      }

      function sourceKindFromType(value) {
        if (value === "linkedin_capture_file") {
          return "li";
        }

        if (value === "builtin_search") {
          return "bi";
        }

        if (value === "wellfound_search") {
          return "wf";
        }

        if (value === "ashby_search") {
          return "ah";
        }

        if (value === "google_search") {
          return "gg";
        }

        if (value === "indeed_search") {
          return "id";
        }

        if (value === "ziprecruiter_search") {
          return "zr";
        }

        if (value === "levelsfyi_search") {
          return "lf";
        }

        if (value === "yc_jobs") {
          return "yc";
        }

        if (value === "remoteok_search") {
          return "ro";
        }

        return "unknown";
      }

      function sourceKindLabel(kind) {
        if (kind === "bi") {
          return "Built In";
        }

        if (kind === "li") {
          return "LinkedIn";
        }

        if (kind === "wf") {
          return "Wellfound";
        }

        if (kind === "ah") {
          return "Ashby";
        }

        if (kind === "gg") {
          return "Google";
        }

        if (kind === "id") {
          return "Indeed";
        }

        if (kind === "zr") {
          return "ZipRecruiter";
        }

        if (kind === "lf") {
          return "Levels.fyi";
        }

        if (kind === "yc") {
          return "YC Jobs";
        }

        if (kind === "ro") {
          return "RemoteOK";
        }

        if (kind === "mixed") {
          return "Multiple";
        }

        return "Unknown";
      }

      function sourceKindsForJob(job) {
        const kinds = new Set(
          sourceAttributions(job).map((source) => sourceKindFromType(source.type))
        );

        if (kinds.size === 0) {
          return {
            key: "unknown",
            label: "Unknown"
          };
        }

        if (kinds.size > 1) {
          return {
            key: "mixed",
            label: sourceKindLabel("mixed")
          };
        }

        const key = [...kinds][0];
        return {
          key,
          label: sourceKindLabel(key)
        };
      }

      function isSourceTypeEnabled(type) {
        if (type === "wellfound_search") {
          return wellfoundEnabled;
        }

        if (type === "remoteok_search") {
          return remoteokEnabled;
        }

        return true;
      }

      function visibleSources() {
        return (Array.isArray(dashboard.sources) ? dashboard.sources : []).filter(
          (source) => source && source.enabled !== false && isSourceTypeEnabled(source.type)
        );
      }

      function visibleSourceIds() {
        return visibleSources().map((source) => source.id);
      }

      function visibleSourceKinds() {
        return [...new Set(visibleSources().map((source) => sourceKindFromType(source.type)))];
      }

      function normalizeRunCadence(value) {
        const normalized = String(value || "").trim().toLowerCase();
        if (["12h", "daily", "weekly", "cached"].includes(normalized)) {
          return normalized;
        }
        return "12h";
      }

      function runCadencePayload() {
        if (selectedSearchRunCadence === "cached") {
          return { refreshProfile: "mock" };
        }
        if (selectedSearchRunCadence === "weekly") {
          return { refreshProfile: "safe", cacheTtlHours: 168 };
        }
        if (selectedSearchRunCadence === "daily") {
          return { refreshProfile: "safe", cacheTtlHours: 24 };
        }
        return { refreshProfile: "safe", cacheTtlHours: 12 };
      }

      function formatDurationFromNow(value) {
        const targetMs = Date.parse(String(value || ""));
        if (!Number.isFinite(targetMs)) {
          return "Unavailable";
        }

        const deltaMs = targetMs - Date.now();
        if (deltaMs <= 0) {
          return "Now";
        }

        const totalMinutes = Math.ceil(deltaMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0 && minutes > 0) {
          return hours + "h " + minutes + "m";
        }
        if (hours > 0) {
          return hours + "h";
        }
        return minutes + "m";
      }

      function formatFreshness(job) {
        const postedAt = typeof job?.postedAt === "string" ? job.postedAt : "";
        const updatedAt = typeof job?.updatedAt === "string" ? job.updatedAt : "";

        if (postedAt.trim()) {
          return "Posted " + formatTime(postedAt);
        }

        if (updatedAt.trim()) {
          return "Retrieved " + formatTime(updatedAt);
        }

        return "Freshness unknown";
      }

      function reviewLinkLabel(job) {
        return job.reviewTarget && job.reviewTarget.mode === "search"
          ? "Open Search"
          : job.reviewTarget?.url
            ? "Open Job"
            : "Link unavailable";
      }

      function formatTime(value) {
        if (!value) {
          return "Never";
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return String(value);
        }

        return parsed.toLocaleString();
      }

      function sourceById(sourceId) {
        return visibleSources().find((source) => source.id === sourceId) || null;
      }

      function sourceAttributions(job) {
        return (Array.isArray(job?.sourceIds) ? job.sourceIds : [])
          .map((sourceId) => sourceById(sourceId))
          .filter(Boolean);
      }

      function sourceNames(job) {
        return sourceAttributions(job).map((source) => source.name);
      }

      function formatPercent(numerator, denominator) {
        const top = Number(numerator);
        const bottom = Number(denominator);

        if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) {
          return "0%";
        }

        return Math.round((top / bottom) * 100) + "%";
      }

      function setFeedback(message, isError = false) {
        feedback = message;
        feedbackError = Boolean(isError);
        render();
      }

      function setCriteriaFeedback(message, isError = false) {
        criteriaFeedback = message;
        criteriaFeedbackError = Boolean(isError);
        render();
      }

      async function getJson(url, options) {
        let response;

        try {
          response = await fetch(url, options);
        } catch {
          throw new Error("The local dashboard server is offline. Restart it with 'npm run review' and reload this page.");
        }

        let payload = {};
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (!response.ok) {
          const error = new Error(payload.error || "The dashboard request failed.");
          error.payload = payload;
          throw error;
        }

        return payload;
      }

      async function refreshDashboard() {
        const payload = await getJson("/api/dashboard");
        dashboard = payload;
        onboardingConsentDraft = null;
        ensureSelectedJob();
        syncJobsPageToSelection();
        render();
      }

      async function applyProfileSource(action, payload = {}) {
        busy = true;
        setFeedback("Updating profile source...");

        try {
          await getJson("/api/profile/source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              ...payload
            })
          });
          await refreshDashboard();
          setFeedback("Profile source updated.");
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          busy = false;
          render();
        }
      }

      async function saveSearchCriteriaConfig() {
        const titleInput = document.getElementById("criteria-title");
        const keywordsInput = document.getElementById("criteria-keywords");
        const keywordModeInput = document.getElementById("criteria-keyword-mode");
        const includeTermsInput = document.getElementById("criteria-include-terms");
        const excludeTermsInput = document.getElementById("criteria-exclude-terms");
        const locationInput = document.getElementById("criteria-location");
        const salaryInput = document.getElementById("criteria-min-salary");
        const datePostedInput = document.getElementById("criteria-date-posted");

        const body = {
          title: titleInput ? titleInput.value : "",
          keywords: keywordsInput ? keywordsInput.value : "",
          keywordMode: keywordModeInput ? keywordModeInput.value : "and",
          includeTerms: parseTermList(includeTermsInput ? includeTermsInput.value : ""),
          excludeTerms: parseTermList(excludeTermsInput ? excludeTermsInput.value : ""),
          location: locationInput ? locationInput.value : "",
          minSalary: parseCurrencyToNumber(salaryInput ? salaryInput.value : ""),
          datePosted: datePostedInput ? datePostedInput.value : ""
        };

        busy = true;
        criteriaBusy = true;
        setCriteriaFeedback("Running searches...");

        try {
          await getJson("/api/search-criteria", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          let runAllPayload;
          const runPayloadBase = runCadencePayload();
          try {
            runAllPayload = await runAllSourcesAndSync(runPayloadBase);
          } catch (error) {
            const authSources = Array.isArray(error?.payload?.authSources)
              ? error.payload.authSources
              : [];
            const requiresAuthCheck = Boolean(error?.payload?.requiresAuthCheck);
            if (!requiresAuthCheck || authSources.length === 0) {
              throw error;
            }

            const recovered = await recoverAuthForSources(authSources);
            if (!recovered) {
              throw new Error(
                "Search run paused. Finish sign-in and pass access checks for blocked sources."
              );
            }
            runAllPayload = await runAllSourcesAndSync({
              ...runPayloadBase,
              skipAuthPreflight: true
            });
          }

          await refreshDashboard();
          setCriteriaFeedback(buildRunAllFeedback(runAllPayload));
        } catch (error) {
          setCriteriaFeedback(error.message, true);
        } finally {
          criteriaBusy = false;
          busy = false;
          render();
        }
      }

      function buildRunAllFeedback(runAllPayload) {
        const captures = Array.isArray(runAllPayload?.captures) ? runAllPayload.captures : [];
        const completedCaptures = captures.filter((capture) => capture?.status === "completed").length;
        const activeRankedCount = Number(dashboard?.profile?.activeCount || 0);
        return (
          "Done. Ran " +
          String(completedCaptures) +
          "/" +
          String(captures.length) +
          " sources. " +
          String(activeRankedCount) +
          " active ranked jobs."
        );
      }

      async function runAllSourcesAndSync(payload = {}) {
        const runAllPayload = await getJson("/api/sources/run-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!runAllPayload?.sync) {
          await getJson("/api/sync-score", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
        }
        return runAllPayload;
      }

      function selectedOnboardingSourceIdsFromDom() {
        return onboardingCandidateSources()
          .filter((source) => source && source.enabled)
          .map((source) => source.id);
      }

      function enabledOnboardingSourceIds() {
        return onboardingCandidateSources()
          .filter((source) => source && source.enabled)
          .map((source) => source.id);
      }

      function onboardingReadinessState(source, checksBySourceId = onboardingChecksBySourceId()) {
        if (!source || source.enabled !== true) {
          return {
            key: "disabled",
            label: "Disabled",
            tone: "muted"
          };
        }

        if (!sourceRequiresAuth(source)) {
          return {
            key: "ready",
            label: "Ready",
            tone: "ok"
          };
        }

        const check = checksBySourceId[source.id];
        const status = check && check.status ? String(check.status).toLowerCase() : "warn";
        if (status === "pass") {
          return {
            key: "ready",
            label: "Ready",
            tone: "ok"
          };
        }

        return {
          key: "not_authorized",
          label: "Issue detected",
          tone: "warn"
        };
      }

      function buildSourceOverflowMenu(sourceId, disableControls, action = "disable") {
        const normalizedAction = action === "enable" ? "enable" : "disable";
        const actionLabel = normalizedAction === "enable" ? "Enable" : "Disable";
        const dataAttr =
          normalizedAction === "enable"
            ? 'data-onboarding-enable-source'
            : 'data-onboarding-disable-source';
        return (
          '<details class="onboarding-overflow-menu" data-stop-row-open="1">' +
            '<summary aria-label="Source actions" title="Source actions" data-stop-row-open="1">&#x22EF;</summary>' +
            '<div class="onboarding-overflow-menu-items" data-stop-row-open="1">' +
              '<button class="secondary" ' +
                dataAttr +
                '="' +
                escapeHtml(sourceId) +
                '" data-stop-row-open="1"' +
                (disableControls ? " disabled" : "") +
                ">" +
                actionLabel +
                "</button>" +
            "</div>" +
          "</details>"
        );
      }

      async function saveEnabledOnboardingSources(sourceIds) {
        const normalizedSourceIds = [...new Set((Array.isArray(sourceIds) ? sourceIds : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean))];
        await getJson("/api/onboarding/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceIds: normalizedSourceIds,
            enabledSourceIds: normalizedSourceIds
          })
        });
      }

      function toggleOnboardingSourcesCollapsed() {
        onboardingSourcesCollapsed = !onboardingSourcesCollapsed;
        render();
      }

      function openSourceInBrowser(source) {
        if (!source || !source.searchUrl) {
          return;
        }
        window.open(source.searchUrl, "_blank", "noopener,noreferrer");
      }

      function openAuthFlowModal(sourceId, message = "") {
        authFlowSourceId = sourceId;
        authFlowMessage = String(message || "").trim();
        authFlowError = false;
        authFlowBusy = false;
        render();
      }

      function closeAuthFlowModal() {
        if (authFlowBusy) {
          return;
        }
        authFlowSourceId = null;
        authFlowMessage = "";
        authFlowError = false;
        authFlowBusy = false;
        render();
      }

      async function runAuthFlowCheck() {
        if (!authFlowSourceId || authFlowBusy) {
          return;
        }
        const source = sourceById(authFlowSourceId);
        if (!source) {
          closeAuthFlowModal();
          return;
        }

        authFlowBusy = true;
        authFlowMessage = "Checking access for " + source.name + "...";
        authFlowError = false;
        render();

        try {
          const passed = await verifySingleOnboardingSource(authFlowSourceId, {
            openSourceOnFail: false
          });
          if (passed) {
            closeAuthFlowModal();
            setFeedback(source.name + " is ready.");
            return;
          } else {
            authFlowMessage = source.name + " is not authorized. Sign in and retry.";
            authFlowError = true;
          }
        } finally {
          authFlowBusy = false;
          render();
        }
      }

      async function enableOnboardingSource(sourceId) {
        if (!ensureOnboardingConsentAccepted()) {
          return;
        }

        const source = onboardingCandidateSources().find((candidate) => candidate.id === sourceId);
        if (!source) {
          onboardingStepStatus = "Source not found.";
          onboardingStepStatusError = true;
          render();
          return;
        }

        onboardingBusy = true;
        onboardingActiveSourceId = sourceId;
        onboardingStepStatus = "Enabling " + source.name + "...";
        onboardingStepStatusError = false;
        render();

        try {
          const enabledIds = new Set(enabledOnboardingSourceIds());
          enabledIds.add(sourceId);
          await saveEnabledOnboardingSources([...enabledIds]);
          await refreshDashboard();
          if (sourceRequiresAuth(source)) {
            onboardingStepStatus = source.name + " enabled. Complete access check.";
            onboardingStepStatusError = false;
            openAuthFlowModal(
              sourceId,
              "Step 1: Open source. Step 2: Sign in. Step 3: Click I\u2019m logged in."
            );
          } else {
            onboardingStepStatus = source.name + " enabled.";
            onboardingStepStatusError = false;
          }
        } catch (error) {
          onboardingStepStatus = error.message;
          onboardingStepStatusError = true;
        } finally {
          onboardingBusy = false;
          render();
        }
      }

      async function disableOnboardingSource(sourceId) {
        if (!ensureOnboardingConsentAccepted()) {
          return;
        }

        onboardingBusy = true;
        onboardingActiveSourceId = sourceId;
        onboardingStepStatus = "Disabling source...";
        onboardingStepStatusError = false;
        render();

        try {
          const enabledIds = enabledOnboardingSourceIds().filter((id) => id !== sourceId);
          await saveEnabledOnboardingSources(enabledIds);
          await refreshDashboard();
          onboardingStepStatus = "Source disabled.";
          onboardingStepStatusError = false;
        } catch (error) {
          onboardingStepStatus = error.message;
          onboardingStepStatusError = true;
        } finally {
          onboardingBusy = false;
          render();
        }
      }

      async function verifySingleOnboardingSource(sourceId, options = {}) {
        if (!ensureOnboardingConsentAccepted()) {
          return false;
        }

        const source = onboardingCandidateSources().find((candidate) => candidate.id === sourceId);
        if (!source) {
          onboardingStepStatus = "Source not found.";
          onboardingStepStatusError = true;
          render();
          return false;
        }

        const authRequired = sourceRequiresAuth(source);
        onboardingBusy = true;
        onboardingActiveSourceId = sourceId;
        onboardingVerifyProgress = "Checking access for " + source.name + "...";
        onboardingStepStatus = "Checking access for " + source.name + "...";
        onboardingStepStatusError = false;
        render();

        try {
          const checkPayload = await getJson("/api/onboarding/check-source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceId,
              probeLive: !authRequired,
              authProbe: authRequired,
              closeWindowAfterProbe: authRequired
            })
          });
          const result =
            checkPayload && checkPayload.result && typeof checkPayload.result === "object"
              ? checkPayload.result
              : null;
          await refreshDashboard();
          const isPass =
            result && result.status && String(result.status).toLowerCase() === "pass";
          if (isPass) {
            onboardingStepStatus = source.name + " is ready.";
            onboardingStepStatusError = false;
            return true;
          }

          onboardingStepStatus = source.name + " is not authorized. Sign in and retry.";
          onboardingStepStatusError = true;
          if (options.openSourceOnFail !== false) {
            openSourceInBrowser(source);
          }
          return false;
        } catch (error) {
          onboardingStepStatus = error.message;
          onboardingStepStatusError = true;
          return false;
        } finally {
          onboardingBusy = false;
          onboardingVerifyProgress = "";
          render();
        }
      }

      async function recoverAuthForSources(authSources) {
        const blocked = Array.isArray(authSources) ? authSources : [];
        if (blocked.length === 0) {
          return true;
        }

        for (const blockedSource of blocked) {
          const sourceId = String(blockedSource?.sourceId || "").trim();
          if (!sourceId) {
            continue;
          }
          const source = sourceById(sourceId) || onboardingCandidateSources().find((item) => item.id === sourceId);
          const sourceName = source ? source.name : String(blockedSource?.sourceName || sourceId);

          window.alert(
            sourceName +
              " requires sign-in. The source page will open now. Sign in, then return and continue."
          );
          if (source) {
            openSourceInBrowser(source);
          }

          const readyToCheck = window.confirm(
            "After you sign in to " + sourceName + ", click OK to run access check."
          );
          if (!readyToCheck) {
            return false;
          }

          const passed = await verifySingleOnboardingSource(sourceId, {
            openSourceOnFail: false
          });
          if (!passed) {
            return false;
          }
        }

        return true;
      }

      function readOnboardingConsentFromDom() {
        const legal = document.getElementById("onboarding-consent-legal");
        const tosRisk = document.getElementById("onboarding-consent-tos-risk");
        return {
          termsAccepted: Boolean(legal && legal.checked),
          privacyAccepted: Boolean(legal && legal.checked),
          tosRiskAccepted: Boolean(tosRisk && tosRisk.checked),
          rateLimitPolicyAccepted: true
        };
      }

      function ensureOnboardingConsentAccepted() {
        if (isOnboardingConsentComplete()) {
          return true;
        }
        onboardingStepStatus =
          "Before continuing, review Terms + Privacy and accept the consent checkboxes in Step 1.";
        onboardingStepStatusError = true;
        render();
        return false;
      }

      async function saveOnboardingConsent() {
        const consent = readOnboardingConsentFromDom();
        onboardingConsentDraft = consent;

        if (!isOnboardingConsentComplete(consent)) {
          onboardingStepStatus =
            "Accept all required acknowledgements in Step 1 before continuing.";
          onboardingStepStatusError = true;
          render();
          return;
        }

        onboardingBusy = true;
        onboardingStepStatus = "Saving legal consent...";
        onboardingStepStatusError = false;
        render();

        try {
          await getJson("/api/onboarding/consent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(consent)
          });
          await refreshDashboard();
          onboardingStepStatus = "Saved. Next: choose sources in Step 1.";
          onboardingStepStatusError = false;
        } catch (error) {
          onboardingStepStatus = error.message;
          onboardingStepStatusError = true;
        } finally {
          onboardingBusy = false;
          render();
        }
      }

      async function saveOnboardingSetup() {
        if (!ensureOnboardingConsentAccepted()) {
          return;
        }
        const sourceIds = selectedOnboardingSourceIdsFromDom();

        if (sourceIds.length === 0) {
          onboardingStepStatus = "Choose at least one source to continue.";
          onboardingStepStatusError = true;
          render();
          return;
        }

        onboardingBusy = true;
        onboardingStepStatus = "Saving onboarding setup...";
        onboardingStepStatusError = false;
        render();

        try {
          const enabledSourceIds = sourceIds.filter((sourceId) => {
            const source = onboardingCandidateSources().find((candidate) => candidate.id === sourceId);
            return !sourceRequiresAuth(source);
          });
          await getJson("/api/onboarding/sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceIds, enabledSourceIds })
          });
          await refreshDashboard();
          onboardingStepStatus = "Saved. Next: verify access for selected sources.";
          onboardingStepStatusError = false;
        } catch (error) {
          onboardingStepStatus = error.message;
          onboardingStepStatusError = true;
        } finally {
          onboardingBusy = false;
          render();
        }
      }

      async function verifyOnboardingSources(sourceIdsOverride = null) {
        if (!ensureOnboardingConsentAccepted()) {
          return;
        }
        const sourceIds = Array.isArray(sourceIdsOverride) && sourceIdsOverride.length > 0
          ? sourceIdsOverride
          : selectedOnboardingSourceIdsFromDom();

        if (sourceIds.length === 0) {
          onboardingStepStatus = "Choose at least one source before verification.";
          onboardingStepStatusError = true;
          render();
          return;
        }

        onboardingBusy = true;
        onboardingStepStatus = "Verifying source access...";
        onboardingStepStatusError = false;
        onboardingVerifyProgress = "";
        render();

        const checksBySourceId = {};

        try {
          for (let index = 0; index < sourceIds.length; index += 1) {
            const sourceId = sourceIds[index];
            const source = onboardingCandidateSources().find((candidate) => candidate.id === sourceId);
            const authRequired = sourceRequiresAuth(source);
            onboardingVerifyProgress =
              "Checking " + String(index + 1) + "/" + String(sourceIds.length) + ": " + (source ? source.name : sourceId);
            render();

            if (authRequired) {
              try {
                await getJson("/api/sources/" + encodeURIComponent(sourceId) + "/run", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    forceRefresh: true,
                    skipSync: true
                  })
                });
              } catch {
                // final status comes from onboarding check below
              }
            }

            const checkPayload = await getJson("/api/onboarding/check-source", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceId,
                probeLive: !authRequired
              })
            });
            checksBySourceId[sourceId] =
              checkPayload && checkPayload.result && typeof checkPayload.result === "object"
                ? checkPayload.result
                : null;
          }

          const enabledSourceIds = sourceIds.filter((sourceId) => {
            const source = onboardingCandidateSources().find((candidate) => candidate.id === sourceId);
            const authRequired = sourceRequiresAuth(source);
            const status = checksBySourceId[sourceId] && checksBySourceId[sourceId].status
              ? String(checksBySourceId[sourceId].status).toLowerCase()
              : "warn";
            if (authRequired) {
              return status === "pass";
            }
            return true;
          });

          const failedAuth = failedAuthSourceIds(checksBySourceId, sourceIds);

          await getJson("/api/onboarding/sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceIds,
              enabledSourceIds
            })
          });

          await refreshDashboard();
          if (failedAuth.length > 0) {
            onboardingStepStatus =
              "Verified " +
              String(enabledSourceIds.length) +
              "/" +
              String(sourceIds.length) +
              " sources. " +
              String(failedAuth.length) +
              " auth-required source(s) are still disabled. Retry after signing in.";
          } else {
            onboardingStepStatus =
              "Success. All selected sources are verified and enabled. Go to Jobs and click Find Jobs.";
          }
          onboardingStepStatusError = false;
        } catch (error) {
          onboardingStepStatus = error.message;
          onboardingStepStatusError = true;
        } finally {
          onboardingBusy = false;
          onboardingVerifyProgress = "";
          render();
        }
      }

      async function retryFailedOnboardingAuthSources() {
        if (!ensureOnboardingConsentAccepted()) {
          return;
        }
        const selectedSourceIds = onboardingSelectedSourceIdsForRender();
        const failedAuth = failedAuthSourceIds(onboardingChecksBySourceId(), selectedSourceIds);
        if (failedAuth.length === 0) {
          onboardingStepStatus = "No failed auth sources to retry.";
          onboardingStepStatusError = true;
          render();
          return;
        }

        await verifyOnboardingSources(failedAuth);
      }

      async function completeOnboarding() {
        if (!ensureOnboardingConsentAccepted()) {
          return;
        }
        onboardingBusy = true;
        onboardingStepStatus = "Completing onboarding...";
        onboardingStepStatusError = false;
        render();

        try {
          await getJson("/api/onboarding/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          await refreshDashboard();
          onboardingStepStatus = "Onboarding completed.";
          onboardingStepStatusError = false;
        } catch (error) {
          onboardingStepStatus = error.message;
          onboardingStepStatusError = true;
        } finally {
          onboardingBusy = false;
          render();
        }
      }

      async function saveAnalyticsPreferenceFromProfile() {
        const toggle = document.getElementById("profile-analytics-enabled");
        const analyticsEnabled = toggle ? Boolean(toggle.checked) : true;

        busy = true;
        setFeedback("Saving analytics preference...");
        render();

        try {
          await getJson("/api/preferences/analytics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ analyticsEnabled })
          });
          await refreshDashboard();
          setFeedback("Analytics " + (analyticsEnabled ? "enabled." : "disabled."));
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          busy = false;
          render();
        }
      }

      async function trackDonationClick() {
        try {
          await getJson("/api/analytics/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventName: "donation_click",
              properties: {
                location: selectedTab
              }
            })
          });
        } catch {
          // no-op
        }
      }

      async function saveSource() {
        const nameInput = document.getElementById("source-name");
        const urlInput = document.getElementById("source-url");
        const recencyWindowInput = document.getElementById("source-recency-window");

        const body = {
          sourceId: editingSourceId,
          name: nameInput.value,
          searchUrl: urlInput.value,
          recencyWindow: recencyWindowInput ? recencyWindowInput.value : "1m"
        };

        busy = true;
        render();

        try {
          await getJson("/api/sources/upsert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          editingSourceId = null;
          sourceFormOpen = false;
          await refreshDashboard();
          setFeedback("Search saved.");
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          busy = false;
          render();
        }
      }

      function beginEditSource(sourceId) {
        const source = sourceById(sourceId);
        if (!source) {
          return;
        }

        editingSourceId = source.id;
        sourceFormOpen = true;
        render();
      }

      function beginAddSource() {
        editingSourceId = null;
        sourceFormOpen = true;
        render();
      }

      function resetSourceForm() {
        editingSourceId = null;
        sourceFormOpen = false;
        render();
      }

      async function runSource(sourceId) {
        busy = true;
        setFeedback("Running search...");

        try {
          const payload = await getJson("/api/sources/" + encodeURIComponent(sourceId) + "/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          await refreshDashboard();
          const captureMessage =
            payload.capture && payload.capture.message
              ? payload.capture.message
              : payload.capture && payload.capture.status === "completed"
                ? "Search run completed."
                : "Search run queued.";
          setFeedback(
            captureMessage
          );
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          busy = false;
          render();
        }
      }

      async function runSourceNow(sourceId) {
        busy = true;
        setFeedback("Running source now...");

        try {
          const payload = await getJson(
            "/api/sources/" + encodeURIComponent(sourceId) + "/manual-refresh",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" }
            }
          );
          await refreshDashboard();
          const captureMessage =
            payload.capture && payload.capture.message
              ? payload.capture.message
              : "Manual refresh completed.";
          setFeedback(captureMessage);
        } catch (error) {
          const nextEligibleAt =
            error && error.payload && typeof error.payload.nextEligibleAt === "string"
              ? error.payload.nextEligibleAt
              : "";
          if (nextEligibleAt) {
            setFeedback(
              "Manual refresh unavailable. Available in " +
                formatDurationFromNow(nextEligibleAt) +
                ".",
              true
            );
          } else {
            setFeedback(error.message, true);
          }
        } finally {
          busy = false;
          render();
        }
      }

      async function persistStatus(jobId, status) {
        let reason = "";

        if (status === "rejected") {
          const promptedReason = window.prompt(
            "Why reject this job? (e.g., dead link, application limit, other roles stronger fit)",
            "dead link"
          );
          if (promptedReason === null) {
            return false;
          }

          reason = promptedReason.trim();

          if (!reason) {
            setFeedback("Reject reason is required.", true);
            return false;
          }
        }

        await getJson("/api/jobs/" + encodeURIComponent(jobId) + "/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, reason })
        });

        return true;
      }

      async function updateStatus(status) {
        const job = currentJob();
        if (!job) {
          return;
        }

        try {
          const updated = await persistStatus(job.id, status);
          if (!updated) {
            return;
          }

          await refreshDashboard();
          setFeedback(
            status === "rejected"
              ? "Job rejected."
              : status === "applied"
                ? "Marked applied."
                : status === "skip_for_now"
                  ? "Marked skip for now."
                : "Job status updated."
          );
        } catch (error) {
          setFeedback(error.message, true);
        }
      }

      function setLocalStatus(jobId, status) {
        const groups = [
          Array.isArray(dashboard?.queue) ? dashboard.queue : [],
          Array.isArray(dashboard?.appliedQueue) ? dashboard.appliedQueue : [],
          Array.isArray(dashboard?.skippedQueue) ? dashboard.skippedQueue : [],
          Array.isArray(dashboard?.rejectedQueue) ? dashboard.rejectedQueue : []
        ];

        for (const group of groups) {
          for (const item of group) {
            if (item.id === jobId) {
              item.status = status;
            }
          }
        }
      }

      async function markViewed(jobId) {
        const target = (dashboard.queue || []).find((item) => item.id === jobId);
        if (!target || target.status !== "new") {
          return;
        }

        setLocalStatus(jobId, "viewed");
        render();

        try {
          await persistStatus(jobId, "viewed");
        } catch (error) {
          setLocalStatus(jobId, "new");
          setFeedback(error.message, true);
        }
      }

      async function openCurrent() {
        const job = currentJob();
        if (!job?.reviewTarget?.url) {
          return;
        }

        window.open(job.reviewTarget.url, "job-review-target");
        await markViewed(job.id);
      }

      function setSourceFilter(sourceFilter) {
        const normalized = String(sourceFilter || "all").trim().toLowerCase() || "all";
        selectedSourceFilter = normalized;
        selectedJobsPage = 1;
        ensureSelectedJob();
        render();
      }

      function setTab(tabName) {
        const normalized = String(tabName || "jobs").toLowerCase();
        if (!["jobs", "searches", "profile"].includes(normalized)) {
          return;
        }

        selectedTab = normalized;
        if (selectedTab === "jobs") {
          ensureSelectedJob();
        }
        render();
      }

      function setJobsView(viewName) {
        const normalized = String(viewName || "all").toLowerCase();
        if (!["all", "new", "best_match", "applied", "skipped", "rejected"].includes(normalized)) {
          return;
        }

        selectedJobsView = normalized;
        selectedJobsPage = 1;
        ensureSelectedJob();
        render();
      }

      function setJobsSort(sortName) {
        const normalized = String(sortName || "score").toLowerCase();
        if (!["score", "date"].includes(normalized)) {
          return;
        }

        selectedJobsSort = normalized;
        selectedJobsPage = 1;
        ensureSelectedJob();
        render();
      }

      function setSearchStateFilter(filterValue) {
        const normalized = String(filterValue || "").trim().toLowerCase();
        if (!["enabled", "disabled"].includes(normalized)) {
          return;
        }
        selectedSearchStateFilter = normalized;
        render();
      }

      function dismissSearchesWelcomeToast() {
        searchesWelcomeToastDismissed = true;
        try {
          window.localStorage.setItem(SEARCHES_WELCOME_TOAST_SEEN_KEY, "1");
        } catch {
          // no-op
        }
        render();
      }

      function goToDisabledFromSearchesWelcomeToast() {
        searchesWelcomeToastDismissed = true;
        selectedSearchStateFilter = "disabled";
        render();
      }

      function setSearchRunCadence(value) {
        selectedSearchRunCadence = normalizeRunCadence(value);
        try {
          window.localStorage.setItem(
            "jobFinder.searchRunCadence",
            selectedSearchRunCadence
          );
        } catch {
          // no-op
        }
        render();
      }

      function syncJobsPageToSelection() {
        const jobs = jobsForCurrentView();
        if (!jobs.length || !selectedJobId) {
          selectedJobsPage = 1;
          return;
        }

        const index = jobs.findIndex((job) => job.id === selectedJobId);
        if (index < 0) {
          return;
        }

        selectedJobsPage = Math.floor(index / JOBS_PAGE_SIZE) + 1;
      }

      function setJobsPage(pageValue) {
        const jobs = jobsForCurrentView();
        const totalPages = Math.max(1, Math.ceil(jobs.length / JOBS_PAGE_SIZE));
        const nextPage = Math.max(1, Math.min(totalPages, Number(pageValue) || 1));
        selectedJobsPage = nextPage;
        render();
      }

      function toggleJobsFilters() {
        jobsFiltersCollapsed = !jobsFiltersCollapsed;
        render();
      }

      function moveSelection(step) {
        const jobs = jobsForCurrentView();
        if (!jobs.length) {
          return;
        }

        const currentIndex = jobs.findIndex((item) => item.id === selectedJobId);
        const safeIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = Math.max(0, Math.min(jobs.length - 1, safeIndex + step));
        selectedJobId = jobs[nextIndex].id;
        syncJobsPageToSelection();
        render();
        void markViewed(selectedJobId);
      }

      function selectJob(jobId) {
        selectedJobId = jobId;
        syncJobsPageToSelection();
        render();
        void markViewed(jobId);
      }

      function sourceFormValues() {
        if (!editingSourceId) {
          return {
            heading: "Add Search",
            actionLabel: "Save Search",
            name: "",
            searchUrl: "",
            recencyWindow: "1w"
          };
        }

        const source = sourceById(editingSourceId);
        if (!source) {
          return {
            heading: "Add Search",
            actionLabel: "Save Search",
            name: "",
            searchUrl: "",
            recencyWindow: "1w"
          };
        }

        return {
          heading: "Edit Search",
          actionLabel: "Save Changes",
          name: source.name,
          searchUrl: source.searchUrl,
          recencyWindow:
            source.type === "ashby_search" || source.type === "google_search"
              ? source.recencyWindow || (source.type === "google_search" ? "1w" : "1m")
              : "any"
        };
      }

      function render() {
        const activeAll = activeQueueAllSources();
        const appliedAll = appliedQueueAllSources();
        const skippedAll = skippedQueueAllSources();
        const rejectedAll = rejectedQueueAllSources();
        const activeNewCount = activeAll.filter((job) => job?.status === "new").length;
        const bestMatchCount = activeAll.filter((job) => job?.bucket === "high_signal").length;
        const jobsAllInSelectedView = jobsForSelectedViewAllSources();
        const jobsInView = jobsForCurrentView();
        const job = currentJob();
        const formState = sourceFormValues();
        const position = currentJobPosition();
        const currentIndexLabel =
          position.index >= 0 ? String(position.index + 1) : "0";
        const totalIndexLabel = String(position.total || 0);
        const totalInSelectedView = jobsAllInSelectedView.length;
        const jobsTotalPages = Math.max(1, Math.ceil(jobsInView.length / JOBS_PAGE_SIZE));
        if (selectedJobsPage > jobsTotalPages) {
          selectedJobsPage = jobsTotalPages;
        }
        if (selectedJobsPage < 1) {
          selectedJobsPage = 1;
        }
        const jobsPageStartIndex = (selectedJobsPage - 1) * JOBS_PAGE_SIZE;
        const pagedJobsInView = jobsInView.slice(
          jobsPageStartIndex,
          jobsPageStartIndex + JOBS_PAGE_SIZE
        );
        const pageStartLabel = jobsInView.length ? jobsPageStartIndex + 1 : 0;
        const pageEndLabel = Math.min(jobsPageStartIndex + JOBS_PAGE_SIZE, jobsInView.length);
        const showingRangeLabel = jobsInView.length
          ? String(pageStartLabel) + "-" + String(pageEndLabel)
          : "0";
        const currentSearchCriteria =
          dashboard.searchCriteria &&
          typeof dashboard.searchCriteria === "object" &&
          !Array.isArray(dashboard.searchCriteria)
            ? dashboard.searchCriteria
            : {};
        const keywordModeValue =
          String(currentSearchCriteria.keywordMode || "").toLowerCase() === "or" ? "or" : "and";
        const includeTermsValue = Array.isArray(currentSearchCriteria.includeTerms)
          ? currentSearchCriteria.includeTerms.join(", ")
          : "";
        const excludeTermsValue = Array.isArray(currentSearchCriteria.excludeTerms)
          ? currentSearchCriteria.excludeTerms.join(", ")
          : "";
        const hardFilterSummary = excludeTermsValue
          ? "Hard filters exclude: " + excludeTermsValue + "."
          : "Hard filters exclude: none.";
        const sourcesForDisplay = visibleSources();
        const sourceKindBySourceId = new Map(
          sourcesForDisplay.map((source) => [source.id, sourceKindFromType(source.type)])
        );
        const sourceFilterTotals = new Map();
        for (const source of sourcesForDisplay) {
          const sourceKind = sourceKindFromType(source.type);
          const current = sourceFilterTotals.get(sourceKind) || {
            kind: sourceKind,
            label: sourceKindLabel(sourceKind),
            count: 0
          };
          sourceFilterTotals.set(sourceKind, current);
        }
        for (const jobItem of jobsAllInSelectedView) {
          const seenKinds = new Set();
          for (const sourceId of Array.isArray(jobItem?.sourceIds) ? jobItem.sourceIds : []) {
            const sourceKind = sourceKindBySourceId.get(sourceId);
            if (sourceKind) {
              seenKinds.add(sourceKind);
            }
          }

          for (const sourceKind of seenKinds) {
            const current = sourceFilterTotals.get(sourceKind);
            if (!current) {
              continue;
            }
            current.count += 1;
          }
        }
        const sourceFilterOrder = ["li", "bi", "id", "zr", "lf", "yc", "ah", "gg", "wf", "ro", "unknown"];
        const sourceFilters = [...sourceFilterTotals.values()].sort((left, right) => {
          const leftIndex = sourceFilterOrder.indexOf(left.kind);
          const rightIndex = sourceFilterOrder.indexOf(right.kind);
          const normalizedLeft = leftIndex >= 0 ? leftIndex : sourceFilterOrder.length;
          const normalizedRight = rightIndex >= 0 ? rightIndex : sourceFilterOrder.length;
          if (normalizedLeft !== normalizedRight) {
            return normalizedLeft - normalizedRight;
          }

          return left.label.localeCompare(right.label);
        });

        if (
          selectedSourceFilter !== "all" &&
          !sourceFilters.some((sourceFilter) => sourceFilter.kind === selectedSourceFilter)
        ) {
          selectedSourceFilter = "all";
        }
        if (!["enabled", "disabled"].includes(selectedSearchStateFilter)) {
          selectedSearchStateFilter = "enabled";
        }

        const sourceChecks = onboardingChecksBySourceId();
        const searchSources = (Array.isArray(dashboard.sources) ? dashboard.sources : [])
          .filter((source) => source && isSourceTypeEnabled(source.type))
          .map((source) => {
            const readiness = onboardingReadinessState(source, sourceChecks);
            const status =
              readiness.key === "disabled"
                ? {
                    label: "Disabled",
                    tone: "muted",
                    detail: ""
                  }
                : readiness.key === "not_authorized"
                  ? {
                      label: "Issue detected",
                      tone: "warn",
                      detail: "Authentication required"
                    }
                  : {
                      label: "Ready",
                      tone: "ok",
                      detail: ""
                    };
            const avgScoreValue =
              source.avgScore === null || source.avgScore === undefined
                ? null
                : Number(source.avgScore);
            return {
              id: source.id,
              kind: sourceKindFromType(source.type),
              label: source.name || sourceKindLabel(sourceKindFromType(source.type)),
              searchUrl: source.searchUrl || "",
              enabled: source.enabled === true,
              authRequired: sourceRequiresAuth(source),
              status,
              capturedAt: source.capturedAt || null,
              capturedCount: Number(source.captureJobCount || 0),
              filteredCount: Number(source.droppedByHardFilterCount || 0),
              dedupedCount: Number(source.droppedByDedupeCount || 0),
              importedCount: Number(source.importedCount || 0),
              hasUnknownExpectedCount: normalizeExpectedCount(source.captureExpectedCount) === null,
              expectedFoundCount: normalizeExpectedCount(source.captureExpectedCount),
              formatterUnsupported: Array.isArray(source.formatterDiagnostics?.unsupported)
                ? source.formatterDiagnostics.unsupported
                : Array.isArray(source.criteriaAccountability?.unsupported)
                  ? source.criteriaAccountability.unsupported
                  : [],
              formatterNotes: Array.isArray(source.formatterDiagnostics?.notes)
                ? source.formatterDiagnostics.notes
                : [],
              captureStatus: source.captureStatus || "never_run",
              captureFunnelError: source.captureFunnelError || null,
              hasCacheState:
                source.servedFrom === "cache" ||
                source.statusReason === "cache_fresh" ||
                source.statusReason === "cooldown" ||
                source.statusReason === "min_interval" ||
                source.statusReason === "daily_cap" ||
                source.statusReason === "mock_profile",
              adapterHealthStatus:
                typeof source.adapterHealthStatus === "string"
                  ? source.adapterHealthStatus
                  : "unknown",
              adapterHealthScore:
                Number.isFinite(Number(source.adapterHealthScore))
                  ? Number(source.adapterHealthScore)
                  : null,
              adapterHealthReason:
                Array.isArray(source.adapterHealthReasons) && source.adapterHealthReasons.length > 0
                  ? String(source.adapterHealthReasons[0] || "")
                  : null,
              adapterHealthUpdatedAt:
                typeof source.adapterHealthUpdatedAt === "string" && source.adapterHealthUpdatedAt.trim()
                  ? source.adapterHealthUpdatedAt
                  : null,
              lastAttemptedAt:
                typeof source.lastAttemptedAt === "string" && source.lastAttemptedAt.trim()
                  ? source.lastAttemptedAt
                  : null,
              lastAttemptOutcome:
                typeof source.lastAttemptOutcome === "string" && source.lastAttemptOutcome.trim()
                  ? source.lastAttemptOutcome
                  : null,
              lastAttemptError:
                typeof source.lastAttemptError === "string" && source.lastAttemptError.trim()
                  ? source.lastAttemptError
                  : null,
              refreshStatusReason:
                typeof source.statusReason === "string" && source.statusReason.trim()
                  ? source.statusReason
                  : null,
              refreshServedFrom:
                typeof source.servedFrom === "string" && source.servedFrom.trim()
                  ? source.servedFrom
                  : null,
              runNewCount: Number.isFinite(Number(source.runNewCount))
                ? Math.max(0, Math.round(Number(source.runNewCount)))
                : null,
              runUpdatedCount: Number.isFinite(Number(source.runUpdatedCount))
                ? Math.max(0, Math.round(Number(source.runUpdatedCount)))
                : null,
              runUnchangedCount: Number.isFinite(Number(source.runUnchangedCount))
                ? Math.max(0, Math.round(Number(source.runUnchangedCount)))
                : null,
              hasRunDelta:
                Number.isFinite(Number(source.runNewCount)) ||
                Number.isFinite(Number(source.runUpdatedCount)) ||
                Number.isFinite(Number(source.runUnchangedCount)),
              avgScore: Number.isFinite(avgScoreValue) ? Math.round(avgScoreValue) : null,
              manualRefreshAllowed: source.manualRefreshAllowed === true,
              manualRefreshNextEligibleAt:
                typeof source.manualRefreshNextEligibleAt === "string"
                  ? source.manualRefreshNextEligibleAt
                  : null,
              manualRefreshRemaining: Number(source.manualRefreshRemaining || 0)
            };
          })
          .sort((left, right) => {
            const leftIndex = sourceFilterOrder.indexOf(left.kind);
            const rightIndex = sourceFilterOrder.indexOf(right.kind);
            const normalizedLeft = leftIndex >= 0 ? leftIndex : sourceFilterOrder.length;
            const normalizedRight = rightIndex >= 0 ? rightIndex : sourceFilterOrder.length;
            if (normalizedLeft !== normalizedRight) {
              return normalizedLeft - normalizedRight;
            }
            return left.label.localeCompare(right.label);
          });

        const enabledSearchSources = searchSources.filter((source) => source.enabled);
        const disabledSearchSources = searchSources.filter((source) => !source.enabled);
        const filteredSearchSources = searchSources.filter((source) =>
          selectedSearchStateFilter === "enabled" ? source.enabled : !source.enabled
        );

        const searchFilterTabs = [
          '<button class="search-state-tab' +
            (selectedSearchStateFilter === "enabled" ? " active" : "") +
            '" data-search-state="enabled">Enabled (' +
            String(enabledSearchSources.length) +
            ")</button>",
          '<button class="search-state-tab' +
            (selectedSearchStateFilter === "disabled" ? " active" : "") +
            '" data-search-state="disabled">Disabled (' +
            String(disabledSearchSources.length) +
            ")</button>"
        ].join("");
        const searchRowMarkup = filteredSearchSources
          .map((source) => {
            const safeName = escapeHtml(source.label);
            const safeSearchUrl = escapeHtml(source.searchUrl || "");
            const lastRun = escapeHtml(formatTime(source.capturedAt));
            const statusLabelRaw =
              source.captureStatus === "ready"
                ? "ready"
                : source.captureStatus === "capture_error"
                  ? "capture error"
                  : source.captureStatus === "live_source"
                    ? "ready"
                  : "never run";
            const healthStatus =
              typeof source.adapterHealthStatus === "string"
                ? source.adapterHealthStatus
                : "unknown";
            const healthTone =
              healthStatus === "failing"
                ? "error"
                : healthStatus === "degraded"
                  ? "warn"
                  : null;
            const statusTone = healthTone || (
              source.captureStatus === "capture_error"
                ? "error"
                : source.hasCacheState
                  ? "warn"
                  : "ok"
            );
            const statusLabel =
              healthStatus === "failing"
                ? "needs attention"
                : healthStatus === "degraded"
                  ? "needs attention"
                  :
              statusTone === "warn"
                ? "cache"
                : statusTone === "error"
                  ? "error"
                  : statusLabelRaw;
            const healthScore =
              Number.isFinite(Number(source.adapterHealthScore))
                ? Math.round(Number(source.adapterHealthScore) * 100)
                : null;
            const healthUpdatedAtText =
              typeof source.adapterHealthUpdatedAt === "string" &&
              source.adapterHealthUpdatedAt.trim()
                ? formatTime(source.adapterHealthUpdatedAt)
                : null;
            const statusDetail =
              healthStatus === "failing" || healthStatus === "degraded"
                ? (source.adapterHealthReason || "adapter needs attention") +
                  (healthUpdatedAtText ? " · last signal " + healthUpdatedAtText : "")
                : source.captureFunnelError ||
                  (healthStatus === "ok" && healthScore !== null
                    ? "health score " + healthScore + "%"
                    : null);
            const refreshStatusReason =
              typeof source.refreshStatusReason === "string" &&
              source.refreshStatusReason.trim()
                ? source.refreshStatusReason.replaceAll("_", " ")
                : "unknown";
            const refreshServedFrom =
              typeof source.refreshServedFrom === "string" &&
              source.refreshServedFrom.trim()
                ? source.refreshServedFrom
                : "unknown";
            const refreshContextDetail =
              "refresh: " + refreshStatusReason + " (" + refreshServedFrom + ")";
            const runDeltaDetail = source.hasRunDelta
              ? "run delta: new " +
                String(source.runNewCount) +
                " · updated " +
                String(source.runUpdatedCount) +
                " · unchanged " +
                String(source.runUnchangedCount)
              : "run delta: unavailable";
            const formatterUnsupported = Array.isArray(source.formatterUnsupported)
              ? source.formatterUnsupported
              : [];
            const formatterNotes = Array.isArray(source.formatterNotes)
              ? source.formatterNotes
              : [];
            const formatterDetailParts = [];
            if (formatterUnsupported.length > 0) {
              formatterDetailParts.push("unsupported " + formatterUnsupported.join(", "));
            }
            if (formatterNotes.length > 0) {
              formatterDetailParts.push(...formatterNotes);
            }
            const formatterDetail = formatterDetailParts.join(" · ");
            const sourceLabel = source.searchUrl
              ? '<a class="search-name search-link-label search-name-link" href="' +
                safeSearchUrl +
                '" target="_blank" rel="noopener noreferrer" data-stop-row-open="1">' +
                safeName +
                ' <span class="external-link-icon" aria-hidden="true">&#8599;</span></a>'
              : '<span class="search-name search-link-label">' + safeName + "</span>";
            const foundLabel =
              source.hasUnknownExpectedCount || !Number.isFinite(source.expectedFoundCount)
                ? String(source.importedCount) + "/?"
                : String(source.importedCount) +
                  "/" +
                  String(Math.max(0, Math.round(source.expectedFoundCount)));
            const disableControls = busy || onboardingBusy || Boolean(authFlowSourceId);
            const authBlocked = source.enabled && source.authRequired && source.status.tone === "warn";
            const runNowDisabled = disableControls || !source.manualRefreshAllowed;
            const runNowLabel = runNowDisabled
              ? source.manualRefreshNextEligibleAt
                ? "Available in " + formatDurationFromNow(source.manualRefreshNextEligibleAt)
                : "Run now"
              : "Run now";
            const overflowMenu = source.enabled
              ? buildSourceOverflowMenu(source.id, disableControls, "disable")
              : "";

            return [
              '<tr class="search-row' + (source.enabled ? "" : " is-disabled") + '">',
              "  <td>" + sourceLabel + "</td>",
              '  <td class="search-row-hotspot"' +
                (source.enabled ? ' data-open-jobs-row="' + escapeHtml(source.kind) + '"' : "") +
                ">" +
                lastRun +
                "</td>",
              '  <td class="search-row-hotspot"' +
                (source.enabled ? ' data-open-jobs-row="' + escapeHtml(source.kind) + '"' : "") +
                ">" +
                '<span class="status-chip"><span class="status-dot" data-tone="' +
                escapeHtml(statusTone) +
                '" aria-hidden="true"></span><span>' +
                escapeHtml(statusLabel) +
                "</span></span>" +
                '<div class="subhead">' + escapeHtml(refreshContextDetail) + "</div>" +
                '<div class="subhead">' + escapeHtml(runDeltaDetail) + "</div>" +
                (statusDetail
                  ? '<div class="subhead">' + escapeHtml(statusDetail) + "</div>"
                  : "") +
                (formatterDetail
                  ? '<div class="subhead">formatter: ' + escapeHtml(formatterDetail) + "</div>"
                  : "") +
                "</td>",
              '  <td class="search-row-hotspot"' +
                (source.enabled ? ' data-open-jobs-row="' + escapeHtml(source.kind) + '"' : "") +
                ">" +
                escapeHtml(foundLabel) +
                "</td>",
              '  <td class="search-row-hotspot"' +
                (source.enabled ? ' data-open-jobs-row="' + escapeHtml(source.kind) + '"' : "") +
                ">" +
                escapeHtml(source.filteredCount) +
                "</td>",
              '  <td class="search-row-hotspot"' +
                (source.enabled ? ' data-open-jobs-row="' + escapeHtml(source.kind) + '"' : "") +
                ">" +
                escapeHtml(source.dedupedCount) +
                "</td>",
              '  <td class="search-row-hotspot"' +
                (source.enabled ? ' data-open-jobs-row="' + escapeHtml(source.kind) + '"' : "") +
                ">" +
                escapeHtml(source.importedCount) +
                "</td>",
              '  <td class="search-row-hotspot"' +
                (source.enabled ? ' data-open-jobs-row="' + escapeHtml(source.kind) + '"' : "") +
                ">" +
                escapeHtml(source.avgScore === null ? "n/a" : source.avgScore) +
                "</td>",
              '  <td><div class="search-actions">' +
                (!source.enabled
                  ? '<button class="primary" data-stop-row-open="1" data-onboarding-enable-source="' +
                      escapeHtml(source.id) +
                      '"' +
                      (disableControls ? " disabled" : "") +
                      ">Enable</button>"
                  : "") +
                (source.enabled
                  ? authBlocked
                    ? '<button class="primary" data-stop-row-open="1" data-onboarding-open-auth-source="' +
                        escapeHtml(source.id) +
                        '"' +
                        (disableControls ? " disabled" : "") +
                        ">Sign in</button>"
                    : '<button class="secondary" data-stop-row-open="1" data-run-source-now="' +
                        escapeHtml(source.id) +
                        '"' +
                        (runNowDisabled ? " disabled" : "") +
                        ' title="Manual refreshes remaining today: ' +
                        escapeHtml(source.manualRefreshRemaining) +
                        '">' +
                        escapeHtml(runNowLabel) +
                      "</button>"
                  : "") +
                overflowMenu +
                "</div></td>",
              "</tr>"
            ].join("");
          })
          .join("");
        const totalsRowMarkup =
          filteredSearchSources.length > 0
            ? (() => {
                const totals = filteredSearchSources.reduce(
                  (accumulator, source) => {
                    accumulator.captured += Number(source.capturedCount || 0);
                    accumulator.filtered += Number(source.filteredCount || 0);
                    accumulator.deduped += Number(source.dedupedCount || 0);
                    accumulator.imported += Number(source.importedCount || 0);
                    if (
                      source.hasUnknownExpectedCount ||
                      !Number.isFinite(Number(source.expectedFoundCount))
                    ) {
                      accumulator.hasUnknownExpected = true;
                    } else {
                      accumulator.expectedFound += Math.max(
                        0,
                        Math.round(Number(source.expectedFoundCount))
                      );
                    }
                    if (
                      Number.isFinite(Number(source.avgScore)) &&
                      Number(source.importedCount || 0) > 0
                    ) {
                      accumulator.avgScoreTotal +=
                        Number(source.avgScore) * Number(source.importedCount || 0);
                      accumulator.avgScoreCount += Number(source.importedCount || 0);
                    }
                    return accumulator;
                  },
                  {
                    captured: 0,
                    filtered: 0,
                    deduped: 0,
                    imported: 0,
                    expectedFound: 0,
                    hasUnknownExpected: false,
                    avgScoreTotal: 0,
                    avgScoreCount: 0
                  }
                );
                const foundTotalLabel =
                  totals.hasUnknownExpected || !Number.isFinite(totals.expectedFound)
                    ? String(totals.imported) + "/?"
                    : String(totals.imported) +
                      "/" +
                      String(Math.max(0, Math.round(totals.expectedFound)));
                const totalAvgScore =
                  totals.avgScoreCount > 0
                    ? Math.round(totals.avgScoreTotal / totals.avgScoreCount)
                    : "n/a";

                return [
                  '<tr class="search-totals-row">',
                  "  <td>" +
                    escapeHtml(
                      selectedSearchStateFilter === "enabled"
                        ? "Enabled Total"
                        : "Disabled Total"
                    ) +
                    "</td>",
                  "  <td>—</td>",
                  "  <td>—</td>",
                  "  <td>" + escapeHtml(foundTotalLabel) + "</td>",
                  "  <td>" + escapeHtml(totals.filtered) + "</td>",
                  "  <td>" + escapeHtml(totals.deduped) + "</td>",
                  "  <td>" + escapeHtml(totals.imported) + "</td>",
                  "  <td>" + escapeHtml(totalAvgScore) + "</td>",
                  "  <td>—</td>",
                  "</tr>"
                ].join("");
              })()
            : "";
        const searchRows = searchRowMarkup + totalsRowMarkup;

        const queueItems = jobsInView.length
          ? pagedJobsInView
              .map((item) => {
                const sourceKinds = sourceKindsForJob(item);
                const freshness = formatFreshness(item);
                const activeClass = item.id === selectedJobId ? " active" : "";
                const scoreLabel =
                  item.status === "applied"
                    ? "Applied"
                    : item.status === "skip_for_now"
                      ? "Skipped"
                      : "Score " + (item.score ?? "n/a");
                const confidenceLabel = Number.isFinite(Number(item.confidence))
                  ? "Confidence " + Number(item.confidence)
                  : "Confidence n/a";

                return [
                  '<button class="queue-item' + activeClass + '" data-job-id="' + escapeHtml(item.id) + '">',
                  '  <div class="queue-item-header">',
                  '    <span class="queue-item-title">' + escapeHtml(item.title) + '</span>',
                  '    <span class="queue-item-score">' + escapeHtml(scoreLabel) + '</span>',
                  "  </div>",
                  '  <div class="queue-item-meta">' +
                    escapeHtml(item.company) +
                    " · " +
                    escapeHtml(formatValue(item.location, "Location unknown")) +
                    " · " +
                    escapeHtml(formatBucket(item.bucket)) +
                    "</div>",
                  '  <div class="queue-item-meta">Source ' + escapeHtml(sourceKinds.label) + " · " + escapeHtml(freshness) + "</div>",
                  '  <div class="queue-item-meta">' + escapeHtml(confidenceLabel) + "</div>",
                  item.duplicateCount > 1
                    ? '  <div class="queue-item-meta">Seen across ' + escapeHtml(item.duplicateCount) + " searches</div>"
                    : "",
                  "</button>"
                ].join("");
              })
              .join("")
          : '<p class="muted">No jobs match this filter yet.</p>';
        const queuePagination =
          jobsInView.length > JOBS_PAGE_SIZE
            ? [
                '<div class="inline-actions" style="margin-top: 12px;">',
                '  <button class="secondary" data-jobs-page-nav="prev"' + (selectedJobsPage <= 1 ? " disabled" : "") + ">Prev</button>",
                '  <span class="subhead" style="margin-top: 0;">Page ' + escapeHtml(String(selectedJobsPage)) + " of " + escapeHtml(String(jobsTotalPages)) + "</span>",
                '  <button class="secondary" data-jobs-page-nav="next"' + (selectedJobsPage >= jobsTotalPages ? " disabled" : "") + ">Next</button>",
                "</div>"
              ].join("")
            : "";

        const sourceFilterPills = [
          '<button class="filter-chip' + (selectedSourceFilter === "all" ? " active" : "") + '" data-filter-source="all">' +
            '<span class="filter-chip-main">All Results (' + escapeHtml(String(totalInSelectedView)) + ")</span>" +
          "</button>",
          ...sourceFilters.map((sourceFilter) => {
            const activeClass = selectedSourceFilter === sourceFilter.kind ? " active" : "";
            const sourceFoundCount = Number(sourceFilter.count || 0);
            const isUnavailable =
              sourceFoundCount === 0 && selectedSourceFilter !== sourceFilter.kind;
            return (
              '<button class="filter-chip filter-chip-source' + activeClass + '" data-filter-source="' + escapeHtml(sourceFilter.kind) + '"' + (isUnavailable ? " disabled" : "") + ">" +
                '<span class="filter-chip-main">' + escapeHtml(sourceFilter.label) + " (" + escapeHtml(String(sourceFoundCount)) + ")</span>" +
              "</button>"
            );
          })
        ].join("");
        const activeViewLabel =
          selectedJobsView === "new" ? "New (" + escapeHtml(String(activeNewCount)) + ")" :
          selectedJobsView === "best_match" ? "Best Match (" + escapeHtml(String(bestMatchCount)) + ")" :
          "All (" + escapeHtml(String(activeAll.length)) + ")";

        const processedViewLabel =
          selectedJobsView === "skipped" ? "Skipped (" + escapeHtml(String(skippedAll.length)) + ")" :
          selectedJobsView === "rejected" ? "Rejected (" + escapeHtml(String(rejectedAll.length)) + ")" :
          "Applied (" + escapeHtml(String(appliedAll.length)) + ")";

        const jobsViewPills = [
          '<div class="view-dropdown active">',
          '  <select class="view-select">',
          '    <option value="all"' + (selectedJobsView === "all" ? " selected" : "") + '>All (' + escapeHtml(String(activeAll.length)) + ')</option>',
          '    <option value="new"' + (selectedJobsView === "new" ? " selected" : "") + (activeNewCount === 0 ? " disabled" : "") + '>New (' + escapeHtml(String(activeNewCount)) + ')</option>',
          '    <option value="best_match"' + (selectedJobsView === "best_match" ? " selected" : "") + (bestMatchCount === 0 ? " disabled" : "") + '>Best Match (' + escapeHtml(String(bestMatchCount)) + ')</option>',
          '    <option value="applied"' + (selectedJobsView === "applied" ? " selected" : "") + '>Applied (' + escapeHtml(String(appliedAll.length)) + ')</option>',
          '    <option value="skipped"' + (selectedJobsView === "skipped" ? " selected" : "") + '>Skipped (' + escapeHtml(String(skippedAll.length)) + ')</option>',
          '    <option value="rejected"' + (selectedJobsView === "rejected" ? " selected" : "") + '>Rejected (' + escapeHtml(String(rejectedAll.length)) + ')</option>',
          '  </select>',
          '</div>'
        ].join("");
        const jobsSortPills = [
          '<button class="sub-tab' + (selectedJobsSort === "score" ? " active" : "") + '" data-jobs-sort="score">Score</button>',
          '<button class="sub-tab' + (selectedJobsSort === "date" ? " active" : "") + '" data-jobs-sort="date">Date</button>'
        ].join("");
        const criteriaStatusMessage =
          typeof criteriaFeedback === "string" ? criteriaFeedback.trim() : "";
        const findJobsButtonLabel = criteriaBusy ? "Finding jobs..." : "Find Jobs";
        const detailMarkup = job
          ? [
              (() => {
                const attributions = sourceAttributions(job);
                const sourceKinds = sourceKindsForJob(job);
                const freshness = formatFreshness(job);
                const searchCount = attributions.length;
                const attributionList = attributions.length
                  ? attributions
                      .map((source) =>
                        "<li>" +
                          "<strong>" +
                          escapeHtml(source.name) +
                          "</strong>" +
                          " · " +
                          '<a href="' +
                          encodeURI(source.searchUrl) +
                          '" target="_blank" rel="noreferrer">Search URL</a>' +
                          " · " +
                          escapeHtml(formatSourceType(source.type)) +
                          "</li>"
                      )
                      .join("")
                  : "<li>No source attribution recorded for this job yet.</li>";

                return [
                  '<div class="eyebrow">Review</div>',
                  '<div class="review-head">',
                  '  <div>',
                  '    <h2 class="review-title">' + escapeHtml(job.title) + "</h2>",
                  '    <div class="subhead">' +
                    escapeHtml(job.company) +
                    " · " +
                    escapeHtml(formatValue(job.location, "Location unknown")) +
                    "</div>",
                  '    <div class="tag-row">',
                  '      <span class="tag" data-bucket="' + escapeHtml(job.bucket || "unscored") + '">Bucket: ' + escapeHtml(formatBucket(job.bucket)) + "</span>",
                  '      <span class="tag" data-tone="strong">Score: ' + escapeHtml(job.score ?? "n/a") + "</span>",
                  '      <span class="tag">Confidence: ' + escapeHtml(Number.isFinite(Number(job.confidence)) ? String(job.confidence) : "n/a") + "</span>",
                  '      <span class="tag">Status: ' + escapeHtml(formatStatus(job.status)) + "</span>",
                  '      <span class="tag">Source: ' + escapeHtml(sourceKinds.label) + "</span>",
                  '      <span class="tag">Searches: ' + escapeHtml(String(searchCount)) + "</span>",
                  '      <span class="tag">' + escapeHtml(freshness) + "</span>",
                  job.duplicateCount > 1
                    ? '      <span class="tag">Seen in ' + escapeHtml(job.duplicateCount) + " searches</span>"
                    : "",
                  "    </div>",
                  "  </div>",
                  '  <div class="review-controls">',
                  '    <button class="arrow-btn" id="prev-job" aria-label="Previous job" title="Previous job"' + (position.index <= 0 ? " disabled" : "") + ">←</button>",
                  '    <span class="position-indicator">' + escapeHtml(currentIndexLabel) + " / " + escapeHtml(totalIndexLabel) + "</span>",
                  '    <button class="arrow-btn" id="next-job" aria-label="Next job" title="Next job"' + (position.index < 0 || position.index >= position.total - 1 ? " disabled" : "") + ">→</button>",
                  '    <button class="primary" id="open-current">' + escapeHtml(reviewLinkLabel(job)) + "</button>",
                  "</div>",
                  "</div>",
                  '<div class="decision-row">',
                  '  <button class="decision-btn' + (formatStatus(job.status) === "applied" ? " active" : "") + '" data-status="applied">I Applied</button>',
                  '  <button class="decision-btn' + (job.status === "skip_for_now" ? " active" : "") + '" data-status="skip_for_now">Skip For Now</button>',
                  '  <button class="decision-btn' + (formatStatus(job.status) === "rejected" ? " active" : "") + '" data-status="rejected">Reject</button>',
                  "</div>",
                  '<div class="review-body">',
                  job.status === "rejected" && job.notes
                    ? '<div class="card inset" style="background: rgba(122, 29, 29, 0.05); border-color: rgba(122, 29, 29, 0.2);">' +
                      '  <p class="section-label" style="color: #b91c1c;">Rejection Reason</p>' +
                      '  <p style="margin: 0;">' + escapeHtml(job.notes) + "</p>" +
                      "</div>"
                    : "",
                  '<div class="card inset">',
                  '  <p class="section-label">Why It Fits</p>',
                  '  <div>' + escapeHtml(job.summary || "No summary available.") + "</div>",
                  '  <ul class="reason-list">' +
                    (
                      job.reasons && job.reasons.length
                        ? job.reasons.map((reason) => "<li>" + escapeHtml(reason) + "</li>").join("")
                        : "<li>No specific fit reasons recorded yet.</li>"
                    ) +
                    "</ul>",
                  job.status !== "rejected" && job.notes
                    ? '  <p class="muted" style="margin-top: 12px;">Latest note: ' + escapeHtml(job.notes) + "</p>"
                    : "",
                  "</div>",
                  '<div class="review-sidebar">',
                  '<div class="card inset">',
                  '  <p class="section-label">Attribution</p>',
                  '  <ul class="reason-list">' + attributionList + "</ul>",
                  "</div>",
                  '<div class="card inset">',
                  '  <p class="section-label">Role Snapshot</p>',
                  '  <dl class="meta-grid">',
                  '    <div class="meta-item"><dt>Salary</dt><dd>' + escapeHtml(formatValue(job.salaryText, "Unknown")) + "</dd></div>",
                  '    <div class="meta-item"><dt>Employment</dt><dd>' + escapeHtml(formatValue(job.employmentType, "Unknown")) + "</dd></div>",
                  '    <div class="meta-item"><dt>Freshness</dt><dd>' + escapeHtml(freshness) + "</dd></div>",
                  '    <div class="meta-item"><dt>Link</dt><dd>' +
                    (job.reviewTarget?.url
                      ? '<a href="' + encodeURI(job.reviewTarget.url) + '" target="job-review-target" rel="noreferrer">' + escapeHtml(reviewLinkLabel(job)) + "</a>"
                      : '<span class="muted">Unavailable</span>') +
                    "</dd></div>",
                  "  </dl>",
                  "</div>",
                  "</div>",
                  "</div>"
                ].join("");
              })()
            ].join("")
          : '<div class="eyebrow">Review</div><p class="muted">No jobs are available for the current filter.</p>';

        const tabButtons = [
          '<button class="main-tab' + (selectedTab === "jobs" ? " active" : "") + '" data-tab="jobs">Jobs</button>',
          '<button class="main-tab' + (selectedTab === "searches" ? " active" : "") + '" data-tab="searches">Searches</button>',
          '<button class="main-tab' + (selectedTab === "profile" ? " active" : "") + '" data-tab="profile">Profile</button>'
        ].join("");

        const jobsSection = [
          '<section class="card" style="margin-top: 18px;">',
          '  <p class="section-label">Search Criteria</p>',
          '  <div class="subhead">Enter your terms, then click Find Jobs.</div>',
          '  <div class="search-criteria-form" style="margin-top: 10px;">',
          '      <label>Title<input id="criteria-title" type="text" value="' + escapeHtml(currentSearchCriteria.title || "") + '" placeholder="senior product manager"></label>',
          '      <label>Keyword<input id="criteria-keywords" type="text" value="' + escapeHtml(currentSearchCriteria.keywords || "") + '" placeholder="fintech payments"></label>',
          '      <label>Keyword Mode<select id="criteria-keyword-mode">' +
            '<option value="and"' + (keywordModeValue === "and" ? " selected" : "") + ">AND</option>" +
            '<option value="or"' + (keywordModeValue === "or" ? " selected" : "") + ">OR</option>" +
          "</select></label>",
          '      <label>Include<input id="criteria-include-terms" type="text" value="' + escapeHtml(includeTermsValue) + '" placeholder="payments, growth"></label>',
          '      <label>Exclude<input id="criteria-exclude-terms" type="text" value="' + escapeHtml(excludeTermsValue) + '" placeholder="intern, contract"></label>',
          '      <label>Location<input id="criteria-location" type="text" value="' + escapeHtml(currentSearchCriteria.location || "") + '" placeholder="San Francisco, CA"></label>',
          '      <label>Salary<input id="criteria-min-salary" type="text" value="' + escapeHtml(currentSearchCriteria.minSalary ? String(currentSearchCriteria.minSalary) : "") + '" placeholder="195000"></label>',
          '      <label>Posted on<select id="criteria-date-posted">' +
            '<option value=""' + (!currentSearchCriteria.datePosted ? " selected" : "") + ">Not set</option>" +
            '<option value="any"' + (currentSearchCriteria.datePosted === "any" ? " selected" : "") + ">Any time</option>" +
            '<option value="1d"' + (currentSearchCriteria.datePosted === "1d" ? " selected" : "") + ">Past 24 hours</option>" +
            '<option value="3d"' + (currentSearchCriteria.datePosted === "3d" ? " selected" : "") + ">Past 3 days</option>" +
            '<option value="1w"' + (currentSearchCriteria.datePosted === "1w" ? " selected" : "") + ">Past week</option>" +
            '<option value="2w"' + (currentSearchCriteria.datePosted === "2w" ? " selected" : "") + ">Past 2 weeks</option>" +
            '<option value="1m"' + (currentSearchCriteria.datePosted === "1m" ? " selected" : "") + ">Past month</option>" +
          "</select></label>",
          "    </div>",
          '  <p class="muted" style="margin-top: 10px;">Keyword mode: <strong>' + escapeHtml(keywordModeValue.toUpperCase()) + '</strong>. ' + escapeHtml(hardFilterSummary) + "</p>",
          '    <div class="search-criteria-actions">' +
            '      <span class="criteria-status' + (criteriaFeedbackError ? " error" : "") + (criteriaStatusMessage ? "" : " is-hidden") + '">' + escapeHtml(criteriaStatusMessage || "idle") + "</span>" +
            '      <button class="primary cta-find-jobs' + (criteriaBusy ? " is-loading" : "") + '" id="save-search-criteria" type="button"' + (busy ? " disabled" : "") + ">" +
            '        <span class="btn-spinner" aria-hidden="true"></span>' +
            '        <span>' + escapeHtml(findJobsButtonLabel) + "</span>" +
            "      </button>" +
            "    </div>",
          "</section>",
          '<section class="card jobs-controls-panel">',
          '  <div class="jobs-controls-head">',
            '    <button class="disclosure-btn" id="toggle-job-filters" aria-expanded="' + escapeHtml(String(!jobsFiltersCollapsed)) + '">',
            '      <span class="disclosure-caret">' + (jobsFiltersCollapsed ? "▸" : "▾") + "</span>",
            '      <span>Filter by Source</span>',
            "    </button>",
            '<div class="viewing-controls">' +
              '  <span class="viewing-label">Viewing</span>' +
              jobsViewPills +
            '</div>',
          "  </div>",
          (!jobsFiltersCollapsed
            ? [
                '  <div class="ranked-controls" style="margin-top: 12px;">',
                '    <div class="filter-chips" style="justify-content: flex-end;">' + sourceFilterPills + "</div>",
                "  </div>"
              ].join("")
            : ""),
          "</section>",
          '<div class="jobs-layout">',
          '  <section class="card">',
          '    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">',
          '      <p class="section-label" style="margin: 0;">Ranked Jobs (' + escapeHtml(String(jobsInView.length)) + ")</p>",
          '      <div class="sort-controls">' + jobsSortPills + "</div>",
          "    </div>",
          '    <div class="queue-list" style="margin-top: 10px;">' + queueItems + "</div>",
          queuePagination,
          "  </section>",
          '  <section class="card">',
          detailMarkup,
          "  </section>",
          "</div>"
        ].join("");

        const onboarding = onboardingData();
        const onboardingIncomplete = isOnboardingIncomplete();
        const onboardingSourceChecks = onboardingChecksBySourceId();
        const onboardingSources = onboardingCandidateSources();
        const onboardingReadinessBySourceId = Object.create(null);
        for (const source of onboardingSources) {
          onboardingReadinessBySourceId[source.id] = onboardingReadinessState(
            source,
            onboardingSourceChecks
          );
        }
        const onboardingEnabledSources = onboardingSources.filter((source) => {
          const readiness = onboardingReadinessBySourceId[source.id];
          return readiness.key === "ready";
        });
        const onboardingAuthPendingSources = onboardingSources.filter((source) => {
          const readiness = onboardingReadinessBySourceId[source.id];
          return sourceRequiresAuth(source) && source.enabled === true && readiness.key === "not_authorized";
        });
        const onboardingNotEnabledSources = onboardingSources.filter((source) => {
          const readiness = onboardingReadinessBySourceId[source.id];
          return readiness.key === "disabled";
        });
        const onboardingEnabledCount = onboardingSources.filter((source) => {
          const readiness = onboardingReadinessBySourceId[source.id];
          return readiness.key === "ready";
        }).length;
        const onboardingConsent = onboardingConsentForRender();
        const onboardingConsentComplete = isOnboardingConsentComplete(onboardingConsent);
        const onboardingLegalDocs =
          onboarding && onboarding.legalDocs && typeof onboarding.legalDocs === "object"
            ? onboarding.legalDocs
            : {};
        const onboardingTermsUrl = String(onboardingLegalDocs.termsUrl || "/policy/terms");
        const onboardingPrivacyUrl = String(onboardingLegalDocs.privacyUrl || "/policy/privacy");
        const renderOnboardingSourceRow = (source, options = {}) => {
          const readiness =
            onboardingReadinessBySourceId[source.id] ||
            onboardingReadinessState(source, onboardingSourceChecks);
          const checkResult = onboardingSourceChecks[source.id];
          const checkStatus =
            checkResult && checkResult.status ? String(checkResult.status).toLowerCase() : "";
          const hasPriorFailedCheck = Boolean(checkStatus) && checkStatus !== "pass";
          const isBusyRow = onboardingBusy && onboardingActiveSourceId === source.id;
          const lockOtherRows =
            onboardingBusy &&
            Boolean(onboardingActiveSourceId) &&
            onboardingActiveSourceId !== source.id;
          const disableControls =
            busy ||
            lockOtherRows ||
            isBusyRow ||
            Boolean(authFlowSourceId) ||
            authFlowBusy;
          const showCheckButton =
            sourceRequiresAuth(source) && readiness.key === "not_authorized";
          const checkButtonLabel = isBusyRow
            ? "Checking..."
            : hasPriorFailedCheck
              ? "Re-check"
              : "Check access";
          const overflowDisableMenu = buildSourceOverflowMenu(
            source.id,
            disableControls,
            readiness.key === "disabled" ? "enable" : "disable"
          );
          const actionMarkup =
            readiness.key === "disabled"
              ? '<button class="primary" data-onboarding-enable-source="' +
                  escapeHtml(source.id) +
                  '"' +
                  (disableControls ? " disabled" : "") +
                  ">Enable</button>"
              : showCheckButton
                ? '<button class="primary" data-onboarding-check-source="' +
                    escapeHtml(source.id) +
                    '"' +
                    (disableControls ? " disabled" : "") +
                    ">" +
                    escapeHtml(checkButtonLabel) +
                    "</button>"
                : "";
          const rowClass = options.compact === true
            ? "onboarding-source-row compact"
            : "onboarding-source-row";

          return (
            '<div class="' + rowClass + '">' +
            '  <div class="onboarding-source-top">' +
            '    <div class="onboarding-source-main">' +
            '      <span class="onboarding-source-name">' +
            escapeHtml(source.name) +
            "</span>" +
            "    </div>" +
            '    <div class="onboarding-source-meta">' +
            '      <span class="status-chip compact"><span class="status-dot" data-tone="' +
            escapeHtml(readiness.tone) +
            '"></span>' +
            escapeHtml(readiness.label) +
            "</span>" +
            overflowDisableMenu +
            "    </div>" +
            "  </div>" +
            (actionMarkup
              ? '  <div class="inline-actions onboarding-source-actions">' + actionMarkup + "</div>"
              : "") +
            "</div>"
          );
        };
        const onboardingEnabledSourcesMarkup = onboardingEnabledSources
          .map((source) => renderOnboardingSourceRow(source, { compact: true }))
          .join("");
        const onboardingAuthSourcesMarkup = onboardingAuthPendingSources
          .map((source) => renderOnboardingSourceRow(source))
          .join("");
        const onboardingNotEnabledSourcesMarkup = onboardingNotEnabledSources
          .map((source) => renderOnboardingSourceRow(source))
          .join("");
        const onboardingStatusMessage =
          onboardingStepStatus && onboardingStepStatus.trim().length > 0
            ? onboardingStepStatus
            : "";
        const onboardingStatusClass =
          "onboarding-status" + (onboardingStepStatusError ? " error" : "");
        const consentGateRequired = onboardingEnabled && onboardingConsentComplete !== true;
        const consentStatusMessage =
          onboardingStepStatus && onboardingStepStatus.trim().length > 0
            ? onboardingStepStatus
            : "";
        const consentInterstitial = consentGateRequired
          ? [
              '<section class="card" style="margin-top: 18px;">',
              '  <h3 class="onboarding-title">To access JobFinder, review and accept the following:</h3>',
              '  <div class="onboarding-checklist">',
              '<label><input id="onboarding-consent-legal" data-onboarding-consent="1" type="checkbox"' +
                (onboardingConsent.termsAccepted && onboardingConsent.privacyAccepted ? " checked" : "") +
              '><span class="consent-copy">I have read and accept the <a href="' +
                escapeHtml(onboardingTermsUrl) +
              '" target="_blank" rel="noopener noreferrer">Terms of Service</a> and <a href="' +
                escapeHtml(onboardingPrivacyUrl) +
              '" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>',
              '<label><input id="onboarding-consent-tos-risk" data-onboarding-consent="1" type="checkbox"' +
                (onboardingConsent.tosRiskAccepted ? " checked" : "") +
              '><span class="consent-copy">I understand some platforms restrict automated access from logged-in users and accept responsibility for my accounts.</span></label>',
              "  </div>",
              '  <div class="inline-actions onboarding-actions">',
              '    <button class="primary" id="onboarding-save-consent"' +
                (busy || onboardingBusy ? " disabled" : "") +
                ">Agree and Continue</button>",
              "  </div>",
              consentStatusMessage
                ? '  <div class="' +
                    onboardingStatusClass +
                    '">' +
                    escapeHtml(consentStatusMessage) +
                    "</div>"
                : "",
              "</section>"
            ].join("")
          : "";
        const onboardingCard = onboardingEnabled
          ? [
              '<div class="card inset onboarding-card" style="margin-top: 18px;">',
              '  <div class="onboarding-header">',
              '    <h3 class="onboarding-title">Connect your sources</h3>',
              '    <button class="secondary" id="onboarding-toggle-sources">' +
                    (onboardingSourcesCollapsed ? "Edit" : "Done") +
                    "</button>",
              "  </div>",
              (onboardingSourcesCollapsed
                ? ""
                : [
                    '  <div class="onboarding-stepper">',
                    '    <section class="onboarding-step">',
                    "      <h4>" +
                          escapeHtml("Enabled (" + String(onboardingEnabledCount) + ")") +
                          "</h4>",
                    '      <div class="onboarding-source-list">' +
                          (onboardingEnabledSourcesMarkup ||
                            '<div class="onboarding-source-empty">No enabled sources yet.</div>') +
                          "</div>",
                    "    </section>",
                    (onboardingAuthPendingSources.length > 0
                      ? [
                          '    <section class="onboarding-step">',
                          "      <h4>Authentication Required</h4>",
                          '      <div class="onboarding-source-list">' +
                                onboardingAuthSourcesMarkup +
                                "</div>",
                          (onboardingVerifyProgress
                            ? '      <div class="onboarding-progress">' + escapeHtml(onboardingVerifyProgress) + "</div>"
                            : ""),
                          "    </section>"
                        ].join("")
                      : ""),
                    '    <section class="onboarding-step">',
                    "      <h4>Not Enabled</h4>",
                    '      <div class="onboarding-source-list">' +
                          (onboardingNotEnabledSourcesMarkup ||
                            '<div class="onboarding-source-empty">No disabled sources.</div>') +
                          "</div>",
                    "    </section>",
                    "  </div>"
                  ].join("")),
              (onboardingStepStatusError && onboardingStatusMessage
                ? '  <div class="' + onboardingStatusClass + '">' + escapeHtml(onboardingStatusMessage) + "</div>"
                : ""),
              "</div>"
            ].join("")
          : "";
        const showSearchWelcomeToast =
          selectedSearchStateFilter === "enabled" &&
          !searchesWelcomeToastDismissed;
        if (showSearchWelcomeToast) {
          searchesWelcomeToastDismissed = true;
          try {
            window.localStorage.setItem(SEARCHES_WELCOME_TOAST_SEEN_KEY, "1");
          } catch {
            // no-op
          }
        }
        const searchesWelcomeToastMarkup = showSearchWelcomeToast
          ? '<div class="search-welcome-toast">' +
              '<button class="search-welcome-toast-close" type="button" aria-label="Close welcome message" data-search-welcome-dismiss="1">X</button>' +
              '<div class="search-welcome-toast-text">Welcome to Job Finder! The Enabled tab shows websites with public job postings. To enable sources like LinkedIn (where login is required) visit the Disabled tab.</div>' +
              '<div class="inline-actions search-welcome-toast-actions">' +
                '<button class="secondary" data-search-welcome-disabled="1">Go to Disabled</button>' +
              "</div>" +
            "</div>"
          : "";
        const authFlowSource =
          authFlowSourceId
            ? sourceById(authFlowSourceId)
            : null;
        const authFlowModalMarkup =
          authFlowSource && sourceRequiresAuth(authFlowSource)
            ? [
                '<div class="auth-flow-backdrop"></div>',
                '<section class="auth-flow-modal" role="dialog" aria-modal="true" aria-labelledby="auth-flow-title">',
                '  <h3 class="auth-flow-title" id="auth-flow-title">Connect ' +
                     escapeHtml(authFlowSource.name) +
                     "</h3>",
                '  <ol class="auth-flow-steps">',
                "    <li>Open source</li>",
                "    <li>Sign in</li>",
                "    <li>Click I&#39;m logged in</li>",
                "  </ol>",
                authFlowMessage
                  ? '  <div class="auth-flow-status' +
                      (authFlowError ? " error" : "") +
                      '">' +
                      escapeHtml(authFlowMessage) +
                      "</div>"
                  : "",
                '  <div class="inline-actions" style="margin-top: 12px;">',
                '    <button class="secondary" data-auth-flow-open-source="1"' +
                     (authFlowBusy ? " disabled" : "") +
                     ">Open Source</button>",
                '    <button class="primary" data-auth-flow-check="1"' +
                     (authFlowBusy ? " disabled" : "") +
                     ">" +
                     (authFlowBusy ? "Checking..." : "I&#39;m logged in") +
                     "</button>",
                '    <button class="secondary" data-auth-flow-close="1"' +
                     (authFlowBusy ? " disabled" : "") +
                     ">Close</button>",
                "  </div>",
                "</section>"
              ].join("")
            : "";

        const searchesSection = [
          '<div class="searches-shell">',
          '  <div class="searches-tabs-row">',
          '    <div class="search-state-tabs">' + searchFilterTabs + "</div>",
          "  </div>",
          '  <section class="card searches-card">',
          '  <div class="search-header">',
          '    <p class="section-label">My Job Searches</p>',
          "  </div>",
          (selectedSearchStateFilter === "enabled"
            ? '  <div class="search-controls-row">' +
                '    <label class="run-cadence-control">Search frequency<select id="search-run-cadence">' +
                  '<option value="12h"' + (selectedSearchRunCadence === "12h" ? " selected" : "") + ">12h (recommended)</option>" +
                  '<option value="daily"' + (selectedSearchRunCadence === "daily" ? " selected" : "") + ">Daily</option>" +
                  '<option value="weekly"' + (selectedSearchRunCadence === "weekly" ? " selected" : "") + ">Weekly</option>" +
                  '<option value="cached"' + (selectedSearchRunCadence === "cached" ? " selected" : "") + ">Use cached results (dev)</option>" +
                "</select></label>" +
              "</div>"
            : ""),
          '  <div style="margin-top: 16px; overflow-x: auto;">',
          '    <table>',
          '      <thead><tr><th>Source</th><th>Last Run</th><th>Status</th><th>Found</th><th>Filtered</th><th>Dupes</th><th>Imported</th><th>Avg Score</th><th>Actions</th></tr></thead>',
          '      <tbody>' + searchRows + "</tbody>",
          "    </table>",
          "  </div>",
          (filteredSearchSources.length === 0
            ? '  <div class="subhead search-empty">No sources in this tab.</div>'
            : ""),
          '  <div class="feedback' + (feedbackError ? " error" : "") + '">' + escapeHtml(feedback) + "</div>",
          "  </section>",
          "</div>",
          authFlowModalMarkup
        ].join("");
        const searchesPageSections = searchesSection + searchesWelcomeToastMarkup;

        const profileSection = [
          '<section class="card" style="margin-top: 18px;">',
          '  <p class="section-label">Profile</p>',
          '  <dl class="meta-grid">',
          '    <div class="meta-item"><dt>Candidate</dt><dd>' + escapeHtml(dashboard.profile.candidateName) + "</dd></div>",
          '    <div class="meta-item"><dt>Profile Source</dt><dd>' + escapeHtml(formatProfileProvider(dashboard.profile.provider, dashboard.profile.providerMode)) + "</dd></div>",
          '    <div class="meta-item"><dt>Remote Preference</dt><dd>' + escapeHtml(formatRemotePreference(dashboard.profile.remotePreference)) + "</dd></div>",
          '    <div class="meta-item"><dt>Salary Floor</dt><dd>$' + escapeHtml(Number(dashboard.profile.salaryFloor || 0).toLocaleString()) + "</dd></div>",
          '    <div class="meta-item"><dt>Active</dt><dd>' + escapeHtml(dashboard.profile.activeCount) + "</dd></div>",
          '    <div class="meta-item"><dt>Applied</dt><dd>' + escapeHtml(dashboard.profile.appliedCount) + "</dd></div>",
          '    <div class="meta-item"><dt>Skipped</dt><dd>' + escapeHtml(dashboard.profile.skippedCount || 0) + "</dd></div>",
          '    <div class="meta-item"><dt>Plan</dt><dd>' + escapeHtml(dashboard.monetization && dashboard.monetization.plan ? dashboard.monetization.plan : "free") + "</dd></div>",
          '    <div class="meta-item"><dt>Daily Limit</dt><dd>' + escapeHtml(dashboard.monetization && dashboard.monetization.dailyViewLimit !== undefined ? String(dashboard.monetization.dailyViewLimit) : "10") + "</dd></div>",
          '    <div class="meta-item"><dt>Views Used Today</dt><dd>' + escapeHtml(dashboard.monetization && dashboard.monetization.viewsUsedToday !== undefined ? String(dashboard.monetization.viewsUsedToday) : "0") + "</dd></div>",
          '    <div class="meta-item"><dt>Profile File</dt><dd>' + escapeHtml(dashboard.profile.profilePath || "") + "</dd></div>",
          '    <div class="meta-item"><dt>My Goals File</dt><dd>' + escapeHtml(dashboard.profile.goalsFilePath || "config/my-goals.json") + "</dd></div>",
          '    <div class="meta-item"><dt>Sources File</dt><dd>' + escapeHtml(dashboard.profile.sourcesPath || "") + "</dd></div>",
          '    <div class="meta-item"><dt>Search Criteria File</dt><dd>' + escapeHtml(dashboard.profile.searchCriteriaPath || "config/source-criteria.json") + "</dd></div>",
          '    <div class="meta-item"><dt>User Settings File</dt><dd>' + escapeHtml(dashboard.profile.settingsPath || "data/user-settings.json") + "</dd></div>",
          "  </dl>",
          '  <div class="inline-actions" style="margin-top: 10px;">' +
            '<a class="primary" id="donate-cta" href="' +
            escapeHtml((dashboard.monetization && dashboard.monetization.donationUrl) || "https://github.com/sponsors") +
            '" target="_blank" rel="noopener noreferrer">Support Job Finder</a>' +
          "</div>",
          '  <div class="card inset" style="margin-top: 12px;">',
          '    <p class="section-label">Preferences</p>',
          '    <div class="search-form" style="grid-template-columns: minmax(180px, 320px) auto; align-items: end;">',
          '      <label>Anonymous Metrics' +
            '<input id="profile-analytics-enabled" type="checkbox" class="onboarding-toggle"' +
            (dashboard.onboarding && dashboard.onboarding.analyticsEnabled ? " checked" : "") +
            ">" +
            "</label>",
          '      <div class="inline-actions"><button class="secondary" id="save-profile-analytics"' + (busy ? " disabled" : "") + ">Save Preference</button></div>",
          "    </div>",
          '    <div class="subhead" style="margin-top: 6px;">Used to improve product quality. You can change this anytime.</div>',
          "  </div>",
          ...(narrataConnectEnabled
            ? [
                '  <div class="card inset" style="margin-top: 14px;">',
                '    <p class="section-label">Connect Narrata / Goals</p>',
                '    <div class="subhead">Use standalone profile, standalone goals, or Narrata goals file without changing scoring commands.</div>',
                '    <div class="inline-actions" style="margin-top: 10px;">',
                '      <button class="secondary" id="use-profile-json"' + (busy ? " disabled" : "") + ">Use profile.json</button>",
                '      <button class="secondary" id="use-my-goals"' + (busy ? " disabled" : "") + ">Use my-goals.json</button>",
                "    </div>",
                '    <div class="search-form" style="margin-top: 12px;">',
                '      <label>Narrata Goals Path<input id="narrata-goals-path" type="text" value="' + escapeHtml(dashboard.profile.goalsPath || "config/my-goals.json") + '" placeholder="config/my-goals.json"></label>',
                '      <div class="inline-actions">',
                '        <button class="primary" id="connect-narrata-file"' + (busy ? " disabled" : "") + ">Connect Narrata (File)</button>",
                "      </div>",
                "    </div>",
                "  </div>"
              ]
            : []),
          '  <div class="feedback' + (feedbackError ? " error" : "") + '">' + escapeHtml(feedback) + "</div>",
          "</section>"
        ].join("");

        app.innerHTML = consentGateRequired
          ? consentInterstitial
          : [
              '<div class="header">',
              "  <div>",
              "    <h1>Job Finder</h1>",
              '    <div class="subhead">Search across sites to find your best matches</div>',
              "  </div>",
              "</div>",
              '<div class="main-tabs">' + tabButtons + "</div>",
              selectedTab === "jobs"
                ? jobsSection
                : selectedTab === "searches"
                  ? searchesPageSections
                  : profileSection
            ].join("");
        const shellPanel = document.querySelector(".panel");
        if (shellPanel) {
          shellPanel.classList.toggle("panel-consent-only", consentGateRequired);
        }

        if (consentGateRequired) {
          const saveOnboardingConsentButton = document.getElementById(
            "onboarding-save-consent"
          );
          if (saveOnboardingConsentButton) {
            saveOnboardingConsentButton.addEventListener("click", saveOnboardingConsent);
          }
          for (const input of document.querySelectorAll("[data-onboarding-consent]")) {
            input.addEventListener("change", () => {
              onboardingConsentDraft = readOnboardingConsentFromDom();
            });
          }
          return;
        }
        for (const button of document.querySelectorAll("[data-tab]")) {
          button.addEventListener("click", () => setTab(button.dataset.tab));
        }

        if (selectedTab === "jobs") {
          const saveCriteriaButton = document.getElementById("save-search-criteria");
          if (saveCriteriaButton) {
            saveCriteriaButton.addEventListener("click", saveSearchCriteriaConfig);
          }

          const toggleFiltersButton = document.getElementById("toggle-job-filters");
          if (toggleFiltersButton) {
            toggleFiltersButton.addEventListener("click", toggleJobsFilters);
          }

          for (const button of document.querySelectorAll("[data-filter-source]")) {
            button.addEventListener("click", () => setSourceFilter(button.dataset.filterSource));
          }

          for (const button of document.querySelectorAll("[data-jobs-view]")) {
            button.addEventListener("click", () => setJobsView(button.dataset.jobsView));
          }

          for (const select of document.querySelectorAll(".view-select")) {
            select.addEventListener("change", () => setJobsView(select.value));
          }

          for (const button of document.querySelectorAll("[data-jobs-sort]")) {
            button.addEventListener("click", () => setJobsSort(button.dataset.jobsSort));
          }

          for (const button of document.querySelectorAll("[data-jobs-page-nav]")) {
            button.addEventListener("click", () => {
              const step = button.dataset.jobsPageNav === "next" ? 1 : -1;
              setJobsPage(selectedJobsPage + step);
            });
          }

          for (const button of document.querySelectorAll("[data-job-id]")) {
            button.addEventListener("click", () => selectJob(button.dataset.jobId));
          }

          const openCurrentButton = document.getElementById("open-current");
          if (openCurrentButton) {
            openCurrentButton.addEventListener("click", openCurrent);
          }

          const prevJobButton = document.getElementById("prev-job");
          if (prevJobButton) {
            prevJobButton.addEventListener("click", () => moveSelection(-1));
          }

          const nextJobButton = document.getElementById("next-job");
          if (nextJobButton) {
            nextJobButton.addEventListener("click", () => moveSelection(1));
          }

          for (const button of document.querySelectorAll("[data-status]")) {
            button.addEventListener("click", () => updateStatus(button.dataset.status));
          }
        }

        if (selectedTab === "searches") {
          const saveOnboardingConsentButton = document.getElementById("onboarding-save-consent");
          if (saveOnboardingConsentButton) {
            saveOnboardingConsentButton.addEventListener("click", saveOnboardingConsent);
          }

          const toggleOnboardingSourcesButton = document.getElementById("onboarding-toggle-sources");
          if (toggleOnboardingSourcesButton) {
            toggleOnboardingSourcesButton.addEventListener("click", toggleOnboardingSourcesCollapsed);
          }

          for (const input of document.querySelectorAll("[data-onboarding-consent]")) {
            input.addEventListener("change", () => {
              onboardingConsentDraft = readOnboardingConsentFromDom();
            });
          }

          for (const button of document.querySelectorAll("[data-onboarding-enable-source]")) {
            button.addEventListener("click", () => {
              void enableOnboardingSource(button.dataset.onboardingEnableSource);
            });
          }

          for (const button of document.querySelectorAll("[data-onboarding-disable-source]")) {
            button.addEventListener("click", () => {
              void disableOnboardingSource(button.dataset.onboardingDisableSource);
            });
          }

          for (const button of document.querySelectorAll("[data-onboarding-check-source]")) {
            button.addEventListener("click", () => {
              void verifySingleOnboardingSource(button.dataset.onboardingCheckSource);
            });
          }

          for (const button of document.querySelectorAll("[data-onboarding-open-auth-source]")) {
            button.addEventListener("click", () => {
              openAuthFlowModal(
                button.dataset.onboardingOpenAuthSource,
                "Step 1: Open source. Step 2: Sign in. Step 3: Click I\u2019m logged in."
              );
            });
          }

          for (const button of document.querySelectorAll("[data-run-source-now]")) {
            button.addEventListener("click", () => {
              void runSourceNow(button.dataset.runSourceNow);
            });
          }

          for (const button of document.querySelectorAll("[data-search-state]")) {
            button.addEventListener("click", () => setSearchStateFilter(button.dataset.searchState));
          }

          for (const button of document.querySelectorAll("[data-search-welcome-dismiss]")) {
            button.addEventListener("click", () => dismissSearchesWelcomeToast());
          }

          for (const button of document.querySelectorAll("[data-search-welcome-disabled]")) {
            button.addEventListener("click", () => goToDisabledFromSearchesWelcomeToast());
          }

          for (const button of document.querySelectorAll("[data-auth-flow-open-source]")) {
            button.addEventListener("click", () => {
              const source = authFlowSourceId ? sourceById(authFlowSourceId) : null;
              if (!source) {
                closeAuthFlowModal();
                return;
              }
              openSourceInBrowser(source);
              authFlowMessage =
                source.name + " opened. Sign in there, then click I\u2019m logged in.";
              authFlowError = false;
              render();
            });
          }

          for (const button of document.querySelectorAll("[data-auth-flow-check]")) {
            button.addEventListener("click", () => {
              void runAuthFlowCheck();
            });
          }

          for (const button of document.querySelectorAll("[data-auth-flow-close]")) {
            button.addEventListener("click", () => closeAuthFlowModal());
          }

          const runCadenceSelect = document.getElementById("search-run-cadence");
          if (runCadenceSelect) {
            runCadenceSelect.addEventListener("change", () => {
              setSearchRunCadence(runCadenceSelect.value);
            });
          }

          for (const row of document.querySelectorAll("[data-open-jobs-row]")) {
            row.addEventListener("click", (event) => {
              if (event.target && event.target.closest("[data-stop-row-open]")) {
                return;
              }
              const sourceKind = String(row.dataset.openJobsRow || "").trim().toLowerCase();
              if (!sourceKind) {
                return;
              }
              selectedTab = "jobs";
              setSourceFilter(sourceKind);
            });
          }

        }

        if (selectedTab === "profile") {
          const donateButton = document.getElementById("donate-cta");
          if (donateButton) {
            donateButton.addEventListener("click", () => {
              void trackDonationClick();
            });
          }

          const saveProfileAnalyticsButton = document.getElementById("save-profile-analytics");
          if (saveProfileAnalyticsButton) {
            saveProfileAnalyticsButton.addEventListener("click", () => {
              saveAnalyticsPreferenceFromProfile();
            });
          }

          const useProfileButton = document.getElementById("use-profile-json");
          if (useProfileButton) {
            useProfileButton.addEventListener("click", () =>
              applyProfileSource("use_profile_file")
            );
          }

          const useGoalsButton = document.getElementById("use-my-goals");
          if (useGoalsButton) {
            useGoalsButton.addEventListener("click", () => {
              const goalsPathInput = document.getElementById("narrata-goals-path");
              const goalsPath =
                goalsPathInput && typeof goalsPathInput.value === "string"
                  ? goalsPathInput.value.trim()
                  : "";
              applyProfileSource("use_my_goals", { goalsPath });
            });
          }

          const connectNarrataButton = document.getElementById("connect-narrata-file");
          if (connectNarrataButton) {
            connectNarrataButton.addEventListener("click", () => {
              const goalsPathInput = document.getElementById("narrata-goals-path");
              const goalsPath =
                goalsPathInput && typeof goalsPathInput.value === "string"
                  ? goalsPathInput.value.trim()
                  : "";
              applyProfileSource("connect_narrata_file", { goalsPath });
            });
          }
        }
      }

      render();
    </script>
  </body>
</html>`;
}

function renderPolicyDocumentPage(title, content) {
  return [
    "<!doctype html>",
    "<html>",
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width,initial-scale=1" />',
    `    <title>${escapeHtml(title)}</title>`,
    "    <style>",
    "      body { margin: 0; padding: 24px; background: #f6f3ea; color: #1f2d2a; font-family: ui-serif, Georgia, serif; }",
    "      main { max-width: 920px; margin: 0 auto; background: #fffefb; border: 1px solid #d8cfbd; border-radius: 14px; padding: 20px; }",
    "      h1 { margin: 0 0 14px; font-size: 28px; }",
    "      pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.45; }",
    "    </style>",
    "  </head>",
    "  <body>",
    "    <main>",
    `      <h1>${escapeHtml(title)}</h1>`,
    `      <pre>${escapeHtml(content)}</pre>`,
    "    </main>",
    "  </body>",
    "</html>"
  ].join("\n");
}

export function startReviewServer({ port = 4311, limit = 5000 } = {}) {
  const useReactDashboardUi = isDashboardReactUiEnabled(process.env);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

      if (request.method === "GET" && url.pathname === "/policy/terms") {
        if (!fs.existsSync(LEGAL_TERMS_PATH)) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("TERMS.md not found.");
          return;
        }
        const content = fs.readFileSync(LEGAL_TERMS_PATH, "utf8");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderPolicyDocumentPage("Terms of Service", content));
        return;
      }

      if (request.method === "GET" && url.pathname === "/policy/privacy") {
        if (!fs.existsSync(LEGAL_PRIVACY_PATH)) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("PRIVACY.md not found.");
          return;
        }
        const content = fs.readFileSync(LEGAL_PRIVACY_PATH, "utf8");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderPolicyDocumentPage("Privacy Policy", content));
        return;
      }

      if (useReactDashboardUi && request.method === "GET" && url.pathname.startsWith("/assets/")) {
        const assetPath = resolveStaticAssetPath(url.pathname);
        if (!assetPath || !fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        const contentType = getStaticContentType(assetPath);
        response.writeHead(200, { "Content-Type": contentType });
        response.end(fs.readFileSync(assetPath));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(dashboard));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/queue") {
        const groupedQueue = hydrateQueue(getReviewQueue(limit), {
          sourceById: new Map(loadSources().sources.map((source) => [source.id, source]))
        });
        const queue = groupedQueue.filter(
          (job) => job.status === "new" || job.status === "viewed"
        );
        const appliedQueue = groupedQueue.filter((job) => job.status === "applied");
        const skippedQueue = groupedQueue.filter((job) => job.status === "skip_for_now");
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({ jobs: queue, appliedJobs: appliedQueue, skippedJobs: skippedQueue })
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/onboarding/consent") {
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const consentInput = {
          termsAccepted: Boolean(parsedBody.termsAccepted),
          privacyAccepted: Boolean(parsedBody.privacyAccepted),
          rateLimitPolicyAccepted: Boolean(parsedBody.rateLimitPolicyAccepted),
          tosRiskAccepted: Boolean(parsedBody.tosRiskAccepted)
        };

        if (!isConsentComplete(consentInput)) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              error: "Accept Terms/Privacy and ToS/account risk acknowledgement to continue."
            })
          );
          return;
        }

        updateInstallConsent(consentInput);

        const settings = loadUserSettings().settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(
            "onboarding_consent_updated",
            {
              consentAccepted: true
            },
            {
              installId: settings.installId,
              channel: effectiveChannel.value || effectiveChannel.channel || "unknown"
            }
          ),
          {
            analyticsEnabled: Boolean(settings?.analytics?.enabled)
          }
        );

        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, onboarding: dashboard.onboarding }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/onboarding/state") {
        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            ok: true,
            onboarding: dashboard.onboarding,
            monetization: dashboard.monetization,
            sources: dashboard.sources
          })
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/onboarding/channel") {
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const channel =
          typeof parsedBody.channel === "string" ? parsedBody.channel.trim() : "";

        if (channel) {
          updateOnboardingChannel(channel, "self_reported");
        }

        const settings = loadUserSettings().settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(
            "onboarding_channel_updated",
            {
              channel: effectiveChannel.value || effectiveChannel.channel || "unknown",
              analyticsEnabled: Boolean(settings?.analytics?.enabled)
            },
            {
              installId: settings.installId,
              channel: effectiveChannel.value || effectiveChannel.channel || "unknown"
            }
          ),
          {
            analyticsEnabled: Boolean(settings?.analytics?.enabled)
          }
        );

        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, onboarding: dashboard.onboarding }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/preferences/analytics") {
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const analyticsEnabled = Boolean(parsedBody.analyticsEnabled);

        updateAnalyticsPreference(analyticsEnabled);

        const settings = loadUserSettings().settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(
            "analytics_preference_updated",
            {
              analyticsEnabled
            },
            {
              installId: settings.installId,
              channel: effectiveChannel.value || effectiveChannel.channel || "unknown"
            }
          ),
          {
            analyticsEnabled
          }
        );

        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, onboarding: dashboard.onboarding }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/onboarding/sources") {
        const consentSettings = loadUserSettings().settings;
        if (!isConsentComplete(consentSettings?.onboarding?.consent)) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Complete Step 1 legal consent before source setup." }));
          return;
        }
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const sourceIds = Array.isArray(parsedBody.sourceIds)
          ? parsedBody.sourceIds.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const enabledSourceIds = Array.isArray(parsedBody.enabledSourceIds)
          ? parsedBody.enabledSourceIds
              .map((value) => String(value || "").trim())
              .filter(Boolean)
          : sourceIds;

        setEnabledSources(enabledSourceIds);
        updateOnboardingSources(enabledSourceIds);

        const settings = loadUserSettings().settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(
            "onboarding_sources_updated",
            {
              enabledCount: enabledSourceIds.length,
              enabledSourceIds,
              selectedCount: sourceIds.length,
              sourceIds
            },
            {
              installId: settings.installId,
              channel: effectiveChannel.value || effectiveChannel.channel || "unknown"
            }
          ),
          {
            analyticsEnabled: Boolean(settings?.analytics?.enabled)
          }
        );

        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            ok: true,
            sources: dashboard.sources,
            onboarding: dashboard.onboarding
          })
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/onboarding/check-source") {
        const consentSettings = loadUserSettings().settings;
        if (!isConsentComplete(consentSettings?.onboarding?.consent)) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Complete Step 1 legal consent before source verification." }));
          return;
        }
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const sourceId =
          typeof parsedBody.sourceId === "string" ? parsedBody.sourceId.trim() : "";
        if (!sourceId) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "sourceId is required" }));
          return;
        }

        const source = loadSources().sources.find((candidate) => candidate.id === sourceId);
        if (!source) {
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: `Source not found: ${sourceId}` }));
          return;
        }

        const captureRunFailed = parsedBody.captureRunFailed === true;
        const authProbe = parsedBody.authProbe === true;
        let result;
        if (captureRunFailed) {
          result = normalizeSourceCheckResult({
            status: "fail",
            reasonCode: "auth_check_failed",
            userMessage:
              "Sign-in could not be confirmed. Open source site, sign in, then retry.",
            technicalDetails: {
              sourceId,
              sourceType: source.type
            }
          });
        } else if (authProbe && isSourceAuthRequired(source.type)) {
          try {
            result = await runSourceAuthProbe(source, {
              closeWindowAfterProbe: parsedBody.closeWindowAfterProbe === true
            });
          } catch (error) {
            result = buildAuthPreflightFailure(source, error);
          }
        } else {
          result = normalizeSourceCheckResult(
            checkSourceAccess(source, {
              probeLive: parsedBody.probeLive === true,
              ignoreEnabled: true
            })
          );
        }
        updateOnboardingSourceCheck(sourceId, result);

        const settings = loadUserSettings().settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(
            "onboarding_source_check",
            {
              sourceId,
              status: result.status,
              reasonCode: result.reasonCode
            },
            {
              installId: settings.installId,
              channel: effectiveChannel.value || effectiveChannel.channel || "unknown"
            }
          ),
          {
            analyticsEnabled: Boolean(settings?.analytics?.enabled)
          }
        );

        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, result, onboarding: dashboard.onboarding }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/onboarding/complete") {
        const consentSettings = loadUserSettings().settings;
        if (!isConsentComplete(consentSettings?.onboarding?.consent)) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Complete Step 1 legal consent before finishing onboarding." }));
          return;
        }
        const next = markOnboardingCompleted();
        const settings = next.settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(
            "onboarding_completed",
            {
              completedAt: settings?.onboarding?.completedAt || null,
              selectedSourceCount: Array.isArray(settings?.onboarding?.selectedSourceIds)
                ? settings.onboarding.selectedSourceIds.length
                : 0
            },
            {
              installId: settings.installId,
              channel: effectiveChannel.value || effectiveChannel.channel || "unknown"
            }
          ),
          {
            analyticsEnabled: Boolean(settings?.analytics?.enabled)
          }
        );
        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, onboarding: dashboard.onboarding }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/analytics/event") {
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const eventName =
          typeof parsedBody.eventName === "string" ? parsedBody.eventName.trim() : "";
        const properties =
          parsedBody.properties &&
          typeof parsedBody.properties === "object" &&
          !Array.isArray(parsedBody.properties)
            ? parsedBody.properties
            : {};

        if (!eventName) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "eventName is required" }));
          return;
        }

        const settings = loadUserSettings().settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(eventName, properties, {
            installId: settings.installId,
            channel: effectiveChannel.value || effectiveChannel.channel || "unknown"
          }),
          {
            analyticsEnabled: Boolean(settings?.analytics?.enabled)
          }
        );

        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/profile/source") {
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const action = typeof parsedBody.action === "string" ? parsedBody.action.trim() : "";

        if (!action) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "action is required" }));
          return;
        }

        if (action === "use_profile_file") {
          useLegacyProfileSource("config/profile.json");
        } else if (action === "use_my_goals") {
          useMyGoalsProfileSource(
            typeof parsedBody.goalsPath === "string" && parsedBody.goalsPath.trim()
              ? parsedBody.goalsPath.trim()
              : "config/my-goals.json"
          );
        } else if (action === "connect_narrata_file") {
          connectNarrataGoalsFile(
            typeof parsedBody.goalsPath === "string" && parsedBody.goalsPath.trim()
              ? parsedBody.goalsPath.trim()
              : "config/my-goals.json"
          );
        } else {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              error: "action must be one of use_profile_file, use_my_goals, connect_narrata_file"
            })
          );
          return;
        }

        const dashboard = buildDashboardData(limit);
        trackDashboardEvent("profile_source_changed", {
          action
        });
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, profile: dashboard.profile }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/search-criteria") {
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const parseTerms = (value) => {
          if (Array.isArray(value)) {
            return value;
          }
          if (typeof value === "string") {
            return value
              .split(",")
              .map((segment) => segment.trim())
              .filter(Boolean);
          }
          return [];
        };

        const payload = {
          title: typeof parsedBody.title === "string" ? parsedBody.title : "",
          keywords: typeof parsedBody.keywords === "string" ? parsedBody.keywords : "",
          keywordMode: typeof parsedBody.keywordMode === "string" ? parsedBody.keywordMode : "",
          hardIncludeTerms: parseTerms(parsedBody.hardIncludeTerms),
          hardIncludeMode:
            typeof parsedBody.hardIncludeMode === "string" ? parsedBody.hardIncludeMode : "",
          hardExcludeTerms: parseTerms(parsedBody.hardExcludeTerms),
          scoreKeywords: parseTerms(parsedBody.scoreKeywords),
          scoreKeywordMode:
            typeof parsedBody.scoreKeywordMode === "string" ? parsedBody.scoreKeywordMode : "",
          includeTerms: parseTerms(parsedBody.includeTerms),
          excludeTerms: parseTerms(parsedBody.excludeTerms),
          location: typeof parsedBody.location === "string" ? parsedBody.location : "",
          minSalary:
            Number.isFinite(Number(parsedBody.minSalary)) && Number(parsedBody.minSalary) > 0
              ? Math.round(Number(parsedBody.minSalary))
              : null,
          datePosted: typeof parsedBody.datePosted === "string" ? parsedBody.datePosted : ""
        };

        const saved = saveSearchCriteria(payload);
        const normalized = normalizeAllSourceSearchUrls();
        const dashboard = buildDashboardData(limit);
        trackDashboardEvent("search_criteria_updated", {
          has_title: Boolean(saved.criteria.title),
          has_keywords: Boolean(saved.criteria.keywords),
          keyword_mode: saved.criteria.keywordMode || "and",
          has_hard_include_terms:
            Array.isArray(saved.criteria.hardIncludeTerms) && saved.criteria.hardIncludeTerms.length > 0,
          hard_include_mode: saved.criteria.hardIncludeMode || "and",
          has_hard_exclude_terms:
            Array.isArray(saved.criteria.hardExcludeTerms) && saved.criteria.hardExcludeTerms.length > 0,
          has_score_keywords:
            Array.isArray(saved.criteria.scoreKeywords) && saved.criteria.scoreKeywords.length > 0,
          score_keyword_mode: saved.criteria.scoreKeywordMode || "and",
          has_include_terms: Array.isArray(saved.criteria.includeTerms) && saved.criteria.includeTerms.length > 0,
          has_exclude_terms: Array.isArray(saved.criteria.excludeTerms) && saved.criteria.excludeTerms.length > 0,
          has_location: Boolean(saved.criteria.location),
          has_min_salary: Number.isFinite(Number(saved.criteria.minSalary)),
          date_posted: saved.criteria.datePosted || ""
        });

        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            ok: true,
            criteria: saved.criteria,
            normalizedChanged: normalized.changed,
            searchCriteriaPath: saved.path,
            dashboard
          })
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/sources/upsert") {
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const sourceId =
          typeof parsedBody.sourceId === "string" && parsedBody.sourceId.trim()
            ? parsedBody.sourceId.trim()
            : null;
        const name = typeof parsedBody.name === "string" ? parsedBody.name : "";
        const searchUrl = typeof parsedBody.searchUrl === "string" ? parsedBody.searchUrl : "";
        const recencyWindow =
          typeof parsedBody.recencyWindow === "string"
            ? parsedBody.recencyWindow.trim()
            : "";
        const wellfoundEnabled = isWellfoundEnabled();
        const remoteokEnabled = isRemoteOkEnabled();

        if (!sourceId && isWellfoundJobsUrl(searchUrl) && !wellfoundEnabled) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              error:
                "Wellfound sources are currently disabled. Set JOB_FINDER_ENABLE_WELLFOUND=1 to enable."
            })
          );
          return;
        }

        if (!sourceId && isRemoteOkJobsUrl(searchUrl) && !remoteokEnabled) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              error:
                "RemoteOK sources are currently disabled. Set JOB_FINDER_ENABLE_REMOTEOK=1 to enable."
            })
          );
          return;
        }

        const source = sourceId
          ? updateSourceDefinition(sourceId, { name, searchUrl, recencyWindow })
          : isIndeedJobsUrl(searchUrl)
            ? addIndeedSearchSource(name, searchUrl)
            : isZipRecruiterJobsUrl(searchUrl)
              ? addZipRecruiterSearchSource(name, searchUrl)
              : isRemoteOkJobsUrl(searchUrl)
                ? addRemoteOkSearchSource(name, searchUrl)
          : isBuiltInJobsUrl(searchUrl)
            ? addBuiltinSearchSource(name, searchUrl)
            : isGoogleAshbyDiscoveryUrl(searchUrl)
              ? addAshbySearchSource(name, searchUrl, "config/sources.json", recencyWindow)
              : isGoogleJobsUrl(searchUrl)
                ? addGoogleSearchSource(name, searchUrl, "config/sources.json", recencyWindow)
            : isWellfoundJobsUrl(searchUrl)
              ? addWellfoundSearchSource(name, searchUrl)
              : isAshbyJobsUrl(searchUrl)
                ? addAshbySearchSource(name, searchUrl, "config/sources.json", recencyWindow)
                : addLinkedInCaptureSource(name, searchUrl);

        if (!sourceId) {
          trackDashboardEvent("source_added", {
            source_id: source.id,
            source_type: source.type
          });
        }

        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, source }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/sources/run-all") {
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const refreshProfile =
          typeof parsedBody.refreshProfile === "string"
            ? parsedBody.refreshProfile
            : undefined;
        const normalizedRefreshProfile = normalizeRefreshProfile(refreshProfile || "safe");
        const cacheTtlHours =
          Number.isFinite(Number(parsedBody.cacheTtlHours)) && Number(parsedBody.cacheTtlHours) > 0
            ? Math.round(Number(parsedBody.cacheTtlHours))
            : undefined;
        const forceRefresh = parsedBody.forceRefresh === true;
        const skipAuthPreflight =
          parsedBody.skipAuthPreflight === true || normalizedRefreshProfile === "mock";
        if (!skipAuthPreflight) {
          const blockedSources = await runAuthPreflightForEnabledSources({
            refreshProfile: normalizedRefreshProfile
          });
          if (blockedSources.length > 0) {
            response.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
            response.end(
              JSON.stringify({
                error:
                  "Sign-in is required for one or more enabled sources before running searches.",
                requiresAuthCheck: true,
                authSources: blockedSources
              })
            );
            return;
          }
        }
        const result = await runAllCapturesWithOptions({
          refreshProfile: normalizedRefreshProfile,
          forceRefresh,
          cacheTtlHours
        });
        incrementMonthlySearchUsage();
        const settings = loadUserSettings().settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(
            "sources_run_all",
            {
              captureCount: Array.isArray(result?.captures) ? result.captures.length : 0,
              forceRefresh
            },
            {
              installId: settings.installId,
              channel: effectiveChannel.value || effectiveChannel.channel || "unknown"
            }
          ),
          {
            analyticsEnabled: Boolean(settings?.analytics?.enabled)
          }
        );
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/sync-score") {
        const sync = runSyncAndScore();
        trackDashboardEvent("sync_score_completed", {
          collected: sync.collected,
          upserted: sync.upserted,
          pruned: sync.pruned,
          new_count: sync.newCount,
          updated_count: sync.updatedCount,
          unchanged_count: sync.unchangedCount,
          skipped_by_quality: sync.skippedByQuality,
          evaluated: sync.evaluated,
          retention_deleted: Number(sync?.retentionCleanup?.totalDeleted || 0)
        });
        const next = markFirstRunCompleted();
        const settings = next.settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(
            "first_run_completed",
            {
              collected: Number(sync?.collected || 0),
              upserted: Number(sync?.upserted || 0),
              evaluated: Number(sync?.evaluated || 0)
            },
            {
              installId: settings.installId,
              channel: effectiveChannel.value || effectiveChannel.channel || "unknown"
            }
          ),
          {
            analyticsEnabled: Boolean(settings?.analytics?.enabled)
          }
        );
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, sync }));
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/sources/")) {
        const manualMatch = url.pathname.match(/^\/api\/sources\/([^/]+)\/manual-refresh$/);
        if (manualMatch) {
          const sourceId = decodeURIComponent(manualMatch[1]);
          const source = loadSources().sources.find((candidate) => candidate.id === sourceId);
          if (!source) {
            response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
            response.end(JSON.stringify({ error: `Source not found: ${sourceId}` }));
            return;
          }
          if (source.enabled !== true) {
            response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            response.end(JSON.stringify({ error: "Enable this source before running it now." }));
            return;
          }

          const nowIso = new Date().toISOString();
          const refreshState = readRefreshState();
          const manualRefreshesToday = countSourceEventsForUtcDay(
            refreshState,
            sourceId,
            nowIso,
            { mode: "manual" }
          );
          if (manualRefreshesToday >= MANUAL_REFRESH_DAILY_CAP) {
            response.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
            response.end(
              JSON.stringify({
                error: `Manual refresh limit reached for today (${MANUAL_REFRESH_DAILY_CAP}/${MANUAL_REFRESH_DAILY_CAP}).`,
                reason: "manual_daily_cap",
                nextEligibleAt: nextUtcDayStartIso(Date.now())
              })
            );
            return;
          }

          const decision = getSourceRefreshDecision(source, {
            profile: "safe"
          });
          if (!decision.allowLive) {
            response.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
            response.end(
              JSON.stringify({
                error: "Manual refresh is not available yet.",
                reason: decision.reason,
                nextEligibleAt: decision.nextEligibleAt || null
              })
            );
            return;
          }

          const result = await runSourceCaptureWithOptions(sourceId, {
            refreshProfile: "safe",
            runMode: "manual"
          });
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok: true, ...result }));
          return;
        }

        const match = url.pathname.match(/^\/api\/sources\/([^/]+)\/run$/);
        if (!match) {
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const result = await runSourceCaptureWithOptions(decodeURIComponent(match[1]), {
          refreshProfile:
            typeof parsedBody.refreshProfile === "string"
              ? parsedBody.refreshProfile
              : undefined,
          cacheTtlHours:
            Number.isFinite(Number(parsedBody.cacheTtlHours)) &&
            Number(parsedBody.cacheTtlHours) > 0
              ? Math.round(Number(parsedBody.cacheTtlHours))
              : undefined,
          forceRefresh: parsedBody.forceRefresh === true,
          skipSync: parsedBody.skipSync === true
        });
        trackDashboardEvent("source_run_completed", {
          source_id: decodeURIComponent(match[1]),
          capture_status: result?.capture?.status || "unknown",
          capture_provider: result?.capture?.provider || "",
          jobs_imported:
            Number.isFinite(Number(result?.capture?.jobsImported))
              ? Number(result.capture.jobsImported)
              : null,
          sync_evaluated:
            Number.isFinite(Number(result?.sync?.evaluated))
              ? Number(result.sync.evaluated)
              : null,
          sync_new_count:
            Number.isFinite(Number(result?.sync?.newCount))
              ? Number(result.sync.newCount)
              : null,
          sync_updated_count:
            Number.isFinite(Number(result?.sync?.updatedCount))
              ? Number(result.sync.updatedCount)
              : null,
          sync_unchanged_count:
            Number.isFinite(Number(result?.sync?.unchangedCount))
              ? Number(result.sync.unchangedCount)
              : null,
          retention_deleted:
            Number.isFinite(Number(result?.sync?.retentionCleanup?.totalDeleted))
              ? Number(result.sync.retentionCleanup.totalDeleted)
              : null
        });
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/jobs/")) {
        const match = url.pathname.match(/^\/api\/jobs\/([^/]+)\/status$/);
        if (!match) {
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const status = typeof parsedBody.status === "string" ? parsedBody.status.trim() : "";
        const reason =
          typeof parsedBody.reason === "string" ? parsedBody.reason.trim() : "";

        if (!status) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "status is required" }));
          return;
        }

        const allowedStatuses = new Set([
          "new",
          "viewed",
          "applied",
          "skip_for_now",
          "rejected"
        ]);
        if (!allowedStatuses.has(status)) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              error: `status must be one of ${[...allowedStatuses].join(", ")}`
            })
          );
          return;
        }

        if (status === "rejected" && !reason) {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "reason is required for rejected jobs" }));
          return;
        }

        updateStatus(decodeURIComponent(match[1]), status, reason);
        trackDashboardEvent("job_status_changed", {
          status,
          has_reason: Boolean(reason)
        });
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        if (useReactDashboardUi && fs.existsSync(REVIEW_WEB_INDEX_PATH)) {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(fs.readFileSync(REVIEW_WEB_INDEX_PATH, "utf8"));
          return;
        }

        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderDashboardPage(dashboard));
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}
