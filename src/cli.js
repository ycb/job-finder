import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  captureSourceViaBridge,
  resolveBrowserBridgeBaseUrl
} from "./browser-bridge/client.js";
import { startBrowserBridgeServer } from "./browser-bridge/server.js";
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
import { openDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrations.js";
import { normalizeJobRecord } from "./jobs/normalize.js";
import {
  listAllJobs,
  listReviewQueue,
  listTopJobs,
  markApplicationStatus,
  upsertEvaluations,
  upsertJobs,
  pruneSourceJobs
} from "./jobs/repository.js";
import { evaluateJobsFromSearchCriteria } from "./jobs/score.js";
import { writeShortlistFile } from "./output/render.js";
import { startReviewServer } from "./review/server.js";
import {
  getSourceRefreshDecision,
  normalizeRefreshProfile,
  readSourceCaptureSummary
} from "./sources/cache-policy.js";
import { classifyRefreshErrorOutcome, recordRefreshEvent } from "./sources/refresh-state.js";
import {
  collectJobsFromSource,
  importLinkedInSnapshot
} from "./sources/linkedin-saved-search.js";

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

function runInit() {
  const { db, dbPath } = withDatabase();
  db.close();
  console.log(`Database initialized at ${dbPath}`);
}

function runSync() {
  const sources = loadSources();
  const { db } = withDatabase();

  let totalCollected = 0;
  let totalUpserted = 0;
  let totalPruned = 0;

  for (const source of sources.sources.filter((item) => item.enabled)) {
    const rawJobs = collectJobsFromSource(source);
    const normalizedJobs = rawJobs.map((job) => normalizeJobRecord(job, source));
    totalCollected += normalizedJobs.length;
    totalUpserted += upsertJobs(db, normalizedJobs);
    totalPruned += pruneSourceJobs(
      db,
      source.id,
      normalizedJobs.map((job) => job.id)
    );
  }

  db.close();
  console.log(
    `Collected ${totalCollected} job(s). Upserted ${totalUpserted} record(s). Pruned ${totalPruned} stale record(s).`
  );
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
}

function runShortlist() {
  const { db } = withDatabase();
  const rows = listTopJobs(db, 50);
  const outputPath = writeShortlistFile(rows);
  db.close();
  console.log(`Shortlist written to ${outputPath}`);
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
}

function runAddBuiltinSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-builtin-source <label> <url>");
  }

  const source = addBuiltinSearchSource(label, searchUrl);
  console.log(`Added Built In source "${source.name}" with id=${source.id}`);
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
}

function runAddWellfoundSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-wellfound-source <label> <url>");
  }

  const source = addWellfoundSearchSource(label, searchUrl);
  console.log(`Added Wellfound source "${source.name}" with id=${source.id}`);
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
}

function runAddIndeedSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-indeed-source <label> <url>");
  }

  const source = addIndeedSearchSource(label, searchUrl);
  console.log(`Added Indeed source "${source.name}" with id=${source.id}`);
}

function runAddZipRecruiterSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-ziprecruiter-source <label> <url>");
  }

  const source = addZipRecruiterSearchSource(label, searchUrl);
  console.log(`Added ZipRecruiter source "${source.name}" with id=${source.id}`);
}

function runAddRemoteOkSource(label, searchUrl) {
  if (!label || !searchUrl) {
    throw new Error("Usage: node src/cli.js add-remoteok-source <label> <url>");
  }

  const source = addRemoteOkSearchSource(label, searchUrl);
  console.log(`Added RemoteOK source "${source.name}" with id=${source.id}`);
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

      if (Array.isArray(row.notes) && row.notes.length > 0) {
        console.log(`  notes: ${row.notes.join(" | ")}`);
      }
    }

    return;
  }

  const result = normalizeAllSourceSearchUrls();
  console.log(`Normalized ${result.changed} source URL(s).`);
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

async function ensureBridgeForLinkedInSources(sources) {
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

  const bridgeSession = await ensureBridgeForLinkedInSources([source]);
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

async function runReview(portArg) {
  const port = portArg ? Number(portArg) : 4311;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Review port must be a positive number.");
  }
  const reviewLimit = 5000;

  const { db } = withDatabase();
  const queue = listReviewQueue(db, reviewLimit);
  db.close();

  if (queue.length === 0) {
    console.log("No reviewable jobs in queue. Run sync and score first.");
    return;
  }

  await startReviewServer({ port, limit: reviewLimit });
  console.log(`Review server running at http://127.0.0.1:${port}`);
  console.log("Open that URL in your browser. It will keep one reusable job tab in sync.");
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

  runSync();
  runScore();
  runShortlist();
  runList(10);
  console.log("Pipeline complete. Start the dashboard with: npm run review");
}

async function runLivePipeline(options = {}) {
  await runPipeline(options);
}

function printHelp() {
  console.log(`
job-finder - Local-first job search with intelligent de-duplication

QUICK START:
  jf init                       Initialize profile and database
  jf run                        Sync jobs from all sources (run daily)
  jf review                     Open dashboard at http://localhost:4311

COMMON COMMANDS:
  jf sources                    List configured job sources
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
  jf bridge-server [port]     Start browser bridge manually

DEV/FROM SOURCE:
  node src/cli.js <command>   Run commands directly from source

HELP:
  jf help                     Show this help
  jf --version               Show version

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
  const [, , command = "help", ...args] = process.argv;

  switch (command) {
    case "--version":
    case "-v":
    case "version":
      console.log("job-finder v0.1.0");
      break;
    case "init":
      runInit();
      break;
    case "sync":
      runSync();
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
      await runReview(args[0]);
      break;
    case "run":
      {
        const parsed = extractFlag(args, "--force-refresh");
        await runPipeline({ forceRefresh: parsed.present });
      }
      break;
    case "run-live":
      {
        const parsed = extractFlag(args, "--force-refresh");
        await runLivePipeline({ forceRefresh: parsed.present });
      }
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
