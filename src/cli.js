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
  addLinkedInCaptureSource,
  addWellfoundSearchSource,
  connectNarrataGoalsFile,
  connectNarrataSupabase,
  getSourceByIdOrName,
  loadActiveProfile,
  loadProfileSourceConfig,
  loadSources,
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
  upsertJobs
} from "./jobs/repository.js";
import { evaluateJobs } from "./jobs/score.js";
import { writeShortlistFile } from "./output/render.js";
import { startReviewServer } from "./review/server.js";
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

  for (const source of sources.sources.filter((item) => item.enabled)) {
    const rawJobs = collectJobsFromSource(source);
    const normalizedJobs = rawJobs.map((job) => normalizeJobRecord(job, source));
    totalCollected += normalizedJobs.length;
    totalUpserted += upsertJobs(db, normalizedJobs);
  }

  db.close();
  console.log(`Collected ${totalCollected} job(s). Upserted ${totalUpserted} record(s).`);
}

function runScore() {
  const { profile } = loadActiveProfile();
  const { db } = withDatabase();
  const jobs = listAllJobs(db);
  const evaluations = evaluateJobs(profile, jobs);
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

    if (
      (source.type === "linkedin_capture_file" ||
        source.type === "wellfound_search" ||
        source.type === "ashby_search") &&
      source.capturePath
    ) {
      try {
        const raw = JSON.parse(fs.readFileSync(source.capturePath, "utf8"));
        const jobCount = Array.isArray(raw.jobs) ? raw.jobs.length : 0;
        const capturedAt =
          typeof raw.capturedAt === "string" && raw.capturedAt.trim()
            ? raw.capturedAt
            : "never";
        captureStatus = `capturedAt=${capturedAt}; jobs=${jobCount}`;
      } catch {
        captureStatus = "capture-unreadable";
      }
    } else if (source.type === "builtin_search") {
      captureStatus = "live-fetch";
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

function runSetSourceUrl(sourceIdOrName, searchUrl) {
  if (!sourceIdOrName || !searchUrl) {
    throw new Error("Usage: node src/cli.js set-source-url <source-id-or-label> <url>");
  }

  const updatedSource = updateSourceSearchUrl(sourceIdOrName, searchUrl);
  console.log(
    `Updated "${updatedSource.name}" (${updatedSource.id}) searchUrl to ${updatedSource.searchUrl}`
  );
}

function runNormalizeSourceUrls() {
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

function isBrowserCaptureSource(source) {
  return isLinkedInSource(source) || isWellfoundSource(source) || isAshbySource(source);
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

async function runCaptureSourceLive(sourceIdOrName, snapshotPathArg) {
  if (!sourceIdOrName) {
    throw new Error(
      "Usage: node src/cli.js capture-source-live <source-id-or-label> [snapshot-path]"
    );
  }

  const source = getSourceByIdOrName(sourceIdOrName);
  if (!isBrowserCaptureSource(source)) {
    throw new Error(
      `capture-source-live supports linkedin_capture_file, wellfound_search, and ashby_search sources. "${source.name}" is ${source.type}.`
    );
  }

  const bridgeSession = await ensureBridgeForLinkedInSources([source]);
  const snapshotPath = path.resolve(snapshotPathArg || getDefaultSnapshotPath(source));
  let result;

  try {
    result = await captureSourceViaBridge(source, snapshotPath);
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

  console.log(
    `Live-captured ${result.jobsImported} job(s) for "${source.name}" via ${result.provider || "bridge"}`
  );
}

async function runCaptureAllLive(snapshotDirArg) {
  const sources = getEnabledBrowserCaptureSources();

  if (sources.length === 0) {
    console.log(
      "No enabled LinkedIn/Wellfound/Ashby browser-capture sources. Skipping live capture."
    );
    return {
      completed: 0,
      pending: false,
      skipped: true
    };
  }

  const bridgeSession = await ensureBridgeForLinkedInSources(sources);
  const snapshotDir = path.resolve(snapshotDirArg || "output/playwright");
  let completed = 0;

  try {
    for (const source of sources) {
      const snapshotPath = getDefaultSnapshotPath(source, snapshotDir);
      const result = await captureSourceViaBridge(source, snapshotPath);

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

  const { db } = withDatabase();
  const queue = listReviewQueue(db, 100);
  db.close();

  if (queue.length === 0) {
    console.log("No reviewable jobs in queue. Run sync and score first.");
    return;
  }

  await startReviewServer({ port, limit: 100 });
  console.log(`Review server running at http://127.0.0.1:${port}`);
  console.log("Open that URL in your browser. It will keep one reusable job tab in sync.");
}

async function runPipeline() {
  const sources = loadSources().sources.filter((source) => source.enabled);
  const hasBrowserCapture = sources.some((source) => isBrowserCaptureSource(source));

  if (hasBrowserCapture) {
    const captureSummary = await runCaptureAllLive();

    if (captureSummary?.pending) {
      console.log(
        "Browser capture is pending manual snapshot handoff. Continuing with sync using current source data."
      );
    }
  } else {
    console.log("No enabled LinkedIn/Wellfound/Ashby sources. Skipping browser capture.");
  }

  runSync();
  runScore();
  runShortlist();
  runList(10);
  console.log("Pipeline complete. Start the dashboard with: npm run review");
}

async function runLivePipeline() {
  await runPipeline();
}

function printHelp() {
  console.log(`
Usage:
  node src/cli.js init
  node src/cli.js sync
  node src/cli.js score
  node src/cli.js shortlist
  node src/cli.js list [limit]
  node src/cli.js sources
  node src/cli.js add-source <label> <url>
  node src/cli.js add-builtin-source <label> <url>
  node src/cli.js add-wellfound-source <label> <url>
  node src/cli.js add-ashby-source <label> <url> [any|1d|1w|1m]
  node src/cli.js set-source-url <source-id-or-label> <url>
  node src/cli.js normalize-source-urls
  node src/cli.js profile-source
  node src/cli.js use-my-goals [goals-path]
  node src/cli.js use-profile-file [profile-path]
  node src/cli.js connect-narrata-file [goals-path]
  node src/cli.js connect-narrata-supabase <supabase-url> <user-id> [service-role-env]
  node src/cli.js open-source <source-id-or-label>
  node src/cli.js open-sources
  node src/cli.js capture-source <source-id-or-label> [snapshot-path]
  node src/cli.js capture-all [snapshot-dir]
  node src/cli.js capture-source-live <source-id-or-label> [snapshot-path]
  node src/cli.js capture-all-live [snapshot-dir]
  node src/cli.js bridge-server [port] [provider]
  node src/cli.js import-linkedin-snapshot <source-id-or-label> <snapshot-path>
  node src/cli.js mark <job-id> <status>
  node src/cli.js review [port]
  node src/cli.js run
  node src/cli.js run-live   (alias for run)
  `.trim());
}

async function main() {
  const [, , command = "help", ...args] = process.argv;

  switch (command) {
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
    case "add-wellfound-source":
      runAddWellfoundSource(args[0], args[1]);
      break;
    case "add-ashby-source":
      runAddAshbySource(args[0], args[1], args[2]);
      break;
    case "set-source-url":
      runSetSourceUrl(args[0], args[1]);
      break;
    case "normalize-source-urls":
      runNormalizeSourceUrls();
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
      await runCaptureSourceLive(args[0], args[1]);
      break;
    case "capture-all-live":
      await runCaptureAllLive(args[0]);
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
      await runPipeline();
      break;
    case "run-live":
      await runLivePipeline();
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
