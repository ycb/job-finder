import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { captureLinkedInSourceViaBridge } from "./browser-bridge/client.js";
import { startBrowserBridgeServer } from "./browser-bridge/server.js";
import {
  addLinkedInCaptureSource,
  getSourceByIdOrName,
  loadAppConfig,
  loadProfile,
  loadSources,
  normalizeAllSourceSearchUrls,
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
  const { sources } = loadAppConfig();
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
  const profile = loadProfile();
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

function runListSources() {
  const sources = loadSources();

  for (const source of sources.sources) {
    let captureStatus = "no-capture";

    if (source.type === "linkedin_capture_file" && source.capturePath) {
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
  const snapshotPath = path.resolve(snapshotPathArg || getDefaultSnapshotPath(source));
  const result = await captureLinkedInSourceViaBridge(source, snapshotPath);

  console.log(
    `Live-captured ${result.jobsImported} job(s) for "${source.name}" from ${result.snapshotPath}`
  );
}

async function runCaptureAllLive(snapshotDirArg) {
  const sources = loadSources().sources.filter(
    (source) => source.enabled && source.type === "linkedin_capture_file"
  );

  if (sources.length === 0) {
    console.log("No enabled linkedin_capture_file sources.");
    return;
  }

  const snapshotDir = path.resolve(snapshotDirArg || "output/playwright");
  let completed = 0;

  for (const source of sources) {
    const snapshotPath = getDefaultSnapshotPath(source, snapshotDir);
    const result = await captureLinkedInSourceViaBridge(source, snapshotPath);
    completed += 1;
    console.log(
      `Live-captured ${result.jobsImported} job(s) for "${source.name}" from ${result.snapshotPath}`
    );
  }

  console.log(`capture-all-live imported ${completed} source(s).`);
}

async function runBridgeServer(portArg, providerArg) {
  const port = portArg ? Number(portArg) : 4315;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Bridge port must be a positive number.");
  }

  const providerName = String(providerArg || process.env.JOB_FINDER_BRIDGE_PROVIDER || "noop");
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

function runPipeline() {
  runSync();
  runScore();
  runShortlist();
  runList(10);
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
  node src/cli.js set-source-url <source-id-or-label> <url>
  node src/cli.js normalize-source-urls
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
    case "set-source-url":
      runSetSourceUrl(args[0], args[1]);
      break;
    case "normalize-source-urls":
      runNormalizeSourceUrls();
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
      runPipeline();
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
