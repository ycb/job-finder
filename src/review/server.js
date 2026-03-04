import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { captureLinkedInSourceViaBridge } from "../browser-bridge/client.js";
import {
  addLinkedInCaptureSource,
  loadProfile,
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

  if (status === "applied" || status === "rejected" || status === "viewed") {
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

function pickStatus(statuses) {
  const normalized = statuses.map((status) => normalizeStatus(status));

  if (normalized.includes("applied")) {
    return "applied";
  }

  if (normalized.includes("rejected")) {
    return "rejected";
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
  if (!source?.capturePath || !fs.existsSync(source.capturePath)) {
    return {
      capturedAt: null,
      jobCount: 0,
      pageUrl: null,
      status: "never_run"
    };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(source.capturePath, "utf8"));
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];

    return {
      capturedAt:
        typeof payload.capturedAt === "string" && payload.capturedAt.trim()
          ? payload.capturedAt
          : null,
      jobCount: jobs.length,
      pageUrl: typeof payload.pageUrl === "string" ? payload.pageUrl : null,
      status: "ready"
    };
  } catch {
    return {
      capturedAt: null,
      jobCount: 0,
      pageUrl: null,
      status: "capture_error"
    };
  }
}

function buildSourceSnapshotPath(source) {
  return path.resolve("output/playwright", `${source.id}-snapshot.md`);
}

function runSyncAndScore() {
  const profile = loadProfile();
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

  const capture = await captureLinkedInSourceViaBridge(source, buildSourceSnapshotPath(source));
  const sync = capture.status === "completed" ? runSyncAndScore() : null;

  return {
    capture,
    sync
  };
}

async function runAllCaptures() {
  const sources = loadSources().sources.filter(
    (source) => source.enabled && source.type === "linkedin_capture_file"
  );
  const captures = [];
  let completedCount = 0;

  for (const source of sources) {
    const capture = await captureLinkedInSourceViaBridge(
      source,
      buildSourceSnapshotPath(source)
    );
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
  const profile = loadProfile();
  const sources = loadSources().sources;
  const groupedQueue = hydrateQueue(getReviewQueue(limit));
  const queue = groupedQueue.filter((job) => job.status !== "applied");
  const appliedQueue = groupedQueue.filter((job) => job.status === "applied");

  const countsBySourceId = new Map();

  for (const job of queue) {
    const sourceIds = Array.isArray(job.sourceIds) ? job.sourceIds : [];
    for (const sourceId of sourceIds) {
      const current = countsBySourceId.get(sourceId) || {
        activeCount: 0,
        highSignalCount: 0
      };

      current.activeCount += 1;
      if (job.bucket === "high_signal") {
        current.highSignalCount += 1;
      }

      countsBySourceId.set(sourceId, current);
    }
  }

  return {
    profile: {
      candidateName: profile.candidateName,
      remotePreference: profile.remotePreference,
      salaryFloor: profile.salaryFloor,
      appliedCount: appliedQueue.length,
      activeCount: queue.length,
      profilePath: path.resolve("config/profile.json"),
      sourcesPath: path.resolve("config/sources.json")
    },
    sources: sources.map((source) => {
      const capture = readCaptureSummary(source);
      const counts = countsBySourceId.get(source.id) || {
        activeCount: 0,
        highSignalCount: 0
      };

      return {
        id: source.id,
        name: source.name,
        searchUrl: source.searchUrl,
        enabled: source.enabled,
        type: source.type,
        capturePath: source.capturePath,
        capturedAt: capture.capturedAt,
        jobCount: capture.jobCount,
        pageUrl: capture.pageUrl,
        captureStatus: capture.status,
        activeCount: counts.activeCount,
        highSignalCount: counts.highSignalCount
      };
    }),
    queue,
    appliedQueue
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
        --surface: rgba(255, 255, 255, 0.76);
        --ink: #1e2a26;
        --muted: #5e6b66;
        --line: #d8cfbd;
        --line-strong: #c8bea8;
        --high: #17643a;
        --review: #8a5a0a;
        --button: #1e2a26;
        --button-ink: #fdf9ef;
        --error: #8b1e1e;
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
      .status-row,
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
      }

      button.primary,
      a.button.primary {
        background: var(--button);
        color: var(--button-ink);
      }

      button.secondary,
      a.button.secondary {
        background: rgba(255, 255, 255, 0.82);
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

      .grid {
        margin-top: 18px;
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
        gap: 20px;
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

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 7px 11px;
        border: 1px solid var(--line);
        font-size: 13px;
        background: rgba(255, 255, 255, 0.8);
      }

      .pill.active {
        background: var(--button);
        color: var(--button-ink);
        border-color: var(--button);
      }

      .pill[data-bucket="high_signal"] {
        color: var(--high);
        border-color: rgba(23, 100, 58, 0.25);
      }

      .pill[data-bucket="review_later"] {
        color: var(--review);
        border-color: rgba(138, 90, 10, 0.25);
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

      .queue-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 62vh;
        overflow: auto;
        padding-right: 4px;
      }

      .queue-item {
        width: 100%;
        text-align: left;
        background: rgba(255, 255, 255, 0.82);
        color: var(--ink);
        border: 1px solid var(--line);
        padding: 14px;
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
        font-size: 16px;
        line-height: 1.3;
        font-weight: 700;
      }

      .queue-item-score {
        font-size: 13px;
        white-space: nowrap;
        color: var(--high);
      }

      .queue-item-meta,
      .queue-item-summary,
      .muted {
        color: var(--muted);
      }

      .queue-item-meta,
      .queue-item-summary {
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

      .status-row button {
        background: rgba(255, 255, 255, 0.82);
        border: 1px solid var(--line);
        color: var(--ink);
      }

      .status-row button.active {
        background: var(--button);
        border-color: var(--button);
        color: var(--button-ink);
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
        .grid {
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
      let selectedJobId = dashboard.queue[0] ? dashboard.queue[0].id : null;
      let editingSourceId = null;
      let feedback = "";
      let feedbackError = false;
      let busy = false;

      const app = document.getElementById("app");

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function filteredQueue() {
        return selectedSourceId
          ? dashboard.queue.filter((job) => Array.isArray(job.sourceIds) && job.sourceIds.includes(selectedSourceId))
          : dashboard.queue;
      }

      function filteredAppliedQueue() {
        return selectedSourceId
          ? (dashboard.appliedQueue || []).filter(
              (job) => Array.isArray(job.sourceIds) && job.sourceIds.includes(selectedSourceId)
            )
          : (dashboard.appliedQueue || []);
      }

      function ensureSelectedJob() {
        const queue = filteredQueue();

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

      function formatStatus(status) {
        if (status === "viewed" || status === "applied" || status === "rejected") {
          return status;
        }

        return "new";
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
        render();
      }

      async function saveSource() {
        const nameInput = document.getElementById("source-name");
        const urlInput = document.getElementById("source-url");

        const body = {
          sourceId: editingSourceId,
          name: nameInput.value,
          searchUrl: urlInput.value
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
        render();
      }

      function resetSourceForm() {
        editingSourceId = null;
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
          const promptedReason = window.prompt("Why reject this job?", "");
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
                : "Job status updated."
          );
        } catch (error) {
          setFeedback(error.message, true);
        }
      }

      async function openCurrent() {
        const job = currentJob();
        if (!job) {
          return;
        }

        window.open(job.reviewTarget.url, "job-review-target");

        if (job.status === "new") {
          await updateStatus("viewed");
        }
      }

      function setSourceFilter(sourceId) {
        selectedSourceId = sourceId || null;
        ensureSelectedJob();
        render();
      }

      function selectJob(jobId) {
        selectedJobId = jobId;
        render();
      }

      function sourceFormValues() {
        if (!editingSourceId) {
          return {
            heading: "Add Search",
            actionLabel: "Add Search",
            name: "",
            searchUrl: ""
          };
        }

        const source = sourceById(editingSourceId);
        if (!source) {
          return {
            heading: "Add Search",
            actionLabel: "Add Search",
            name: "",
            searchUrl: ""
          };
        }

        return {
          heading: "Edit Search",
          actionLabel: "Save Changes",
          name: source.name,
          searchUrl: source.searchUrl
        };
      }

      function render() {
        const queue = filteredQueue();
        const appliedQueue = filteredAppliedQueue();
        const job = currentJob();
        const formState = sourceFormValues();

        const searchRows = dashboard.sources
          .map((source) => {
            const isActive = selectedSourceId === source.id;
            const safeName = escapeHtml(source.name);
            const safeUrl = escapeHtml(source.searchUrl);
            const lastRun = escapeHtml(formatTime(source.capturedAt));
            const statusLabel =
              source.captureStatus === "ready"
                ? "ready"
                : source.captureStatus === "capture_error"
                  ? "capture error"
                  : "never run";

            return [
              "<tr>",
              '  <td><div class="search-name">' + safeName + '</div><a class="search-url" href="' + encodeURI(source.searchUrl) + '" target="_blank" rel="noreferrer">' + safeUrl + "</a></td>",
              "  <td>" + lastRun + "</td>",
              "  <td>" + escapeHtml(statusLabel) + "</td>",
              "  <td>" + escapeHtml(source.jobCount) + "</td>",
              "  <td>" + escapeHtml(source.highSignalCount) + "</td>",
              '  <td><div class="search-actions">' +
                '<button class="' + (isActive ? "primary" : "secondary") + '" data-see-results="' + escapeHtml(source.id) + '">See Results</button>' +
                '<button class="secondary" data-run-source="' + escapeHtml(source.id) + '"' + (busy ? " disabled" : "") + ">Run</button>" +
                '<button class="ghost" data-edit-source="' + escapeHtml(source.id) + '"' + (busy ? " disabled" : "") + ">Edit</button>" +
                "</div></td>",
              "</tr>"
            ].join("");
          })
          .join("");

        const queueItems = queue.length
          ? queue
              .map((item) => {
                const sources = (Array.isArray(item.sourceIds) ? item.sourceIds : [])
                  .map((sourceId) => sourceById(sourceId))
                  .filter(Boolean);
                const sourceNames = sources.map((source) => source.name);
                const activeClass = item.id === selectedJobId ? " active" : "";

                return [
                  '<button class="queue-item' + activeClass + '" data-job-id="' + escapeHtml(item.id) + '">',
                  '  <div class="queue-item-header">',
                  '    <span class="queue-item-title">' + escapeHtml(item.title) + '</span>',
                  '    <span class="queue-item-score">Score ' + escapeHtml(item.score ?? "n/a") + '</span>',
                  "  </div>",
                  '  <div class="queue-item-meta">' +
                    escapeHtml(item.company) +
                    " · " +
                    escapeHtml(formatValue(item.location, "Location unknown")) +
                    " · " +
                    escapeHtml(formatBucket(item.bucket)) +
                    "</div>",
                  '  <div class="queue-item-summary">' + escapeHtml(item.summary || "No summary available.") + "</div>",
                  sourceNames.length
                    ? '  <div class="queue-item-meta">Found via ' + escapeHtml(sourceNames.join(", ")) + "</div>"
                    : "",
                  item.duplicateCount > 1
                    ? '  <div class="queue-item-meta">Seen in ' + escapeHtml(item.duplicateCount) + " searches</div>"
                    : "",
                  "</button>"
                ].join("");
              })
              .join("")
          : '<p class="muted">No jobs match this filter yet.</p>';

        const sourceFilterPills = [
          '<button class="pill' + (selectedSourceId ? "" : " active") + '" data-filter-source="">All Results</button>',
          ...dashboard.sources.map((source) => {
            const activeClass = selectedSourceId === source.id ? " active" : "";
            return '<button class="pill' + activeClass + '" data-filter-source="' + escapeHtml(source.id) + '">' + escapeHtml(source.name) + "</button>";
          })
        ].join("");

        const appliedItems = appliedQueue.length
          ? appliedQueue
              .map((item) => {
                const sources = (Array.isArray(item.sourceIds) ? item.sourceIds : [])
                  .map((sourceId) => sourceById(sourceId))
                  .filter(Boolean);
                const sourceNames = sources.map((source) => source.name);

                return [
                  '<div class="queue-item">',
                  '  <div class="queue-item-header">',
                  '    <span class="queue-item-title">' + escapeHtml(item.title) + '</span>',
                  '    <span class="queue-item-score">Applied</span>',
                  "  </div>",
                  '  <div class="queue-item-meta">' +
                    escapeHtml(item.company) +
                    " · " +
                    escapeHtml(formatValue(item.location, "Location unknown")) +
                    "</div>",
                  sourceNames.length
                    ? '  <div class="queue-item-meta">Found via ' + escapeHtml(sourceNames.join(", ")) + "</div>"
                    : "",
                  item.notes
                    ? '  <div class="queue-item-summary">' + escapeHtml(item.notes) + "</div>"
                    : "",
                  '  <div class="queue-item-meta" style="margin-top: 8px;"><a href="' +
                    encodeURI(item.reviewTarget.url) +
                    '" target="job-review-target" rel="noreferrer">' +
                    escapeHtml(reviewLinkLabel(item)) +
                    "</a></div>",
                  "</div>"
                ].join("");
              })
              .join("")
          : '<p class="muted">No applied jobs in this view.</p>';

        const detailMarkup = job
          ? [
              (() => {
                const sourceNames = (Array.isArray(job.sourceIds) ? job.sourceIds : [])
                  .map((sourceId) => sourceById(sourceId))
                  .filter(Boolean)
                  .map((source) => source.name);
                const sourceSummary = sourceNames.length
                  ? sourceNames.join(", ")
                  : "No saved search linked";

                return [
                  '<div class="eyebrow">Review</div>',
                  '<h1 style="font-size: 30px;">' + escapeHtml(job.title) + "</h1>",
                  '<div class="subhead">' +
                    escapeHtml(job.company) +
                    " · " +
                    escapeHtml(formatValue(job.location, "Location unknown")) +
                    "</div>",
                  '<div class="filter-row" style="margin-top: 14px;">',
                  '  <span class="pill" data-bucket="' + escapeHtml(job.bucket || "unscored") + '">Bucket: ' + escapeHtml(formatBucket(job.bucket)) + "</span>",
                  '  <span class="pill">Score: ' + escapeHtml(job.score ?? "n/a") + "</span>",
                  '  <span class="pill">Status: ' + escapeHtml(formatStatus(job.status)) + "</span>",
                  '  <span class="pill">Searches: ' + escapeHtml(sourceSummary) + "</span>",
                  job.duplicateCount > 1
                    ? '  <span class="pill">Seen in ' + escapeHtml(job.duplicateCount) + " searches</span>"
                    : "",
                  "</div>",
                  '<div class="inline-actions" style="margin-top: 16px;">',
                  '  <button class="primary" id="open-current">' + escapeHtml(reviewLinkLabel(job)) + "</button>",
                  "</div>",
                  '<div class="status-row" style="margin-top: 16px;">',
                  '  <button class="' + (formatStatus(job.status) === "new" ? "active" : "") + '" data-status="new">New</button>',
                  '  <button class="' + (formatStatus(job.status) === "viewed" ? "active" : "") + '" data-status="viewed">Viewed</button>',
                  '  <button class="' + (formatStatus(job.status) === "applied" ? "active" : "") + '" data-status="applied">I Applied</button>',
                  '  <button class="' + (formatStatus(job.status) === "rejected" ? "active" : "") + '" data-status="rejected">Reject</button>',
                  "</div>",
                  '<div class="card" style="margin-top: 16px;">',
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
                  '<div class="card" style="margin-top: 16px;">',
                  '  <p class="section-label">Role Snapshot</p>',
                  '  <dl class="meta-grid">',
                  '    <div class="meta-item"><dt>Salary</dt><dd>' + escapeHtml(formatValue(job.salaryText, "Unknown")) + "</dd></div>",
                  '    <div class="meta-item"><dt>Employment</dt><dd>' + escapeHtml(formatValue(job.employmentType, "Unknown")) + "</dd></div>",
                  '    <div class="meta-item"><dt>Posted</dt><dd>' + escapeHtml(formatValue(job.postedAt, "Unknown")) + "</dd></div>",
                  '    <div class="meta-item"><dt>Link</dt><dd><a href="' + encodeURI(job.reviewTarget.url) + '" target="job-review-target" rel="noreferrer">' + escapeHtml(reviewLinkLabel(job)) + "</a></dd></div>",
                  "  </dl>",
                  "</div>"
                ].join("");
              })()
            ].join("")
          : '<div class="eyebrow">Review</div><p class="muted">No jobs are available for the current filter.</p>';

        app.innerHTML = [
          '<div class="header">',
          "  <div>",
          '    <div class="eyebrow">Dashboard</div>',
          "    <h1>Job Finder</h1>",
          '    <div class="subhead">Manage saved searches, run intake, and review ranked jobs in one place.</div>',
          "  </div>",
          '  <div class="top-actions">',
          '    <button class="primary" id="run-all"' + (busy ? " disabled" : "") + ">Run All Searches</button>",
          '    <button class="secondary" id="refresh-data"' + (busy ? " disabled" : "") + ">Refresh</button>",
          "  </div>",
          "</div>",
          '<div class="grid">',
          '  <div class="stack">',
          '    <section class="card">',
          '      <p class="section-label">Profile</p>',
          '      <dl class="meta-grid">',
          '        <div class="meta-item"><dt>Candidate</dt><dd>' + escapeHtml(dashboard.profile.candidateName) + "</dd></div>",
          '        <div class="meta-item"><dt>Remote Preference</dt><dd>' + escapeHtml(formatRemotePreference(dashboard.profile.remotePreference)) + "</dd></div>",
          '        <div class="meta-item"><dt>Salary Floor</dt><dd>$' + escapeHtml(Number(dashboard.profile.salaryFloor || 0).toLocaleString()) + "</dd></div>",
          '        <div class="meta-item"><dt>Applied</dt><dd>' + escapeHtml(dashboard.profile.appliedCount) + "</dd></div>",
          '        <div class="meta-item"><dt>Active</dt><dd>' + escapeHtml(dashboard.profile.activeCount) + "</dd></div>",
          '        <div class="meta-item"><dt>Configuration</dt><dd>File-based prototype</dd></div>',
          '        <div class="meta-item"><dt>Settings</dt><dd>Edit profile and source files locally</dd></div>',
          "      </dl>",
          '      <div class="feedback' + (feedbackError ? " error" : "") + '">' + escapeHtml(feedback) + "</div>",
          "    </section>",
          '    <section class="card">',
          '      <p class="section-label">My Job Searches</p>',
          '      <div class="search-form">',
          '        <label>Name<input id="source-name" type="text" value="' + escapeHtml(formState.name) + '" placeholder="AI PM"></label>',
          '        <label>LinkedIn Search URL<input id="source-url" type="text" value="' + escapeHtml(formState.searchUrl) + '" placeholder="https://www.linkedin.com/jobs/search-results/?keywords=..."></label>',
          '        <div class="inline-actions">',
          '          <button class="primary" id="save-source"' + (busy ? " disabled" : "") + ">" + escapeHtml(formState.actionLabel) + "</button>",
          (editingSourceId
            ? '          <button class="ghost" id="cancel-edit"' + (busy ? " disabled" : "") + ">Cancel</button>"
            : "") ,
          "        </div>",
          "      </div>",
          '      <div class="subhead" style="margin-top: 12px;">Edit search labels and URLs here. Profile preferences stay file-based for now.</div>",
          '      <div style="margin-top: 16px; overflow-x: auto;">',
          '        <table>',
          '          <thead><tr><th>Name / URL</th><th>Last Run</th><th>Status</th><th>Jobs Found</th><th>High Signal</th><th>Actions</th></tr></thead>',
          '          <tbody>' + searchRows + "</tbody>",
          "        </table>",
          "      </div>",
          "    </section>",
          "  </div>",
          '  <div class="stack">',
          '    <section class="card">',
          detailMarkup,
          "    </section>",
          '    <section class="card">',
          '      <p class="section-label">Ranked Jobs</p>',
          '      <div class="filter-row">' + sourceFilterPills + "</div>",
          '      <div class="subhead" style="margin-top: 10px;">' + escapeHtml(String(queue.length)) + ' active job(s) in this view.</div>',
          '      <div class="queue-list" style="margin-top: 14px;">' + queueItems + "</div>",
          "    </section>",
          '    <section class="card">',
          '      <p class="section-label">Applied</p>',
          '      <div class="subhead">' + escapeHtml(String(appliedQueue.length)) + ' applied job(s) in this view.</div>',
          '      <div class="queue-list" style="margin-top: 14px; max-height: 28vh;">' + appliedItems + "</div>",
          "    </section>",
          "  </div>",
          "</div>"
        ].join("");

        document.getElementById("run-all").addEventListener("click", runAll);
        document.getElementById("refresh-data").addEventListener("click", refreshDashboard);
        document.getElementById("save-source").addEventListener("click", saveSource);

        const cancelEdit = document.getElementById("cancel-edit");
        if (cancelEdit) {
          cancelEdit.addEventListener("click", resetSourceForm);
        }

        for (const button of document.querySelectorAll("[data-see-results]")) {
          button.addEventListener("click", () => setSourceFilter(button.dataset.seeResults));
        }

        for (const button of document.querySelectorAll("[data-filter-source]")) {
          button.addEventListener("click", () => setSourceFilter(button.dataset.filterSource));
        }

        for (const button of document.querySelectorAll("[data-run-source]")) {
          button.addEventListener("click", () => runSource(button.dataset.runSource));
        }

        for (const button of document.querySelectorAll("[data-edit-source]")) {
          button.addEventListener("click", () => beginEditSource(button.dataset.editSource));
        }

        for (const button of document.querySelectorAll("[data-job-id]")) {
          button.addEventListener("click", () => selectJob(button.dataset.jobId));
        }

        const openCurrentButton = document.getElementById("open-current");
        if (openCurrentButton) {
          openCurrentButton.addEventListener("click", openCurrent);
        }

        for (const button of document.querySelectorAll("[data-status]")) {
          button.addEventListener("click", () => updateStatus(button.dataset.status));
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
        const queue = groupedQueue.filter((job) => job.status !== "applied");
        const appliedQueue = groupedQueue.filter((job) => job.status === "applied");
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ jobs: queue, appliedJobs: appliedQueue }));
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

        const source = sourceId
          ? updateSourceDefinition(sourceId, { name, searchUrl })
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
