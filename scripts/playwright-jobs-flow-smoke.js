import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import {
  markApplicationStatus,
  recordSourceRunDeltas,
  upsertEvaluations,
  upsertJobs
} from "../src/jobs/repository.js";
import { startReviewServer } from "../src/review/server.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEW_WEB_DIST_INDEX_PATH = path.join(
  REPO_ROOT,
  "src",
  "review",
  "web",
  "dist",
  "index.html"
);
const EXAMPLE_CONFIGS = [
  ["config/profile.example.json", "config/profile.json"],
  ["config/profile-source.example.json", "config/profile-source.json"],
  ["config/source-criteria.example.json", "config/source-criteria.json"],
  ["config/sources.example.json", "config/sources.json"]
];
const ACTIVE_JOB_IDS = Array.from({ length: 12 }, (_, index) =>
  `jobs-smoke-new-${String(index + 1).padStart(2, "0")}`
);
const APPLIED_JOB_ID = "jobs-smoke-applied";
const SKIPPED_JOB_ID = "jobs-smoke-skipped";
const REJECTED_JOB_ID = "jobs-smoke-rejected";
const JOB_TITLES = {
  [ACTIVE_JOB_IDS[0]]: "Built In PM 01",
  [ACTIVE_JOB_IDS[1]]: "Built In PM 02",
  [ACTIVE_JOB_IDS[2]]: "Built In PM 03",
  [ACTIVE_JOB_IDS[3]]: "Built In PM 04",
  [ACTIVE_JOB_IDS[4]]: "Ashby PM 01",
  [ACTIVE_JOB_IDS[5]]: "Ashby PM 02",
  [ACTIVE_JOB_IDS[6]]: "Google PM 01",
  [ACTIVE_JOB_IDS[7]]: "Google PM 02",
  [ACTIVE_JOB_IDS[8]]: "Google PM 03",
  [ACTIVE_JOB_IDS[9]]: "Google PM 04",
  [ACTIVE_JOB_IDS[10]]: "Built In PM 05",
  [ACTIVE_JOB_IDS[11]]: "Built In PM 06",
  [APPLIED_JOB_ID]: "Applied PM",
  [SKIPPED_JOB_ID]: "Skipped PM",
  [REJECTED_JOB_ID]: "Rejected PM"
};

function isoDaysAgo(dayOffset, hourOffset = 0) {
  const value = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000 - hourOffset * 60 * 60 * 1000);
  return value.toISOString();
}

function buildSeededJobs() {
  const activeDefinitions = [
    {
      id: ACTIVE_JOB_IDS[0],
      title: "Built In PM 01",
      source: "builtin_search",
      sourceId: "builtin-sf-ai-pm",
      sourceUrl: "https://builtin.com/job/jobs-smoke-new-01",
      company: "Built In Labs",
      location: "San Francisco, CA",
      postedAt: isoDaysAgo(0, 1),
      score: 98,
      bucket: "high_signal"
    },
    {
      id: ACTIVE_JOB_IDS[1],
      title: "Built In PM 02",
      source: "builtin_search",
      sourceId: "builtin-sf-ai-pm",
      sourceUrl: "https://builtin.com/job/jobs-smoke-new-02",
      company: "Built In Labs",
      location: "San Francisco, CA",
      postedAt: isoDaysAgo(0, 2),
      score: 96,
      bucket: "high_signal"
    },
    {
      id: ACTIVE_JOB_IDS[2],
      title: "Built In PM 03",
      source: "builtin_search",
      sourceId: "builtin-sf-ai-pm",
      sourceUrl: "https://builtin.com/job/jobs-smoke-new-03",
      company: "Built In Labs",
      location: "San Francisco, CA",
      postedAt: isoDaysAgo(0, 3),
      score: 94,
      bucket: "high_signal"
    },
    {
      id: ACTIVE_JOB_IDS[3],
      title: "Built In PM 04",
      source: "builtin_search",
      sourceId: "builtin-sf-ai-pm",
      sourceUrl: "https://builtin.com/job/jobs-smoke-new-04",
      company: "Built In Labs",
      location: "San Francisco, CA",
      postedAt: isoDaysAgo(0, 4),
      score: 92,
      bucket: "high_signal"
    },
    {
      id: ACTIVE_JOB_IDS[4],
      title: "Ashby PM 01",
      source: "ashby_search",
      sourceId: "ashby-pm-roles",
      sourceUrl: "https://jobs.ashbyhq.com/example/jobs-smoke-new-05",
      company: "Ashby Example",
      location: "Remote",
      postedAt: isoDaysAgo(1, 1),
      score: 90,
      bucket: "high_signal"
    },
    {
      id: ACTIVE_JOB_IDS[5],
      title: "Ashby PM 02",
      source: "ashby_search",
      sourceId: "ashby-pm-roles",
      sourceUrl: "https://jobs.ashbyhq.com/example/jobs-smoke-new-06",
      company: "Ashby Example",
      location: "Remote",
      postedAt: isoDaysAgo(1, 2),
      score: 88,
      bucket: "high_signal"
    },
    {
      id: ACTIVE_JOB_IDS[6],
      title: "Google PM 01",
      source: "google_search",
      sourceId: "google-ai-pm",
      sourceUrl: "https://www.google.com/search?q=jobs-smoke-new-07",
      company: "Google Results",
      location: "Mountain View, CA",
      postedAt: isoDaysAgo(1, 3),
      score: 86,
      bucket: "high_signal"
    },
    {
      id: ACTIVE_JOB_IDS[7],
      title: "Google PM 02",
      source: "google_search",
      sourceId: "google-ai-pm",
      sourceUrl: "https://www.google.com/search?q=jobs-smoke-new-08",
      company: "Google Results",
      location: "Mountain View, CA",
      postedAt: isoDaysAgo(1, 4),
      score: 84,
      bucket: "high_signal"
    },
    {
      id: ACTIVE_JOB_IDS[8],
      title: "Google PM 03",
      source: "google_search",
      sourceId: "google-ai-pm",
      sourceUrl: "https://www.google.com/search?q=jobs-smoke-new-09",
      company: "Google Results",
      location: "Mountain View, CA",
      postedAt: isoDaysAgo(2, 1),
      score: 82,
      bucket: "mid_signal"
    },
    {
      id: ACTIVE_JOB_IDS[9],
      title: "Google PM 04",
      source: "google_search",
      sourceId: "google-ai-pm",
      sourceUrl: "https://www.google.com/search?q=jobs-smoke-new-10",
      company: "Google Results",
      location: "Mountain View, CA",
      postedAt: isoDaysAgo(2, 2),
      score: 80,
      bucket: "mid_signal"
    },
    {
      id: ACTIVE_JOB_IDS[10],
      title: "Built In PM 05",
      source: "builtin_search",
      sourceId: "builtin-sf-ai-pm",
      sourceUrl: "https://builtin.com/job/jobs-smoke-new-11",
      company: "Built In Labs",
      location: "San Francisco, CA",
      postedAt: isoDaysAgo(2, 3),
      score: 78,
      bucket: "mid_signal"
    },
    {
      id: ACTIVE_JOB_IDS[11],
      title: "Built In PM 06",
      source: "builtin_search",
      sourceId: "builtin-sf-ai-pm",
      sourceUrl: "https://builtin.com/job/jobs-smoke-new-12",
      company: "Built In Labs",
      location: "San Francisco, CA",
      postedAt: isoDaysAgo(2, 4),
      score: 76,
      bucket: "mid_signal"
    }
  ];

  const processedDefinitions = [
    {
      id: APPLIED_JOB_ID,
      title: "Applied PM",
      source: "builtin_search",
      sourceId: "builtin-sf-ai-pm",
      sourceUrl: "https://builtin.com/job/jobs-smoke-applied",
      company: "Applied Co",
      location: "San Francisco, CA",
      postedAt: isoDaysAgo(3, 1),
      score: 70,
      bucket: "mid_signal",
      status: "applied",
      notes: "Applied on company site"
    },
    {
      id: SKIPPED_JOB_ID,
      title: "Skipped PM",
      source: "google_search",
      sourceId: "google-ai-pm",
      sourceUrl: "https://www.google.com/search?q=jobs-smoke-skipped",
      company: "Skipped Co",
      location: "Oakland, CA",
      postedAt: isoDaysAgo(3, 2),
      score: 68,
      bucket: "mid_signal",
      status: "skip_for_now",
      notes: "Need to follow up later"
    },
    {
      id: REJECTED_JOB_ID,
      title: "Rejected PM",
      source: "ashby_search",
      sourceId: "ashby-pm-roles",
      sourceUrl: "https://jobs.ashbyhq.com/example/jobs-smoke-rejected",
      company: "Rejected Co",
      location: "New York, NY",
      postedAt: isoDaysAgo(3, 3),
      score: 66,
      bucket: "mid_signal",
      status: "rejected",
      notes: "Existing rejection note"
    }
  ];

  const definitions = [...activeDefinitions, ...processedDefinitions];
  const jobs = definitions.map((definition, index) => {
    const createdAt = definition.postedAt;
    return {
      id: definition.id,
      source: definition.source,
      sourceId: definition.sourceId,
      sourceUrl: definition.sourceUrl,
      externalId: `jobs-smoke-external-${index + 1}`,
      title: definition.title,
      company: definition.company,
      location: definition.location,
      postedAt: definition.postedAt,
      employmentType: "Full-time",
      easyApply: false,
      salaryText: `$${210 - index}K`,
      description: `${definition.title} description`,
      normalizedHash: definition.id,
      structuredMeta: { jobLevel: "senior" },
      metadataQualityScore: 95,
      missingRequiredFields: [],
      createdAt,
      updatedAt: createdAt
    };
  });
  const evaluations = definitions.map((definition) => ({
    jobId: definition.id,
    score: definition.score,
    bucket: definition.bucket,
    summary: `${definition.title} is a strong fit for the smoke harness.`,
    reasons: [
      "Strong product scope alignment",
      "Relevant AI and platform experience"
    ],
    evaluationMeta: { smokeFixture: true },
    confidence: 91,
    freshnessDays: 1,
    hardFiltered: false,
    evaluatedAt: definition.postedAt
  }));
  const statuses = processedDefinitions.map((definition) => ({
    jobId: definition.id,
    status: definition.status,
    notes: definition.notes
  }));

  return {
    jobs,
    evaluations,
    statuses
  };
}

export function parseArgs(argv) {
  const options = {
    mode: "legacy",
    outputDir: path.resolve(REPO_ROOT, "docs", "roadmap", "progress-merge"),
    artifactPrefix: `${new Date().toISOString().slice(0, 10)}-jobs-react`,
    port: 4513,
    timeoutMs: 30_000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--mode") {
      options.mode = String(next || "").trim().toLowerCase();
      index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      options.outputDir = path.resolve(String(next || ""));
      index += 1;
      continue;
    }

    if (arg === "--artifact-prefix") {
      options.artifactPrefix = String(next || "").trim();
      index += 1;
      continue;
    }

    if (arg === "--port") {
      options.port = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!["legacy", "react"].includes(options.mode)) {
    throw new Error("--mode must be one of: legacy, react");
  }
  if (!options.artifactPrefix) {
    throw new Error("--artifact-prefix must be non-empty");
  }
  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive integer");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }

  return options;
}

export function createTempWorkspace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-jobs-smoke-"));
  const seededAt = isoDaysAgo(0, 0);

  for (const [from, to] of EXAMPLE_CONFIGS) {
    const sourcePath = path.join(REPO_ROOT, from);
    const destinationPath = path.join(tempDir, to);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }

  const settingsPath = path.join(tempDir, "data", "user-settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        version: 1,
        installId: "jobs-smoke-install",
        analytics: {
          enabled: true,
          updatedAt: seededAt
        },
        onboarding: {
          startedAt: seededAt,
          completed: true,
          completedAt: seededAt,
          firstRunAt: seededAt,
          sourcesConfiguredAt: seededAt,
          consent: {
            termsAccepted: true,
            privacyAccepted: true,
            rateLimitPolicyAccepted: true,
            tosRiskAccepted: true,
            acceptedAt: seededAt,
            updatedAt: seededAt
          },
          channel: {
            value: "codex",
            confidence: "smoke_fixture",
            updatedAt: seededAt
          },
          selectedSourceIds: [
            "builtin-sf-ai-pm",
            "ashby-pm-roles",
            "google-ai-pm"
          ],
          checks: {
            sources: {}
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return tempDir;
}

export function seedJobsSmokeData(workspace) {
  const dbPath = path.join(workspace, "data", "jobs.db");
  const { db } = openDatabase(dbPath);
  const fixture = buildSeededJobs();

  try {
    runMigrations(db);
    upsertJobs(db, fixture.jobs);
    upsertEvaluations(db, fixture.evaluations);
    for (const statusRow of fixture.statuses) {
      markApplicationStatus(db, statusRow.jobId, statusRow.status, statusRow.notes);
    }
    recordSourceRunDeltas(db, [
      {
        runId: "jobs-smoke-run",
        sourceId: "builtin-sf-ai-pm",
        newCount: 6,
        updatedCount: 0,
        unchangedCount: 0,
        importedCount: 7,
        refreshMode: "mock",
        servedFrom: "cache",
        statusReason: "mock_profile",
        statusLabel: "cache_only",
        capturedAt: isoDaysAgo(0, 1),
        recordedAt: isoDaysAgo(0, 1)
      },
      {
        runId: "jobs-smoke-run",
        sourceId: "ashby-pm-roles",
        newCount: 2,
        updatedCount: 0,
        unchangedCount: 0,
        importedCount: 3,
        refreshMode: "mock",
        servedFrom: "cache",
        statusReason: "mock_profile",
        statusLabel: "cache_only",
        capturedAt: isoDaysAgo(0, 2),
        recordedAt: isoDaysAgo(0, 2)
      },
      {
        runId: "jobs-smoke-run",
        sourceId: "google-ai-pm",
        newCount: 4,
        updatedCount: 0,
        unchangedCount: 0,
        importedCount: 5,
        refreshMode: "mock",
        servedFrom: "cache",
        statusReason: "mock_profile",
        statusLabel: "cache_only",
        capturedAt: isoDaysAgo(0, 3),
        recordedAt: isoDaysAgo(0, 3)
      }
    ]);
  } finally {
    db.close();
  }

  return {
    activeJobIds: [...ACTIVE_JOB_IDS],
    appliedJobId: APPLIED_JOB_ID,
    skippedJobId: SKIPPED_JOB_ID,
    rejectedJobId: REJECTED_JOB_ID
  };
}

function ensureReactBuild(mode) {
  if (mode !== "react") {
    return;
  }

  const buildResult = spawnSync("npm", ["run", "dashboard:web:build"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8"
  });

  if (buildResult.status !== 0) {
    throw new Error(
      `React build failed (${buildResult.status}): ${
        buildResult.stderr || buildResult.stdout || "unknown error"
      }`
    );
  }

  if (!fs.existsSync(REVIEW_WEB_DIST_INDEX_PATH)) {
    throw new Error(
      `React build completed but dist index is missing at ${REVIEW_WEB_DIST_INDEX_PATH}`
    );
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, message) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await predicate();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(200);
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error(message);
}

async function fetchDashboardPayload(baseUrl) {
  const response = await fetch(`${baseUrl}/api/dashboard`, {
    signal: AbortSignal.timeout(2_000)
  });
  if (!response.ok) {
    throw new Error(`GET /api/dashboard returned HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForDashboardJson(baseUrl, timeoutMs) {
  return waitFor(
    async () => {
      try {
        return await fetchDashboardPayload(baseUrl);
      } catch {
        return null;
      }
    },
    timeoutMs,
    `Timed out waiting for ${baseUrl}/api/dashboard`
  );
}

async function closeServer(server) {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function findJob(payload, jobId) {
  const groups = [
    Array.isArray(payload?.queue) ? payload.queue : [],
    Array.isArray(payload?.appliedQueue) ? payload.appliedQueue : [],
    Array.isArray(payload?.skippedQueue) ? payload.skippedQueue : [],
    Array.isArray(payload?.rejectedQueue) ? payload.rejectedQueue : []
  ];

  for (const group of groups) {
    const match = group.find((job) => job.id === jobId || job.primaryJobId === jobId);
    if (match) {
      return match;
    }
  }

  return null;
}

async function waitForJobStatus(baseUrl, jobId, expectedStatus, timeoutMs) {
  return waitFor(
    async () => {
      const payload = await fetchDashboardPayload(baseUrl);
      const match = findJob(payload, jobId);
      return match && match.status === expectedStatus ? payload : null;
    },
    timeoutMs,
    `Timed out waiting for ${jobId} to reach status ${expectedStatus}`
  );
}

async function waitForRejectedNote(baseUrl, jobId, expectedNote, timeoutMs) {
  return waitFor(
    async () => {
      const payload = await fetchDashboardPayload(baseUrl);
      const match = findJob(payload, jobId);
      return match && match.notes === expectedNote ? payload : null;
    },
    timeoutMs,
    `Timed out waiting for ${jobId} rejection note`
  );
}

export function assertModeTitle(mode, title) {
  const normalizedTitle = String(title || "").trim();

  if (mode === "legacy") {
    const isLegacyTitle =
      normalizedTitle.includes("Job Finder Dashboard") &&
      !normalizedTitle.includes("Job Finder Dashboard UI");
    if (!isLegacyTitle) {
      throw new Error(`Unexpected legacy page title: ${title}`);
    }
    return;
  }

  if (mode === "react") {
    if (!normalizedTitle.includes("Job Finder Dashboard UI")) {
      throw new Error(`Unexpected react page title: ${title}`);
    }
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

async function waitForLocator(locator, timeoutMs, message) {
  return waitFor(
    async () => ((await locator.count()) > 0 ? locator.first() : null),
    timeoutMs,
    message
  );
}

async function waitForAnyLocator(locatorFactories, timeoutMs, message) {
  return waitFor(
    async () => {
      for (const createLocator of locatorFactories) {
        const locator = createLocator();
        if ((await locator.count()) > 0) {
          return locator.first();
        }
      }
      return null;
    },
    timeoutMs,
    message
  );
}

async function ensureTabActive(tabLocator, timeoutMs, label) {
  const tab = await waitForLocator(tabLocator, timeoutMs, `${label} did not render`);
  const isAlreadyActive =
    (await tab.getAttribute("data-state")) === "active" ||
    (await tab.getAttribute("aria-selected")) === "true";

  if (!isAlreadyActive) {
    await tab.click();
  }

  await waitFor(
    async () => {
      const dataState = await tab.getAttribute("data-state");
      const ariaSelected = await tab.getAttribute("aria-selected");
      return dataState === "active" || ariaSelected === "true" ? true : null;
    },
    timeoutMs,
    `${label} did not become active`
  );
}

async function runLegacyFlow(page, baseUrl, timeoutMs) {
  const checks = [];

  await waitFor(
    async () => ((await page.locator('[data-tab="jobs"].active').count()) > 0 ? true : null),
    timeoutMs,
    "Jobs tab did not render as active"
  );
  checks.push("jobs_tab_render");

  const initialQueueCount = await page.locator(".queue-item").count();
  if (initialQueueCount !== 10) {
    throw new Error(`Expected 10 jobs on the first page, saw ${initialQueueCount}`);
  }

  await page.locator('[data-jobs-page-nav="next"]').click();
  await waitFor(
    async () => ((await page.getByText("Page 2 of 2", { exact: false }).count()) > 0 ? true : null),
    timeoutMs,
    "Jobs pagination did not advance to page 2"
  );
  checks.push("jobs_pagination");

  await page.locator('[data-jobs-page-nav="prev"]').click();
  await waitFor(
    async () => ((await page.getByText("Page 1 of 2", { exact: false }).count()) > 0 ? true : null),
    timeoutMs,
    "Jobs pagination did not return to page 1"
  );

  await page.locator("#toggle-job-filters").click();
  await waitFor(
    async () => ((await page.locator('[data-filter-source="gg"]').count()) > 0 ? true : null),
    timeoutMs,
    "Source filters did not expand"
  );

  await page.locator('[data-filter-source="gg"]').click();
  await waitFor(
    async () => ((await page.locator('.filter-chip.active[data-filter-source="gg"]').count()) > 0 ? true : null),
    timeoutMs,
    "Google source filter did not activate"
  );
  const filteredQueueCount = await page.locator(".queue-item").count();
  if (filteredQueueCount !== 4) {
    throw new Error(`Expected 4 Google jobs after filtering, saw ${filteredQueueCount}`);
  }
  checks.push("source_filter_change");

  await page.locator('[data-filter-source="all"]').click();
  await waitFor(
    async () => ((await page.locator('.filter-chip.active[data-filter-source="all"]').count()) > 0 ? true : null),
    timeoutMs,
    "All source filter did not reactivate"
  );

  await page.locator('[data-jobs-sort="date"]').click();
  await waitFor(
    async () => ((await page.locator('[data-jobs-sort="date"].active').count()) > 0 ? true : null),
    timeoutMs,
    "Date sort did not activate"
  );
  checks.push("sort_change");

  await page.locator('[data-jobs-sort="score"]').click();
  await waitFor(
    async () => ((await page.locator('[data-jobs-sort="score"].active').count()) > 0 ? true : null),
    timeoutMs,
    "Score sort did not reactivate"
  );

  await page.locator(".queue-item", { hasText: JOB_TITLES[ACTIVE_JOB_IDS[1]] }).click();
  await waitForJobStatus(baseUrl, ACTIVE_JOB_IDS[1], "viewed", timeoutMs);
  checks.push("mark_viewed");

  await page.locator('.decision-btn[data-status="applied"]').click();
  await waitForJobStatus(baseUrl, ACTIVE_JOB_IDS[1], "applied", timeoutMs);
  checks.push("mark_applied");

  await page.selectOption(".view-select", "applied");
  await waitFor(
    async () => ((await page.locator(".queue-item", { hasText: JOB_TITLES[ACTIVE_JOB_IDS[1]] }).count()) > 0 ? true : null),
    timeoutMs,
    "Applied view did not include the updated job"
  );
  checks.push("view_change_applied");

  await page.selectOption(".view-select", "all");
  await waitFor(
    async () => ((await page.locator(".queue-item", { hasText: JOB_TITLES[ACTIVE_JOB_IDS[2]] }).count()) > 0 ? true : null),
    timeoutMs,
    "All view did not restore active queue"
  );

  await page.locator(".queue-item", { hasText: JOB_TITLES[ACTIVE_JOB_IDS[2]] }).click();
  await waitForJobStatus(baseUrl, ACTIVE_JOB_IDS[2], "viewed", timeoutMs);
  await page.locator('.decision-btn[data-status="skip_for_now"]').click();
  await waitForJobStatus(baseUrl, ACTIVE_JOB_IDS[2], "skip_for_now", timeoutMs);
  checks.push("mark_skipped");

  await page.locator(".queue-item", { hasText: JOB_TITLES[ACTIVE_JOB_IDS[3]] }).click();
  await waitForJobStatus(baseUrl, ACTIVE_JOB_IDS[3], "viewed", timeoutMs);
  page.once("dialog", (dialog) => dialog.accept("Role is not remote enough"));
  await page.locator('.decision-btn[data-status="rejected"]').click();
  await waitForRejectedNote(baseUrl, ACTIVE_JOB_IDS[3], "Role is not remote enough", timeoutMs);
  checks.push("mark_rejected");

  await page.selectOption(".view-select", "rejected");
  await waitFor(
    async () => ((await page.locator(".queue-item", { hasText: JOB_TITLES[ACTIVE_JOB_IDS[3]] }).count()) > 0 ? true : null),
    timeoutMs,
    "Rejected view did not include the updated job"
  );
  await page.locator(".queue-item", { hasText: JOB_TITLES[ACTIVE_JOB_IDS[3]] }).click();
  await waitFor(
    async () =>
      ((await page.getByText("Rejection Reason", { exact: false }).count()) > 0 ? true : null),
    timeoutMs,
    "Rejected detail did not show the rejection reason"
  );
  checks.push("view_change_rejected");

  return checks;
}

async function runReactFlow(page, baseUrl, timeoutMs) {
  const checks = [];

  await ensureTabActive(page.getByRole("tab", { name: "Jobs" }), timeoutMs, "Jobs tab");
  checks.push("jobs_tab_render");

  if (
    (await page.getByText("Jobs React slice is pending lane completion.", { exact: false }).count()) > 0
  ) {
    throw new Error(
      "React Jobs smoke is blocked: Jobs tab is still rendering placeholder content."
    );
  }

  await waitForAnyLocator(
    [
      () => page.getByRole("button", { name: /Find Jobs/i }),
      () => page.getByText("Find Jobs", { exact: false })
    ],
    timeoutMs,
    "Find Jobs control did not render"
  );
  checks.push("find_jobs_render");

  const initialJob = await waitForAnyLocator(
    [
      () => page.getByText(JOB_TITLES[ACTIVE_JOB_IDS[1]], { exact: false }),
      () => page.locator(`[data-job-id="${ACTIVE_JOB_IDS[1]}"]`)
    ],
    timeoutMs,
    `React Jobs queue did not render ${JOB_TITLES[ACTIVE_JOB_IDS[1]]}`
  );
  await initialJob.click();
  const openInitialJobButton = await waitForAnyLocator(
    [
      () => page.getByRole("button", { name: /^Open Job$/i }),
      () => page.getByRole("button", { name: /^Open Search$/i }),
      () => page.getByRole("button", { name: /^Open/i })
    ],
    timeoutMs,
    "Open Job action did not render for viewed transition"
  );
  await openInitialJobButton.click();
  await waitForJobStatus(baseUrl, ACTIVE_JOB_IDS[1], "viewed", timeoutMs);
  checks.push("mark_viewed");

  const appliedButton = await waitForAnyLocator(
    [
      () => page.getByRole("button", { name: /^I Applied$/i }),
      () => page.getByRole("button", { name: /^Applied$/i }),
      () => page.getByRole("button", { name: /Applied/i })
    ],
    timeoutMs,
    "Applied action did not render"
  );
  await appliedButton.click();
  await waitForJobStatus(baseUrl, ACTIVE_JOB_IDS[1], "applied", timeoutMs);
  checks.push("mark_applied");

  const rejectedJob = await waitForAnyLocator(
    [
      () => page.getByText(JOB_TITLES[ACTIVE_JOB_IDS[3]], { exact: false }),
      () => page.locator(`[data-job-id="${ACTIVE_JOB_IDS[3]}"]`)
    ],
    timeoutMs,
    `React Jobs queue did not render ${JOB_TITLES[ACTIVE_JOB_IDS[3]]}`
  );
  await rejectedJob.click();
  const openRejectedJobButton = await waitForAnyLocator(
    [
      () => page.getByRole("button", { name: /^Open Job$/i }),
      () => page.getByRole("button", { name: /^Open Search$/i }),
      () => page.getByRole("button", { name: /^Open/i })
    ],
    timeoutMs,
    "Open Job action did not render before reject flow"
  );
  await openRejectedJobButton.click();
  await waitForJobStatus(baseUrl, ACTIVE_JOB_IDS[3], "viewed", timeoutMs);

  const rejectButton = await waitForAnyLocator(
    [
      () => page.getByRole("button", { name: /^Reject$/i }),
      () => page.getByText("Reject", { exact: true })
    ],
    timeoutMs,
    "Reject action did not render"
  );
  await rejectButton.click();

  const rejectionDialog = await waitForAnyLocator(
    [
      () => page.getByRole("dialog"),
      () => page.locator('[data-slot="dialog-content"]')
    ],
    timeoutMs,
    "Reject reason dialog did not open"
  );
  const rejectionInput = await waitForAnyLocator(
    [
      () => rejectionDialog.getByRole("textbox", { name: /reason/i }),
      () => rejectionDialog.getByRole("textbox"),
      () => rejectionDialog.locator("textarea"),
      () => rejectionDialog.locator("input")
    ],
    timeoutMs,
    "Reject reason input did not render"
  );
  await rejectionInput.fill("Role is not remote enough");

  const confirmRejectButton = await waitForAnyLocator(
    [
      () => rejectionDialog.getByRole("button", { name: /^Reject$/i }),
      () => rejectionDialog.getByRole("button", { name: /^Reject job$/i }),
      () => rejectionDialog.getByRole("button", { name: /^Save$/i }),
      () => rejectionDialog.getByRole("button", { name: /^Confirm$/i })
    ],
    timeoutMs,
    "Reject confirmation action did not render"
  );
  await confirmRejectButton.click();
  await waitForRejectedNote(baseUrl, ACTIVE_JOB_IDS[3], "Role is not remote enough", timeoutMs);
  checks.push("mark_rejected");

  return checks;
}

export function getFlowRunner(mode) {
  if (mode === "legacy") {
    return runLegacyFlow;
  }

  if (mode === "react") {
    return runReactFlow;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDir, { recursive: true });
  ensureReactBuild(options.mode);
  const { chromium } = await import("playwright");

  const workspace = createTempWorkspace();
  const seedSummary = seedJobsSmokeData(workspace);
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const screenshotPath = path.resolve(
    options.outputDir,
    `${options.artifactPrefix}-${options.mode}-jobs.png`
  );
  const dashboardJsonPath = path.resolve(
    options.outputDir,
    `${options.artifactPrefix}-${options.mode}-jobs-dashboard.json`
  );
  const summaryJsonPath = path.resolve(
    options.outputDir,
    `${options.artifactPrefix}-${options.mode}-jobs-summary.json`
  );
  const logPath = path.resolve(
    options.outputDir,
    `${options.artifactPrefix}-${options.mode}-jobs-smoke.log`
  );

  const previousCwd = process.cwd();
  const previousDashboardMode = process.env.JOB_FINDER_DASHBOARD_UI;
  let server;
  let browser;
  try {
    process.chdir(workspace);
    process.env.JOB_FINDER_DASHBOARD_UI = options.mode;
    server = await startReviewServer({ port: options.port, limit: 200 });
    const initialDashboard = await waitForDashboardJson(baseUrl, options.timeoutMs);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });

    const pageTitle = await page.title();
    assertModeTitle(options.mode, pageTitle);

    const runFlow = getFlowRunner(options.mode);
    const checks = await runFlow(page, baseUrl, options.timeoutMs);

    const finalDashboard = await fetchDashboardPayload(baseUrl);
    fs.writeFileSync(dashboardJsonPath, `${JSON.stringify(finalDashboard, null, 2)}\n`, "utf8");

    const summary = {
      ok: true,
      mode: options.mode,
      baseUrl,
      pageTitle,
      seedSummary,
      initialCounts: {
        active: Array.isArray(initialDashboard.queue) ? initialDashboard.queue.length : 0,
        applied: Array.isArray(initialDashboard.appliedQueue) ? initialDashboard.appliedQueue.length : 0,
        skipped: Array.isArray(initialDashboard.skippedQueue) ? initialDashboard.skippedQueue.length : 0,
        rejected: Array.isArray(initialDashboard.rejectedQueue) ? initialDashboard.rejectedQueue.length : 0
      },
      finalCounts: {
        active: Array.isArray(finalDashboard.queue) ? finalDashboard.queue.length : 0,
        applied: Array.isArray(finalDashboard.appliedQueue) ? finalDashboard.appliedQueue.length : 0,
        skipped: Array.isArray(finalDashboard.skippedQueue) ? finalDashboard.skippedQueue.length : 0,
        rejected: Array.isArray(finalDashboard.rejectedQueue) ? finalDashboard.rejectedQueue.length : 0
      },
      checks,
      screenshotPath,
      dashboardJsonPath,
      logPath
    };

    await page.screenshot({ path: screenshotPath, fullPage: true });
    fs.writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

    const logLines = [
      `mode=${options.mode}`,
      `baseUrl=${baseUrl}`,
      "jobs_flow_check=pass",
      `checks=${checks.join(",")}`,
      `title=${pageTitle}`,
      `workspace=${workspace}`,
      `screenshot=${screenshotPath}`,
      `dashboard_json=${dashboardJsonPath}`,
      `summary_json=${summaryJsonPath}`,
      "server_boot=direct startReviewServer()"
    ];
    fs.writeFileSync(logPath, `${logLines.join("\n")}\n`, "utf8");

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    if (browser) {
      await browser.close();
    }
    await closeServer(server);
    process.chdir(previousCwd);
    if (previousDashboardMode === undefined) {
      delete process.env.JOB_FINDER_DASHBOARD_UI;
    } else {
      process.env.JOB_FINDER_DASHBOARD_UI = previousDashboardMode;
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
