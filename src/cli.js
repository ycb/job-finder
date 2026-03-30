import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createAnalyticsClient } from "./analytics/client.js";

import {
  captureSourceViaBridge,
  resolveBrowserBridgeBaseUrl
} from "./browser-bridge/client.js";
import { startBrowserBridgeServer } from "./browser-bridge/server.js";
import {
  getSourceAggregationIds,
} from "./config/source-library.js";
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
  connectNarrataSupabase,
  getSourceByIdOrName,
  loadActiveProfile,
  loadSearchCriteria,
  loadProfileSourceConfig,
  loadSources,
  previewNormalizedSourceSearchUrls,
  normalizeAllSourceSearchUrls,
  useLegacyProfileSource,
  useMyGoalsProfileSource,
  updateSourceSearchUrl
} from "./config/load-config.js";
import { buildAnalyticsEvent, recordAnalyticsEvent } from "./analytics/events.js";
import { isAnalyticsEnabledByFlag } from "./config/feature-flags.js";
import { loadRetentionPolicy } from "./config/retention-policy.js";
import { openDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrations.js";
import { normalizeJobRecord } from "./jobs/normalize.js";
import { applyRetentionPolicyCleanup, writeRetentionCleanupAudit } from "./jobs/retention.js";
import {
  listAllJobs,
  listNormalizedHashesOutsideSources,
  listSourceJobsForDelta,
  listReviewQueue,
  listTopJobs,
  markApplicationStatus,
  recordSourceRunDeltas,
  upsertEvaluations,
  upsertJobs,
  pruneSourceJobs
} from "./jobs/repository.js";
import {
  buildSourceRunSemanticMetrics,
  classifyRunDeltas
} from "./jobs/run-deltas.js";
import { evaluateJobsFromSearchCriteria } from "./jobs/score.js";
import { writeShortlistFile } from "./shortlist/render.js";
import { startReviewServer } from "./review/server.js";
import {
  getSourceRefreshDecision,
  normalizeRefreshProfile,
  readSourceCaptureSummary
} from "./sources/cache-policy.js";
import { classifyRefreshErrorOutcome, recordRefreshEvent } from "./sources/refresh-state.js";
import {
  evaluateCaptureRun,
  shouldIngestCaptureEvaluation,
  writeCaptureQuarantineArtifact
} from "./sources/capture-validation.js";
import {
  applySourceQaOverrides,
  isSourceQaModeEnabled
} from "./sources/qa-mode.js";
import {
  computeSourceHealthStatus,
  recordSourceHealthFromCaptureEvaluation
} from "./sources/source-health.js";
import {
  evaluateSourceCanaries,
  loadSourceCanaries,
  writeSourceCanaryDiagnostics
} from "./sources/source-canaries.js";
import { runSourceContractDiagnostics } from "./sources/source-contracts.js";
import {
  collectJobsFromSource,
  importLinkedInSnapshot
} from "./sources/linkedin-saved-search.js";
import { checkEnvironmentReadiness, checkSourceAccess } from "./onboarding/source-access.js";
import {
  getEffectiveOnboardingChannel,
  loadUserSettings,
  updateAnalyticsPreference,
  updateOnboardingChannel
} from "./onboarding/state.js";
import { runInkInitWizard } from "./cli/ui/init-wizard.js";
import { CliUsageError, isCliUsageError } from "./cli/ui/errors.js";
import { createCliOutput, parseGlobalOutputOptions } from "./cli/ui/output.js";

const terminalAnalytics = createAnalyticsClient({ channel: "terminal" });

function trackTerminalEvent(eventName, properties = {}) {
  try {
    void terminalAnalytics.track(eventName, properties);
  } catch {
    // Never block CLI flow on analytics.
  }
}

function runRetentionCleanupWithAudit(db, options = {}) {
  const loadedPolicy = loadRetentionPolicy(options.retentionPolicyPath);
  const cleanup = applyRetentionPolicyCleanup(db, loadedPolicy.policy, {
    nowMs: options.nowMs
  });
  const auditPath = writeRetentionCleanupAudit(cleanup, options.retentionAuditPath);

  return {
    policyPath: loadedPolicy.path,
    policyExists: loadedPolicy.exists,
    cleanup,
    auditPath
  };
}

function withDatabase() {
  const { db, dbPath } = openDatabase();
  runMigrations(db);
  return { db, dbPath };
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

function printJobRows(rows) {
  if (rows.length === 0) {
    console.log("No jobs found.");
    return;
  }

  for (const row of rows) {
    console.log(
      [
        row.id,
        `${row.title} @ ${row.company}`,
        `score=${row.score ?? "n/a"}`,
        `bucket=${row.bucket ?? "unscored"}`,
        `status=${row.status ?? "new"}`
      ].join(" | ")
    );
  }
}

function extractFlag(args, flag) {
  const remaining = [];
  let present = false;

  for (const arg of Array.isArray(args) ? args : []) {
    if (arg === flag) {
      present = true;
      continue;
    }

    remaining.push(arg);
  }

  return {
    present,
    args: remaining
  };
}

function extractOption(args, optionName) {
  const remaining = [];
  let value = null;

  for (let index = 0; index < (Array.isArray(args) ? args.length : 0); index += 1) {
    const arg = args[index];
    if (arg === optionName) {
      const next = args[index + 1];
      if (typeof next === "string" && !next.startsWith("--")) {
        value = next;
        index += 1;
      } else {
        value = "";
      }
      continue;
    }
    remaining.push(arg);
  }

  return {
    value,
    args: remaining
  };
}

const INSTALL_CHANNEL_CHOICES = new Set(["npm", "codex", "claude", "unknown"]);

function normalizeInstallChannelInput(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (!INSTALL_CHANNEL_CHOICES.has(normalized)) {
    throw new CliUsageError(
      `Invalid install channel "${rawValue}". Use one of: npm, codex, claude, unknown.`
    );
  }
  return normalized;
}

function parseAnalyticsInput(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "y", "on", "enabled", "enable"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off", "disabled", "disable"].includes(normalized)) {
    return false;
  }
  throw new CliUsageError(
    `Invalid analytics value "${rawValue}". Use yes/no (or true/false).`
  );
}

function parseOptionValue(args, flag) {
  const remaining = [];
  let value = null;

  for (let index = 0; index < (Array.isArray(args) ? args.length : 0); index += 1) {
    const arg = args[index];
    const prefix = `${flag}=`;
    if (typeof arg === "string" && arg.startsWith(prefix)) {
      value = arg.slice(prefix.length);
      continue;
    }
    if (arg === flag) {
      if (index + 1 >= args.length) {
        throw new CliUsageError(`Missing value for ${flag}.`);
      }
      value = args[index + 1];
      index += 1;
      continue;
    }
    remaining.push(arg);
  }

  return {
    value,
    args: remaining
  };
}

function parseInitOptions(args) {
  const parsedChannel = parseOptionValue(args, "--channel");
  const parsedAnalytics = parseOptionValue(parsedChannel.args, "--analytics");
  const noAnalytics = extractFlag(parsedAnalytics.args, "--no-analytics");
  const nonInteractive = extractFlag(noAnalytics.args, "--non-interactive");

  if (nonInteractive.args.length > 0) {
    throw new CliUsageError(`Unknown option(s) for init: ${nonInteractive.args.join(" ")}`);
  }

  const channel = parsedChannel.value ? normalizeInstallChannelInput(parsedChannel.value) : null;
  const analyticsFromArg = parsedAnalytics.value
    ? parseAnalyticsInput(parsedAnalytics.value)
    : null;
  if (noAnalytics.present && analyticsFromArg !== null) {
    throw new CliUsageError("Invalid analytics options: use either --analytics <yes|no> or --no-analytics.");
  }
  const analyticsEnabled = noAnalytics.present ? false : analyticsFromArg;

  return {
    channel,
    analyticsEnabled,
    nonInteractive: nonInteractive.present
  };
}

async function runInit(options = {}, output = createCliOutput()) {
  const settings = loadUserSettings();
  const defaultChannel =
    settings.settings?.onboarding?.channel?.value &&
    settings.settings.onboarding.channel.value !== "unknown"
      ? settings.settings.onboarding.channel.value
      : "unknown";
  const defaultAnalytics = Boolean(settings.settings?.analytics?.enabled);

  const canUseInteractiveWizard =
    !options.nonInteractive &&
    output.interactive &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true;

  let channel = options.channel || defaultChannel;
  let analyticsEnabled =
    typeof options.analyticsEnabled === "boolean"
      ? options.analyticsEnabled
      : defaultAnalytics;

  if (canUseInteractiveWizard) {
    const wizardResult = await runInkInitWizard({
      defaultChannel: channel,
      defaultAnalyticsEnabled: analyticsEnabled
    });
    channel = wizardResult.channel;
    analyticsEnabled = wizardResult.analyticsEnabled;
  }

  const { db, dbPath } = withDatabase();
  db.close();
  updateOnboardingChannel(channel, "self_reported", settings.path);
  updateAnalyticsPreference(analyticsEnabled, settings.path);
  const updatedSettings = loadUserSettings(settings.path);

  if (output.jsonEnabled) {
    output.json({
      ok: true,
      dbPath,
      settingsPath: settings.path,
      channel: updatedSettings.settings?.onboarding?.channel?.value || "unknown",
      analyticsEnabled: Boolean(updatedSettings.settings?.analytics?.enabled),
      nextAction: "npm run review"
    });
    return;
  }

  output.success("Setup complete! To get started: npm run review");
}
function printDoctorCheck(check) {
  const status = String(check?.status || "warn").toLowerCase();
  const marker = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "WARN";
  console.log(`[${marker}] ${String(check?.label || "check")}: ${String(check?.userMessage || "")}`);
}

async function runDoctor(options = {}) {
  const environmentChecks = checkEnvironmentReadiness();
  console.log("Environment:");
  for (const check of environmentChecks) {
    printDoctorCheck(check);
  }

  const defaultSourcesPath = path.resolve("config/sources.json");
  if (!fs.existsSync(defaultSourcesPath)) {
    console.log(
      "\nSources:\n[WARN] Sources config not found. Create config/sources.json from config/sources.example.json or use the dashboard onboarding flow."
    );
    return;
  }

  let configuredSources = [];
  try {
    configuredSources = loadSources().sources;
  } catch (error) {
    const message = String(error?.message || "").trim();
    if (message) {
      console.log(`[WARN] ${message}`);
    }
    return;
  }

  const sources = configuredSources.filter((source) => source.enabled);
  if (sources.length === 0) {
    console.log("\nSources:\n[WARN] No enabled sources configured.");
    return;
  }

  console.log("\nEnabled sources:");
  for (const source of sources) {
    const check = checkSourceAccess(source, {
      probeLive: Boolean(options.probeLive)
    });
    printDoctorCheck({
      label: source.name,
      status: check.status,
      userMessage: `${check.userMessage} (${check.reasonCode})`
    });
  }

  const userSettings = loadUserSettings();
  const effectiveChannel = getEffectiveOnboardingChannel(userSettings.settings);
  const analyticsEnabled = Boolean(userSettings.settings?.analytics?.enabled);
  const shouldTrack = analyticsEnabled && isAnalyticsEnabledByFlag();

  if (shouldTrack) {
    await recordAnalyticsEvent(
      buildAnalyticsEvent(
        "doctor_run",
        {
          enabledSourceCount: sources.length,
          probeLive: Boolean(options.probeLive)
        },
        {
          installId: userSettings.settings.installId,
          channel: effectiveChannel.channel || effectiveChannel.value
        }
      ),
      {
        analyticsEnabled
      }
    );
  }
}

function resolveAllowQuarantinedIngest(options = {}) {
  if (options.allowQuarantined === true) {
    return true;
  }

  if (isSourceQaModeEnabled()) {
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

function buildSourceRefreshContext(source, options = {}) {
  options = applySourceQaOverrides(options);
  const refreshProfile = normalizeRefreshProfile(
    options.refreshProfile || process.env.JOB_FINDER_REFRESH_PROFILE || "safe"
  );

  if (!isBrowserCaptureSource(source)) {
    return {
      refreshMode: refreshProfile,
      servedFrom: "live",
      statusReason: "fetched_during_sync",
      statusLabel: "direct_fetch"
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
    servedFrom: decision.servedFrom || "cache",
    statusReason,
    statusLabel: statusLabelMap[statusReason] || "cache_only"
  };
}

function runSync(options = {}) {
  const sources = loadSources();
  const { db } = withDatabase();
  const allowQuarantined = resolveAllowQuarantinedIngest(options);
  const runId = randomUUID();
  const runRecordedAt = new Date().toISOString();
  let retentionRun = null;

  let totalCollected = 0;
  let totalUpserted = 0;
  let totalPruned = 0;
  let totalNew = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  let skippedByQuality = 0;
  const qualityMessages = [];
  const sourceDeltaRows = [];
  for (const source of sources.sources.filter((item) => item.enabled)) {
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

    const captureSummaryAfterCollection = readSourceCaptureSummary(source);
    const capturePayload = {
      capturedAt:
        captureSummaryAfterCollection.capturedAt ||
        captureSummary.capturedAt ||
        new Date().toISOString(),
      expectedCount:
        captureSummaryAfterCollection.expectedCount ?? captureSummary.expectedCount,
      pageUrl: captureSummaryAfterCollection.pageUrl || captureSummary.pageUrl,
      captureFunnel:
        captureSummaryAfterCollection?.payload?.captureFunnel ||
        captureSummary?.payload?.captureFunnel ||
        null,
      jobs: rawJobs
    };
    const evaluation = evaluateCaptureRun(source, capturePayload, {
      baselineCount: capturePayload.expectedCount
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
    const sourceEvaluations = evaluateJobsFromSearchCriteria(
      sources.criteria,
      normalizedJobs
    );
    const knownDuplicateHashes = new Set(
      listNormalizedHashesOutsideSources(db, getSourceAggregationIds(source))
    );
    const semanticMetrics = buildSourceRunSemanticMetrics({
      normalizedJobs,
      evaluations: sourceEvaluations,
      knownDuplicateHashes
    });
    const refreshContext = buildSourceRefreshContext(source, options);

    totalCollected += normalizedJobs.length;
    totalUpserted += upsertJobs(db, normalizedJobs, { lastImportBatchId: runId });
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
      foundCount: null,
      filteredCount: null,
      dedupedCount: null,
      rawFoundCount: semanticMetrics.rawFoundCount,
      hardFilteredCount: semanticMetrics.hardFilteredCount,
      duplicateCollapsedCount: semanticMetrics.duplicateCollapsedCount,
      importedKeptCount: semanticMetrics.importedKeptCount,
      newCount: deltas.newCount,
      updatedCount: deltas.updatedCount,
      unchangedCount: deltas.unchangedCount,
      importedCount: semanticMetrics.importedKeptCount,
      refreshMode: refreshContext.refreshMode,
      servedFrom: refreshContext.servedFrom,
      statusReason: refreshContext.statusReason,
      statusLabel: refreshContext.statusLabel,
      capturedAt: capturePayload.capturedAt,
      recordedAt: runRecordedAt
    });
  }

  recordSourceRunDeltas(db, sourceDeltaRows);

  retentionRun = runRetentionCleanupWithAudit(db, options);

  db.close();

  try {
    const contractDiagnostics = runSourceContractDiagnostics();
    const contractErrors = contractDiagnostics.rows.filter(
      (row) => row.status === "error"
    ).length;
    const contractWarnings = contractDiagnostics.rows.filter(
      (row) => row.status === "warning"
    ).length;
    if (contractErrors > 0 || contractWarnings > 0) {
      qualityMessages.push(
        `contract drift: errors=${contractErrors}, warnings=${contractWarnings} diagnostics=${contractDiagnostics.diagnostics.latestPath}`
      );
    } else {
      qualityMessages.push(
        `contract drift: ok diagnostics=${contractDiagnostics.diagnostics.latestPath}`
      );
    }
  } catch (error) {
    qualityMessages.push(`contract drift check failed: ${error.message}`);
  }

  console.log(
    `Collected ${totalCollected} job(s). Upserted ${totalUpserted} record(s). Pruned ${totalPruned} stale record(s).`
  );
  console.log(
    `Run deltas: new=${totalNew}, updated=${totalUpdated}, unchanged=${totalUnchanged}.`
  );
  if (skippedByQuality > 0) {
    console.log(
      `Skipped ${skippedByQuality} source(s) due capture quality guardrails.`
    );
  }
  for (const message of qualityMessages) {
    console.log(`  quality: ${message}`);
  }
  if (retentionRun) {
    const deletedByStatus = retentionRun.cleanup.deletedByStatus;
    console.log(
      `  retention: deleted=${retentionRun.cleanup.totalDeleted} (new=${deletedByStatus.new}, viewed=${deletedByStatus.viewed}, skip_for_now=${deletedByStatus.skip_for_now}, rejected=${deletedByStatus.rejected}, applied=${deletedByStatus.applied}) protected.applied=${retentionRun.cleanup.protected.applied} audit=${retentionRun.auditPath}`
    );
  }

  trackTerminalEvent("jobs_synced", {
    total_collected: totalCollected,
    total_upserted: totalUpserted,
    total_pruned: totalPruned,
    total_new: totalNew,
    total_updated: totalUpdated,
    total_unchanged: totalUnchanged,
    skipped_by_quality: skippedByQuality,
    retention_deleted: retentionRun?.cleanup?.totalDeleted || 0,
    enabled_sources: sources.sources.filter((item) => item.enabled).length
  });
  if (skippedByQuality > 0) {
    trackTerminalEvent("capture_quality_rejected", {
      rejected_count: skippedByQuality
    });
  }
}

function runScore() {
  const { criteria } = loadSearchCriteria();
  const { db } = withDatabase();
  const jobs = listAllJobs(db);
  const evaluations = evaluateJobsFromSearchCriteria(criteria, jobs);
  upsertEvaluations(db, evaluations);
  const bucketCounts = summarizeBuckets(evaluations);

  db.close();
  console.log(
    `Scored ${evaluations.length} job(s). high_signal=${bucketCounts.high_signal}, review_later=${bucketCounts.review_later}, reject=${bucketCounts.reject}`
  );

  trackTerminalEvent("jobs_scored", {
    total_scored: evaluations.length,
    high_signal: bucketCounts.high_signal,
    review_later: bucketCounts.review_later,
    rejected: bucketCounts.reject
  });
}

function runShortlist() {
  const { db } = withDatabase();
  const rows = listTopJobs(db, 50);
  const outputPath = writeShortlistFile(rows);
  db.close();
  console.log(`Shortlist written to ${outputPath}`);

  trackTerminalEvent("shortlist_generated", {
    total_jobs: rows.length
  });
}

function runList(limitArg) {
  const limit = limitArg ? Number(limitArg) : 20;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("List limit must be a positive number.");
  }

  const { db } = withDatabase();
  const rows = listTopJobs(db, limit);
  db.close();
  printJobRows(rows);
}

function runMark(jobId, status) {
  if (!jobId || !status) {
    throw new Error("Usage: node src/cli.js mark <job-id> <status>");
  }

  const { db } = withDatabase();
  markApplicationStatus(db, jobId, status);
  db.close();
  console.log(`Updated ${jobId} to status=${status}`);
}

function runProfileSource() {
  const sourceConfig = loadProfileSourceConfig();
  const active = loadActiveProfile();
  console.log(`provider=${sourceConfig.provider}`);
  if (sourceConfig.provider === "legacy_profile") {
    console.log(`profilePath=${sourceConfig.legacyProfilePath}`);
  } else if (sourceConfig.provider === "my_goals") {
    console.log(`goalsPath=${sourceConfig.goalsPath}`);
  } else {
    console.log(`narrataMode=${sourceConfig.narrata.mode}`);
    if (sourceConfig.narrata.mode === "file") {
      console.log(`narrataGoalsPath=${sourceConfig.narrata.goalsPath}`);
    } else {
      console.log(`narrataSupabaseUrl=${sourceConfig.narrata.supabaseUrl}`);
      console.log(`narrataUserId=${sourceConfig.narrata.userId}`);
      console.log(`narrataServiceRoleEnv=${sourceConfig.narrata.serviceRoleEnv}`);
    }
  }
  console.log(`candidate=${active.profile.candidateName}`);
}

function runUseMyGoals(goalsPathArg) {
  const config = useMyGoalsProfileSource(goalsPathArg || "config/my-goals.json");
  console.log(`Profile source set to my_goals (${config.goalsPath}).`);
}

function runUseProfileFile(profilePathArg) {
  const config = useLegacyProfileSource(profilePathArg || "config/profile.json");
  console.log(`Profile source set to legacy_profile (${config.legacyProfilePath}).`);
}

function runConnectNarrataFile(goalsPathArg) {
  const config = connectNarrataGoalsFile(goalsPathArg || "config/my-goals.json");
  console.log(
    `Profile source set to narrata file mode (${config.narrata.goalsPath}).`
  );
}

function runConnectNarrataSupabase(supabaseUrl, userId, serviceRoleEnv) {
  if (!supabaseUrl || !userId) {
    throw new Error(
      "Usage: node src/cli.js connect-narrata-supabase <supabase-url> <user-id> [service-role-env]"
    );
  }

  const config = connectNarrataSupabase({
    supabaseUrl,
    userId,
    serviceRoleEnv
  });
  console.log(
    `Narrata Supabase mode configured (${config.narrata.supabaseUrl}, user=${config.narrata.userId}).`
  );
  console.log(
    "Note: CLI scoring currently supports file-backed Narrata goals for first pass."
  );
}

function runListSources() {
  const sources = loadSources();

  for (const source of sources.sources) {
    let captureStatus = "no-capture";

    if (source.capturePath) {
      const summary = readSourceCaptureSummary(source);
      captureStatus = `capturedAt=${summary.capturedAt || "never"}; jobs=${summary.jobCount}`;
      if (summary.status === "capture_error") {
        captureStatus = "capture-unreadable";
      }
    }

    console.log(
      [
        `"${source.name}"`,
        source.id,
        source.enabled ? "enabled" : "disabled",
        source.type,
        source.searchUrl,
        captureStatus
      ].join(" | ")
    );
  }
}

function runAddSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-source <label> <url>");
  }

  const source = addLinkedInCaptureSource(label, searchUrl);
  console.log(
    `Added source "${source.name}" with id=${source.id} and capturePath=${source.capturePath}`
  );
  trackTerminalEvent("source_added", {
    source_id: source.id,
    source_type: source.type
  });
}

function runAddBuiltinSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-builtin-source <label> <url>");
  }

  const source = addBuiltinSearchSource(label, searchUrl);
  console.log(`Added Built In source "${source.name}" with id=${source.id}`);
  trackTerminalEvent("source_added", {
    source_id: source.id,
    source_type: source.type
  });
}

function runAddGoogleSource(label, searchUrl, recencyWindowArg) {
  if (!label || !searchUrl) {
    throw new Error(
      "Usage: node src/cli.js add-google-source <label> <url> [any|1d|1w|1m]"
    );
  }

  const source = addGoogleSearchSource(
    label,
    searchUrl,
    "config/sources.json",
    recencyWindowArg
  );
  console.log(
    `Added Google source "${source.name}" with id=${source.id} (recencyWindow=${source.recencyWindow || "n/a"})`
  );
  trackTerminalEvent("source_added", {
    source_id: source.id,
    source_type: source.type
  });
}

function runAddWellfoundSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-wellfound-source <label> <url>");
  }

  const source = addWellfoundSearchSource(label, searchUrl);
  console.log(`Added Wellfound source "${source.name}" with id=${source.id}`);
  trackTerminalEvent("source_added", {
    source_id: source.id,
    source_type: source.type
  });
}

function runAddAshbySource(label, searchUrl, recencyWindowArg) {
  if (!label || !searchUrl) {
    throw new Error(
      "Usage: node src/cli.js add-ashby-source <label> <url> [any|1d|1w|1m]"
    );
  }

  const source = addAshbySearchSource(
    label,
    searchUrl,
    "config/sources.json",
    recencyWindowArg
  );
  console.log(
    `Added Ashby source "${source.name}" with id=${source.id} (recencyWindow=${source.recencyWindow || "n/a"})`
  );
  trackTerminalEvent("source_added", {
    source_id: source.id,
    source_type: source.type
  });
}

function runAddIndeedSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-indeed-source <label> <url>");
  }

  const source = addIndeedSearchSource(label, searchUrl);
  console.log(`Added Indeed source "${source.name}" with id=${source.id}`);
  trackTerminalEvent("source_added", {
    source_id: source.id,
    source_type: source.type
  });
}

function runAddZipRecruiterSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-ziprecruiter-source <label> <url>");
  }

  const source = addZipRecruiterSearchSource(label, searchUrl);
  console.log(`Added ZipRecruiter source "${source.name}" with id=${source.id}`);
  trackTerminalEvent("source_added", {
    source_id: source.id,
    source_type: source.type
  });
}

function runAddRemoteOkSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-remoteok-source <label> <url>");
  }

  const source = addRemoteOkSearchSource(label, searchUrl);
  console.log(`Added RemoteOK source "${source.name}" with id=${source.id}`);
  trackTerminalEvent("source_added", {
    source_id: source.id,
    source_type: source.type
  });
}

function runSetSourceUrl(sourceIdOrName, searchUrl) {
  if (!sourceIdOrName || !searchUrl) {
    throw new Error("Usage: node src/cli.js set-source-url <source-id-or-label> <url>");
  }

  const updatedSource = updateSourceSearchUrl(sourceIdOrName, searchUrl);
  console.log(
    `Updated "${updatedSource.name}" (${updatedSource.id}) searchUrl to ${updatedSource.searchUrl}`
  );
}

function runNormalizeSourceUrls(options = {}) {
  if (options.dryRun) {
    const preview = previewNormalizedSourceSearchUrls();
    const changedRows = preview.sources.filter((row) => row.changed);

    if (changedRows.length === 0) {
      console.log("Dry run: no source URL changes.");
      return;
    }

    console.log(`Dry run: ${preview.changed} source URL change(s) detected.`);
    for (const row of changedRows) {
      console.log(
        [
          row.id,
          row.type,
          `current=${row.currentSearchUrl}`,
          `next=${row.nextSearchUrl}`
        ].join(" | ")
      );

      if (row.currentRecencyWindow !== null || row.nextRecencyWindow !== null) {
        console.log(
          `  recencyWindow: ${row.currentRecencyWindow || "n/a"} -> ${row.nextRecencyWindow || "n/a"}`
        );
      }

      if (Array.isArray(row.unsupported) && row.unsupported.length > 0) {
        console.log(`  unsupported: ${row.unsupported.join(", ")}`);
      }

      const accountability =
        row.criteriaAccountability &&
        typeof row.criteriaAccountability === "object"
          ? row.criteriaAccountability
          : null;
      if (accountability) {
        const appliedInUrl = Array.isArray(accountability.appliedInUrl)
          ? accountability.appliedInUrl
          : [];
        const appliedInUiBootstrap = Array.isArray(
          accountability.appliedInUiBootstrap
        )
          ? accountability.appliedInUiBootstrap
          : [];
        const appliedPostCapture = Array.isArray(accountability.appliedPostCapture)
          ? accountability.appliedPostCapture
          : [];

        if (appliedInUrl.length > 0) {
          console.log(`  criteria.appliedInUrl: ${appliedInUrl.join(", ")}`);
        }
        if (appliedInUiBootstrap.length > 0) {
          console.log(
            `  criteria.appliedInUiBootstrap: ${appliedInUiBootstrap.join(", ")}`
          );
        }
        if (appliedPostCapture.length > 0) {
          console.log(
            `  criteria.appliedPostCapture: ${appliedPostCapture.join(", ")}`
          );
        }
      }

      if (Array.isArray(row.notes) && row.notes.length > 0) {
        console.log(`  notes: ${row.notes.join(" | ")}`);
      }
    }

    return;
  }

  const result = normalizeAllSourceSearchUrls();
  console.log(`Normalized ${result.changed} source URL(s).`);
}

function runSourceContractDriftCheck(options = {}) {
  const report = runSourceContractDiagnostics({
    sourcesPath: options.sourcesPath,
    contractsPath: options.contractsPath,
    staleAfterDays: options.staleAfterDays,
    window: options.window,
    minCoverage: options.minCoverage,
    historyPath: options.historyPath,
    rootDir: options.rootDir
  });

  let hasError = false;
  let hasWarning = false;

  for (const row of report.rows) {
    const health = computeSourceHealthStatus(row.sourceId, {
      window: options.window,
      staleAfterDays: options.staleAfterDays
    });

    if (row.status === "error") {
      hasError = true;
    } else if (row.status === "warning") {
      hasWarning = true;
    }
    if (health.status === "failing") {
      hasError = true;
    } else if (health.status === "degraded" && row.status !== "error") {
      hasWarning = true;
    }

    console.log(
      [
        `${row.sourceId} (${row.sourceType})`,
        `status=${row.status}`,
        `sample=${row.sampleSize}`,
        `contract=${row.contractVersion || "missing"}`
      ].join(" | ")
    );

    const latestCoverageEntries = Object.entries(
      row.latestCoverageByField || row.coverageByField || {}
    ).filter(
      ([, ratio]) =>
        ratio !== null &&
        ratio !== undefined &&
        Number.isFinite(Number(ratio))
    );
    if (latestCoverageEntries.length > 0) {
      console.log(
        "  latest: " +
          latestCoverageEntries
            .map(([field, ratio]) => `${field}=${Math.round(Number(ratio) * 100)}%`)
            .join(", ")
      );
    }

    const rollingCoverageEntries = Object.entries(row.rollingCoverageByField || {}).filter(
      ([, ratio]) =>
        ratio !== null &&
        ratio !== undefined &&
        Number.isFinite(Number(ratio))
    );
    if (rollingCoverageEntries.length > 0) {
      console.log(
        `  rolling(${row.rollingSamplesUsed || 0}/${row.rollingWindow || report.window}): ` +
          rollingCoverageEntries
            .map(([field, ratio]) => `${field}=${Math.round(Number(ratio) * 100)}%`)
            .join(", ")
      );
    }

    if (typeof row.passCoverageGate === "boolean") {
      console.log(
        `  gate(required min=${Math.round(Number(row.minCoverage || report.minCoverage || 0) * 100)}%): ${row.passRequiredCoverageGate === false ? "fail" : "pass"}`
      );
    }

    const toRatio = (value) => {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
    const latestDetailCoverage = toRatio(row.detailDescriptionCoverage);
    const rollingDetailCoverage = toRatio(row.rollingDetailDescriptionCoverage);
    if (latestDetailCoverage !== null || rollingDetailCoverage !== null) {
      const latestLabel = latestDetailCoverage !== null
        ? `${Math.round(latestDetailCoverage * 100)}%`
        : "n/a";
      const rollingLabel = rollingDetailCoverage !== null
        ? `${Math.round(rollingDetailCoverage * 100)}%`
        : "n/a";
      console.log(
        `  detail-description: latest=${latestLabel}, rolling=${rollingLabel}, samples=${Math.max(0, Number(row.rollingDetailDescriptionSampleSize || row.detailDescriptionSampleSize || 0))}`
      );
      console.log(
        `  gate(detail min=${Math.round(Number(row.detailDescriptionMinCoverage || row.minCoverage || report.minCoverage || 0) * 100)}%): ${row.passDetailCoverageGate === false ? "fail" : "pass"}`
      );
    }

    if (typeof row.passCoverageGate === "boolean") {
      console.log(`  gate(overall): ${row.passCoverageGate ? "pass" : "fail"}`);
    }

    if (Array.isArray(row.issues) && row.issues.length > 0) {
      console.log(`  issues: ${row.issues.join(" | ")}`);
    }

    const healthScore =
      Number.isFinite(Number(health.score))
        ? `${Math.round(Number(health.score) * 100)}%`
        : "n/a";
    console.log(
      `  health: ${health.status} (score=${healthScore}; samples=${health.samplesUsed || 0})`
    );
    if (health.status === "degraded" || health.status === "failing") {
      console.log("  action: adapter needs attention");
    }
    if (Array.isArray(health.reasons) && health.reasons.length > 0) {
      console.log(`  health-issues: ${health.reasons.join(" | ")}`);
    }
  }

  if (hasError) {
    process.exitCode = 1;
    return;
  }

  if (hasWarning) {
    process.exitCode = 2;
  }

  if (report?.diagnostics?.latestPath) {
    console.log(`Contract diagnostics: ${report.diagnostics.latestPath}`);
  }
}

function runSourceCanaryCheck(options = {}) {
  const includeDisabled = options.includeDisabled === true;
  const canaries = loadSourceCanaries(options.canariesPath);
  const sources = loadSources().sources.filter(
    (source) => includeDisabled || source.enabled
  );

  const rows = [];
  let hasFailure = false;
  let skippedCount = 0;

  for (const source of sources) {
    const result = evaluateSourceCanaries(source, {
      canaries
    });
    rows.push(result);

    const status = result.status || "skipped";
    const canaryPayload = {
      capturedAt:
        result.payload?.capturedAt ||
        result.captureEvaluation?.evaluatedAt ||
        new Date().toISOString(),
      expectedCount: result.payload?.expectedCount ?? null,
      pageUrl: result.payload?.pageUrl || null,
      jobs: Array.isArray(result.payload?.jobs) ? result.payload.jobs : []
    };
    if (status === "fail") {
      hasFailure = true;

      const canaryEvaluation = {
        outcome: "quarantine",
        reasons: [
          `canary ${result.canaryId || "default"} failed`,
          ...(Array.isArray(result.reasons) ? result.reasons : [])
        ],
        metrics: result.captureEvaluation?.metrics || {}
      };
      recordSourceHealthFromCaptureEvaluation(
        source,
        canaryPayload,
        canaryEvaluation
      );
    } else if (status === "pass") {
      recordSourceHealthFromCaptureEvaluation(source, canaryPayload, {
        outcome: "accept",
        reasons: [],
        metrics: result.captureEvaluation?.metrics || {}
      });
    } else if (status === "skipped") {
      skippedCount += 1;
    }

    console.log(
      [
        `${source.id} (${source.type})`,
        `status=${status}`,
        `canary=${result.canaryId || "none"}`
      ].join(" | ")
    );

    for (const check of Array.isArray(result.checks) ? result.checks : []) {
      console.log(
        `  ${check.pass ? "pass" : "fail"} ${check.kind}: ${check.message}`
      );
    }
    if (Array.isArray(result.reasons) && result.reasons.length > 0) {
      console.log(`  issues: ${result.reasons.join(" | ")}`);
    }
  }

  const diagnostics = writeSourceCanaryDiagnostics({
    generatedAt: new Date().toISOString(),
    rows: rows.map((row) => ({
      sourceId: row.sourceId,
      sourceType: row.sourceType,
      canaryId: row.canaryId,
      status: row.status,
      reasons: row.reasons,
      checks: row.checks
    }))
  });
  console.log(`Canary diagnostics: ${diagnostics.latestPath}`);

  if (hasFailure) {
    process.exitCode = 1;
    return;
  }

  if (skippedCount > 0) {
    console.log(
      `Skipped canary checks for ${skippedCount} source(s) with no canary configuration.`
    );
  }
}

function openUrlInBrowser(url) {
  const normalizedUrl = String(url || "").trim();

  if (!normalizedUrl) {
    throw new Error("URL is required.");
  }

  let command = "open";
  let args = [normalizedUrl];

  if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", normalizedUrl];
  } else if (process.platform !== "darwin") {
    command = "xdg-open";
    args = [normalizedUrl];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });

  child.unref();
}

function getDefaultSnapshotPath(source, baseDir = "output/playwright") {
  return path.resolve(baseDir, `${source.id}-snapshot.md`);
}

function isLinkedInSource(source) {
  return source?.type === "linkedin_capture_file";
}

function isWellfoundSource(source) {
  return source?.type === "wellfound_search";
}

function isAshbySource(source) {
  return source?.type === "ashby_search";
}

function isGoogleSource(source) {
  return source?.type === "google_search";
}

function isIndeedSource(source) {
  return source?.type === "indeed_search";
}

function isZipRecruiterSource(source) {
  return source?.type === "ziprecruiter_search";
}

function isRemoteOkSource(source) {
  return source?.type === "remoteok_search";
}

function isBrowserCaptureSource(source) {
  return (
    isLinkedInSource(source) ||
    isWellfoundSource(source) ||
    isAshbySource(source) ||
    isGoogleSource(source) ||
    isIndeedSource(source) ||
    isZipRecruiterSource(source) ||
    isRemoteOkSource(source)
  );
}

function isEnabledLinkedInSource(source) {
  return source?.enabled && isLinkedInSource(source);
}

function isEnabledBrowserCaptureSource(source) {
  return source?.enabled && isBrowserCaptureSource(source);
}

function getEnabledLinkedInSources() {
  return loadSources().sources.filter((source) => isEnabledLinkedInSource(source));
}

function getEnabledBrowserCaptureSources() {
  return loadSources().sources.filter((source) =>
    isEnabledBrowserCaptureSource(source)
  );
}

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

async function waitForBridge(baseUrl, timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await isBridgeAvailable(baseUrl)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function startDetachedBridgeProcess(port, providerName) {
  const cliPath = path.resolve("src/cli.js");
  const child = spawn(
    process.execPath,
    [cliPath, "bridge-server", String(port), String(providerName || "chrome_applescript")],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        JOB_FINDER_BRIDGE_PROVIDER: String(providerName || "chrome_applescript")
      }
    }
  );
  child.unref();
}

async function ensureBridgeForLinkedInSources(sources, options = {}) {
  const requiresBridge = Array.isArray(sources)
    ? sources.some((source) => isBrowserCaptureSource(source))
    : false;

  if (!requiresBridge) {
    return null;
  }

  const baseUrl = resolveBrowserBridgeBaseUrl();
  const available = await isBridgeAvailable(baseUrl);

  if (available) {
    return {
      baseUrl,
      started: false,
      server: null
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
  const preferDetached = Boolean(options.preferDetached);

  if (preferDetached) {
    try {
      startDetachedBridgeProcess(port, providerName);
      const ready = await waitForBridge(baseUrl, 10_000);
      if (!ready) {
        throw new Error("bridge did not report healthy within timeout");
      }

      console.log(
        `Auto-started persistent browser bridge at ${baseUrl} (provider=${providerName}).`
      );

      return {
        baseUrl,
        started: false,
        server: null
      };
    } catch (error) {
      throw new Error(
        `Browser capture needs the bridge at ${baseUrl}, but persistent auto-start failed (${error.message}). Start it manually with: node src/cli.js bridge-server ${port}`
      );
    }
  }

  try {
    const started = await startBrowserBridgeServer({ port, providerName });
    console.log(
      `Auto-started browser bridge at ${baseUrl} (provider=${started.provider}).`
    );

    return {
      baseUrl,
      started: true,
      server: started.server
    };
  } catch (error) {
    throw new Error(
      `Browser capture needs the bridge at ${baseUrl}, but auto-start failed (${error.message}). Start it manually with: node src/cli.js bridge-server ${port}`
    );
  }
}

async function stopAutoStartedBridge(bridgeSession) {
  if (!bridgeSession?.started || !bridgeSession.server) {
    return;
  }

  await new Promise((resolve) => {
    bridgeSession.server.close(() => resolve());
  });
  console.log("Stopped auto-started browser bridge.");
}

function runOpenSource(sourceIdOrName) {
  if (!sourceIdOrName) {
    throw new Error("Usage: node src/cli.js open-source <source-id-or-label>");
  }

  const source = getSourceByIdOrName(sourceIdOrName);
  openUrlInBrowser(source.searchUrl);
  console.log(`Opened "${source.name}" (${source.id})`);
}

function runOpenSources() {
  const sources = loadSources();
  const enabledSources = sources.sources.filter((source) => source.enabled);

  if (enabledSources.length === 0) {
    console.log("No enabled sources to open.");
    return;
  }

  for (const source of enabledSources) {
    openUrlInBrowser(source.searchUrl);
  }

  console.log(`Opened ${enabledSources.length} source(s).`);
}

function runImportLinkedInSnapshot(sourceIdOrName, snapshotPath) {
  if (!sourceIdOrName || !snapshotPath) {
    throw new Error(
      "Usage: node src/cli.js import-linkedin-snapshot <source-id-or-label> <snapshot-path>"
    );
  }

  const source = getSourceByIdOrName(sourceIdOrName);
  const result = importLinkedInSnapshot(source, snapshotPath);
  console.log(
    `Imported ${result.jobsImported} job(s) into "${source.name}" from ${result.capturePath}`
  );
}

function runCaptureSource(sourceIdOrName, snapshotPathArg) {
  if (!sourceIdOrName) {
    throw new Error("Usage: node src/cli.js capture-source <source-id-or-label> [snapshot-path]");
  }

  const source = getSourceByIdOrName(sourceIdOrName);
  const snapshotPath = path.resolve(snapshotPathArg || getDefaultSnapshotPath(source));

  if (!fs.existsSync(snapshotPath)) {
    openUrlInBrowser(source.searchUrl);
    console.log(`Opened "${source.name}" (${source.id})`);
    console.log(`No snapshot found at ${snapshotPath}`);
    console.log("Save a Playwright snapshot to that path, then rerun capture-source to import it.");
    return;
  }

  const result = importLinkedInSnapshot(source, snapshotPath);
  console.log(
    `Captured ${result.jobsImported} job(s) for "${source.name}" from ${snapshotPath}`
  );
}

function runCaptureAll(snapshotDirArg) {
  const sources = loadSources().sources.filter(
    (source) => source.enabled && source.type === "linkedin_capture_file"
  );

  if (sources.length === 0) {
    console.log("No enabled linkedin_capture_file sources.");
    return;
  }

  const snapshotDir = path.resolve(snapshotDirArg || "output/playwright");
  let imported = 0;
  const missing = [];

  for (const source of sources) {
    const snapshotPath = getDefaultSnapshotPath(source, snapshotDir);

    if (!fs.existsSync(snapshotPath)) {
      missing.push({ source, snapshotPath });
      continue;
    }

    const result = importLinkedInSnapshot(source, snapshotPath);
    imported += 1;
    console.log(
      `Captured ${result.jobsImported} job(s) for "${source.name}" from ${snapshotPath}`
    );
  }

  if (missing.length > 0) {
    for (const entry of missing) {
      console.log(
        `Missing snapshot for "${entry.source.name}" at ${entry.snapshotPath}`
      );
    }
  }

  console.log(
    `capture-all imported ${imported} source(s); ${missing.length} source(s) still need snapshots.`
  );
}

function describeRefreshDecision(source, decision) {
  if (decision.allowLive) {
    return null;
  }

  const sourceName = source?.name || source?.id || "source";
  const capturedAt = decision?.cacheSummary?.capturedAt || "unknown";
  const cachedCount = Number(decision?.cacheSummary?.jobCount || 0);

  if (decision.reason === "cache_fresh") {
    return `Using cached capture for "${sourceName}" (${cachedCount} job(s); capturedAt=${capturedAt}).`;
  }

  if (decision.reason === "mock_profile") {
    return `Using cached capture for "${sourceName}" (mock profile disables live refresh).`;
  }

  const nextEligible = decision?.nextEligibleAt || "unknown";
  return `Using cached capture for "${sourceName}" (live refresh blocked: ${decision.reason}; next eligible=${nextEligible}; cachedAt=${capturedAt}).`;
}

function resolveCliRefreshProfile(explicitProfile) {
  return normalizeRefreshProfile(
    explicitProfile || process.env.JOB_FINDER_REFRESH_PROFILE || "safe",
    { strict: true }
  );
}

async function runCaptureSourceLive(sourceIdOrName, snapshotPathArg, options = {}) {
  if (!sourceIdOrName) {
    throw new Error(
      "Usage: node src/cli.js capture-source-live <source-id-or-label> [snapshot-path]"
    );
  }

  const source = getSourceByIdOrName(sourceIdOrName);
  if (!isBrowserCaptureSource(source)) {
    throw new Error(
      `capture-source-live supports browser-capture sources (linkedin_capture_file, wellfound_search, ashby_search, google_search, indeed_search, ziprecruiter_search, remoteok_search). "${source.name}" is ${source.type}.`
    );
  }

  const refreshProfile = resolveCliRefreshProfile(options.refreshProfile);
  const decision = getSourceRefreshDecision(source, {
    profile: refreshProfile,
    forceRefresh: Boolean(options.forceRefresh),
    statePath: options.refreshStatePath
  });

  if (!decision.allowLive) {
    console.log(describeRefreshDecision(source, decision));
    return;
  }

  const bridgeSession = await ensureBridgeForLinkedInSources([source], {
    preferDetached: true
  });
  const snapshotPath = path.resolve(snapshotPathArg || getDefaultSnapshotPath(source));
  let result;

  try {
    try {
      result = await captureSourceViaBridge(source, snapshotPath);
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
  } finally {
    await stopAutoStartedBridge(bridgeSession);
  }

  if (result.status === "pending") {
    console.log(result.message || `Capture queued for "${source.name}".`);
    if (result.requestPath) {
      console.log(`Request file: ${result.requestPath}`);
    }
    console.log(`Snapshot path: ${result.snapshotPath}`);
    return;
  }

  recordRefreshEvent({
    statePath: options.refreshStatePath,
    sourceId: source.id,
    outcome: "success",
    at: result.capturedAt || new Date().toISOString()
  });

  console.log(
    `Live-captured ${result.jobsImported} job(s) for "${source.name}" via ${result.provider || "bridge"}`
  );
  trackTerminalEvent("source_captured_live", {
    source_id: source.id,
    source_type: source.type,
    jobs_imported: result.jobsImported,
    provider: result.provider || "bridge"
  });
}

async function runCaptureAllLive(snapshotDirArg, options = {}) {
  const sources = getEnabledBrowserCaptureSources();
  const refreshProfile = resolveCliRefreshProfile(options.refreshProfile);

  if (sources.length === 0) {
    console.log(
      "No enabled browser-capture sources (LinkedIn/Wellfound/Ashby/Google/Indeed/ZipRecruiter/RemoteOK). Skipping live capture."
    );
    return {
      completed: 0,
      pending: false,
      skipped: true
    };
  }

  const snapshotDir = path.resolve(snapshotDirArg || "output/playwright");
  const liveSources = [];
  const liveDecisions = new Map();
  let completed = 0;
  let bridgeSession = null;

  for (const source of sources) {
    const decision = getSourceRefreshDecision(source, {
      profile: refreshProfile,
      forceRefresh: Boolean(options.forceRefresh),
      statePath: options.refreshStatePath
    });

    if (decision.allowLive) {
      liveSources.push(source);
      liveDecisions.set(source.id, decision);
    } else {
      completed += 1;
      console.log(describeRefreshDecision(source, decision));
    }
  }

  if (liveSources.length === 0) {
    console.log(`capture-all-live imported ${completed} source(s).`);
    return {
      completed,
      pending: false,
      skipped: false
    };
  }

  bridgeSession = await ensureBridgeForLinkedInSources(liveSources);

  try {
    for (const source of liveSources) {
      const snapshotPath = getDefaultSnapshotPath(source, snapshotDir);
      let result;
      try {
        result = await captureSourceViaBridge(source, snapshotPath);
      } catch (error) {
        const outcome = classifyRefreshErrorOutcome(error);
        const decision = liveDecisions.get(source.id);
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

      if (result.status === "pending") {
        console.log(result.message || `Capture queued for "${source.name}".`);
        if (result.requestPath) {
          console.log(`Request file: ${result.requestPath}`);
        }
        console.log(`Snapshot path: ${result.snapshotPath}`);
        console.log("Paused capture-all-live at the first source awaiting a fresh snapshot.");
        return {
          completed,
          pending: true,
          skipped: false
        };
      }

      recordRefreshEvent({
        statePath: options.refreshStatePath,
        sourceId: source.id,
        outcome: "success",
        at: result.capturedAt || new Date().toISOString()
      });

      completed += 1;
      console.log(
        `Live-captured ${result.jobsImported} job(s) for "${source.name}" via ${result.provider || "bridge"}`
      );
    }

    console.log(`capture-all-live imported ${completed} source(s).`);
    return {
      completed,
      pending: false,
      skipped: false
    };
  } finally {
    await stopAutoStartedBridge(bridgeSession);
  }
}

async function runBridgeServer(portArg, providerArg) {
  const port = portArg ? Number(portArg) : 4315;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Bridge port must be a positive number.");
  }

  const providerName = String(
    providerArg || process.env.JOB_FINDER_BRIDGE_PROVIDER || "chrome_applescript"
  );
  const { provider } = await startBrowserBridgeServer({
    port,
    providerName
  });

  console.log(`Browser bridge running at http://127.0.0.1:${port}`);
  console.log(`Provider: ${provider}`);
  console.log("Keep this process running while capture-source-live or capture-all-live are in use.");
}

async function runReview(portArg, output = createCliOutput()) {
  const port = portArg ? Number(portArg) : 4311;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Review port must be a positive number.");
  }
  const reviewLimit = 5000;

  const { db } = withDatabase();
  const queue = listReviewQueue(db, reviewLimit);
  db.close();

  void queue;

  await startReviewServer({ port, limit: reviewLimit });
  const dashboardUrl = `http://127.0.0.1:${port}`;
  const openHint =
    process.env.TERM_PROGRAM === "Apple_Terminal"
      ? "Command-click to open"
      : "Click to open";
  output.success("Review server running.");
  output.stdout(`Open Job Finder (${openHint}): ${dashboardUrl}`);
  output.info("Keep this tab open for Jobs and onboarding.");
}

async function runPipeline(options = {}) {
  const sources = loadSources().sources.filter((source) => source.enabled);
  const hasBrowserCapture = sources.some((source) => isBrowserCaptureSource(source));

  if (hasBrowserCapture) {
    const captureSummary = await runCaptureAllLive(undefined, {
      forceRefresh: Boolean(options.forceRefresh)
    });

    if (captureSummary?.pending) {
      console.log(
        "Browser capture is pending manual snapshot handoff. Continuing with sync using current source data."
      );
    }
  } else {
    console.log("No enabled browser-capture sources. Skipping browser capture.");
  }

  runSync({ allowQuarantined: options.allowQuarantined });
  runScore();
  runShortlist();
  runList(10);
  console.log("Pipeline complete. Start the dashboard with: npm run review");

  trackTerminalEvent("pipeline_run_completed", {
    force_refresh: Boolean(options.forceRefresh),
    allow_quarantined: Boolean(options.allowQuarantined),
    had_browser_capture: hasBrowserCapture
  });
}

async function runLivePipeline(options = {}) {
  await runPipeline(options);
}

function runRetentionPolicyConfig() {
  const loaded = loadRetentionPolicy();
  console.log(
    JSON.stringify(
      {
        path: loaded.path,
        exists: loaded.exists,
        policy: loaded.policy
      },
      null,
      2
    )
  );
}

function printHelp() {
  console.log(`
job-finder - Local-first job search with intelligent de-duplication

QUICK START:
  jf init                       Initialize profile and database
     --channel <npm|codex|claude|unknown>
     --analytics <yes|no> | --no-analytics
     --non-interactive
  jf run                        Sync jobs from all sources (run daily)
  jf review                     Open dashboard at http://localhost:4311

COMMON COMMANDS:
  jf sources                    List configured job sources
  jf doctor [--probe-live]      Check environment and source readiness
  jf list [limit]              List jobs in terminal
  jf mark <job-id> <status>    Mark job as applied/rejected/skip_for_now

SOURCE MANAGEMENT:
  jf add-source <label> <url>               Add LinkedIn search
  jf add-builtin-source <label> <url>       Add Built In search
  jf add-google-source <label> <url> [any|1d|1w|1m]  Add Google jobs search
  jf add-wellfound-source <label> <url>     Add Wellfound search
  jf add-ashby-source <label> <url> [any|1d|1w|1m]   Add Ashby search
  jf add-indeed-source <label> <url>        Add Indeed search
  jf add-ziprecruiter-source <label> <url>  Add ZipRecruiter search
  jf add-remoteok-source <label> <url>      Add RemoteOK search
  jf set-source-url <id-or-label> <url>     Update source URL
  jf normalize-source-urls [--dry-run]      Normalize URLs from search criteria
  jf retention-policy                       Show retention policy path and effective config
  jf check-source-contracts [--window n] [--min-coverage 0.9]  Run source contract drift checks
  jf check-source-canaries [--include-disabled]  Run source adapter canary checks

PROFILE CONFIGURATION:
  jf profile-source                         Show current profile source
  jf use-profile-file [path]               Use profile.json
  jf use-my-goals [path]                   Use my-goals.json
  jf connect-narrata-file [path]           Connect Narrata goals file

ADVANCED:
  jf sync                      Sync jobs only (no scoring)
  jf score                     Score jobs only (no sync)
  jf shortlist                Generate shortlist file
  jf run --force-refresh      Force fresh collection (bypass cache)
  jf sync --allow-quarantined Allow quarantined capture runs to ingest
  jf bridge-server [port]     Start browser bridge manually

DEV/FROM SOURCE:
  node src/cli.js <command>   Run commands directly from source

HELP:
  jf help                     Show this help
  jf --version               Show version
  (global) --quiet           Reduce non-essential output
  (global) --json            Emit JSON output when supported

EXAMPLES:
  # First time setup
  jf init
  jf add-source "Senior PM AI" "https://linkedin.com/jobs/search?keywords=senior+pm+ai"
  jf run

  # Daily workflow
  jf run && jf review

  # Quick check without opening browser
  jf list 10

For detailed docs: https://github.com/ycb/job-finder
  `.trim());
}

async function main() {
  const [, , command = "help", ...rawArgs] = process.argv;
  const { options: globalOutputOptions, args } = parseGlobalOutputOptions(rawArgs);
  const output = createCliOutput(globalOutputOptions);

  switch (command) {
    case "--version":
    case "-v":
    case "version":
      console.log("job-finder v0.1.0");
      break;
    case "init":
      {
        const initOptions = parseInitOptions(args);
        await runInit(initOptions, output);
      }
      break;
    case "sync":
      {
        const parsed = extractFlag(args, "--allow-quarantined");
        runSync({ allowQuarantined: parsed.present });
      }
      break;
    case "score":
      runScore();
      break;
    case "shortlist":
      runShortlist();
      break;
    case "list":
      runList(args[0]);
      break;
    case "sources":
      runListSources();
      break;
    case "doctor":
      {
        const parsed = extractFlag(args, "--probe-live");
        await runDoctor({ probeLive: parsed.present });
      }
      break;
    case "add-source":
      runAddSource(args[0], args[1]);
      break;
    case "add-builtin-source":
      runAddBuiltinSource(args[0], args[1]);
      break;
    case "add-google-source":
      runAddGoogleSource(args[0], args[1], args[2]);
      break;
    case "add-wellfound-source":
      runAddWellfoundSource(args[0], args[1]);
      break;
    case "add-ashby-source":
      runAddAshbySource(args[0], args[1], args[2]);
      break;
    case "add-indeed-source":
      runAddIndeedSource(args[0], args[1]);
      break;
    case "add-ziprecruiter-source":
      runAddZipRecruiterSource(args[0], args[1]);
      break;
    case "add-remoteok-source":
      runAddRemoteOkSource(args[0], args[1]);
      break;
    case "set-source-url":
      runSetSourceUrl(args[0], args[1]);
      break;
    case "normalize-source-urls":
      {
        const parsed = extractFlag(args, "--dry-run");
        runNormalizeSourceUrls({ dryRun: parsed.present });
      }
      break;
    case "retention-policy":
      runRetentionPolicyConfig();
      break;
    case "check-source-contracts":
      {
        let parsedArgs = [...args];
        const windowOption = extractOption(parsedArgs, "--window");
        parsedArgs = windowOption.args;
        const minCoverageOption = extractOption(parsedArgs, "--min-coverage");
        parsedArgs = minCoverageOption.args;
        const staleDaysOption = extractOption(parsedArgs, "--stale-days");

        const parsedWindow = Number(windowOption.value);
        const parsedMinCoverage = Number(minCoverageOption.value);
        const parsedStaleDays = Number(staleDaysOption.value);

        runSourceContractDriftCheck({
          window:
            Number.isInteger(parsedWindow) && parsedWindow > 0 ? parsedWindow : undefined,
          minCoverage:
            Number.isFinite(parsedMinCoverage) &&
            parsedMinCoverage >= 0 &&
            parsedMinCoverage <= 1
              ? parsedMinCoverage
              : undefined,
          staleAfterDays:
            Number.isInteger(parsedStaleDays) && parsedStaleDays > 0
              ? parsedStaleDays
              : undefined
        });
      }
      break;
    case "check-source-canaries":
      {
        const parsed = extractFlag(args, "--include-disabled");
        runSourceCanaryCheck({
          includeDisabled: parsed.present
        });
      }
      break;
    case "profile-source":
      runProfileSource();
      break;
    case "use-my-goals":
      runUseMyGoals(args[0]);
      break;
    case "use-profile-file":
      runUseProfileFile(args[0]);
      break;
    case "connect-narrata-file":
      runConnectNarrataFile(args[0]);
      break;
    case "connect-narrata-supabase":
      runConnectNarrataSupabase(args[0], args[1], args[2]);
      break;
    case "open-source":
      runOpenSource(args[0]);
      break;
    case "open-sources":
      runOpenSources();
      break;
    case "capture-source":
      runCaptureSource(args[0], args[1]);
      break;
    case "capture-all":
      runCaptureAll(args[0]);
      break;
    case "capture-source-live":
      {
        const parsed = extractFlag(args, "--force-refresh");
        await runCaptureSourceLive(parsed.args[0], parsed.args[1], {
          forceRefresh: parsed.present
        });
      }
      break;
    case "capture-all-live":
      {
        const parsed = extractFlag(args, "--force-refresh");
        await runCaptureAllLive(parsed.args[0], {
          forceRefresh: parsed.present
        });
      }
      break;
    case "bridge-server":
      await runBridgeServer(args[0], args[1]);
      break;
    case "import-linkedin-snapshot":
      runImportLinkedInSnapshot(args[0], args[1]);
      break;
    case "mark":
      runMark(args[0], args[1]);
      break;
    case "review":
      await runReview(args[0], output);
      break;
    case "run":
      {
        let parsedArgs = [...args];
        const forceRefreshFlag = extractFlag(parsedArgs, "--force-refresh");
        parsedArgs = forceRefreshFlag.args;
        const allowQuarantinedFlag = extractFlag(
          parsedArgs,
          "--allow-quarantined"
        );
        await runPipeline({
          forceRefresh: forceRefreshFlag.present,
          allowQuarantined: allowQuarantinedFlag.present
        });
      }
      break;
    case "run-live":
      {
        let parsedArgs = [...args];
        const forceRefreshFlag = extractFlag(parsedArgs, "--force-refresh");
        parsedArgs = forceRefreshFlag.args;
        const allowQuarantinedFlag = extractFlag(
          parsedArgs,
          "--allow-quarantined"
        );
        await runLivePipeline({
          forceRefresh: forceRefreshFlag.present,
          allowQuarantined: allowQuarantinedFlag.present
        });
      }
      break;
    case "help":
      printHelp();
      break;
    default:
      throw new CliUsageError(`Unknown command "${command}". Run "jf help".`);
  }
}

main().catch((error) => {
  const message = String(error?.message || "Unknown error");
  process.stderr.write(`${message}\n`);
  process.exitCode = isCliUsageError(error) ? 2 : 1;
});
