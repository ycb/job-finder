import fs from "node:fs";
import http from "node:http";
import path from "node:path";

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
  useLegacyProfileSource,
  useMyGoalsProfileSource,
  loadSources,
  updateSourceDefinition
} from "../config/load-config.js";
import { openDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import { normalizeJobRecord } from "../jobs/normalize.js";
import {
  listAllJobs,
  listReviewQueue,
  markApplicationStatusByNormalizedHash,
  upsertEvaluations,
  upsertJobs
} from "../jobs/repository.js";
import { evaluateJobs } from "../jobs/score.js";
import {
  isSourceCaptureFresh,
  readSourceCaptureSummary
} from "../sources/cache-policy.js";
import { collectJobsFromSource } from "../sources/linkedin-saved-search.js";

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

function getReviewQueue(limit = 200) {
  return withDatabase((db) => listReviewQueue(db, limit));
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

function hydrateQueue(queue) {
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

  return [...groups.values()]
    .map((job) => {
      delete job._statuses;
      return job;
    })
    .filter((job) => job.status !== "rejected");
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
    source?.type === "indeed_search" ||
    source?.type === "ziprecruiter_search" ||
    source?.type === "remoteok_search"
  );
}

function runSyncAndScore() {
  const { profile } = loadActiveProfile();
  const sources = loadSources().sources.filter((source) => source.enabled);

  return withDatabase((db) => {
    let totalCollected = 0;
    let totalUpserted = 0;

    for (const source of sources) {
      const rawJobs = collectJobsFromSource(source);
      const normalizedJobs = rawJobs.map((job) => normalizeJobRecord(job, source));
      totalCollected += normalizedJobs.length;
      totalUpserted += upsertJobs(db, normalizedJobs);
    }

    const jobs = listAllJobs(db);
    const evaluations = evaluateJobs(profile, jobs);
    upsertEvaluations(db, evaluations);

    return {
      collected: totalCollected,
      upserted: totalUpserted,
      evaluated: evaluations.length,
      buckets: summarizeBuckets(evaluations)
    };
  });
}

async function runSourceCapture(sourceId) {
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

  if (isSourceCaptureFresh(source)) {
    const summary = readCaptureSummary(source);
    return {
      capture: {
        provider: "cache",
        status: "completed",
        cached: true,
        jobsImported: summary.jobCount,
        message: `Skipped fresh capture for "${source.name}" (capturedAt=${summary.capturedAt || "unknown"}).`
      },
      sync: runSyncAndScore()
    };
  }

  await ensureBridgeForSources([source]);
  const capture = await captureSourceViaBridge(source, buildSourceSnapshotPath(source));
  const sync = capture.status === "completed" ? runSyncAndScore() : null;

  return {
    capture,
    sync
  };
}

async function runAllCaptures() {
  const sources = loadSources().sources.filter((source) => source.enabled);
  const captures = [];
  let completedCount = 0;

  const staleBrowserSources = sources.filter(
    (source) => isBrowserCaptureSource(source) && !isSourceCaptureFresh(source)
  );
  if (staleBrowserSources.length > 0) {
    await ensureBridgeForSources(staleBrowserSources);
  }

  for (const source of sources) {
    let capture;

    if (isBrowserCaptureSource(source)) {
      if (isSourceCaptureFresh(source)) {
        const summary = readCaptureSummary(source);
        capture = {
          provider: "cache",
          status: "completed",
          cached: true,
          jobsImported: summary.jobCount,
          message: `Skipped fresh capture for "${source.name}" (capturedAt=${summary.capturedAt || "unknown"}).`
        };
      } else {
        capture = await captureSourceViaBridge(
          source,
          buildSourceSnapshotPath(source)
        );
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
  const sources = loadSources().sources;
  const statsQueue = hydrateQueue(getReviewQueue(5_000));
  const sourceLastSeenAt = getSourceLastSeenAtMap();
  const queue = statsQueue
    .filter((job) => job.status === "new" || job.status === "viewed")
    .slice(0, limit);
  const appliedQueue = statsQueue.filter((job) => job.status === "applied").slice(0, limit);
  const skippedQueue = statsQueue
    .filter((job) => job.status === "skip_for_now")
    .slice(0, limit);

  const countsBySourceId = new Map();

  for (const job of statsQueue) {
    const sourceIds = Array.isArray(job.sourceIds) ? job.sourceIds : [];
    for (const sourceId of sourceIds) {
      const current = countsBySourceId.get(sourceId) || {
        totalCount: 0,
        activeCount: 0,
        appliedCount: 0,
        skippedCount: 0,
        highSignalCount: 0,
        scoredCount: 0,
        scoreTotal: 0
      };

      current.totalCount += 1;
      if (job.status === "applied") {
        current.appliedCount += 1;
      } else if (job.status === "skip_for_now") {
        current.skippedCount += 1;
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
      activeCount: queue.length,
      profilePath: path.resolve(
        activeProfile.source.profilePath || "config/profile.json"
      ),
      goalsFilePath: path.resolve(activeProfile.source.goalsPath || "config/my-goals.json"),
      sourcesPath: path.resolve("config/sources.json")
    },
    sources: sources.map((source) => {
      const capture = readCaptureSummary(source);
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
      const jobCount = isFileBackedCapture ? capture.jobCount : counts.totalCount;
      const captureStatus = isFileBackedCapture ? capture.status : "live_source";
      const capturedAt = isFileBackedCapture
        ? capture.capturedAt
        : sourceLastSeenAt.get(source.id) || null;
      const avgScore =
        counts.scoredCount > 0 ? Math.round(counts.scoreTotal / counts.scoredCount) : null;

      return {
        id: source.id,
        name: source.name,
        searchUrl: source.searchUrl,
        recencyWindow: source.recencyWindow || null,
        enabled: source.enabled,
        type: source.type,
        capturePath: source.capturePath,
        capturedAt,
        jobCount,
        pageUrl: capture.pageUrl,
        captureStatus,
        totalCount: counts.totalCount,
        activeCount: counts.activeCount,
        appliedCount: counts.appliedCount,
        skippedCount: counts.skippedCount,
        highSignalCount: counts.highSignalCount,
        avgScore
      };
    }),
    queue,
    appliedQueue,
    skippedQueue
  };
}

function renderDashboardPage(dashboard) {
  const dashboardJson = JSON.stringify(dashboard);

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

      label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--muted);
      }

      input {
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

      .search-url {
        display: inline-block;
        margin-top: 4px;
        font-size: 12px;
        color: var(--muted);
        word-break: break-all;
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

      .filter-chips {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .filter-chip {
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid var(--line);
        color: var(--muted);
        border-radius: 12px;
        padding: 8px 10px;
        font-size: 13px;
        text-align: left;
        display: inline-flex;
        flex-direction: column;
        gap: 2px;
      }

      .filter-chip.active {
        color: var(--accent);
        border-color: rgba(27, 58, 51, 0.32);
        background: var(--accent-soft);
        font-weight: 700;
      }

      .filter-chip:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .filter-chip-main {
        font-weight: 700;
        color: var(--ink);
      }

      .filter-chip-meta {
        font-size: 11px;
        color: var(--muted);
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
      }

      .jobs-controls-head {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
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
        .meta-grid {
          grid-template-columns: 1fr;
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
      let selectedSourceId = null;
      let selectedTab = "jobs";
      let selectedJobsView = "active";
      let selectedActiveStatusFilter = "all";
      let selectedJobsSort = "score";
      let jobsFiltersCollapsed = false;
      let selectedJobsPage = 1;
      let selectedSearchSourceFilter = "all";
      let selectedJobId = dashboard.queue[0] ? dashboard.queue[0].id : null;
      let editingSourceId = null;
      let sourceFormOpen = false;
      let feedback = "";
      let feedbackError = false;
      let busy = false;

      const app = document.getElementById("app");
      const JOBS_PAGE_SIZE = 10;

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
        return selectedSourceId
          ? items.filter(
              (job) => Array.isArray(job.sourceIds) && job.sourceIds.includes(selectedSourceId)
            )
          : items;
      }

      function activeQueueAllSources() {
        return Array.isArray(dashboard.queue) ? dashboard.queue : [];
      }

      function appliedQueueAllSources() {
        return Array.isArray(dashboard.appliedQueue) ? dashboard.appliedQueue : [];
      }

      function skippedQueueAllSources() {
        return Array.isArray(dashboard.skippedQueue) ? dashboard.skippedQueue : [];
      }

      function jobsForSelectedViewAllSources() {
        if (selectedJobsView === "applied") {
          return appliedQueueAllSources();
        }

        if (selectedJobsView === "skipped") {
          return skippedQueueAllSources();
        }

        const activeJobs = activeQueueAllSources();
        if (selectedActiveStatusFilter === "new") {
          return activeJobs.filter((job) => job?.status === "new");
        }

        if (selectedActiveStatusFilter === "viewed") {
          return activeJobs.filter((job) => job?.status === "viewed");
        }

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

      function isSourceVisibleForSearchFilter(source) {
        const kind = sourceKindFromType(source?.type);
        return selectedSearchSourceFilter === "all" || kind === selectedSearchSourceFilter;
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
        return dashboard.sources.find((source) => source.id === sourceId) || null;
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

      async function refreshAndRescore() {
        busy = true;
        setFeedback("Re-scoring jobs from current profile...");

        try {
          await getJson("/api/sync-score", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          await refreshDashboard();
          setFeedback("Dashboard refreshed and jobs re-scored.");
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          busy = false;
          render();
        }
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
          setFeedback(
            payload.capture && payload.capture.status === "completed"
              ? "Search run completed."
              : "Search run queued."
          );
        } catch (error) {
          setFeedback(error.message, true);
        } finally {
          busy = false;
          render();
        }
      }

      async function runAll() {
        busy = true;
        setFeedback("Running all searches...");

        try {
          await getJson("/api/sources/run-all", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          await refreshDashboard();
          setFeedback("All searches completed.");
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
        if (!Array.isArray(dashboard?.jobs)) {
          return;
        }

        for (const item of dashboard.jobs) {
          if (item.id === jobId) {
            item.status = status;
          }
        }
      }

      async function markViewed(jobId) {
        const target = (dashboard.jobs || []).find((item) => item.id === jobId);
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

      function setSourceFilter(sourceId) {
        selectedSourceId = sourceId || null;
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
        const normalized = String(viewName || "active").toLowerCase();
        if (!["active", "applied", "skipped"].includes(normalized)) {
          return;
        }

        selectedJobsView = normalized;
        if (selectedJobsView !== "active") {
          selectedActiveStatusFilter = "all";
        }
        selectedJobsPage = 1;
        ensureSelectedJob();
        render();
      }

      function setActiveStatusFilter(filterName) {
        if (selectedJobsView !== "active") {
          return;
        }

        const normalized = String(filterName || "all").toLowerCase();
        if (!["all", "new", "viewed"].includes(normalized)) {
          return;
        }

        selectedActiveStatusFilter = normalized;
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
        const normalized = String(filterValue || "all").toLowerCase();
        if (!["all", "li", "bi", "gg", "wf", "ah", "id", "zr", "ro"].includes(normalized)) {
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
        const activeNewCount = activeAll.filter((job) => job?.status === "new").length;
        const activeViewedCount = activeAll.filter((job) => job?.status === "viewed").length;
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

        const filteredSearchSources = dashboard.sources.filter((source) =>
          isSourceVisibleForSearchFilter(source)
        );
        const sourceJobCounts = new Map();
        for (const item of jobsAllInSelectedView) {
          if (!Array.isArray(item?.sourceIds)) {
            continue;
          }

          for (const sourceId of item.sourceIds) {
            sourceJobCounts.set(sourceId, (sourceJobCounts.get(sourceId) || 0) + 1);
          }
        }

        const searchRows = filteredSearchSources
          .map((source) => {
            const isActive = selectedSourceId === source.id;
            const safeName = escapeHtml(source.name);
            const safeUrl = escapeHtml(source.searchUrl);
            const recencyLabel =
              source.type === "ashby_search" || source.type === "google_search"
                ? source.recencyWindow === "1d"
                  ? "1 day"
                  : source.recencyWindow === "1w"
                    ? "1 week"
                    : source.recencyWindow === "1m"
                      ? "1 month"
                      : "Any time"
                : null;
            const lastRun = escapeHtml(formatTime(source.capturedAt));
            const sourceKind = sourceKindFromType(source.type);
            const trackedTotal = Number(source.totalCount || source.jobCount || 0);
            const highSignalLabel =
              String(source.highSignalCount || 0) +
              " (" +
              formatPercent(source.highSignalCount || 0, trackedTotal) +
              ")";
            const statusLabel =
              source.captureStatus === "ready"
                ? "ready"
                : source.captureStatus === "capture_error"
                  ? "capture error"
                  : source.captureStatus === "live_source"
                    ? "live source"
                  : "never run";

            return [
              "<tr>",
              '  <td><span class="source-badge" data-source-kind="' + escapeHtml(sourceKind) + '">' + escapeHtml(sourceKindLabel(sourceKind)) + "</span></td>",
              '  <td><div class="search-name">' + safeName + "</div>" +
                (recencyLabel ? '<div class="subhead">Google window: ' + escapeHtml(recencyLabel) + "</div>" : "") +
                '<a class="search-url" href="' + encodeURI(source.searchUrl) + '" target="_blank" rel="noreferrer">' + safeUrl + "</a></td>",
              "  <td>" + lastRun + "</td>",
              "  <td>" + escapeHtml(statusLabel) + "</td>",
              "  <td>" + escapeHtml(source.jobCount) + "</td>",
              "  <td>" + escapeHtml(source.appliedCount || 0) + "</td>",
              "  <td>" + escapeHtml(source.skippedCount || 0) + "</td>",
              "  <td>" + escapeHtml(highSignalLabel) + "</td>",
              "  <td>" + escapeHtml(source.avgScore ?? "n/a") + "</td>",
              '  <td><div class="search-actions">' +
                '<button class="' + (isActive ? "primary" : "secondary") + '" data-see-results="' + escapeHtml(source.id) + '">See Results</button>' +
                '<button class="secondary" data-run-source="' + escapeHtml(source.id) + '"' + (busy ? " disabled" : "") + ">Run</button>" +
                '<button class="ghost" data-edit-source="' + escapeHtml(source.id) + '"' + (busy ? " disabled" : "") + ">Edit</button>" +
                "</div></td>",
              "</tr>"
            ].join("");
          })
          .join("");

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
          '<button class="filter-chip' + (selectedSourceId ? "" : " active") + '" data-filter-source="">' +
            '<span class="filter-chip-main">All Results</span>' +
            '<span class="filter-chip-meta">All sources · ' + escapeHtml(String(totalInSelectedView)) + " jobs</span>" +
          "</button>",
          ...dashboard.sources.map((source) => {
            const activeClass = selectedSourceId === source.id ? " active" : "";
            const sourceKind = sourceKindFromType(source.type);
            const sourceCount = Number(sourceJobCounts.get(source.id) || 0);
            const isUnavailable = sourceCount === 0 && selectedSourceId !== source.id;
            return (
              '<button class="filter-chip' + activeClass + '" data-filter-source="' + escapeHtml(source.id) + '"' + (isUnavailable ? " disabled" : "") + ">" +
                '<span class="filter-chip-main">' + escapeHtml(source.name) + "</span>" +
                '<span class="filter-chip-meta">' + escapeHtml(sourceKindLabel(sourceKind)) + " · " + escapeHtml(String(sourceCount)) + " jobs</span>" +
              "</button>"
            );
          })
        ].join("");
        const jobsViewPills = [
          '<button class="sub-tab' + (selectedJobsView === "active" ? " active" : "") + '" data-jobs-view="active">Active (' + escapeHtml(String(activeAll.length)) + ')</button>',
          '<button class="sub-tab' + (selectedJobsView === "applied" ? " active" : "") + '" data-jobs-view="applied">Applied (' + escapeHtml(String(appliedAll.length)) + ')</button>',
          '<button class="sub-tab' + (selectedJobsView === "skipped" ? " active" : "") + '" data-jobs-view="skipped">Skipped (' + escapeHtml(String(skippedAll.length)) + ')</button>'
        ].join("");
        const jobsSortPills = [
          '<button class="sub-tab' + (selectedJobsSort === "score" ? " active" : "") + '" data-jobs-sort="score">Score</button>',
          '<button class="sub-tab' + (selectedJobsSort === "date" ? " active" : "") + '" data-jobs-sort="date">Date</button>'
        ].join("");
        const activeStatusPills = selectedJobsView === "active"
          ? [
              '<button class="sub-tab' + (selectedActiveStatusFilter === "all" ? " active" : "") + '" data-active-status="all">All Active (' + escapeHtml(String(activeAll.length)) + ')</button>',
              '<button class="sub-tab' + (selectedActiveStatusFilter === "new" ? " active" : "") + '" data-active-status="new"' + (activeNewCount === 0 && selectedActiveStatusFilter !== "new" ? " disabled" : "") + ">New (" + escapeHtml(String(activeNewCount)) + ')</button>',
              '<button class="sub-tab' + (selectedActiveStatusFilter === "viewed" ? " active" : "") + '" data-active-status="viewed"' + (activeViewedCount === 0 && selectedActiveStatusFilter !== "viewed" ? " disabled" : "") + ">Viewed (" + escapeHtml(String(activeViewedCount)) + ')</button>'
            ].join("")
          : "";
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
                  job.notes
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
          '<div class="jobs-view-panel">',
          '  <div class="jobs-view-nav">' + jobsViewPills + "</div>",
          "</div>",
          '<section class="card jobs-controls-panel">',
          '  <div class="jobs-controls-head">',
            '    <button class="disclosure-btn" id="toggle-job-filters" aria-expanded="' + escapeHtml(String(!jobsFiltersCollapsed)) + '">',
            '      <span class="disclosure-caret">' + (jobsFiltersCollapsed ? "▸" : "▾") + "</span>",
            '      <span>Filters</span>',
            "    </button>",
          "  </div>",
          '  <div class="subhead" style="margin-top: 8px;">Showing ' + escapeHtml(showingRangeLabel) + " of " + escapeHtml(String(jobsInView.length)) + " jobs</div>",
          (!jobsFiltersCollapsed
            ? [
                '  <div class="ranked-controls">',
                (selectedJobsView === "active"
                  ? [
                      '    <div class="controls-group">',
                      '      <div class="controls-label">Status</div>',
                      '      <div class="sub-tabs">' + activeStatusPills + "</div>",
                      "    </div>"
                    ].join("")
                  : ""),
                '    <div class="controls-group">',
                '      <div class="controls-label">Sort</div>',
                '      <div class="sub-tabs">' + jobsSortPills + "</div>",
                "    </div>",
                '    <div class="controls-group">',
                '      <div class="controls-label">Source</div>',
                '      <div class="filter-chips">' + sourceFilterPills + "</div>",
                "    </div>",
                "  </div>"
              ].join("")
            : ""),
          "</section>",
          '<div class="jobs-layout">',
          '  <section class="card">',
          '    <p class="section-label">Ranked Jobs (' + escapeHtml(String(jobsInView.length)) + ")</p>",
          '    <div class="queue-list" style="margin-top: 10px;">' + queueItems + "</div>",
          queuePagination,
          "  </section>",
          '  <section class="card">',
          detailMarkup,
          "  </section>",
          "</div>"
        ].join("");

        const searchesSection = [
          '<section class="card" style="margin-top: 18px;">',
          '  <div class="search-header">',
          '    <p class="section-label">My Job Searches</p>',
          '    <button class="primary" id="open-add-source"' + (busy ? " disabled" : "") + ">" + (editingSourceId ? "Add Another Search" : "Add Search") + "</button>",
          "  </div>",
          '  <div class="sub-tabs" style="margin-top: 8px;">' +
            '<button class="sub-tab' + (selectedSearchSourceFilter === "all" ? " active" : "") + '" data-search-type="all">All</button>' +
            '<button class="sub-tab' + (selectedSearchSourceFilter === "li" ? " active" : "") + '" data-search-type="li">LinkedIn</button>' +
            '<button class="sub-tab' + (selectedSearchSourceFilter === "bi" ? " active" : "") + '" data-search-type="bi">Built In</button>' +
            '<button class="sub-tab' + (selectedSearchSourceFilter === "gg" ? " active" : "") + '" data-search-type="gg">Google</button>' +
            '<button class="sub-tab' + (selectedSearchSourceFilter === "wf" ? " active" : "") + '" data-search-type="wf">Wellfound</button>' +
            '<button class="sub-tab' + (selectedSearchSourceFilter === "ah" ? " active" : "") + '" data-search-type="ah">Ashby</button>' +
            '<button class="sub-tab' + (selectedSearchSourceFilter === "id" ? " active" : "") + '" data-search-type="id">Indeed</button>' +
            '<button class="sub-tab' + (selectedSearchSourceFilter === "zr" ? " active" : "") + '" data-search-type="zr">ZipRecruiter</button>' +
            '<button class="sub-tab' + (selectedSearchSourceFilter === "ro" ? " active" : "") + '" data-search-type="ro">RemoteOK</button>' +
          "</div>",
          '  <div class="subhead" style="margin-top: 10px;">Source type and freshness are tracked so you can refine where high-signal jobs come from.</div>',
          (sourceFormOpen || editingSourceId
            ? [
                '  <div class="card inset" style="margin-top: 14px;">',
                '    <p class="section-label">' + escapeHtml(formState.heading) + "</p>",
                '    <div class="search-form">',
                '      <label>Name<input id="source-name" type="text" value="' + escapeHtml(formState.name) + '" placeholder="AI PM"></label>',
                '      <label>Search URL<input id="source-url" type="text" value="' + escapeHtml(formState.searchUrl) + '" placeholder="LinkedIn, Built In, Google, Wellfound, Ashby, Indeed, ZipRecruiter, or RemoteOK jobs URL"></label>',
                '      <label>Google Time Window<select id="source-recency-window">' +
                  '<option value="any"' + (formState.recencyWindow === "any" ? " selected" : "") + ">Any time</option>" +
                  '<option value="1d"' + (formState.recencyWindow === "1d" ? " selected" : "") + ">1 day</option>" +
                  '<option value="1w"' + (formState.recencyWindow === "1w" ? " selected" : "") + ">1 week</option>" +
                  '<option value="1m"' + (formState.recencyWindow === "1m" ? " selected" : "") + ">1 month</option>" +
                "</select></label>",
                '      <div class="subhead">Applied to Google-based searches. Default: 1 week for Google and 1 month for Ashby discovery.</div>',
                '      <div class="inline-actions">',
                '        <button class="primary" id="save-source"' + (busy ? " disabled" : "") + ">" + escapeHtml(formState.actionLabel) + "</button>",
                '        <button class="ghost" id="cancel-edit"' + (busy ? " disabled" : "") + ">Cancel</button>",
                "      </div>",
                "    </div>",
                "  </div>"
              ].join("")
            : ""),
          '  <div style="margin-top: 16px; overflow-x: auto;">',
          '    <table>',
          '      <thead><tr><th>Source</th><th>Name / URL</th><th>Last Run</th><th>Status</th><th>Jobs Found</th><th>Applied</th><th>Skipped</th><th>High Signal</th><th>Avg Score</th><th>Actions</th></tr></thead>',
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
          '    <div class="meta-item"><dt>Profile File</dt><dd>' + escapeHtml(dashboard.profile.profilePath || "") + "</dd></div>",
          '    <div class="meta-item"><dt>My Goals File</dt><dd>' + escapeHtml(dashboard.profile.goalsFilePath || "config/my-goals.json") + "</dd></div>",
          '    <div class="meta-item"><dt>Sources File</dt><dd>' + escapeHtml(dashboard.profile.sourcesPath || "") + "</dd></div>",
          "  </dl>",
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
          "  </div>",
          '  <div class="feedback' + (feedbackError ? " error" : "") + '">' + escapeHtml(feedback) + "</div>",
          "</section>"
        ].join("");

        app.innerHTML = [
          '<div class="header">',
          "  <div>",
          '    <div class="eyebrow">Dashboard</div>',
          "    <h1>Job Finder</h1>",
          '    <div class="subhead">Manage saved searches, run intake, and review ranked jobs in one place.</div>',
          "  </div>",
          '  <div class="top-actions">',
          '    <button class="primary" id="run-all"' + (busy ? " disabled" : "") + ">Run All Searches</button>",
          '    <button class="secondary" id="refresh-data"' + (busy ? " disabled" : "") + ">Refresh + Re-score</button>",
          "  </div>",
          "</div>",
          '<div class="main-tabs">' + tabButtons + "</div>",
          selectedTab === "jobs"
            ? jobsSection
            : selectedTab === "searches"
              ? searchesSection
              : profileSection
        ].join("");

        document.getElementById("run-all").addEventListener("click", runAll);
        document.getElementById("refresh-data").addEventListener("click", refreshAndRescore);
        for (const button of document.querySelectorAll("[data-tab]")) {
          button.addEventListener("click", () => setTab(button.dataset.tab));
        }

        if (selectedTab === "jobs") {
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

          for (const button of document.querySelectorAll("[data-jobs-sort]")) {
            button.addEventListener("click", () => setJobsSort(button.dataset.jobsSort));
          }

          for (const button of document.querySelectorAll("[data-jobs-page-nav]")) {
            button.addEventListener("click", () => {
              const step = button.dataset.jobsPageNav === "next" ? 1 : -1;
              setJobsPage(selectedJobsPage + step);
            });
          }

          for (const button of document.querySelectorAll("[data-active-status]")) {
            button.addEventListener("click", () => setActiveStatusFilter(button.dataset.activeStatus));
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
          const openAddSource = document.getElementById("open-add-source");
          if (openAddSource) {
            openAddSource.addEventListener("click", beginAddSource);
          }

          for (const button of document.querySelectorAll("[data-search-type]")) {
            button.addEventListener("click", () => setSearchSourceFilter(button.dataset.searchType));
          }

          const saveSourceButton = document.getElementById("save-source");
          if (saveSourceButton) {
            saveSourceButton.addEventListener("click", saveSource);
          }

          const cancelEdit = document.getElementById("cancel-edit");
          if (cancelEdit) {
            cancelEdit.addEventListener("click", resetSourceForm);
          }

          for (const button of document.querySelectorAll("[data-see-results]")) {
            button.addEventListener("click", () => {
              selectedTab = "jobs";
              setSourceFilter(button.dataset.seeResults);
            });
          }

          for (const button of document.querySelectorAll("[data-run-source]")) {
            button.addEventListener("click", () => runSource(button.dataset.runSource));
          }

          for (const button of document.querySelectorAll("[data-edit-source]")) {
            button.addEventListener("click", () => beginEditSource(button.dataset.editSource));
          }
        }

        if (selectedTab === "profile") {
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

export function startReviewServer({ port = 4311, limit = 200 } = {}) {
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
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, profile: dashboard.profile }));
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

        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, source }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/sources/run-all") {
        const result = await runAllCaptures();
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/sync-score") {
        const sync = runSyncAndScore();
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

        const result = await runSourceCapture(decodeURIComponent(match[1]));
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
