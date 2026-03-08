import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createAnalyticsClient } from "../analytics/client.js";

import {
  captureSourceViaBridge,
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
import { classifyRunDeltas } from "../jobs/run-deltas.js";
import { evaluateJobsFromSearchCriteria } from "../jobs/score.js";
import {
  getSourceRefreshDecision,
  normalizeRefreshProfile,
  readSourceCaptureSummary
} from "../sources/cache-policy.js";
import {
  evaluateCaptureRun,
  shouldIngestCaptureEvaluation,
  writeCaptureQuarantineArtifact
} from "../sources/capture-validation.js";
import { classifyRefreshErrorOutcome, recordRefreshEvent } from "../sources/refresh-state.js";
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
  normalizeSourceCheckResult
} from "../onboarding/source-access.js";
import {
  getEffectiveOnboardingChannel,
  loadUserSettings,
  markFirstRunCompleted,
  markOnboardingCompleted,
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
  const expected = Number.isFinite(Number(expectedCount)) ? Math.round(Number(expectedCount)) : null;
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
    source?.type === "wellfound_search" ||
    source?.type === "ashby_search" ||
    source?.type === "indeed_search" ||
    source?.type === "ziprecruiter_search" ||
    source?.type === "remoteok_search"
  );
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

function buildLinkedInSearchUrl(job) {
  const query = [job.title, job.company].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    keywords: query
  });
  return `https://www.linkedin.com/jobs/search-results/?${params.toString()}`;
}

function resolveReviewTarget(job) {
  const sourceUrl = typeof job.sourceUrl === "string" ? job.sourceUrl : "";
  const externalId = typeof job.externalId === "string" ? job.externalId : "";

  if (sourceUrl.startsWith("https://www.linkedin.com/jobs/search-results/")) {
    return {
      url: sourceUrl,
      mode: "search"
    };
  }

  if (/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?$/i.test(sourceUrl)) {
    return {
      url: sourceUrl,
      mode: "direct"
    };
  }

  if (/^\d+$/.test(externalId)) {
    return {
      url: `https://www.linkedin.com/jobs/view/${externalId}/`,
      mode: "direct"
    };
  }

  if (
    sourceUrl.startsWith("https://www.linkedin.com/jobs/view/") &&
    !/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?$/i.test(sourceUrl)
  ) {
    return {
      url: buildLinkedInSearchUrl(job),
      mode: "search"
    };
  }

  return {
    url: sourceUrl || buildLinkedInSearchUrl(job),
    mode: sourceUrl ? "direct" : "search"
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
  const groups = new Map();

  for (const rawJob of queue) {
    const groupKey =
      typeof rawJob.normalizedHash === "string" && rawJob.normalizedHash.trim()
        ? rawJob.normalizedHash
        : rawJob.id;

    const existing = groups.get(groupKey);
    const status = normalizeStatus(rawJob.status);
    const reasons = parseReasons(rawJob.reasons);
    const note =
      typeof rawJob.notes === "string" && rawJob.notes.trim().length > 0
        ? rawJob.notes.trim()
        : "";

    if (!existing) {
      groups.set(groupKey, {
        ...rawJob,
        id: groupKey,
        groupKey,
        primaryJobId: rawJob.id,
        status,
        reasons: [...reasons],
        reviewTarget: resolveReviewTarget(rawJob),
        sourceIds: rawJob.sourceId ? [rawJob.sourceId] : [],
        duplicateCount: 1,
        notes: note,
        _statuses: [status]
      });
      continue;
    }

    existing.duplicateCount += 1;

    if (rawJob.sourceId && !existing.sourceIds.includes(rawJob.sourceId)) {
      existing.sourceIds.push(rawJob.sourceId);
    }

    for (const reasonItem of reasons) {
      if (!existing.reasons.includes(reasonItem)) {
        existing.reasons.push(reasonItem);
      }
    }

    if (note && !existing.notes) {
      existing.notes = note;
    }

    const reviewTarget = resolveReviewTarget(rawJob);
    if (existing.reviewTarget.mode !== "direct" && reviewTarget.mode === "direct") {
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
  const statusReason = decision.reason || "eligible";
  const statusLabelMap = {
    eligible: "ready_live",
    force_refresh: "ready_live",
    cache_fresh: "cache_fresh",
    cooldown: "cooldown",
    min_interval: "throttled",
    daily_cap: "daily_cap",
    mock_profile: "cache_only"
  };

  return {
    refreshMode: refreshProfile,
    servedFrom: decision.servedFrom,
    lastLiveAt: decision.sourceState?.lastLiveAt || null,
    nextEligibleAt: decision.nextEligibleAt || null,
    cooldownUntil: decision.sourceState?.cooldownUntil || null,
    statusLabel: statusLabelMap[statusReason] || "cache_only",
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
      sync: runSyncAndScore()
    };
  }

  const refreshProfile = normalizeRefreshProfile(
    options.refreshProfile || process.env.JOB_FINDER_REFRESH_PROFILE || "safe"
  );
  const decision = getSourceRefreshDecision(source, {
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
      sync: runSyncAndScore()
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
      at: capture.capturedAt || new Date().toISOString()
    });
  }

  const sync = capture.status === "completed" ? runSyncAndScore() : null;

  return {
    capture,
    sync
  };
}

async function runAllCaptures() {
  return runAllCapturesWithOptions({});
}

async function runAllCapturesWithOptions(options = {}) {
  const sources = loadSources().sources.filter((source) => source.enabled);
  const captures = [];
  let completedCount = 0;
  const refreshProfile = normalizeRefreshProfile(
    options.refreshProfile || process.env.JOB_FINDER_REFRESH_PROFILE || "safe"
  );
  const liveBrowserSources = [];
  const decisions = new Map();

  for (const source of sources) {
    if (!isBrowserCaptureSource(source)) {
      continue;
    }

    const decision = getSourceRefreshDecision(source, {
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
    await ensureBridgeForSources(liveBrowserSources);
  }

  for (const source of sources) {
    let capture;

    if (isBrowserCaptureSource(source)) {
      const decision = decisions.get(source.id) || getSourceRefreshDecision(source, {
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
          capture = await captureSourceViaBridge(
            source,
            buildSourceSnapshotPath(source)
          );
        } catch (error) {
          const outcome = classifyRefreshErrorOutcome(error);
          const decision = decisions.get(source.id);
          recordRefreshEvent({
            statePath: options.refreshStatePath,
            sourceId: source.id,
            outcome,
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

    if (capture.status !== "completed") {
      break;
    }

    completedCount += 1;
  }

  return {
    captures,
    sync: completedCount > 0 ? runSyncAndScore() : null
  };
}

function buildDashboardData(limit = 200) {
  const activeProfile = loadActiveProfile();
  const profile = activeProfile.profile;
  const searchCriteria = loadSearchCriteria();
  const sources = loadSources().sources;
  const userSettings = loadUserSettings();
  const settings = userSettings.settings;
  const effectiveChannel = getEffectiveOnboardingChannel(settings);
  const onboardingEnabled = isOnboardingWizardEnabled();
  const analyticsFlagEnabled = isAnalyticsEnabledByFlag();
  const monetizationLimitsEnabled = isMonetizationLimitsEnabled();
  const entitlement = getEntitlementState(settings);
  const statsQueue = hydrateQueue(getAllJobsWithStatus(5_000), { includeRejected: true });
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
        isFileBackedCapture && Number.isFinite(Number(capture.expectedCount))
          ? Math.round(Number(capture.expectedCount))
          : null;
      const jobCount = counts.totalCount;
      const importedCount = Number(
        Number.isFinite(Number(captureFunnel.keptAfterDedupeCount))
          ? captureFunnel.keptAfterDedupeCount
          : jobCount
      );
      const captureStatus = isFileBackedCapture ? capture.status : "live_source";
      const capturedAt = isFileBackedCapture
        ? capture.capturedAt
        : sourceLastSeenAt.get(source.id) || null;
      const importedNormalizedHashes = Array.isArray(
        captureFunnel.importedNormalizedHashes
      )
        ? captureFunnel.importedNormalizedHashes
        : [];
      let importedScoreTotal = 0;
      let importedScoredCount = 0;
      for (const importedHash of importedNormalizedHashes) {
        const scoreValue = Number(
          scoresBySourceIdAndHash.get(`${source.id}::${importedHash}`)
        );
        if (Number.isFinite(scoreValue)) {
          importedScoreTotal += scoreValue;
          importedScoredCount += 1;
        }
      }
      const avgScore =
        importedScoredCount > 0
          ? Math.round(importedScoreTotal / importedScoredCount)
          : counts.scoredCount > 0
            ? Math.round(counts.scoreTotal / counts.scoredCount)
            : null;
      const importVerification = buildSourceImportVerification(
        captureExpectedCount,
        importedCount
      );

      return {
        id: source.id,
        name: source.name,
        searchUrl: source.searchUrl,
        criteriaAccountability: source.criteriaAccountability || null,
        formatterDiagnostics: source.formatterDiagnostics || null,
        recencyWindow: source.recencyWindow || null,
        enabled: source.enabled,
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

      .search-row {
        cursor: pointer;
      }

      .search-row:hover {
        background: rgba(255, 255, 255, 0.5);
      }

      .search-row:hover .search-link-label {
        text-decoration: underline;
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
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
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

        .cta-find-jobs {
          width: 100%;
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
      let selectedSearchSourceFilter = "all";
      let selectedJobId = dashboard.queue[0] ? dashboard.queue[0].id : null;
      let editingSourceId = null;
      let sourceFormOpen = false;
      let feedback = "";
      let feedbackError = false;
      let criteriaFeedback = "";
      let criteriaFeedbackError = false;
      let busy = false;
      let criteriaBusy = false;
      const narrataConnectEnabled = ${narrataConnectEnabled ? "true" : "false"};
      const wellfoundEnabled = ${wellfoundEnabled ? "true" : "false"};
      const remoteokEnabled = ${remoteokEnabled ? "true" : "false"};
      const onboardingEnabled =
        dashboard.featureFlags && dashboard.featureFlags.onboardingWizard !== false;

      const app = document.getElementById("app");
      const JOBS_PAGE_SIZE = 10;

      if (onboardingEnabled && dashboard.onboarding && dashboard.onboarding.completed !== true) {
        selectedTab = "searches";
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

      function onboardingChecksBySourceId() {
        const onboarding = onboardingData();
        const checks = onboarding && onboarding.checks && typeof onboarding.checks === "object"
          ? onboarding.checks
          : {};
        return checks.sources && typeof checks.sources === "object" ? checks.sources : {};
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

      function isSourceVisibleForSearchFilter(source) {
        if (!source || !isSourceTypeEnabled(source.type)) {
          return false;
        }
        return (
          selectedSearchSourceFilter === "all" ||
          sourceKindFromType(source.type) === selectedSearchSourceFilter
        );
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
          : "Open Job";
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
          throw new Error(payload.error || "The dashboard request failed.");
        }

        return payload;
      }

      async function refreshDashboard() {
        const payload = await getJson("/api/dashboard");
        dashboard = payload;
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
          const runAllPayload = await getJson("/api/sources/run-all", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          if (!runAllPayload?.sync) {
            await getJson("/api/sync-score", {
              method: "POST",
              headers: { "Content-Type": "application/json" }
            });
          }
          await refreshDashboard();
          const captures = Array.isArray(runAllPayload?.captures) ? runAllPayload.captures : [];
          const completedCaptures = captures.filter((capture) => capture?.status === "completed").length;
          const liveCaptures = captures.filter(
            (capture) =>
              capture?.servedFrom === "live" ||
              (capture?.provider && capture.provider !== "cache" && capture?.cached !== true)
          ).length;
          const cachedCaptures = captures.filter(
            (capture) =>
              capture?.servedFrom === "cache" ||
              capture?.cached === true ||
              capture?.provider === "cache"
          ).length;
          const runDeltaText =
            runAllPayload?.sync &&
            Number.isFinite(Number(runAllPayload.sync.newCount)) &&
            Number.isFinite(Number(runAllPayload.sync.updatedCount)) &&
            Number.isFinite(Number(runAllPayload.sync.unchangedCount))
              ? " Run delta: new " +
                String(Number(runAllPayload.sync.newCount)) +
                ", updated " +
                String(Number(runAllPayload.sync.updatedCount)) +
                ", unchanged " +
                String(Number(runAllPayload.sync.unchangedCount)) +
                "."
              : "";
          const activeRankedCount = Number(dashboard?.profile?.activeCount || 0);
          setCriteriaFeedback(
            "Done. Ran " +
              String(completedCaptures) +
              "/" +
              String(captures.length) +
              " sources (" +
              String(liveCaptures) +
              " live source(s), " +
              String(cachedCaptures) +
              " cached source(s)). " +
              String(activeRankedCount) +
              " active ranked jobs." +
              runDeltaText
          );
        } catch (error) {
          setCriteriaFeedback(error.message, true);
        } finally {
          criteriaBusy = false;
          busy = false;
          render();
        }
      }

      async function saveOnboardingChannel() {
        const channelInput = document.getElementById("onboarding-channel");
        const analyticsToggle = document.getElementById("onboarding-analytics-enabled");
        const channel =
          channelInput && typeof channelInput.value === "string"
            ? channelInput.value.trim()
            : "";
        const analyticsEnabled = analyticsToggle ? Boolean(analyticsToggle.checked) : true;

        busy = true;
        setFeedback("Saving onboarding preferences...");

        try {
          await getJson("/api/onboarding/channel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel, analyticsEnabled })
          });
          await refreshDashboard();
          setFeedback("Onboarding preferences saved.");
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          busy = false;
          render();
        }
      }

      async function saveOnboardingSources() {
        const sourceIds = [...document.querySelectorAll("[data-onboarding-source]")]
          .filter((input) => input.checked)
          .map((input) => input.value);

        busy = true;
        setFeedback("Saving source selection...");

        try {
          await getJson("/api/onboarding/sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceIds })
          });
          await refreshDashboard();
          setFeedback("Source selection saved.");
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          busy = false;
          render();
        }
      }

      async function runOnboardingSourceChecks() {
        const sourceIds = [...document.querySelectorAll("[data-onboarding-source]")]
          .filter((input) => input.checked)
          .map((input) => input.value);

        if (sourceIds.length === 0) {
          setFeedback("Select at least one source first.", true);
          return;
        }

        busy = true;
        setFeedback("Running source checks...");

        try {
          for (const sourceId of sourceIds) {
            await getJson("/api/onboarding/check-source", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sourceId, probeLive: false })
            });
          }

          await refreshDashboard();
          setFeedback("Source checks complete.");
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          busy = false;
          render();
        }
      }

      async function completeOnboarding() {
        busy = true;
        setFeedback("Completing onboarding...");

        try {
          await getJson("/api/onboarding/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          await refreshDashboard();
          setFeedback("Onboarding completed.");
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
        if (!job) {
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

      function setSearchSourceFilter(filterValue) {
        const normalized = String(filterValue || "all").trim();
        if (!normalized) {
          return;
        }

        if (normalized !== "all" && !visibleSourceKinds().includes(normalized)) {
          return;
        }

        selectedSearchSourceFilter = normalized;
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
        const sourceFilterOrder = ["li", "bi", "ah", "id", "zr", "gg", "wf", "ro", "unknown"];
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
        if (
          selectedSearchSourceFilter !== "all" &&
          !sourceFilters.some((sourceFilter) => sourceFilter.kind === selectedSearchSourceFilter)
        ) {
          selectedSearchSourceFilter = "all";
        }

        const searchSourcesByKind = new Map();
        const adapterHealthRank = (status) => {
          if (status === "failing") return 3;
          if (status === "degraded") return 2;
          if (status === "ok") return 1;
          return 0;
        };
        for (const source of sourcesForDisplay) {
          const sourceKind = sourceKindFromType(source.type);
          const current = searchSourcesByKind.get(sourceKind) || {
            kind: sourceKind,
            label: sourceKindLabel(sourceKind),
            sourceIds: [],
            searchUrl: "",
            recencyWindow: null,
            capturedAt: null,
            captureStatus: "never_run",
            captureFunnelError: null,
            hasCacheState: false,
            refreshMode: null,
            refreshServedFrom: null,
            refreshStatusReason: null,
            refreshStatusLabel: null,
            refreshContextAtMs: null,
            jobCount: 0,
            capturedCount: 0,
            filteredCount: 0,
            dedupedCount: 0,
            importedCount: 0,
            runNewCount: 0,
            runUpdatedCount: 0,
            runUnchangedCount: 0,
            runImportedCount: 0,
            hasRunDelta: false,
            runDeltaRecordedAt: null,
            runDeltaCapturedAt: null,
            expectedFoundCount: 0,
            hasUnknownExpectedCount: false,
            adapterHealthStatus: "unknown",
            adapterHealthScore: null,
            adapterHealthReason: null,
            adapterHealthUpdatedAt: null,
            formatterUnsupported: [],
            formatterNotes: [],
            appliedCount: 0,
            skippedCount: 0,
            highSignalCount: 0,
            weightedAvgScoreTotal: 0,
            weightedAvgScoreCount: 0
          };

          current.sourceIds.push(source.id);
          if (!current.searchUrl && source.searchUrl) {
            current.searchUrl = source.searchUrl;
          }
          if (!current.recencyWindow && source.recencyWindow) {
            current.recencyWindow = source.recencyWindow;
          }

          const capturedAtMs = Date.parse(source.capturedAt || "");
          const currentCapturedAtMs = Date.parse(current.capturedAt || "");
          if (
            Number.isFinite(capturedAtMs) &&
            (!Number.isFinite(currentCapturedAtMs) || capturedAtMs > currentCapturedAtMs)
          ) {
            current.capturedAt = source.capturedAt;
          } else if (!current.capturedAt && source.capturedAt) {
            current.capturedAt = source.capturedAt;
          }

          if (source.captureStatus === "capture_error") {
            current.captureStatus = "capture_error";
          } else if (
            source.captureStatus === "live_source" &&
            current.captureStatus !== "capture_error"
          ) {
            current.captureStatus = "live_source";
          } else if (
            source.captureStatus === "ready" &&
            current.captureStatus !== "capture_error" &&
            current.captureStatus !== "live_source"
          ) {
            current.captureStatus = "ready";
          }

          if (source.captureFunnelError && !current.captureFunnelError) {
            current.captureFunnelError = source.captureFunnelError;
          }

          const sourceFormatterDiagnostics =
            source.formatterDiagnostics &&
            typeof source.formatterDiagnostics === "object" &&
            !Array.isArray(source.formatterDiagnostics)
              ? source.formatterDiagnostics
              : {};
          const sourceFormatterUnsupported = Array.isArray(
            sourceFormatterDiagnostics.unsupported
          )
            ? sourceFormatterDiagnostics.unsupported
            : Array.isArray(source.criteriaAccountability?.unsupported)
              ? source.criteriaAccountability.unsupported
              : [];
          for (const unsupportedField of sourceFormatterUnsupported) {
            const normalizedUnsupportedField = String(unsupportedField || "").trim();
            if (
              normalizedUnsupportedField &&
              !current.formatterUnsupported.includes(normalizedUnsupportedField)
            ) {
              current.formatterUnsupported.push(normalizedUnsupportedField);
            }
          }
          const sourceFormatterNotes = Array.isArray(sourceFormatterDiagnostics.notes)
            ? sourceFormatterDiagnostics.notes
            : [];
          for (const formatterNote of sourceFormatterNotes) {
            const normalizedFormatterNote = String(formatterNote || "").trim();
            if (
              normalizedFormatterNote &&
              !current.formatterNotes.includes(normalizedFormatterNote)
            ) {
              current.formatterNotes.push(normalizedFormatterNote);
            }
          }

          const sourceHealthStatus =
            typeof source.adapterHealthStatus === "string"
              ? source.adapterHealthStatus
              : "unknown";
          const sourceHealthReasons = Array.isArray(source.adapterHealthReasons)
            ? source.adapterHealthReasons
            : [];
          const sourceHealthScore = Number(source.adapterHealthScore);
          if (
            adapterHealthRank(sourceHealthStatus) >
            adapterHealthRank(current.adapterHealthStatus)
          ) {
            current.adapterHealthStatus = sourceHealthStatus;
            current.adapterHealthScore = Number.isFinite(sourceHealthScore)
              ? sourceHealthScore
              : null;
            current.adapterHealthReason =
              sourceHealthReasons.length > 0 ? sourceHealthReasons[0] : null;
            current.adapterHealthUpdatedAt =
              typeof source.adapterHealthUpdatedAt === "string" &&
              source.adapterHealthUpdatedAt.trim()
                ? source.adapterHealthUpdatedAt
                : null;
          } else if (
            current.adapterHealthStatus === sourceHealthStatus &&
            current.adapterHealthReason === null &&
            sourceHealthReasons.length > 0
          ) {
            current.adapterHealthReason = sourceHealthReasons[0];
            if (
              typeof source.adapterHealthUpdatedAt === "string" &&
              source.adapterHealthUpdatedAt.trim()
            ) {
              current.adapterHealthUpdatedAt = source.adapterHealthUpdatedAt;
            }
          }

          if (
            source.servedFrom === "cache" ||
            source.statusReason === "cache_fresh" ||
            source.statusReason === "cooldown" ||
            source.statusReason === "min_interval" ||
            source.statusReason === "daily_cap" ||
            source.statusReason === "mock_profile"
          ) {
            current.hasCacheState = true;
          }

          const sourceContextTimestampMs = Number.isFinite(capturedAtMs)
            ? capturedAtMs
            : Date.parse(source.runRecordedAt || source.runCapturedAt || "");
          if (
            !Number.isFinite(current.refreshContextAtMs) ||
            (Number.isFinite(sourceContextTimestampMs) &&
              sourceContextTimestampMs > current.refreshContextAtMs)
          ) {
            current.refreshContextAtMs = Number.isFinite(sourceContextTimestampMs)
              ? sourceContextTimestampMs
              : null;
            current.refreshMode = source.refreshMode || null;
            current.refreshServedFrom = source.servedFrom || null;
            current.refreshStatusReason = source.statusReason || null;
            current.refreshStatusLabel = source.statusLabel || null;
          }

          const sourceJobCount = Number(source.jobCount || 0);
          const sourceCapturedCount = Number(source.captureJobCount || 0);
          const sourceFilteredCount = Number(source.droppedByHardFilterCount || 0);
          const sourceDedupedCount = Number(source.droppedByDedupeCount || 0);
          const sourceImportedCount = Number(source.importedCount || 0);
          const sourceExpectedCount = Number.isFinite(Number(source.captureExpectedCount))
            ? Math.max(0, Math.round(Number(source.captureExpectedCount)))
            : null;
          const sourceHighSignalCount = Number(source.highSignalCount || 0);
          const sourceAppliedCount = Number(source.appliedCount || 0);
          const sourceSkippedCount = Number(source.skippedCount || 0);
          const sourceAvgScore =
            source.avgScore === null || source.avgScore === undefined
              ? null
              : Number(source.avgScore);
          const sourceRunNewCount = Number.isFinite(Number(source.runNewCount))
            ? Math.max(0, Math.round(Number(source.runNewCount)))
            : null;
          const sourceRunUpdatedCount = Number.isFinite(Number(source.runUpdatedCount))
            ? Math.max(0, Math.round(Number(source.runUpdatedCount)))
            : null;
          const sourceRunUnchangedCount = Number.isFinite(Number(source.runUnchangedCount))
            ? Math.max(0, Math.round(Number(source.runUnchangedCount)))
            : null;
          const sourceRunImportedCount = Number.isFinite(Number(source.runImportedCount))
            ? Math.max(0, Math.round(Number(source.runImportedCount)))
            : null;

          current.jobCount += sourceJobCount;
          current.capturedCount += sourceCapturedCount;
          current.filteredCount += sourceFilteredCount;
          current.dedupedCount += sourceDedupedCount;
          current.importedCount += sourceImportedCount;
          if (sourceExpectedCount === null) {
            current.hasUnknownExpectedCount = true;
          } else {
            current.expectedFoundCount += sourceExpectedCount;
          }
          current.highSignalCount += sourceHighSignalCount;
          current.appliedCount += sourceAppliedCount;
          current.skippedCount += sourceSkippedCount;
          if (
            sourceRunNewCount !== null ||
            sourceRunUpdatedCount !== null ||
            sourceRunUnchangedCount !== null
          ) {
            current.hasRunDelta = true;
            current.runNewCount += sourceRunNewCount || 0;
            current.runUpdatedCount += sourceRunUpdatedCount || 0;
            current.runUnchangedCount += sourceRunUnchangedCount || 0;
            current.runImportedCount += sourceRunImportedCount || 0;
          }

          const sourceRunRecordedAtMs = Date.parse(source.runRecordedAt || "");
          const currentRunRecordedAtMs = Date.parse(current.runDeltaRecordedAt || "");
          if (
            Number.isFinite(sourceRunRecordedAtMs) &&
            (!Number.isFinite(currentRunRecordedAtMs) ||
              sourceRunRecordedAtMs > currentRunRecordedAtMs)
          ) {
            current.runDeltaRecordedAt = source.runRecordedAt;
          }

          const sourceRunCapturedAtMs = Date.parse(source.runCapturedAt || "");
          const currentRunCapturedAtMs = Date.parse(current.runDeltaCapturedAt || "");
          if (
            Number.isFinite(sourceRunCapturedAtMs) &&
            (!Number.isFinite(currentRunCapturedAtMs) ||
              sourceRunCapturedAtMs > currentRunCapturedAtMs)
          ) {
            current.runDeltaCapturedAt = source.runCapturedAt;
          }

          if (
            sourceAvgScore !== null &&
            Number.isFinite(sourceAvgScore) &&
            sourceImportedCount > 0
          ) {
            current.weightedAvgScoreTotal += sourceAvgScore * sourceImportedCount;
            current.weightedAvgScoreCount += sourceImportedCount;
          }

          searchSourcesByKind.set(sourceKind, current);
        }

        const searchSources = [...searchSourcesByKind.values()].sort((left, right) => {
          const leftIndex = sourceFilterOrder.indexOf(left.kind);
          const rightIndex = sourceFilterOrder.indexOf(right.kind);
          const normalizedLeft = leftIndex >= 0 ? leftIndex : sourceFilterOrder.length;
          const normalizedRight = rightIndex >= 0 ? rightIndex : sourceFilterOrder.length;
          if (normalizedLeft !== normalizedRight) {
            return normalizedLeft - normalizedRight;
          }

          return left.label.localeCompare(right.label);
        });

        const filteredSearchSources = searchSources.filter((source) =>
          selectedSearchSourceFilter === "all" || source.kind === selectedSearchSourceFilter
        );
        const searchFilterTabs = [
          '<button class="sub-tab' + (selectedSearchSourceFilter === "all" ? " active" : "") + '" data-search-source="all">All</button>',
          ...sourceFilters.map((source) =>
            '<button class="sub-tab' +
            (selectedSearchSourceFilter === source.kind ? " active" : "") +
            '" data-search-source="' +
            escapeHtml(source.kind) +
            '">' +
            escapeHtml(source.label) +
            "</button>"
          )
        ].join("");
        const searchRowMarkup = filteredSearchSources
          .map((source) => {
            const sourceKind = source.kind;
            const isActive = selectedSourceFilter === sourceKind;
            const safeName = escapeHtml(source.label);
            const safeSearchUrl = escapeHtml(source.searchUrl || "");
            const lastRun = escapeHtml(formatTime(source.capturedAt));
            const statusLabelRaw =
              source.captureStatus === "ready"
                ? "ready"
                : source.captureStatus === "capture_error"
                  ? "capture error"
                  : source.captureStatus === "live_source"
                    ? "live source"
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

            return [
              '<tr class="search-row" data-open-jobs-row="' + escapeHtml(source.kind) + '">',
              "  <td>" + sourceLabel + "</td>",
              "  <td>" + lastRun + "</td>",
              "  <td>" +
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
              "  <td>" + escapeHtml(foundLabel) + "</td>",
              "  <td>" + escapeHtml(source.filteredCount) + "</td>",
              "  <td>" + escapeHtml(source.dedupedCount) + "</td>",
              "  <td>" + escapeHtml(source.importedCount) + "</td>",
              "  <td>" +
                escapeHtml(
                  source.weightedAvgScoreCount > 0
                    ? Math.round(source.weightedAvgScoreTotal / source.weightedAvgScoreCount)
                    : "n/a"
                ) +
                "</td>",
              '  <td><div class="search-actions">' +
                '<button class="' + (isActive ? "primary" : "secondary") + '" data-stop-row-open="1" data-see-results="' + escapeHtml(sourceKind) + '">See Results</button>' +
                "</div></td>",
              "</tr>"
            ].join("");
          })
          .join("");
        const totalsRowMarkup =
          selectedSearchSourceFilter === "all" && filteredSearchSources.length > 0
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
                    accumulator.avgScoreTotal += Number(source.weightedAvgScoreTotal || 0);
                    accumulator.avgScoreCount += Number(source.weightedAvgScoreCount || 0);
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
                  "  <td>All Sources Total</td>",
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
                  '    <div class="meta-item"><dt>Link</dt><dd><a href="' + encodeURI(job.reviewTarget.url) + '" target="job-review-target" rel="noreferrer">' + escapeHtml(reviewLinkLabel(job)) + "</a></dd></div>",
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
        const onboardingSelectedSources = new Set(
          Array.isArray(onboarding.selectedSourceIds) ? onboarding.selectedSourceIds : []
        );
        const onboardingChannelValue =
          onboarding.channel && onboarding.channel.value ? onboarding.channel.value : "unknown";
        const onboardingSourcesMarkup = dashboard.sources
          .map((source) => {
            const checked = onboardingSelectedSources.has(source.id);
            const checkResult = onboardingSourceChecks[source.id];
            const checkStatus =
              checkResult && typeof checkResult.status === "string"
                ? checkResult.status
                : "unknown";
            const checkLabel =
              checkResult && checkResult.userMessage
                ? checkResult.userMessage
                : "Not checked yet";
            const statusPrefix =
              checkStatus === "pass"
                ? "[PASS]"
                : checkStatus === "fail"
                  ? "[FAIL]"
                  : checkStatus === "warn"
                    ? "[WARN]"
                    : "[TODO]";

            return (
              '<label style="display:block; margin-bottom: 8px;">' +
              '<input type="checkbox" data-onboarding-source="1" value="' +
              escapeHtml(source.id) +
              '"' +
              (checked ? " checked" : "") +
              "> " +
              escapeHtml(source.name) +
              ' <span class="muted">' +
              escapeHtml(statusPrefix + " " + checkLabel) +
              "</span></label>"
            );
          })
          .join("");
        const onboardingCard = onboardingEnabled
          ? [
              '<div class="card inset" style="margin-top: 12px;">',
              '  <p class="section-label">Onboarding</p>',
              '  <div class="subhead">' +
                escapeHtml(
                  onboardingIncomplete
                    ? "Complete setup to run your first successful import."
                    : "Onboarding complete."
                ) +
                "</div>",
              '  <div class="search-form" style="margin-top: 10px;">',
              '    <label>Install Channel<select id="onboarding-channel">' +
                '<option value="unknown"' +
                (onboardingChannelValue === "unknown" ? " selected" : "") +
                ">Unknown</option>" +
                '<option value="npm"' +
                (onboardingChannelValue === "npm" ? " selected" : "") +
                ">npm</option>" +
                '<option value="codex"' +
                (onboardingChannelValue === "codex" ? " selected" : "") +
                ">Codex</option>" +
                '<option value="claude"' +
                (onboardingChannelValue === "claude" ? " selected" : "") +
                ">Claude</option>" +
                "</select></label>",
              '    <label>Analytics' +
                '<input id="onboarding-analytics-enabled" type="checkbox"' +
                (onboarding.analyticsEnabled ? " checked" : "") +
                ">" +
                "</label>",
              "  </div>",
              '  <div style="margin-top: 10px;">' + onboardingSourcesMarkup + "</div>",
              '  <div class="inline-actions" style="margin-top: 10px;">',
              '    <button class="secondary" id="save-onboarding-channel"' + (busy ? " disabled" : "") + ">Save Preferences</button>",
              '    <button class="secondary" id="save-onboarding-sources"' + (busy ? " disabled" : "") + ">Save Sources</button>",
              '    <button class="secondary" id="run-onboarding-checks"' + (busy ? " disabled" : "") + ">Run Source Checks</button>",
              '    <button class="primary" id="complete-onboarding"' + (busy ? " disabled" : "") + ">Complete Onboarding</button>",
              "  </div>",
              '  <div class="subhead" style="margin-top: 10px;">Step order: save preferences, save sources, run checks, then Find Jobs.</div>',
              "</div>"
            ].join("")
          : "";

        const searchesSection = [
          '<section class="card" style="margin-top: 18px;">',
          '  <div class="search-header">',
          '    <p class="section-label">My Job Searches</p>',
          "  </div>",
          onboardingCard,
          '  <div class="sub-tabs" style="margin-top: 8px;">' + searchFilterTabs + "</div>",
          '  <div style="margin-top: 16px; overflow-x: auto;">',
          '    <table>',
          '      <thead><tr><th>Source</th><th>Last Run</th><th>Status</th><th>Found</th><th>Filtered</th><th>Dupes</th><th>Imported</th><th>Avg Score</th><th>Actions</th></tr></thead>',
          '      <tbody>' + searchRows + "</tbody>",
          "    </table>",
          "  </div>",
          (filteredSearchSources.length === 0
            ? '  <div class="subhead search-empty">No searches in this source filter.</div>'
            : ""),
          '  <div class="feedback' + (feedbackError ? " error" : "") + '">' + escapeHtml(feedback) + "</div>",
          "</section>"
        ].join("");

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

        app.innerHTML = [
          '<div class="header">',
          "  <div>",
          "    <h1>Job Finder</h1>",
          '    <div class="subhead">Manage saved searches, run intake, and review ranked jobs in one place.</div>',
          "  </div>",
          "</div>",
          '<div class="main-tabs">' + tabButtons + "</div>",
          selectedTab === "jobs"
            ? jobsSection
            : selectedTab === "searches"
              ? searchesSection
              : profileSection
        ].join("");
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
          const saveOnboardingChannelButton = document.getElementById("save-onboarding-channel");
          if (saveOnboardingChannelButton) {
            saveOnboardingChannelButton.addEventListener("click", saveOnboardingChannel);
          }

          const saveOnboardingSourcesButton = document.getElementById("save-onboarding-sources");
          if (saveOnboardingSourcesButton) {
            saveOnboardingSourcesButton.addEventListener("click", saveOnboardingSources);
          }

          const runOnboardingChecksButton = document.getElementById("run-onboarding-checks");
          if (runOnboardingChecksButton) {
            runOnboardingChecksButton.addEventListener("click", runOnboardingSourceChecks);
          }

          const completeOnboardingButton = document.getElementById("complete-onboarding");
          if (completeOnboardingButton) {
            completeOnboardingButton.addEventListener("click", completeOnboarding);
          }

          for (const button of document.querySelectorAll("[data-search-source]")) {
            button.addEventListener("click", () => setSearchSourceFilter(button.dataset.searchSource));
          }

          for (const button of document.querySelectorAll("[data-see-results]")) {
            button.addEventListener("click", () => {
              selectedTab = "jobs";
              setSourceFilter(button.dataset.seeResults);
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

export function startReviewServer({ port = 4311, limit = 5000 } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        const dashboard = buildDashboardData(limit);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(dashboard));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/queue") {
        const groupedQueue = hydrateQueue(getReviewQueue(limit));
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

        if (typeof parsedBody.analyticsEnabled === "boolean") {
          updateAnalyticsPreference(parsedBody.analyticsEnabled);
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

      if (request.method === "POST" && url.pathname === "/api/onboarding/sources") {
        const rawBody = await readRequestBody(request);
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const sourceIds = Array.isArray(parsedBody.sourceIds)
          ? parsedBody.sourceIds.map((value) => String(value || "").trim()).filter(Boolean)
          : [];

        setEnabledSources(sourceIds);
        updateOnboardingSources(sourceIds);

        const settings = loadUserSettings().settings;
        const effectiveChannel = getEffectiveOnboardingChannel(settings);
        await recordAnalyticsEvent(
          buildAnalyticsEvent(
            "onboarding_sources_updated",
            {
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

        const result = normalizeSourceCheckResult(
          checkSourceAccess(source, { probeLive: parsedBody.probeLive === true })
        );
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
        const forceRefresh = parsedBody.forceRefresh === true;
        const result = await runAllCapturesWithOptions({
          refreshProfile,
          forceRefresh
        });
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
          forceRefresh: parsedBody.forceRefresh === true
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
